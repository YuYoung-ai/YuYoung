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

  // ▼▼▼ 배포 후 여기에 인증 Apps Script의 /exec URL을 넣으세요 ▼▼▼
  var AUTH_URL = 'https://script.google.com/macros/s/AKfycbykXiS7tXXx_nNuwXwQ--hgIXMrBSNdBPxOCn8b6H_zg9AWkbdLLqmF0Wn8L8zLaAI/exec';
  // ▲▲▲ 예: 'https://script.google.com/macros/s/XXXX/exec' ▲▲▲

  var TOKEN_KEY = 'baz_auth_token';
  var LEVEL_KEY = 'baz_auth_level';
  var NAME_KEY  = 'baz_auth_name';
  var EXP_KEY   = 'baz_auth_expires';
  var LOGIN_KEY = 'baz_auth_login_time';

  // Apps Script는 프리플라이트(CORS preflight)를 싫어하므로
  // text/plain 으로 보내 단순요청(simple request)으로 처리합니다.
  function postJSON(payload) {
    return fetch(AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function (res) { return res.json(); });
  }

  function saveSession(token, level, expires, name) {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(LEVEL_KEY, String(level));
      sessionStorage.setItem(EXP_KEY, expires || '');
      sessionStorage.setItem(NAME_KEY, name || '');
      sessionStorage.setItem(LOGIN_KEY, new Date().toISOString());
    } catch (e) {}
  }

  function clearSession() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(LEVEL_KEY);
      sessionStorage.removeItem(NAME_KEY);
      sessionStorage.removeItem(EXP_KEY);
      sessionStorage.removeItem(LOGIN_KEY);
    } catch (e) {}
  }

  var BazAuth = {

    // 설정 여부 확인 (URL이 비어 있으면 false)
    isConfigured: function () {
      return !!AUTH_URL;
    },

    // 로그인: 비번 → 토큰. 성공 시 {ok:true, level} 반환
    login: function (password) {
      if (!AUTH_URL) {
        return Promise.resolve({ ok: false, error: 'auth_url_missing' });
      }
      return postJSON({ action: 'login', password: password })
        .then(function (r) {
          if (r && r.ok) {
            saveSession(r.token, r.level, r.expires, r.name);
          }
          return r || { ok: false, error: 'no_response' };
        })
        .catch(function (e) {
          return { ok: false, error: 'network', detail: String(e) };
        });
    },

    // 저장된 토큰을 서버에 검증. 유효하면 level(1/2), 아니면 0
    currentLevel: function () {
      var token = this.token();
      if (!token || !AUTH_URL) return Promise.resolve(0);
      // 로컬 만료 선검사(서버 왕복 절약)
      var exp = this.expires();
      if (exp && new Date(exp) < new Date()) {
        clearSession();
        return Promise.resolve(0);
      }
      return postJSON({ action: 'verify', token: token })
        .then(function (r) {
          if (r && r.ok) {
            try {
              sessionStorage.setItem(LEVEL_KEY, String(r.level));
              if (r.name) sessionStorage.setItem(NAME_KEY, r.name);
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

    logout: function () {
      var token = this.token();
      clearSession();
      if (token && AUTH_URL) {
        // 서버에서도 폐기(실패해도 무방)
        postJSON({ action: 'logout', token: token }).catch(function () {});
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

  // 인증 없이 접근 가능한 페이지 (로그인 화면)
  var PUBLIC_PAGES = { 'index.html': 1, '': 1 };

  // 페이지별 기본 규칙: tool = 메뉴설정 탭의 도구 id, level = 기본 최소 레벨
  // (index.html의 MENU_DEFAULTS 와 동일한 기준)
  var PAGE_RULES = {
    'guide.html':      { tool: 'guide',      level: 1 },
    'inspection.html': { tool: 'inspection', level: 1 },
    'handover.html':   { tool: 'handover',   level: 1 },
    'chatbot.html':    { tool: 'chatbot',    level: 1 },
    'weekly.html':     { tool: 'weekly',     level: 1 },
    'user_guide.html': { tool: null,         level: 1 },
    'hospital.html':   { tool: 'hospital',   level: 2 },
    'survey.html':     { tool: 'survey',     level: 2 },
    'dashboard.html':  { tool: 'dashboard',  level: 3 }
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
    if (!BazAuth.token()) { goLogin_(); return; }
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

  guardPage_();   // 스크립트 로드 즉시 실행 (렌더링 차단 검사)
})(window);
