/************************************************************
 * Manual Provider — 사용자가 폼에 직접 입력한 값을 그대로 공급
 * (프리필 없는 기본 경로. 인터페이스 일관성을 위해 존재)
 ************************************************************/
AD.Providers.register({
  id: 'manual',
  fetch: function (query) {
    return Promise.resolve((query && query.values) || {});
  }
});
