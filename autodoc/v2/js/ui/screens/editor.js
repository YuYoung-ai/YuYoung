/************************************************************
 * editor.js — Document Editor (폼 ⇄ 실시간 Preview + 생성)
 * ----------------------------------------------------------
 * S3: v1 엔진 브리지로 실제 미리보기(AD.Preview)·생성(AD.Renderers).
 * Preview 와 생성물은 동일 모델을 소비 → 구조 일치.
 ************************************************************/
import { h, clear } from '../dom.js';
import { templateService } from '../../core/template-service.js';
import { createForm } from '../../core/form-engine.js';
import { draft } from '../../core/draft.js';
import { documentEngine } from '../../core/document-engine.js';
import { previewEngine } from '../../core/preview-engine.js';
import { router } from '../../infra/router.js';
import { bus } from '../../infra/bus.js';
import { logger } from '../../infra/logger.js';

export function editorScreen() {
  let outletEl = null, form = null, tpl = null, draftId = 'current';
  let unsubLeave = null, previewBox = null, debTimer = null, genBtnRow = null;

  function schedulePreview() {
    clearTimeout(debTimer);
    debTimer = setTimeout(() => {
      previewEngine.render(tpl, form.getValues(), previewBox);
      updateGen();
    }, 300);
  }

  function updateGen() {
    const okBtns = form.validate().ok;
    genBtnRow.querySelectorAll('button[data-fmt]').forEach(b => { b.disabled = okBtns ? null : 'true'; });
  }

  async function onGenerate(formatId) {
    const r = form.focusFirstError();
    if (!r.ok) return;
    const status = document.getElementById('gen-status');
    status.textContent = '생성 중…';
    try {
      const res = await documentEngine.generate(tpl, form.getValues(), formatId);
      status.textContent = `완료: ${res.filename} (내 문서에 저장됨)`;
    } catch (e) {
      logger.error('E-RENDER', { meta: { e: String(e && e.message || e) } });
      status.textContent = '생성 실패 — 입력과 임시저장은 보존됩니다. 네트워크(라이브러리 CDN)를 확인하세요.';
    }
  }

  async function render() {
    clear(outletEl);
    const saved = await draft.get(tpl.id, draftId);
    const initialValues = saved ? saved.values : {};

    const progressBar = h('div', { class: 'progress' }, [h('div', { class: 'progress-fill' })]);
    previewBox = h('div', { class: 'preview-host' });

    // 사용 가능 포맷별 생성 버튼 (SplitButton 대체 — S3)
    const formats = documentEngine.availableFormats(tpl);
    const fmtButtons = formats.length
      ? formats.map(f => h('button', { class: 'btn primary', 'data-fmt': f.id, disabled: 'true',
          onclick: () => onGenerate(f.id) }, [`${f.icon || ''} ${f.label || f.id}`.trim()]))
      : [h('span', { class: 'empty', text: '사용 가능한 출력 형식이 없습니다.' })];
    genBtnRow = h('div', { class: 'gen-row' }, fmtButtons);

    form = createForm(tpl, {
      initialValues,
      onChange: ({ changedPaths }) => {
        progressBar.firstChild.style.width = form.progress() + '%';
        draft.save(tpl.id, draftId, form.getValues());
        bus.publish('document.edited', { templateId: tpl.id, changedPaths });
        schedulePreview();
      },
    });

    const formCol = h('div', { class: 'form-col' }, [
      h('div', { class: 'editor-head' }, [h('h1', { class: 'screen-title', text: tpl.name }), progressBar]),
      form.el,
      h('div', { class: 'editor-actions' }, [
        h('button', { class: 'btn', onclick: () => router.go('/catalog') }, ['← 목록']),
        genBtnRow,
      ]),
      h('div', { id: 'gen-status', class: 'gen-status', 'aria-live': 'polite' }),
    ]);

    const previewCol = h('div', { class: 'preview-col' }, [
      h('div', { class: 'preview-toolbar', text: '미리보기 (생성물과 동일 구조)' }),
      previewBox,
    ]);

    outletEl.appendChild(h('div', { class: 'editor-split' }, [formCol, previewCol]));
    progressBar.firstChild.style.width = form.progress() + '%';

    // 초기 미리보기 (엔진·테마 준비 후)
    previewBox.innerHTML = '<div class="empty">미리보기 준비 중…</div>';
    await previewEngine.ensure(tpl);
    previewEngine.render(tpl, form.getValues(), previewBox);
    updateGen();

    unsubLeave = router.onLeave(() => draft.saveNow(tpl.id, draftId, form.getValues()));
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
      clearTimeout(debTimer);
      if (unsubLeave) unsubLeave();
      if (form) form.destroy();
      if (outletEl) clear(outletEl);
    },
  };
}
