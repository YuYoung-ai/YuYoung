/************************************************************
 * bus.js — Event Bus (EVENT_BUS.md · MODULE_SPEC)
 * ----------------------------------------------------------
 * 모듈 간 직접 호출 금지 — 이벤트로만 연결.
 * 봉투: {eventId,name,schemaVersion,workspaceId,causationId,timestamp,payload}
 * 명명 규약: 대상.동사(과거형)  예) dna.updated
 * causationId: 핸들러 안에서의 발행은 자식 이벤트로 자동 연결.
 ************************************************************/
import { CONFIG } from './config.js';
import { logger } from './logger.js';

let seq = 0;
function nextId() {
  seq += 1;
  return 'evt-' + Date.now().toString(36) + '-' + seq.toString(36);
}

// name -> Set<handler>, 그리고 패턴(prefix.*) 구독
const exact = new Map();
const patterns = []; // { prefix, handler }

// 현재 처리 중인 이벤트(인과 사슬의 부모)
let causationStack = [];

// 재진입 폭주 방지
const MAX_DEPTH = 32;

function matchPattern(name, prefix) {
  return name === prefix || name.startsWith(prefix + '.');
}

export const bus = {
  /** 구독. name 또는 'prefix.*' 패턴. 반환값은 해제 함수. */
  subscribe(name, handler) {
    if (typeof handler !== 'function') throw new Error('bus.subscribe: handler 필요');
    if (name.endsWith('.*')) {
      const entry = { prefix: name.slice(0, -2), handler };
      patterns.push(entry);
      return () => {
        const i = patterns.indexOf(entry);
        if (i >= 0) patterns.splice(i, 1);
      };
    }
    let set = exact.get(name);
    if (!set) { set = new Set(); exact.set(name, set); }
    set.add(handler);
    return () => set.delete(handler);
  },

  /** 발행. 봉투를 자동 부착하고 구독자에게 순차 전달. eventId 반환. */
  publish(name, payload = {}, opts = {}) {
    if (causationStack.length >= MAX_DEPTH) {
      logger.error('E-BUS-DEPTH', { meta: { name, depth: causationStack.length } });
      return null;
    }
    const parent = causationStack[causationStack.length - 1];
    const envelope = {
      eventId: nextId(),
      name,
      schemaVersion: CONFIG.SCHEMA_VERSION.event,
      workspaceId: opts.workspaceId ?? (parent && parent.workspaceId) ?? CONFIG.DEFAULT_WORKSPACE,
      causationId: opts.causationId ?? (parent ? parent.eventId : null),
      timestamp: new Date().toISOString(),
      payload,
    };

    const handlers = [];
    const set = exact.get(name);
    if (set) for (const h of set) handlers.push(h);
    for (const p of patterns) if (matchPattern(name, p.prefix)) handlers.push(p.handler);

    causationStack.push(envelope);
    try {
      for (const h of handlers) {
        try {
          h(envelope);
        } catch (err) {
          // 구독자 1개의 오류가 다른 구독자·발행자에 전파되지 않음 (실패 격리)
          logger.error('E-BUS-HANDLER', { causationId: envelope.eventId, meta: { name, err: String(err && err.message || err) } });
          this.publish('event.handler.failed', { of: name, error: String(err && err.message || err) });
        }
      }
    } finally {
      causationStack.pop();
    }
    return envelope.eventId;
  },

  /** 테스트/진단용 — 등록 현황 */
  _stats() {
    return { exact: exact.size, patterns: patterns.length };
  },
};
