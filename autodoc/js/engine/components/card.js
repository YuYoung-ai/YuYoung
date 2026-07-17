/* card 컴포넌트 — 라벨 + 값 요약 카드 (건수/기간/장소 등)
 * 확장:
 *   source:'@표키'(+countWhere:{key,equals}) — 표 입력에서 건수 자동 집계
 *   unit:'건' — 값 뒤 단위
 *   delta:숫자/문자 (+deltaLabel:'전주대비') — ▲▼ 증감 표시 */
AD.Registry.register('card', {

  _value: function (p) {
    if (Array.isArray(p.source)) {
      var rows = p.source;
      if (p.countWhere && p.countWhere.key != null) {
        rows = rows.filter(function (r) {
          return String(r[p.countWhere.key] == null ? '' : r[p.countWhere.key]).trim() === String(p.countWhere.equals);
        });
      }
      return String(rows.length) + (p.unit || '');
    }
    var v = (p.value == null || p.value === '') ? '' : String(p.value);
    return v + (v && p.unit ? p.unit : '');
  },

  _delta: function (p) {
    if (p.delta == null || p.delta === '') return null;
    var n = Number(String(p.delta).replace(/[^\d.-]/g, ''));
    var up = isNaN(n) ? !/^-/.test(String(p.delta)) : n > 0;
    var mag = isNaN(n) ? String(p.delta) : String(Math.abs(n));
    if (!isNaN(n) && n === 0) return { text: '— ' + (p.deltaLabel || '전주대비'), color: '#6B7A99' };
    return { text: (up ? '▲' : '▼') + mag + ' ' + (p.deltaLabel || '전주대비'),
             color: up ? '#C0392B' : '#1F6FBF' };
  },

  html: function (p, t) {
    var accent = AD.Theme.resolve(p.accent || '$color.primary') || '#1B2F5E';
    var d = this._delta(p);
    return '<div class="c-card" style="border-top:3px solid ' + accent + '">' +
      '<div class="c-card-t">' + AD.esc(p.title || '') + '</div>' +
      '<div class="c-card-v" style="color:' + accent + '">' + AD.esc(this._value(p)) + '</div>' +
      (d ? '<div class="c-card-d" style="color:' + d.color + ';font-size:11px">' + AD.esc(d.text) + '</div>' : '') +
      '</div>';
  },

  ppt: function (slide, p, rc, t) {
    var f = (t && t.font) || {};
    var accent = AD.hex(AD.Theme.resolve(p.accent || '$color.primary') || '#1B2F5E');
    var d = this._delta(p);
    var parts = [
      { text: String(p.title || ''), options: { fontSize: (f.body || 10.5) - 0.5, color: '6B7A99', breakLine: true } },
      { text: this._value(p), options: { fontSize: (f.title || 20) - 4, bold: true, color: accent, breakLine: !!d } }
    ];
    if (d) parts.push({ text: d.text, options: { fontSize: (f.body || 10.5) - 1.5, color: AD.hex(d.color) } });
    slide.addText(parts, { x: rc.x, y: rc.y, w: rc.w, h: rc.h,
      fill: { color: 'F5F7FA' }, line: { color: 'DDE3EE', width: 0.75 },
      align: 'center', valign: 'middle', fontFace: f.family });
  },

  excel: function (x, p) {
    var accent = AD.hexA(AD.Theme.resolve(p.accent || '$color.primary') || '#1B2F5E');
    var d = this._delta(p);
    var r = x.row;
    x.merge(r, x.c1, r, x.c2);
    x.put(r, x.c1, String(p.title || ''), { align: 'center', color: 'FF6B7A99', fill: 'FFF5F7FA', size: 9 });
    x.merge(r + 1, x.c1, r + 1, x.c2);
    x.put(r + 1, x.c1, this._value(p), { align: 'center', bold: true, size: 13, color: accent, fill: 'FFF5F7FA' });
    var used = 2;
    if (d) {
      x.merge(r + 2, x.c1, r + 2, x.c2);
      x.put(r + 2, x.c1, d.text, { align: 'center', size: 9, color: AD.hexA(d.color), fill: 'FFF5F7FA' });
      used = 3;
    }
    x.box(r, x.c1, r + used - 1, x.c2);
    return used;
  },

  word: function (x, p) {
    var d = x.d;
    var accent = AD.hex(AD.Theme.resolve(p.accent || '$color.primary') || '#1B2F5E');
    var dt = this._delta(p);
    var runs = [
      new d.TextRun({ text: '▪ ' + String(p.title || '') + ' : ', color: '6B7A99' }),
      new d.TextRun({ text: this._value(p), bold: true, color: accent })
    ];
    if (dt) runs.push(new d.TextRun({ text: '  ' + dt.text, color: AD.hex(dt.color) }));
    x.children.push(new d.Paragraph({ children: runs, spacing: { after: 40 } }));
  }
});
