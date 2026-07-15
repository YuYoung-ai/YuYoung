// BAZ BIOMEDIC CS Field Tools - Service Worker
// 오프라인 사용을 위한 캐시.
// ★ 파일을 수정해 새로 배포할 때마다 아래 CACHE_VERSION 숫자를 반드시 올리세요. ★
//   (버전을 올리지 않으면 폰이 옛 버전을 계속 사용합니다)
const CACHE_VERSION = 'baz-cs-v70';

const ASSETS = [
  './',
  './index.html',
  './auth.js',          // 서버 인증 공통 라이브러리 (필수)
  './guide.html',
  './hospital.html',
  './survey.html',
  './inspection.html',
  './handover.html',
  './dashboard.html',
  './chatbot.html',
  './weekly.html',
  './user_guide.html',
  './manifest.json',
  './logo.png',         // A/S 점검 내역서 PDF 로고 (오프라인 출력용)
  './icon-192.png',
  './icon-512.png'
];

// 설치: 모든 도구 파일을 캐시에 저장하고 즉시 활성화 대기 해제
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // 일부 파일이 없어도(404) 전체 설치가 실패하지 않도록 개별 처리
      .then((cache) => Promise.allSettled(ASSETS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

// 활성화: 예전 버전 캐시 삭제 후 즉시 모든 페이지 장악
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

  // Apps Script(인증/데이터 서버) 요청은 절대 캐시하지 않는다.
  // 캐시되면 옛 인증 응답이 재사용되어 로그인이 꼬일 수 있다.
  if (event.request.url.includes('script.google.com') ||
      event.request.url.includes('script.googleusercontent.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

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
