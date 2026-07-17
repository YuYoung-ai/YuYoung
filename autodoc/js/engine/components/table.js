/* table 컴포넌트 — 컬럼 정의 + 행 데이터(@바인딩) 표
 * colorRules: [{key,equals,color,fill,bold}] — 셀 값 일치 시 조건부 색
 * (예: 구분=VOC 빨강 / 점검 초록 — weekly 스타일) */
AD.Registry.register('table', {

  /* 헤더 채움·zebra — 우선순위: 양식 props > 테마 tableRule(DNA 반영) > 기본값 */
  _style: function (p, t) {
    var tr = (t && t.tableRule) || {};
    var hf = p.headerFill != null ? p.headerFill : (tr.headerFill != null ? tr.headerFill : 'primary');
    var zebra = p.zebra != null ? !!p.zebra : (tr.zebra != null ? !!tr.zebra : true);
    var c = (t && t.color) || {};
    var fill = (hf === 'none') ? null : (c[hf] || c.primary || '#1B2F5E');
    return { fill: fill, zebra: zebra };
  },

  _rule: function (p, key, val) {
    var rules = p.colorRules;
    if (!Array.isArray(rules)) return null;
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r && r.key === key && String(val == null ? '' : val).trim() === String(r.equals)) return r;
    }
    return null;
  },

  html: function (p, t) {
    var self = this;
    var cols = p.columns || [];
    var rows = Array.isArray(p.rows) ? p.rows : [];
    var h = '';
    if (p.title) h += '<div class="c-title-bar">' + AD.esc(p.title) + '</div>';
    var st = this._style(p, t);
    h += '<table class="c-table"><thead><tr>';
    cols.forEach(function (c) {
      var s = (c.width ? 'width:' + (c.width * 100) + '%;' : '') +
              (st.fill ? 'background:' + st.fill + ';color:#fff;' : '');
      h += '<th' + (s ? ' style="' + s + '"' : '') + '>' + AD.esc(c.label) + '</th>';
    });
    h += '</tr></thead><tbody>';
    if (!rows.length) h += '<tr><td colspan="' + (cols.length || 1) + '" class="c-table-empty">내용 없음</td></tr>';
    rows.forEach(function (r) {
      h += '<tr>';
      cols.forEach(function (c) {
        var rule = self._rule(p, c.key, r[c.key]);
        var st = rule ? ' style="' +
          (rule.color ? 'color:' + AD.Theme.resolve(rule.color) + ';' : '') +
          (rule.fill ? 'background:' + AD.Theme.resolve(rule.fill) + ';' : '') +
          (rule.bold ? 'font-weight:700;' : '') + '"' : '';
        h += '<td' + st + '>' + AD.esc(r[c.key]) + '</td>';
      });
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
    var st = this._style(p, t);
    var cols = p.columns || [];
    var n = cols.length || 1;
    var widths = cols.map(function (c) { return +(rc.w * (c.width || 1 / n)).toFixed(2); });
    var head = cols.map(function (c) {
      return { text: String(c.label || ''), options: st.fill
        ? { bold: true, color: 'FFFFFF', fill: { color: AD.hex(st.fill) }, align: 'center' }
        : { bold: true, color: prim, align: 'center' } };
    });
    var self = this;
    var body = (Array.isArray(p.rows) ? p.rows : []).map(function (r, i) {
      return cols.map(function (c) {
        var o = (st.zebra && i % 2) ? { fill: { color: 'F6F9FC' } } : {};
        var rule = self._rule(p, c.key, r[c.key]);
        if (rule) {
          if (rule.color) o.color = AD.hex(AD.Theme.resolve(rule.color));
          if (rule.fill) o.fill = { color: AD.hex(AD.Theme.resolve(rule.fill)) };
          if (rule.bold) o.bold = true;
        }
        return { text: String(r[c.key] == null ? '' : r[c.key]), options: o };
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
    var st = this._style(p, t);
    var hr = r + used;
    cols.forEach(function (col, i) {
      x.merge(hr, starts[i].c1, hr, starts[i].c2);
      x.put(hr, starts[i].c1, col.label, st.fill
        ? { bold: true, color: 'FFFFFFFF', fill: AD.hexA(st.fill), align: 'center' }
        : { bold: true, color: AD.hexA(t.color && t.color.primary), align: 'center' });
    });
    used += 1;
    var self = this;
    (Array.isArray(p.rows) ? p.rows : []).forEach(function (row, ri) {
      var rr = r + used;
      var lines = 1;
      cols.forEach(function (col, i) {
        var v = String(row[col.key] == null ? '' : row[col.key]);
        lines = Math.max(lines, v.split('\n').length);
        x.merge(rr, starts[i].c1, rr, starts[i].c2);
        var opt = { align: 'center', valign: 'top', fill: (st.zebra && ri % 2) ? 'FFF6F9FC' : null };
        var rule = self._rule(p, col.key, row[col.key]);
        if (rule) {
          if (rule.color) opt.color = AD.hexA(AD.Theme.resolve(rule.color));
          if (rule.fill) opt.fill = AD.hexA(AD.Theme.resolve(rule.fill));
          if (rule.bold) opt.bold = true;
        }
        x.put(rr, starts[i].c1, v, opt);
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
    var st = this._style(p, t);
    var rows = [new d.TableRow({ tableHeader: true, children: cols.map(function (c) {
      return cell(c.label, st.fill
        ? { fill: AD.hex(st.fill), color: 'FFFFFF', bold: true, center: true,
            width: Math.round((c.width || 1 / cols.length) * 100) }
        : { color: prim, bold: true, center: true,
            width: Math.round((c.width || 1 / cols.length) * 100) });
    }) })];
    var self = this;
    (Array.isArray(p.rows) ? p.rows : []).forEach(function (r, i) {
      rows.push(new d.TableRow({ children: cols.map(function (c) {
        var o = { fill: (st.zebra && i % 2) ? 'F6F9FC' : undefined };
        var rule = self._rule(p, c.key, r[c.key]);
        if (rule) {
          if (rule.color) o.color = AD.hex(AD.Theme.resolve(rule.color));
          if (rule.fill) o.fill = AD.hex(AD.Theme.resolve(rule.fill));
          if (rule.bold) o.bold = true;
        }
        return cell(r[c.key], o);
      }) }));
    });
    x.children.push(new d.Table({ rows: rows, width: { size: 100, type: d.WidthType.PERCENTAGE } }));
  }
});
