/************************************************************
 * dom.js — 경량 DOM 헬퍼 (COMPONENT_SPEC · 프레임워크 없음)
 ************************************************************/
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c != null && c !== false) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
