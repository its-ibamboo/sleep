/* 夜燈 service worker
   ── 版本號規則：只要換過 audio/ 裡的音檔或圖示，就把下面的版本號 +1，
      舊快取才會被清掉。只改 index.html 的話不用動（HTML 走 network-first）。 */
const VERSION = 'v10';
const CACHE = 'yedeng-' + VERSION;

const SHELL = [
  './',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .catch(() => null)
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* HTML 走 network-first：有網路一定拿最新版，沒網路才用快取。
   其他靜態檔走 cache-first，省流量。 */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  /* 登入相關的請求一律直接走網路，不進快取 */
  if (new URL(req.url).pathname.startsWith('/api/')) return;

  const isDoc = req.mode === 'navigate' ||
                (req.headers.get('accept') || '').includes('text/html');

  if (isDoc) {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.status === 200) {          /* 未登入會拿到 401，不能存 */
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => hit))
  );
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
