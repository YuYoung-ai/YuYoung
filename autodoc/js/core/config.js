/************************************************************
 * AutoDoc 전역 설정 + 공통 유틸
 * 모든 페이지가 가장 먼저 로드합니다. (네임스페이스 window.AD)
 ************************************************************/
window.AD = window.AD || {};

AD.config = {
  ENGINE_VERSION: '0.1.0',

  /* ▼ autodoc_gas.gs 배포 후 /exec URL을 넣으세요.
   *   비어 있으면 templates/ 폴더의 정적 JSON만 사용합니다(오프라인·GAS 미배포 대응). */
  GAS_URL: '',

  /* GAS 미설정 시 카탈로그에 노출할 정적 템플릿 id (templates/<id>.json) */
  STATIC_TEMPLATES: ['weekly-report', 'meeting-minutes', 'trip-report'],

  DEFAULT_THEME: 'company-default',

  /* 관리자 화면(admin.html) 최소 권한 레벨 — 인증 GAS에 레벨 4 추가 시 4로 상향 */
  ADMIN_MIN_LEVEL: 3
};

/* HTML 이스케이프 (기존 weekly.html esc 이관) */
AD.esc = function (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

/* 색상 유틸: '#1B2F5E' → PPT용 '1B2F5E' / ExcelJS용 'FF1B2F5E' */
AD.hex  = function (c) { return String(c || '#000000').replace('#', ''); };
AD.hexA = function (c) { return 'FF' + AD.hex(c); };

/* 날짜 유틸 (weekly.html 이관) */
AD.date = (function () {
  function p2(n) { return String(n).padStart(2, '0'); }
  function monday(d) {
    var x = new Date(d); var w = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - w); x.setHours(0, 0, 0, 0); return x;
  }
  function addD(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function ymd(d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function wkNo(mon) { return Math.floor((mon.getDate() - 1) / 7) + 1; }
  function wkLabel(mon) { return (mon.getMonth() + 1) + '월 ' + wkNo(mon) + '주차'; }
  var DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  return { p2: p2, monday: monday, addD: addD, ymd: ymd, wkNo: wkNo, wkLabel: wkLabel, DAYS: DAYS };
})();
