/************************************************************
 * GAS Provider — Google Apps Script ?action= 호출 (기존 패턴)
 * query 예: { url: '<GAS /exec URL>', action: 'all', params: {...} }
 * url 생략 시 AD.config.GAS_URL 사용. 미설정이면 빈 결과.
 ************************************************************/
AD.Providers.register({
  id: 'gas',
  fetch: function (query) {
    query = query || {};
    var base = query.url || AD.config.GAS_URL;
    if (!base) return Promise.resolve([]);
    var qs = 'action=' + encodeURIComponent(query.action || '');
    Object.keys(query.params || {}).forEach(function (k) {
      qs += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(query.params[k]);
    });
    return fetch(base + '?' + qs)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.success) return d.data;
        throw (d && d.error) || '데이터 로드 실패';
      });
  }
});
