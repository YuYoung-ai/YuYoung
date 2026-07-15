/************************************************************
 * engine-bridge.js — v1 엔진 전역 위임 브리지 (RENDERER/PREVIEW SPEC)
 * ----------------------------------------------------------
 * v1(window.AD.*)은 ES Module 이 아니라 전역 클래식 스크립트다.
 * auth 래퍼와 동일 패턴으로 v1 엔진을 무수정 재사용한다:
 *   AD.Model.assemble · AD.Preview.render · AD.Renderers · AD.Theme · AD.download
 * 이로써 Preview 와 Renderer 가 "동일 모델"을 소비 → 구조 일치(I4).
 ************************************************************/

// v2/app.html 기준 상대경로 (v1 엔진은 autodoc/js/ — 무수정)
const V1 = '../js/';
const ORDER = [
  'core/config.js', 'core/store.js',
  'engine/theme-engine.js', 'engine/layout-engine.js',
  'engine/components/registry.js',
  'engine/components/header.js', 'engine/components/text.js', 'engine/components/table.js',
  'engine/components/card.js', 'engine/components/chart.js', 'engine/components/footer.js',
  'engine/document-model.js',
  'renderers/renderer-base.js',
  'renderers/ppt-renderer.js', 'renderers/excel-renderer.js', 'renderers/pdf-renderer.js', 'renderers/word-renderer.js',
  'ui/preview.js',
];

let readyPromise = null;

function injectSequential(paths) {
  return paths.reduce((chain, p) => chain.then(() => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = V1 + p;
    s.async = false;
    s.onload = () => res();
    s.onerror = () => rej(new Error('v1 script 로드 실패: ' + p));
    document.head.appendChild(s);
  })), Promise.resolve());
}

function AD() { return (typeof window !== 'undefined') ? window.AD : undefined; }

export const engine = {
  /** v1 엔진 전역 준비 (1회) */
  async ensure() {
    if (AD() && AD().Preview && AD().Model && AD().Renderers) return AD();
    if (!readyPromise) readyPromise = injectSequential(ORDER).then(() => AD());
    await readyPromise;
    if (!AD() || !AD().Preview) throw new Error('v1 엔진 초기화 실패');
    return AD();
  },

  async loadTheme(id) {
    await this.ensure();
    return AD().Theme.load(id);
  },

  /** Template + 값 → 렌더러 중립 모델 (v1 assemble) */
  assemble(tpl, values) {
    return AD().Model.assemble(tpl, values);
  },

  /** 모델 → HTML 미리보기 (렌더러와 동일 모델) */
  renderPreview(model, container) {
    return AD().Preview.render(model, container);
  },

  /** 사용 가능 렌더러 목록 {id,label,ext,icon} */
  renderers() {
    return AD().Renderers.all().map(r => ({ id: r.id, label: r.label, ext: r.ext, icon: r.icon }));
  },

  /** 모델 → 파일 Blob (포맷별 v1 렌더러) */
  async render(formatId, model) {
    const r = AD().Renderers.get(formatId);
    if (!r) throw Object.assign(new Error('renderer 없음: ' + formatId), { code: 'E-RENDER' });
    return r.render(model);
  },

  download(blob, filename) { return AD().download(blob, filename); },
};
