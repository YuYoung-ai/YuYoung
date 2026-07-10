/* footer 컴포넌트 — 문서 하단 (회사명/기밀표시/생성일 등) */
AD.Registry.register('footer', {

  html: function (p, t) {
    return '<div class="c-footer">' + AD.esc(p.text || '') + '</div>';
  },

  ppt: function (slide, p, rc, t) {
    var f = (t && t.font) || {};
    slide.addText(String(p.text || ''), { x: rc.x, y: rc.y, w: rc.w, h: rc.h,
      fontSize: (f.body || 10.5) - 2, color: '6B7A99',
      align: 'center', valign: 'middle', fontFace: f.family });
  },

  excel: function (x, p) {
    var r = x.row;
    x.merge(r, x.c1, r, x.c2);
    x.put(r, x.c1, String(p.text || ''), { align: 'center', size: 8.5, color: 'FF6B7A99', border: false });
    return 1;
  }
});
