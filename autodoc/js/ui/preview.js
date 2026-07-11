/************************************************************
 * Preview — DocumentModel → HTML 미리보기
 * 페이지 = CSS Grid (템플릿의 grid 그대로), 블록 = grid-area 배치.
 * PPT 렌더러와 같은 모델을 소비하므로 미리보기 = 결과물 구조 일치.
 ************************************************************/
AD.Preview = (function () {

  function render(model, container) {
    var t = AD.Theme.get() || {};
    var doc = container.ownerDocument;
    container.innerHTML = '';
    AD.Theme.cssVars(container);

    model.pages.forEach(function (pg) {
      var page = doc.createElement('div');
      page.className = 'ad-page';
      var g = model.grid;
      page.style.display = 'grid';
      page.style.gridTemplateColumns = 'repeat(' + g.cols + ',1fr)';
      page.style.gridTemplateRows = 'repeat(' + g.rows + ',1fr)';
      page.style.gap = '0.6%';
      page.style.aspectRatio = AD.Layout.PAGE.W + ' / ' + AD.Layout.PAGE.H;
      container.appendChild(page);

      /* 페이지 폭 기준 pt→px 환산으로 실제 문서 폰트 비율 재현 */
      var ppp = page.clientWidth / (AD.Layout.PAGE.W * 72);
      page.style.fontSize = Math.max(7, ppp * ((t.font && t.font.body) || 10.5) * 1.33) + 'px';

      pg.blocks.forEach(function (b) {
        var spec = AD.Registry.get(b.component);
        if (!spec || !spec.html) return;
        var elb = doc.createElement('div');
        elb.className = 'ad-block c-blk-' + b.component;
        elb.style.gridArea = b.area || 'auto';
        elb.innerHTML = spec.html(b.props || {}, t);
        page.appendChild(elb);
      });
    });
  }

  return { render: render };
})();
