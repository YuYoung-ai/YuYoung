/************************************************************
 * Local Provider — 정적 JSON 파일 / localStorage 데이터
 * query 예: { path: 'data/staff.json' } 또는 { store: 'draft_x' }
 ************************************************************/
AD.Providers.register({
  id: 'local',
  fetch: function (query) {
    query = query || {};
    if (query.store) return Promise.resolve(AD.store.get(query.store, []));
    if (query.path) {
      return fetch(query.path).then(function (r) {
        if (!r.ok) throw '파일 없음: ' + query.path;
        return r.json();
      });
    }
    return Promise.resolve([]);
  }
});
