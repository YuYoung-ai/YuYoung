/************************************************************
 * auth.js — 인증 래퍼 (AUTH_SPEC)
 * ----------------------------------------------------------
 * v1 전역 BazAuth(루트 auth.js, 무수정)를 위임 재사용.
 * 레벨 매핑: level>=2 → admin, 그 외 → user (v1 현실: 1 일반 / 2 관리자)
 * auth.expired 이벤트 발행 · 라우터 가드 제공.
 ************************************************************/
import { CONFIG } from './config.js';
import { bus } from './bus.js';
import { logger } from './logger.js';
import { workspaceContext } from './workspace-context.js';

function baz() {
  // v1 auth.js 가 클래식 <script> 로 먼저 로드되어 전역 제공
  return (typeof window !== 'undefined' && window.BazAuth) ? window.BazAuth : null;
}

function levelToRole(level) {
  return (Number(level) >= 2) ? 'admin' : 'user';
}

let cachedSession = null;
let expiryTimer = null;

function buildSession(level) {
  if (!level || Number(level) <= 0) return null;
  return {
    role: levelToRole(level),
    level: Number(level),
    workspaceId: CONFIG.DEFAULT_WORKSPACE, // MVP 단일 Workspace
    // 만료 시각은 v1 세션 스토리지가 관리 — 여기선 role 판정만
  };
}

async function refresh() {
  const b = baz();
  if (!b) { cachedSession = null; return null; }
  const level = await b.currentLevel();
  cachedSession = buildSession(level);
  return cachedSession;
}

export const auth = {
  async login(password) {
    const b = baz();
    if (!b) throw new Error('BazAuth 미로드');
    const r = await b.login(password);
    if (r && r.ok) {
      cachedSession = buildSession(r.level);
      workspaceContext.setActive(cachedSession ? cachedSession.workspaceId : CONFIG.DEFAULT_WORKSPACE);
      this._startWatch();
    }
    return r;
  },

  logout() {
    const b = baz();
    if (b) b.logout();
    cachedSession = null;
    if (expiryTimer) { clearInterval(expiryTimer); expiryTimer = null; }
  },

  /** 동기 조회 — 마지막으로 확인된 세션 */
  session() { return cachedSession; },

  /** 서버 기준 재확인(비동기) */
  async ensure() { return refresh(); },

  /** 라우터 가드: 'user' | 'admin' 요구 */
  guard(requiredRole) {
    const s = cachedSession;
    if (!s) return false;
    if (requiredRole === 'admin') return s.role === 'admin';
    return true; // user 이상
  },

  /** API 요청 봉투에 토큰 첨부 (S2에서 실제 API 클라이언트가 사용) */
  withToken(request = {}) {
    const b = baz();
    const token = b && b.token ? b.token() : (b && b.getToken ? b.getToken() : null);
    return { ...request, token: token || null, workspaceId: (cachedSession && cachedSession.workspaceId) || CONFIG.DEFAULT_WORKSPACE };
  },

  _startWatch() {
    if (expiryTimer) return;
    expiryTimer = setInterval(async () => {
      const prev = cachedSession;
      const now = await refresh();
      if (prev && !now) {
        logger.warn('E-AUTH-EXPIRED');
        bus.publish('auth.expired', {});
      }
    }, 60000);
  },
};
