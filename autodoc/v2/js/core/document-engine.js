/************************************************************
 * document-engine.js — 문서 생성 오케스트레이터 (DOCUMENT_ENGINE_SPEC)
 * ----------------------------------------------------------
 * Template → (Form/Validation) → assemble(+provenance) → Preview/Renderer → Export
 * Preview 와 Renderer 는 "동일 모델"을 입력받는다(I4).
 ************************************************************/
import { engine } from './engine-bridge.js';
import { history } from './history.js';
import { learning } from './learning.js';
import { bus } from '../infra/bus.js';
import { logger } from '../infra/logger.js';
import { workspaceContext } from '../infra/workspace-context.js';

// 승인된 Company DNA(colorRule·tableRule)를 생성 시 실제 반영 (I2 의 완성).
// 이전에는 DNA 가 학습·버전 표시만 되고 문서에는 아무 영향이 없었다.
let dnaCache = null, dnaAt = 0;
async function dnaRules() {
  if (dnaCache && (Date.now() - dnaAt) < 5 * 60 * 1000) return dnaCache;
  try {
    const d = await Promise.race([
      learning.dna(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('E-NET-TIMEOUT')), 4000)),
    ]);
    dnaCache = (d && d.json) || {};
    dnaAt = Date.now();
  } catch { dnaCache = dnaCache || {}; }
  return dnaCache;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
function applyDnaToTheme(theme, rules) {
  if (!theme || !rules) return;
  const cr = rules.colorRule || {};
  theme.color = theme.color || {};
  if (HEX.test(String(cr.primary || ''))) theme.color.primary = cr.primary;
  if (HEX.test(String(cr.accent || ''))) theme.color.accent = cr.accent;
  if (rules.tableRule && typeof rules.tableRule === 'object') theme.tableRule = rules.tableRule;
}

export const documentEngine = {
  async ensure(tpl) {
    await engine.ensure();
    if (tpl && tpl.theme) {
      const theme = await engine.loadTheme(tpl.theme).catch(() => null);
      if (theme) applyDnaToTheme(theme, await dnaRules());
    }
  },

  /** 입력값 + Template → 렌더러 중립 모델 (x2 provenance 부착) */
  assemble(tpl, values) {
    const model = engine.assemble(tpl, values);
    model.x2 = {
      provenance: {
        workspaceId: workspaceContext.current(),
        templateRef: `${tpl.id}@${tpl.version || '1'}`,
        assembledAt: new Date().toISOString(),
      },
    };
    bus.publish('document.assembled', { templateRef: model.x2.provenance.templateRef });
    return model;
  },

  /** 사용 가능 포맷 = 템플릿 formats ∩ 등록 렌더러 */
  availableFormats(tpl) {
    const have = new Set(engine.renderers().map(r => r.id));
    const meta = Object.fromEntries(engine.renderers().map(r => [r.id, r]));
    return (tpl.formats || []).filter(f => have.has(f)).map(f => meta[f]);
  },

  /** 생성 → 다운로드 + 이력 기록 */
  async generate(tpl, values, formatId) {
    await this.ensure(tpl);
    const model = this.assemble(tpl, values);
    let blob;
    try {
      blob = await engine.render(formatId, model);
    } catch (err) {
      logger.error('E-RENDER', { meta: { formatId, err: String(err && err.message || err) } });
      throw Object.assign(new Error('생성 실패'), { code: 'E-RENDER' });
    }
    if (!blob) throw Object.assign(new Error('빈 결과'), { code: 'E-RENDER' });
    const meta = engine.renderers().find(r => r.id === formatId) || { ext: '' };
    const filename = `${tpl.name || tpl.id}${meta.ext || ''}`;
    engine.download(blob, filename);
    // values 를 함께 기록해야 History 에서 '당시 입력값 그대로' 다시 열 수 있다
    const entry = await history.add({ templateId: tpl.id, name: tpl.name, format: formatId, filename, values });
    bus.publish('document.generated', { docId: entry.id, templateId: tpl.id, format: formatId });
    return { filename, docId: entry.id };
  },
};
