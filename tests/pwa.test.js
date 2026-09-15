const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const APP_DIR = path.join(__dirname, "..");

function readManifest() {
  const raw = fs.readFileSync(path.join(APP_DIR, "manifest.json"), "utf8");
  return JSON.parse(raw);
}

// PNG文件头(前8字节签名 + IHDR chunk)里直接读宽高,不用装图片库
function readPngSize(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("不是合法的PNG文件: " + filePath);
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function readShellFiles() {
  const sw = fs.readFileSync(path.join(APP_DIR, "service-worker.js"), "utf8");
  const match = sw.match(/SHELL_FILES\s*=\s*(\[[\s\S]*?\])/);
  assert.ok(match, "在 service-worker.js 里找不到 SHELL_FILES 数组");
  return JSON.parse(match[1]);
}

// ---------- manifest.json ----------

test("manifest.json 是合法JSON", () => {
  assert.doesNotThrow(() => readManifest());
});

test("manifest.json 必需字段齐全,且 display 是 standalone", () => {
  const m = readManifest();
  ["name", "short_name", "start_url", "display", "background_color", "theme_color", "icons"]
    .forEach((key) => assert.ok(m[key] !== undefined, "manifest缺少字段: " + key));
  assert.equal(m.display, "standalone");
});

test("manifest.json 至少各有一个 any 和 maskable 图标(Android自适应图标需要)", () => {
  const m = readManifest();
  const purposes = m.icons.map((i) => i.purpose);
  assert.ok(purposes.includes("any"), "缺少 purpose=any 的图标");
  assert.ok(purposes.includes("maskable"), "缺少 purpose=maskable 的图标");
});

test("manifest.json 声明的每个图标文件都存在,且实际像素尺寸与声明一致", () => {
  const m = readManifest();
  m.icons.forEach((icon) => {
    const fullPath = path.join(APP_DIR, icon.src);
    assert.ok(fs.existsSync(fullPath), "图标文件不存在: " + icon.src);
    const { width, height } = readPngSize(fullPath);
    const [declaredW, declaredH] = icon.sizes.split("x").map(Number);
    assert.equal(width, declaredW, icon.src + " 实际宽度与manifest声明不符");
    assert.equal(height, declaredH, icon.src + " 实际高度与manifest声明不符");
  });
});

// ---------- service-worker.js 缓存清单 ----------

test("SHELL_FILES 里列出的每个文件都真实存在于磁盘上", () => {
  const list = readShellFiles();
  list.forEach((rel) => {
    if (rel === "./") return; // 根路径交给托管平台处理,不是磁盘上的具体文件
    const fullPath = path.join(APP_DIR, rel);
    assert.ok(fs.existsSync(fullPath), "缓存清单里的文件在磁盘上不存在: " + rel);
  });
});

test("核心App壳文件都被加入了离线缓存清单(防止忘记加新文件)", () => {
  const list = readShellFiles();
  const mustHave = [
    "./index.html", "./style.css", "./lib.js", "./app.js", "./manifest.json",
    "./stops-index.json",
    "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png"
  ];
  mustHave.forEach((f) => assert.ok(list.includes(f), "核心文件没有加入离线缓存清单: " + f));
});

test("service-worker.js 对API请求直接放行,不拦截缓存", () => {
  const sw = fs.readFileSync(path.join(APP_DIR, "service-worker.js"), "utf8");
  assert.match(sw, /api\.carrismetropolitana\.pt/, "service worker里应该有针对API域名的放行逻辑");
});

// ---------- index.html 接线是否正确 ----------

test("index.html 正确引用了 manifest 和两个脚本文件", () => {
  const html = fs.readFileSync(path.join(APP_DIR, "index.html"), "utf8");
  assert.match(html, /<link rel="manifest" href="manifest\.json">/);
  assert.match(html, /<script src="lib\.js"><\/script>/);
  assert.match(html, /<script src="app\.js"><\/script>/);
});

test("app.js 里有 Service Worker 注册逻辑", () => {
  const js = fs.readFileSync(path.join(APP_DIR, "app.js"), "utf8");
  assert.match(js, /serviceWorker/);
  assert.match(js, /register\(\s*["']service-worker\.js["']\s*\)/);
});
