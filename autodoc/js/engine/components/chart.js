/* chart 컴포넌트 (Phase 2) — bar/line/pie
 * 데이터 소스 2가지:
 *   ① source:'@표키' + labelKey/valueKey — 표 입력에서 자동 집계
 *   ② labels:[] + values:[] 직접 지정
 */
AD.Registry.register('chart', {

  _series: function (p) {
    var labels = [], values = [];
    if (Array.isArray(p.source) && p.labelKey && p.valueKey) {
      p.source.forEach(function (r) {
        labels.push(String(r[p.labelKey] == null ? '' : r[p.labelKey]));
        values.push(Number(String(r[p.valueKey] == null ? 0 : r[p.valueKey]).replace(/[^\d.-]/g, '')) || 0);
      });
    } else {
      labels = (p.labels || []).map(String);
      values = (p.values || []).map(function (v) { return Number(v) || 0; });
    }
    return { labels: labels, values: values };
  },

  html: function (p, t) {
    var s = this._series(p);
    var h = '';
    if (p.title) h += '<div class="c-title-bar">' + AD.esc(p.title) + '</div>';
    if (!s.labels.length) return h + '<div class="c-chart-empty">데이터 없음</div>';
    var max = Math.max.apply(null, s.values.concat([1]));
    var prim = (t.color && t.color.primary) || '#1B2F5E';
    h += '<div class="c-chart">' + s.labels.map(function (l, i) {
      var w = Math.max(2, Math.round(s.values[i] / max * 100));
      return '<div class="c-chart-row"><span class="c-chart-l">' + AD.esc(l) + '</span>' +
        '<span class="c-chart-bar"><i style="width:' + w + '%;background:' + prim + '"></i></span>' +
        '<span class="c-chart-v">' + s.values[i] + '</span></div>';
    }).join('') + '</div>';
    return h;
  },

  ppt: function (slide, p, rc, t) {
    var f = (t && t.font) || {};
    var s = this._series(p);
    var y = rc.y, h = rc.h;
    if (p.title) {
      slide.addText(p.title, { x: rc.x, y: y, w: rc.w, h: 0.28, bold: true,
        fontSize: (f.body || 10.5) + 1, color: AD.hex(t.color && t.color.primary), fontFace: f.family });
      y += 0.32; h -= 0.32;
    }
    if (!s.labels.length) {
      slide.addText('데이터 없음', { x: rc.x, y: y, w: rc.w, h: h, align: 'center',
        color: '6B7A99', fontSize: f.body || 10.5, fontFace: f.family });
      return;
    }
    var colors = ['primary', 'accent', 'success', 'warning', 'danger'].map(function (k) {
      return AD.hex((t.color && t.color[k]) || '#1B2F5E');
    });
    slide.addChart(p.type || 'bar',
      [{ name: p.title || '값', labels: s.labels, values: s.values }],
      { x: rc.x, y: y, w: rc.w, h: Math.max(h, 1),
        barDir: p.dir || 'col',
        chartColors: (p.type === 'pie') ? colors : [colors[0]],
        showLegend: p.type === 'pie', legendPos: 'r',
        showValue: true, dataLabelFontSize: (f.body || 10.5) - 2,
        catAxisLabelFontSize: (f.body || 10.5) - 1.5,
        valAxisLabelFontSize: (f.body || 10.5) - 1.5 });
  },

  excel: function (x, p) {
    var t = x.theme, r = x.row, used = 0;
    var s = this._series(p);
    if (p.title) {
      x.merge(r, x.c1, r, x.c2);
      x.put(r, x.c1, p.title + ' (차트 데이터)', { bold: true, fill: 'FFEAF0F8',
        color: AD.hexA(t.color && t.color.primary) });
      used = 1;
    }
    var mid = Math.max(x.c1, Math.floor((x.c1 + x.c2) / 2));
    s.labels.forEach(function (l, i) {
      var rr = r + used + i;
      x.merge(rr, x.c1, rr, mid);
      x.put(rr, x.c1, l, {});
      if (mid + 1 <= x.c2) x.merge(rr, mid + 1, rr, x.c2);
      x.put(rr, Math.min(mid + 1, x.c2), s.values[i], { align: 'right' });
    });
    return used + s.labels.length;
  },

  word: function (x, p) {
    var d = x.d, t = x.theme;
    var prim = AD.hex(t.color && t.color.primary);
    var s = this._series(p);
    if (p.title) x.children.push(new d.Paragraph({
      children: [new d.TextRun({ text: p.title + ' (차트 데이터)', bold: true, color: prim })],
      spacing: { after: 60 }
    }));
    s.labels.forEach(function (l, i) {
      x.children.push(new d.Paragraph({
        children: [
          new d.TextRun({ text: '· ' + l + ' — ' }),
          new d.TextRun({ text: String(s.values[i]), bold: true, color: prim })
        ]
      }));
    });
  }
});
