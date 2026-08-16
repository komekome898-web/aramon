// ファイルを更新するたびに、このバージョン番号を必ず上げてください。
// (例: v2 -> v3 -> v4 ...) 番号を上げないと、ユーザーの端末に古いキャッシュが
// 残り続け、更新した内容が反映されません。
const CACHE_NAME = 'aramon-cache-v609';
// 画像と音は「別のキャッシュ」に入れ、バージョンを上げても消さない。
// コード(html/js/css)だけが毎回入れ替わり、11MBの画像と5.7MBの音は貯めたまま使える。
const MEDIA_CACHE = 'aramon-media';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
];
// 中身が変わらない素材。ここに当たるものはキャッシュを即返し、裏で最新に入れ替える
const MEDIA_RE = /\.(png|jpg|jpeg|webp|gif|mp4|webm|mp3|m4a|aac|ogg|wav|woff2?)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      // 画像・音のキャッシュ(MEDIA_CACHE)は世代交代で消さない
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== MEDIA_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* 画像・音: stale-while-revalidate
   キャッシュがあれば即座に返して起動を待たせない。同時に裏で取り直してキャッシュを
   更新するので、素材を差し替えたときも次回の起動で自動的に新しくなる
   (バージョン番号を上げ忘れて古い画像が残り続ける、という事故が起きない)。      */
function mediaResponse(request) {
  return caches.open(MEDIA_CACHE).then((cache) =>
    cache.match(request).then((cached) => {
      // cache:'no-store' でブラウザのHTTPキャッシュ層も無視する。
      // (新しく追加した素材が、追加前に返った404をHTTPキャッシュとして
      //  引きずってしまい、いつまでも読み込めなくなる事故を防ぐため)
      const network = fetch(request, { cache: 'no-store' }).then((res) => {
        if (res && res.ok) cache.put(request, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
}

self.addEventListener('fetch', (event) => {
  // Firebase等の外部通信はキャッシュせずそのまま通す
  if (!event.request.url.startsWith(self.location.origin)) return;
  if (event.request.method !== 'GET') return;

  if (MEDIA_RE.test(new URL(event.request.url).pathname)) {
    event.respondWith(mediaResponse(event.request));
    return;
  }

  event.respondWith(
    // コードはネットワークを優先し、成功したら常に最新をキャッシュへ保存。
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
