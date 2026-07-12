/************************************************************
 * history.js — 생성 이력 (DOCUMENT_ENGINE_SPEC · 내 문서)
 * ----------------------------------------------------------
 * S3: 로컬(IndexedDB kv) 기록. GAS 연결 시 v2.history.record 로 승격.
 ************************************************************/
import { idb } from '../infra/idb.js';
import { bus } from '../infra/bus.js';

const KEY = 'history';

export const history = {
  async add(rec) {
    const list = (await idb.get('kv', KEY).catch(() => null)) || [];
    const entry = { id: 'doc-' + Date.now().toString(36), at: new Date().toISOString(), ...rec };
    list.unshift(entry);
    await idb.put('kv', KEY, list.slice(0, 200)).catch(() => {});
    bus.publish('history.recorded', { id: entry.id });
    return entry;
  },
  async list() {
    return (await idb.get('kv', KEY).catch(() => null)) || [];
  },
};
