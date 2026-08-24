/************************************************************
 * type-example-manager.js — VOC 유형별 대표 사진(예시) 등록 도구
 * ----------------------------------------------------------
 * 왜 별도 파일인가:
 *  · 대표 사진 조회(dashboard-pc.html의 exTypeExample*)는 정적 index.json + 정적
 *    이미지 한 장이면 끝난다. 반면 "등록"은 캔버스 재인코딩·해시·파일 저장까지
 *    필요해 코드가 크다. 일반 사용자가 대시보드를 열 때 이 무게를 지불할 이유가
 *    없으므로, 관리 버튼을 누른 순간에만 <script>로 내려받는다.
 *  · js/baz-photo.js의 compress()는 업무사진(JPEG → GAS 업로드) 전용이다.
 *    대표 사진은 WebP·공개 저장소용이라 기준이 달라, 회귀 위험을 피하려고
 *    여기에 별도 변환기를 둔다(공유·수정하지 않는다).
 *
 * 이 모듈은 GAS·Google Sheets·Drive를 호출하지 않는다. 네트워크 요청 자체가 없고,
 * 유형 목록은 대시보드가 이미 받아 둔 데이터를, 매니페스트는 대시보드가 이미
 * 페이지당 1회 받아 둔 index.json을 그대로 받아서 쓴다.
 *
 * ES5 호환(빌드 없음). 브라우저는 window.BazTypeExampleManager, Node는 module.exports.
 ************************************************************/
(function (root, factory) {
  var api = factory();
  root.BazTypeExampleManager = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /* ══════════════════════════════════════════════════════════════════
     1. 순수 함수 — 브라우저 없이도 그대로 실행·검증할 수 있는 부분
     ══════════════════════════════════════════════════════════════════ */

  var ASSET_ROOT = 'assets/type-examples/';
  var MEDIA_DIR = ASSET_ROOT + 'media/';
  var MANIFEST_PATH = ASSET_ROOT + 'index.json';
  /* 슬롯 두 개가 전부다. 순서는 화면 표시 순서와 같다. */
  var SLOTS = [{ id: 'symptom', label: '증상' }, { id: 'after', label: '처리 결과' }];

  var MAX_DIM = 1200;                    /* 긴 변 상한 — 원본이 더 작으면 확대하지 않는다 */
  var TARGET_BYTES = 300 * 1024;         /* 이 아래로 내려오면 채택 */
  var IDEAL_MIN_BYTES = 100 * 1024;      /* 안내용 하한(강제하지 않음) */
  var QUALITY_STEPS = [0.88, 0.80, 0.72, 0.64, 0.56, 0.48];
  var DIM_STEPS = [1, 0.85, 0.72, 0.6, 0.5];
  var MIN_DIM = 480;
  var TEXT_MAX = 300;                    /* 대시보드가 표시할 때 자르는 길이와 맞춘다 */

  /** 공백 정규화 — dashboard-pc.html의 exTypeExampleNorm_ 과 같은 규칙 */
  function norm(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  /** 공백을 모두 지운 비교용 키 — exTypeExampleLooseKey_ 와 같은 규칙 */
  function looseKey(v) { return norm(v).replace(/\s+/g, ''); }

  /** `대분류|유형` 키. 유형이 없으면 키를 만들지 않는다(조회 쪽과 동일). */
  function makeKey(cat, type) {
    var c = norm(cat), t = norm(type);
    return t ? c + '|' + t : '';
  }
  /** 키를 대분류/유형으로 되돌린다(유형에 '|'가 없다는 전제 — 첫 구분자 기준) */
  function splitKey(key) {
    var s = String(key || ''), at = s.indexOf('|');
    return at < 0 ? { cat: '', type: s } : { cat: s.slice(0, at), type: s.slice(at + 1) };
  }

  /**
   * 저장소 안의 이미지 경로만 허용한다.
   * 경로 탈출(..)·절대경로·외부 URL·data URL·blob URL을 모두 거부한다.
   */
  function isSafeSrc(src) {
    var s = String(src == null ? '' : src).trim();
    if (!s) return false;
    if (s.indexOf('..') >= 0) return false;
    if (s.charAt(0) === '/' || s.charAt(0) === '\\') return false;
    if (/^[A-Za-z][A-Za-z0-9+.\-]*:/.test(s)) return false;   /* http: https: data: blob: file: … */
    return /^assets\/type-examples\/[A-Za-z0-9_.\-\/]+\.(?:webp|jpe?g|png)$/.test(s);
  }
  /** 이 도구가 새로 만드는 파일 경로인지 — 내용 해시 12자리 WebP만 인정한다 */
  function isMediaPath(src) {
    return /^assets\/type-examples\/media\/[0-9a-f]{12}\.webp$/.test(String(src == null ? '' : src).trim());
  }
  /** 해시 → 저장 경로. 사용자가 폴더 슬러그나 파일명을 정하지 않는다. */
  function mediaPath(hash12) { return MEDIA_DIR + String(hash12 || '') + '.webp'; }

  function toHex(buffer) {
    var view = new Uint8Array(buffer), out = '', i;
    for (i = 0; i < view.length; i++) out += (view[i] < 16 ? '0' : '') + view[i].toString(16);
    return out;
  }
  /**
   * 변환 완료된 바이트의 SHA-256 앞 12자리.
   * 같은 변환 결과 → 같은 경로라서 중복 저장이 생기지 않는다.
   * (WebCrypto는 보안 컨텍스트에서만 동작한다 — http로 열면 명확히 실패시킨다)
   */
  function sha256Hex12(bytes) {
    var c = (typeof globalThis !== 'undefined' ? globalThis : this);
    var subtle = c && c.crypto && c.crypto.subtle;
    if (!subtle) return Promise.reject(new Error('이 브라우저·연결에서는 파일 해시를 계산할 수 없습니다 (https로 열어 주세요)'));
    return Promise.resolve(subtle.digest('SHA-256', bytes)).then(function (buf) {
      return toHex(buf).slice(0, 12);
    });
  }

  /** 긴 변을 maxDim 에 맞춘 크기 — 확대는 하지 않는다 */
  function fitSize(w, h, maxDim) {
    if (!(w > 0 && h > 0)) return { w: 0, h: 0 };
    var m = Math.max(w, h);
    if (!(maxDim > 0) || m <= maxDim) return { w: Math.round(w), h: Math.round(h) };
    var r = maxDim / m;
    return { w: Math.max(1, Math.round(w * r)), h: Math.max(1, Math.round(h * r)) };
  }

  /** 시작 해상도(확대 금지) 기준의 축소 계단 */
  function dimLadder(startDim) {
    var base = Math.max(1, Math.round(Number(startDim) || MAX_DIM)), out = [], i, d, prev = -1;
    for (i = 0; i < DIM_STEPS.length; i++) {
      d = Math.max(MIN_DIM, Math.round(base * DIM_STEPS[i]));
      if (d === prev) continue;
      prev = d; out.push(d);
      if (d <= MIN_DIM) break;
    }
    return out;
  }

  /**
   * 목표 용량에 맞는 (해상도, 품질) 선택 — 인코딩 자체는 주입한다.
   * encode(dim, quality) → Promise<{bytes, width, height, ...}>
   * 품질을 먼저 단계적으로 낮추고, 최저 품질에서도 크면 해상도를 한 단계 줄인다.
   * 끝까지 목표를 못 맞추면 가장 작았던 결과를 over:true 로 돌려준다.
   */
  function pickEncoding(encode, opt) {
    var o = opt || {};
    var target = Number(o.targetBytes) || TARGET_BYTES;
    var qualities = o.qualities || QUALITY_STEPS;
    var dims = o.dims || dimLadder(o.startDim || MAX_DIM);
    var tried = [], best = null;

    function atDim(di) {
      if (di >= dims.length) {
        if (!best) return Promise.reject(new Error('사진을 변환하지 못했습니다'));
        best.over = true; best.tried = tried; best.reason = 'over-target';
        return Promise.resolve(best);
      }
      var qi = 0;
      function atQuality() {
        if (qi >= qualities.length) return atDim(di + 1);
        var q = qualities[qi++];
        return Promise.resolve(encode(dims[di], q)).then(function (enc) {
          var got = enc || {};
          got.quality = q; got.dim = dims[di];
          tried.push({ dim: dims[di], quality: q, bytes: got.bytes });
          if (!best || got.bytes < best.bytes) best = got;
          if (got.bytes <= target) {
            got.over = false; got.tried = tried;
            got.reason = got.bytes >= IDEAL_MIN_BYTES ? 'target' : 'small';
            return got;
          }
          return atQuality();
        });
      }
      return atQuality();
    }
    return atDim(0);
  }

  /* ── 유형 목록 ───────────────────────────────────────────────────── */

  /** 매니페스트의 기존 키를 loose 형태로 색인한다(먼저 등록된 키가 이긴다) */
  function looseIndex(items) {
    var map = {}, k, lk;
    for (k in items) {
      if (!Object.prototype.hasOwnProperty.call(items, k)) continue;
      lk = looseKey(k);
      if (!Object.prototype.hasOwnProperty.call(map, lk)) map[lk] = k;
    }
    return map;
  }
  /**
   * 표기가 다른 같은 유형을 하나로 모은다.
   * 예) "핸드피스|노즐 누수(약액유입)" 기록이 들어와도 매니페스트에 이미
   *     "핸드피스|노즐 누수(약액 유입)" 키가 있으면 그 기존 키를 그대로 쓴다.
   */
  function resolveKey(manifest, key) {
    var items = (manifest && manifest.items) || {};
    if (Object.prototype.hasOwnProperty.call(items, key)) return key;
    var hit = looseIndex(items)[looseKey(key)];
    return hit || key;
  }

  function slotState(item) {
    var hasS = !!(item && item.symptom && item.symptom.src);
    var hasA = !!(item && item.after && item.after.src);
    if (hasS && hasA) return 'both';
    if (hasS) return 'symptom';
    if (hasA) return 'after';
    return 'none';
  }

  /**
   * 화면에 뿌릴 유형 행 목록.
   * rows: 대시보드가 이미 받아 둔 전체 데이터(cat/type만 읽는다 — GAS 재호출 없음)
   * manifest: 이미 받아 둔 index.json
   * 반환: [{key, cat, type, state, item, inData, inManifest}]
   */
  function buildTypeRows(rows, manifest) {
    var items = (manifest && manifest.items) || {};
    var idx = looseIndex(items), out = {}, order = [], i, r, key, canonical;

    function push(key, inData, inManifest) {
      if (!key) return;
      var canon = Object.prototype.hasOwnProperty.call(items, key) ? key : (idx[looseKey(key)] || key);
      if (Object.prototype.hasOwnProperty.call(out, canon)) {
        if (inData) out[canon].inData = true;
        if (inManifest) out[canon].inManifest = true;
        return;
      }
      var p = splitKey(canon);
      out[canon] = {
        key: canon, cat: p.cat, type: p.type,
        item: items[canon] || null, state: slotState(items[canon]),
        inData: !!inData, inManifest: !!inManifest
      };
      order.push(canon);
    }

    for (i = 0; i < (rows || []).length; i++) {
      r = rows[i];
      key = makeKey(r && r.cat, r && r.type);
      if (key) push(key, true, false);
    }
    /* 실제 데이터에 아직 없는 유형(과거 등록분)도 목록에 합친다 */
    for (canonical in items) {
      if (Object.prototype.hasOwnProperty.call(items, canonical)) push(canonical, false, true);
    }

    var list = order.map(function (k) { return out[k]; });
    list.sort(function (a, b) {
      if (a.cat !== b.cat) return a.cat < b.cat ? -1 : 1;
      return a.type < b.type ? -1 : (a.type > b.type ? 1 : 0);
    });
    return list;
  }

  /* ── 매니페스트 갱신 ─────────────────────────────────────────────── */

  /** 로컬 날짜 YYYY-MM-DD (UTC 변환으로 하루 밀리지 않게 직접 조립) */
  function todayLocal(d) {
    var t = d || new Date();
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return t.getFullYear() + '-' + p2(t.getMonth() + 1) + '-' + p2(t.getDate());
  }

  function copyPhoto(p) {
    return { src: String((p && p.src) || ''), text: String((p && p.text) || '').slice(0, TEXT_MAX) };
  }

  /**
   * 기존 schema·items를 모두 보존하고, 바뀐 슬롯만 갈아 끼운다.
   * changes: { '<대분류|유형>': { symptom?: {src,text}|null, after?: {src,text}|null } }
   *   · 값이 null 이면 그 슬롯을 지운다.
   *   · 키는 기존 loose-key 와 겹치면 기존 키로 흡수한다(중복 키 생성 금지).
   */
  function applyChanges(base, changes, dateStr) {
    var src = base || {}, items = src.items || {}, out = {}, k;
    for (k in src) {
      if (Object.prototype.hasOwnProperty.call(src, k) && k !== 'items' && k !== 'updatedAt') out[k] = src[k];
    }
    if (out.schema === undefined) out.schema = 1;
    out.updatedAt = String(dateStr || todayLocal());
    out.items = {};
    for (k in items) {
      if (!Object.prototype.hasOwnProperty.call(items, k)) continue;
      var it = items[k] || {}, copy = {}, s;
      for (s = 0; s < SLOTS.length; s++) {
        if (it[SLOTS[s].id]) copy[SLOTS[s].id] = copyPhoto(it[SLOTS[s].id]);
      }
      out.items[k] = copy;
    }
    var ch = changes || {}, key;
    for (key in ch) {
      if (!Object.prototype.hasOwnProperty.call(ch, key)) continue;
      var canon = resolveKey(src, key);
      var target = out.items[canon] || (out.items[canon] = {});
      var mod = ch[key] || {}, si;
      for (si = 0; si < SLOTS.length; si++) {
        var id = SLOTS[si].id;
        if (!Object.prototype.hasOwnProperty.call(mod, id)) continue;
        if (mod[id] === null) { delete target[id]; continue; }
        target[id] = copyPhoto(mod[id]);
      }
      if (!target.symptom && !target.after) delete out.items[canon];
    }
    return out;
  }

  /** 2칸 들여쓰기 + 끝 개행 — 저장소의 기존 index.json 형식 그대로 */
  function serializeManifest(manifest) {
    return JSON.stringify(manifest, null, 2) + '\n';
  }

  /**
   * 저장 직전 검증. 하나라도 걸리면 어떤 파일도 쓰지 않는다.
   * opt.newFiles: 새로 쓸 파일 경로 배열
   */
  function validateManifest(manifest, opt) {
    var o = opt || {}, errors = [], m = manifest;
    if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, errors: ['매니페스트가 객체가 아닙니다'] };
    if (m.schema !== 1) errors.push('schema 가 1이 아닙니다 (' + String(m.schema) + ')');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(m.updatedAt || ''))) errors.push('updatedAt 이 YYYY-MM-DD 형식이 아닙니다');
    var items = m.items;
    if (!items || typeof items !== 'object' || Array.isArray(items)) {
      errors.push('items 가 객체가 아닙니다');
      return { ok: false, errors: errors };
    }

    var seenLoose = {}, keys = Object.keys(items), used = {}, i, s;
    if (!keys.length) errors.push('items 가 비어 있습니다');
    for (i = 0; i < keys.length; i++) {
      var key = keys[i], lk = looseKey(key), parts = splitKey(key);
      if (!key || key.indexOf('|') < 0 || !norm(parts.type)) { errors.push('유형 키 형식이 아닙니다: ' + key); continue; }
      if (Object.prototype.hasOwnProperty.call(seenLoose, lk)) {
        errors.push('공백만 다른 중복 키가 있습니다: ' + seenLoose[lk] + ' / ' + key);
        continue;
      }
      seenLoose[lk] = key;
      var item = items[key];
      if (!item || typeof item !== 'object' || Array.isArray(item)) { errors.push('항목이 객체가 아닙니다: ' + key); continue; }
      var slotCount = 0;
      for (s = 0; s < SLOTS.length; s++) {
        var photo = item[SLOTS[s].id];
        if (photo === undefined) continue;
        slotCount++;
        if (!photo || typeof photo !== 'object' || Array.isArray(photo)) { errors.push('사진 항목이 객체가 아닙니다: ' + key + ' / ' + SLOTS[s].id); continue; }
        if (typeof photo.src !== 'string' || !isSafeSrc(photo.src)) {
          errors.push('허용되지 않는 경로입니다: ' + key + ' / ' + SLOTS[s].id + ' → ' + String(photo.src));
          continue;
        }
        if (photo.text !== undefined && typeof photo.text !== 'string') errors.push('사진 설명이 문자열이 아닙니다: ' + key + ' / ' + SLOTS[s].id);
        used[photo.src] = true;
      }
      if (!slotCount) errors.push('증상·처리 결과가 모두 비어 있습니다: ' + key);
    }

    var newFiles = o.newFiles || [], seenFile = {};
    for (i = 0; i < newFiles.length; i++) {
      var p = String(newFiles[i] || '');
      if (!isSafeSrc(p)) { errors.push('새 파일 경로가 저장소 밖입니다: ' + p); continue; }
      if (!/\.webp$/.test(p)) { errors.push('새 파일 확장자가 webp 가 아닙니다: ' + p); continue; }
      if (!isMediaPath(p)) { errors.push('새 파일이 내용 해시 경로 규칙과 다릅니다: ' + p); continue; }
      if (seenFile[p]) { errors.push('새 파일 경로가 중복됩니다: ' + p); continue; }
      seenFile[p] = true;
      if (!used[p]) errors.push('매니페스트가 참조하지 않는 새 파일입니다: ' + p);
    }
    return { ok: !errors.length, errors: errors };
  }

  /** 교체 후 아무 항목도 참조하지 않게 된 기존 파일 — 안내만 하고 지우지 않는다 */
  function cleanupCandidates(oldManifest, newManifest) {
    function refs(m) {
      var items = (m && m.items) || {}, out = {}, k, s;
      for (k in items) {
        if (!Object.prototype.hasOwnProperty.call(items, k)) continue;
        for (s = 0; s < SLOTS.length; s++) {
          var p = items[k][SLOTS[s].id];
          if (p && p.src) out[p.src] = true;
        }
      }
      return out;
    }
    var before = refs(oldManifest), after = refs(newManifest), out = [], k;
    for (k in before) { if (Object.prototype.hasOwnProperty.call(before, k) && !after[k]) out.push(k); }
    out.sort();
    return out;
  }

  /**
   * 변경 목록 → 실제로 써야 할 파일 목록.
   * 같은 해시(같은 변환 결과)는 한 번만 남는다.
   * changes: { key: { symptom?: {src, blob?}, after?: {...} } }
   */
  function planWrites(changes) {
    var ch = changes || {}, seen = {}, out = [], key, s;
    for (key in ch) {
      if (!Object.prototype.hasOwnProperty.call(ch, key)) continue;
      for (s = 0; s < SLOTS.length; s++) {
        var slot = ch[key] && ch[key][SLOTS[s].id];
        if (!slot || !slot.blob || !slot.src) continue;
        if (seen[slot.src]) continue;
        seen[slot.src] = true;
        out.push({ path: slot.src, blob: slot.blob, bytes: slot.bytes || (slot.blob && slot.blob.size) || 0 });
      }
    }
    out.sort(function (a, b) { return a.path < b.path ? -1 : (a.path > b.path ? 1 : 0); });
    return out;
  }

  function formatBytes(n) {
    var v = Number(n) || 0;
    if (v < 1024) return v + 'B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(v < 10240 ? 1 : 0) + 'KB';
    return (v / 1024 / 1024).toFixed(2) + 'MB';
  }

  var PURE = {
    ASSET_ROOT: ASSET_ROOT, MEDIA_DIR: MEDIA_DIR, MANIFEST_PATH: MANIFEST_PATH, SLOTS: SLOTS,
    MAX_DIM: MAX_DIM, TARGET_BYTES: TARGET_BYTES, IDEAL_MIN_BYTES: IDEAL_MIN_BYTES,
    QUALITY_STEPS: QUALITY_STEPS, TEXT_MAX: TEXT_MAX,
    norm: norm, looseKey: looseKey, makeKey: makeKey, splitKey: splitKey,
    isSafeSrc: isSafeSrc, isMediaPath: isMediaPath, mediaPath: mediaPath,
    sha256Hex12: sha256Hex12, fitSize: fitSize, dimLadder: dimLadder, pickEncoding: pickEncoding,
    resolveKey: resolveKey, buildTypeRows: buildTypeRows, slotState: slotState,
    todayLocal: todayLocal, applyChanges: applyChanges, serializeManifest: serializeManifest,
    validateManifest: validateManifest, cleanupCandidates: cleanupCandidates,
    planWrites: planWrites, formatBytes: formatBytes
  };

  /* ══════════════════════════════════════════════════════════════════
     2. 브라우저 전용 — 디코딩 · WebP 재인코딩
     ══════════════════════════════════════════════════════════════════ */

  function hasDom() { return typeof document !== 'undefined' && typeof Image !== 'undefined'; }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () {
        try { URL.revokeObjectURL(url); } catch (e) {}
        reject(new Error('이 파일은 브라우저가 열 수 없습니다. HEIC/HEIF·RAW 라면 JPG나 PNG로 저장한 뒤 다시 올려 주세요.'));
      };
      img.src = url;
    });
  }

  /** 캔버스로 다시 그려 EXIF·GPS 등 메타데이터를 제거하고 WebP로 인코딩한다 */
  function encodeWebp(img, dim, quality) {
    var size = fitSize(img.naturalWidth || img.width, img.naturalHeight || img.height, dim);
    return new Promise(function (resolve, reject) {
      var canvas = document.createElement('canvas');
      canvas.width = size.w; canvas.height = size.h;
      var ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('캔버스를 사용할 수 없습니다')); return; }
      ctx.fillStyle = '#FFFFFF';                 /* 투명 PNG가 검게 나오는 것을 막는다 */
      ctx.fillRect(0, 0, size.w, size.h);
      ctx.drawImage(img, 0, 0, size.w, size.h);
      if (!canvas.toBlob) { reject(new Error('이 브라우저는 캔버스 저장(toBlob)을 지원하지 않습니다')); return; }
      canvas.toBlob(function (blob) {
        if (!blob) { reject(new Error('사진을 변환하지 못했습니다')); return; }
        if (blob.type !== 'image/webp') { reject(new Error('이 브라우저는 WebP 저장을 지원하지 않습니다. Chrome·Edge에서 열어 주세요.')); return; }
        resolve({ blob: blob, bytes: blob.size, width: size.w, height: size.h });
      }, 'image/webp', quality);
    });
  }

  /**
   * 파일 1장 → 대표 사진용 WebP + 저장 경로.
   * 실패해도 기존 데이터는 건드리지 않는다(호출부가 예외만 표시한다).
   */
  function convert(file) {
    if (!hasDom()) return Promise.reject(new Error('브라우저 환경이 아닙니다'));
    if (!file || !file.size) return Promise.reject(new Error('빈 파일입니다'));
    if (file.type && !/^image\//.test(file.type) && !/\.(?:jpe?g|png|webp|gif|bmp)$/i.test(file.name || '')) {
      return Promise.reject(new Error('이미지 파일이 아닙니다: ' + (file.name || '')));
    }
    var got = null;
    return loadImage(file).then(function (g) {
      got = g;
      var srcW = g.img.naturalWidth || g.img.width, srcH = g.img.naturalHeight || g.img.height;
      if (!(srcW > 0 && srcH > 0)) throw new Error('사진 크기를 읽지 못했습니다');
      var start = Math.min(MAX_DIM, Math.max(srcW, srcH));   /* 확대 금지 */
      return pickEncoding(function (dim, q) { return encodeWebp(g.img, dim, q); }, { startDim: start })
        .then(function (enc) {
          return enc.blob.arrayBuffer().then(function (buf) {
            return sha256Hex12(buf).then(function (hash) {
              return {
                blob: enc.blob, bytes: enc.bytes, width: enc.width, height: enc.height,
                quality: enc.quality, over: !!enc.over, hash: hash, src: mediaPath(hash),
                origName: file.name || '', origBytes: file.size, origWidth: srcW, origHeight: srcH
              };
            });
          });
        });
    }).then(function (r) {
      try { URL.revokeObjectURL(got.url); } catch (e) {}
      return r;
    }, function (e) {
      if (got) { try { URL.revokeObjectURL(got.url); } catch (e2) {} }
      throw e;
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     3. 관리 화면 — 대시보드 DOM·상태를 건드리지 않는 독립 오버레이
     ══════════════════════════════════════════════════════════════════ */

  var S = {
    open: false, host: null, hostRows: [], manifest: null, rows: [], changes: {},
    busy: false, loadError: false, expanded: {}, savedPreviews: {},
    filterCat: '', query: '', onlyMissing: false, el: null
  };

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function note(msg, kind) {
    if (!S.el) return;
    S.el.msg.textContent = msg || '';
    S.el.msg.className = 'bte-msg' + (kind ? ' ' + kind : '');
  }

  var STYLE_ID = 'bteStyle';
  var CSS = [
    '.bte-back{position:fixed;inset:0;background:rgba(16,24,44,.62);z-index:60;display:flex;',
      'align-items:center;justify-content:center;padding:16px;overflow:auto}',
    '.bte-panel{background:var(--surface,#fff);color:var(--text,#1A1A2E);border-radius:14px;width:100%;',
      'max-width:940px;height:min(880px,calc(100vh - 32px));display:flex;flex-direction:column;overflow:hidden;',
      'font-family:var(--font-ui,sans-serif);font-size:13px}',
    '.bte-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--gray-line,#DDE3EE)}',
    '.bte-head h2{margin:0;font-size:15px;color:var(--navy,#1B2F5E);flex:1}',
    '.bte-kicker{background:var(--teal-soft,#EAF4F8);color:var(--teal,#2E7D9E);border-radius:999px;',
      'padding:3px 9px;font-size:10.5px;font-weight:700}',
    '.bte-x{border:1px solid var(--gray-line,#DDE3EE);background:var(--surface,#fff);color:var(--text-muted,#6B7A99);',
      'border-radius:8px;padding:6px 10px;font:inherit;font-size:12px;cursor:pointer}',
    '.bte-safety{margin:0;padding:10px 16px;background:var(--surface-2,#FBFCFE);border-bottom:1px solid var(--gray-line,#DDE3EE);',
      'font-size:11px;color:var(--text-muted,#6B7A99);line-height:1.6}',
    '.bte-safety b{color:var(--red,#C0392B)}',
    '.bte-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--gray-line,#DDE3EE)}',
    '.bte-tools select,.bte-tools input[type=search]{padding:7px 9px;border:1px solid var(--gray-line,#DDE3EE);',
      'border-radius:8px;background:var(--surface,#fff);color:var(--text,#1A1A2E);font:inherit;font-size:12px}',
    '.bte-tools input[type=search]{flex:1;min-width:130px}',
    '.bte-chk{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--text-muted,#6B7A99);cursor:pointer}',
    '.bte-sum{font-size:11px;color:var(--text-muted,#6B7A99);padding:0 16px 8px;line-height:1.7}',
    '.bte-list{flex:1;min-height:0;overflow:auto;padding:0 16px 12px}',
    '.bte-row{border:1px solid var(--gray-line,#DDE3EE);border-radius:10px;margin-bottom:8px;background:var(--surface-2,#FBFCFE);overflow:hidden}',
    '.bte-row.changed{border-color:var(--teal,#2E7D9E)}',
    '.bte-row-head{display:flex;align-items:center;gap:9px;padding:9px 11px;cursor:pointer;background:none;border:0;',
      'width:100%;text-align:left;font:inherit;color:inherit}',
    '.bte-row-head:focus-visible{outline:2px solid var(--navy,#1B2F5E);outline-offset:-2px}',
    '.bte-state{border-radius:999px;padding:3px 8px;font-size:10px;font-weight:700;white-space:nowrap}',
    '.bte-state.s-both{background:#E8F4EF;color:#1A6B54}',
    '.bte-state.s-symptom{background:#EAF4F8;color:#20657F}',
    '.bte-state.s-after{background:#FFF4DA;color:#8A6410}',
    '.bte-state.s-none{background:#F1F3F8;color:#6B7A99}',
    '.bte-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.bte-title b{font-size:12.5px}.bte-title i{font-style:normal;color:var(--text-muted,#6B7A99);font-size:11px;margin-right:6px}',
    '.bte-flag{background:var(--teal,#2E7D9E);color:#fff;border-radius:999px;padding:2px 7px;font-size:10px;font-weight:700}',
    '.bte-slots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:0 11px 11px}',
    '.bte-slot{border:1px solid var(--gray-line,#DDE3EE);border-radius:9px;padding:9px;background:var(--surface,#fff)}',
    '.bte-slot-head{display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:7px;font-size:11.5px}',
    '.bte-slot-head b{color:var(--navy,#1B2F5E)}.bte-slot-head span{color:var(--text-muted,#6B7A99);font-size:10.5px}',
    '.bte-drop{border:1px dashed var(--gray-line,#DDE3EE);border-radius:8px;padding:8px;text-align:center;background:var(--surface-2,#FBFCFE)}',
    '.bte-drop.over{border-color:var(--teal,#2E7D9E);background:var(--teal-soft,#EAF4F8)}',
    '.bte-thumbs{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:6px}',
    '.bte-thumbs figure{margin:0;width:120px}',
    '.bte-thumbs figcaption{font-size:10px;color:var(--text-muted,#6B7A99);margin-bottom:3px}',
    '.bte-thumbs img{width:100%;height:86px;object-fit:contain;background:var(--track,#F0F4F9);border-radius:6px;',
      'border:1px solid var(--gray-line,#DDE3EE)}',
    '.bte-dropmsg{margin:0 0 6px;font-size:10.5px;color:var(--text-muted,#6B7A99)}',
    '.bte-btn{border:1px solid var(--gray-line,#DDE3EE);background:var(--surface,#fff);color:var(--navy,#1B2F5E);',
      'border-radius:7px;padding:6px 10px;font:inherit;font-size:11.5px;font-weight:700;cursor:pointer}',
    '.bte-btn:hover{background:var(--teal-soft,#EAF4F8)}',
    '.bte-btn[disabled]{opacity:.45;cursor:not-allowed}',
    '.bte-meta{margin:6px 0 0;font-size:10.5px;color:var(--text-muted,#6B7A99);line-height:1.6;word-break:break-all}',
    '.bte-meta.warn{color:var(--amber,#B8860B)}.bte-meta.err{color:var(--red,#C0392B)}',
    '.bte-label{display:block;margin-top:7px;font-size:10.5px;color:var(--text-muted,#6B7A99)}',
    '.bte-label input{width:100%;margin-top:3px;padding:7px 8px;border:1px solid var(--gray-line,#DDE3EE);',
      'border-radius:7px;background:var(--surface,#fff);color:var(--text,#1A1A2E);font:inherit;font-size:11.5px}',
    '.bte-foot{border-top:1px solid var(--gray-line,#DDE3EE);padding:10px 16px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
    '.bte-foot .bte-grow{flex:1;min-width:120px;font-size:11.5px;color:var(--text-muted,#6B7A99)}',
    '.bte-go{background:var(--navy,#1B2F5E);color:#fff;border-color:var(--navy,#1B2F5E)}',
    '.bte-go:hover{background:var(--navy-light,#2A4080)}',
    '.bte-msg{padding:0 16px 10px;font-size:11.5px;line-height:1.7;white-space:pre-wrap;word-break:break-all}',
    '.bte-msg.err{color:var(--red,#C0392B)}.bte-msg.ok{color:var(--green,#1E7E4E)}',
    '.bte-empty{padding:26px 8px;text-align:center;color:var(--text-muted,#6B7A99);font-size:12px}',
    'body.dark .bte-state.s-both{background:#15291D;color:#8FD3B8}',
    'body.dark .bte-state.s-symptom{background:#17303A;color:#7FC6E2}',
    'body.dark .bte-state.s-after{background:#332B16;color:#D9A93F}',
    'body.dark .bte-state.s-none{background:#232D40;color:#97A3BA}',
    'body.dark .bte-panel{color-scheme:dark}',
    '@media(max-width:760px){.bte-slots{grid-template-columns:1fr}.bte-panel{height:calc(100dvh - 20px)}',
      '.bte-back{padding:10px}.bte-thumbs figure{width:104px}}'
  ].join('');

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function buildShell() {
    var back = document.createElement('div');
    back.className = 'bte-back';
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.setAttribute('aria-label', 'VOC 유형별 예시 사진 관리');
    back.innerHTML = ''
      + '<div class="bte-panel">'
      +   '<div class="bte-head"><h2>🖼 VOC 유형별 예시 사진 관리</h2>'
      +     '<span class="bte-kicker">유형별 표준 예시</span>'
      +     '<button type="button" class="bte-x" data-act="close">✕ 닫기</button></div>'
      +   '<p class="bte-safety">여기 등록하는 사진은 <b>실제 처리 기록 사진이 아니라 VOC 유형별 표준 예시</b>입니다. '
      +     '환자·직원 얼굴, 병원명, 장비 S/N, 문서·모니터의 개인정보가 보이지 않는 사진만 사용하세요. '
      +     '저장 버튼을 누르기 전에는 어떤 파일도 기록되지 않습니다.</p>'
      +   '<div class="bte-tools">'
      +     '<select data-act="cat" aria-label="대분류 필터"></select>'
      +     '<input type="search" data-act="query" placeholder="유형 검색" aria-label="유형 검색">'
      +     '<label class="bte-chk"><input type="checkbox" data-act="missing"> 미등록만 보기</label>'
      +   '</div>'
      +   '<div class="bte-sum" data-el="sum"></div>'
      +   '<div class="bte-list" data-el="list"></div>'
      +   '<div class="bte-msg" data-el="msg"></div>'
      +   '<div class="bte-foot">'
      +     '<span class="bte-grow" data-el="changed">변경된 항목 없음</span>'
      +     '<button type="button" class="bte-btn" data-act="reset">↺ 작업 취소·초기화</button>'
      +     '<button type="button" class="bte-btn" data-act="download">⬇ 파일 다운로드</button>'
      +     '<button type="button" class="bte-btn bte-go" data-act="save">📁 저장소 폴더에 저장</button>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(back);

    var el = {
      back: back,
      panel: back.querySelector('.bte-panel'),
      cat: back.querySelector('[data-act="cat"]'),
      query: back.querySelector('[data-act="query"]'),
      missing: back.querySelector('[data-act="missing"]'),
      sum: back.querySelector('[data-el="sum"]'),
      list: back.querySelector('[data-el="list"]'),
      msg: back.querySelector('[data-el="msg"]'),
      changed: back.querySelector('[data-el="changed"]'),
      reset: back.querySelector('[data-act="reset"]'),
      download: back.querySelector('[data-act="download"]'),
      save: back.querySelector('[data-act="save"]')
    };
    if (!canPickDirectory()) {
      el.save.hidden = true;                  /* Chrome·Edge 외에는 다운로드 폴백만 노출한다 */
    }
    el.cat.addEventListener('change', function () { S.filterCat = el.cat.value; renderList(); });
    el.query.addEventListener('input', function () { S.query = looseKey(el.query.value); renderList(); });
    el.missing.addEventListener('change', function () { S.onlyMissing = !!el.missing.checked; renderList(); });
    el.reset.addEventListener('click', function () { resetAll(); });
    el.download.addEventListener('click', function () { guard(saveByDownload); });
    el.save.addEventListener('click', function () { guard(saveToDirectory); });
    back.addEventListener('click', function (e) {
      if (e.target === back) { close(); return; }
      var act = e.target.closest && e.target.closest('[data-act="close"]');
      if (act) close();
    });
    back.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !S.busy) { e.stopPropagation(); close(); }
    });
    el.list.addEventListener('click', onListClick);
    el.list.addEventListener('input', onListInput);
    el.list.addEventListener('change', onListFile);
    el.list.addEventListener('dragover', onDragOver, true);
    el.list.addEventListener('dragleave', onDragLeave, true);
    el.list.addEventListener('drop', onDrop, true);
    return el;
  }

  /* ── 렌더 ────────────────────────────────────────────────────────── */

  function changeOf(key, slot) {
    var c = S.changes[key];
    return c && Object.prototype.hasOwnProperty.call(c, slot) ? c[slot] : null;
  }
  function changeCount() {
    var n = 0, k, s;
    for (k in S.changes) {
      if (!Object.prototype.hasOwnProperty.call(S.changes, k)) continue;
      for (s = 0; s < SLOTS.length; s++) if (changeOf(k, SLOTS[s].id)) n++;
    }
    return n;
  }
  function setChange(key, slot, value) {
    if (!S.changes[key]) S.changes[key] = {};
    var prev = S.changes[key][slot];
    if (prev && prev.previewUrl && (!value || prev.previewUrl !== value.previewUrl)) {
      try { URL.revokeObjectURL(prev.previewUrl); } catch (e) {}
    }
    if (value === null || value === undefined) {
      delete S.changes[key][slot];
      if (!Object.keys(S.changes[key]).length) delete S.changes[key];
    } else {
      S.changes[key][slot] = value;
    }
  }
  function revokeAll() {
    var k, s;
    for (k in S.changes) {
      if (!Object.prototype.hasOwnProperty.call(S.changes, k)) continue;
      for (s = 0; s < SLOTS.length; s++) {
        var c = S.changes[k][SLOTS[s].id];
        if (c && c.previewUrl) { try { URL.revokeObjectURL(c.previewUrl); } catch (e) {} }
      }
    }
  }

  var STATE_TEXT = { both: '증상·처리 결과', symptom: '증상만', after: '처리 결과만', none: '미등록' };

  function visibleRows() {
    return S.rows.filter(function (r) {
      if (S.filterCat && r.cat !== S.filterCat) return false;
      if (S.onlyMissing && r.state === 'both') return false;
      if (S.query && looseKey(r.key).indexOf(S.query) < 0) return false;
      return true;
    });
  }

  function renderCatOptions() {
    var seen = {}, cats = [];
    S.rows.forEach(function (r) { if (r.cat && !seen[r.cat]) { seen[r.cat] = 1; cats.push(r.cat); } });
    cats.sort();
    S.el.cat.innerHTML = '<option value="">대분류 전체</option>'
      + cats.map(function (c) { return '<option value="' + escHtml(c) + '">' + escHtml(c) + '</option>'; }).join('');
    S.el.cat.value = S.filterCat;
  }

  function renderSummary() {
    var n = { both: 0, symptom: 0, after: 0, none: 0 };
    S.rows.forEach(function (r) { n[r.state]++; });
    S.el.sum.textContent = '전체 ' + S.rows.length + '개 유형 · 증상·처리 결과 모두 등록 ' + n.both
      + ' · 증상 사진만 ' + n.symptom + ' · 처리 결과 사진만 ' + n.after + ' · 모두 미등록 ' + n.none;
    var c = changeCount();
    S.el.changed.textContent = c ? ('변경된 항목 ' + c + '건 — 저장 전까지 파일은 기록되지 않습니다') : '변경된 항목 없음';
  }

  function slotHtml(row, slot) {
    var id = slot.id;
    var cur = row.item && row.item[id];
    var ch = changeOf(row.key, id);
    var curSrc = cur && isSafeSrc(cur.src) ? cur.src : '';
    var text = ch ? ch.text : String((cur && cur.text) || '');
    var stateLabel = ch ? (ch.blob ? '교체 예정' : '설명 수정') : (curSrc ? '등록됨' : '미등록');
    var thumbs = '';
    if (curSrc) {
      /* 방금 저장했지만 아직 배포되지 않은 파일은 변환 결과 미리보기를 그대로 재사용한다 */
      var show = S.savedPreviews[curSrc] || curSrc;
      thumbs += '<figure><figcaption>현재</figcaption><img alt="현재 ' + escHtml(slot.label)
        + ' 예시" decoding="async" referrerpolicy="no-referrer" src="' + escHtml(show) + '"></figure>';
    }
    if (ch && ch.previewUrl) {
      thumbs += '<figure><figcaption>변환 결과</figcaption><img alt="변환된 ' + escHtml(slot.label)
        + ' 예시" decoding="async" src="' + escHtml(ch.previewUrl) + '"></figure>';
    }
    var meta = '';
    if (ch && ch.blob) {
      meta = '<p class="bte-meta' + (ch.over ? ' warn' : '') + '">원본 ' + escHtml(ch.origName || '선택한 사진')
        + ' · ' + formatBytes(ch.origBytes) + ' · ' + ch.origWidth + '×' + ch.origHeight
        + '<br>변환 WebP · ' + formatBytes(ch.bytes) + ' · ' + ch.width + '×' + ch.height
        + ' · 품질 ' + ch.quality.toFixed(2)
        + '<br>저장 경로 ' + escHtml(ch.src)
        + (ch.over ? '<br>⚠ 최저 품질·최소 해상도에서도 300KB를 넘었습니다. 더 단순한 사진을 권장합니다.' : '') + '</p>';
    } else if (curSrc) {
      meta = '<p class="bte-meta">현재 파일 ' + escHtml(curSrc) + '</p>';
    }
    if (ch && ch.error) meta += '<p class="bte-meta err">' + escHtml(ch.error) + '</p>';

    return '<section class="bte-slot" data-slot="' + id + '">'
      + '<div class="bte-slot-head"><b>' + escHtml(slot.label) + ' 사진</b><span>' + escHtml(stateLabel) + '</span></div>'
      + '<div class="bte-drop" data-act="drop">'
      +   (thumbs ? '<div class="bte-thumbs">' + thumbs + '</div>' : '')
      +   '<p class="bte-dropmsg">사진을 끌어다 놓거나 파일을 선택하세요 (JPG·PNG·WebP)</p>'
      +   '<button type="button" class="bte-btn" data-act="pick"' + (S.busy ? ' disabled' : '') + '>파일 선택</button>'
      +   '<input type="file" accept="image/*" data-act="file" hidden>'
      + '</div>'
      + meta
      + '<label class="bte-label">사진 설명'
      +   '<input type="text" maxlength="' + TEXT_MAX + '" data-act="text" value="' + escHtml(text) + '"'
      +   ((curSrc || (ch && ch.blob)) ? '' : ' disabled placeholder="사진을 먼저 등록하세요"') + '></label>'
      + (ch ? '<button type="button" class="bte-btn" data-act="undo" style="margin-top:7px">↺ 이 사진 변경 취소</button>' : '')
      + '</section>';
  }

  function rowHtml(row) {
    var changed = !!S.changes[row.key];
    var open = !!S.expanded[row.key];
    return '<article class="bte-row' + (changed ? ' changed' : '') + '" data-key="' + escHtml(row.key) + '">'
      + '<button type="button" class="bte-row-head" data-act="toggle" aria-expanded="' + (open ? 'true' : 'false') + '">'
      +   '<span class="bte-state s-' + row.state + '">' + STATE_TEXT[row.state] + '</span>'
      +   '<span class="bte-title"><i>' + escHtml(row.cat) + '</i><b>' + escHtml(row.type) + '</b></span>'
      +   (changed ? '<span class="bte-flag">변경됨</span>' : '')
      +   '<span class="bte-caret">' + (open ? '▴' : '▾') + '</span>'
      + '</button>'
      /* 사진 요청은 행을 펼쳤을 때만 일어난다 — 목록을 여는 것만으로 이미지가 내려오지 않는다 */
      + (open ? '<div class="bte-slots">' + SLOTS.map(function (s) { return slotHtml(row, s); }).join('') + '</div>' : '')
      + '</article>';
  }

  function renderList() {
    if (!S.el) return;
    var list = visibleRows();
    S.el.list.innerHTML = list.length
      ? list.map(rowHtml).join('')
      : '<div class="bte-empty">조건에 맞는 유형이 없습니다</div>';
    renderSummary();
    syncButtons();
  }
  function syncButtons() {
    if (!S.el) return;
    var n = changeCount();
    S.el.reset.disabled = S.busy || !n;
    S.el.download.disabled = S.busy || !n || S.loadError;
    S.el.save.disabled = S.busy || !n || S.loadError;
  }

  /* ── 이벤트 ──────────────────────────────────────────────────────── */

  function ctx(target) {
    var slotEl = target.closest && target.closest('.bte-slot');
    var rowEl = target.closest && target.closest('.bte-row');
    if (!rowEl) return null;
    var key = rowEl.getAttribute('data-key');
    var row = null, i;
    for (i = 0; i < S.rows.length; i++) if (S.rows[i].key === key) { row = S.rows[i]; break; }
    return { key: key, row: row, slot: slotEl ? slotEl.getAttribute('data-slot') : '', slotEl: slotEl, rowEl: rowEl };
  }

  function onListClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var btn = t.closest('[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    if (act !== 'toggle' && act !== 'pick' && act !== 'undo') return;
    var c = ctx(btn);
    if (!c || !c.row) return;
    if (act === 'toggle') {
      S.expanded[c.key] = !S.expanded[c.key];
      renderList();
      return;
    }
    if (S.busy) return;                        /* 변환·저장 중 중복 클릭 차단 */
    if (act === 'pick') {
      var input = c.slotEl && c.slotEl.querySelector('[data-act="file"]');
      if (input) input.click();
      return;
    }
    if (act === 'undo') { setChange(c.key, c.slot, null); note(''); renderList(); }
  }

  function onListInput(e) {
    var t = e.target;
    if (!t || t.getAttribute('data-act') !== 'text') return;
    var c = ctx(t);
    if (!c || !c.row) return;
    var cur = c.row.item && c.row.item[c.slot];
    var ch = changeOf(c.key, c.slot);
    var text = String(t.value || '').slice(0, TEXT_MAX);
    if (ch) {
      ch.text = text;
      /* 사진은 그대로고 설명도 원래대로 돌아왔다면 변경으로 세지 않는다 */
      if (!ch.blob && text === String((cur && cur.text) || '')) { setChange(c.key, c.slot, null); renderList(); }
      else renderSummary();
      return;
    }
    if (!cur || !cur.src) return;
    if (text === String(cur.text || '')) return;
    setChange(c.key, c.slot, { src: cur.src, text: text, blob: null });
    c.rowEl.classList.add('changed');
    renderSummary();
  }

  function onListFile(e) {
    var t = e.target;
    if (!t || t.getAttribute('data-act') !== 'file') return;
    var file = t.files && t.files[0];
    t.value = '';
    if (file) acceptFile(ctx(t), file);
  }

  function onDragOver(e) {
    var zone = e.target.closest && e.target.closest('.bte-drop');
    if (!zone || S.busy) return;
    e.preventDefault();
    zone.classList.add('over');
  }
  function onDragLeave(e) {
    var zone = e.target.closest && e.target.closest('.bte-drop');
    if (zone) zone.classList.remove('over');
  }
  function onDrop(e) {
    var zone = e.target.closest && e.target.closest('.bte-drop');
    if (!zone) return;
    e.preventDefault();
    zone.classList.remove('over');
    if (S.busy) return;
    var dt = e.dataTransfer, file = dt && dt.files && dt.files[0];
    if (file) acceptFile(ctx(zone), file);
  }

  /* ── 변환 ────────────────────────────────────────────────────────── */

  function setBusy(on) {
    S.busy = !!on;
    if (!S.el) return;
    S.el.panel.setAttribute('aria-busy', S.busy ? 'true' : 'false');
    syncButtons();
  }

  function acceptFile(c, file) {
    if (!c || !c.row || !c.slot || S.busy) return;
    var cur = c.row.item && c.row.item[c.slot];
    var prev = changeOf(c.key, c.slot);
    var keepText = prev ? prev.text : String((cur && cur.text) || '');
    setBusy(true);
    note((c.row.type || c.key) + ' · ' + c.slot + ' 사진 변환 중…');
    convert(file).then(function (r) {
      setChange(c.key, c.slot, {
        src: r.src, text: keepText, blob: r.blob, bytes: r.bytes,
        width: r.width, height: r.height, quality: r.quality, over: r.over, hash: r.hash,
        origName: r.origName, origBytes: r.origBytes, origWidth: r.origWidth, origHeight: r.origHeight,
        previewUrl: URL.createObjectURL(r.blob), error: ''
      });
      note('변환 완료 · ' + formatBytes(r.bytes) + ' · ' + r.width + '×' + r.height
        + (r.over ? ' (목표 300KB 초과)' : ''), r.over ? 'err' : 'ok');
    }, function (err) {
      /* 변환 실패는 기존 등록 내용을 건드리지 않는다 */
      note('변환 실패 · ' + (err && err.message ? err.message : '알 수 없는 오류'), 'err');
    }).then(function () {
      setBusy(false);
      renderList();
    });
  }

  function resetAll() {
    if (S.busy) return;
    if (!changeCount()) return;
    if (typeof confirm === 'function' && !confirm('변환한 사진과 수정한 설명을 모두 되돌립니다. 계속할까요?')) return;
    revokeAll();
    S.changes = {};
    note('작업을 초기화했습니다');
    renderList();
  }

  function guard(fn) {
    if (S.busy) return;
    var r;
    try { r = fn(); } catch (e) { note('오류 · ' + (e && e.message ? e.message : e), 'err'); setBusy(false); return; }
    if (r && r.then) r.then(null, function (e) {
      note('오류 · ' + (e && e.message ? e.message : e), 'err');
      setBusy(false);
    });
  }

  /* ── 저장 ────────────────────────────────────────────────────────── */

  function canPickDirectory() {
    return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
  }
  function baseName(p) { var s = String(p || ''); return s.slice(s.lastIndexOf('/') + 1); }

  /**
   * 저장 계획 만들기 + 전체 검증.
   * 여기서 예외가 나면 호출부는 어떤 파일도 쓰지 않는다.
   */
  function prepare() {
    if (S.loadError) throw new Error('index.json 을 불러오지 못한 상태에서는 저장할 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
    if (!changeCount()) throw new Error('변경된 항목이 없습니다');
    var next = applyChanges(S.manifest, S.changes, todayLocal());
    var writes = planWrites(S.changes);
    var v = validateManifest(next, { newFiles: writes.map(function (w) { return w.path; }) });
    if (!v.ok) throw new Error('검증 실패 — 아무 파일도 저장하지 않았습니다.\n· ' + v.errors.join('\n· '));
    return {
      next: next, writes: writes, json: serializeManifest(next),
      cleanup: cleanupCandidates(S.manifest, next)
    };
  }

  function afterSave(plan, lines) {
    /* 저장한 사진은 아직 배포되기 전이라 서버에서 못 받는다 —
       미리보기 URL을 그대로 재사용해 화면에서 깨진 이미지가 보이지 않게 한다. */
    var k, s;
    for (k in S.changes) {
      if (!Object.prototype.hasOwnProperty.call(S.changes, k)) continue;
      for (s = 0; s < SLOTS.length; s++) {
        var c = S.changes[k][SLOTS[s].id];
        if (c && c.blob && c.previewUrl) S.savedPreviews[c.src] = c.previewUrl;
      }
    }
    S.changes = {};
    S.manifest = { schema: plan.next.schema, updatedAt: plan.next.updatedAt, items: plan.next.items };
    S.rows = buildTypeRows(S.hostRows, S.manifest);
    var msg = lines.slice();
    if (plan.cleanup.length) {
      msg.push('정리 후보(자동 삭제하지 않음) — 더 이상 참조되지 않는 기존 파일:');
      plan.cleanup.forEach(function (p) { msg.push('  · ' + p); });
    }
    msg.push('마지막으로 저장소에서 변경 파일을 확인한 뒤 커밋하세요.');
    note(msg.join('\n'), 'ok');
    renderCatOptions();
    renderList();
  }

  function getDir(handle, parts, create) {
    return parts.reduce(function (p, name) {
      return p.then(function (dir) { return dir.getDirectoryHandle(name, { create: !!create }); });
    }, Promise.resolve(handle));
  }
  function writeFile(dir, name, data) {
    return dir.getFileHandle(name, { create: true }).then(function (fh) {
      return fh.createWritable().then(function (w) {
        return Promise.resolve(w.write(data)).then(function () { return w.close(); });
      });
    });
  }
  function fileExists(dir, name) {
    return dir.getFileHandle(name).then(function () { return true; }, function () { return false; });
  }

  /** File System Access API — 사용자가 고른 저장소 폴더의 올바른 상대 경로에 저장한다 */
  function saveToDirectory() {
    var plan = prepare();
    if (!canPickDirectory()) throw new Error('이 브라우저는 폴더 저장을 지원하지 않습니다. "파일 다운로드"를 사용하세요.');
    setBusy(true);
    note('저장소 최상위 폴더를 선택하세요…');
    var root = null, mediaDir = null, existing = [];
    return window.showDirectoryPicker({ mode: 'readwrite', id: 'baz-type-examples' }).then(function (h) {
      root = h;
      if (h.requestPermission) return Promise.resolve(h.requestPermission({ mode: 'readwrite' })).then(function (st) {
        if (st !== 'granted') throw new Error('폴더 쓰기 권한이 없습니다');
        return h;
      });
      return h;
    }).then(function () {
      /* 엉뚱한 폴더에 쓰지 않도록 저장소인지 먼저 확인한다 */
      return getDir(root, ['assets', 'type-examples'], false).then(function (te) {
        return fileExists(te, 'index.json').then(function (ok) {
          if (!ok) throw new Error('선택한 폴더에 assets/type-examples/index.json 이 없습니다');
          return te;
        });
      }).then(null, function () {
        throw new Error('저장소 폴더가 아닙니다. assets/type-examples/index.json 이 있는 최상위 폴더를 선택해 주세요.');
      });
    }).then(function (teDir) {
      return teDir.getDirectoryHandle('media', { create: true }).then(function (m) {
        mediaDir = m;
        return plan.writes.reduce(function (p, w) {
          return p.then(function () {
            return fileExists(mediaDir, baseName(w.path)).then(function (ok) { if (ok) existing.push(w.path); });
          });
        }, Promise.resolve()).then(function () { return teDir; });
      });
    }).then(function (teDir) {
      var ask = ['저장소 폴더에 다음을 기록합니다.', '',
        '· 새 사진 ' + (plan.writes.length - existing.length) + '개'];
      if (existing.length) ask.push('· 이미 같은 내용으로 존재해 건너뛰는 파일 ' + existing.length + '개');
      ask.push('· ' + MANIFEST_PATH + ' 덮어쓰기');
      ask.push('', '계속할까요?');
      if (typeof confirm === 'function' && !confirm(ask.join('\n'))) throw new Error('저장을 취소했습니다');
      note('사진 파일 저장 중…');
      /* ① 사진 먼저, ② 검증을 통과한 index.json 은 맨 마지막에 — 중간에 실패해도 매니페스트가 깨지지 않는다 */
      return plan.writes.reduce(function (p, w) {
        return p.then(function () {
          if (existing.indexOf(w.path) >= 0) return null;    /* 내용 해시 경로 = 같은 내용, 덮어쓸 필요 없음 */
          return writeFile(mediaDir, baseName(w.path), w.blob);
        });
      }, Promise.resolve()).then(function () {
        note('index.json 저장 중…');
        return writeFile(teDir, 'index.json', plan.json);
      });
    }).then(function () {
      setBusy(false);
      var lines = ['저장 완료 · 새 사진 ' + (plan.writes.length - existing.length) + '개 · ' + MANIFEST_PATH + ' 갱신'];
      if (existing.length) lines.push('같은 내용이라 건너뛴 파일 ' + existing.length + '개');
      afterSave(plan, lines);
    }, function (e) {
      setBusy(false);
      renderList();
      if (e && (e.name === 'AbortError' || /취소/.test(e.message || ''))) { note('저장을 취소했습니다'); return; }
      throw e;
    });
  }

  function downloadBlob(name, blob) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { document.body.removeChild(a); } catch (e) {}
      try { URL.revokeObjectURL(url); } catch (e) {}
    }, 5000);
  }

  /** 폴더 저장을 못 쓰는 브라우저용 폴백 — 외부 ZIP 라이브러리 없이 파일을 하나씩 내려받는다 */
  function saveByDownload() {
    var plan = prepare();
    setBusy(true);
    var files = plan.writes.map(function (w) { return { name: baseName(w.path), blob: w.blob, path: w.path }; });
    files.push({
      name: 'index.json', path: MANIFEST_PATH,
      blob: new Blob([plan.json], { type: 'application/json' })
    });
    /* index.json 은 검증을 통과한 뒤 맨 마지막에 내려받는다 */
    return files.reduce(function (p, f, i) {
      return p.then(function () {
        return new Promise(function (res) {
          setTimeout(function () { downloadBlob(f.name, f.blob); res(); }, i ? 350 : 0);
        });
      });
    }, Promise.resolve()).then(function () {
      setBusy(false);
      var lines = ['다운로드한 파일을 저장소의 아래 경로에 그대로 넣어 주세요.'];
      files.forEach(function (f) { lines.push('  · ' + f.name + '  →  ' + f.path); });
      afterSave(plan, lines);
    }, function (e) {
      setBusy(false); renderList(); throw e;
    });
  }

  /* ── 열기 · 닫기 ─────────────────────────────────────────────────── */

  function open(host) {
    if (!hasDom()) return Promise.reject(new Error('브라우저 환경이 아닙니다'));
    var h = host || {};
    if (S.open) return Promise.resolve();
    ensureStyle();
    if (!S.el) S.el = buildShell();
    S.host = h;
    S.open = true;
    S.el.back.style.display = 'flex';
    note('유형 목록을 준비하는 중…');
    S.el.list.innerHTML = '<div class="bte-empty">불러오는 중…</div>';
    /* 매니페스트는 대시보드가 이미 페이지당 1회 받아 둔 것을 그대로 쓴다(추가 요청 없음) */
    var load = typeof h.loadManifest === 'function' ? h.loadManifest() : Promise.resolve(null);
    return Promise.resolve(load).then(function (m) {
      S.loadError = !!(m && m.loadError) || !m;
      S.manifest = {
        schema: (m && m.schema) || 1,
        updatedAt: (m && m.updatedAt) || todayLocal(),
        items: (m && m.items && typeof m.items === 'object') ? m.items : {}
      };
      S.hostRows = (h.rows && h.rows.length) ? h.rows : [];
      S.rows = buildTypeRows(S.hostRows, S.manifest);
      renderCatOptions();
      renderList();
      if (S.loadError) note('index.json 을 불러오지 못했습니다. 저장이 막혀 있으니 새로고침 후 다시 열어 주세요.', 'err');
      else if (!S.hostRows.length) note('대시보드 데이터가 아직 없어 index.json 에 등록된 유형만 표시합니다.');
      else note('');
      var first = S.el.back.querySelector('.bte-x');
      if (first) first.focus();
    }, function (e) {
      S.loadError = true;
      note('유형 목록을 준비하지 못했습니다 · ' + (e && e.message ? e.message : e), 'err');
    });
  }

  function close() {
    if (!S.el || !S.open) return;
    if (S.busy) return;                        /* 변환·저장 중에는 닫지 않는다 */
    if (changeCount() && typeof confirm === 'function'
      && !confirm('저장하지 않은 변경이 있습니다. 닫으면 사라집니다. 계속할까요?')) return;
    revokeAll();
    Object.keys(S.savedPreviews).forEach(function (k) {
      try { URL.revokeObjectURL(S.savedPreviews[k]); } catch (e) {}
    });
    S.savedPreviews = {};
    S.changes = {};
    S.open = false;
    S.el.back.style.display = 'none';
    note('');
  }

  var api = {
    open: open, close: close, convert: convert, encodeWebp: encodeWebp,
    canPickDirectory: canPickDirectory,
    _state: S                                  /* 디버그용 — 대시보드는 참조하지 않는다 */
  };
  for (var pk in PURE) { if (Object.prototype.hasOwnProperty.call(PURE, pk)) api[pk] = PURE[pk]; }
  return api;
});
