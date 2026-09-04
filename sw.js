// BAZ BIOMEDIC CS Field Tools - Service Worker
// 오프라인 사용을 위한 캐시.
// ★ 파일을 수정해 새로 배포할 때마다 아래 CACHE_VERSION 숫자를 반드시 올리세요. ★
//   (버전을 올리지 않으면 폰이 옛 버전을 계속 사용합니다)
const CACHE_VERSION = 'baz-cs-v181';

// 프리캐시(설치 시 미리 받는 파일) — "셸 최소 구성"만 둔다.
// ★ 여기에 큰 파일을 추가하지 마세요. 버전을 올릴 때마다 전 사용자가 전량 재다운로드합니다. ★
//   각 도구 페이지(inspection·hospital·guide…)와 폰트는 첫 방문 시 자동으로 런타임 캐시되므로
//   오프라인 사용에는 지장이 없고, 업데이트 시 불필요한 대용량 재다운로드만 사라집니다.
//   ※ js/baz-*.js(hospital-pc 공용 모듈)도 같은 이유로 프리캐시하지 않습니다.
//     아래 fetch 처리가 네트워크 우선 → 실패 시 캐시이므로, 페이지를 한 번 열면
//     함께 런타임 캐시되어 오프라인에서도 동작하고 배포 직후에는 항상 최신을 받습니다.
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

// VOC 유형별 대표 사진 중 "내용 해시 파일명"만 불변으로 본다.
//   assets/type-examples/media/<sha256 앞 12자리>.webp
// 내용이 바뀌면 파일명이 바뀌므로 캐시 우선이어도 옛 사진이 남지 않는다.
// 첫 요청 이후에는 오프라인에서도 그대로 다시 쓸 수 있다.
// ★ 프리캐시(ASSETS)에는 절대 넣지 않는다 — 배포마다 전 사용자가 사진을 전량 재다운로드한다.
//   기존 폴더(equipment-*·handpiece-*)의 사진과 index.json 은 해시 파일명이 아니므로
//   지금처럼 네트워크 우선으로 둔다(교체 즉시 반영되어야 한다).
const TYPE_EXAMPLE_IMMUTABLE = /\/assets\/type-examples\/media\/[0-9a-f]{12}\.webp$/;
// 짧은 예시 영상은 최대 5MB라 CacheStorage에 쌓지 않는다. 브라우저 HTTP 캐시는 사용할 수 있지만
// 서비스워커 프리캐시·런타임 캐시에서는 제외해 저장공간 증가와 Range 응답(206) 문제를 피한다.
const TYPE_EXAMPLE_VIDEO = /\/assets\/type-examples\/media\/[0-9a-f]{12}\.mp4$/;

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

  // 정적 MP4: GAS와 무관한 직접 요청. 사용자 재생 시에만 네트워크로 받고 CacheStorage에는 넣지 않는다.
  if (TYPE_EXAMPLE_VIDEO.test(new URL(req.url).pathname)) {
    event.respondWith(fetch(req));
    return;
  }

  // ① 불변 자산: 캐시 우선 (폰트·아이콘·로고 + 내용 해시 대표 사진)
  if (IMMUTABLE.test(req.url) || TYPE_EXAMPLE_IMMUTABLE.test(new URL(req.url).pathname)) {
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
          // 오프라인 내비게이션만: 쿼리스트링이 붙은 주소(hospital-pc.html?hosp=…)는
          // 정확 일치 캐시가 없다. 같은 경로의 캐시가 있으면 그것을 돌려준다.
          // ★ ignoreSearch 는 "네트워크 실패 후"에만 쓴다 — 온라인에서는 위의 네트워크
          //   우선 경로가 항상 먼저 실행되므로 구버전 HTML 이 반환되지 않는다.
          if (isNav) {
            return caches.match(req, { ignoreSearch: true })
              .then((samePath) => samePath || caches.match('./index.html'));
          }
          // ★ 내비게이션이 아닌 요청(JSON·스크립트·이미지)에 HTML을 돌려주면
          //   파싱 오류·빈 화면 등 오작동을 유발하므로 그대로 실패시킨다.
          return Response.error();
        })
      )
  );
});
