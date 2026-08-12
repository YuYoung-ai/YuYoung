/*******************************************************************
 * baz-scroll-lock.js — 공통 배경 스크롤 잠금 (BazScrollLock)
 * -----------------------------------------------------------------
 * 왜 분리했나
 *   이력 모달은 body.style.overflow 를 직접 'hidden' 으로 바꾸고 닫을 때
 *   무조건 '' 로 되돌렸다. 지도 전체화면은 그 충돌 때문에 아예 잠그지 못하고
 *   #pcPane 에 paddingTop 을 넣어 공간만 예약했다 — 배경 페이지는 그대로
 *   움직였고, 전체화면을 닫으면 카드 목록 스크롤 위치가 튀었다.
 *   → 소유자(owner) 이름을 가진 lock count 방식으로 하나만 둔다.
 *      · 중첩(전체화면 위에 이력 모달)도 안전하다 — 마지막 소유자가 풀 때만 해제.
 *      · 해제 시 진입 당시 scrollY 를 정확히 복원한다.
 *
 * 브라우저: <script src="js/baz-scroll-lock.js"></script> → window.BazScrollLock
 * 테스트  : require('../js/baz-scroll-lock.js')
 *******************************************************************/
(function (root, factory) {
  var api = factory();
  root.BazScrollLock = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var owners = [];        // 잠금 소유자 스택 (중복 push 금지)
  var saved = null;       // { scrollY, overflow, position, top, width, paddingRight }

  function doc() { return (typeof document !== 'undefined') ? document : null; }
  function win() { return (typeof window !== 'undefined') ? window : null; }

  function scrollbarWidth() {
    var w = win(), d = doc();
    if (!w || !d || !d.documentElement) return 0;
    return Math.max(0, (w.innerWidth || 0) - (d.documentElement.clientWidth || 0));
  }

  function apply() {
    var d = doc(), w = win();
    if (!d || !d.body || !w) return;
    var y = w.scrollY || w.pageYOffset || 0;
    saved = {
      scrollY: y,
      overflow: d.body.style.overflow,
      position: d.body.style.position,
      top: d.body.style.top,
      width: d.body.style.width,
      paddingRight: d.body.style.paddingRight
    };
    var sb = scrollbarWidth();
    /* position:fixed + top:-y 로 배경을 완전히 묶는다. overflow:hidden 만으로는
       iOS·일부 데스크톱에서 배경이 계속 스크롤된다. 스크롤바 폭은 padding 으로
       보정해 레이아웃이 옆으로 튀지 않게 한다. */
    d.body.style.position = 'fixed';
    d.body.style.top = (-y) + 'px';
    d.body.style.width = '100%';
    d.body.style.overflow = 'hidden';
    if (sb > 0) d.body.style.paddingRight = sb + 'px';
  }

  function restore() {
    var d = doc(), w = win();
    if (!d || !d.body || !saved) { saved = null; return; }
    d.body.style.overflow = saved.overflow;
    d.body.style.position = saved.position;
    d.body.style.top = saved.top;
    d.body.style.width = saved.width;
    d.body.style.paddingRight = saved.paddingRight;
    var y = saved.scrollY;
    saved = null;
    if (w && typeof w.scrollTo === 'function') {
      try { w.scrollTo(0, y); } catch (e) { w.scrollTo(0, y); }
    }
  }

  /** 잠금 획득. 같은 owner 로 두 번 불러도 카운트는 1. */
  function lock(owner) {
    var key = String(owner || 'anonymous');
    if (owners.indexOf(key) >= 0) return owners.length;
    if (!owners.length) apply();
    owners.push(key);
    return owners.length;
  }

  /** 잠금 해제. 마지막 소유자가 빠질 때만 실제로 푼다. */
  function unlock(owner) {
    var key = String(owner || 'anonymous');
    var i = owners.indexOf(key);
    if (i < 0) return owners.length;
    owners.splice(i, 1);
    if (!owners.length) restore();
    return owners.length;
  }

  /** 비상 해제 — 모드 전환처럼 소유자를 잃어버릴 수 있는 경로용 */
  function releaseAll() {
    if (!owners.length) return;
    owners = [];
    restore();
  }

  function isLocked() { return owners.length > 0; }
  function count() { return owners.length; }
  function ownerList() { return owners.slice(); }
  function savedScrollY() { return saved ? saved.scrollY : null; }

  return {
    lock: lock,
    unlock: unlock,
    releaseAll: releaseAll,
    isLocked: isLocked,
    count: count,
    owners: ownerList,
    savedScrollY: savedScrollY
  };
});
