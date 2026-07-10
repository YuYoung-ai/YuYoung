/* card 컴포넌트 — 라벨 + 값 요약 카드 (건수/기간/장소 등) */
AD.Registry.register('card', {

  html: function (p, t) {
    var accent = AD.Theme.resolve(p.accent || '$color.primary') || '#1B2F5E';
    return '<div class="c-card" style="border-top:3px solid ' + accent + '">' +
      '<div class="c-card-t">' + AD.esc(p.title || '') + '</div>' +
      '<div class="c-card-v" style="color:' + accent + '">' + AD.esc(p.value == null ? '' : p.value) + '</div>' +
      '</div>';
  },

  ppt: function (slide, p, rc, t) {
    var f = (t && t.font) || {};
    var accent = AD.hex(AD.Theme.resolve(p.accent || '$color.primary') || '#1B2F5E');
    slide.addText([
      { text: String(p.title || ''), options: { fontSize: (f.body || 10.5) - 0.5, color: '6B7A99', breakLine: true } },
      { text: String(p.value == null ? '' : p.value), options: { fontSize: (f.title || 20) - 4, bold: true, color: accent } }
    ], { x: rc.x, y: rc.y, w: rc.w, h: rc.h,
      fill: { color: 'F5F7FA' }, line: { color: 'DDE3EE', width: 0.75 },
      align: 'center', valign: 'middle', fontFace: f.family });
  },

  excel: function (x, p) {
    var accent = AD.hexA(AD.Theme.resolve(p.accent || '$color.primary') || '#1B2F5E');
    var r = x.row;
    x.merge(r, x.c1, r, x.c2);
    x.put(r, x.c1, String(p.title || ''), { align: 'center', color: 'FF6B7A99', fill: 'FFF5F7FA', size: 9 });
    x.merge(r + 1, x.c1, r + 1, x.c2);
    x.put(r + 1, x.c1, String(p.value == null ? '' : p.value), { align: 'center', bold: true, size: 13, color: accent, fill: 'FFF5F7FA' });
    x.box(r, x.c1, r + 1, x.c2);
    return 2;
  }
});
