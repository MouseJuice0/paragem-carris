const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const APP_DIR = path.join(__dirname, "..");

function extractReferencedIds(jsSource) {
  const re = /getElementById\(\s*["']([^"']+)["']\s*\)/g;
  const ids = new Set();
  let m;
  while ((m = re.exec(jsSource)) !== null) {
    ids.add(m[1]);
  }
  return Array.from(ids);
}

function extractDefinedIds(htmlSource) {
  const re = /\bid="([^"]+)"/g;
  const ids = new Set();
  let m;
  while ((m = re.exec(htmlSource)) !== null) {
    ids.add(m[1]);
  }
  return ids;
}

test("app.js里 getElementById 引用的每个ID,都真的存在于index.html里", () => {
  const js = fs.readFileSync(path.join(APP_DIR, "app.js"), "utf8");
  const html = fs.readFileSync(path.join(APP_DIR, "index.html"), "utf8");

  const referenced = extractReferencedIds(js);
  const defined = extractDefinedIds(html);

  assert.ok(referenced.length > 0, "没有从app.js里提取到任何getElementById引用,正则可能失效了");

  const missing = referenced.filter((id) => !defined.has(id));
  assert.deepEqual(missing, [], "index.html里缺少这些ID: " + missing.join(", "));
});

test("index.html里不再残留旧版本的 #stopSelect / .picker(Phase4b已经替换成搜索式选择器)", () => {
  const html = fs.readFileSync(path.join(APP_DIR, "index.html"), "utf8");
  const js = fs.readFileSync(path.join(APP_DIR, "app.js"), "utf8");
  assert.doesNotMatch(html, /id="stopSelect"/);
  assert.doesNotMatch(js, /stopSelect/);
});
