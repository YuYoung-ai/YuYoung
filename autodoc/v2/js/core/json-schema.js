/************************************************************
 * json-schema.js — JSON 계약 검증 (JSON_SCHEMA.md)
 * ----------------------------------------------------------
 * validate(contract, json) → { ok, violations[] }
 * S2: template.v1 중심(v1 스키마 호환). 나머지 계약은 점진 확장.
 ************************************************************/

const INPUT_TYPES = new Set([
  'text', 'number', 'date', 'week', 'textarea', 'table',
  'image', 'signature', 'checkbox', 'radio', 'select', 'file', 'repeat', 'dynamic',
]);

function req(obj, field, path, out) {
  if (obj[field] === undefined || obj[field] === null || obj[field] === '') {
    out.push(`${path}.${field} 필수`);
    return false;
  }
  return true;
}

const validators = {
  // v1 Template 스키마 호환 (JSON_SCHEMA §2: Template = template.v1)
  'template.v1'(t) {
    const v = [];
    req(t, 'id', 'template', v);
    req(t, 'name', 'template', v);
    if (!Array.isArray(t.inputs)) v.push('template.inputs 배열 필수');
    else t.inputs.forEach((f, i) => {
      const p = `inputs[${i}]`;
      req(f, 'key', p, v);
      const type = f.type || 'text';
      if (!INPUT_TYPES.has(type)) v.push(`${p}.type '${type}' 미지원`);
      if (type === 'table' && !Array.isArray(f.columns)) v.push(`${p}.columns 배열 필수(table)`);
      if ((type === 'select' || type === 'radio') && f.options && !Array.isArray(f.options)) v.push(`${p}.options 배열이어야 함`);
    });
    if (t.formats && !Array.isArray(t.formats)) v.push('template.formats 배열이어야 함');
    return v;
  },
};

export const jsonSchema = {
  validate(contract, json) {
    const fn = validators[contract];
    if (!fn) return { ok: true, violations: [], note: 'no-validator:' + contract };
    if (json == null || typeof json !== 'object') return { ok: false, violations: ['루트가 객체가 아님'] };
    const violations = fn(json);
    return { ok: violations.length === 0, violations };
  },
  supported() { return Object.keys(validators); },
};
