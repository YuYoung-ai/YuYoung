/************************************************************
 * import-wizard.js — AI Import 마법사 (AI_IMPORT_UX.md)
 * ----------------------------------------------------------
 * 업로드→Prompt(복사)→외부 AI→JSON 붙여넣기→분석→결과 확인→제출.
 ************************************************************/
import { h, clear } from '../dom.js';
import { promptEngine } from '../../core/prompt-engine.js';
import { importGate } from '../../core/import-gate.js';
import { learning } from '../../core/learning.js';
import { confidence } from '../../core/confidence.js';
import { router } from '../../infra/router.js';

const STEPS = ['업로드', 'Prompt', 'AI 실행', '붙여넣기', '결과 확인', '완료'];

export function importWizardScreen() {
  let outletEl = null;
  const st = { step: 0, docType: 'report', prompt: null, envelope: null, proposals: [], selected: new Set(), submitted: 0 };

  function stepBar() {
    return h('div', { class: 'wiz-steps' }, STEPS.map((s, i) =>
      h('span', { class: 'wiz-step' + (i === st.step ? ' active' : (i < st.step ? ' done' : '')) }, [`${i + 1}. ${s}`])));
  }

  function copy(text, btn) {
    try { navigator.clipboard.writeText(text); if (btn) { const o = btn.textContent; btn.textContent = '복사됨 ✓'; setTimeout(() => btn.textContent = o, 1500); } }
    catch { /* 클립보드 불가 시 사용자 수동 선택 */ }
  }

  function render() {
    clear(outletEl);
    outletEl.appendChild(h('h1', { class: 'screen-title', text: 'AI로 양식·규칙 가져오기' }));
    outletEl.appendChild(stepBar());
    const body = h('div', { class: 'wiz-body card' });
    outletEl.appendChild(body);
    ({ 0: s0, 1: s1, 2: s2, 3: s3, 4: s4, 5: s5 })[st.step](body);
  }

  function nav(body, prev, next, nextLabel) {
    body.appendChild(h('div', { class: 'wiz-nav' }, [
      prev != null ? h('button', { class: 'btn', onclick: () => { st.step = prev; render(); } }, ['◂ 이전']) : h('span'),
      next != null ? h('button', { class: 'btn primary', onclick: next }, [nextLabel || '다음 ▸']) : h('span'),
    ]));
  }

  // 1) 업로드/종류
  function s0(body) {
    body.appendChild(h('p', { text: '분석할 회사 문서의 종류를 고르세요. (파일을 올리면 종류를 자동 인식)' }));
    const sel = h('select', { class: 'field-input', onchange: e => { st.docType = e.target.value; } },
      ['report', 'pptx', 'docx', 'xlsx', 'pdf', 'voc'].map(t => h('option', { value: t, text: t, selected: t === st.docType ? 'true' : null })));
    const file = h('input', { type: 'file', class: 'field-input',
      onchange: e => { const f = e.target.files[0]; if (f) { const ext = (f.name.split('.').pop() || '').toLowerCase(); st.docType = ext; sel.value = ['pptx','docx','xlsx','pdf'].includes(ext) ? ext : 'report'; } } });
    body.appendChild(h('div', { class: 'field' }, [h('label', { class: 'field-label', text: '문서 종류' }), sel]));
    body.appendChild(h('div', { class: 'field' }, [h('label', { class: 'field-label', text: '파일(선택)' }), file]));
    nav(body, null, () => { st.prompt = promptEngine.issue({ docType: st.docType, purpose: 'structure' }); st.step = 1; render(); });
  }

  // 2) Prompt 복사
  function s1(body) {
    body.appendChild(h('p', { text: '아래 Prompt를 복사해 원하는 AI(ChatGPT·Claude·Gemini 등)에 붙여넣고, [회사 문서] 자리에 실제 문서 내용을 넣어 실행하세요.' }));
    const ta = h('textarea', { class: 'field-input', rows: 12, readonly: 'true' }); ta.value = st.prompt.body;
    body.appendChild(ta);
    const copyBtn = h('button', { class: 'btn primary', onclick: () => copy(st.prompt.body, copyBtn) }, ['전체 복사']);
    body.appendChild(h('div', { class: 'wiz-row' }, [copyBtn, h('span', { class: 'tpl-meta', text: `analyzer: ${st.prompt.analyzer} · ${st.prompt.version}` })]));
    nav(body, 0, () => { st.step = 2; render(); });
  }

  // 3) 외부 AI 안내
  function s2(body) {
    body.appendChild(h('div', { class: 'wiz-hint' }, [
      h('p', { text: '이 창은 그대로 두세요 — AI에서 결과(JSON)를 복사한 뒤 돌아오면 이어집니다.' }),
      h('p', { class: 'tpl-meta', text: 'AI는 반드시 JSON 하나만 반환해야 합니다. 설명이 섞이면 다음 단계에서 재요청 안내가 나옵니다.' }),
    ]));
    nav(body, 1, () => { st.step = 3; render(); });
  }

  // 4) 붙여넣기 + 검증
  function s3(body) {
    body.appendChild(h('p', { text: 'AI가 준 JSON 결과를 붙여넣으세요.' }));
    const ta = h('textarea', { class: 'field-input', rows: 10, placeholder: '{ "contract": "autodoc.analysis.v1", ... }' });
    const status = h('div', { class: 'gen-status' });
    body.appendChild(ta); body.appendChild(status);
    const checkBtn = h('button', { class: 'btn primary', onclick: () => {
      const r = importGate.validate(ta.value, st.prompt.analyzer);
      if (r.error) {
        status.innerHTML = '';
        status.appendChild(h('div', {}, [h('b', { text: '✗ ' + r.error.code + ' — ' }), r.error.detail]));
        status.appendChild(h('div', { class: 'tpl-meta', text: '붙여넣은 내용은 그대로 있어요.' }));
        const reBtn = h('button', { class: 'btn small', onclick: () => copy(promptEngine.reissue(st.prompt, r.error.detail).body, reBtn) }, ['재요청 Prompt 복사']);
        status.appendChild(reBtn);
        return;
      }
      st.envelope = r.envelope;
      st.proposals = learning.proposalsFromEnvelope(r.envelope);
      st.selected = new Set(st.proposals.map((_, i) => i));
      status.textContent = `✅ 형식 확인됨 — 제안 ${st.proposals.length}건 (confidence ${(r.envelope.confidence * 100).toFixed(0)}%)`;
      st.step = 4; render();
    } }, ['검사']);
    body.appendChild(h('div', { class: 'wiz-nav' }, [
      h('button', { class: 'btn', onclick: () => { st.step = 2; render(); } }, ['◂ 이전']), checkBtn,
    ]));
  }

  // 5) 결과 확인 + 제출
  function s4(body) {
    if (!st.proposals.length) { body.appendChild(h('div', { class: 'empty', text: '추출된 제안이 없습니다.' })); nav(body, 3); return; }
    body.appendChild(h('p', { text: '추출된 회사 규칙·용어입니다. 승인함에 보낼 항목을 고르세요. (실제 반영은 승인 단계에서)' }));
    st.proposals.forEach((pr, i) => {
      const cb = h('input', { type: 'checkbox', onchange: e => { e.target.checked ? st.selected.add(i) : st.selected.delete(i); } });
      if (st.selected.has(i)) cb.checked = true;
      body.appendChild(h('label', { class: 'prop-row' }, [
        cb,
        h('span', { class: 'badge', text: confidence.label(pr.grade) }),
        h('b', { text: ' ' + pr.label }),
        h('div', { class: 'prop-after', text: JSON.stringify(pr.after).slice(0, 120) }),
      ]));
    });
    const submitBtn = h('button', { class: 'btn primary', onclick: async () => {
      const chosen = st.proposals.filter((_, i) => st.selected.has(i));
      if (!chosen.length) return;
      submitBtn.disabled = 'true'; submitBtn.textContent = '제출 중…';
      try { const r = await learning.submit(chosen); if (!outletEl) return; st.submitted = r.count; st.step = 5; render(); }
      catch (e) { submitBtn.disabled = null; submitBtn.textContent = '제출 실패 — 네트워크 확인'; }
    } }, ['승인함에 제출']);
    body.appendChild(h('div', { class: 'wiz-nav' }, [
      h('button', { class: 'btn', onclick: () => { st.step = 3; render(); } }, ['◂ 이전']), submitBtn,
    ]));
  }

  // 6) 완료
  function s5(body) {
    body.appendChild(h('div', { class: 'wiz-hint' }, [
      h('p', { text: `✅ ${st.submitted}건을 승인함에 제출했습니다.` }),
      h('p', { class: 'tpl-meta', text: '관리자 승인 후 회사 DNA·용어에 반영됩니다.' }),
    ]));
    body.appendChild(h('div', { class: 'wiz-nav' }, [
      h('button', { class: 'btn', onclick: () => { st.step = 0; st.envelope = null; st.proposals = []; render(); } }, ['새로 가져오기']),
      h('button', { class: 'btn primary', onclick: () => router.go('/admin/approvals') }, ['승인함으로 ▸']),
    ]));
  }

  return {
    mount(outlet) { outletEl = outlet; render(); },
    unmount() { if (outletEl) clear(outletEl); outletEl = null; },
  };
}
