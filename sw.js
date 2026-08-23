// ファイルを更新するたびに、このバージョン番号を必ず上げてください。
// (例: v2 -> v3 -> v4 ...) 番号を上げないと、ユーザーの端末に古いキャッシュが
// 残り続け、更新した内容が反映されません。
const CACHE_NAME = 'aramon-cache-v668';
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
// コード扱いにする拡張子(これ以外=素材はMEDIA_CACHEへ行く)
const CODE_RE = /\.(html|js|mjs|css|json)$/i;

/* ===== インストール時にコード一式を先読みする =====
   「新版に入れ替わった直後の1回だけ起動が遅い」をなくすため、新しいSWのインストール中に
   js/cssを**まとめて**取ってキャッシュへ入れる。読み込んでいる本人(ページ)は既に同じ物を
   取得中なのでブラウザのHTTPキャッシュに当たり、追加の通信はほとんど発生しない。
   **一覧を手で持たない** ── index.htmlを読んで src= / href= / import() を拾う。
   スクリプトタグを足せば自動で先読みの対象になる(追記漏れという事故が起きない)。 */
function precacheUrlsFromIndex(cache){
  return fetch('./index.html', { cache: 'no-store' }).then((res) => {
    if(!res || !res.ok) return null;
    return res.text().then((html) => {
      const urls = new Set(CORE_ASSETS);
      const add = (raw) => {
        if(!raw) return;
        // 外部(フォント・CDN)・data:・アンカーは対象外。SW自身も入れない(下のisBypass参照)
        if(/^(https?:)?\/\//.test(raw) || /^(data|blob|mailto):/.test(raw) || raw.startsWith('#')) return;
        const u = new URL(raw, self.location.href);
        if(u.origin !== self.location.origin) return;
        if(!CODE_RE.test(u.pathname) || /\/sw\.js$/.test(u.pathname)) return;
        urls.add(u.href);
      };
      let m;
      const attrRe = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
      while((m = attrRe.exec(html))) add(m[1]);
      // インラインの動的import(firebase.jsはここからしか参照されていない)
      const impRe = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
      while((m = impRe.exec(html))) add(m[1]);
      // 1つ失敗しても他は入れる(addAllは全部まとめて捨ててしまう)。
      // 先読みは「速くなるだけ」の処理なので、失敗しても後からfetchハンドラが拾う。
      return Promise.all([...urls].map((u) =>
        fetch(u).then((r) => (r && r.ok && r.status === 200) ? cache.put(u, r.clone()) : null).catch(()=>{})
      ));
    });
  }).catch(()=>{});
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(CORE_ASSETS).catch(()=>{}).then(() => precacheUrlsFromIndex(cache))
    ).catch(()=>{})
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

/* コード(html/js/css/json): stale-while-revalidate
   以前はネットワーク優先だったので、**オンラインである限り毎回2.5MBを取り直していた**
   (ui.js 592KB / render.js 387KB / audio.js 385KB / data.js 343KB / style.css 333KB …)。
   ホーム画面から開いても毎回そのぶん待たされるので、素材と同じ扱いへ変える。

   【古いまま張り付かない根拠】キャッシュ名にバージョンが入っていて(CACHE_NAME)、
   コードは**そのバージョンのキャッシュにしか入らない**。コミットのたびに番号を上げる運用なので、
   新しいSWがactivateした時点で上の activate ハンドラが古い世代のキャッシュを丸ごと削除し、
   次の取得はネットワークから入り直す。つまり「1世代ぶん古い物が1回だけ出る」以上には絶対にならない。
   さらに保険として、ここで**毎回ネットワークへ確認**し(304なら数百バイト)、
   受け取った新しい中身をキャッシュへ上書きする。万一バージョンを上げ忘れても、
   次の起動には新しい中身になる ── どちらか一方が効いていれば張り付かない二重の作りにしてある。 */
function codeResponse(request) {
  return caches.open(CACHE_NAME).then((cache) =>
    cache.match(request).then((cached) => {
      /* 裏の取り直しは**cacheオプションを付けない**(=ブラウザのHTTPキャッシュに従う)。
         no-storeにすると条件付きGETが効かず、毎回2.5MBを本当に落としてしまい意味がなくなる。
         付けなければ ETag / Last-Modified で 304 が返り、変わった物だけが実際に流れる。 */
      const network = fetch(request).then((res) => {
        // 206(部分取得)や opaque はキャッシュに入れない(壊れた内容を配り続けるため)
        if (res && res.ok && res.status === 200 && res.type !== 'opaque') cache.put(request, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
}

/* キャッシュを一切通さないもの。
   ・sw.js 自身 … index.htmlがバージョン表記のために読んでいる。ここを古い値で返すと
     画面のバージョン表示と「🔄 更新」の告知が嘘になる(告知の仕組みを壊さないため必須)。
   ・cache:'no-store'/'reload' 指定の取得 … 呼び出し側が「必ず最新を」と言っているもの。 */
function isBypass(request, pathname) {
  if (/(^|\/)sw\.js$/.test(pathname)) return true;
  const mode = request.cache;   // 古い実装では undefined になるが、その場合も上の判定で足りる
  return mode === 'no-store' || mode === 'reload';
}

self.addEventListener('fetch', (event) => {
  // Firebase等の外部通信はキャッシュせずそのまま通す
  if (!event.request.url.startsWith(self.location.origin)) return;
  if (event.request.method !== 'GET') return;

  const pathname = new URL(event.request.url).pathname;
  if (isBypass(event.request, pathname)) return;

  if (MEDIA_RE.test(pathname)) {
    event.respondWith(mediaResponse(event.request));
    return;
  }

  event.respondWith(codeResponse(event.request));
});
