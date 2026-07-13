/************************************************************
 * admin.js — 관리 홈 (ADMIN_UX.md)
 * ----------------------------------------------------------
 * 오늘의 할 일(승인 대기) + 관리 영역 진입.
 ************************************************************/
import { h, clear } from '../dom.js';
import { learning } from '../../core/learning.js';
import { router } from '../../infra/router.js';

export function adminScreen() {
  let outletEl = null;

  async function load() {
    clear(outletEl);
    outletEl.appendChild(h('h1', { class: 'screen-title', text: '관리' }));

    const todo = h('div', { class: 'card' }, [h('b', { text: '오늘의 할 일' }), h('div', { class: 'tpl-meta', text: '불러오는 중…' })]);
    outletEl.appendChild(todo);
    let queue = [];
    try { queue = await learning.queue(); } catch {}
    clear(todo);
    todo.appendChild(h('b', { text: '오늘의 할 일' }));
    todo.appendChild(h('div', { class: 'todo-row' }, [
      h('span', { text: `● 승인 대기 ${queue.length}건` }),
      h('button', { class: 'btn small', onclick: () => router.go('/admin/approvals') }, ['처리 →']),
    ]));

    const tiles = [
      ['AI로 양식 가져오기', 'AI Import 마법사', '/admin/import'],
      ['승인함', '학습 제안 검토·승인', '/admin/approvals'],
      ['학습 상태', 'DNA·용어·대기 지표', '/admin/learning'],
      ['문서 만들기', '양식 카탈로그', '/catalog'],
    ];
    outletEl.appendChild(h('div', { class: 'admin-tiles' }, tiles.map(([t, d, path]) =>
      h('button', { class: 'admin-tile card', onclick: () => router.go(path) }, [
        h('b', { text: t }), h('div', { class: 'tpl-meta', text: d }),
      ]))));
  }

  return {
    async mount(outlet) { outletEl = outlet; await load(); },
    unmount() { if (outletEl) clear(outletEl); },
  };
}
