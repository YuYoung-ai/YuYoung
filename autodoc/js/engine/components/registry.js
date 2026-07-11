/************************************************************
 * Component Registry — 컴포넌트(블록 타입) 등록/조회
 * 컴포넌트 스펙 = {
 *   html (props, theme)          → 미리보기 innerHTML 문자열
 *   ppt  (slide, props, rect, theme)   → PptxGenJS 슬라이드에 그리기
 *   excel(ctx, props)            → ExcelJS 시트에 그리기, 사용한 행 수 반환
 * }
 * 새 컴포넌트 추가 = 파일 1개 + register() 1줄. 렌더러 수정 불필요.
 ************************************************************/
AD.Registry = (function () {
  var map = {};
  return {
    register: function (type, spec) { map[type] = spec; },
    get: function (type) { return map[type]; },
    types: function () { return Object.keys(map); }
  };
})();
