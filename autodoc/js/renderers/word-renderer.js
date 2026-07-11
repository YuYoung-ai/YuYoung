/************************************************************
 * Word Renderer (Phase 3) — docx 라이브러리 (UMD 전역: docx)
 * Word 는 흐름(flow) 문서이므로 블록을 Excel 과 동일한
 * 밴드(grid r1) 순서로 순차 배치합니다. 컴포넌트의 word() 가
 * docx 요소를 ctx.children 에 추가합니다.
 ************************************************************/
(function () {
  var CDNS = [
    'https://unpkg.com/docx@8.5.0/build/index.umd.js',
    'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js'
  ];

  AD.Renderers.register({
    id: 'docx', label: 'Word 생성', ext: '.docx', icon: '📄',

    render: function (model) {
      return AD.loadLib('docx', CDNS).then(function (d) {
        var t = AD.Theme.get() || {};
        var sections = model.pages.map(function (pg) {
          var ctx = { d: d, theme: t, children: [] };

          /* grid 행 밴드 순서로 배치 (excel-renderer 와 동일 규칙) */
          var bands = {};
          pg.blocks.forEach(function (b) {
            var a = AD.Layout.parseArea(b.area);
            (bands[a.r1] = bands[a.r1] || []).push({ b: b, a: a });
          });
          Object.keys(bands).map(Number).sort(function (x, y) { return x - y; }).forEach(function (k) {
            bands[k].sort(function (p, q) { return p.a.c1 - q.a.c1; }).forEach(function (x) {
              var spec = AD.Registry.get(x.b.component);
              if (spec && spec.word) spec.word(ctx, x.b.props || {});
            });
            ctx.children.push(new d.Paragraph({ text: '' }));   /* 밴드 간 여백 */
          });

          return {
            properties: { page: { size: { orientation: d.PageOrientation.LANDSCAPE } } },
            children: ctx.children
          };
        });

        var doc = new d.Document({
          sections: sections,
          styles: { default: { document: { run: {
            font: (t.font && t.font.family) || '맑은 고딕',
            size: Math.round(((t.font && t.font.body) || 10.5) * 2)   /* half-points */
          } } } }
        });
        return d.Packer.toBlob(doc);
      });
    }
  });
})();
