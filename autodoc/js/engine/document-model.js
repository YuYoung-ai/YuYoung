/************************************************************
 * Document Model — 렌더러 중립 문서 모델 (엔진의 핵심)
 * 템플릿(layout) + 사용자 입력값(values) → 모든 렌더러가
 * 동일하게 소비하는 중립 JSON을 조립합니다.
 *
 * 바인딩 규약
 *   '@key'        입력값 통째 바인딩 (배열도 가능 — 예: 표 rows)
 *   '@key.sub'    중첩 경로
 *   '@fn.today'   내장 함수 (today / now / currentWeek)
 *   '문자 @key 열' 문자열 내 보간
 *   '$color.x'    테마 토큰 (컴포넌트/렌더러에서 해석)
 ************************************************************/
AD.Model = (function () {

  var FN = {
    today: function () { return AD.date.ymd(new Date()); },
    now: function () {
      var d = new Date();
      return AD.date.ymd(d) + ' ' + AD.date.p2(d.getHours()) + ':' + AD.date.p2(d.getMinutes());
    },
    currentWeek: function () { return AD.date.wkLabel(AD.date.monday(new Date())); }
  };

  function fn(name) { return FN[name] ? FN[name]() : ''; }

  function lookup(path, values) {
    if (path.indexOf('fn.') === 0) return fn(path.slice(3));
    var o = values;
    path.split('.').some(function (k) { o = (o == null) ? undefined : o[k]; return o === undefined; });
    return o === undefined ? '' : o;
  }

  function resolve(v, values) {
    if (typeof v === 'string') {
      if (/^@[\w.]+$/.test(v)) return lookup(v.slice(1), values);   // 통째 바인딩 (배열 유지)
      return v.replace(/@([\w.]+)/g, function (m, p) {              // 문자열 내 보간
        var r = lookup(p, values);
        return (r == null || typeof r === 'object') ? '' : String(r);
      });
    }
    if (Array.isArray(v)) return v.map(function (x) { return resolve(x, values); });
    if (v && typeof v === 'object') {
      var o = {};
      Object.keys(v).forEach(function (k) { o[k] = resolve(v[k], values); });
      return o;
    }
    return v;
  }

  function assemble(tpl, values) {
    var layout = tpl.layout || {};
    return {
      meta: { id: tpl.id, name: tpl.name, version: tpl.version },
      grid: layout.grid || { cols: 12, rows: 8, gap: 0.1 },
      pages: (layout.pages || []).map(function (pg) {
        return {
          blocks: (pg.blocks || []).map(function (b) {
            return { component: b.component, area: b.area, abs: b.abs,
                     props: resolve(b.props || {}, values) };
          })
        };
      })
    };
  }

  return { assemble: assemble, fn: fn, resolve: resolve };
})();
