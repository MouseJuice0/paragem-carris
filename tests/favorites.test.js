const test = require("node:test");
const assert = require("node:assert/strict");
const lib = require("../lib.js");

// ---------- toggleFavorite ----------

test("toggleFavorite: 没收藏过时,加进列表", () => {
  const out = lib.toggleFavorite([], { id: "150009", name: "X" });
  assert.deepEqual(out.map(x => x.id), ["150009"]);
});

test("toggleFavorite: 已经收藏过时,再点一次就移除", () => {
  const list = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
  const out = lib.toggleFavorite(list, { id: "a", name: "A" });
  assert.deepEqual(out.map(x => x.id), ["b"]);
});

test("toggleFavorite: 不会重复插入同一个id", () => {
  const list = [{ id: "a", name: "A" }];
  const out = lib.toggleFavorite(list, { id: "b", name: "B" });
  assert.equal(out.filter(x => x.id === "b").length, 1);
  assert.equal(out.length, 2);
});

test("toggleFavorite: 非数组输入不崩溃", () => {
  const out = lib.toggleFavorite(null, { id: "a", name: "A" });
  assert.deepEqual(out.map(x => x.id), ["a"]);
});

// ---------- isFavorite ----------

test("isFavorite: 在列表里返回true", () => {
  assert.equal(lib.isFavorite([{ id: "a" }, { id: "b" }], "b"), true);
});

test("isFavorite: 不在列表里返回false", () => {
  assert.equal(lib.isFavorite([{ id: "a" }], "z"), false);
});

test("isFavorite: 非数组输入返回false,不崩溃", () => {
  assert.equal(lib.isFavorite(null, "a"), false);
  assert.equal(lib.isFavorite(undefined, "a"), false);
});
