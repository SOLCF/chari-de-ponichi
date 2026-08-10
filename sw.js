/* sw.js — オフライン動作のためのキャッシュ。
 *
 * 走行中に圏外へ入ってもアプリが落ちないことが目的。
 * ファイルを更新したら CACHE の版数を上げること（古いキャッシュが残り続ける）。
 */
var CACHE = 'chari-pon-ichi-v2';

var ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './data/japan.json',
  './js/geo.js',
  './js/japan.js',
  './js/format.js',
  './js/settings.js',
  './js/store.js',
  './js/goals.js',
  './js/tracker.js',
  './js/ui.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // 1つでも欠けると addAll 全体が失敗するので、個別に入れて欠損に強くする
      return Promise.all(ASSETS.map(function (url) {
        return cache.add(url).catch(function () { /* 無い資産は飛ばす */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // ネットワーク優先・キャッシュ代替。
  // 更新をすぐ拾いつつ、圏外ではキャッシュで動き続ける
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200 && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        // ナビゲーションの取りこぼしはトップページで受け止める
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});
