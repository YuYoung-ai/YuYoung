/************************************************************
 * editor.js — Document Editor 화면 (폼 ⇄ 미리보기)
 * ----------------------------------------------------------
 * S2: 폼 자동생성 + 진행률 + Draft 자동 저장/복원 + 값 요약.
 * S3에서 우측을 실제 PreviewEngine 으로 교체.
 ************************************************************/
import { h, clear } from '../dom.js';
import { templateService } from '../../core/template-service.js';
import { createForm } from '../../core/form-engine.js';
import { draft } from '../../core/draft.js';
import { router } from '../../infra/router.js';
import { bus } from '../../infra/bus.js';

export function editorScreen() {
  let outletEl = null, form = null, tpl = null, draftId = 'current';
  let unsubLeave = null;

  function summary(values) {
    // S3 이전 임시 미리보기: 값 요약
    const lines = (tpl.inputs || []).map(f => {
      const v = values[f.key];
      if (v == null || v === '') return null;
      const show = Array.isArray(v) ? `${v.length}행` : String(v).slice(0, 60);
      return h('div', { class: 'sum-row' }, [h('b', { text: (f.label || f.key) + ': ' }), show]);
    }).filter(Boolean);
    return h('div', { class: 'preview-stub' }, [
      h('div', { class: 'preview-page' }, [h('h3', { text: tpl.name }), ...(lines.length ? lines : [h('div', { class: 'empty', text: '입력하면 여기에 표시됩니다.' })])]),
      h('div', { class: 'preview-note', text: '※ 실제 문서 미리보기는 Sprint 3에서 제공됩니다.' }),
    ]);
  }

  async function render() {
    clear(outletEl);
    const saved = await draft.get(tpl.id, draftId);
    const initialValues = saved ? saved.values : {};

    const progressBar = h('div', { class: 'progress' }, [h('div', { class: 'progress-fill' })]);
    const previewCol = h('div', { class: 'preview-col' });
    const genBtn = h('button', { class: 'btn primary', disabled: 'true',
      onclick: onGenerate }, ['생성 (Sprint 3)']);

    function refreshPreview(values, progress) {
      clear(previewCol); previewCol.appendChild(summary(values));
      progressBar.firstChild.style.width = (progress ?? form.progress()) + '%';
      progressBar.setAttribute('aria-valuenow', String(progress ?? form.progress()));
      genBtn.disabled = form.validate().ok ? null : 'true';
    }

    form = createForm(tpl, {
      initialValues,
      onChange: ({ values, changedPaths, progress }) => {
        refreshPreview(values, progress);
        draft.save(tpl.id, draftId, values);
        bus.publish('document.edited', { templateId: tpl.id, changedPaths });
      },
    });

    const formCol = h('div', { class: 'form-col' }, [
      h('div', { class: 'editor-head' }, [
        h('h1', { class: 'screen-title', text: tpl.name }),
        progressBar,
      ]),
      form.el,
      h('div', { class: 'editor-actions' }, [
        h('button', { class: 'btn', onclick: () => router.go('/catalog') }, ['← 목록']),
        genBtn,
      ]),
    ]);

    outletEl.appendChild(h('div', { class: 'editor-split' }, [formCol, previewCol]));
    refreshPreview(initialValues, form.progress());

    // 이탈 시 Draft 즉시 저장 (차단 없음)
    unsubLeave = router.onLeave(() => draft.saveNow(tpl.id, draftId, form.getValues()));
  }

  function onGenerate() {
    const r = form.focusFirstError();
    if (!r.ok) return;
    // S3: DocumentEngine.assemble → Renderer. 지금은 안내.
    bus.publish('document.generated', { templateId: tpl.id, mock: true });
    alert('입력 검증 통과 — 실제 생성은 Sprint 3에서 연결됩니다.');
  }

  return {
    async mount(outlet, ctx) {
      outletEl = outlet;
      await templateService.init();
      tpl = templateService.get(ctx.params.templateId);
      if (ctx.params.draft) draftId = ctx.params.draft;
      if (!tpl) { outlet.appendChild(h('div', { class: 'card', text: '양식을 찾을 수 없습니다.' })); return; }
      await render();
    },
    unmount() {
      if (unsubLeave) unsubLeave();
      if (form) form.destroy();
      if (outletEl) clear(outletEl);
    },
  };
}
