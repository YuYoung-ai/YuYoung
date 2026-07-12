/************************************************************
 * docs.js — 내 문서 (생성 이력) 화면
 * ----------------------------------------------------------
 * S3: 로컬 history 목록 + 다시 만들기(양식으로 이동).
 ************************************************************/
import { h, clear } from '../dom.js';
import { history } from '../../core/history.js';
import { draft } from '../../core/draft.js';
import { router } from '../../infra/router.js';

export function docsScreen() {
  let outletEl = null;

  function fmtTime(iso) {
    try { return new Date(iso).toLocaleString('ko-KR'); } catch { return iso; }
  }

  async function render() {
    clear(outletEl);
    outletEl.appendChild(h('h1', { class: 'screen-title', text: '내 문서' }));

    const drafts = await draft.list();
    if (drafts.length) {
      outletEl.appendChild(h('h2', { class: 'cat-title', text: '이어서 작성 (임시저장)' }));
      outletEl.appendChild(h('div', { class: 'doc-list' }, drafts.map(d =>
        h('button', { class: 'doc-item card', onclick: () => router.go('/edit/' + d.templateId, { draft: d.draftId }) }, [
          h('b', { text: d.templateId }), h('span', { class: 'tpl-meta', text: ' · ' + fmtTime(d.savedAt) }),
        ])
      )));
    }

    const list = await history.list();
    outletEl.appendChild(h('h2', { class: 'cat-title', text: '최근 생성 문서' }));
    if (!list.length) { outletEl.appendChild(h('div', { class: 'empty', text: '아직 생성한 문서가 없습니다.' })); return; }
    outletEl.appendChild(h('div', { class: 'doc-list' }, list.map(r =>
      h('div', { class: 'doc-item card' }, [
        h('b', { text: r.filename || r.name }),
        h('span', { class: 'tpl-meta', text: ` · ${(r.format || '').toUpperCase()} · ${fmtTime(r.at)}` }),
        h('button', { class: 'btn small', onclick: () => router.go('/edit/' + r.templateId) }, ['다시 만들기']),
      ])
    )));
  }

  return {
    async mount(outlet) { outletEl = outlet; await render(); },
    unmount() { if (outletEl) clear(outletEl); },
  };
}
