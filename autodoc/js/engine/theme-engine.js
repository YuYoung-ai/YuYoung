/************************************************************
 * Theme Engine — 색/폰트/여백 토큰 관리
 * 템플릿·컴포넌트는 색을 직접 쓰지 않고 토큰('$color.primary')만
 * 참조합니다. 테마 교체 = 전 문서 일괄 리브랜딩.
 ************************************************************/
AD.Theme = (function () {
  var cur = null;

  function load(id) {
    id = id || AD.config.DEFAULT_THEME;
    return fetch('themes/' + id + '.json')
      .then(function (r) { if (!r.ok) throw 'not found'; return r.json(); })
      .then(function (t) { cur = t; AD.store.set('theme_' + id, t); return t; })
      .catch(function () {
        var c = AD.store.get('theme_' + id);          // 오프라인: 캐시 폴백
        if (c) { cur = c; return c; }
        throw '테마 로드 실패: ' + id;
      });
  }

  /* 'color.primary' → '#1B2F5E' */
  function token(path) {
    var o = cur;
    String(path).split('.').some(function (k) { o = o ? o[k] : undefined; return o === undefined; });
    return o;
  }

  /* '$color.primary' 형태면 토큰 해석, 아니면 그대로 */
  function resolve(v) {
    return (typeof v === 'string' && v.charAt(0) === '$') ? token(v.slice(1)) : v;
  }

  /* 미리보기용: 테마 → CSS 변수 주입 */
  function cssVars(el) {
    if (!cur) return;
    var c = cur.color || {};
    Object.keys(c).forEach(function (k) { el.style.setProperty('--ad-' + k, c[k]); });
    if (cur.font && cur.font.family) el.style.setProperty('--ad-font', cur.font.family);
  }

  return { load: load, token: token, resolve: resolve, get: function () { return cur; }, cssVars: cssVars };
})();
