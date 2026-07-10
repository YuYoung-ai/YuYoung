/************************************************************
 * Excel Renderer — ExcelJS (weekly.html genExcel 로직의 일반화)
 * 그리드 열(1~cols) = 시트 열, 블록은 grid 행 밴드(r1) 순서대로
 * 시트에 배치합니다. 같은 밴드의 블록은 같은 행에서 시작하며
 * 밴드 높이는 블록들이 사용한 행 수의 최댓값입니다.
 ************************************************************/
(function () {
  var CDNS = [
    'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js',
    'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
    'https://unpkg.com/exceljs@4.4.0/dist/exceljs.min.js'
  ];

  AD.Renderers.register({
    id: 'xlsx', label: 'Excel 생성', ext: '.xlsx', icon: '📈',

    render: function (model) {
      return AD.loadLib('ExcelJS', CDNS).then(function (Lib) {
        var t = AD.Theme.get() || {};
        var FONT = (t.font && t.font.family) || '맑은 고딕';
        var thin = { style: 'thin', color: { argb: AD.hexA((t.border && t.border.color) || '#CED6E4') } };
        var wb = new Lib.Workbook();

        model.pages.forEach(function (pg, pi) {
          var name = (model.meta.name || '문서').slice(0, 24) + (model.pages.length > 1 ? '_' + (pi + 1) : '');
          var ws = wb.addWorksheet(name, { views: [{ showGridLines: false }] });
          var g = model.grid;
          ws.columns = Array.apply(null, { length: g.cols }).map(function () { return { width: 11 }; });

          function put(r, c, v, o) {
            o = o || {};
            var cl = ws.getRow(r).getCell(c);
            if (v != null) cl.value = v;
            cl.font = { name: FONT, size: o.size || 10, bold: !!o.bold, color: { argb: o.color || 'FF1A1A2E' } };
            if (o.fill) cl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } };
            cl.alignment = { horizontal: o.align || 'left', vertical: o.valign || 'middle', wrapText: o.wrap !== false };
            if (o.border !== false) cl.border = { top: thin, left: thin, bottom: thin, right: thin };
            return cl;
          }
          function box(r1, c1, r2, c2) {
            for (var r = r1; r <= r2; r++) for (var c = c1; c <= c2; c++)
              ws.getRow(r).getCell(c).border = { top: thin, left: thin, bottom: thin, right: thin };
          }
          function merge(r1, c1, r2, c2) { try { ws.mergeCells(r1, c1, r2, c2); } catch (e) {} }

          /* grid 행 밴드(r1)별로 묶어 순서대로 배치 */
          var bands = {};
          pg.blocks.forEach(function (b) {
            var a = AD.Layout.parseArea(b.area);
            (bands[a.r1] = bands[a.r1] || []).push({ b: b, a: a });
          });
          var cursor = 1;
          Object.keys(bands).map(Number).sort(function (a, b) { return a - b; }).forEach(function (k) {
            var used = 1;
            bands[k].sort(function (p, q) { return p.a.c1 - q.a.c1; }).forEach(function (x) {
              var spec = AD.Registry.get(x.b.component);
              if (!spec || !spec.excel) return;
              var n = spec.excel({
                ws: ws, row: cursor, c1: x.a.c1, c2: Math.min(x.a.c2 - 1, g.cols),
                put: put, merge: merge, box: box, theme: t
              }, x.b.props || {});
              used = Math.max(used, n || 1);
            });
            cursor += used + 1;   /* 밴드 사이 여백 1행 */
          });

          ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
            margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };
        });

        return wb.xlsx.writeBuffer().then(function (buf) {
          return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        });
      });
    }
  });
})();
