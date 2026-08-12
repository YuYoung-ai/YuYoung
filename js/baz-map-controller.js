/*******************************************************************
 * baz-map-controller.js — 지도 상태 · relayout · 렌더 세대 (BazMapController)
 * -----------------------------------------------------------------
 * 왜 분리했나
 *   지도 크기·중심·배율을 건드리는 코드가 hospital-pc.html 안에 흩어져 있었다.
 *     · relayout() 호출 지점 8곳(테마·필터폭·탭복귀·모드전환·전체화면·
 *       ResizeObserver·드래그·pcShowMap 의 120ms 타이머)
 *     · pcShowMap 은 그리고 나서 120ms 뒤에 중심·배율을 "한 번 더" 덮었다
 *     · 접기→펼치기·전체화면 전환은 pcRestoreView=true 만 세우고 직전 상태를
 *       저장하지 않아, 복원할 값이 없거나 옛 값이 되살아났다
 *     · 폴링(최대 40초)이 부른 재렌더가 사용자가 방금 옮긴 지도를 되돌렸다
 *   → 화면 전환 · relayout · 뷰 복원 · 렌더 세대를 이 컨트롤러 하나로 모은다.
 *
 * 지도 SDK(kakao)를 직접 참조하지 않는다 — adapter 를 주입받으므로
 * 헤드리스 테스트에서 가짜 지도로 그대로 검증할 수 있다.
 *
 * 브라우저: <script src="js/baz-map-controller.js"></script> → window.BazMapController
 * 테스트  : require('../js/baz-map-controller.js')
 *******************************************************************/
(function (root, factory) {
  var api = factory();
  root.BazMapController = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * @param {Object} opts
   *   getMap()      → 지도 인스턴스(없으면 null)
   *   makeLatLng(lat,lng) → SDK LatLng
   *   raf(fn)/caf(id)     → 애니메이션 프레임(없으면 setTimeout 폴백)
   *   now()               → epoch ms
   *   onRelayout(view)    → relayout 직후 훅(선택)
   */
  function create(opts) {
    opts = opts || {};
    var getMap = opts.getMap || function () { return null; };
    var makeLatLng = opts.makeLatLng || function (lat, lng) { return { lat: lat, lng: lng }; };
    var now = opts.now || function () { return Date.now(); };
    var raf = opts.raf || function (fn) { return setTimeout(fn, 16); };
    var caf = opts.caf || function (id) { clearTimeout(id); };
    var onRelayout = opts.onRelayout || null;

    var state = {
      pending: 0,             // 예약된 relayout 프레임 id (0 = 없음)
      pendingRestore: null,   // relayout 뒤 복원할 뷰
      relayoutCount: 0,       // 실제 relayout 실행 횟수(테스트·진단)
      requestCount: 0,        // 요청 횟수 — 병합 효과 확인용
      generation: 0,          // 렌더 세대 — 오래된 비동기 렌더 무효화
      userViewAt: 0,          // 마지막 사용자 조작 시각
      lastAutoFitSig: null,   // 마지막으로 자동 맞춤한 데이터 시그니처
      transitions: 0,         // 진행 중인 화면 전환 깊이
      transitionView: null,   // 전환 시작 시점의 뷰
      dragging: false,
      lastDragRelayout: 0
    };

    var DRAG_RELAYOUT_MS = 90;   // 드래그 중 relayout 최소 간격 — 매 pointermove 마다 돌지 않게

    /* ── 뷰(중심·배율) ─────────────────────────────────────────────── */

    /** 현재 중심·배율을 읽어 평범한 객체로. 지도가 없으면 null. */
    function captureView() {
      var map = getMap();
      if (!map) return null;
      try {
        var c = map.getCenter();
        if (!c) return null;
        var lat = (typeof c.getLat === 'function') ? c.getLat() : c.lat;
        var lng = (typeof c.getLng === 'function') ? c.getLng() : c.lng;
        if (lat == null || lng == null) return null;
        return { lat: lat, lng: lng, level: map.getLevel() };
      } catch (e) { return null; }
    }

    /** 저장한 뷰 적용. 성공하면 true. */
    function applyView(view) {
      var map = getMap();
      if (!map || !view || view.lat == null) return false;
      try {
        if (view.level != null) map.setLevel(view.level);
        map.setCenter(makeLatLng(view.lat, view.lng));
        return true;
      } catch (e) { return false; }
    }

    /* ── relayout 통합 ─────────────────────────────────────────────── */

    /**
     * relayout 예약. 같은 프레임(또는 짧은 구간)의 중복 요청은 1회로 병합된다.
     * @param {Object} [o] { restore:view|'current'|null, immediate:true }
     */
    function scheduleRelayout(o) {
      o = o || {};
      state.requestCount++;
      if (o.restore === 'current') o.restore = captureView();
      // 이미 예약된 복원이 있으면 유지한다 — 전환 시작 시점의 뷰가 더 오래된(정확한) 값이다
      if (o.restore && !state.pendingRestore) state.pendingRestore = o.restore;
      if (o.immediate) { flushRelayout(); return state.relayoutCount; }
      if (state.pending) return state.relayoutCount;    // ★ 병합 지점
      state.pending = raf(function () { state.pending = 0; runRelayout(); });
      return state.relayoutCount;
    }

    /** 예약된 relayout 을 즉시 실행(대기 중이 없으면 그래도 1회 실행) */
    function flushRelayout() {
      if (state.pending) { caf(state.pending); state.pending = 0; }
      runRelayout();
      return state.relayoutCount;
    }

    /** 예약 취소(지도 파기 등) */
    function cancelRelayout() {
      if (state.pending) { caf(state.pending); state.pending = 0; }
      state.pendingRestore = null;
    }

    function runRelayout() {
      var map = getMap();
      var restore = state.pendingRestore;
      state.pendingRestore = null;
      if (!map) return;
      try { if (typeof map.relayout === 'function') map.relayout(); } catch (e) { /* SDK 내부 오류는 다음 프레임에 다시 온다 */ }
      state.relayoutCount++;
      if (restore) applyView(restore);
      if (onRelayout) { try { onRelayout(restore); } catch (e) {} }
    }

    /* ── 화면 상태 전환 ────────────────────────────────────────────────
       접기/펼치기 · 전체화면 · 카드/표 · 필터 폭 · 탭 복귀 · 창 크기 변경
       모두 같은 패턴을 쓴다:
         beginTransition()  → 지금 보고 있는 중심·배율 저장
         (DOM/CSS 변경)
         endTransition()    → relayout 1회 + 저장한 뷰 복원 */
    function beginTransition() {
      if (state.transitions === 0) state.transitionView = captureView();
      state.transitions++;
      return state.transitionView;
    }

    function endTransition(o) {
      o = o || {};
      if (state.transitions > 0) state.transitions--;
      if (state.transitions > 0) return null;            // 중첩 전환 — 가장 바깥에서만 마무리
      var view = state.transitionView;
      state.transitionView = null;
      scheduleRelayout({ restore: (o.restore === false ? null : view), immediate: !!o.immediate });
      return view;
    }

    /** 전환 한 덩어리를 함수로 감싸 쓰는 설탕 */
    function withTransition(fn, o) {
      beginTransition();
      try { if (typeof fn === 'function') fn(); }
      finally { endTransition(o); }
      return state.transitionView;
    }

    /* ── 높이 드래그 ──────────────────────────────────────────────────
       드래그 중에는 relayout 을 최대 DRAG_RELAYOUT_MS 간격으로만,
       드래그가 끝나면 반드시 1회를 보장한다. */
    function dragStart() { state.dragging = true; state.lastDragRelayout = 0; }
    function dragMove() {
      if (!state.dragging) return false;
      var t = now();
      if (t - state.lastDragRelayout < DRAG_RELAYOUT_MS) return false;
      state.lastDragRelayout = t;
      scheduleRelayout();
      return true;
    }
    function dragEnd() {
      state.dragging = false;
      state.lastDragRelayout = 0;
      scheduleRelayout({ immediate: false });   // 최종 1회 보장
      return true;
    }
    function isDragging() { return state.dragging; }

    /* ── 렌더 세대 ────────────────────────────────────────────────────
       pcShowMap 은 loadKakao 콜백 안에서 그린다(비동기). 초기 데이터 로드 중
       캐시 적용·네트워크 응답·폴링이 겹치면 콜백이 여러 개 떠 있고, 늦게 도착한
       옛 콜백이 최신 데이터·사용자 조작을 덮었다. 세대 번호로 무효화한다. */
    function beginRender() { state.generation++; return state.generation; }
    function isStale(gen) { return gen !== state.generation; }
    function currentGeneration() { return state.generation; }

    /* ── 사용자 조작 보호 ─────────────────────────────────────────────
       사용자가 직접 지도를 옮기거나 확대하면 기록해 두고, 데이터 갱신·폴링이
       그 위치를 자동 맞춤(setBounds)으로 되돌리지 않게 한다.
       "검색어나 필터 결과가 실제로 바뀐 경우"에만 자동 맞춤을 허용한다. */
    function markUserView() { state.userViewAt = now(); }
    function userViewAt() { return state.userViewAt; }
    function clearUserView() { state.userViewAt = 0; }

    /**
     * 자동 맞춤(setBounds) 을 해도 되는가?
     * @param {String} sig 현재 목록/검색 시그니처
     * @param {Object} [o] { force:true } 사용자가 명시적으로 '결과 맞춤'을 눌렀을 때
     */
    function shouldAutoFit(sig, o) {
      if (o && o.force) { state.lastAutoFitSig = sig; state.userViewAt = 0; return true; }
      if (sig === state.lastAutoFitSig) return false;      // 데이터가 그대로면 손대지 않는다
      state.lastAutoFitSig = sig;
      // 데이터가 바뀌었어도 사용자가 방금 지도를 만졌으면 그 조작을 존중한다
      if (state.userViewAt && (now() - state.userViewAt) < (opts.userHoldMs || 60000)) return false;
      return true;
    }

    function resetAutoFit() { state.lastAutoFitSig = null; }

    function stats() {
      return {
        relayoutCount: state.relayoutCount,
        requestCount: state.requestCount,
        generation: state.generation,
        pending: !!state.pending,
        transitions: state.transitions,
        dragging: state.dragging,
        userViewAt: state.userViewAt
      };
    }

    function reset() {
      cancelRelayout();
      state.relayoutCount = 0; state.requestCount = 0;
      state.generation = 0; state.userViewAt = 0;
      state.lastAutoFitSig = null; state.transitions = 0;
      state.transitionView = null; state.dragging = false;
    }

    return {
      captureView: captureView,
      applyView: applyView,
      scheduleRelayout: scheduleRelayout,
      flushRelayout: flushRelayout,
      cancelRelayout: cancelRelayout,
      beginTransition: beginTransition,
      endTransition: endTransition,
      withTransition: withTransition,
      dragStart: dragStart,
      dragMove: dragMove,
      dragEnd: dragEnd,
      isDragging: isDragging,
      beginRender: beginRender,
      isStale: isStale,
      currentGeneration: currentGeneration,
      markUserView: markUserView,
      userViewAt: userViewAt,
      clearUserView: clearUserView,
      shouldAutoFit: shouldAutoFit,
      resetAutoFit: resetAutoFit,
      stats: stats,
      reset: reset
    };
  }

  return { create: create };
});
