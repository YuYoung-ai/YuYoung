/************************************************************
 * sync-boot.js — 동기 큐 배선 (OFFLINE_SYNC_SPEC)
 * ----------------------------------------------------------
 * sender 주입(api) + online 감시 + 최초 drain. HTML 부트에서 1회 호출.
 * (api ↔ sync-queue 순환 회피를 위해 배선만 이 모듈에서 담당)
 ************************************************************/
import { api } from './api.js';
import { syncQueue } from './sync-queue.js';
import { bus } from './bus.js';

let started = false;

export function startSync() {
  if (started) return;
  started = true;

  syncQueue.setSender(async (item) => {
    try {
      await api.request(item.action, item.payload, { requestId: item.requestId });
      return { ok: true };
    } catch (e) {
      // 비재시도(스키마·권한 등)면 큐에서 제거, 재시도성은 남겨 다음 drain
      if (e && e.code && !e.retryable && e.code !== 'E-NET-OFFLINE') return { ok: false, error: e };
      throw e;
    }
  });

  syncQueue._watch();
  bus.subscribe('sync.completed', () => {/* 상태바 갱신은 화면이 구독 */});

  if (typeof navigator === 'undefined' || navigator.onLine) syncQueue.drain().catch(() => {});
}
