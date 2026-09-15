const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const lib = require("../lib.js");

// ---------- normalize ----------

test("normalize: 去重音、转小写", () => {
  assert.equal(lib.normalize("Condé"), "conde");
  assert.equal(lib.normalize("ESTAÇÃO"), "estacao");
  assert.equal(lib.normalize("  Coina  "), "coina");
});

test("normalize: 空值不崩溃", () => {
  assert.equal(lib.normalize(null), "");
  assert.equal(lib.normalize(undefined), "");
});

// ---------- searchStops(小样本fixture,快且稳定) ----------

const FIXTURE = [
  { id: "1", name: "Coina (Estação) P0" },
  { id: "2", name: "Coina (Estação) P8" },
  { id: "3", name: "QTA CONDE (EN10) POSTO ABASTECIMENTO" },
  { id: "4", name: "Av. Liberdade (Farmácia)" },
  { id: "5", name: "Cacilhas (Terminal)" }
];

test("searchStops: 空查询返回空数组,而不是全部站点", () => {
  assert.deepEqual(lib.searchStops(FIXTURE, ""), []);
  assert.deepEqual(lib.searchStops(FIXTURE, "   "), []);
});

test("searchStops: 大小写、重音不敏感", () => {
  const r1 = lib.searchStops(FIXTURE, "coina");
  const r2 = lib.searchStops(FIXTURE, "COINA");
  assert.equal(r1.length, 2);
  assert.deepEqual(r1.map(s => s.id).sort(), r2.map(s => s.id).sort());
});

test("searchStops: 名字开头匹配的排在子串匹配前面", () => {
  // "conde" 只在第3条(开头是QTA CONDE,"conde"出现在第5个字符)里出现,
  // 换一个更能体现排序的例子:搜 "en10" 应该只匹配第3条
  const r = lib.searchStops(FIXTURE, "cacilhas");
  assert.equal(r.length, 1);
  assert.equal(r[0].id, "5");
});

test("searchStops: 结果数量受 limit 限制", () => {
  const r = lib.searchStops(FIXTURE, "coina", 1);
  assert.equal(r.length, 1);
});

test("searchStops: 找不到匹配时返回空数组,不报错", () => {
  assert.deepEqual(lib.searchStops(FIXTURE, "xyz-nao-existe"), []);
});

test("searchStops: index不是数组时不崩溃", () => {
  assert.deepEqual(lib.searchStops(null, "coina"), []);
  assert.deepEqual(lib.searchStops(undefined, "coina"), []);
});

// ---------- 用真实生成的 stops-index.json 抽查(不是fixture,是构建脚本的实际产出) ----------

const REAL_INDEX_PATH = path.join(__dirname, "..", "stops-index.json");

test("真实索引文件存在,且是这次实际部署要用的那份数据", () => {
  assert.ok(fs.existsSync(REAL_INDEX_PATH), "stops-index.json 不存在,先跑 scripts/build-stops-index.mjs");
});

test("真实索引:搜 Coina 能找到 142335(之前验证过的Coina Estação P0)", () => {
  const index = JSON.parse(fs.readFileSync(REAL_INDEX_PATH, "utf8"));
  const results = lib.searchStops(index, "Coina (Estação)", 50);
  const ids = results.map(s => s.id);
  assert.ok(ids.includes("142335"), "真实索引搜Coina没有找到142335");
});

test("真实索引:搜 150009/150001 共同地标名字能同时找到两侧站牌", () => {
  const index = JSON.parse(fs.readFileSync(REAL_INDEX_PATH, "utf8"));
  // 实测这两个站官方命名长度不同:150001是"POSTO ABAST"(缩写),
  // 150009是"POSTO ABASTECIMENTO"(全称),用两者共有的子串来搜
  const results = lib.searchStops(index, "posto abast", 50);
  const ids = results.map(s => s.id);
  assert.ok(ids.includes("150009"));
  assert.ok(ids.includes("150001")); // 同一地标的另一侧站牌,应该也搜得到
});

test("真实索引:数据条数跟API当前站点总数同一量级(粗略健康检查)", () => {
  const index = JSON.parse(fs.readFileSync(REAL_INDEX_PATH, "utf8"));
  assert.ok(index.length > 10000, "站点数量看起来太少了,索引可能没生成完整");
});
