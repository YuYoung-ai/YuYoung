/************************************************************
 * sw.js — v2 서비스워커 (PWA_SPEC)
 * 스코프 /autodoc/v2/ — v1·루트 SW 와 무간섭.
 * 전략: network-first(성공 시 캐시 갱신 → 항상 최신 빌드),
 *       실패(오프라인) 시 캐시 폴백 → 오프라인 작성 보장 유지.
 * 새 SW 즉시 활성(skipWaiting/claim) — 입력은 Draft 자동저장이 보호.
 ************************************************************/
const V2_CACHE = 'ad2-cache-v2';
const SHELL = [
  './index.html', './app.html',
  './css/tokens.css', './css/app.css',
  './js/infra/config.js', './js/infra/logger.js', './js/infra/bus.js',
  './js/infra/flags.js', './js/infra/idb.js', './js/infra/workspace-context.js',
  './js/infra/auth.js', './js/infra/sync-queue.js', './js/infra/store.js',
  './js/infra/router.js', './js/infra/selfcheck.js', './js/infra/api.js',
  './js/core/json-schema.js', './js/core/validator.js', './js/core/draft.js',
  './js/core/form-engine.js', './js/core/template-service.js',
  './js/ui/dom.js', './js/ui/screens/catalog.js', './js/ui/screens/editor.js',
  './templates/weekly-report.json', './templates/meeting-minutes.json', './templates/trip-report.json',
  './js/core/engine-bridge.js', './js/core/document-engine.js',
  './js/core/preview-engine.js', './js/core/history.js',
  './js/ui/screens/docs.js', './themes/company-default.json',
  './js/core/undo.js', './js/core/memory-suggest.js',
  './js/core/prompt-engine.js', './js/core/import-gate.js', './js/core/confidence.js', './js/core/learning.js',
  './js/ui/screens/admin.js', './js/ui/screens/import-wizard.js', './js/ui/screens/approvals.js', './js/ui/screens/learning-status.js',
  './js/core/prefs.js', './js/infra/sync-boot.js', './js/ui/screens/settings.js',
  './manifest.json',
];

self.addEventListener('install', (e) => {
  // 오프라인 보장을 위한 precache + 즉시 대기 해제(구버전에 갇히지 않게)
  e.waitUntil(
    caches.open(V2_CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('ad2-cache-') && k !== V2_CACHE).map(k => caches.delete(k)));
    await self.clients.claim(); // 열린 탭도 즉시 새 SW 가 담당
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // API POST 는 패스스루(캐시 금지)
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;       // 외부(CDN)는 대상 아님

  // network-first: 최신 우선, 오프라인이면 캐시 폴백
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(V2_CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch {
      const hit = await caches.match(req);
      if (hit) return hit;
      return caches.match('./index.html');           // 앱 셸 최후 폴백
    }
  })());
});
