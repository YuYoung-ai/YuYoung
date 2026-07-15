/************************************************************
 * template-service.js — Template 로드/목록 (DOCUMENT_ENGINE_SPEC)
 * ----------------------------------------------------------
 * S2: 번들된 v2/templates/*.json 을 시드로 로드 + 계약 검증.
 * GAS 연결(S2-후반)에서 store remote 드라이버로 목록 대체.
 ************************************************************/
import { jsonSchema } from './json-schema.js';
import { logger } from '../infra/logger.js';

const SEED_IDS = ['weekly-report', 'meeting-minutes', 'trip-report'];
const cache = new Map();
let ready = null;

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

export const templateService = {
  async init() {
    if (ready) return ready;
    ready = Promise.all(SEED_IDS.map(async id => {
      try { cache.set(id, await loadOne(id)); }
      catch (e) { logger.error('E-TEMPLATE-LOAD', { meta: { id, e: String(e) } }); }
    })).then(() => this.list());
    return ready;
  },

  list() {
    return [...cache.values()].map(t => ({
      id: t.id, name: t.name, desc: t.desc, category: t.category || '기타',
      version: t.version, formats: t.formats || [], minLevel: t.minLevel || 1,
      golden: !!t.golden, valid: t.__valid !== false,
    }));
  },

  get(id) { return cache.get(id) || null; },

  categories() {
    const set = new Set(this.list().map(t => t.category));
    return [...set];
  },
};
