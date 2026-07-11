/************************************************************
 * 경량 이벤트 버스 — 화면 컴포넌트 간 느슨한 통신
 ************************************************************/
AD.bus = (function () {
  var map = {};
  return {
    on: function (ev, fn) { (map[ev] = map[ev] || []).push(fn); },
    emit: function (ev, data) {
      (map[ev] || []).forEach(function (fn) {
        try { fn(data); } catch (e) {}
      });
    }
  };
})();
