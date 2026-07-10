/************************************************************
 * Data Provider 공통 — 프로바이더 계약
 * 계약: { id, fetch(query) → Promise<rows|object> }
 * 이 계약만 지키면 REST/DB 등 어떤 데이터 소스도 추가 가능합니다.
 ************************************************************/
AD.Providers = (function () {
  var map = {};
  return {
    register: function (p) { map[p.id] = p; },
    get: function (id) { return map[id]; }
  };
})();
