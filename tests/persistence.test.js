const test = require("node:test");
const assert = require("node:assert/strict");
const lib = require("../lib.js");

// ---------- safeParseJSON ----------

test("safeParseJSON: 正常JSON能解析", () => {
  assert.deepEqual(lib.safeParseJSON('{"a":1}', null), { a: 1 });
});

test("safeParseJSON: 损坏的JSON返回fallback,不抛异常", () => {
  assert.equal(lib.safeParseJSON("{not json", "FALLBACK"), "FALLBACK");
});

test("safeParseJSON: null/undefined直接返回fallback", () => {
  assert.equal(lib.safeParseJSON(null, "FALLBACK"), "FALLBACK");
  assert.equal(lib.safeParseJSON(undefined, "FALLBACK"), "FALLBACK");
});

// ---------- upsertRecent ----------

test("upsertRecent: 新项目放最前面", () => {
  const list = [{ id: "a" }, { id: "b" }];
  const out = lib.upsertRecent(list, { id: "c" });
  assert.deepEqual(out.map(x => x.id), ["c", "a", "b"]);
});

test("upsertRecent: 重复id会去重,移到最前面而不是出现两次", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const out = lib.upsertRecent(list, { id: "b" });
  assert.deepEqual(out.map(x => x.id), ["b", "a", "c"]);
});

test("upsertRecent: 超过maxLen会截断", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const out = lib.upsertRecent(list, { id: "d" }, 3);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map(x => x.id), ["d", "a", "b"]);
});

test("upsertRecent: 空列表/非数组输入不崩溃", () => {
  assert.deepEqual(lib.upsertRecent(null, { id: "a" }).map(x => x.id), ["a"]);
  assert.deepEqual(lib.upsertRecent(undefined, { id: "a" }).map(x => x.id), ["a"]);
});

// ---------- resolveInitialStop ----------

test("resolveInitialStop: 有存档时用存档", () => {
  const stored = { id: "150009", name: "X" };
  const fallback = { id: "999", name: "Y" };
  assert.deepEqual(lib.resolveInitialStop(stored, fallback), stored);
});

test("resolveInitialStop: 没存档(首次使用)时用种子默认值", () => {
  const fallback = { id: "999", name: "Y" };
  assert.deepEqual(lib.resolveInitialStop(null, fallback), fallback);
  assert.deepEqual(lib.resolveInitialStop(undefined, fallback), fallback);
});

// ---------- resolveTarget ----------

test("resolveTarget: 用户存过的设置优先于种子默认值", () => {
  const seed = { "150009": { id: "142335", name: "Coina (Estação)" } };
  const stored = { "150009": { id: "999999", name: "Outro Destino" } };
  assert.deepEqual(lib.resolveTarget(stored, "150009", seed), { id: "999999", name: "Outro Destino" });
});

test("resolveTarget: 用户显式清除过(存了null)时,不应该被种子默认值悄悄覆盖", () => {
  const seed = { "150009": { id: "142335", name: "Coina (Estação)" } };
  const stored = { "150009": null };
  assert.equal(lib.resolveTarget(stored, "150009", seed), null);
});

test("resolveTarget: 完全没配置过时,回退到种子默认值", () => {
  const seed = { "150009": { id: "142335", name: "Coina (Estação)" } };
  assert.deepEqual(lib.resolveTarget({}, "150009", seed), seed["150009"]);
  assert.deepEqual(lib.resolveTarget(null, "150009", seed), seed["150009"]);
});

test("resolveTarget: 站点既没存档也没种子默认值时返回null(不判断经过与否)", () => {
  assert.equal(lib.resolveTarget({}, "999", {}), null);
});
