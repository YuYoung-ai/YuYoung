/************************************************************
 * AI Service (Phase 3) — 자동 요약 · 초안 작성 · 번역 · 교정
 *
 * 클라이언트는 GAS 프록시만 호출합니다. API 키는 GAS Script
 * Properties(ANTHROPIC_API_KEY)에 보관되어 브라우저에 노출되지
 * 않습니다. 실제 LLM 호출은 autodoc_gas.gs 의 aiCall_() 참조.
 *
 * 템플릿 선언: inputs[].ai = ["draft","summarize","proofread","translate"]
 * → Form Generator 가 해당 입력란에 버튼을 자동 부착합니다.
 ************************************************************/
AD.AI = (function () {

  var TASKS = {
    draft:     { label: '✨ AI 초안',   needText: false },
    summarize: { label: '📝 요약',      needText: true },
    proofread: { label: '🩺 교정',      needText: true },
    translate: { label: '🌐 영문 번역', needText: true }
  };

  function available() { return !!AD.config.GAS_URL; }

  /* task: TASKS 키 · text: 대상 텍스트 · context: {template, field, values} */
  function run(task, text, context) {
    if (!available()) return Promise.reject('GAS 백엔드 미설정 — AI 사용 불가');
    return fetch(AD.config.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   /* preflight 회피 (기존 규약) */
      body: JSON.stringify({ action: 'ai', task: task, text: text || '', context: context || {} })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.success && d.data && typeof d.data.text === 'string') return d.data.text;
      throw (d && d.error) || 'AI 요청 실패';
    });
  }

  return { TASKS: TASKS, available: available, run: run };
})();
