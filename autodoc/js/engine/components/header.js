/* header 컴포넌트 — 문서 상단 밴드 (제목 + 부제/작성자/일자) */
AD.Registry.register('header', {

  html: function (p, t) {
    var meta = [p.subtitle, p.writer, p.date].filter(Boolean).join(' · ');
    var logo = (t && t.logoData)
      ? '<img class="c-header-logo" src="' + t.logoData + '" alt="" style="float:right;height:22px;margin:2px 4px">'
      : '';
    return '<div class="c-header">' + logo +
      '<span class="c-header-title">' + AD.esc(p.title || '') + '</span>' +
      (meta ? '<span class="c-header-meta">' + AD.esc(meta) + '</span>' : '') +
      '</div>';
  },

  ppt: function (slide, p, rc, t) {
    var f = (t && t.font) || {};
    var prim = AD.hex(t.color && t.color.primary);
    slide.addText(String(p.title || ''), { shape: 'rect',
      x: rc.x, y: rc.y, w: rc.w, h: rc.h,
      fill: { color: prim }, color: 'FFFFFF', bold: true,
      fontSize: f.title || 20, align: 'left', valign: 'middle',
      fontFace: f.family, margin: 10 });
    var hasLogo = !!(t && t.logoData);
    var meta = [p.subtitle, p.writer, p.date].filter(Boolean).join('  ·  ');
    if (meta) slide.addText(meta, { x: rc.x, y: rc.y, w: rc.w - 0.15 - (hasLogo ? 1.0 : 0), h: rc.h,
      align: 'right', valign: 'middle', color: 'DCE6F8',
      fontSize: f.body || 10.5, fontFace: f.family });
    if (hasLogo) {
      var lh = Math.min(rc.h * 0.55, 0.3);
      try {
        slide.addImage({ data: t.logoData,
          x: rc.x + rc.w - 0.95, y: rc.y + (rc.h - lh) / 2, w: 0.85, h: lh,
          sizing: { type: 'contain', w: 0.85, h: lh } });
      } catch (e) { /* 로고 실패는 문서 생성을 막지 않음 */ }
    }
  },

  excel: function (x, p) {
    var t = x.theme, r = x.row;
    x.merge(r, x.c1, r + 1, x.c2);
    x.put(r, x.c1, String(p.title || ''), { bold: true, size: 16, color: 'FFFFFFFF',
      fill: AD.hexA(t.color && t.color.primary), align: 'center' });
    x.box(r, x.c1, r + 1, x.c2);
    var meta = [p.subtitle, p.writer, p.date].filter(Boolean).join('  ·  ');
    if (!meta) return 2;
    x.merge(r + 2, x.c1, r + 2, x.c2);
    x.put(r + 2, x.c1, meta, { align: 'center', fill: 'FFEAF0F8',
      color: AD.hexA(t.color && t.color.primary), bold: true });
    return 3;
  },

  word: function (x, p) {
    var d = x.d, t = x.theme, f = (t && t.font) || {};
    x.children.push(new d.Paragraph({
      children: [new d.TextRun({ text: String(p.title || ''), bold: true,
        color: 'FFFFFF', size: Math.round((f.title || 20) * 2) })],
      shading: { type: d.ShadingType.CLEAR, fill: AD.hex(t.color && t.color.primary) },
      spacing: { before: 80, after: 80 }
    }));
    var meta = [p.subtitle, p.writer, p.date].filter(Boolean).join('  ·  ');
    if (meta) x.children.push(new d.Paragraph({
      children: [new d.TextRun({ text: meta, color: '6B7A99' })],
      alignment: d.AlignmentType.RIGHT, spacing: { after: 80 }
    }));
  }
});
