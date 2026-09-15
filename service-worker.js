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
      // 逐个缓存,而不是把整个清单一次性交给 addAll ——
      // 那种写法是"全部成功才算数",手机网络上一个文件抖一下就整批作废,
      // 导致缓存一直建不起来,每次打开都要重新下载全部资源。
      return Promise.all(
        SHELL_FILES.map(function (url) {
          return fetch(url)
            .then(function (res) {
              if (res && res.ok) return cache.put(url, res);
            })
            .catch(function () {
              // 这一个文件失败就跳过,不连累其他文件——下次fetch时的
              // stale-while-revalidate逻辑还会再试着把它补上
            });
        })
      );
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
