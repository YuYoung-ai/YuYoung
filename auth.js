/************************************************************
 * BAZ BIOMEDIC CS PWA — 공통 인증 라이브러리 (auth.js)
 * ----------------------------------------------------------
 * 모든 화면(index/hospital/guide/survey)이 함께 사용합니다.
 * 비밀번호는 더 이상 이 코드에 없습니다. 서버(Apps Script)에
 * 비번을 보내 토큰을 받고, 토큰만 기기에 보관해서 사용합니다.
 *
 * 사용법(각 HTML에서):
 *   <script src="auth.js"></script>
 *   const r = await BazAuth.login(inputPassword);   // 로그인
 *   if (r.ok) { ... r.level ... }                    // level 1=일반, 2=관리자
 *   const lv = await BazAuth.currentLevel();         // 저장된 토큰의 현재 레벨(0=없음/만료)
 *   BazAuth.logout();                                // 로그아웃
 *
 * 페이지 접근 가드(자동):
 *   index.html 을 제외한 모든 페이지는 <head>에 이 파일을 넣는 것만으로
 *   토큰 존재·만료·권한 레벨을 검사하고, 미달이면 index.html 로 이동합니다.
 *   필요 레벨은 Google Sheet '메뉴설정' 탭(index.html이 localStorage에 캐시)을
 *   따르며, 새 페이지는 auth.js 로드 전에
 *     <script>window.BAZ_PAGE_MIN_LEVEL = 2;</script>
 *   로 최소 레벨을 직접 지정할 수도 있습니다(기본 1).
 ************************************************************/
(function (global) {
  'use strict';

  // ▼▼▼ 로그인 서버 주소 ▼▼▼
  // 콜드스타트 없는 Deno Deploy 로 옮기려면 이 한 줄만 Deno 주소로 교체한다(끝에 /exec 없음).
  //   예) var AUTH_URL = 'https://baz-auth.deno.dev';
  //   토큰 형식이 동일해 데이터 GAS·프런트는 무수정. 자세한 절차: deno-auth/README.md
  //   문제 시 아래 롤백용 GAS /exec 주소로 되돌리면 무중단 롤백(토큰 형식 동일).
  var AUTH_URL = 'https://yuyoung.yuyoung-ai.deno.net';   /* Deno Deploy 로그인 서버(콜드스타트 없음) */
  // 롤백용 GAS: 'https://script.google.com/macros/s/AKfycbykXiS7tXXx_nNuwXwQ--hgIXMrBSNdBPxOCn8b6H_zg9AWkbdLLqmF0Wn8L8zLaAI/exec'
  // ▲▲▲ Deno 사용 중 — 롤백 시 위 GAS /exec 로 교체 ▲▲▲

  var TOKEN_KEY = 'baz_auth_token';
  var LEVEL_KEY = 'baz_auth_level';
  var NAME_KEY  = 'baz_auth_name';
  var EXP_KEY   = 'baz_auth_expires';
  var LOGIN_KEY = 'baz_auth_login_time';
  var VERIFY_KEY = 'baz_auth_verified_ts';   // 마지막 서버 검증 성공 시각(ms) — 재검증 스로틀용

  // ── [기기 자동 로그인] 프런트 노출 스위치 ─────────────────────────
  // false = 체크박스·자동 시도를 끈다. 서버 엔드포인트까지 차단하는 보안 스위치는
  // Deno 환경변수 DEVICE_AUTH_ENABLED 이며, 프런트 플래그만으로 서버를 차단할 수 없다.
  //   켜기 전 준비: (1) Deno 에 KV 사용 설정  (2) main.ts 재배포(ver deno-1.1.0)
  //   확인: AUTH_URL/?action=ping 응답에 "kv":true 가 보이면 준비 완료.
  // 켜면: '이 기기 기억하기' 체크 시 기기 토큰을 localStorage 에 저장하고,
  //   다음 접속부터 비밀번호 없이 자동 로그인(30일 슬라이딩, Deno KV 에서 개별 해지 가능).
  var DEVICE_REMEMBER = true;   // [활성] Deno KV 준비 완료(ping kv:true) — 기기 자동 로그인 ON
  var DEVICE_KEY = 'baz_device_token';       // localStorage(영구) — 기억된 기기 토큰

  // [성능] 서버 재검증 스로틀. 로그인/검증 직후 이 시간 안에는 페이지를 옮겨도
  // 서버 verify 왕복을 생략하고 로컬 세션을 신뢰한다(진짜 검증은 각 데이터 GAS가
  // 요청마다 서버측에서 하므로, 클라이언트 재검증은 안전하게 건너뛸 수 있다).
  // 매 페이지 진입마다 auth로 왕복하던 것이 이 세션 내내 0회가 된다.
  var VERIFY_TTL = 5 * 60 * 1000;   // 5분

  // Apps Script는 프리플라이트(CORS preflight)를 싫어하므로
  // text/plain 으로 보내 단순요청(simple request)으로 처리합니다.
  //
  // [콜드스타트 대응] Apps Script 웹앱은 한동안 호출이 없으면 잠들고, 깨어나는 첫 요청이
  // 30~60초 걸리거나 JSON 대신 구글의 리다이렉트/오류 HTML(302·404)을 돌려줍니다.
  // 예전에는 그 HTML에 res.json()이 그대로 터져 "네트워크 오류"로 표시됐고, 연결이
  // 멀쩡한 사용자에게 연결을 확인하라고 안내하게 됐습니다(실제 로그인 실패 사례).
  // → 요청마다 타임아웃을 두고, HTML 응답을 '깨우는 중'으로 판별해 자동 재시도합니다.
  //   콜드스타트는 대개 두 번째 시도에서 붙습니다.
  //
  // opts: { tries, timeoutMs, onAttempt(n, tries) }
  // 실패 시 {kind:'warmup'|'timeout'|'network'} 로 reject 합니다.
  function postJSON(payload, opts) {
    opts = opts || {};
    var tries = opts.tries || 1;
    var timeoutMs = opts.timeoutMs || 25000;
    var attempt = 0;

    function once() {
      attempt++;
      if (opts.onAttempt) { try { opts.onAttempt(attempt, tries); } catch (e) {} }
      var ctl = ('AbortController' in global) ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { try { ctl.abort(); } catch (e) {} }, timeoutMs) : null;
      var init = {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      };
      if (ctl) init.signal = ctl.signal;
      return fetch(AUTH_URL, init)
        .then(function (res) {
          if (timer) { clearTimeout(timer); timer = null; }
          return res.text().then(function (txt) {
            if (/^\s*</.test(txt)) throw { kind: 'warmup' };   // JSON이 아니라 HTML → 아직 깨는 중
            try { return JSON.parse(txt); }
            catch (e) { throw { kind: 'warmup' }; }
          });
        })
        .catch(function (e) {
          if (timer) { clearTimeout(timer); timer = null; }
          var kind = (e && e.kind) ? e.kind
                   : (e && e.name === 'AbortError') ? 'timeout' : 'network';
          if (attempt < tries) {
            var wait = 1500 * attempt;   // 1.5s → 3s 백오프
            return new Promise(function (r) { setTimeout(r, wait); }).then(once);
          }
          throw { kind: kind };
        });
    }
    return once();
  }

  function saveSession(token, level, expires, name) {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(LEVEL_KEY, String(level));
      sessionStorage.setItem(EXP_KEY, expires || '');
      sessionStorage.setItem(NAME_KEY, name || '');
      sessionStorage.setItem(LOGIN_KEY, new Date().toISOString());
      sessionStorage.setItem(VERIFY_KEY, String(Date.now()));   // 로그인 = 방금 검증됨
    } catch (e) {}
  }

  function clearSession() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(LEVEL_KEY);
      sessionStorage.removeItem(NAME_KEY);
      sessionStorage.removeItem(EXP_KEY);
      sessionStorage.removeItem(LOGIN_KEY);
      sessionStorage.removeItem(VERIFY_KEY);
    } catch (e) {}
  }

  // 기억된 기기 토큰(localStorage) — DEVICE_REMEMBER 가 켜졌을 때만 사용
  function saveDevice(dev) { try { if (dev) localStorage.setItem(DEVICE_KEY, dev); } catch (e) {} }
  function clearDevice() { try { localStorage.removeItem(DEVICE_KEY); } catch (e) {} }
  function deviceToken() { try { return localStorage.getItem(DEVICE_KEY) || ''; } catch (e) { return ''; } }

  // [콜드스타트 선제 예열] 페이지가 열리는 '즉시' 인증·데이터 백엔드를 깨워 둔다.
  // 사용자가 비밀번호를 입력하는 몇 초 사이 백엔드가 이미 웜업되므로, 로그인 버튼을
  // 누를 때는 콜드스타트가 이미 끝나 있다(첫 로그인·첫 시트가 빨라진다).
  // 서버측 keepWarm(1분 트리거)이 놓친 공백을 클라이언트가 접속 순간에 메운다.
  var _lastPrewarm = 0;
  var _configPromise = null;

  var BazAuth = {

    // 설정 여부 확인 (URL이 비어 있으면 false)
    isConfigured: function () {
      return !!AUTH_URL;
    },

    // 공개 인증 설정. Google Client ID는 공개 식별자이며 비밀이 아니다.
    config: function () {
      if (!_configPromise) {
        _configPromise = postJSON({ action: 'config' }, { tries: 2, timeoutMs: 10000 })
          .then(function (r) { return r && r.ok ? r : { ok: false, googleAuth: false }; })
          .catch(function () { return { ok: false, googleAuth: false }; });
      }
      return _configPromise;
    },

    // 선제 예열: AUTH_URL(항상) + 넘겨준 데이터 백엔드(handover 등)를 ping&warm=1 로 깨운다.
    // ★ 반드시 '평범한 fetch'로 보낸다(로그인/메뉴 호출과 동일 방식).
    //   no-cors·keepalive 조합은 Apps Script 의 302 리다이렉트에서 브라우저가
    //   ERR_ABORTED 로 요청을 취소해(서버에 닿지도 못함) 예열이 전혀 안 됐다.
    //   평범한 fetch 는 리다이렉트를 따라가 서버에 실제로 도달하므로, 콜드면 그
    //   요청이 콜드스타트를 '대신' 흡수한다(사용자가 비번 입력하는 사이 웜업 완료).
    //   응답은 읽지 않는다(.catch 로 흡수) — 목적은 서버를 미리 깨우는 것뿐이다.
    // 포커스 복귀 등으로 여러 번 불려도 15초 안에는 실제 요청을 한 번만 보낸다.
    //   extraUrls: 문자열 1개 또는 배열(예: handover 배포 URL)
    prewarm: function (extraUrls) {
      var now = Date.now();
      if (now - _lastPrewarm < 15000) return;   // 과도한 중복 핑 방지(스로틀)
      _lastPrewarm = now;
      var urls = [];
      if (AUTH_URL) urls.push(AUTH_URL);
      if (extraUrls) {
        (typeof extraUrls === 'string' ? [extraUrls] : extraUrls)
          .forEach(function (u) { if (u) urls.push(u); });
      }
      urls.forEach(function (u) {
        try {
          fetch(u + (String(u).indexOf('?') >= 0 ? '&' : '?') + 'action=ping&warm=1',
                { method: 'GET', cache: 'no-store' })
            .catch(function () {});   // 콜드스타트 중 404/HTML 이어도 무시 — 예열은 이미 시작됨
        } catch (e) {}
      });
    },

    // 로그인: 비번 → 토큰. 성공 시 {ok:true, level} 반환
    // onAttempt(n, tries): 재시도 진행 상황(화면에 '깨우는 중' 안내를 띄우는 용도)
    // remember: true & 기능 활성 시, 이 기기를 기억(기기 토큰을 localStorage 에 저장)
    // 실패 코드: 'network'(정말 연결 안 됨) / 'server_busy'(서버 콜드스타트·응답 지연)
    login: function (password, onAttempt, remember) {
      if (!AUTH_URL) {
        return Promise.resolve({ ok: false, error: 'auth_url_missing' });
      }
      var wantRemember = DEVICE_REMEMBER && !!remember;
      var payload = { action: 'login', password: password };
      if (wantRemember) payload.remember = true;
      return postJSON(payload, { tries: 3, timeoutMs: 25000, onAttempt: onAttempt })
        .then(function (r) {
          if (r && r.ok) {
            saveSession(r.token, r.level, r.expires, r.name);
            if (wantRemember && r.device) saveDevice(r.device);   // 기기 기억
          }
          return r || { ok: false, error: 'no_response' };
        })
        .catch(function (e) {
          var kind = (e && e.kind) || 'network';
          return { ok: false, error: (kind === 'network' ? 'network' : 'server_busy'), detail: kind };
        });
    },

    // Google Identity Services가 발급한 ID 토큰을 Deno에서 검증한 뒤 기존 HMAC 세션으로 바꾼다.
    loginWithGoogle: function (idToken, remember) {
      if (!AUTH_URL || !idToken) return Promise.resolve({ ok: false, error: 'google_auth_failed' });
      var wantRemember = DEVICE_REMEMBER && !!remember;
      return postJSON({ action: 'google_login', idToken: idToken, remember: wantRemember }, { tries: 2, timeoutMs: 15000 })
        .then(function (r) {
          if (r && r.ok) {
            saveSession(r.token, r.level, r.expires, r.name);
            if (wantRemember && r.device) saveDevice(r.device);
          }
          return r || { ok: false, error: 'no_response' };
        })
        .catch(function () { return { ok: false, error: 'network' }; });
    },

    // Lv.3 보안 관리센터용 요청. 서버가 토큰 레벨을 다시 검증하므로 UI 숨김에 의존하지 않는다.
    // opts: 큰 본문을 보내는 호출(예시자료 게시 등)이 자동 재시도·짧은 제한시간을 끄고
    //       직접 정할 수 있게 열어 둔다. 안 넘기면 기존 동작(2회 시도·15초) 그대로다.
    adminRequest: function (action, payload, opts) {
      var o = opts || {};
      var body = payload || {};
      body.action = action;
      body.token = this.token();
      return postJSON(body, { tries: o.tries || 2, timeoutMs: o.timeoutMs || 15000 })
        .then(function (r) { return r || { ok: false, error: 'no_response' }; })
        .catch(function () { return { ok: false, error: 'network' }; });
    },

    // 기능 활성 여부(화면에서 '이 기기 기억하기' 노출 판단용)
    deviceEnabled: function () { return !!DEVICE_REMEMBER; },
    hasDevice: function () { return DEVICE_REMEMBER && !!deviceToken(); },

    // 기기 자동 로그인: 저장된 기기 토큰으로 세션을 복구한다(비밀번호 불필요).
    // 성공 시 level(1/2/3), 실패/미보유/비활성 시 0. 화면을 막지 않도록 실패는 조용히 0.
    tryDeviceLogin: function () {
      if (!DEVICE_REMEMBER || !AUTH_URL) return Promise.resolve(0);
      var dev = deviceToken();
      if (!dev) return Promise.resolve(0);
      return postJSON({ action: 'device_login', device: dev }, { tries: 2, timeoutMs: 15000 })
        .then(function (r) {
          if (r && r.ok) {
            saveSession(r.token, r.level, r.expires, r.name);
            if (r.device) saveDevice(r.device);   // 서버가 갱신한 토큰(동일값) 유지
            return r.level || 0;
          }
          // 기기가 해지/만료됨 → 저장된 토큰 폐기(다음엔 정상 로그인 유도)
          if (r && (r.error === 'device_not_found' || r.error === 'revoked' ||
                    r.error === 'device_auth_disabled')) clearDevice();
          return 0;
        })
        .catch(function () { return 0; });   // 네트워크 오류 등은 조용히(정상 로그인으로 폴백)
    },

    // 저장된 토큰을 서버에 검증. 유효하면 level(1/2), 아니면 0
    // currentLevel(force): 저장된 토큰을 서버에 검증. 유효하면 level(1/2/3), 아니면 0.
    // force=true 를 넘기면 스로틀을 무시하고 반드시 서버에 재검증한다(권한 강등 즉시 확인 등).
    currentLevel: function (force) {
      var token = this.token();
      if (!token || !AUTH_URL) return Promise.resolve(0);
      // 로컬 만료 선검사(서버 왕복 절약)
      var exp = this.expires();
      if (exp && new Date(exp) < new Date()) {
        clearSession();
        return Promise.resolve(0);
      }
      // [성능] 재검증 스로틀 — 최근 VERIFY_TTL(5분) 안에 검증됐고 만료 임박(10분 이내)이
      // 아니면 서버 왕복 없이 로컬 레벨을 즉시 반환. 세션 내 페이지 이동이 네트워크 0회가 된다.
      // (진짜 검증은 각 데이터 GAS가 요청마다 서버측에서 수행하므로 안전)
      if (!force) {
        var vts = parseInt(sessionStorage.getItem(VERIFY_KEY) || '0', 10);
        var nearExpiry = exp && (new Date(exp) - new Date()) < 10 * 60 * 1000;
        if (vts && (Date.now() - vts) < VERIFY_TTL && !nearExpiry) {
          return Promise.resolve(this.cachedLevel());
        }
      }
      // 스로틀 밖(또는 force): 서버 검증. 콜드스타트에 한 번 더 기회를 준다.
      // 실패해도 아래 catch가 로컬 캐시 레벨로 폴백하므로 화면을 막지는 않는다.
      return postJSON({ action: 'verify', token: token }, { tries: 2, timeoutMs: 15000 })
        .then(function (r) {
          if (r && r.ok) {
            try {
              sessionStorage.setItem(LEVEL_KEY, String(r.level));
              if (r.name) sessionStorage.setItem(NAME_KEY, r.name);
              sessionStorage.setItem(VERIFY_KEY, String(Date.now()));   // 검증 성공 시각 갱신
            } catch (e) {}
            return r.level;
          }
          clearSession();
          return 0;
        })
        .catch(function () {
          // 네트워크 오류 시: 로컬 캐시 레벨로 폴백(현장 오프라인 배려)
          var lv = parseInt(sessionStorage.getItem(LEVEL_KEY) || '0', 10);
          return isNaN(lv) ? 0 : lv;
        });
    },

    // 로컬에 저장된 레벨(서버 왕복 없이 즉시). 0=미인증
    cachedLevel: function () {
      var lv = parseInt(sessionStorage.getItem(LEVEL_KEY) || '0', 10);
      return isNaN(lv) ? 0 : lv;
    },

    token: function () {
      try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
    },

    expires: function () {
      try { return sessionStorage.getItem(EXP_KEY) || ''; } catch (e) { return ''; }
    },

    // 로그인한 사람 이름 (서버 Credentials의 name)
    name: function () {
      try { return sessionStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; }
    },

    // 로그인 시각(ISO 문자열). 미로그인 시 ''
    loginTime: function () {
      try { return sessionStorage.getItem(LOGIN_KEY) || ''; } catch (e) { return ''; }
    },

    // GET URL에 인증 토큰을 붙인다 (?/& 자동 판단). 토큰이 없으면 원본 그대로 반환.
    // 서버(handover_gas)가 조회 API에 로그인 토큰을 요구하므로 모든 조회 호출부에서 사용한다.
    //   예) fetch(BazAuth.withToken(URL + '?action=all'))
    withToken: function (url) {
      var t = this.token();
      if (!t) return url;
      return url + (String(url).indexOf('?') >= 0 ? '&' : '?') +
             'token=' + encodeURIComponent(t);
    },

    logout: function () {
      var token = this.token();
      var dev = deviceToken();
      clearSession();
      clearDevice();   // 명시적 로그아웃 = 이 기기 기억도 해제
      if (AUTH_URL) {
        if (token) postJSON({ action: 'logout', token: token }).catch(function () {});
        // 기억된 기기도 서버(KV)에서 폐기 — 실패해도 무방
        if (DEVICE_REMEMBER && dev) postJSON({ action: 'device_logout', device: dev }).catch(function () {});
      }
    }
  };

  /************************************************************
   * 페이지 접근 가드 (공통 인증)
   * ----------------------------------------------------------
   * index.html(로그인 허브)을 제외한 모든 페이지에서 자동 실행됩니다.
   * 1) 동기 선검사: 토큰 없음·만료·레벨 미달 → 렌더링 전에 즉시 이동
   * 2) 비동기 서버 검증: 폐기·만료 토큰을 서버(Apps Script)에서 확정 확인
   *    (네트워크 오류 시에는 currentLevel()의 로컬 캐시 폴백으로
   *     오프라인 새로고침(F5)이 막히지 않습니다)
   *
   * 필요 레벨 우선순위:
   *   1) window.BAZ_PAGE_MIN_LEVEL (auth.js 로드 전에 페이지가 지정)
   *   2) Google Sheet '메뉴설정' 탭 레벨 (localStorage 'baz_menu_cfg' 캐시)
   *   3) 아래 PAGE_RULES 기본값 — 목록에 없는 새 페이지는 레벨 1
   ************************************************************/

  // 인증 없이 접근 가능한 페이지 (로그인 화면 + 보안 불필요 페이지)
  //   guide/survey 는 업무 데이터가 없어 로그인 없이 열람 가능(페이지 가드 skip → verify 왕복 0).
  var PUBLIC_PAGES = { 'index.html': 1, '': 1, 'guide.html': 1, 'survey.html': 1 };

  // 페이지별 기본 규칙: tool = 메뉴설정 탭의 도구 id, level = 기본 최소 레벨
  // (index.html의 MENU_DEFAULTS 와 동일한 기준)
  // (제거된 페이지 hospital.html·dashboard.html·user_guide.html·chatbot.html 은 목록에서 뺐고,
  //  guide.html·survey.html 은 PUBLIC_PAGES 로 이동했다.)
  var PAGE_RULES = {
    'inspection.html': { tool: 'inspection', level: 1 },
    'handover.html':   { tool: 'handover',   level: 1 },
    'label.html':      { tool: 'label',      level: 1 },
    'weekly.html':     { tool: 'weekly',     level: 1 },
    'hospital-pc.html':{ tool: 'hospital',   level: 2 },
    'dashboard-pc.html':{ tool: 'dashboard', level: 3 }
  };

  function currentPage_() {
    try {
      return (global.location.pathname.split('/').pop() || '').toLowerCase();
    } catch (e) { return ''; }
  }

  function requiredLevelFor_(page) {
    // 1) 페이지가 직접 지정한 최소 레벨
    var ov = parseInt(global.BAZ_PAGE_MIN_LEVEL, 10);
    if (!isNaN(ov) && ov > 0) return ov;
    var rule = PAGE_RULES[page] || { tool: null, level: 1 };
    // 2) 메뉴설정 탭(구글 시트) 레벨 — index.html이 캐시해 둔 값
    if (rule.tool) {
      try {
        var cfg = JSON.parse(localStorage.getItem('baz_menu_cfg') || 'null');
        var lv = cfg && cfg[rule.tool] && parseInt(cfg[rule.tool].level, 10);
        if (lv && lv > 0) return lv;
      } catch (e) {}
    }
    // 3) 기본값
    return rule.level || 1;
  }

  function goLogin_() {
    global.location.replace('index.html');
  }

  function guardPage_() {
    var page = currentPage_();
    if (PUBLIC_PAGES.hasOwnProperty(page)) return;   // 로그인 허브는 검사 제외
    if (!AUTH_URL) return;                           // 인증 서버 미설정(개발 단계)에는 차단하지 않음

    var required = requiredLevelFor_(page);

    // ── 1) 동기 선검사: 화면이 그려지기 전에 즉시 차단 ──
    if (!BazAuth.token()) {
      // 세션은 없지만 '기억된 기기'가 있으면 자동 로그인 시도 후 판정(즉시 차단하지 않음)
      if (DEVICE_REMEMBER && deviceToken()) {
        BazAuth.tryDeviceLogin().then(function (lv) {
          if (lv >= required) { global.location.reload(); }   // 세션 확보 → 정상 상태로 재로드
          else goLogin_();
        });
        return;
      }
      goLogin_(); return;
    }
    var exp = BazAuth.expires();
    if (exp && new Date(exp) < new Date()) {         // 토큰 만료 → 자동 로그아웃
      clearSession();
      goLogin_();
      return;
    }
    if (BazAuth.cachedLevel() < required) {          // 권한 미달 → 자동 로그아웃
      BazAuth.logout();
      goLogin_();
      return;
    }

    // ── 2) 비동기 서버 검증: 서버에서 폐기·만료된 토큰 확정 차단 ──
    BazAuth.currentLevel().then(function (lv) {
      if (lv < required) {
        BazAuth.logout();
        goLogin_();
      }
    });
  }

  // 다른 스크립트에서도 쓸 수 있게 공개 (예: 특정 버튼에서 재검사)
  BazAuth.requiredLevel = function () { return requiredLevelFor_(currentPage_()); };
  BazAuth.guard = guardPage_;

  global.BazAuth = BazAuth;

  /************************************************************
   * 공통 통계 모듈 (Statistics)
   * ----------------------------------------------------------
   * Weekly(W_ROWS)를 입력받아 "병원 기준" 노즐 재사용 통계를 만든다.
   * Weekly 화면 / Weekly Excel / Dashboard 등 여러 화면이
   * 동일한 계산을 재사용하도록 auth.js(공통 로드 파일)에 둔다.
   *
   * 사용법:
   *   var st = Statistics.build(W_ROWS);
   *   st.nozzle.joined.percent    // N-care 가입 재사용률(%)
   *
   * 계산 규칙:
   *   - 병원 기준(건수 아님). 같은 병원의 중복 방문은 1곳으로 집계.
   *   - 병원명은 Trim + 대소문자 무시 + 연속 공백 1칸 정규화 후 비교.
   *   - 노즐 재사용이 한 번이라도 'O'면 그 병원은 재사용 병원(X→O→X 포함).
   *   - N-care 가입 여부는 병원의 행 중 하나라도 '가입'이면 가입으로 본다.
   *   - Set/Map으로 O(n) 계산, 병원 리스트는 마지막에만 정렬(가나다순).
   * 반환 구조:
   *   { counts:{insp,voc,total},
   *     nozzle:{
   *       joined:   {total,reuse,percent,hospitals[]},
   *       nonJoined:{total,reuse,percent,hospitals[]} } }
   ************************************************************/
  var Statistics = (function () {
    // 병원명 정규화 키: Trim → 소문자 → 연속 공백 1칸
    function normName(s) {
      return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
    }
    // 재사용률(%) — 소수점 1자리
    function pct(reuse, total) {
      return total > 0 ? Math.round((reuse / total) * 1000) / 10 : 0;
    }
    // 가나다(한국어) 정렬
    function cmpKo(a, b) {
      try { return String(a).localeCompare(String(b), 'ko'); }
      catch (e) { return a < b ? -1 : (a > b ? 1 : 0); }
    }

    function build(rows) {
      rows = rows || [];
      var map = new Map();          // 정규화키 → {name, joined, reuse}
      var insp = 0, total = 0;      // 건수 요약(가입/미가입 무관 전체 행 기준)

      for (var i = 0; i < rows.length; i++) {
        var r = rows[i] || {};
        total++;
        if (String(r.kind).trim() === '점검') insp++;

        var rawName = String(r.hosp == null ? '' : r.hosp).trim();
        if (!rawName) continue;                       // 병원명 없는 행은 병원 통계에서 제외
        var key = normName(rawName);
        var rec = map.get(key);
        if (!rec) { rec = { name: rawName, joined: false, reuse: false }; map.set(key, rec); }
        if (String(r.ncare).trim() === '가입') rec.joined = true;                 // 한 번이라도 가입 → 가입
        if (String(r.nozzle).trim().toUpperCase() === 'O') rec.reuse = true;      // 한 번이라도 O → 재사용
      }

      var jAll = [], jReuse = [], nAll = [], nReuse = [];
      map.forEach(function (rec) {
        if (rec.joined) { jAll.push(rec.name); if (rec.reuse) jReuse.push(rec.name); }
        else { nAll.push(rec.name); if (rec.reuse) nReuse.push(rec.name); }
      });
      jReuse.sort(cmpKo); nReuse.sort(cmpKo);         // 리스트는 마지막에만 정렬

      return {
        counts: { insp: insp, voc: total - insp, total: total },
        nozzle: {
          joined:    { total: jAll.length, reuse: jReuse.length, percent: pct(jReuse.length, jAll.length), hospitals: jReuse },
          nonJoined: { total: nAll.length, reuse: nReuse.length, percent: pct(nReuse.length, nAll.length), hospitals: nReuse }
        }
      };
    }

    return { build: build };
  })();

  global.Statistics = Statistics;   // Weekly / Excel / Dashboard 공용

  guardPage_();   // 스크립트 로드 즉시 실행 (렌더링 차단 검사)
})(window);
