/************************************************************
 * sw.js — v2 서비스워커 (PWA_SPEC)
 * 스코프 /autodoc/v2/ — v1·루트 SW 와 무간섭.
 * 앱 셸 precache · API POST 패스스루 · 작성 보호 업데이트.
 ************************************************************/
const V2_CACHE = 'ad2-cache-v1';
const SHELL = [
  './index.html', './app.html',
  './css/tokens.css', './css/app.css',
  './js/infra/config.js', './js/infra/logger.js', './js/infra/bus.js',
  './js/infra/flags.js', './js/infra/idb.js', './js/infra/workspace-context.js',
  './js/infra/auth.js', './js/infra/sync-queue.js', './js/infra/store.js',
  './js/infra/router.js', './js/infra/selfcheck.js',
  './manifest.json',
];

self.addEventListener('install', (e) => {
  // skipWaiting 하지 않음 — 작성 중 강제 교체 방지
  e.waitUntil(caches.open(V2_CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k.startsWith('ad2-cache-') && k !== V2_CACHE).map(k => caches.delete(k)))
  ));
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // API POST 는 캐시하지 않음(패스스루)
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 외부(CDN)는 런타임 캐시 대상 아님(S6)
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(V2_CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
