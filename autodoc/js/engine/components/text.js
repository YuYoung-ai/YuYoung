/* text 컴포넌트 — 제목/본문 텍스트 블록 (선택: title 소제목 밴드) */
AD.Registry.register('text', {

  html: function (p, t) {
    var f = (t && t.font) || {};
    var body = f.body || 10.5;
    var em = p.level === 'title' ? (f.title || 20) / body : 1;
    var col = p.color ? AD.Theme.resolve(p.color)
            : (p.level === 'title' ? ((t.color && t.color.primary) || '#1B2F5E') : 'inherit');
    var h = '';
    if (p.title) h += '<div class="c-title-bar">' + AD.esc(p.title) + '</div>';
    h += '<div class="c-text" style="font-size:' + em + 'em;color:' + col +
         ';text-align:' + (p.align || 'left') +
         (p.level === 'title' ? ';font-weight:700' : '') + '">' + AD.esc(p.content || '') + '</div>';
    return h;
  },

  ppt: function (slide, p, rc, t) {
    var f = (t && t.font) || {};
    var prim = AD.hex(t.color && t.color.primary);
    var y = rc.y, h = rc.h;
    if (p.title) {
      slide.addText(p.title, { x: rc.x, y: y, w: rc.w, h: 0.28, bold: true,
        fontSize: (f.body || 10.5) + 1, color: prim, fontFace: f.family });
      y += 0.32; h -= 0.32;
    }
    slide.addText(String(p.content || ''), { x: rc.x, y: y, w: rc.w, h: Math.max(h, 0.3),
      fontSize: p.level === 'title' ? (f.title || 20) : (f.body || 10.5),
      bold: p.level === 'title',
      color: p.color ? AD.hex(AD.Theme.resolve(p.color)) : (p.level === 'title' ? prim : '1A1A2E'),
      align: p.align || 'left', valign: 'top', fontFace: f.family });
  },

  excel: function (x, p) {
    var t = x.theme, r = x.row, used = 0;
    if (p.title) {
      x.merge(r, x.c1, r, x.c2);
      x.put(r, x.c1, p.title, { bold: true, fill: 'FFEAF0F8', color: AD.hexA(t.color && t.color.primary) });
      used = 1;
    }
    var lines = String(p.content || '').split('\n').length;
    var h = Math.max(2, Math.min(lines + 1, 14));
    x.merge(r + used, x.c1, r + used + h - 1, x.c2);
    x.put(r + used, x.c1, String(p.content || ''), { valign: 'top' });
    x.box(r + used, x.c1, r + used + h - 1, x.c2);
    return used + h;
  }
});
