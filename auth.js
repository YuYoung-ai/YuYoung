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
    'hospital-pc.html':{ tool: 'hospital',   level: 2 },
    'survey.html':     { tool: 'survey',     level: 2 },
    'dashboard.html':  { tool: 'dashboard',  level: 3 },
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
