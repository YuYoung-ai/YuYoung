/************************************************************
 * editor.js — Document Editor (폼 ⇄ 실시간 Preview + 생성 + 편집)
 * ----------------------------------------------------------
 * S3: 실제 미리보기·생성 · S4: Undo/Redo(값 스냅샷) · 제안 칩.
 ************************************************************/
import { h, clear } from '../dom.js';
import { templateService } from '../../core/template-service.js';
import { createForm } from '../../core/form-engine.js';
import { createUndo } from '../../core/undo.js';
import { memorySuggest } from '../../core/memory-suggest.js';
import { draft } from '../../core/draft.js';
import { documentEngine } from '../../core/document-engine.js';
import { previewEngine } from '../../core/preview-engine.js';
import { router } from '../../infra/router.js';
import { bus } from '../../infra/bus.js';
import { logger } from '../../infra/logger.js';

export function editorScreen() {
  let outletEl = null, form = null, tpl = null, draftId = 'current';
  let unsubLeave = null, previewBox = null, debTimer = null, genBtnRow = null;
  let formMount = null, progressBar = null, mem = null;
  const undo = createUndo();
  let keyHandler = null;

  function schedulePreview() {
    clearTimeout(debTimer);
    debTimer = setTimeout(() => {
      undo.record(form.getValues());
      refreshUndoButtons();
      previewEngine.render(tpl, form.getValues(), previewBox);
      updateGen();
    }, 300);
  }

  function updateGen() {
    const ok = form.validate().ok;
    genBtnRow.querySelectorAll('button[data-fmt]').forEach(b => { b.disabled = ok ? null : 'true'; });
  }

  function refreshUndoButtons() {
    const u = document.getElementById('btn-undo'), r = document.getElementById('btn-redo');
    if (u) u.disabled = undo.canUndo() ? null : 'true';
    if (r) r.disabled = undo.canRedo() ? null : 'true';
  }

  function buildForm(initialValues) {
    if (form) form.destroy();
    form = createForm(tpl, {
      initialValues,
      suggest: mem ? (key, vals) => mem.suggest(key, vals) : null,
      onSuggestAccept: mem ? (key, val) => mem.accept(key, val) : null,
      onChange: ({ changedPaths }) => {
        progressBar.firstChild.style.width = form.progress() + '%';
        draft.save(tpl.id, draftId, form.getValues());
        bus.publish('document.edited', { templateId: tpl.id, changedPaths });
        schedulePreview();
      },
    });
    clear(formMount); formMount.appendChild(form.el);
    progressBar.firstChild.style.width = form.progress() + '%';
  }

  function applySnapshot(state) {
    if (!state) return;
    buildForm(state);
    refreshUndoButtons();
    previewEngine.render(tpl, form.getValues(), previewBox);
    updateGen();
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
      status.textContent = '생성 실패 — 입력·임시저장은 보존됩니다. 네트워크(CDN)를 확인하세요.';
    }
  }

  async function render() {
    clear(outletEl);
    const saved = await draft.get(tpl.id, draftId);
    const initialValues = saved ? saved.values : {};
    mem = await memorySuggest.forTemplate(tpl.id).catch(() => null);

    progressBar = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, [h('div', { class: 'progress-fill' })]);
    previewBox = h('div', { class: 'preview-host' });
    formMount = h('div', { class: 'form-mount' });

    const formats = documentEngine.availableFormats(tpl);
    const fmtButtons = formats.length
      ? formats.map(f => h('button', { class: 'btn primary', 'data-fmt': f.id, disabled: 'true', onclick: () => onGenerate(f.id) }, [`${f.icon || ''} ${f.label || f.id}`.trim()]))
      : [h('span', { class: 'empty', text: '사용 가능한 출력 형식이 없습니다.' })];
    genBtnRow = h('div', { class: 'gen-row' }, fmtButtons);

    const undoBtn = h('button', { id: 'btn-undo', class: 'btn small', disabled: 'true', 'aria-label': '실행 취소',
      onclick: () => applySnapshot(undo.undo()) }, ['↶ 취소']);
    const redoBtn = h('button', { id: 'btn-redo', class: 'btn small', disabled: 'true', 'aria-label': '다시 실행',
      onclick: () => applySnapshot(undo.redo()) }, ['↷ 다시']);

    const formCol = h('div', { class: 'form-col' }, [
      h('div', { class: 'editor-head' }, [h('h1', { class: 'screen-title', text: tpl.name }), progressBar, undoBtn, redoBtn]),
      formMount,
      h('div', { class: 'editor-actions' }, [h('button', { class: 'btn', onclick: () => router.go('/catalog') }, ['← 목록']), genBtnRow]),
      h('div', { id: 'gen-status', class: 'gen-status', 'aria-live': 'polite' }),
    ]);
    const previewCol = h('div', { class: 'preview-col' }, [
      h('div', { class: 'preview-toolbar', text: '미리보기 (생성물과 동일 구조)' }), previewBox,
    ]);
    outletEl.appendChild(h('div', { class: 'editor-split' }, [formCol, previewCol]));

    buildForm(initialValues);
    undo.init(form.getValues());

    // 키보드 Undo/Redo (텍스트 입력 중엔 네이티브 우선)
    keyHandler = (e) => {
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '');
      if ((e.ctrlKey || e.metaKey) && !inField) {
        if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); applySnapshot(undo.undo()); }
        else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); applySnapshot(undo.redo()); }
      }
    };
    document.addEventListener('keydown', keyHandler);

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
      if (keyHandler) document.removeEventListener('keydown', keyHandler);
      if (unsubLeave) unsubLeave();
      if (form) form.destroy();
      if (outletEl) clear(outletEl);
    },
  };
}
