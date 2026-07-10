/************************************************************
 * localStorage 캐시 유틸 — 템플릿/테마/입력 초안 저장
 * 키에는 'ad_' 접두어를 붙여 기존 BAZ CS 키와 충돌을 피합니다.
 ************************************************************/
AD.store = {
  get: function (k, def) {
    try {
      var v = localStorage.getItem('ad_' + k);
      return v == null ? def : JSON.parse(v);
    } catch (e) { return def; }
  },
  set: function (k, v) {
    try { localStorage.setItem('ad_' + k, JSON.stringify(v)); } catch (e) {}
  },
  del: function (k) {
    try { localStorage.removeItem('ad_' + k); } catch (e) {}
  }
};
