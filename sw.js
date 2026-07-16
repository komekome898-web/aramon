// ファイルを更新するたびに、このバージョン番号を必ず上げてください。
// (例: v2 -> v3 -> v4 ...) 番号を上げないと、ユーザーの端末に古いキャッシュが
// 残り続け、更新した内容が反映されません。
const CACHE_NAME = 'aramon-cache-v118';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Firebase等の外部通信はキャッシュせずそのまま通す
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    // ネットワークを優先し、成功したら常に最新をキャッシュへ保存。
    // オフライン/通信失敗時のみキャッシュを使う(古い内容が優先表示されるのを防ぐ)。
    fetch(event.request)
      .then((networkRes) => {
        if (networkRes && networkRes.ok) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkRes;
      })
      .catch(() => caches.match(event.request))
  );
});
