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

  return {
    filterAndSortEstimates: filterAndSortEstimates,
    formatEta: formatEta,
    extractPatternInfo: extractPatternInfo,
    matchTarget: matchTarget
  };
});
