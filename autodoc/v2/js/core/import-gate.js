/************************************************************
 * import-gate.js — JSON Contract 검증 (AI_ARCHITECTURE §4)
 * ----------------------------------------------------------
 * 붙여넣은 AI 응답 검증. 비-JSON=E1 / 봉투 위반=E2 / payload 위반=E3.
 * 구문 정리(코드펜스 제거)만 허용 — 의미 보정 금지.
 ************************************************************/
import { CONTRACT } from './prompt-engine.js';
import { jsonSchema } from './json-schema.js';

function stripFence(text) {
  let t = String(text || '').trim();
  // ```json ... ``` 또는 ``` ... ``` 펜스 제거 (구문 정리만)
  const m = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/.exec(t);
  if (m) t = m[1].trim();
  return t;
}

const KNOWN_PAYLOAD = ['writingStyle', 'colorRule', 'sectionOrder', 'tableRule', 'brandRule', 'fontRule', 'terms', 'template'];

export const importGate = {
  /** validate(text, expectedAnalyzer?) → { ok, envelope } | { error:{code,detail} } */
  validate(text, expectedAnalyzer) {
    const cleaned = stripFence(text);
    if (!cleaned) return { error: { code: 'E-IMPORT-E1', detail: '내용이 비어 있습니다' } };

    let env;
    try { env = JSON.parse(cleaned); }
    catch (e) { return { error: { code: 'E-IMPORT-E1', detail: 'AI가 JSON 외의 설명을 함께 보냈어요' } }; }

    if (!env || typeof env !== 'object') return { error: { code: 'E-IMPORT-E1', detail: 'JSON 객체가 아닙니다' } };

    // 봉투 검증 (E2)
    if (env.contract !== CONTRACT) return { error: { code: 'E-IMPORT-E2', detail: `contract 불일치(기대: ${CONTRACT})` } };
    if (!env.analyzer) return { error: { code: 'E-IMPORT-E2', detail: 'analyzer 누락' } };
    if (expectedAnalyzer && env.analyzer !== expectedAnalyzer)
      return { error: { code: 'E-IMPORT-E2', detail: `analyzer 불일치(기대: ${expectedAnalyzer})` } };
    if (!env.promptVersion) return { error: { code: 'E-IMPORT-E2', detail: 'promptVersion 누락' } };
    if (typeof env.confidence !== 'number' || env.confidence < 0 || env.confidence > 1)
      return { error: { code: 'E-IMPORT-E2', detail: 'confidence(0~1) 누락/오류' } };

    // payload 검증 (E3)
    if (!env.payload || typeof env.payload !== 'object')
      return { error: { code: 'E-IMPORT-E3', detail: 'payload 누락' } };
    const keys = Object.keys(env.payload).filter(k => KNOWN_PAYLOAD.includes(k));
    if (!keys.length)
      return { error: { code: 'E-IMPORT-E3', detail: '인식 가능한 payload 항목이 없습니다' } };
    if (env.payload.terms && !Array.isArray(env.payload.terms))
      return { error: { code: 'E-IMPORT-E3', detail: 'payload.terms 는 배열이어야 합니다' } };
    if (env.payload.template != null) {
      const t = env.payload.template;
      if (typeof t !== 'object' || Array.isArray(t))
        return { error: { code: 'E-IMPORT-E3', detail: 'payload.template 은 객체여야 합니다' } };
      // id 는 승인 시 자동 부여 — 검증용 placeholder 로 채워 스키마만 확인
      const v = jsonSchema.validate('template.v1', { id: t.id || '_pending_', name: t.name, inputs: t.inputs, formats: t.formats });
      if (!v.ok)
        return { error: { code: 'E-IMPORT-E3', detail: 'payload.template 위반: ' + v.violations.join(', ') } };
    }

    env.warnings = Array.isArray(env.warnings) ? env.warnings : [];
    return { ok: true, envelope: env };
  },
};
