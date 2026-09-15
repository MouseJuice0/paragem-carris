const test = require("node:test");
const assert = require("node:assert/strict");
const lib = require("../lib.js");

// ---------- haversineKm ----------

test("haversineKm: 同一个点距离为0", () => {
  assert.equal(lib.haversineKm(38.5724, -9.0375, 38.5724, -9.0375), 0);
});

test("haversineKm: 里斯本到波尔图大约270公里量级(粗略健康检查,不是精确值)", () => {
  // 里斯本 38.7223,-9.1393  波尔图 41.1579,-8.6291
  var d = lib.haversineKm(38.7223, -9.1393, 41.1579, -8.6291);
  assert.ok(d > 260 && d < 290, "算出来是 " + d + " km,跟已知的~274km差太多");
});

test("haversineKm: 具有对称性(A到B等于B到A)", () => {
  var d1 = lib.haversineKm(38.57, -9.03, 38.58, -9.05);
  var d2 = lib.haversineKm(38.58, -9.05, 38.57, -9.03);
  assert.equal(d1, d2);
});

// ---------- sortStopsByDistance ----------

const FIXTURE = [
  { id: "near", name: "Perto",  lat: 38.5730, lon: -9.0380 },
  { id: "mid",  name: "Médio",  lat: 38.6000, lon: -9.0500 },
  { id: "far",  name: "Longe",  lat: 41.1579, lon: -8.6291 }
];
const HERE = { lat: 38.5724, lon: -9.0375 }; // 跟 "near" 几乎同一个点

test("sortStopsByDistance: 按距离从近到远排序", () => {
  var out = lib.sortStopsByDistance(FIXTURE, HERE.lat, HERE.lon);
  assert.deepEqual(out.map(s => s.id), ["near", "mid", "far"]);
});

test("sortStopsByDistance: 每条结果都带上 distanceKm,且单调递增", () => {
  var out = lib.sortStopsByDistance(FIXTURE, HERE.lat, HERE.lon);
  for (var i = 1; i < out.length; i++) {
    assert.ok(out[i].distanceKm >= out[i - 1].distanceKm);
  }
  assert.ok(out[0].distanceKm < 1, "最近的一个应该在1公里以内");
});

test("sortStopsByDistance: 不修改原始数组里的对象(不带distanceKm污染原数据)", () => {
  var out = lib.sortStopsByDistance(FIXTURE, HERE.lat, HERE.lon);
  assert.equal(FIXTURE[0].distanceKm, undefined);
  assert.ok(out[0].distanceKm !== undefined);
});

test("sortStopsByDistance: limit生效", () => {
  var out = lib.sortStopsByDistance(FIXTURE, HERE.lat, HERE.lon, 1);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "near");
});

test("sortStopsByDistance: 非数组输入不崩溃", () => {
  assert.deepEqual(lib.sortStopsByDistance(null, 0, 0), []);
});

// ---------- classifyFetchError ----------

test("classifyFetchError: 5xx归类为官方服务器故障(今天实测过 HTTP 500 是Carris自己的bug)", () => {
  const r = lib.classifyFetchError("HTTP 500");
  assert.equal(r.isServerError, true);
  assert.match(r.explanation, /Carris/);
});

test("classifyFetchError: 4xx不归类为服务器故障", () => {
  assert.equal(lib.classifyFetchError("HTTP 404").isServerError, false);
});

test("classifyFetchError: 非HTTP错误(比如断网)归类为网络问题", () => {
  const r = lib.classifyFetchError("Failed to fetch");
  assert.equal(r.isServerError, false);
  assert.match(r.explanation, /ligação/);
});

// ---------- formatAgo ----------

test("formatAgo: 60秒以内显示秒数", () => {
  assert.equal(lib.formatAgo(0), "há 0s");
  assert.equal(lib.formatAgo(45), "há 45s");
  assert.equal(lib.formatAgo(59.4), "há 59s");
});

test("formatAgo: 60秒及以上显示分钟数(四舍五入)", () => {
  assert.equal(lib.formatAgo(60), "há 1 min");
  assert.equal(lib.formatAgo(89), "há 1 min");
  assert.equal(lib.formatAgo(91), "há 2 min");
  assert.equal(lib.formatAgo(600), "há 10 min");
});

test("formatAgo: 负数不崩溃,当作0处理", () => {
  assert.equal(lib.formatAgo(-5), "há 0s");
});
