/* table 컴포넌트 — 컬럼 정의 + 행 데이터(@바인딩) 표 */
AD.Registry.register('table', {

  html: function (p, t) {
    var cols = p.columns || [];
    var rows = Array.isArray(p.rows) ? p.rows : [];
    var h = '';
    if (p.title) h += '<div class="c-title-bar">' + AD.esc(p.title) + '</div>';
    h += '<table class="c-table"><thead><tr>';
    cols.forEach(function (c) {
      h += '<th' + (c.width ? ' style="width:' + (c.width * 100) + '%"' : '') + '>' + AD.esc(c.label) + '</th>';
    });
    h += '</tr></thead><tbody>';
    if (!rows.length) h += '<tr><td colspan="' + (cols.length || 1) + '" class="c-table-empty">내용 없음</td></tr>';
    rows.forEach(function (r) {
      h += '<tr>';
      cols.forEach(function (c) { h += '<td>' + AD.esc(r[c.key]) + '</td>'; });
      h += '</tr>';
    });
    return h + '</tbody></table>';
  },

  ppt: function (slide, p, rc, t) {
    var f = (t && t.font) || {};
    var prim = AD.hex(t.color && t.color.primary);
    var y = rc.y;
    if (p.title) {
      slide.addText(p.title, { x: rc.x, y: y, w: rc.w, h: 0.28, bold: true,
        fontSize: (f.body || 10.5) + 1, color: prim, fontFace: f.family });
      y += 0.32;
    }
    var cols = p.columns || [];
    var n = cols.length || 1;
    var widths = cols.map(function (c) { return +(rc.w * (c.width || 1 / n)).toFixed(2); });
    var head = cols.map(function (c) {
      return { text: String(c.label || ''), options: { bold: true, color: 'FFFFFF', fill: { color: prim }, align: 'center' } };
    });
    var body = (Array.isArray(p.rows) ? p.rows : []).map(function (r, i) {
      return cols.map(function (c) {
        return { text: String(r[c.key] == null ? '' : r[c.key]),
                 options: i % 2 ? { fill: { color: 'F6F9FC' } } : {} };
      });
    });
    slide.addTable([head].concat(body), { x: rc.x, y: y, w: rc.w, colW: widths,
      fontSize: (f.body || 10.5) - 1.5, fontFace: f.family,
      border: { pt: 0.5, color: AD.hex((t.border && t.border.color) || '#CED6E4') },
      valign: 'middle', autoPage: false });
  },

  excel: function (x, p) {
    var t = x.theme, r = x.row, used = 0;
    var cols = p.columns || [];
    var span = x.c2 - x.c1 + 1;
    if (p.title) {
      x.merge(r, x.c1, r, x.c2);
      x.put(r, x.c1, p.title, { bold: true, fill: 'FFEAF0F8', color: AD.hexA(t.color && t.color.primary) });
      used = 1;
    }
    /* 컬럼 → 시트 열 분배 (width 비율 반영, 남는 열은 마지막 컬럼에) */
    var starts = [], c = x.c1;
    cols.forEach(function (col, i) {
      var w = Math.max(1, Math.round(span * (col.width || 1 / cols.length)));
      if (i === cols.length - 1) w = x.c2 - c + 1;
      starts.push({ c1: c, c2: Math.min(c + w - 1, x.c2) });
      c += w;
    });
    var hr = r + used;
    cols.forEach(function (col, i) {
      x.merge(hr, starts[i].c1, hr, starts[i].c2);
      x.put(hr, starts[i].c1, col.label, { bold: true, color: 'FFFFFFFF',
        fill: AD.hexA(t.color && t.color.primary), align: 'center' });
    });
    used += 1;
    (Array.isArray(p.rows) ? p.rows : []).forEach(function (row, ri) {
      var rr = r + used;
      var lines = 1;
      cols.forEach(function (col, i) {
        var v = String(row[col.key] == null ? '' : row[col.key]);
        lines = Math.max(lines, v.split('\n').length);
        x.merge(rr, starts[i].c1, rr, starts[i].c2);
        x.put(rr, starts[i].c1, v, { align: 'center', valign: 'top',
          fill: ri % 2 ? 'FFF6F9FC' : null });
      });
      x.ws.getRow(rr).height = Math.max(20, 14 * lines);
      used += 1;
    });
    return used;
  },

  word: function (x, p) {
    var d = x.d, t = x.theme;
    var prim = AD.hex(t.color && t.color.primary);
    var cols = p.columns || [];
    if (!cols.length) return;
    if (p.title) x.children.push(new d.Paragraph({
      children: [new d.TextRun({ text: p.title, bold: true, color: prim })],
      spacing: { after: 60 }
    }));
    function cell(text, o) {
      o = o || {};
      return new d.TableCell({
        shading: o.fill ? { type: d.ShadingType.CLEAR, fill: o.fill } : undefined,
        width: o.width ? { size: o.width, type: d.WidthType.PERCENTAGE } : undefined,
        children: String(text == null ? '' : text).split('\n').map(function (ln) {
          return new d.Paragraph({
            children: [new d.TextRun({ text: ln, bold: !!o.bold, color: o.color })],
            alignment: o.center ? d.AlignmentType.CENTER : undefined
          });
        })
      });
    }
    var rows = [new d.TableRow({ tableHeader: true, children: cols.map(function (c) {
      return cell(c.label, { fill: prim, color: 'FFFFFF', bold: true, center: true,
        width: Math.round((c.width || 1 / cols.length) * 100) });
    }) })];
    (Array.isArray(p.rows) ? p.rows : []).forEach(function (r, i) {
      rows.push(new d.TableRow({ children: cols.map(function (c) {
        return cell(r[c.key], { fill: i % 2 ? 'F6F9FC' : undefined });
      }) }));
    });
    x.children.push(new d.Table({ rows: rows, width: { size: 100, type: d.WidthType.PERCENTAGE } }));
  }
});
