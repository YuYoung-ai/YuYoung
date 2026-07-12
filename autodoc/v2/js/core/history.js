/************************************************************
 * history.js — 생성 이력 (DOCUMENT_ENGINE_SPEC · 내 문서)
 * ----------------------------------------------------------
 * local-first(IndexedDB) + GAS 동기(best-effort). 오프라인에서도 동작.
 ************************************************************/
import { idb } from '../infra/idb.js';
import { bus } from '../infra/bus.js';
import { api } from '../infra/api.js';

const KEY = 'history';

export const history = {
  async add(rec) {
    const list = (await idb.get('kv', KEY).catch(() => null)) || [];
    const entry = { id: 'doc-' + Date.now().toString(36), at: new Date().toISOString(), ...rec };
    list.unshift(entry);
    await idb.put('kv', KEY, list.slice(0, 200)).catch(() => {});
    bus.publish('history.recorded', { id: entry.id });
    // GAS 동기 — 오프라인/실패 시 큐 적재(멱등 requestId)
    api.write('v2.history.record', { record: entry }, { requestId: 'rh-' + entry.id }).catch(() => {});
    return entry;
  },

  async list() {
    const local = (await idb.get('kv', KEY).catch(() => null)) || [];
    if (!api.configured()) return local;
    try {
      const remote = (await api.request('v2.history.list', {})).items || [];
      // id 기준 병합(로컬 우선) → 최신순
      const byId = {};
      for (const r of remote) byId[r.id] = r;
      for (const l of local) byId[l.id] = l;
      return Object.values(byId).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    } catch { return local; }
  },
};
