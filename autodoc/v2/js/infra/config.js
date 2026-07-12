/************************************************************
 * config.js — v2 전역 설정 (Configuration First)
 * ----------------------------------------------------------
 * GAS URL · 버전 상수 · 기본 Workspace 등 코드 상수를 한 곳에.
 * spec: TECH_SPEC §1, DEPLOYMENT_SPEC, API_SPEC(apiVersion)
 ************************************************************/

export const CONFIG = Object.freeze({
  // v2 전용 GAS 웹앱 /exec URL — 배포 후 채움 (S2)
  GAS_URL: '',
  API_VERSION: 1,
  ENGINE_VERSION: 'v2.5.0',
  SCHEMA_VERSION: { event: '1' },
  DEFAULT_WORKSPACE: 'default',
  // 네트워크
  TIMEOUT_MS: 30000,
  BOOTSTRAP_TIMEOUT_MS: 60000,
  RETRY_BACKOFF_MS: [2000, 4000, 8000],
  // 로컬 저장
  IDB_NAME: 'ad2',
  IDB_VERSION: 1,
  LS_PREFIX: 'ad2.',
});
