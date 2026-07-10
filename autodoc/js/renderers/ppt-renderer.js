/************************************************************
 * PPT Renderer — PptxGenJS (dashboard.html에서 검증된 라이브러리)
 * 페이지 = 슬라이드(16:9), 블록 = LayoutEngine 좌표 변환 후
 * 각 컴포넌트의 ppt() 로 그립니다.
 ************************************************************/
(function () {
  var CDNS = [
    'https://cdn.jsdelivr.net/gh/gitbrent/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
    'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
    'https://unpkg.com/pptxgenjs@3.12.0/dist/pptxgen.bundle.js'
  ];

  AD.Renderers.register({
    id: 'pptx', label: 'PPT 생성', ext: '.pptx', icon: '📊',

    render: function (model) {
      return AD.loadLib('PptxGenJS', CDNS).then(function (Lib) {
        var t = AD.Theme.get() || {};
        var pptx = new Lib();
        pptx.layout = 'LAYOUT_WIDE';           /* 13.33 × 7.5 in = AD.Layout.PAGE */
        model.pages.forEach(function (pg) {
          var slide = pptx.addSlide();
          slide.background = { color: 'FFFFFF' };
          pg.blocks.forEach(function (b) {
            var spec = AD.Registry.get(b.component);
            if (!spec || !spec.ppt) return;
            var rc = AD.Layout.resolve(b, model.grid, t);
            spec.ppt(slide, b.props || {}, rc, t);
          });
        });
        return pptx.write('blob');
      });
    }
  });
})();
