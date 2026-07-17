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
      // 기본 레이아웃 자동 생성: 짧은 필드는 KPI 카드(한 줄 3개), 긴 글·표는
      // 전폭 블록으로 배치하고 8행을 넘으면 페이지를 나눈다.
      const typeOf = f => f.type || 'text';
      const content = t.inputs.filter(f => !['image', 'signature', 'file'].includes(typeOf(f)));
      const SHORT = ['text', 'number', 'date', 'week', 'select', 'radio', 'checkbox'];
      const shorts = content.filter(f => SHORT.includes(typeOf(f))).slice(0, 6);
      const longs = content.filter(f => !shorts.includes(f));
      const writerKey = shorts.find(f => /writer|작성자/.test(f.key + (f.label || '')));

      const header = { component: 'header', area: '1 / 1 / 2 / 13',
        props: { title: t.name, writer: writerKey ? '@' + writerKey.key : undefined, date: '@fn.today' } };
      const footer = { component: 'footer', area: '8 / 1 / 9 / 13',
        props: { text: `${t.name} · @fn.today` } };

      const pages = [];
      let blocks = [], row = 2;
      const flush = () => {
        if (!blocks.length) return;
        pages.push({ blocks: [header, ...blocks, footer] });
        blocks = []; row = 2;
      };

      for (let i = 0; i < shorts.length; i += 3) {
        const rowFields = shorts.slice(i, i + 3);
        const w = Math.floor(12 / rowFields.length);
        rowFields.forEach((f, j) => {
          const c1 = 1 + j * w;
          const c2 = (j === rowFields.length - 1) ? 13 : c1 + w;
          blocks.push({ component: 'card', area: `${row} / ${c1} / ${row + 2} / ${c2}`,
            props: { title: f.label, value: '@' + f.key } });
        });
        row += 2;
        if (row + 2 > 8) flush();
      }
      for (const f of longs) {
        const h = typeOf(f) === 'table' ? 3 : 2;
        if (row + h > 8) flush();
        blocks.push(typeOf(f) === 'table'
          ? { component: 'table', area: `${row} / 1 / ${row + h} / 13`,
              props: { title: f.label, columns: (f.columns || []).map(c => ({ key: c.key, label: c.label || c.key })), rows: '@' + f.key } }
          : { component: 'text', area: `${row} / 1 / ${row + h} / 13`,
              props: { title: f.label, content: '@' + f.key } });
        row += h;
      }
      flush();
      if (!pages.length) pages.push({ blocks: [header, footer] });
      t.layout = { grid: { cols: 12, rows: 8, gap: 0.1 }, pages };
    }
    return t;
  },

  categories() {
    const set = new Set(this.list().map(t => t.category));
    return [...set];
  },
};
