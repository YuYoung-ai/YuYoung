/************************************************************
 * catalog.js — Template Catalog 화면 (SCREEN_STRUCTURE §5)
 * ----------------------------------------------------------
 * 카드 그리드 · 카테고리 · 검색 · Golden 첫 자리 · 권한 표시.
 ************************************************************/
import { h, clear } from '../dom.js';
import { templateService } from '../../core/template-service.js';
import { auth } from '../../infra/auth.js';
import { router } from '../../infra/router.js';

export function catalogScreen() {
  let outletEl = null;
  let query = '';

  function card(t) {
    const locked = (auth.session()?.level || 1) < (t.minLevel || 1);
    const meta = [t.golden ? '회사 표준' : null, 'v' + (t.version || '1'), (t.formats || []).join('·').toUpperCase()]
      .filter(Boolean).join(' · ');
    return h('button', {
      class: 'tpl-card card' + (t.golden ? ' golden' : '') + (locked ? ' locked' : ''),
      'aria-label': `${t.name}${t.golden ? ', 회사 표준' : ''}, 버전 ${t.version}`,
      disabled: locked ? 'true' : null,
      onclick: () => { if (!locked) router.go('/edit/' + t.id); },
    }, [
      h('div', { class: 'tpl-thumb', 'aria-hidden': 'true', text: (t.category || '문서')[0] }),
      h('div', { class: 'tpl-title' }, [
        t.golden ? h('span', { class: 'badge golden', text: '🏆' }) : null,
        ' ' + t.name, locked ? h('span', { class: 'badge', text: ' 🔒' }) : null,
      ]),
      h('div', { class: 'tpl-meta', text: meta }),
      t.desc ? h('div', { class: 'tpl-desc', text: t.desc }) : null,
    ]);
  }

  function render() {
    clear(outletEl);
    const search = h('input', { class: 'field-input', placeholder: '양식 이름·용도 검색…', 'aria-label': '양식 검색',
      value: query, oninput: e => { query = e.target.value; renderGrid(); } });

    const gridWrap = h('div', { class: 'catalog' });
    outletEl.appendChild(h('h1', { class: 'screen-title', text: '문서 만들기' }));
    outletEl.appendChild(h('div', { class: 'toolbar' }, [search]));
    outletEl.appendChild(gridWrap);

    function renderGrid() {
      clear(gridWrap);
      const items = templateService.list()
        .filter(t => !query || (t.name + (t.desc || '') + t.category).toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => (b.golden - a.golden) || a.name.localeCompare(b.name));
      if (!items.length) { gridWrap.appendChild(h('div', { class: 'empty', text: '검색 결과가 없습니다.' })); return; }
      const byCat = {};
      for (const t of items) (byCat[t.category] = byCat[t.category] || []).push(t);
      for (const [cat, arr] of Object.entries(byCat)) {
        gridWrap.appendChild(h('h2', { class: 'cat-title', text: cat }));
        gridWrap.appendChild(h('div', { class: 'card-grid' }, arr.map(card)));
      }
    }
    renderGrid();
  }

  return {
    async mount(outlet) {
      outletEl = outlet;
      await templateService.init();
      if (!outletEl) return; // 이동 후 늦게 도착한 렌더 방지
      render();
    },
    unmount() { if (outletEl) clear(outletEl); outletEl = null; },
  };
}
