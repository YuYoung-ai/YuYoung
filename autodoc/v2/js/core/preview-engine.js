/************************************************************
 * preview-engine.js — 실시간 HTML Preview (PREVIEW_ENGINE_SPEC)
 * ----------------------------------------------------------
 * v1 AD.Preview 를 브리지로 위임. 렌더러와 동일 모델 → 구조 일치.
 * 디바운스 갱신은 호출측(editor)에서 관리.
 ************************************************************/
import { engine } from './engine-bridge.js';
import { documentEngine } from './document-engine.js';
import { logger } from '../infra/logger.js';

export const previewEngine = {
  async ensure(tpl) { await documentEngine.ensure(tpl); },

  /** 값 → 모델 조립 → 컨테이너에 HTML 렌더 */
  render(tpl, values, container) {
    try {
      const model = documentEngine.assemble(tpl, values);
      engine.renderPreview(model, container);
      return model;
    } catch (err) {
      logger.warn('E-PREVIEW', { meta: { err: String(err && err.message || err) } });
      container.innerHTML = '<div class="empty">미리보기를 준비하는 중…</div>';
      return null;
    }
  },
};
