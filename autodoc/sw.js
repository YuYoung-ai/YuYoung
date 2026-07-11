// AutoDoc - Service Worker (기존 sw.js 패턴, /autodoc/ 스코프 전용)
// ★ 파일을 수정해 배포할 때마다 CACHE_VERSION 을 반드시 올리세요. ★
const CACHE_VERSION = 'autodoc-v2';

const ASSETS = [
  './',
  './index.html',
  './editor.html',
  './admin.html',
  './js/admin/admin.js',
  './js/engine/components/chart.js',
  './manifest.json',
  './css/base.css',
  './css/app.css',
  './js/core/config.js',
  './js/core/store.js',
  './js/core/bus.js',
  './js/core/services.js',
  './js/engine/theme-engine.js',
  './js/engine/layout-engine.js',
  './js/engine/document-model.js',
  './js/engine/components/registry.js',
  './js/engine/components/text.js',
  './js/engine/components/header.js',
  './js/engine/components/table.js',
  './js/engine/components/card.js',
  './js/engine/components/footer.js',
  './js/renderers/renderer-base.js',
  './js/renderers/ppt-renderer.js',
  './js/renderers/excel-renderer.js',
  './js/renderers/pdf-renderer.js',
  './js/providers/provider-base.js',
  './js/providers/gas-provider.js',
  './js/providers/local-provider.js',
  './js/providers/manual-provider.js',
  './js/form/form-generator.js',
  './js/form/validator.js',
  './js/ui/preview.js',
  './js/ui/toast.js',
  './templates/weekly-report.json',
  './templates/meeting-minutes.json',
  './templates/trip-report.json',
  './themes/company-default.json',
  '../auth.js',
  '../icon-192.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => Promise.allSettled(ASSETS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION && k.startsWith('autodoc-')).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Apps Script(인증/데이터 서버) 요청은 절대 캐시하지 않는다.
  if (event.request.url.includes('script.google.com') ||
      event.request.url.includes('script.googleusercontent.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 네트워크 우선, 실패 시(오프라인) 캐시 제공
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.status === 200 && event.request.url.startsWith(self.location.origin)) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match('./index.html'))
      )
  );
});
