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
 ************************************************************/
(function (global) {
  'use strict';

  // ▼▼▼ 배포 후 여기에 인증 Apps Script의 /exec URL을 넣으세요 ▼▼▼
  var AUTH_URL = 'https://script.google.com/macros/s/AKfycbykXiS7tXXx_nNuwXwQ--hgIXMrBSNdBPxOCn8b6H_zg9AWkbdLLqmF0Wn8L8zLaAI/exec';
  // ▲▲▲ 예: 'https://script.google.com/macros/s/XXXX/exec' ▲▲▲

  var TOKEN_KEY = 'baz_auth_token';
  var LEVEL_KEY = 'baz_auth_level';
  var EXP_KEY   = 'baz_auth_expires';

  // Apps Script는 프리플라이트(CORS preflight)를 싫어하므로
  // text/plain 으로 보내 단순요청(simple request)으로 처리합니다.
  function postJSON(payload) {
    return fetch(AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function (res) { return res.json(); });
  }

  function saveSession(token, level, expires) {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(LEVEL_KEY, String(level));
      sessionStorage.setItem(EXP_KEY, expires || '');
    } catch (e) {}
  }

  function clearSession() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(LEVEL_KEY);
      sessionStorage.removeItem(EXP_KEY);
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
            saveSession(r.token, r.level, r.expires);
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
            try { sessionStorage.setItem(LEVEL_KEY, String(r.level)); } catch (e) {}
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

    logout: function () {
      var token = this.token();
      clearSession();
      if (token && AUTH_URL) {
        // 서버에서도 폐기(실패해도 무방)
        postJSON({ action: 'logout', token: token }).catch(function () {});
      }
    }
  };

  global.BazAuth = BazAuth;
})(window);
