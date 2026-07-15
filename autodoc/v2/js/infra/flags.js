/************************************************************
 * flags.js — Feature Flag (FEATURE_FLAG.md)
 * ----------------------------------------------------------
 * 정의는 전역, 값은 Workspace별. MVP는 상수 기본값 + 로컬 override.
 * 판정은 isOn() 단일 진입점.
 ************************************************************/
import { CONFIG } from './config.js';
import { bus } from './bus.js';

// 전역 카탈로그 — { default, requires[], sensitive }
const CATALOG = {
  'learning.enabled': { default: false, requires: [] },
  'learning.autoApply98': { default: false, requires: ['learning.enabled'], sensitive: true },
  'golden.score': { default: false, requires: [] },
  'workflow.enabled': { default: false, requires: [] },
  'replay.enabled': { default: true, requires: [] },
  'plugin.host': { default: false, requires: [] },
};

const LS_KEY = CONFIG.LS_PREFIX + 'flags';

function loadOverrides() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
  catch { return {}; }
}
function saveOverrides(o) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch {}
}

export const flags = {
  list() {
    return Object.entries(CATALOG).map(([flagId, def]) => ({ flagId, ...def }));
  },

  isOn(flagId, workspaceId = CONFIG.DEFAULT_WORKSPACE) {
    const def = CATALOG[flagId];
    if (!def) return false;
    // 의존 Flag가 꺼져 있으면 강제 off
    for (const dep of def.requires || []) {
      if (!this.isOn(dep, workspaceId)) return false;
    }
    const ov = loadOverrides();
    const key = workspaceId + '::' + flagId;
    return key in ov ? !!ov[key] : !!def.default;
  },

  validate(flagId, workspaceId = CONFIG.DEFAULT_WORKSPACE) {
    const def = CATALOG[flagId];
    if (!def) return ['unknown-flag'];
    const violations = [];
    const ov = loadOverrides();
    const wantOn = ov[workspaceId + '::' + flagId] ?? def.default;
    if (wantOn) {
      for (const dep of def.requires || []) {
        if (!this.isOn(dep, workspaceId)) violations.push('requires:' + dep);
      }
    }
    return violations;
  },

  set(flagId, workspaceId, value) {
    if (!CATALOG[flagId]) throw new Error('unknown flag: ' + flagId);
    const ov = loadOverrides();
    ov[workspaceId + '::' + flagId] = !!value;
    saveOverrides(ov);
    bus.publish('flag.changed', { flagId, workspaceId, value: !!value });
  },
};
