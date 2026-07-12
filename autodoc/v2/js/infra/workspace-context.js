/************************************************************
 * workspace-context.js — Workspace 격리 (STORAGE_SPEC · I5)
 * ----------------------------------------------------------
 * 모든 저장 접근의 진입점. MVP는 단일 Workspace.
 * 호출자가 임의 WS 를 지정할 수 없도록 세션에서 해석.
 ************************************************************/
import { CONFIG } from './config.js';

let active = CONFIG.DEFAULT_WORKSPACE;

export const workspaceContext = {
  /** 세션이 확정한 현재 Workspace 로 고정 */
  setActive(workspaceId) {
    active = workspaceId || CONFIG.DEFAULT_WORKSPACE;
  },

  current() { return active; },

  /** 컬렉션 접근 좌표 — Store 가 사용 */
  resolve(workspaceId) {
    const ws = workspaceId || active;
    return {
      workspaceId: ws,
      // 컬렉션 -> 저장 참조 (drivers 가 해석)
      ref(collection) { return { ws, collection }; },
    };
  },
};
