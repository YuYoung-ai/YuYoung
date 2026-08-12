/*******************************************************************
 * baz-nearby.js — 내 주변 5km N-CARE (BazNearby)
 * -----------------------------------------------------------------
 * 왜 분리했나
 *   hospital-pc.html 에는 nearbyMode·myPos 필터 코드가 남아 있는데,
 *   위치를 설정하는 UI 도 navigator.geolocation 호출도 사라져 있어
 *   기능 전체에 도달할 방법이 없었다(죽은 코드).
 *   → 위치 요청 상태기계(요청중/성공/권한거부/실패/해제)와 거리 필터를
 *      한곳에 모으고, 위치 API 가 없는 환경에서도 화면 전체가 죽지 않게 한다.
 *
 * ※ 여기서 말하는 "내 주변 5km" 는 브라우저 위치 기준 모드다.
 *    지도에 뜨는 "검색 결과 주변 5km 참고 마커"(pcDrawNearby)와는 다른 기능이며,
 *    UI 문자열·코드 모두에서 구분해 부른다.
 *
 * 브라우저: <script src="js/baz-nearby.js"></script> → window.BazNearby
 * 테스트  : require('../js/baz-nearby.js')
 *******************************************************************/
(function (root, factory) {
  var api = factory();
  root.BazNearby = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULT_KM = 5;

  /** 하버사인 — hospital-pc.html 의 distKm 과 같은 식 */
  function distKm(lat1, lng1, lat2, lng2) {
    var R = 6371, toR = function (x) { return x * Math.PI / 180; };
    var dLat = toR(lat2 - lat1), dLng = toR(lng2 - lng1);
    var a = Math.pow(Math.sin(dLat / 2), 2) +
            Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.pow(Math.sin(dLng / 2), 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }

  /**
   * 내 위치 기준 반경 안의 N-CARE 병원만 거리순으로.
   * 원본 객체를 건드리지 않도록 얕은 복사본에 _dist 를 붙인다.
   */
  function filterNearby(hospitals, pos, o) {
    o = o || {};
    var km = (o.km != null) ? o.km : DEFAULT_KM;
    var isNcare = o.isNcare || function (h) { return !!(h.nc && h.nc !== '미가입'); };
    if (!Array.isArray(hospitals) || !pos || !isFiniteNum(pos.lat) || !isFiniteNum(pos.lng)) return [];
    var out = [];
    hospitals.forEach(function (h) {
      if (!h || !isNcare(h)) return;
      if (!isFiniteNum(h.lat) || !isFiniteNum(h.lng)) return;
      var d = distKm(pos.lat, pos.lng, h.lat, h.lng);
      if (d > km) return;
      var copy = {};
      Object.keys(h).forEach(function (k) { copy[k] = h[k]; });
      copy._dist = d;
      out.push(copy);
    });
    out.sort(function (a, b) { return a._dist - b._dist; });
    return out;
  }

  /**
   * 위치 모드 상태기계.
   *   state: 'off' | 'locating' | 'ready' | 'denied' | 'failed' | 'unsupported'
   * @param {Object} opts { geolocation, onChange(state, detail), timeoutMs }
   */
  function create(opts) {
    opts = opts || {};
    var onChange = opts.onChange || function () {};
    var timeoutMs = opts.timeoutMs || 12000;
    var st = { state: 'off', pos: null, error: '' };
    var seq = 0;   // 늦게 도착한 옛 위치 응답이 최신 상태를 덮지 않게

    function geo() {
      if (opts.geolocation !== undefined) return opts.geolocation;
      if (typeof navigator !== 'undefined' && navigator.geolocation) return navigator.geolocation;
      return null;
    }

    function set(state, detail) {
      st.state = state;
      if (detail && detail.pos !== undefined) st.pos = detail.pos;
      st.error = (detail && detail.error) || '';
      try { onChange(state, { pos: st.pos, error: st.error }); } catch (e) {}
      return state;
    }

    /** 위치 요청. 이미 성공한 위치가 있어도 항상 새로 받는다(현장 이동 반영). */
    function request() {
      var g = geo();
      if (!g || typeof g.getCurrentPosition !== 'function') return set('unsupported', { pos: null });
      var my = ++seq;
      set('locating');
      try {
        g.getCurrentPosition(function (p) {
          if (my !== seq) return;                       // 오래된 응답 무시
          var c = p && p.coords;
          if (!c || !isFiniteNum(c.latitude) || !isFiniteNum(c.longitude)) {
            set('failed', { pos: null, error: 'no-coords' });
            return;
          }
          set('ready', { pos: { lat: c.latitude, lng: c.longitude, acc: c.accuracy } });
        }, function (err) {
          if (my !== seq) return;
          var code = err && err.code;
          // 1 = PERMISSION_DENIED
          if (code === 1) set('denied', { pos: null, error: 'permission' });
          else set('failed', { pos: null, error: (err && err.message) || 'position-unavailable' });
        }, { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 });
      } catch (e) {
        // 위치 API 가 있어도 보안 컨텍스트가 아니면 여기서 던진다 — 화면은 계속 살아 있어야 한다
        set('failed', { pos: null, error: String(e && e.message || e) });
      }
      return st.state;
    }

    function off() { seq++; st.pos = null; return set('off', { pos: null }); }

    function isActive() { return st.state === 'ready' && !!st.pos; }
    function getState() { return st.state; }
    function getPos() { return st.pos; }
    function getError() { return st.error; }

    /** 현재 위치 기준으로 걸러낸 목록 (모드가 활성일 때만) */
    function apply(hospitals, o) {
      if (!isActive()) return null;
      return filterNearby(hospitals, st.pos, o);
    }

    return {
      request: request,
      off: off,
      isActive: isActive,
      state: getState,
      pos: getPos,
      error: getError,
      apply: apply
    };
  }

  return {
    DEFAULT_KM: DEFAULT_KM,
    distKm: distKm,
    filterNearby: filterNearby,
    create: create
  };
});
