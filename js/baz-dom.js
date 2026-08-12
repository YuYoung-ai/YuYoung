/*******************************************************************
 * baz-dom.js — DOM 생성 · 이스케이프 · 안전 링크 (BazDom)
 * -----------------------------------------------------------------
 * 왜 분리했나
 *   hospital-pc.html 은 병원명·담당자·URL 같은 "원격 데이터"를 문자열로
 *   이어 붙여 innerHTML 에 넣고, 그 안에 onclick="openHist('…')" 같은
 *   인라인 핸들러까지 만들었다. escapeHtml() 로 HTML 문맥은 막아도
 *   그 값이 다시 JavaScript 문맥(onclick 속성 안)으로 들어가므로,
 *   따옴표·역슬래시가 섞인 병원명 하나로 코드가 실행되거나 버튼이 깨졌다.
 *   → HTML 이스케이프(문자열)와 DOM 생성(구조)의 책임을 여기서 나눈다.
 *      · 문자열 조합이 남아 있는 곳에는 escapeHtml/escapeAttr 만 쓴다.
 *      · 사용자 데이터가 "코드 문맥"에 들어갈 일이 있으면 el()/setText()로
 *        DOM API를 쓰고, 클릭은 data-* + 이벤트 위임으로 처리한다.
 *
 * 브라우저: <script src="js/baz-dom.js"></script> → window.BazDom
 * 테스트  : require('../js/baz-dom.js')
 *******************************************************************/
(function (root, factory) {
  var api = factory();
  root.BazDom = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var HTML_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /** HTML 텍스트 문맥용 이스케이프 (기존 escapeHtml 과 동일 동작) */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return HTML_MAP[c]; });
  }

  /** 속성값 문맥용 — 백틱·등호까지 막아 따옴표 없는 속성에도 안전하게 */
  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/[&<>"'`=]/g, function (c) {
      return HTML_MAP[c] || ('&#' + c.charCodeAt(0) + ';');
    });
  }

  /* ── 상태 → CSS 클래스: 허용 목록 매핑 ───────────────────────────────
     예전에는 서버가 준 상태 문자열을 class 속성에 그대로 넣었다.
     상태값에 공백·따옴표가 섞이면 클래스가 깨지거나 속성이 새어 나온다.
     허용 목록에 없으면 중립 클래스로 떨어뜨린다(스타일은 잃어도 안전). */
  var STATUS_CLASS = {
    '정상': 'st-normal',
    '점검대상': 'st-target',
    '권고': 'st-rec',
    '경고': 'st-warn',
    '미점검': 'st-none',
    '진행중': 'st-prog',
    '비대상': 'st-out'
  };
  function statusClass(status) {
    var k = String(status == null ? '' : status).trim();
    return Object.prototype.hasOwnProperty.call(STATUS_CLASS, k) ? STATUS_CLASS[k] : 'st-unknown';
  }
  function statusClassKeys() { return Object.keys(STATUS_CLASS); }

  /* ── URL 안전성 ────────────────────────────────────────────────────
     javascript:·data: 스킴이 병원명·주소를 타고 들어와 링크가 되는 것을 막는다.
     허용: http/https 절대 URL, 그리고 같은 앱 안의 상대 경로. */
  function safeUrl(u) {
    var s = String(u == null ? '' : u).trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    // 스킴처럼 보이는 것(javascript:, data:, vbscript: …)은 전부 거부
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return '';
    if (/^\/\//.test(s)) return '';           // 프로토콜 상대 URL도 거부
    return s;                                  // 상대 경로만 통과
  }

  /** 외부 지도 등 새 창 열기 — 항상 noopener/noreferrer */
  function openExternal(url, target) {
    var safe = safeUrl(url);
    if (!safe) return null;
    if (typeof window === 'undefined' || !window.open) return null;
    return window.open(safe, target || '_blank', 'noopener,noreferrer');
  }

  /* ── DOM 생성 헬퍼 ─────────────────────────────────────────────────
     el('button', {class:'hist', dataset:{hname:h.n}, text:'이력'})
     children 는 노드·문자열 배열. 문자열은 textNode 로 들어가므로
     어떤 값이 와도 마크업으로 해석되지 않는다. */
  function el(tag, attrs, children) {
    var doc = (typeof document !== 'undefined') ? document : null;
    if (!doc) throw new Error('el() requires a DOM');
    var node = doc.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') { node.textContent = String(v); return; }
      if (k === 'class' || k === 'className') { node.className = String(v); return; }
      if (k === 'dataset') {
        Object.keys(v).forEach(function (dk) { if (v[dk] != null) node.dataset[dk] = String(v[dk]); });
        return;
      }
      if (k === 'style' && typeof v === 'object') {
        Object.keys(v).forEach(function (sk) { node.style[sk] = v[sk]; });
        return;
      }
      if (k === 'href' || k === 'src') { var s = safeUrl(v); if (s) node.setAttribute(k, s); return; }
      if (v === true) { node.setAttribute(k, ''); return; }
      node.setAttribute(k, String(v));
    });
    appendChildren(node, children);
    return node;
  }

  function appendChildren(node, children) {
    if (children == null) return node;
    var doc = document;
    (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === 'object' && c.nodeType ? c : doc.createTextNode(String(c)));
    });
    return node;
  }

  /** 기존 자식을 모두 비우고 새 노드로 교체 */
  function replaceChildren(node, children) {
    if (!node) return node;
    while (node.firstChild) node.removeChild(node.firstChild);
    return appendChildren(node, children);
  }

  function setText(node, s) {
    if (node) node.textContent = (s == null ? '' : String(s));
    return node;
  }

  return {
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
    statusClass: statusClass,
    statusClassKeys: statusClassKeys,
    safeUrl: safeUrl,
    openExternal: openExternal,
    el: el,
    replaceChildren: replaceChildren,
    setText: setText
  };
});
