/************************************************************
 * logger.js — 기술 로그 정책 (LOGGING_SPEC)
 * ----------------------------------------------------------
 * 레벨: ERROR/WARN/INFO/DEBUG · 링버퍼 · 개인정보 마스킹.
 * Audit(비즈니스 변경)와는 별개 체계.
 ************************************************************/

const LEVELS = { ERROR: 40, WARN: 30, INFO: 20, DEBUG: 10 };
const RING_MAX = 200;

let currentLevel = LEVELS.INFO;
const ring = [];

// 토큰·문서 내용·PII 로 의심되는 키는 값 대신 형태만 남긴다.
const SENSITIVE = /(token|password|pw|secret|apikey|api_key|content|body|value|values|payload)/i;
function mask(meta) {
  if (meta == null || typeof meta !== 'object') return meta;
  const out = Array.isArray(meta) ? [] : {};
  for (const k of Object.keys(meta)) {
    const v = meta[k];
    if (SENSITIVE.test(k)) {
      out[k] = typeof v === 'string' ? `‹str:${v.length}›` : `‹${typeof v}›`;
    } else if (v && typeof v === 'object') {
      out[k] = mask(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function push(rec) {
  ring.push(rec);
  if (ring.length > RING_MAX) ring.shift();
}

export const logger = {
  setLevel(name) {
    if (LEVELS[name] != null) currentLevel = LEVELS[name];
  },

  log(level, code, ctx = {}) {
    const lv = LEVELS[level] ?? LEVELS.INFO;
    if (lv < currentLevel) return;
    const rec = {
      ts: new Date().toISOString(),
      level,
      code: code || null,
      requestId: ctx.requestId || null,
      causationId: ctx.causationId || null,
      meta: mask(ctx.meta),
    };
    if (lv >= LEVELS.WARN) push(rec);
    const line = `[${rec.level}]${code ? ' ' + code : ''}`;
    if (lv >= LEVELS.ERROR && typeof console !== 'undefined') console.error(line, rec.meta ?? '');
    else if (lv >= LEVELS.WARN && typeof console !== 'undefined') console.warn(line, rec.meta ?? '');
    else if (typeof console !== 'undefined' && currentLevel <= LEVELS.DEBUG) console.log(line, rec.meta ?? '');
    return rec;
  },

  error(code, meta) { return this.log('ERROR', code, { meta }); },
  warn(code, meta) { return this.log('WARN', code, { meta }); },
  info(code, meta) { return this.log('INFO', code, { meta }); },
  debug(code, meta) { return this.log('DEBUG', code, { meta }); },

  // 사용자 "문제 신고" 시 첨부 — 이미 마스킹된 링버퍼
  exportDiagnostics() {
    return { engine: 'ad2', at: new Date().toISOString(), records: ring.slice() };
  },
};
