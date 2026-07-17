/************************************************************
 * draft.js — Draft 자동 저장/복원 (LOCAL_STORAGE_SPEC)
 * ----------------------------------------------------------
 * IndexedDB 'drafts' 스토어. 자동 삭제 금지 — 사용자 명시 행동만.
 * 키: templateId::draftId
 ************************************************************/
import { idb } from '../infra/idb.js';
import { bus } from '../infra/bus.js';
import { api } from '../infra/api.js';

function key(templateId, draftId) { return `${templateId}::${draftId}`; }

let timer = null;

export const draft = {
  /** 디바운스 저장(기본 1s) */
  save(templateId, draftId, values, meta = {}) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const rec = { templateId, draftId, values, meta, savedAt: new Date().toISOString() };
      await idb.put('drafts', key(templateId, draftId), rec).catch(() => {});
      bus.publish('draft.saved', { templateId, draftId });
    }, meta.debounce ?? 1000);
  },

  /** 즉시 저장(이탈 훅 등) */
  async saveNow(templateId, draftId, values, meta = {}) {
    clearTimeout(timer);
    const rec = { templateId, draftId, values, meta, savedAt: new Date().toISOString() };
    await idb.put('drafts', key(templateId, draftId), rec).catch(() => {});
    bus.publish('draft.saved', { templateId, draftId });
    // GAS 동기 — 오프라인 시 큐(같은 Draft 는 최신으로 dedupe)
    const k = key(templateId, draftId);
    api.write('v2.draft.sync', { record: { id: k, templateId, draftId, values, savedAt: rec.savedAt } },
      { requestId: 'rd-' + k + '-' + rec.savedAt, dedupeKey: 'draft:' + k }).catch(() => {});
    return rec;
  },

  async get(templateId, draftId) {
    return idb.get('drafts', key(templateId, draftId)).catch(() => null);
  },

  /** 로컬 우선, 없으면 GAS에서 복원(기기 간 이어서 작성).
   *  로컬이 비어 있는 채로 편집기를 열면 이탈 시 빈 값이 서버 Draft를
   *  덮어써 데이터가 사라지므로, 원격 폴백이 필수다. 지연 상한 6s. */
  async getMerged(templateId, draftId) {
    const local = await this.get(templateId, draftId);
    if (local || !api.configured()) return local;
    try {
      const remote = await Promise.race([
        api.request('v2.draft.list', {}),
        new Promise((_, rej) => setTimeout(() => rej(new Error('E-NET-TIMEOUT')), 6000)),
      ]);
      const r = (remote.items || []).find(x => x.templateId === templateId && String(x.draftId) === String(draftId));
      if (!r) return null;
      const rec = { templateId, draftId, values: r.values || {}, meta: {}, savedAt: r.savedAt };
      await idb.put('drafts', key(templateId, draftId), rec).catch(() => {});
      return rec;
    } catch { return null; }
  },

  async list() {
    const all = await idb.all('drafts').catch(() => []);
    return all.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  },

  /** 로컬 + GAS 병합 (기기 간 이어서 작성). 오프라인/미연결이면 로컬만.
   *  원격 병합 지연 상한 8s — 서버가 느려도 화면이 수십 초 멈추지 않게. */
  async listMerged() {
    const local = await this.list();
    if (!api.configured()) return local;
    try {
      const remote = (await Promise.race([
        api.request('v2.draft.list', {}),
        new Promise((_, rej) => setTimeout(() => rej(new Error('E-NET-TIMEOUT')), 8000)),
      ])).items || [];
      const byKey = {};
      for (const r of remote) byKey[`${r.templateId}::${r.draftId}`] = { templateId: r.templateId, draftId: r.draftId, values: r.values, savedAt: r.savedAt };
      for (const l of local) byKey[`${l.templateId}::${l.draftId}`] = l; // 로컬 우선(더 최신일 수 있음)
      return Object.values(byKey).sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
    } catch { return local; }
  },

  /** 사용자 명시 삭제만 */
  async remove(templateId, draftId) {
    await idb.del('drafts', key(templateId, draftId)).catch(() => {});
    bus.publish('draft.removed', { templateId, draftId });
  },
};
