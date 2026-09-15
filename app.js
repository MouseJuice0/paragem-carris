(function(){

  // ---- 预置站点(Quinta do Conde区域,按覆盖线路数排序) ----
  var STOPS = [
    { id: "150018", name: "Av. Principal, 26C" },
    { id: "150026", name: "Av. Liberdade (Farmácia)" },
    { id: "150021", name: "Av. Principal, 2594" },
    { id: "150049", name: "Av. Liberdade, 35" },
    { id: "150015", name: "R. Glória (Correios)" },
    { id: "150009", name: "EN10 (Posto Abast.) · sentido Coina" },
    { id: "150001", name: "EN10 (Posto Abast.) · sentido Qta Conde" },
    { id: "150003", name: "EN10 (Parque da Vila)" },
    { id: "150013", name: "R. Norton de Matos (Parque da Vila)" },
    { id: "150496", name: "Av. Aliados" },
    { id: "150519", name: "Av. 1º de Maio" },
    { id: "150551", name: "Av. Cova dos Vidros (J. Freguesia)" },
    { id: "150611", name: "Centro de Saúde da Quinta do Conde" }
  ];

  // ---- 目标站点配置:针对某个出发站,你实际想到达的终点/沿途站。
  // 有配置的话,每班车会标注"是否真的经过这一站",而不是只显示线路终点。
  var STOP_TARGETS = {
    "150009": { id: "142335", name: "Coina (Estação)" }
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

  var els = {
    select: document.getElementById("stopSelect"),
    board: document.getElementById("board"),
    state: document.getElementById("state"),
    updatedAt: document.getElementById("updatedAt"),
    refreshBtn: document.getElementById("refreshBtn"),
    liveDot: document.getElementById("liveDot"),
    liveLabel: document.getElementById("liveLabel")
  };

  var pollTimer = null;
  var tickTimer = null;
  var lastData = [];
  var lastFetchTime = null;

  var DEFAULT_STOP_ID = "150009"; // 用户实际常坐的站(往Coina方向那一侧):QTA CONDE (EN10) POSTO ABASTECIMENTO

  function init(){
    STOPS.forEach(function(s){
      var opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name + " · #" + s.id;
      els.select.appendChild(opt);
    });
    els.select.value = DEFAULT_STOP_ID;

    els.select.addEventListener("change", function(){
      loadArrivals(true);
    });
    els.refreshBtn.addEventListener("click", function(){
      loadArrivals(true);
    });

    document.querySelector(".note").innerHTML =
      document.querySelector(".note").innerHTML.replace("{{n}}", STOPS.length);

    loadArrivals(true);
    tickTimer = setInterval(renderCountdownsOnly, TICK_MS);
  }

  function setLive(ok){
    els.liveDot.classList.toggle("err", !ok);
    els.liveLabel.textContent = ok ? "ligado" : "falha";
  }

  function loadArrivals(userTriggered){
    if(pollTimer) clearTimeout(pollTimer);
    if(userTriggered){
      els.refreshBtn.classList.add("spinning");
      els.state && (els.board.innerHTML = '<div class="state" id="state">A carregar horários…</div>');
    }

    var stopId = els.select.value;

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
    els.board.innerHTML =
      '<div class="state error">Não foi possível obter os horários.<br>' +
      '<span style="color:var(--muted); font-size:12px;">' + (err && err.message ? err.message : "erro de rede") + '</span>' +
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
  // (比如往Cacilhas、往里斯本Sete Rios的车,可能根本不经过你要去的Coina)。
  // 用 pattern 的完整路径(而不只是终点)判断某班车是否真的会到你配置的目标站。 ----
  var patternCache = {}; // patternId -> { terminusId, pathIds } | null(请求失败)

  function currentTarget(){
    return STOP_TARGETS[els.select.value] || null;
  }

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
