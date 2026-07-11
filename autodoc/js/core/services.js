/************************************************************
 * TemplateService / HistoryService / DraftService
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

  function post(body) {
    return fetch(AD.config.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   /* preflight 회피 (기존 규약) */
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.success) return d;
      throw (d && d.error) || '요청 실패';
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

  /* ── 관리자용 (Phase 2) ── */

  /* 전체 템플릿(보관 포함, GAS) 또는 정적 전문 목록 */
  function listAll() {
    if (AD.config.GAS_URL) {
      return AD.Providers.get('gas').fetch({ action: 'templatesAll' });
    }
    return Promise.all(AD.config.STATIC_TEMPLATES.map(function (id) {
      return fromStatic(id).catch(function () { return null; });
    })).then(function (arr) { return arr.filter(Boolean); });
  }

  /* 저장(버전 스냅샷은 GAS가 자동). GAS 미설정이면 JSON 다운로드 폴백 */
  function save(tpl, user, status) {
    if (!AD.config.GAS_URL) {
      var blob = new Blob([JSON.stringify(tpl, null, 2)], { type: 'application/json' });
      AD.download(blob, tpl.id + '.json');
      return Promise.resolve({ success: true, downloaded: true });
    }
    return post({ action: 'templateSave', template: tpl, user: user || '', status: status || '활성' });
  }

  function setStatus(id, status, user) {
    return post({ action: 'templateStatus', id: id, status: status, user: user || '' });
  }

  function history(id) {
    return AD.Providers.get('gas').fetch({ action: 'templateHistory', params: { id: id } });
  }

  function restore(id, histRow, user) {
    return post({ action: 'templateRestore', id: id, histRow: histRow, user: user || '' });
  }

  return { load: load, list: list, listAll: listAll,
           save: save, setStatus: setStatus, history: history, restore: restore,
           _post: post };
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
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: 'log' }, ev))
    }).catch(function () {});
  }
};

/* ── 초안 제출/승인 워크플로 (Phase 2, GAS 필요) ── */
AD.Drafts = {
  submit: function (tpl, values, user) {
    return AD.Templates._post({ action: 'draftSave',
      template: tpl.id, name: tpl.name, version: tpl.version,
      user: user || '', values: values });
  },
  list: function (status) {
    return AD.Providers.get('gas').fetch({ action: 'drafts', params: status ? { status: status } : {} });
  },
  review: function (row, status, reviewer, comment) {
    return AD.Templates._post({ action: 'draftReview',
      row: row, status: status, reviewer: reviewer || '', comment: comment || '' });
  }
};
