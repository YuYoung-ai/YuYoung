/************************************************************
 * Validator — 필수값 + 템플릿 rules 기반 검증
 * rule 예: { "if": "rows.length == 0", "warn": "..." }
 *          { "if": "writer == ''",     "error": "..." }
 * error = 생성 차단, warn = 확인 후 진행
 ************************************************************/
AD.Validator = (function () {

  function pathVal(path, values) {
    var o = values;
    path.split('.').some(function (k) { o = (o == null) ? undefined : o[k]; return o === undefined; });
    return o;
  }

  /* 지원 문법: <path>[.length] <op> <숫자|'문자열'> */
  function evalCond(cond, values) {
    var m = String(cond || '').match(/^\s*([\w.]+?)(\.length)?\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$/);
    if (!m) return false;
    var left = pathVal(m[1], values);
    if (m[2]) left = (left && left.length) || 0;
    var rs = m[4].replace(/^['"]|['"]$/g, '');
    var right = /^-?\d+(\.\d+)?$/.test(rs) ? Number(rs) : rs;
    if (typeof right === 'number') left = Number(left) || 0;
    switch (m[3]) {
      case '==': return left == right;
      case '!=': return left != right;
      case '>=': return left >= right;
      case '<=': return left <= right;
      case '>':  return left > right;
      case '<':  return left < right;
    }
    return false;
  }

  function validate(values, tpl) {
    var errors = [], warns = [];
    (tpl.inputs || []).forEach(function (f) {
      if (!f.required) return;
      var v = values[f.key];
      if (v == null || v === '' || (Array.isArray(v) && !v.length))
        errors.push('[' + f.label + '] 항목은 필수입니다');
    });
    (tpl.rules || []).forEach(function (r) {
      if (!evalCond(r.if, values)) return;
      if (r.error) errors.push(r.error);
      else if (r.warn) warns.push(r.warn);
    });
    return { ok: !errors.length, errors: errors, warns: warns };
  }

  return { validate: validate, evalCond: evalCond };
})();
