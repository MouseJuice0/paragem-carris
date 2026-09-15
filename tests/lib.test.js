const test = require("node:test");
const assert = require("node:assert/strict");
const lib = require("../lib.js");

// ---------- filterAndSortEstimates ----------

test("filterAndSortEstimates: 丢弃没有预计时间的记录", () => {
  const raw = [
    { estimatedTimeUnixSeconds: 100 },
    { estimatedTimeUnixSeconds: null },
    { estimatedTimeUnixSeconds: undefined },
    { }
  ];
  const out = lib.filterAndSortEstimates(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].estimatedTimeUnixSeconds, 100);
});

test("filterAndSortEstimates: 按时间升序排序", () => {
  const raw = [
    { estimatedTimeUnixSeconds: 300 },
    { estimatedTimeUnixSeconds: 100 },
    { estimatedTimeUnixSeconds: 200 }
  ];
  const out = lib.filterAndSortEstimates(raw);
  assert.deepEqual(out.map(d => d.estimatedTimeUnixSeconds), [100, 200, 300]);
});

test("filterAndSortEstimates: 默认最多保留8条", () => {
  const raw = Array.from({ length: 20 }, (_, i) => ({ estimatedTimeUnixSeconds: i }));
  const out = lib.filterAndSortEstimates(raw);
  assert.equal(out.length, 8);
  assert.equal(out[0].estimatedTimeUnixSeconds, 0);
  assert.equal(out[7].estimatedTimeUnixSeconds, 7);
});

test("filterAndSortEstimates: limit参数可自定义", () => {
  const raw = Array.from({ length: 5 }, (_, i) => ({ estimatedTimeUnixSeconds: i }));
  const out = lib.filterAndSortEstimates(raw, 3);
  assert.equal(out.length, 3);
});

test("filterAndSortEstimates: 非数组输入不报错,返回空数组", () => {
  assert.deepEqual(lib.filterAndSortEstimates(null), []);
  assert.deepEqual(lib.filterAndSortEstimates(undefined), []);
  assert.deepEqual(lib.filterAndSortEstimates("oops"), []);
});

// ---------- formatEta ----------

test("formatEta: 20秒以内显示 agora", () => {
  assert.equal(lib.formatEta(0).kind, "now");
  assert.equal(lib.formatEta(20).kind, "now");
  assert.equal(lib.formatEta(20).label, "agora");
});

test("formatEta: 20~60秒之间显示 <1 min", () => {
  const r = lib.formatEta(21);
  assert.equal(r.kind, "soon");
  assert.equal(r.label, "<1");
  assert.equal(r.unit, "min");
  assert.equal(lib.formatEta(59).kind, "soon");
});

test("formatEta: 60秒及以上按分钟数四舍五入", () => {
  assert.equal(lib.formatEta(60).label, "1");
  assert.equal(lib.formatEta(89).label, "1");   // 89s -> 1.48min -> 四舍五入 1
  assert.equal(lib.formatEta(91).label, "2");   // 91s -> 1.52min -> 四舍五入 2
  assert.equal(lib.formatEta(600).label, "10");
});

test("formatEta: 负数(理论上已过站)不崩溃,仍归为 now", () => {
  assert.equal(lib.formatEta(-5).kind, "now");
});

// ---------- extractPatternInfo ----------

test("extractPatternInfo: 处理数组包裹的响应(真实API的返回形态)", () => {
  const response = [{
    path: [
      { stop_id: "160747", stop_sequence: 1 },
      { stop_id: "150009", stop_sequence: 2 },
      { stop_id: "142335", stop_sequence: 3 }
    ]
  }];
  const info = lib.extractPatternInfo(response);
  assert.equal(info.terminusId, "142335");
  assert.deepEqual(info.pathIds, ["160747", "150009", "142335"]);
});

test("extractPatternInfo: 处理未包裹数组的响应", () => {
  const response = { path: [{ stop_id: "A" }, { stop_id: "B" }] };
  const info = lib.extractPatternInfo(response);
  assert.equal(info.terminusId, "B");
});

test("extractPatternInfo: 空path不崩溃", () => {
  const info = lib.extractPatternInfo({ path: [] });
  assert.equal(info.terminusId, null);
  assert.deepEqual(info.pathIds, []);
});

test("extractPatternInfo: 完全异常输入(null/缺字段)不崩溃", () => {
  assert.equal(lib.extractPatternInfo(null).terminusId, null);
  assert.equal(lib.extractPatternInfo({}).terminusId, null);
  assert.equal(lib.extractPatternInfo([]).terminusId, null);
});

// ---------- matchTarget ----------
// 用真实验证过的案例:150009站台,3626_0_2 真的到 Coina(142335),
// 3605_0_2 真的不到(实测path里没有142335)

test("matchTarget: 未配置目标站时返回 null(不该判断)", () => {
  assert.equal(lib.matchTarget(["142335"], null), null);
  assert.equal(lib.matchTarget(null, null), null);
});

test("matchTarget: 路径包含目标站 -> hit(真实案例:3626_0_2 到 Coina)", () => {
  const pathIds = ["150009", "140xxx", "142335"];
  assert.equal(lib.matchTarget(pathIds, "142335"), "hit");
});

test("matchTarget: 路径不包含目标站 -> miss(真实案例:3605_0_2 去Cacilhas,不经过Coina)", () => {
  const pathIds = ["150009", "030xxx", "020449"]; // 真实终点 020449,不含142335
  assert.equal(lib.matchTarget(pathIds, "142335"), "miss");
});

test("matchTarget: pathIds拉取失败(null) -> unknown", () => {
  assert.equal(lib.matchTarget(null, "142335"), "unknown");
});
