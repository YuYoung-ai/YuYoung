/************************************************************
 * docs.js — 내 문서 (생성 이력) 화면
 * ----------------------------------------------------------
 * S3: 로컬 history 목록 + 다시 만들기(양식으로 이동).
 ************************************************************/
import { h, clear } from '../dom.js';
import { history } from '../../core/history.js';
import { draft } from '../../core/draft.js';
import { templateService } from '../../core/template-service.js';
import { router } from '../../infra/router.js';

export function docsScreen() {
  let outletEl = null;

  function fmtTime(iso) {
    try { return new Date(iso).toLocaleString('ko-KR'); } catch { return iso; }
  }

  async function render() {
    clear(outletEl);
    outletEl.appendChild(h('h1', { class: 'screen-title', text: '내 문서' }));

    await templateService.init().catch(() => {});
    const drafts = await draft.listMerged();
    if (!outletEl) return; // 이동 후 늦게 도착한 렌더가 다른 화면 위에 쌓이는 것 방지
    if (drafts.length) {
      outletEl.appendChild(h('h2', { class: 'cat-title', text: '이어서 작성 (임시저장)' }));
      outletEl.appendChild(h('div', { class: 'doc-list' }, drafts.map(d => {
        const tpl = templateService.get(d.templateId);
        return h('button', { class: 'doc-item card', onclick: () => router.go('/edit/' + d.templateId, { draft: d.draftId }) }, [
          h('b', { text: tpl ? tpl.name : d.templateId }),
          h('span', { class: 'tpl-meta', text: ' · ' + fmtTime(d.savedAt) + ' 저장' }),
          h('span', { class: 'btn small', text: '이어서 →' }),
        ]);
      })));
    }

    const list = await history.list();
    if (!outletEl) return;
    outletEl.appendChild(h('h2', { class: 'cat-title', text: '최근 생성 문서' }));
    if (!list.length) { outletEl.appendChild(h('div', { class: 'empty', text: '아직 생성한 문서가 없습니다.' })); return; }
    outletEl.appendChild(h('div', { class: 'doc-list' }, list.map(r =>
      h('div', { class: 'doc-item card' }, [
        h('b', { text: r.filename || r.name }),
        h('span', { class: 'tpl-meta', text: ` · ${(r.format || '').toUpperCase()} · ${fmtTime(r.at)}` }),
        h('button', { class: 'btn small', onclick: () => reopen(r) }, ['다시 만들기']),
      ])
    )));
  }

  /** 생성 당시 입력값이 있으면 전용 Draft 로 복원해 편집기를 연다 */
  async function reopen(r) {
    if (r.values && r.id) {
      const draftId = 'hist-' + r.id;
      await draft.saveNow(r.templateId, draftId, r.values);
      router.go('/edit/' + r.templateId, { draft: draftId });
      return;
    }
    router.go('/edit/' + r.templateId);
  }

  return {
    async mount(outlet) { outletEl = outlet; await render(); },
    unmount() { if (outletEl) clear(outletEl); outletEl = null; },
  };
}
