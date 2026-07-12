/************************************************************
 * api.js — GAS API 클라이언트 (API_SPEC · GOOGLE_APPS_SCRIPT_SPEC)
 * ----------------------------------------------------------
 * POST text/plain(프리플라이트 회피) + {action} 봉투. v1 auth.js 패턴 계승.
 * 브라우저 fetch 가 302→googleusercontent echo→JSON 을 자동 처리.
 * 오프라인/미설정이면 E-NET-OFFLINE 을 던져 호출측이 로컬 폴백하게 한다.
 ************************************************************/
import { CONFIG } from './config.js';
import { auth } from './auth.js';
import { workspaceContext } from './workspace-context.js';
import { logger } from './logger.js';
import { syncQueue } from './sync-queue.js';

let reqSeq = 0;
function newRequestId() { reqSeq += 1; return 'req-' + Date.now().toString(36) + '-' + reqSeq.toString(36); }

function configured() { return !!CONFIG.GAS_URL; }

async function postOnce(envelope, timeoutMs) {
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(CONFIG.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(envelope),
      signal: ctrl ? ctrl.signal : undefined,
      redirect: 'follow',
    });
    const text = await res.text();
    try { return JSON.parse(text); }
    catch { throw appErr('E-SCHEMA-JSON', '서버 응답 파싱 실패'); }
  } finally { if (timer) clearTimeout(timer); }
}

function appErr(code, message, retryable) { const e = new Error(message || code); e.code = code; e.retryable = !!retryable; return e; }

export const api = {
  configured,

  async health() {
    if (!configured()) throw appErr('E-NET-OFFLINE', 'GAS_URL 미설정');
    const res = await fetch(CONFIG.GAS_URL, { method: 'GET' });
    return res.json();
  },

  /**
   * 액션 호출. 성공 시 payload 반환, 실패 시 code 를 가진 Error throw.
   * retryable 오류는 지수 백오프 재시도(멱등 requestId 로 중복 방지).
   */
  async request(action, payload = {}, opts = {}) {
    if (!configured()) throw appErr('E-NET-OFFLINE', 'GAS_URL 미설정');
    const base = auth.withToken({
      action, apiVersion: CONFIG.API_VERSION,
      workspaceId: workspaceContext.current(),
      requestId: opts.requestId || newRequestId(),
      payload,
    });
    const timeout = opts.timeout || (action === 'v2.bootstrap' ? CONFIG.BOOTSTRAP_TIMEOUT_MS : CONFIG.TIMEOUT_MS);
    const backoff = [0, ...CONFIG.RETRY_BACKOFF_MS];
    let lastErr = null;
    for (let attempt = 0; attempt < backoff.length; attempt++) {
      if (backoff[attempt]) await sleep(backoff[attempt]);
      try {
        const body = await postOnce(base, timeout);
        if (body && body.ok) return body.payload;
        const err = (body && body.error) || { code: 'E-INTERNAL', message: '알 수 없는 오류', retryable: false };
        if (!err.retryable) throw appErr(err.code, err.message, false);
        lastErr = appErr(err.code, err.message, true);
      } catch (e) {
        // 네트워크/중단 = retryable
        if (e.code && !e.retryable) throw e;
        lastErr = e.code ? e : appErr('E-NET-TIMEOUT', String(e && e.message || e), true);
        logger.warn('E-NET-RETRY', { meta: { action, attempt } });
      }
    }
    throw lastErr || appErr('E-NET-TIMEOUT', '요청 실패', true);
  },

  /**
   * 쓰기 요청. 오프라인/미설정/재시도성 실패면 동기 큐에 적재(멱등 requestId).
   * 반환 { ok } | { queued:true }. 비재시도 오류만 throw.
   */
  async write(action, payload = {}, opts = {}) {
    const requestId = opts.requestId || newRequestId();
    if (!configured()) { await syncQueue.enqueue({ action, payload, requestId, dedupeKey: opts.dedupeKey }); return { queued: true }; }
    try {
      const p = await this.request(action, payload, { requestId });
      return { ok: true, payload: p };
    } catch (e) {
      if (e.code === 'E-NET-OFFLINE' || e.retryable) {
        await syncQueue.enqueue({ action, payload, requestId, dedupeKey: opts.dedupeKey });
        return { queued: true };
      }
      throw e;
    }
  },
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
