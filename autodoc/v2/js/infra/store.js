/************************************************************
 * store.js — 저장 추상화 (STORAGE_SPEC · I2 · I5)
 * ----------------------------------------------------------
 * 상위 모듈은 매체(GAS/Sheets · 로컬)를 모른다.
 * local-first 읽기 · 쓰기 권한표 · Workspace 격리.
 * S1: local 드라이버(IndexedDB) + memory remote(placeholder).
 *     실제 remote(GAS API)는 S2에서 드라이버 교체.
 ************************************************************/
import { idb } from './idb.js';
import { bus } from './bus.js';
import { logger } from './logger.js';
import { workspaceContext } from './workspace-context.js';

// 컬렉션 -> { asset:boolean, writers:[모듈명] }  (I2 집행: writers 만 put 가능)
const COLLECTIONS = {
  templates: { asset: true, writers: ['admin'] },
  golden: { asset: true, writers: ['approval', 'admin'] },
  prompts: { asset: true, writers: ['admin', 'prompt-engine'] },
  dna: { asset: true, writers: ['learning'] }, // I2: 승인된 learning.apply 만
  kb: { asset: false, writers: ['learning', 'admin'] },
  memory: { asset: false, writers: ['learning'] },
  rules: { asset: true, writers: ['learning', 'admin'] },
  learning: { asset: false, writers: ['learning', 'confidence', 'approval'] },
  history: { asset: false, writers: ['history', 'document'] },
  workspace: { asset: false, writers: ['admin', 'settings'] },
  kv: { asset: false, writers: ['*'] },
};

// ── local 드라이버 (IndexedDB 'cache' 스토어) ────────────────
function cacheKey(ws, collection, id, version) {
  return `${ws}::${collection}::${id}` + (version != null ? `@${version}` : '');
}
const localDriver = {
  async read(ws, collection, id, version) { return idb.get('cache', cacheKey(ws, collection, id, version)); },
  async write(ws, collection, record) {
    const v = record.version != null ? record.version : null;
    await idb.put('cache', cacheKey(ws, collection, record.id, v), record);
    // 최신 포인터도 갱신
    await idb.put('cache', cacheKey(ws, collection, record.id), record);
    return record;
  },
  async query(ws, collection) {
    const all = await idb.all('cache').catch(() => []);
    const prefix = `${ws}::${collection}::`;
    // 최신 포인터(버전 없는 키)만 목록에 — 중복 제거
    return all.filter(r => r && r.id && r.__k && r.__k.startsWith(prefix) && !r.__k.includes('@'));
  },
};

// ── memory remote (placeholder — S2에서 GAS API 로 교체) ─────
const mem = new Map();
let remoteDriver = {
  async read(ws, collection, id, version) { return mem.get(cacheKey(ws, collection, id, version)) || null; },
  async write(ws, collection, record) {
    mem.set(cacheKey(ws, collection, record.id, record.version ?? null), record);
    mem.set(cacheKey(ws, collection, record.id), record);
    return record;
  },
  async query(ws, collection) {
    const prefix = `${ws}::${collection}::`;
    const out = [];
    for (const [k, v] of mem) if (k.startsWith(prefix) && !k.includes('@')) out.push(v);
    return out;
  },
  online() { return true; },
};

export const store = {
  /** S2: GAS API 드라이버로 교체 */
  setRemoteDriver(driver) { remoteDriver = driver; },

  _canWrite(collection, byModule) {
    const def = COLLECTIONS[collection];
    if (!def) return false;
    if (def.writers.includes('*')) return true;
    return def.writers.includes(byModule);
  },

  async get(collection, id, opts = {}) {
    const ws = workspaceContext.current();
    // local-first
    const cached = await localDriver.read(ws, collection, id, opts.version).catch(() => null);
    if (cached) return cached;
    const remote = await remoteDriver.read(ws, collection, id, opts.version).catch(() => null);
    if (remote) { remote.__k = cacheKey(ws, collection, remote.id, remote.version ?? null); await localDriver.write(ws, collection, remote).catch(() => {}); }
    return remote;
  },

  async list(collection) {
    const ws = workspaceContext.current();
    // stale-while-revalidate: 캐시 즉시, 백그라운드 갱신
    const cachedP = localDriver.query(ws, collection).catch(() => []);
    const remoteP = (remoteDriver.online ? remoteDriver.online() : true)
      ? remoteDriver.query(ws, collection).catch(() => null)
      : Promise.resolve(null);
    const cached = await cachedP;
    remoteP.then(async remote => {
      if (!remote) return;
      for (const r of remote) { r.__k = cacheKey(ws, collection, r.id); await localDriver.write(ws, collection, r).catch(() => {}); }
      if (remote.length) bus.publish('cache.refreshed', { collection });
    });
    return cached;
  },

  /**
   * 쓰기. byModule 은 호출 모듈명(권한표 대조 — I2).
   * 온라인이면 remote → local, 오프라인/실패면 로컬 낙관 반영 + 큐(S6).
   */
  async put(collection, record, opts = {}) {
    const by = opts.by || 'unknown';
    if (!this._canWrite(collection, by)) {
      logger.error('E-PERM-WRITE', { meta: { collection, by } });
      throw Object.assign(new Error('write denied'), { code: 'E-PERM-WRITE' });
    }
    const ws = workspaceContext.current();
    const rec = { workspaceId: ws, ...record };
    rec.__k = cacheKey(ws, collection, rec.id, rec.version ?? null);
    // remote 우선 시도
    try {
      const saved = await remoteDriver.write(ws, collection, rec);
      await localDriver.write(ws, collection, saved).catch(() => {});
      bus.publish(collection + '.updated', { id: rec.id, version: rec.version ?? null });
      return saved;
    } catch (err) {
      // 오프라인/실패 → 로컬 낙관 반영 (전송 큐는 S6 sync-queue 가 담당)
      logger.warn('E-NET-WRITE', { meta: { collection, err: String(err && err.message || err) } });
      await localDriver.write(ws, collection, rec).catch(() => {});
      throw Object.assign(new Error('write deferred'), { code: 'E-NET-OFFLINE', record: rec });
    }
  },

  async history(collection, id) {
    const ws = workspaceContext.current();
    const all = await idb.all('cache').catch(() => []);
    const prefix = `${ws}::${collection}::${id}@`;
    return all.filter(r => r && r.__k && r.__k.startsWith(prefix));
  },
};
