/************************************************************
 * sync-queue.js — 오프라인 쓰기 큐 (OFFLINE_SYNC_SPEC)
 * ----------------------------------------------------------
 * S1: 큐 적재/조회 골격 + 재연결 감지. 실제 전송·충돌 해소는 S6.
 * requestId 멱등 좌표를 그대로 보존.
 ************************************************************/
import { idb } from './idb.js';
import { bus } from './bus.js';

let sender = null; // S6에서 api 클라이언트 주입: async (envelope) => result

export const syncQueue = {
  /** S6: 실제 전송기 주입 */
  setSender(fn) { sender = fn; },

  async enqueue(requestEnvelope) {
    const id = requestEnvelope.requestId || ('req-' + Date.now().toString(36));
    await idb.put('queue', id, { ...requestEnvelope, requestId: id, queuedAt: new Date().toISOString() });
    bus.publish('sync.queued', { requestId: id, action: requestEnvelope.action || null });
    return id;
  },

  async pending() {
    const keys = await idb.keys('queue').catch(() => []);
    return keys.length;
  },

  async drain() {
    if (!sender) return { sent: 0, failed: [], conflicts: [] };
    const items = await idb.all('queue').catch(() => []);
    const out = { sent: 0, failed: [], conflicts: [] };
    for (const it of items) {
      try {
        const res = await sender(it);
        if (res && res.ok) { await idb.del('queue', it.requestId); out.sent += 1; }
        else if (res && res.error && res.error.code === 'E-CONFLICT') out.conflicts.push(it.requestId);
        else out.failed.push(it.requestId);
      } catch {
        out.failed.push(it.requestId); // retryable — 다음 drain 에서 재시도
      }
    }
    bus.publish('sync.completed', out);
    return out;
  },

  _watch() {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => { this.drain(); });
  },
};
