/**
 * ParagemLib — 纯逻辑层,不碰DOM、不发请求。
 * 目的:能被 Node 直接 require() 做单元测试,也能被浏览器当普通<script>加载。
 * 任何跟"到站牌怎么算"相关的规则,都应该改在这里,而不是散落在页面的DOM代码里。
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.ParagemLib = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {

  /**
   * 过滤掉没有预计到达时间的记录,按时间升序排序,只保留最近的 limit 条。
   * @param {Array} raw - /pips/estimates 的原始返回
   * @param {number} [limit=8]
   */
  function filterAndSortEstimates(raw, limit) {
    limit = limit || 8;
    return (Array.isArray(raw) ? raw : [])
      .filter(function (d) { return d && d.estimatedTimeUnixSeconds != null; })
      .sort(function (a, b) { return a.estimatedTimeUnixSeconds - b.estimatedTimeUnixSeconds; })
      .slice(0, limit);
  }

  /**
   * 把"还有多少秒"换算成显示用的倒计时文案。
   * <=20秒 -> "agora"(现在/即将进站)
   * <60秒  -> "<1 min"
   * 其余    -> 四舍五入的分钟数
   * @param {number} diffSeconds
   */
  function formatEta(diffSeconds) {
    if (diffSeconds <= 20) {
      return { kind: "now", label: "agora", unit: null };
    }
    if (diffSeconds < 60) {
      return { kind: "soon", label: "<1", unit: "min" };
    }
    return { kind: "normal", label: String(Math.round(diffSeconds / 60)), unit: "min" };
  }

  /**
   * 从 /patterns/:id 的返回中提取终点站ID和完整途经站点ID列表。
   * API 有时把结果包一层数组,有时不包,这里统一处理掉。
   * @param {Object|Array} patternResponse
   */
  function extractPatternInfo(patternResponse) {
    var p = Array.isArray(patternResponse) ? patternResponse[0] : patternResponse;
    var path = (p && p.path) || [];
    var ids = path.map(function (x) { return x.stop_id; });
    return {
      terminusId: ids.length ? ids[ids.length - 1] : null,
      pathIds: ids
    };
  }

  /**
   * 判断某班车是否真的会经过用户关心的目标站。
   * @param {Array|null} pathIds - 该班车完整途经站点ID列表;拉取失败时传 null
   * @param {string|null} targetId - 用户配置的目标站ID;未配置时传 null
   * @returns {"hit"|"miss"|"unknown"|null} null 表示"这个出发站没配置目标站,不需要判断"
   */
  function matchTarget(pathIds, targetId) {
    if (!targetId) return null;
    if (!pathIds) return "unknown";
    return pathIds.indexOf(targetId) !== -1 ? "hit" : "miss";
  }

  /**
   * 去掉重音符号并转小写,方便"conde"也能搜到"Condé"这种情况。
   * @param {string} s
   */
  function normalize(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  /**
   * 在精简版站点索引里做子字符串搜索。
   * 名字开头就匹配的排在前面,其余按子串匹配位置排序,最多返回 limit 条。
   * @param {Array<{id:string,name:string}>} index - stops-index.json 的内容
   * @param {string} query - 用户输入的搜索词
   * @param {number} [limit=20]
   */
  function searchStops(index, query, limit) {
    limit = limit || 20;
    var q = normalize(query);
    if (!q || !Array.isArray(index)) return [];

    var scored = [];
    for (var i = 0; i < index.length; i++) {
      var item = index[i];
      var name = normalize(item.name);
      var pos = name.indexOf(q);
      if (pos === -1) continue;
      scored.push({ item: item, pos: pos });
    }

    scored.sort(function (a, b) {
      if (a.pos !== b.pos) return a.pos - b.pos; // 开头匹配的优先
      return a.item.name.localeCompare(b.item.name, "pt");
    });

    return scored.slice(0, limit).map(function (s) { return s.item; });
  }

  /**
   * 安全地解析JSON,解析失败或输入为空时返回 fallback,不抛异常。
   * 用于读localStorage——用户可能手动清过缓存/换过版本,数据格式不能全信。
   */
  function safeParseJSON(str, fallback) {
    if (str == null) return fallback;
    try {
      return JSON.parse(str);
    } catch (e) {
      return fallback;
    }
  }

  /**
   * 把一个站点塞进"最近使用"列表最前面,按id去重,最多保留 maxLen 条。
   * @param {Array<{id:string}>} list
   * @param {{id:string}} item
   * @param {number} [maxLen=8]
   */
  function upsertRecent(list, item, maxLen) {
    maxLen = maxLen || 8;
    var base = Array.isArray(list) ? list : [];
    var rest = base.filter(function (x) { return x && x.id !== item.id; });
    return [item].concat(rest).slice(0, maxLen);
  }

  /**
   * 决定App启动时该选哪个出发站:有存档用存档,没有就用种子默认值。
   * @param {{id:string,name:string}|null} storedLastStop - 从localStorage读到的上次选择
   * @param {{id:string,name:string}} fallbackStop - 首次使用时的种子默认值
   */
  function resolveInitialStop(storedLastStop, fallbackStop) {
    return (storedLastStop && storedLastStop.id) ? storedLastStop : fallbackStop;
  }

  /**
   * 决定某个出发站当前配置的目标站是什么。
   * 关键规则:用户在界面上显式存过的设置(哪怕是"已清除"),优先于种子默认值——
   * 不能因为用户主动清除了目标站,就又被写死的默认值悄悄覆盖回去。
   * @param {Object} storedTargets - { [stopId]: {id,name} | null }
   * @param {string} stopId
   * @param {Object} seedTargets - 首次使用时的种子默认值,同样的形状
   */
  function resolveTarget(storedTargets, stopId, seedTargets) {
    if (storedTargets && Object.prototype.hasOwnProperty.call(storedTargets, stopId)) {
      return storedTargets[stopId] || null;
    }
    if (seedTargets && Object.prototype.hasOwnProperty.call(seedTargets, stopId)) {
      return seedTargets[stopId];
    }
    return null;
  }

  /**
   * 两个经纬度之间的直线距离(公里),用于"附近站点"排序。
   */
  function haversineKm(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * 按离给定坐标的距离,把站点索引排序,最多返回 limit 条,每条附带 distanceKm。
   * 用户不需要知道站名,只要愿意分享定位就能找到站——这是给"记不住站名"场景用的。
   * @param {Array<{id,name,lat,lon}>} index
   * @param {number} lat
   * @param {number} lon
   * @param {number} [limit=20]
   */
  function sortStopsByDistance(index, lat, lon, limit) {
    limit = limit || 20;
    if (!Array.isArray(index)) return [];
    return index
      .map(function (s) {
        return Object.assign({}, s, { distanceKm: haversineKm(lat, lon, s.lat, s.lon) });
      })
      .sort(function (a, b) { return a.distanceKm - b.distanceKm; })
      .slice(0, limit);
  }

  /**
   * 把fetch失败的错误信息,归类成用户能看懂的解释。
   * 目的:HTTP 5xx明确是官方服务器自己的问题,不该让用户以为是App坏了。
   * @param {string} message - 形如 "HTTP 500" 或其他 Error.message
   */
  function classifyFetchError(message) {
    var isServerError = /^HTTP 5\d\d$/.test(String(message || ""));
    return {
      isServerError: isServerError,
      explanation: isServerError
        ? "O serviço oficial da Carris Metropolitana parece estar em baixo neste momento — não é um problema desta app. Tente novamente daqui a pouco."
        : "Verifique a ligação à internet e tente novamente."
    };
  }

  /**
   * 把"多少秒之前"换算成简短的展示文案,统一用在页脚和"数据可能过期"提示条上。
   * @param {number} seconds
   */
  function formatAgo(seconds) {
    seconds = Math.max(0, Math.round(seconds));
    if (seconds < 60) return "há " + seconds + "s";
    var mins = Math.round(seconds / 60);
    return "há " + mins + " min";
  }

  /**
   * 切换某个站点的收藏状态:已收藏就移除,没收藏就加进去(追加到末尾,不去重复插入)。
   * @param {Array<{id:string}>} list
   * @param {{id:string,name:string}} item
   */
  function toggleFavorite(list, item) {
    var base = Array.isArray(list) ? list : [];
    var exists = base.some(function (x) { return x && x.id === item.id; });
    if (exists) {
      return base.filter(function (x) { return x.id !== item.id; });
    }
    return base.concat([item]);
  }

  /**
   * 判断某个站点id是否在收藏列表里。
   */
  function isFavorite(list, id) {
    return Array.isArray(list) && list.some(function (x) { return x && x.id === id; });
  }

  return {
    filterAndSortEstimates: filterAndSortEstimates,
    formatEta: formatEta,
    extractPatternInfo: extractPatternInfo,
    normalize: normalize,
    searchStops: searchStops,
    matchTarget: matchTarget,
    safeParseJSON: safeParseJSON,
    upsertRecent: upsertRecent,
    resolveInitialStop: resolveInitialStop,
    resolveTarget: resolveTarget,
    haversineKm: haversineKm,
    sortStopsByDistance: sortStopsByDistance,
    classifyFetchError: classifyFetchError,
    formatAgo: formatAgo,
    toggleFavorite: toggleFavorite,
    isFavorite: isFavorite
  };
});
