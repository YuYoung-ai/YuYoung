/************************************************************
 * memory-suggest.js — 제안 칩 소스 (COMPANY_MEMORY 축소판)
 * ----------------------------------------------------------
 * S4: 로컬 휴리스틱 — 같은 양식의 최근 Draft 값 + 채택 통계.
 * S5에서 Company Memory(승인 기반)로 승격.
 ************************************************************/
import { idb } from '../infra/idb.js';
import { draft } from './draft.js';
import { bus } from '../infra/bus.js';

const STAT_KEY = 'memstat';

async function loadStats() { return (await idb.get('kv', STAT_KEY).catch(() => null)) || {}; }
async function saveStats(s) { await idb.put('kv', STAT_KEY, s).catch(() => {}); }

export const memorySuggest = {
  /** 템플릿 단위로 동기 제안 제공자 준비 */
  async forTemplate(templateId) {
    const drafts = (await draft.list()).filter(d => d.templateId === templateId);
    const stats = await loadStats();
    // 필드별 최근 값 수집(텍스트류만)
    const byField = {};
    for (const d of drafts) {
      for (const [k, v] of Object.entries(d.values || {})) {
        if (typeof v !== 'string' || !v.trim()) continue;
        (byField[k] = byField[k] || []);
        if (!byField[k].includes(v)) byField[k].push(v);
      }
    }
    const rank = (field) => (a, b) => (stats[`${field}::${b}`] || 0) - (stats[`${field}::${a}`] || 0);
    return {
      suggest(field, currentValues) {
        const cur = currentValues && currentValues[field];
        const items = (byField[field] || []).filter(v => v !== cur).sort(rank(field));
        return items.map(v => ({ label: v.length > 24 ? v.slice(0, 24) + '…' : v, value: v }));
      },
      async accept(field, value) {
        const s = await loadStats();
        s[`${field}::${value}`] = (s[`${field}::${value}`] || 0) + 1;
        await saveStats(s);
        bus.publish('memory.suggestion.accepted', { templateId, field });
      },
    };
  },
};
