/************************************************************
 * Renderer 공통 — 렌더러 계약 + 라이브러리 지연 로더 + 다운로드
 * 렌더러 계약: { id, label, ext, render(model) → Promise<Blob|null> }
 * 이 계약만 지키면 어떤 포맷도 본체 수정 없이 추가됩니다.
 ************************************************************/

/* 다중 CDN 폴백 지연 로더 (weekly.html loadXlsxLib / dashboard.html 패턴 이관) */
AD.loadLib = function (globalName, urls) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  return urls.reduce(function (chain, url) {
    return chain.catch(function () {
      return new Promise(function (res, rej) {
        var s = document.createElement('script');
        s.src = url;
        s.onload = function () { window[globalName] ? res() : rej('init'); };
        s.onerror = function () { rej('cdn'); };
        document.head.appendChild(s);
      });
    });
  }, Promise.reject('start'))
  .then(function () { return window[globalName]; })
  .catch(function () { throw '라이브러리 로드 실패(' + globalName + ') — 네트워크 확인'; });
};

AD.Renderers = (function () {
  var list = [];
  return {
    register: function (r) { list.push(r); },
    get: function (id) { return list.filter(function (r) { return r.id === id; })[0]; },
    all: function () { return list.slice(); }
  };
})();

/* Blob 다운로드 (모바일 브라우저 대응 — index.html 패턴) */
AD.download = function (blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
};
