/************************************************************
 * PDF Renderer (Phase 3 고도화) — html2pdf.js 로 실제 .pdf Blob 생성
 * 미리보기 HTML(DocumentModel 렌더)을 화면 밖 컨테이너에 그려
 * A4 가로 PDF 로 캡처합니다. 라이브러리 로드 실패 시 기존
 * 브라우저 인쇄 다이얼로그로 폴백합니다.
 ************************************************************/
(function () {
  var CDNS = [
    'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
    'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js'
  ];

  /* 폴백: 새 창 인쇄 (MVP 방식 유지) */
  function printFallback(model) {
    var win = window.open('', '_blank');
    if (!win) return Promise.reject('팝업이 차단되었습니다 — 팝업 허용 후 다시 시도');
    var css = [
      new URL('css/base.css', location.href).href,
      new URL('css/app.css', location.href).href
    ].map(function (u) { return '<link rel="stylesheet" href="' + u + '">'; }).join('');
    win.document.write('<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">' +
      '<title>' + AD.esc(model.meta.name || '문서') + '</title>' + css +
      '<style>@page{size:A4 landscape;margin:8mm}body{background:#fff;margin:0;padding:10px}' +
      '.ad-page{width:1100px;box-shadow:none;page-break-after:always}</style></head><body></body></html>');
    win.document.close();
    var c = win.document.createElement('div');
    win.document.body.appendChild(c);
    AD.Preview.render(model, c);
    setTimeout(function () { try { win.focus(); win.print(); } catch (e) {} }, 600);
    return Promise.resolve(null);
  }

  AD.Renderers.register({
    id: 'pdf', label: 'PDF 생성', ext: '.pdf', icon: '🖨',

    render: function (model) {
      return AD.loadLib('html2pdf', CDNS).then(function (lib) {
        /* host(absolute, 뒤쪽 레이어)는 화면 가림 방지용.
           html2pdf 는 .from() 대상을 자체 컨테이너에 복제해 높이를 재는데,
           대상이 absolute 면 컨테이너 높이가 0 이 되므로 캡처 대상은
           반드시 정적(static) 내부 래퍼(inner)로 넘긴다. */
        var host = document.createElement('div');
        host.style.cssText = 'position:absolute;left:0;top:0;width:1100px;background:#fff;z-index:-9999;pointer-events:none';
        var inner = document.createElement('div');
        inner.style.cssText = 'width:1100px;background:#fff';
        host.appendChild(inner);
        document.body.appendChild(host);
        AD.Preview.render(model, inner);
        Array.prototype.forEach.call(inner.querySelectorAll('.ad-page'), function (p, i, arr) {
          p.style.boxShadow = 'none';
          p.style.border = 'none';
          /* html2pdf 클론에서 aspect-ratio 가 유실되지 않도록 높이를 픽셀로 고정 */
          p.style.aspectRatio = 'auto';
          p.style.height = Math.round(p.clientWidth * AD.Layout.PAGE.H / AD.Layout.PAGE.W) + 'px';
          if (i < arr.length - 1) p.style.pageBreakAfter = 'always';
        });
        return lib().set({
          margin: 6,
          image: { type: 'jpeg', quality: 0.95 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
        }).from(inner).outputPdf('blob').then(function (blob) {
          host.remove();
          return blob;
        }).catch(function (e) { host.remove(); throw e; });
      }).catch(function () {
        return printFallback(model);   /* CDN 차단 등 — 인쇄 다이얼로그 폴백 */
      });
    }
  });
})();
