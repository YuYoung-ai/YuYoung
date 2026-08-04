// BAZ BIOMEDIC CS Field Tools - Service Worker
// 오프라인 사용을 위한 캐시.
// ★ 파일을 수정해 새로 배포할 때마다 아래 CACHE_VERSION 숫자를 반드시 올리세요. ★
//   (버전을 올리지 않으면 폰이 옛 버전을 계속 사용합니다)
const CACHE_VERSION = 'baz-cs-v115';

// 프리캐시(설치 시 미리 받는 파일) — "셸 최소 구성"만 둔다.
// ★ 여기에 큰 파일을 추가하지 마세요. 버전을 올릴 때마다 전 사용자가 전량 재다운로드합니다. ★
//   각 도구 페이지(inspection·hospital·guide…)와 폰트는 첫 방문 시 자동으로 런타임 캐시되므로
//   오프라인 사용에는 지장이 없고, 업데이트 시 불필요한 대용량 재다운로드만 사라집니다.
const ASSETS = [
  './',
  './index.html',
  './auth.js',          // 서버 인증 공통 라이브러리 (필수)
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// 내용이 바뀌지 않는 자산 → 캐시 우선(있으면 네트워크를 타지 않음)
// 폰트(2MB)·아이콘·로고가 재방문마다 다시 내려오는 것을 막는다.
const IMMUTABLE = /\/(fonts\/|logo\.png|icon-192\.png|icon-512\.png)/;

// ※ 네트워크 우선 요청에 "타임아웃 후 캐시 표시"는 의도적으로 넣지 않는다.
//    느린 회선에서 옛 HTML이 표시되어 배포 직후 이전 화면이 보이는 문제가 생기기 때문.
//    (오프라인·연결 실패는 fetch가 즉시 실패하므로 아래 catch에서 캐시로 처리된다)

// 설치: 셸 파일만 캐시에 저장하고 즉시 활성화 대기 해제
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

// 같은 출처의 200 응답만 캐시에 갱신
function putCache(request, res) {
  if (res && res.status === 200 && request.url.startsWith(self.location.origin)) {
    const copy = res.clone();
    caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
  }
  return res;
}

// 요청 처리
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Apps Script(인증/데이터 서버) 요청은 절대 캐시하지 않는다.
  // 캐시되면 옛 인증 응답이 재사용되어 로그인이 꼬일 수 있다.
  if (req.url.includes('script.google.com') ||
      req.url.includes('script.googleusercontent.com')) {
    event.respondWith(fetch(req));
    return;
  }

  // ① 불변 자산: 캐시 우선 (폰트·아이콘·로고)
  if (IMMUTABLE.test(req.url)) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached || fetch(req).then((res) => putCache(req, res))
      )
    );
    return;
  }

  const isNav = req.mode === 'navigate';

  // ② 그 외: 네트워크 우선(항상 최신) → 실패 시에만 캐시로 폴백
  event.respondWith(
    fetch(req)
      .then((res) => putCache(req, res))
      .catch(() =>
        caches.match(req).then((cached) => {
          if (cached) return cached;
          if (isNav) return caches.match('./index.html');
          // ★ 내비게이션이 아닌 요청(JSON·스크립트·이미지)에 HTML을 돌려주면
          //   파싱 오류·빈 화면 등 오작동을 유발하므로 그대로 실패시킨다.
          return Response.error();
        })
      )
  );
});
