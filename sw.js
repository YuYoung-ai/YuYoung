// BAZ BIOMEDIC CS Field Tools - Service Worker
// 오프라인 사용을 위한 캐시. 파일을 수정해 새로 배포할 때는 아래 CACHE_VERSION 숫자를 올리세요.
const CACHE_VERSION = 'baz-cs-v5';
const ASSETS = [
  './',
  './index.html',
  './guide.html',
  './survey.html',
  './inspection.html',
  './hospital.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// 설치: 모든 도구 파일을 캐시에 저장
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 활성화: 예전 버전 캐시 삭제
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 요청 처리: 네트워크 우선, 실패하면(오프라인) 캐시에서 제공
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // 새로 받은 내용을 캐시에 갱신 (같은 출처만)
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
