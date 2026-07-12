/************************************************************
 * draft.js — Draft 자동 저장/복원 (LOCAL_STORAGE_SPEC)
 * ----------------------------------------------------------
 * IndexedDB 'drafts' 스토어. 자동 삭제 금지 — 사용자 명시 행동만.
 * 키: templateId::draftId
 ************************************************************/
import { idb } from '../infra/idb.js';
import { bus } from '../infra/bus.js';

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
    return rec;
  },

  async get(templateId, draftId) {
    return idb.get('drafts', key(templateId, draftId)).catch(() => null);
  },

  async list() {
    const all = await idb.all('drafts').catch(() => []);
    return all.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  },

  /** 사용자 명시 삭제만 */
  async remove(templateId, draftId) {
    await idb.del('drafts', key(templateId, draftId)).catch(() => {});
    bus.publish('draft.removed', { templateId, draftId });
  },
};
