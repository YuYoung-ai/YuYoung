/************************************************************
 * Layout Engine — 혼합 방식 (Grid 저작 → 절대좌표 출력)
 * 템플릿은 CSS Grid 문법(area: "r1 / c1 / r2 / c2", end는 exclusive)
 * 으로 저작하고, PPT 등 좌표가 필요한 렌더러를 위해
 * 페이지 크기(inch) 기준 절대좌표로 변환합니다.
 * HTML 미리보기는 area를 CSS grid-area로 그대로 사용합니다.
 ************************************************************/
AD.Layout = (function () {
  var PAGE = { W: 13.333, H: 7.5 };   /* PPT 16:9 와이드 (inch) */

  function parseArea(a) {
    var p = String(a || '1 / 1 / 2 / 13').split('/').map(function (s) { return parseInt(s, 10) || 1; });
    return { r1: p[0], c1: p[1], r2: p[2], c2: p[3] };
  }

  /* block + grid + theme → {x,y,w,h} (inch). abs 지정 블록은 그대로 통과 */
  function resolve(block, grid, theme) {
    if (block.abs) return block.abs;
    var g = grid || { cols: 12, rows: 8, gap: 0.1 };
    var m = (theme && theme.spacing && theme.spacing.pageMargin) || 0.3;
    var gap = (g.gap != null ? g.gap : 0.1);
    var a = parseArea(block.area);
    var iw = PAGE.W - m * 2, ih = PAGE.H - m * 2;
    var cw = iw / g.cols, rh = ih / g.rows;
    return {
      x: +(m + (a.c1 - 1) * cw + gap / 2).toFixed(3),
      y: +(m + (a.r1 - 1) * rh + gap / 2).toFixed(3),
      w: +((a.c2 - a.c1) * cw - gap).toFixed(3),
      h: +((a.r2 - a.r1) * rh - gap).toFixed(3)
    };
  }

  return { PAGE: PAGE, parseArea: parseArea, resolve: resolve };
})();
