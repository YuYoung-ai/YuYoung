/************************************************************
 * PDF Renderer (MVP 간이판) — 미리보기 HTML을 새 창에 렌더 후
 * 브라우저 인쇄(PDF로 저장)를 호출합니다. 라이브러리 0개.
 * Phase 3에서 html2pdf 계열로 고도화 예정 (계약 동일).
 ************************************************************/
(function () {
  AD.Renderers.register({
    id: 'pdf', label: 'PDF 인쇄', ext: '.pdf', icon: '🖨', print: true,

    render: function (model) {
      var win = window.open('', '_blank');
      if (!win) return Promise.reject('팝업이 차단되었습니다 — 팝업 허용 후 다시 시도');

      var css = [
        new URL('css/base.css', location.href).href,
        new URL('css/app.css', location.href).href
      ].map(function (u) { return '<link rel="stylesheet" href="' + u + '">'; }).join('');

      win.document.write('<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">' +
        '<title>' + AD.esc(model.meta.name || '문서') + '</title>' + css +
        '<style>@page{size:A4 landscape;margin:8mm}body{background:#fff;margin:0;padding:10px}' +
        '.ad-page{width:1100px;box-shadow:none;page-break-after:always}</style>' +
        '</head><body></body></html>');
      win.document.close();

      var c = win.document.createElement('div');
      win.document.body.appendChild(c);
      AD.Preview.render(model, c);

      setTimeout(function () { try { win.focus(); win.print(); } catch (e) {} }, 600);
      return Promise.resolve(null);   /* Blob 없음 — 인쇄 다이얼로그가 산출물 */
    }
  });
})();
