(function(){

  // ---- 首次使用时的种子默认值(之后一律以localStorage里用户自己的选择为准) ----
  var SEED_DEFAULT_STOP = { id: "150009", name: "QTA CONDE (EN10) POSTO ABASTECIMENTO" };
  var SEED_TARGETS = {
    "150009": { id: "142335", name: "Coina (Estação) P0" }
  };

  // ---- 线路品牌色(取自 Carris Metropolitana /v2/lines,未知线路用主红色兜底) ----
  var LINE_COLORS = {
    "3222": "#3D85C6",
    "3720": "#FDB71A",
    "4643": "#0C807E"
  };
  var DEFAULT_LINE_COLOR = "#c61d23";

  var API_BASE = "https://api.carrismetropolitana.pt/v2";
  var POLL_MS = 25000;
  var TICK_MS = 1000;

  var LS_LAST_STOP = "paragem:lastStop";
  var LS_TARGETS = "paragem:targets";
  var LS_RECENTS = "paragem:recents";

  var els = {
    board: document.getElementById("board"),
    updatedAt: document.getElementById("updatedAt"),
    refreshBtn: document.getElementById("refreshBtn"),
    liveDot: document.getElementById("liveDot"),
    liveLabel: document.getElementById("liveLabel"),

    stopCurrentBtn: document.getElementById("stopCurrentBtn"),
    stopCurrentName: document.getElementById("stopCurrentName"),
    stopCurrentIdLabel: document.getElementById("stopCurrentIdLabel"),

    targetChipBtn: document.getElementById("targetChipBtn"),
    targetClearBtn: document.getElementById("targetClearBtn"),

    searchOverlay: document.getElementById("searchOverlay"),
    searchInput: document.getElementById("searchInput"),
    searchCloseBtn: document.getElementById("searchCloseBtn"),
    nearbyBtn: document.getElementById("nearbyBtn"),
    searchHint: document.getElementById("searchHint"),
    searchList: document.getElementById("searchList")
  };

  var pollTimer = null;
  var tickTimer = null;
  var lastData = [];
  var lastFetchTime = null;

  var STOPS_INDEX = null;   // 全量可搜索站点索引(异步加载)
  var currentStop = null;   // { id, name }
  var searchMode = null;    // "origin" | "target"

  // ---------------- localStorage 读写(全部经过 safeParseJSON,坏数据不会崩App) ----------------

  function loadLastStop(){
    return ParagemLib.safeParseJSON(localStorage.getItem(LS_LAST_STOP), null);
  }
  function saveLastStop(stop){
    try { localStorage.setItem(LS_LAST_STOP, JSON.stringify(stop)); } catch(e){}
  }
  function loadTargets(){
    return ParagemLib.safeParseJSON(localStorage.getItem(LS_TARGETS), {});
  }
  function saveTargets(map){
    try { localStorage.setItem(LS_TARGETS, JSON.stringify(map)); } catch(e){}
  }
  function loadRecents(){
    return ParagemLib.safeParseJSON(localStorage.getItem(LS_RECENTS), []);
  }
  function saveRecents(list){
    try { localStorage.setItem(LS_RECENTS, JSON.stringify(list)); } catch(e){}
  }

  function currentTarget(){
    if(!currentStop) return null;
    return ParagemLib.resolveTarget(loadTargets(), currentStop.id, SEED_TARGETS);
  }

  // ---------------- 初始化 ----------------

  function init(){
    currentStop = ParagemLib.resolveInitialStop(loadLastStop(), SEED_DEFAULT_STOP);
    renderStopBar();

    els.stopCurrentBtn.addEventListener("click", function(){ openSearch("origin"); });
    els.targetChipBtn.addEventListener("click", function(){ openSearch("target"); });
    els.targetClearBtn.addEventListener("click", clearCurrentTarget);

    els.searchCloseBtn.addEventListener("click", closeSearch);
    els.searchOverlay.addEventListener("click", function(e){
      if(e.target === els.searchOverlay) closeSearch();
    });
    els.searchInput.addEventListener("input", function(){
      renderSearchResults(els.searchInput.value);
    });
    els.nearbyBtn.addEventListener("click", useMyLocation);
    els.searchList.addEventListener("click", function(e){
      var row = e.target.closest(".search-row");
      if(!row) return;
      var stop = { id: row.getAttribute("data-id"), name: row.getAttribute("data-name") };
      if(searchMode === "origin"){
        selectOriginStop(stop);
      } else if(searchMode === "target"){
        selectTargetStop(stop);
      }
      closeSearch();
    });

    els.refreshBtn.addEventListener("click", function(){ loadArrivals(true); });

    loadStopsIndex();
    loadArrivals(true);
    tickTimer = setInterval(renderCountdownsOnly, TICK_MS);
  }

  function loadStopsIndex(){
    fetch("stops-index.json")
      .then(function(res){ if(!res.ok) throw new Error("HTTP " + res.status); return res.json(); })
      .then(function(data){ STOPS_INDEX = data; })
      .catch(function(err){ console.warn("Não foi possível carregar o índice de paragens:", err); });
  }

  // ---------------- 出发站 / 目标站 选择 ----------------

  function renderStopBar(){
    els.stopCurrentName.textContent = currentStop.name;
    els.stopCurrentIdLabel.textContent = "#" + currentStop.id;

    var target = currentTarget();
    if(target){
      els.targetChipBtn.textContent = "chega a " + target.name + " · #" + target.id;
      els.targetChipBtn.classList.add("set");
      els.targetClearBtn.hidden = false;
    } else {
      els.targetChipBtn.textContent = "+ definir destino (opcional)";
      els.targetChipBtn.classList.remove("set");
      els.targetClearBtn.hidden = true;
    }
  }

  function selectOriginStop(stop){
    currentStop = stop;
    saveLastStop(stop);
    saveRecents(ParagemLib.upsertRecent(loadRecents(), stop, 8));
    renderStopBar();
    loadArrivals(true);
  }

  function selectTargetStop(stop){
    var map = loadTargets();
    map[currentStop.id] = stop;
    saveTargets(map);
    renderStopBar();
    resolveTermini(); // 用新目标重新判断已经拉到的班次,不用重新拉取到站数据
  }

  function clearCurrentTarget(){
    var map = loadTargets();
    map[currentStop.id] = null; // 显式记为"已清除",不是删掉key——避免又被种子默认值盖回来
    saveTargets(map);
    renderStopBar();
    resolveTermini();
  }

  // ---------------- 搜索面板 ----------------

  function openSearch(mode){
    searchMode = mode;
    els.searchInput.value = "";
    els.searchOverlay.hidden = false;
    els.searchInput.placeholder = mode === "target"
      ? "Procurar paragem de destino…"
      : "Procurar paragem por nome…";
    renderSearchResults("");
    setTimeout(function(){ els.searchInput.focus(); }, 50);
  }

  function closeSearch(){
    els.searchOverlay.hidden = true;
    searchMode = null;
  }

  function renderSearchResults(query){
    var q = query.trim();
    var list;

    if(!q){
      list = loadRecents();
      els.searchHint.textContent = list.length ? "recentes" : "escreva para procurar entre " + (STOPS_INDEX ? STOPS_INDEX.length : "milhares de") + " paragens, ou use a localização";
    } else if(!STOPS_INDEX){
      list = [];
      els.searchHint.textContent = "a carregar índice de paragens…";
    } else {
      list = ParagemLib.searchStops(STOPS_INDEX, q, 30);
      els.searchHint.textContent = list.length + " resultado(s)";
    }

    renderStopRows(list.map(function(s){ return { id: s.id, name: s.name, meta: "#" + s.id }; }));
  }

  function useMyLocation(){
    if(!("geolocation" in navigator)){
      els.searchHint.textContent = "este aparelho não suporta localização";
      return;
    }
    els.searchHint.textContent = "a obter a sua localização…";
    els.searchList.innerHTML = "";

    navigator.geolocation.getCurrentPosition(
      function(pos){
        if(!STOPS_INDEX){
          els.searchHint.textContent = "índice de paragens ainda a carregar, tente outra vez em instantes";
          return;
        }
        var nearby = ParagemLib.sortStopsByDistance(STOPS_INDEX, pos.coords.latitude, pos.coords.longitude, 20);
        els.searchHint.textContent = "mais perto de si";
        renderStopRows(nearby.map(function(s){
          return { id: s.id, name: s.name, meta: formatDistance(s.distanceKm) };
        }));
      },
      function(err){
        els.searchHint.textContent = "não foi possível obter localização (" + (err && err.message ? err.message : "permissão negada") + ")";
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }

  function formatDistance(km){
    if(km < 1) return Math.round(km * 1000) + "m";
    return km.toFixed(1) + "km";
  }

  function renderStopRows(list){
    if(list.length === 0){
      els.searchList.innerHTML = '<div class="search-empty">Sem paragens encontradas.</div>';
      return;
    }
    els.searchList.innerHTML = list.map(function(s){
      return (
        '<div class="search-row" data-id="' + escapeHtml(s.id) + '" data-name="' + escapeHtml(s.name) + '">' +
          '<span class="search-row-name">' + escapeHtml(s.name) + '</span>' +
          '<span class="search-row-meta">' + escapeHtml(s.meta) + '</span>' +
        '</div>'
      );
    }).join("");
  }

  // ---------------- 到站数据 ----------------

  function setLive(ok){
    els.liveDot.classList.toggle("err", !ok);
    els.liveLabel.textContent = ok ? "ligado" : "falha";
  }

  function loadArrivals(userTriggered){
    if(pollTimer) clearTimeout(pollTimer);
    if(userTriggered){
      els.refreshBtn.classList.add("spinning");
      els.board.innerHTML = '<div class="state">A carregar horários…</div>';
    }

    var stopId = currentStop.id;

    fetch(API_BASE + "/pips/estimates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stops: [stopId] })
    })
    .then(function(res){
      if(!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function(data){
      setLive(true);
      lastFetchTime = Date.now();
      lastData = ParagemLib.filterAndSortEstimates(data, 8);
      renderBoard();
      updateFooter();
    })
    .catch(function(err){
      setLive(false);
      renderError(err);
    })
    .finally(function(){
      els.refreshBtn.classList.remove("spinning");
      pollTimer = setTimeout(function(){ loadArrivals(false); }, POLL_MS);
    });
  }

  function renderError(err){
    var msg = err && err.message ? err.message : "erro de rede";
    var info = ParagemLib.classifyFetchError(msg);
    els.board.innerHTML =
      '<div class="state error">Não foi possível obter os horários.<br>' +
      '<span style="color:var(--muted); font-size:12px;">' + escapeHtml(info.explanation) + ' (' + escapeHtml(msg) + ')</span>' +
      '<div><button class="retry-btn" onclick="window.__retry()">Tentar novamente</button></div></div>';
    window.__retry = function(){ loadArrivals(true); };
  }

  function renderBoard(){
    if(lastData.length === 0){
      els.board.innerHTML = '<div class="state">Sem partidas previstas para esta paragem, de momento.</div>';
      return;
    }
    var html = lastData.map(function(d){
      var color = LINE_COLORS[d.lineId] || DEFAULT_LINE_COLOR;
      return (
        '<div class="row" data-ts="' + d.estimatedTimeUnixSeconds + '" data-pattern="' + escapeHtml(d.patternId || "") + '">' +
          '<div class="line-badge" style="background:' + color + '; color:#fff;">' + escapeHtml(d.lineId) + '</div>' +
          '<div class="dest">' +
            '<div class="headsign">' + escapeHtml(d.stopHeadsign || "—") + '</div>' +
            '<div class="clock">paragem final <span data-term>a verificar…</span> · previsto ' + escapeHtml(d.estimatedTimeString || "") + '</div>' +
            '<div class="match-tag" data-match style="display:none;"></div>' +
          '</div>' +
          '<div class="eta" data-eta></div>' +
        '</div>'
      );
    }).join("");
    els.board.innerHTML = html;
    renderCountdownsOnly();
    resolveTermini();
  }

  // ---- 终点/途经解析:同一站台常有多条线路,各自开往完全不同的方向
  // (比如往Cacilhas、往里斯本Sete Rios的车,可能根本不经过你要去的目标站)。
  // 用 pattern 的完整路径(而不只是终点)判断某班车是否真的会到你配置的目标站。 ----
  var patternCache = {}; // patternId -> { terminusId, pathIds } | null(请求失败)

  function resolveTermini(){
    var rows = els.board.querySelectorAll(".row[data-pattern]");
    var seen = {};
    rows.forEach(function(row){
      var pid = row.getAttribute("data-pattern");
      if(!pid || seen[pid]) return;
      seen[pid] = true;

      if(Object.prototype.hasOwnProperty.call(patternCache, pid)){
        applyTerminus(pid);
        return;
      }
      fetch(API_BASE + "/patterns/" + encodeURIComponent(pid))
        .then(function(res){ if(!res.ok) throw new Error("HTTP " + res.status); return res.json(); })
        .then(function(data){
          var info = ParagemLib.extractPatternInfo(data);
          patternCache[pid] = info;
          applyTerminus(pid);
        })
        .catch(function(){
          patternCache[pid] = null;
          applyTerminus(pid);
        });
    });
  }

  function applyTerminus(pid){
    var info = patternCache[pid];
    var target = currentTarget();
    var rows = els.board.querySelectorAll('.row[data-pattern="' + pid + '"]');
    rows.forEach(function(row){
      var termEl = row.querySelector('[data-term]');
      if(termEl){
        termEl.textContent = (info && info.terminusId) ? ("#" + info.terminusId) : "ID indisponível";
      }

      var matchEl = row.querySelector('[data-match]');
      if(!matchEl) return;
      row.classList.remove("dim");
      if(!target){
        matchEl.style.display = "none";
        return;
      }
      matchEl.style.display = "block";
      var result = ParagemLib.matchTarget(info && info.pathIds, target.id);
      if(result === "unknown"){
        matchEl.textContent = "trajeto por confirmar";
        matchEl.className = "match-tag unknown";
      } else if(result === "hit"){
        matchEl.textContent = "✓ chega a " + target.name;
        matchEl.className = "match-tag hit";
      } else {
        matchEl.textContent = "✗ não passa por " + target.name;
        matchEl.className = "match-tag miss";
        row.classList.add("dim");
      }
    });
  }

  function renderCountdownsOnly(){
    var rows = els.board.querySelectorAll(".row");
    if(rows.length === 0) return;
    var now = Date.now() / 1000;
    rows.forEach(function(row){
      var ts = parseFloat(row.getAttribute("data-ts"));
      var diff = ts - now;
      var etaEl = row.querySelector("[data-eta]");
      if(!etaEl) return;
      var eta = ParagemLib.formatEta(diff);
      if(eta.kind === "now"){
        etaEl.className = "eta now";
        etaEl.innerHTML = '<span class="num">' + eta.label + '</span>';
      } else if(eta.kind === "soon"){
        etaEl.className = "eta now";
        etaEl.innerHTML = '<span class="num">&lt;1</span><span class="unit">min</span>';
      } else {
        etaEl.className = "eta";
        etaEl.innerHTML = '<span class="num">' + eta.label + '</span><span class="unit">min</span>';
      }
    });
  }

  function updateFooter(){
    if(!lastFetchTime) return;
    var secs = Math.round((Date.now() - lastFetchTime)/1000);
    els.updatedAt.textContent = "atualizado há " + secs + "s";
  }
  setInterval(function(){
    if(lastFetchTime){
      var secs = Math.round((Date.now() - lastFetchTime)/1000);
      els.updatedAt.textContent = "atualizado há " + secs + "s";
    }
  }, 1000);

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }

  function registerServiceWorker(){
    if(!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("service-worker.js").catch(function(err){
      console.warn("Service worker não registado:", err);
    });
  }

  init();
  registerServiceWorker();
})();
