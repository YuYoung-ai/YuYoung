/************************************************************
 * validator.js — 입력값 검증 (FORM_ENGINE_SPEC · v1 문법 계승)
 * ----------------------------------------------------------
 * 필수 검사 + rules(조건 문법) 검사. blur/제출 시 호출.
 * 문법: <path>[.length] <op> <숫자|'문자열'>  (v1 VALIDATION 계승)
 ************************************************************/

function pathVal(path, values) {
  let o = values;
  path.split('.').some(k => { o = (o == null) ? undefined : o[k]; return o === undefined; });
  return o;
}

const OPS = {
  '==': (a, b) => a == b, '!=': (a, b) => a != b,
  '>=': (a, b) => a >= b, '<=': (a, b) => a <= b,
  '>': (a, b) => a > b, '<': (a, b) => a < b,
  'contains': (a, b) => String(a ?? '').includes(String(b)),
};

function evalCond(cond, values) {
  const m = /^(.+?)\s*(==|!=|>=|<=|>|<|contains)\s*(.+)$/.exec(String(cond).trim());
  if (!m) return true;
  let left = pathVal(m[1].trim(), values);
  let right = m[3].trim();
  if (/^'.*'$/.test(right) || /^".*"$/.test(right)) right = right.slice(1, -1);
  else if (!isNaN(Number(right))) { right = Number(right); left = Number(left) || 0; }
  const op = OPS[m[2]];
  return op ? op(left, right) : true;
}

export const validator = {
  /** 전체 검증 → { ok, errors:[{key,msg}] } */
  validate(values, tpl) {
    const errors = [];
    (tpl.inputs || []).forEach(f => {
      if (!f.required) return;
      const val = values[f.key];
      const empty = val == null || val === '' || (Array.isArray(val) && val.length === 0);
      if (empty) errors.push({ key: f.key, msg: `${f.label || f.key}은(는) 필수입니다` });
    });
    (tpl.rules || []).forEach(r => {
      // rule: { when?, cond, msg }  — cond 위반 시 msg
      if (r.when && !evalCond(r.when, values)) return;
      if (r.cond && !evalCond(r.cond, values)) errors.push({ key: r.key || null, msg: r.msg || '규칙 위반' });
    });
    return { ok: errors.length === 0, errors };
  },

  /** 단일 필드 검증 (blur 시) */
  validateField(f, values) {
    if (f.required) {
      const val = values[f.key];
      const empty = val == null || val === '' || (Array.isArray(val) && val.length === 0);
      if (empty) return { ok: false, msg: `${f.label || f.key}은(는) 필수입니다` };
    }
    return { ok: true };
  },

  /** 필수 기준 진행률 */
  progress(values, tpl) {
    const reqd = (tpl.inputs || []).filter(f => f.required);
    if (!reqd.length) return 100;
    const done = reqd.filter(f => {
      const v = values[f.key];
      return !(v == null || v === '' || (Array.isArray(v) && v.length === 0));
    }).length;
    return Math.round((done / reqd.length) * 100);
  },
};
