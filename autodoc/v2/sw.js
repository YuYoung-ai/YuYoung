/************************************************************
 * sw.js — v2 서비스워커 (PWA_SPEC)
 * 스코프 /autodoc/v2/ — v1·루트 SW 와 무간섭.
 * 전략: stale-while-revalidate — 캐시가 있으면 즉시 응답하고
 *       백그라운드에서 갱신(다음 방문에 반영). 캐시가 없으면 네트워크.
 *       (기존 network-first 는 캐시된 자산도 매번 네트워크를 기다려
 *        느린 회선에서 접속이 수십 초 걸리는 원인이었음)
 * 새 SW 즉시 활성(skipWaiting/claim) — 입력은 Draft 자동저장이 보호.
 ************************************************************/
const V2_CACHE = 'ad2-cache-v3';
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

  // stale-while-revalidate: 캐시 즉시 응답 + 백그라운드 갱신
  e.respondWith((async () => {
    const hit = await caches.match(req);
    const revalidate = fetch(req).then(res => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(V2_CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    });
    if (hit) { e.waitUntil(revalidate.catch(() => {})); return hit; }
    try { return await revalidate; }
    catch { return caches.match('./index.html'); }   // 앱 셸 최후 폴백
  })());
});
