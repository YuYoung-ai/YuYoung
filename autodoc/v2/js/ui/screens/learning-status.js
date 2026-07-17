/************************************************************
 * learning-status.js — 학습 상태 (LEARNING_MODE_UX.md)
 * ----------------------------------------------------------
 * Company DNA 버전 · Knowledge Base 용어 수 · 승인 대기 수 ·
 * Golden/양식 수. 지표 클릭 → 처리 화면.
 ************************************************************/
import { h, clear } from '../dom.js';
import { learning } from '../../core/learning.js';
import { router } from '../../infra/router.js';

export function learningStatusScreen() {
  let outletEl = null;

  function metric(title, value, note, onClick) {
    return h('button', { class: 'metric card', onclick: onClick || null, disabled: onClick ? null : 'true' }, [
      h('div', { class: 'metric-title', text: title }),
      h('div', { class: 'metric-value', text: String(value) }),
      note ? h('div', { class: 'metric-note', text: note }) : null,
    ]);
  }

  async function load() {
    clear(outletEl);
    outletEl.appendChild(h('h1', { class: 'screen-title', text: '학습 상태' }));
    const grid = h('div', { class: 'metric-grid' });
    outletEl.appendChild(grid);
    grid.appendChild(h('div', { class: 'empty', text: '불러오는 중…' }));
    let dna = { ver: 0 }, kb = [], queue = [], golden = [];
    try { dna = await learning.dna(); } catch {}
    try { kb = await learning.kbList(); } catch {}
    try { queue = await learning.queue(); } catch {}
    try { golden = await learning.goldenList(); } catch {}
    if (!outletEl) return; // 이동 후 늦게 도착한 렌더 방지
    clear(grid);
    grid.appendChild(metric('Company DNA', 'v' + (dna.ver || 0), '학습 반영 버전'));
    grid.appendChild(metric('Knowledge Base', kb.length, '등록 용어', () => router.go('/admin')));
    grid.appendChild(metric('승인 대기', queue.length, '처리하기 →', () => router.go('/admin/approvals')));
    grid.appendChild(metric('양식(Golden 포함)', golden.length, '서버 등록', null));
    outletEl.appendChild(h('p', { class: 'tpl-meta', text: '※ 지표는 GAS 백엔드 기준입니다. 승인 시 DNA 버전이 올라갑니다.' }));
  }

  return {
    async mount(outlet) { outletEl = outlet; await load(); },
    unmount() { if (outletEl) clear(outletEl); outletEl = null; },
  };
}
