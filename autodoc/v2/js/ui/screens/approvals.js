/************************************************************
 * approvals.js — 승인함 (HUMAN_APPROVAL.md · ADMIN_UX §5)
 * ----------------------------------------------------------
 * 대기 제안 조회 → 건별 승인/수정 후 승인/반려. 연속 처리.
 ************************************************************/
import { h, clear } from '../dom.js';
import { learning } from '../../core/learning.js';
import { confidence } from '../../core/confidence.js';

export function approvalsScreen() {
  let outletEl = null, items = [];

  function afterText(it) {
    const a = it.analysis || {};
    if (a.kbTerm) return `용어: ${a.kbTerm.canonical} (동의어: ${(a.kbTerm.synonyms || []).join(', ') || '-'})`;
    if (a.target) return `${a.target.path} → ${JSON.stringify(a.after).slice(0, 140)}`;
    return JSON.stringify(a).slice(0, 140);
  }

  async function load() {
    clear(outletEl);
    outletEl.appendChild(h('h1', { class: 'screen-title', text: '승인함' }));
    const listEl = h('div', { class: 'approve-list' });
    outletEl.appendChild(listEl);
    listEl.appendChild(h('div', { class: 'empty', text: '불러오는 중…' }));
    try { items = await learning.queue(); } catch { items = null; }
    clear(listEl);
    if (items == null) { listEl.appendChild(h('div', { class: 'empty', text: '백엔드에 연결할 수 없습니다.' })); return; }
    if (!items.length) { listEl.appendChild(h('div', { class: 'empty', text: '대기 중인 항목이 없습니다. 👍' })); return; }
    outletEl.querySelector('.screen-title').textContent = `승인함 — 대기 ${items.length}건`;
    items.forEach(it => listEl.appendChild(row(it)));
  }

  function row(it) {
    const grade = it.grade || confidence.grade((it.analysis || {}).confidence);
    const card = h('div', { class: 'approve-item card' });
    const reason = h('input', { class: 'field-input', placeholder: '사유(반려/수정 시)' });
    async function decide(decision) {
      card.style.opacity = '.5';
      try {
        await learning.decide(it, decision, reason.value);
        card.remove();
        items = items.filter(x => x !== it);
        const t = outletEl.querySelector('.screen-title');
        if (t) t.textContent = items.length ? `승인함 — 대기 ${items.length}건` : '승인함';
        if (!items.length) outletEl.querySelector('.approve-list').appendChild(h('div', { class: 'empty', text: '대기 중인 항목이 없습니다. 👍' }));
      } catch { card.style.opacity = '1'; }
    }
    card.appendChild(h('div', { class: 'approve-head' }, [
      h('span', { class: 'badge', text: confidence.label(grade) }),
      h('b', { text: ' ' + ((it.analysis && it.analysis.kbTerm) ? '용어 등록' : (it.analysis && it.analysis.target ? '회사 규칙: ' + it.analysis.target.path : '학습 제안')) }),
      h('span', { class: 'tpl-meta', text: '  근거: ' + ((it.analysis || {}).analyzer || '-') + ' ' + ((it.analysis || {}).promptVersion || '') }),
    ]));
    card.appendChild(h('div', { class: 'approve-after', text: afterText(it) }));
    card.appendChild(reason);
    card.appendChild(h('div', { class: 'approve-actions' }, [
      h('button', { class: 'btn primary', onclick: () => decide('approved') }, ['승인']),
      h('button', { class: 'btn', onclick: () => decide('rejected') }, ['반려']),
    ]));
    return card;
  }

  return {
    async mount(outlet) { outletEl = outlet; await load(); },
    unmount() { if (outletEl) clear(outletEl); },
  };
}
