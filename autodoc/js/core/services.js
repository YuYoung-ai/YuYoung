/************************************************************
 * TemplateService / HistoryService
 * 템플릿 로드 우선순위: GAS(시트) → localStorage 캐시 → 정적 templates/
 * GAS_URL 미설정 시 정적 JSON만으로 동작합니다.
 ************************************************************/

AD.Templates = (function () {

  function fromStatic(id) {
    return fetch('templates/' + id + '.json').then(function (r) {
      if (!r.ok) throw '템플릿 없음: ' + id;
      return r.json();
    });
  }

  function load(id) {
    if (!id) return Promise.reject('템플릿 id가 없습니다');
    if (AD.config.GAS_URL) {
      return AD.Providers.get('gas').fetch({ action: 'template', params: { id: id } })
        .then(function (tpl) {
          if (typeof tpl === 'string') tpl = JSON.parse(tpl);
          AD.store.set('tpl_' + id, tpl);
          return tpl;
        })
        .catch(function () {
          var c = AD.store.get('tpl_' + id);
          if (c) return c;
          return fromStatic(id);
        });
    }
    return fromStatic(id).then(function (tpl) {
      AD.store.set('tpl_' + id, tpl);
      return tpl;
    }).catch(function (e) {
      var c = AD.store.get('tpl_' + id);
      if (c) return c;
      throw e;
    });
  }

  /* 카탈로그용 메타 목록 (권한 레벨 필터) */
  function list(userLevel) {
    var p;
    if (AD.config.GAS_URL) {
      p = AD.Providers.get('gas').fetch({ action: 'templates' })
        .catch(function () { return staticList(); });
    } else {
      p = staticList();
    }
    return p.then(function (arr) {
      return (arr || []).filter(function (t) {
        return (t.minLevel || 1) <= (userLevel || 1);
      });
    });
  }

  function staticList() {
    return Promise.all(AD.config.STATIC_TEMPLATES.map(function (id) {
      return fromStatic(id).then(function (t) {
        return { id: t.id, name: t.name, category: t.category, version: t.version,
                 minLevel: t.minLevel || 1, formats: t.formats || [], desc: t.desc || '' };
      }).catch(function () { return null; });
    })).then(function (arr) { return arr.filter(Boolean); });
  }

  return { load: load, list: list };
})();

AD.History = {
  /* 생성 이력 기록 — GAS 미설정 시 로컬에만 최근 50건 보관 */
  log: function (ev) {
    ev.ts = new Date().toISOString();
    var local = AD.store.get('history', []);
    local.unshift(ev);
    AD.store.set('history', local.slice(0, 50));
    if (!AD.config.GAS_URL) return Promise.resolve();
    return fetch(AD.config.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   /* preflight 회피 (기존 규약) */
      body: JSON.stringify(Object.assign({ action: 'log' }, ev))
    }).catch(function () {});
  }
};
