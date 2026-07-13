/************************************************************
 * prefs.js — 개인 설정 (SETTINGS_UX.md · DESIGN_SYSTEM)
 * ----------------------------------------------------------
 * Theme(light/dark/system) · Font Scale. localStorage 즉시 적용.
 ************************************************************/
import { CONFIG } from '../infra/config.js';

const KEY = CONFIG.LS_PREFIX + 'prefs';
const DEFAULTS = { theme: 'system', fontScale: 1 };

function load() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; } }
function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {} }

export const prefs = {
  get() { return load(); },

  apply(p) {
    p = p || load();
    const root = (typeof document !== 'undefined') ? document.documentElement : null;
    if (!root) return;
    if (p.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', p.theme);
    root.style.setProperty('--font-scale', String(p.fontScale || 1));
  },

  set(patch) { const p = { ...load(), ...patch }; save(p); this.apply(p); return p; },
};
