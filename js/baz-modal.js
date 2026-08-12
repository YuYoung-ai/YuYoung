/*******************************************************************
 * baz-modal.js — 모달 접근성(포커스 트랩 · Esc · 복원) (BazModal)
 * -----------------------------------------------------------------
 * 왜 분리했나
 *   이력·상세·비밀번호 모달은 .show 클래스만 토글했다. role/aria-modal 이
 *   없어 스크린리더에는 그냥 페이지의 일부였고, 포커스가 배경에 남아 Tab 이
 *   모달 밖으로 빠져나갔으며, 닫은 뒤 포커스가 어디로 갔는지도 알 수 없었다.
 *   → 열기/닫기 · 포커스 진입/복원 · 트랩 · Esc 를 한곳에서 처리한다.
 *      배경 스크롤 잠금은 BazScrollLock 에 위임한다(전체화면과 충돌 방지).
 *
 * 브라우저: <script src="js/baz-modal.js"></script> → window.BazModal
 * 테스트  : require('../js/baz-modal.js')
 *******************************************************************/
(function (root, factory) {
  var api = factory(root);
  root.BazModal = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  var stack = [];   // 열려 있는 모달 스택 — 중첩(이력 위에 비밀번호)도 안전하게

  function scrollLock() {
    return (root && root.BazScrollLock) || null;
  }

  function visible(el) {
    if (!el) return false;
    if (el.disabled) return false;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
    if (typeof el.getClientRects === 'function') return el.getClientRects().length > 0;
    return true;
  }

  function focusables(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return [];
    return [].slice.call(container.querySelectorAll(FOCUSABLE)).filter(visible);
  }

  /**
   * 모달 요소에 접근성 속성을 심는다(열기 전 1회).
   * @param {Element} el
   * @param {Object} o { labelledBy, label, sheet } sheet = 실제 대화상자 박스
   */
  function markup(el, o) {
    if (!el || !el.setAttribute) return el;
    o = o || {};
    var dialog = (o.sheet && el.querySelector(o.sheet)) || el;
    dialog.setAttribute('role', o.role || 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    if (o.labelledBy) dialog.setAttribute('aria-labelledby', o.labelledBy);
    else if (o.label) dialog.setAttribute('aria-label', o.label);
    if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
    return dialog;
  }

  function topEntry() { return stack.length ? stack[stack.length - 1] : null; }

  /**
   * 모달 열기.
   * @param {Element} el 모달 루트(.show 로 표시되는 요소)
   * @param {Object} o { name, sheet, initialFocus, onClose, lockScroll }
   */
  function open(el, o) {
    if (!el) return null;
    o = o || {};
    var name = o.name || el.id || ('modal' + stack.length);
    if (stack.some(function (e) { return e.el === el; })) return topEntry();
    var doc = el.ownerDocument || (typeof document !== 'undefined' ? document : null);
    var entry = {
      el: el,
      name: name,
      sheet: (o.sheet && el.querySelector(o.sheet)) || el,
      returnFocus: (doc && doc.activeElement) || null,
      onClose: o.onClose || null,
      lockScroll: o.lockScroll !== false
    };
    stack.push(entry);
    el.classList.add('show');
    el.removeAttribute('aria-hidden');
    if (entry.lockScroll && scrollLock()) scrollLock().lock('modal:' + name);
    // 포커스 진입 — 지정 요소 → 첫 포커스 가능 요소 → 시트 자체
    var target = null;
    if (typeof o.initialFocus === 'string') target = el.querySelector(o.initialFocus);
    else if (o.initialFocus && o.initialFocus.focus) target = o.initialFocus;
    if (!target) target = focusables(entry.sheet)[0] || entry.sheet;
    try { if (target && target.focus) target.focus(); } catch (e) {}
    return entry;
  }

  /** 모달 닫기 — 포커스를 열기 직전 요소로 되돌린다 */
  function close(el) {
    var i = -1;
    for (var k = stack.length - 1; k >= 0; k--) { if (stack[k].el === el) { i = k; break; } }
    if (i < 0) {
      if (el) el.classList.remove('show');
      return false;
    }
    var entry = stack.splice(i, 1)[0];
    entry.el.classList.remove('show');
    if (entry.lockScroll && scrollLock()) scrollLock().unlock('modal:' + entry.name);
    if (entry.onClose) { try { entry.onClose(); } catch (e) {} }
    try { if (entry.returnFocus && entry.returnFocus.focus) entry.returnFocus.focus(); } catch (e) {}
    return true;
  }

  function closeTop() {
    var top = topEntry();
    return top ? close(top.el) : false;
  }

  function isOpen(el) { return stack.some(function (e) { return e.el === el; }); }
  function openCount() { return stack.length; }

  /**
   * keydown 처리 — Tab 트랩과 Esc 닫기.
   * 최상단 모달에만 적용된다(중첩 시 아래 모달은 그대로 유지).
   * @returns {String} '' | 'trap' | 'close'
   */
  function handleKeydown(e) {
    var top = topEntry();
    if (!top) return '';
    if (e.key === 'Escape') {
      if (e.preventDefault) e.preventDefault();
      /* 처리했다는 표시 — 이 리스너는 capture 단계에 걸려 있어서, 표시가 없으면
         bubble 단계의 다른 Esc 처리(예: 지도 전체화면 해제)가 같은 키 한 번에
         함께 실행된다(모달만 닫으려 했는데 전체화면까지 풀리는 문제). */
      e.__bazModalHandled = true;
      close(top.el);
      return 'close';
    }
    if (e.key !== 'Tab') return '';
    var list = focusables(top.sheet);
    if (!list.length) {
      if (e.preventDefault) e.preventDefault();
      try { top.sheet.focus(); } catch (_) {}
      return 'trap';
    }
    var doc = top.el.ownerDocument || (typeof document !== 'undefined' ? document : null);
    var active = doc && doc.activeElement;
    var first = list[0], last = list[list.length - 1];
    if (e.shiftKey && (active === first || !top.sheet.contains(active))) {
      if (e.preventDefault) e.preventDefault();
      try { last.focus(); } catch (_) {}
      return 'trap';
    }
    if (!e.shiftKey && (active === last || !top.sheet.contains(active))) {
      if (e.preventDefault) e.preventDefault();
      try { first.focus(); } catch (_) {}
      return 'trap';
    }
    return '';
  }

  /** 문서 전역에 keydown 리스너를 1회만 건다 */
  var bound = false;
  function bind(doc) {
    if (bound) return;
    var d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d) return;
    bound = true;
    d.addEventListener('keydown', function (e) { handleKeydown(e); }, true);
  }

  return {
    FOCUSABLE: FOCUSABLE,
    markup: markup,
    open: open,
    close: close,
    closeTop: closeTop,
    isOpen: isOpen,
    openCount: openCount,
    focusables: focusables,
    handleKeydown: handleKeydown,
    bind: bind
  };
});
