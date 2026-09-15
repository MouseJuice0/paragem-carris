// Service Worker — 只负责缓存"App壳"(界面本身),不缓存实时到站数据。
// 缓存清单必须跟实际文件一一对应,Phase 2 的测试脚本会检查这件事。
const CACHE_NAME = "paragem-shell-v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./lib.js",
  "./app.js",
  "./manifest.json",
  "./stops-index.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_FILES);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names
          .filter(function (n) { return n !== CACHE_NAME; })
          .map(function (n) { return caches.delete(n); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);

  // 实时到站数据永远直连网络,绝不缓存——缓存到站时间就失去意义了。
  if (url.hostname === "api.carrismetropolitana.pt") {
    return;
  }

  // App壳资源:缓存优先返回(离线也能打开界面),同时在背后请求网络更新缓存。
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      var network = fetch(event.request)
        .then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, copy);
            });
          }
          return res;
        })
        .catch(function () { return cached; });
      return cached || network;
    })
  );
});
