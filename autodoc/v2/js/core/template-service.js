/************************************************************
 * template-service.js — Template 로드/목록 (DOCUMENT_ENGINE_SPEC)
 * ----------------------------------------------------------
 * 번들된 v2/templates/*.json 시드 + GAS(Templates) 목록 병합.
 * Import 승인으로 서버에 등록된 양식이 카탈로그에 나타난다.
 ************************************************************/
import { jsonSchema } from './json-schema.js';
import { logger } from '../infra/logger.js';
import { api } from '../infra/api.js';

const SEED_IDS = ['weekly-report', 'meeting-minutes', 'trip-report'];
const cache = new Map();
let ready = null;
let seedsReady = null;

async function loadOne(id) {
  const res = await fetch(`templates/${id}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  const v = jsonSchema.validate('template.v1', json);
  if (!v.ok) logger.warn('E-SCHEMA-TEMPLATE', { meta: { id, violations: v.violations } });
  json.__valid = v.ok;
  json.__violations = v.violations;
  return json;
}

/** GAS Templates 컬렉션 병합 — 오프라인/지연 시 시드만으로 동작(지연 상한 8s).
 *  결과는 sessionStorage 에 5분 캐시 — index↔app 페이지 전환마다 재조회 방지. */
const REMOTE_CACHE_KEY = 'ad2.tplRemote';
const REMOTE_CACHE_TTL = 5 * 60 * 1000;

function applyRemote(items) {
  for (const t of (items || [])) {
    if (!t || !t.id || cache.has(t.id)) continue; // 번들 시드 우선
    const v = jsonSchema.validate('template.v1', t);
    if (!v.ok) { logger.warn('E-SCHEMA-TEMPLATE', { meta: { id: t.id, violations: v.violations } }); continue; }
    t.__valid = true;
    cache.set(t.id, t);
  }
}

async function mergeRemote() {
  if (!api.configured()) return;
  try {
    const c = JSON.parse(sessionStorage.getItem(REMOTE_CACHE_KEY) || 'null');
    if (c && (Date.now() - c.at) < REMOTE_CACHE_TTL) { applyRemote(c.items); return; }
  } catch {}
  try {
    const remote = await Promise.race([
      api.request('v2.template.list', {}),
      new Promise((_, rej) => setTimeout(() => rej(new Error('E-NET-TIMEOUT')), 8000)),
    ]);
    const items = remote.items || [];
    try { sessionStorage.setItem(REMOTE_CACHE_KEY, JSON.stringify({ at: Date.now(), items })); } catch {}
    applyRemote(items);
  } catch (e) {
    logger.warn('E-TEMPLATE-REMOTE', { meta: { e: String(e && e.message || e) } });
  }
}

export const templateService = {
  async init() {
    if (ready) return ready;
    seedsReady = Promise.all(SEED_IDS.map(async id => {
      try { cache.set(id, await loadOne(id)); }
      catch (e) { logger.error('E-TEMPLATE-LOAD', { meta: { id, e: String(e) } }); }
    }));
    ready = seedsReady.then(() => mergeRemote()).then(() => this.list());
    return ready;
  },

  /** 시드(번들 3종)만 즉시 — 화면은 이걸로 먼저 그리고, init() 완료 후 갱신.
   *  (원격 병합이 서버 상태에 따라 수 초 걸려도 카탈로그가 블록되지 않게) */
  async initLocal() {
    this.init(); // 전체 로드는 백그라운드로 계속
    return seedsReady;
  },

  list() {
    return [...cache.values()].map(t => ({
      id: t.id, name: t.name, desc: t.desc, category: t.category || '기타',
      version: t.version, formats: t.formats || [], minLevel: t.minLevel || 1,
      golden: !!t.golden, valid: t.__valid !== false,
    }));
  },

  get(id) { return cache.get(id) || null; },

  /** Import(AI 분석)로 추출된 template 초안 → 완전한 template.v1 로 정규화.
   *  layout 이 없으면 inputs 기반 기본 레이아웃(헤더+본문 블록+푸터)을 생성해
   *  미리보기·생성이 항상 가능하게 한다. */
  normalizeImported(raw) {
    const t = JSON.parse(JSON.stringify(raw || {}));
    if (!t.id) {
      const slug = String(t.name || 'imported').trim().toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'imported';
      t.id = 'imp-' + slug + '-' + Date.now().toString(36);
    }
    t.name = t.name || t.id;
    t.category = t.category || '가져온 양식';
    t.version = t.version || '1.0.0';
    t.minLevel = t.minLevel || 1;
    t.theme = t.theme || 'company-default';
    t.formats = Array.isArray(t.formats) && t.formats.length ? t.formats : ['pptx', 'xlsx', 'docx', 'pdf'];
    t.inputs = Array.isArray(t.inputs) ? t.inputs.filter(f => f && f.key) : [];
    for (const f of t.inputs) { if (!f.label) f.label = f.key; }
    if (!t.layout || !Array.isArray(t.layout.pages) || !t.layout.pages.length) {
      const content = t.inputs.filter(f => (f.type || 'text') !== 'image' && (f.type || 'text') !== 'signature' && (f.type || 'text') !== 'file');
      const blocks = content.map(f => (f.type === 'table'
        ? { component: 'table', props: { title: f.label, columns: (f.columns || []).map(c => ({ key: c.key, label: c.label || c.key })), rows: '@' + f.key } }
        : { component: 'text', props: { title: f.label, content: '@' + f.key } }));
      const pages = [];
      for (let i = 0; i < Math.max(1, Math.ceil(blocks.length / 3)); i++) {
        const chunk = blocks.slice(i * 3, i * 3 + 3);
        const pageBlocks = [{ component: 'header', area: '1 / 1 / 2 / 13', props: { title: t.name, date: '@fn.today' } }];
        chunk.forEach((b, j) => { pageBlocks.push({ ...b, area: `${2 + j * 2} / 1 / ${4 + j * 2} / 13` }); });
        pageBlocks.push({ component: 'footer', area: '8 / 1 / 9 / 13', props: { text: `${t.name} · @fn.today` } });
        pages.push({ blocks: pageBlocks });
      }
      t.layout = { grid: { cols: 12, rows: 8, gap: 0.1 }, pages };
    }
    return t;
  },

  categories() {
    const set = new Set(this.list().map(t => t.category));
    return [...set];
  },
};
