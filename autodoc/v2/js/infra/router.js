/************************************************************
 * router.js — 해시 라우팅 (ROUTING_SPEC)
 * ----------------------------------------------------------
 * 단일 셸 + #/경로. 가드(인증·권한) · 화면 동적 마운트 ·
 * 이탈 훅(Draft 저장 — 차단 금지, 항상 진행).
 ************************************************************/
import { bus } from './bus.js';
import { auth } from './auth.js';
import { logger } from './logger.js';

const routes = []; // { re, keys, def }
let currentScreen = null; // { unmount, path }
let leaveHooks = [];
let outlet = null;
let notFoundPath = '#/'; // 기본 이동지(대시보드는 index.html이지만 셸 내부는 catalog)

function compile(path) {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:[^/]+/g, m => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  return { re, keys };
}

function parseHash() {
  const raw = (location.hash || '#/').replace(/^#/, '');
  const [p, qs] = raw.split('?');
  const params = {};
  if (qs) for (const kv of qs.split('&')) { const [k, v] = kv.split('='); params[decodeURIComponent(k)] = decodeURIComponent(v || ''); }
  return { path: p || '/', params };
}

export const router = {
  mount(outletEl, opts = {}) {
    outlet = outletEl;
    if (opts.notFound) notFoundPath = opts.notFound;
    window.addEventListener('hashchange', () => this._resolve());
    return this;
  },

  /** 라우트 등록. def = { screen: async(ctx)->{mount,unmount?}, guard?, title? } */
  register(path, def) {
    const { re, keys } = compile('/' + path.replace(/^\/?/, ''));
    routes.push({ re, keys, def, path });
    return this;
  },

  go(path, params) {
    let hash = '#' + (path.startsWith('/') ? path : '/' + path);
    if (params) {
      const qs = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
      if (qs) hash += '?' + qs;
    }
    if (location.hash === hash) this._resolve(); else location.hash = hash;
  },

  current() { return parseHash(); },

  onLeave(fn) { leaveHooks.push(fn); return () => { leaveHooks = leaveHooks.filter(h => h !== fn); }; },

  start() { this._resolve(); return this; },

  async _resolve() {
    const { path, params } = parseHash();
    let matched = null, values = {};
    for (const r of routes) {
      const m = r.re.exec('/' + path.replace(/^\/?/, ''));
      if (m) { matched = r; r.keys.forEach((k, i) => { values[k] = m[i + 1]; }); break; }
    }
    if (!matched) { logger.info('ROUTE-NOTFOUND', { path }); this.go(notFoundPath); return; }

    // 가드
    const need = matched.def.guard;
    if (need && !auth.guard(need)) {
      logger.warn('E-PERM-ROUTE', { meta: { path, need } });
      bus.publish('route.denied', { path, need });
      this.go(notFoundPath);
      return;
    }

    // 이탈 훅 — Draft 저장 등 (항상 진행, 차단 없음)
    for (const h of leaveHooks) { try { await h(); } catch (e) { logger.warn('ROUTE-LEAVE', { meta: { e: String(e) } }); } }
    if (currentScreen && currentScreen.unmount) { try { currentScreen.unmount(); } catch {} }
    leaveHooks = [];

    const ctx = { params: { ...params, ...values }, outlet };
    try {
      const screen = await matched.def.screen(ctx);
      if (screen && screen.mount) screen.mount(outlet, ctx);
      currentScreen = { unmount: screen && screen.unmount, path };
      if (matched.def.title && typeof document !== 'undefined') document.title = matched.def.title + ' · AutoDoc';
      bus.publish('route.changed', { path });
    } catch (err) {
      logger.error('E-INTERNAL', { meta: { path, err: String(err && err.message || err) } });
    }
  },
};
