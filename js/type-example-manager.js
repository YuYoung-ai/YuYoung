/************************************************************
 * type-example-manager.js — VOC 유형별 대표 사진·짧은 영상(예시) 등록 도구
 * ----------------------------------------------------------
 * 왜 별도 파일인가:
 *  · 대표 예시 조회(dashboard-pc.html의 exTypeExample*)는 정적 index.json + 정적
 *    파일 하나면 끝난다. 반면 "등록"은 변환·검증·해시·파일 저장까지
 *    필요해 코드가 크다. 일반 사용자가 대시보드를 열 때 이 무게를 지불할 이유가
 *    없으므로, 관리 버튼을 누른 순간에만 <script>로 내려받는다.
 *  · js/baz-photo.js의 compress()는 업무사진(JPEG → GAS 업로드) 전용이다.
 *    대표 예시는 WebP/MP4·공개 저장소용이라 기준이 달라, 회귀 위험을 피하려고
 *    여기에 별도 변환기를 둔다(공유·수정하지 않는다).
 *
 * 이 모듈은 GAS·Google Sheets·Drive를 호출하지 않는다. 스스로 요청을 만들지 않고,
 * 유형 목록은 대시보드가 이미 받아 둔 데이터를, 매니페스트는 대시보드가 이미
 * 페이지당 1회 받아 둔 index.json을 그대로 받아서 쓴다.
 *
 * 저장은 세 갈래다 — 앞의 둘은 파일을 만들 뿐이고 커밋은 사람이 한다.
 *   ① 🚀 바로 게시   : host.publish() 콜백(대시보드 → 인증 서버 Lv.3)으로 저장소에
 *                      커밋한다. 폰에도 저장소 작업본이 필요 없어 기기를 가리지 않는다.
 *                      요청은 호스트가 보낸다 — 이 모듈에는 서버 주소도 fetch도 없다.
 *   ② 📁 폴더 저장   : Chrome·Edge 에서 저장소 폴더에 직접 쓴다. 한 번 고른 폴더는
 *                      IndexedDB 에 기억해 다음부터 선택 단계를 건너뛴다.
 *   ③ ⬇ 파일 다운로드: 그 밖의 브라우저용 폴백. 받은 파일을 안내된 경로에 넣는다.
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
  var VIDEO_MAX_BYTES = 5 * 1024 * 1024; /* 짧은 예시 영상 상한 */
  var VIDEO_MAX_SECONDS = 15;             /* 15초를 넘는 영상은 저장하지 않는다 */
  var COLLAGE_MAX_FILES = 4;
  var COLLAGE_FILE_MAX_BYTES = 10 * 1024 * 1024;
  var COLLAGE_TOTAL_MAX_BYTES = 30 * 1024 * 1024;
  var COLLAGE_WIDTH = 1200;
  var COLLAGE_RATIO = 3 / 4;              /* 1200×900 보고서형 4:3 */

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
   * 저장소 안의 이미지·MP4 경로만 허용한다.
   * 경로 탈출(..)·절대경로·외부 URL·data URL·blob URL을 모두 거부한다.
   */
  function isSafeSrc(src) {
    var s = String(src == null ? '' : src).trim();
    if (!s) return false;
    if (s.indexOf('..') >= 0) return false;
    if (s.charAt(0) === '/' || s.charAt(0) === '\\') return false;
    if (/^[A-Za-z][A-Za-z0-9+.\-]*:/.test(s)) return false;   /* http: https: data: blob: file: … */
    return /^assets\/type-examples\/[A-Za-z0-9_.\-\/]+\.(?:webp|jpe?g|png|mp4)$/.test(s);
  }
  function mediaKind(src) {
    return /\.mp4$/i.test(String(src == null ? '' : src).trim()) ? 'video' : 'image';
  }
  /** 이 도구가 새로 만드는 파일 경로인지 — 내용 해시 12자리 WebP·MP4만 인정한다 */
  function isMediaPath(src) {
    return /^assets\/type-examples\/media\/[0-9a-f]{12}\.(?:webp|mp4)$/.test(String(src == null ? '' : src).trim());
  }
  /** 해시 → 저장 경로. 사용자가 폴더 슬러그나 파일명을 정하지 않는다. */
  function mediaPath(hash12, kind) { return MEDIA_DIR + String(hash12 || '') + (kind === 'video' ? '.mp4' : '.webp'); }

  function toHex(buffer) {
    var view = new Uint8Array(buffer), out = '', i;
    for (i = 0; i < view.length; i++) out += (view[i] < 16 ? '0' : '') + view[i].toString(16);
    return out;
  }
  /** MP4 sample entry의 avc1/avc3 표식으로 H.264(AVC) 파일인지 확인한다. */
  function hasAvcCodec(bytes) {
    var view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || new ArrayBuffer(0)), i;
    for (i = 0; i <= view.length - 4; i++) {
      if (view[i] === 0x61 && view[i + 1] === 0x76 && view[i + 2] === 0x63 &&
          (view[i + 3] === 0x31 || view[i + 3] === 0x33)) return true;
    }
    return false;
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

  /** 1~4장 보고서형 합성 배치. 좌표 계산을 분리해 브라우저 없이도 검증한다. */
  function collageLayout(count, width, height, gap) {
    var n = Math.max(1, Math.min(COLLAGE_MAX_FILES, Math.floor(Number(count) || 1)));
    var w = Math.max(1, Math.round(Number(width) || COLLAGE_WIDTH));
    var h = Math.max(1, Math.round(Number(height) || w * COLLAGE_RATIO));
    var g = Math.max(0, Math.round(Number(gap) || 0));
    var halfW = Math.floor((w - g) / 2), rightW = w - g - halfW;
    var halfH = Math.floor((h - g) / 2), bottomH = h - g - halfH;
    if (n === 1) return [{ x: 0, y: 0, w: w, h: h }];
    if (n === 2) return [{ x: 0, y: 0, w: halfW, h: h }, { x: halfW + g, y: 0, w: rightW, h: h }];
    if (n === 3) return [
      { x: 0, y: 0, w: halfW, h: h },
      { x: halfW + g, y: 0, w: rightW, h: halfH },
      { x: halfW + g, y: halfH + g, w: rightW, h: bottomH }
    ];
    return [
      { x: 0, y: 0, w: halfW, h: halfH }, { x: halfW + g, y: 0, w: rightW, h: halfH },
      { x: 0, y: halfH + g, w: halfW, h: bottomH }, { x: halfW + g, y: halfH + g, w: rightW, h: bottomH }
    ];
  }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, Number(n) || 0)); }
  function moveCollageItem(list, from, to) {
    var out = (list || []).slice(), a = Math.floor(Number(from)), b = Math.floor(Number(to));
    if (a < 0 || a >= out.length || b < 0 || b >= out.length || a === b) return out;
    var item = out.splice(a, 1)[0]; out.splice(b, 0, item); return out;
  }
  function validateCollageFiles(files) {
    var list = Array.prototype.slice.call(files || []), total = 0, error = '';
    if (list.length < 2 || list.length > COLLAGE_MAX_FILES) error = '합성은 사진 2~4장을 선택해 주세요';
    list.forEach(function (file) {
      if (error) return;
      if (!file || !file.size || (file.type && !/^image\//.test(file.type)) || !/\.(?:jpe?g|png|webp|gif|bmp)$/i.test(file.name || '')) {
        error = '합성에는 JPG·PNG·WebP 사진만 사용할 수 있습니다: ' + ((file && file.name) || '알 수 없는 파일'); return;
      }
      if (file.size > COLLAGE_FILE_MAX_BYTES) { error = '합성 사진은 장당 10MB 이하만 가능합니다: ' + file.name; return; }
      total += file.size;
    });
    if (!error && total > COLLAGE_TOTAL_MAX_BYTES) error = '합성 사진 전체 용량은 30MB 이하만 가능합니다';
    return { ok: !error, error: error, files: list, total: total };
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
    var out = { src: String((p && p.src) || ''), text: String((p && p.text) || '').slice(0, TEXT_MAX) };
    if (mediaKind(out.src) === 'video') {
      out.kind = 'video';
      out.bytes = Math.round(Number(p && p.bytes) || 0);
      out.duration = Math.round((Number(p && p.duration) || 0) * 1000) / 1000;
    }
    return out;
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
        if (!photo || typeof photo !== 'object' || Array.isArray(photo)) { errors.push('예시 항목이 객체가 아닙니다: ' + key + ' / ' + SLOTS[s].id); continue; }
        if (typeof photo.src !== 'string' || !isSafeSrc(photo.src)) {
          errors.push('허용되지 않는 경로입니다: ' + key + ' / ' + SLOTS[s].id + ' → ' + String(photo.src));
          continue;
        }
        if (photo.text !== undefined && typeof photo.text !== 'string') errors.push('예시 설명이 문자열이 아닙니다: ' + key + ' / ' + SLOTS[s].id);
        if (mediaKind(photo.src) === 'video') {
          if (photo.kind !== 'video') errors.push('MP4 항목의 kind가 video가 아닙니다: ' + key + ' / ' + SLOTS[s].id);
          if (!(Number(photo.bytes) > 0 && Number(photo.bytes) <= VIDEO_MAX_BYTES)) {
            errors.push('영상 용량이 5MB 제한을 벗어났습니다: ' + key + ' / ' + SLOTS[s].id);
          }
          if (!(Number(photo.duration) > 0 && Number(photo.duration) <= VIDEO_MAX_SECONDS)) {
            errors.push('영상 길이가 15초 제한을 벗어났습니다: ' + key + ' / ' + SLOTS[s].id);
          }
        }
        used[photo.src] = true;
      }
      if (!slotCount) errors.push('증상·처리 결과가 모두 비어 있습니다: ' + key);
    }

    var newFiles = o.newFiles || [], seenFile = {};
    for (i = 0; i < newFiles.length; i++) {
      var p = String(newFiles[i] || '');
      if (!isSafeSrc(p)) { errors.push('새 파일 경로가 저장소 밖입니다: ' + p); continue; }
      if (!/\.(?:webp|mp4)$/.test(p)) { errors.push('새 파일 확장자가 webp 또는 mp4가 아닙니다: ' + p); continue; }
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

  /** 변경 목록 → 커밋 메시지·안내에 쓸 한 줄 요약 */
  function changeSummary(changes) {
    var ch = changes || {}, keys = Object.keys(ch).sort(), parts = [];
    keys.forEach(function (key) {
      var labels = [], s;
      for (s = 0; s < SLOTS.length; s++) if (ch[key] && ch[key][SLOTS[s].id]) labels.push(SLOTS[s].label);
      if (labels.length) parts.push(splitKey(key).type + ' ' + labels.join('·'));
    });
    if (!parts.length) return '';
    return parts[0] + (parts.length > 1 ? ' 외 ' + (parts.length - 1) + '건' : '');
  }
  /** 로컬 저장 뒤 그대로 붙여 넣을 수 있는 커밋 명령 */
  function commitCommand(summary) {
    var s = String(summary || '').replace(/["\\`$]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    return 'git add ' + ASSET_ROOT.replace(/\/$/, '') +
      ' && git commit -m "예시자료 갱신' + (s ? ' · ' + s : '') + '" && git push';
  }

  var PURE = {
    ASSET_ROOT: ASSET_ROOT, MEDIA_DIR: MEDIA_DIR, MANIFEST_PATH: MANIFEST_PATH, SLOTS: SLOTS,
    MAX_DIM: MAX_DIM, TARGET_BYTES: TARGET_BYTES, IDEAL_MIN_BYTES: IDEAL_MIN_BYTES,
    VIDEO_MAX_BYTES: VIDEO_MAX_BYTES, VIDEO_MAX_SECONDS: VIDEO_MAX_SECONDS,
    COLLAGE_MAX_FILES: COLLAGE_MAX_FILES, COLLAGE_FILE_MAX_BYTES: COLLAGE_FILE_MAX_BYTES,
    COLLAGE_TOTAL_MAX_BYTES: COLLAGE_TOTAL_MAX_BYTES, COLLAGE_WIDTH: COLLAGE_WIDTH,
    QUALITY_STEPS: QUALITY_STEPS, TEXT_MAX: TEXT_MAX,
    norm: norm, looseKey: looseKey, makeKey: makeKey, splitKey: splitKey,
    isSafeSrc: isSafeSrc, isMediaPath: isMediaPath, mediaPath: mediaPath, mediaKind: mediaKind,
    sha256Hex12: sha256Hex12, hasAvcCodec: hasAvcCodec,
    fitSize: fitSize, dimLadder: dimLadder, collageLayout: collageLayout, clamp: clamp,
    moveCollageItem: moveCollageItem, validateCollageFiles: validateCollageFiles, pickEncoding: pickEncoding,
    resolveKey: resolveKey, buildTypeRows: buildTypeRows, slotState: slotState,
    todayLocal: todayLocal, applyChanges: applyChanges, serializeManifest: serializeManifest,
    validateManifest: validateManifest, cleanupCandidates: cleanupCandidates,
    planWrites: planWrites, formatBytes: formatBytes,
    changeSummary: changeSummary, commitCommand: commitCommand
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

  function drawCover(ctx, img, rect, control) {
    var sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
    var c = control || {}, rotation = ((Math.round(Number(c.rotation) || 0) % 360) + 360) % 360;
    var turned = rotation === 90 || rotation === 270, rw = turned ? sh : sw, rh = turned ? sw : sh;
    var scale = Math.max(rect.w / rw, rect.h / rh) * clamp(c.zoom || 1, 1, 2);
    var ox = clamp(c.x || 0, -0.5, 0.5) * rect.w, oy = clamp(c.y || 0, -0.5, 0.5) * rect.h;
    ctx.translate(rect.x + rect.w / 2 + ox, rect.y + rect.h / 2 + oy);
    ctx.rotate(rotation * Math.PI / 180); ctx.scale(scale, scale);
    ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
  }

  /** 여러 사진을 1200×900 이내의 한 장으로 합성한다. 번호는 원본 순서를 보존한다. */
  function encodeCollage(images, dim, quality) {
    var width = Math.max(MIN_DIM, Math.round(Number(dim) || COLLAGE_WIDTH));
    var height = Math.round(width * COLLAGE_RATIO), gap = Math.max(6, Math.round(width * 0.01));
    return new Promise(function (resolve, reject) {
      var canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      var ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('캔버스를 사용할 수 없습니다')); return; }
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, width, height);
      var slots = collageLayout(images.length, width, height, gap);
      images.forEach(function (item, i) {
        var img=item&&item.img?item.img:item;
        var r = slots[i]; ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
        ctx.fillStyle = '#111827'; ctx.fillRect(r.x, r.y, r.w, r.h); drawCover(ctx, img, r, item); ctx.restore();
        var radius = Math.max(14, Math.round(width * 0.018)), cx = r.x + radius + 9, cy = r.y + radius + 9;
        ctx.fillStyle = 'rgba(7,20,46,.82)'; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#FFFFFF'; ctx.font = '700 ' + Math.max(14, Math.round(width * 0.018)) + 'px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1), cx, cy + 1);
      });
      canvas.toBlob(function (blob) {
        if (!blob || blob.type !== 'image/webp') { reject(new Error('WebP 합성 이미지를 만들지 못했습니다')); return; }
        resolve({ blob: blob, bytes: blob.size, width: width, height: height });
      }, 'image/webp', quality);
    });
  }

  function convertCollage(files) {
    if (!hasDom()) return Promise.reject(new Error('브라우저 환경이 아닙니다'));
    var checked = validateCollageFiles(files), list = checked.files, total = checked.total;
    if (!checked.ok) return Promise.reject(new Error(checked.error));
    var loaded = [];
    return Promise.all(list.map(function (file) { return loadImage(file).then(function (g) {
      loaded.push(g); return {img:g.img,file:file,url:g.url,x:0,y:0,zoom:1,rotation:0};
    }); })).then(function (items) {
        return buildCollageResult(items,list,total);
      }).then(function (r) {
        loaded.forEach(function (g) { try { URL.revokeObjectURL(g.url); } catch (e) {} }); return r;
      }, function (e) {
        loaded.forEach(function (g) { try { URL.revokeObjectURL(g.url); } catch (e2) {} }); throw e;
      });
  }

  function buildCollageResult(items,files,totalBytes) {
    return pickEncoding(function (dim, q) { return encodeCollage(items, dim, q); }, { startDim: COLLAGE_WIDTH })
      .then(function (enc) {
        return enc.blob.arrayBuffer().then(function (buf) {
          return sha256Hex12(buf).then(function (hash) {
            return {
              kind: 'image', collage: true, sourceCount: files.length,
              blob: enc.blob, bytes: enc.bytes, width: enc.width, height: enc.height,
              quality: enc.quality, over: !!enc.over, hash: hash, src: mediaPath(hash),
              origName: files.map(function (f) { return f.name; }).join(', '), origBytes: totalBytes,
              origWidth: 0, origHeight: 0
            };
          });
        });
      });
  }

  /**
   * 파일 1장 → 대표 사진용 WebP + 저장 경로.
   * 실패해도 기존 데이터는 건드리지 않는다(호출부가 예외만 표시한다).
   */
  function convertImage(file) {
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
                kind: 'image',
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

  /** MP4 메타데이터만 읽는다. 브라우저가 재생하지 못하는 코덱이면 onerror로 거부한다. */
  function loadVideoMeta(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), video = document.createElement('video'), done = false;
      var timer = setTimeout(function () { finish(new Error('영상 정보를 읽는 시간이 너무 오래 걸립니다')); }, 12000);
      function finish(err, data) {
        if (done) return; done = true; clearTimeout(timer);
        video.onloadedmetadata = null; video.onerror = null;
        try { video.removeAttribute('src'); video.load(); } catch (e) {}
        try { URL.revokeObjectURL(url); } catch (e2) {}
        if (err) reject(err); else resolve(data);
      }
      video.preload = 'metadata'; video.muted = true; video.playsInline = true;
      video.onloadedmetadata = function () {
        var duration = Number(video.duration), width = Number(video.videoWidth) || 0, height = Number(video.videoHeight) || 0;
        if (!(duration > 0) || !isFinite(duration)) { finish(new Error('영상 길이를 확인할 수 없습니다')); return; }
        finish(null, { duration: duration, width: width, height: height });
      };
      video.onerror = function () { finish(new Error('재생할 수 없는 MP4입니다. H.264로 내보낸 MP4를 사용해 주세요.')); };
      video.src = url;
    });
  }

  /**
   * 영상은 브라우저에서 재인코딩하지 않는다. MP4 재생 가능 여부·15초·5MB를 모두
   * 통과한 원본 바이트만 내용 해시 이름으로 저장한다.
   */
  function convertVideo(file) {
    if (!hasDom()) return Promise.reject(new Error('브라우저 환경이 아닙니다'));
    if (!file || !file.size) return Promise.reject(new Error('빈 파일입니다'));
    if (!/\.mp4$/i.test(file.name || '') || (file.type && file.type !== 'video/mp4' && file.type !== 'application/mp4')) {
      return Promise.reject(new Error('영상은 MP4(H.264/AVC) 파일만 등록할 수 있습니다'));
    }
    if (file.size > VIDEO_MAX_BYTES) {
      return Promise.reject(new Error('영상은 5MB 이하만 등록할 수 있습니다 (' + formatBytes(file.size) + ')'));
    }
    return loadVideoMeta(file).then(function (meta) {
      if (meta.duration > VIDEO_MAX_SECONDS) {
        throw new Error('영상은 15초 이하만 등록할 수 있습니다 (' + meta.duration.toFixed(1) + '초)');
      }
      return file.arrayBuffer().then(function (buf) {
        if (!hasAvcCodec(buf)) throw new Error('영상 코덱은 H.264(avc1/avc3)만 허용됩니다');
        return sha256Hex12(buf).then(function (hash) {
          return {
            kind: 'video', blob: file, bytes: file.size, width: meta.width, height: meta.height,
            duration: Math.round(meta.duration * 1000) / 1000, hash: hash, src: mediaPath(hash, 'video'),
            origName: file.name || '', origBytes: file.size, origWidth: meta.width, origHeight: meta.height,
            over: false
          };
        });
      });
    });
  }

  /** 파일 유형에 따라 사진 변환 또는 제한 검증된 MP4 보존을 선택한다. */
  function convert(file) {
    var isVideo = !!file && (/^video\//.test(file.type || '') || /\.mp4$/i.test(file.name || ''));
    return isVideo ? convertVideo(file) : convertImage(file);
  }

  /* ══════════════════════════════════════════════════════════════════
     3. 관리 화면 — 대시보드 DOM·상태를 건드리지 않는 독립 오버레이
     ══════════════════════════════════════════════════════════════════ */

  var S = {
    open: false, host: null, hostRows: [], manifest: null, rows: [], changes: {},
    busy: false, loadError: false, expanded: {}, savedPreviews: {},
    filterCat: '', query: '', onlyMissing: false, el: null, collage: null,
    dirHandle: null,          /* 기억해 둔 저장소 폴더(File System Access) */
    lastCommand: ''           /* 로컬 저장 직후 안내하는 git 명령 */
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
    '.bte-thumbs img,.bte-thumbs video{display:block;width:100%;height:86px;object-fit:contain;background:#111827;border-radius:6px;',
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
    '.bte-collage{position:fixed;inset:0;z-index:3;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(7,15,32,.78)}',
    '.bte-collage[hidden]{display:none!important}.bte-collage-box{width:min(920px,100%);max-height:calc(100dvh - 32px);overflow:auto;',
      'border-radius:13px;background:var(--surface,#fff);color:var(--text,#1A1A2E);box-shadow:0 20px 60px rgba(0,0,0,.32)}',
    '.bte-collage-head,.bte-collage-foot{display:flex;align-items:center;gap:8px;padding:11px 13px;border-bottom:1px solid var(--gray-line,#DDE3EE)}',
    '.bte-collage-head b{flex:1;color:var(--navy,#1B2F5E)}.bte-collage-foot{border-top:1px solid var(--gray-line,#DDE3EE);border-bottom:0}',
    '.bte-collage-foot span{flex:1;color:var(--text-muted,#6B7A99);font-size:10.5px}',
    '.bte-collage-body{display:grid;grid-template-columns:minmax(0,2fr) minmax(220px,.8fr);gap:12px;padding:12px}',
    '.bte-canvas-wrap{min-width:0;border:1px solid var(--gray-line,#DDE3EE);border-radius:9px;overflow:hidden;background:#111827}',
    '.bte-canvas-wrap canvas{display:block;width:100%;height:auto;aspect-ratio:4/3;touch-action:none;cursor:grab}.bte-canvas-wrap canvas.dragging{cursor:grabbing}',
    '.bte-collage-controls{display:flex;flex-direction:column;gap:9px;min-width:0}.bte-collage-controls h3{margin:0;color:var(--navy,#1B2F5E);font-size:12px}',
    '.bte-nudge{display:grid;grid-template-columns:repeat(3,34px);justify-content:center;gap:4px}.bte-nudge button:nth-child(1){grid-column:2}',
    '.bte-nudge button:nth-child(2){grid-column:1}.bte-nudge button:nth-child(3){grid-column:2}.bte-nudge button:nth-child(4){grid-column:3}',
    '.bte-range{font-size:10.5px;color:var(--text-muted,#6B7A99)}.bte-range input{width:100%}',
    '.bte-order{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.bte-order-item{border:1px solid var(--gray-line,#DDE3EE);',
      'border-radius:7px;padding:5px;background:var(--surface-2,#FBFCFE);cursor:pointer;min-width:0}.bte-order-item.active{border-color:var(--teal,#2E7D9E);box-shadow:0 0 0 1px var(--teal,#2E7D9E)}',
    '.bte-order-item img{display:block;width:100%;height:64px;object-fit:cover;border-radius:4px}.bte-order-item span{display:block;margin-top:3px;font-size:9.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.bte-order-move{display:flex;gap:3px;margin-top:4px}.bte-order-move button{flex:1;padding:3px;font-size:10px}',
    'body.dark .bte-state.s-both{background:#15291D;color:#8FD3B8}',
    'body.dark .bte-state.s-symptom{background:#17303A;color:#7FC6E2}',
    'body.dark .bte-state.s-after{background:#332B16;color:#D9A93F}',
    'body.dark .bte-state.s-none{background:#232D40;color:#97A3BA}',
    'body.dark .bte-panel{color-scheme:dark}',
    '@media(max-width:760px){.bte-slots{grid-template-columns:1fr}.bte-panel{height:calc(100dvh - 20px)}',
      '.bte-back,.bte-collage{padding:10px}.bte-thumbs figure{width:104px}.bte-collage-body{grid-template-columns:1fr}.bte-order-item img{height:54px}}'
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
    back.setAttribute('aria-label', 'VOC 유형별 예시 사진·영상 관리');
    back.innerHTML = ''
      + '<div class="bte-panel">'
      +   '<div class="bte-head"><h2>🖼 VOC 유형별 예시 사진·영상 관리</h2>'
      +     '<span class="bte-kicker">유형별 표준 예시</span>'
      +     '<button type="button" class="bte-x" data-act="close">✕ 닫기</button></div>'
      +   '<p class="bte-safety">여기 등록하는 자료는 <b>실제 처리 기록이 아니라 VOC 유형별 표준 예시</b>입니다. '
      +     '환자·직원 얼굴, 병원명, 장비 S/N, 문서·모니터의 개인정보가 보이지 않는 자료만 사용하세요. '
      +     '사진 2~4장은 브라우저에서 4:3 한 장으로 합성할 수 있으며 원본은 서버로 전송되지 않습니다. '
      +     '영상은 MP4(H.264/AVC)·15초 이하·5MB 이하만 허용되며 재생 시 기본 음소거됩니다. '
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
      +     '<button type="button" class="bte-btn" data-act="dirforget" hidden>📂 폴더 변경</button>'
      +     '<button type="button" class="bte-btn" data-act="copycmd" hidden>📋 커밋 명령 복사</button>'
      +     '<button type="button" class="bte-btn" data-act="download">⬇ 파일 다운로드</button>'
      +     '<button type="button" class="bte-btn" data-act="save">📁 저장소 폴더에 저장</button>'
      +     '<button type="button" class="bte-btn bte-go" data-act="publish" hidden>🚀 바로 게시</button>'
      +   '</div>'
      + '</div>'
      + '<section class="bte-collage" data-el="collage" hidden aria-label="사진 합성 수동 조정">'
      +   '<div class="bte-collage-box">'
      +     '<div class="bte-collage-head"><b>▦ 사진 합성 · 자동 배치 / 수동 조정</b>'
      +       '<button type="button" class="bte-btn" data-act="collage-cancel">✕ 취소</button></div>'
      +     '<div class="bte-collage-body"><div class="bte-canvas-wrap"><canvas width="800" height="600" data-el="collage-canvas" tabindex="0"></canvas></div>'
      +       '<aside class="bte-collage-controls"><h3 data-el="collage-selected">선택 사진</h3>'
      +         '<div class="bte-nudge"><button class="bte-btn" data-act="collage-up">↑</button><button class="bte-btn" data-act="collage-left">←</button>'
      +           '<button class="bte-btn" data-act="collage-down">↓</button><button class="bte-btn" data-act="collage-right">→</button></div>'
      +         '<label class="bte-range">확대 <span data-el="collage-zoom-label">100%</span><input type="range" min="100" max="200" step="5" value="100" data-act="collage-zoom"></label>'
      +         '<div><button class="bte-btn" data-act="collage-rotate">↻ 90° 회전</button> <button class="bte-btn" data-act="collage-photo-reset">선택 사진 초기화</button></div>'
      +         '<h3>사진 순서 · 드래그 또는 화살표</h3><div class="bte-order" data-el="collage-order"></div></aside></div>'
      +     '<div class="bte-collage-foot"><span>미리보기에서 사진을 직접 끌어 위치를 조정할 수 있습니다.</span>'
      +       '<button class="bte-btn" data-act="collage-reset">자동 배치로 초기화</button>'
      +       '<button class="bte-btn bte-go" data-act="collage-apply">이 배치로 합성</button></div>'
      +   '</div></section>';
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
      save: back.querySelector('[data-act="save"]'),
      publish: back.querySelector('[data-act="publish"]'),
      dirforget: back.querySelector('[data-act="dirforget"]'),
      copycmd: back.querySelector('[data-act="copycmd"]')
    };
    el.collage = back.querySelector('[data-el="collage"]');
    el.collageCanvas = back.querySelector('[data-el="collage-canvas"]');
    el.collageOrder = back.querySelector('[data-el="collage-order"]');
    el.collageSelected = back.querySelector('[data-el="collage-selected"]');
    el.collageZoom = back.querySelector('[data-act="collage-zoom"]');
    el.collageZoomLabel = back.querySelector('[data-el="collage-zoom-label"]');
    if (!canPickDirectory()) {
      el.save.hidden = true;                  /* Chrome·Edge 외에는 다운로드 폴백만 노출한다 */
    }
    el.cat.addEventListener('change', function () { S.filterCat = el.cat.value; renderList(); });
    el.query.addEventListener('input', function () { S.query = looseKey(el.query.value); renderList(); });
    el.missing.addEventListener('change', function () { S.onlyMissing = !!el.missing.checked; renderList(); });
    el.reset.addEventListener('click', function () { resetAll(); });
    el.download.addEventListener('click', function () { guard(saveByDownload); });
    el.save.addEventListener('click', function () { guard(saveToDirectory); });
    el.publish.addEventListener('click', function () { guard(publishToRepo); });
    el.dirforget.addEventListener('click', function () { forgetDirectory(); });
    el.copycmd.addEventListener('click', function () { copyCommand(); });
    back.addEventListener('click', function (e) {
      if (e.target === back) { close(); return; }
      var act = e.target.closest && e.target.closest('[data-act="close"]');
      if (act) close();
    });
    back.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !S.busy) {
        e.stopPropagation();
        if(S.collage){closeCollageEditor_();note('합성을 취소했습니다');}
        else close();
      }
    });
    el.list.addEventListener('click', onListClick);
    el.list.addEventListener('input', onListInput);
    el.list.addEventListener('change', onListFile);
    el.list.addEventListener('dragover', onDragOver, true);
    el.list.addEventListener('dragleave', onDragLeave, true);
    el.list.addEventListener('drop', onDrop, true);
    el.collage.addEventListener('click', onCollageClick);
    el.collage.addEventListener('input', onCollageInput);
    el.collage.addEventListener('dragstart', onCollageDragStart);
    el.collage.addEventListener('dragover', function(e){if(e.target.closest&&e.target.closest('.bte-order-item'))e.preventDefault();});
    el.collage.addEventListener('drop', onCollageDrop);
    el.collageCanvas.addEventListener('pointerdown', onCollagePointerDown);
    el.collageCanvas.addEventListener('pointermove', onCollagePointerMove);
    el.collageCanvas.addEventListener('pointerup', onCollagePointerUp);
    el.collageCanvas.addEventListener('pointercancel', onCollagePointerUp);
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
      + ' · 증상 예시만 ' + n.symptom + ' · 처리 결과 예시만 ' + n.after + ' · 모두 미등록 ' + n.none;
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
    function preview(src, alt, kind) {
      return kind === 'video'
        ? '<video aria-label="' + escHtml(alt) + '" controls muted playsinline preload="metadata" src="' + escHtml(src) + '"></video>'
        : '<img alt="' + escHtml(alt) + '" decoding="async" referrerpolicy="no-referrer" src="' + escHtml(src) + '">';
    }
    var thumbs = '';
    if (curSrc) {
      /* 방금 저장했지만 아직 배포되지 않은 파일은 변환 결과 미리보기를 그대로 재사용한다 */
      var show = S.savedPreviews[curSrc] || curSrc;
      thumbs += '<figure><figcaption>현재</figcaption>' + preview(show, '현재 ' + slot.label + ' 예시', mediaKind(curSrc)) + '</figure>';
    }
    if (ch && ch.previewUrl) {
      thumbs += '<figure><figcaption>' + (ch.kind === 'video' ? '검증 결과' : '변환 결과') + '</figcaption>'
        + preview(ch.previewUrl, (ch.kind === 'video' ? '검증된 ' : '변환된 ') + slot.label + ' 예시', ch.kind) + '</figure>';
    }
    var meta = '';
    if (ch && ch.blob) {
      if (ch.kind === 'video') {
        meta = '<p class="bte-meta">검증된 MP4 · ' + formatBytes(ch.bytes) + ' · ' + ch.duration.toFixed(1) + '초'
          + (ch.width && ch.height ? ' · ' + ch.width + '×' + ch.height : '')
          + '<br>제한 통과: 15초 이하 · 5MB 이하 · 자동재생 없음 · 기본 음소거'
          + '<br>저장 경로 ' + escHtml(ch.src) + '</p>';
      } else {
        meta = '<p class="bte-meta' + (ch.over ? ' warn' : '') + '">' + (ch.collage
          ? ('합성 원본 ' + ch.sourceCount + '장 · ' + formatBytes(ch.origBytes) + (ch.manual ? ' · 수동 배치' : ''))
          : ('원본 ' + escHtml(ch.origName || '선택한 사진') + ' · ' + formatBytes(ch.origBytes) + ' · ' + ch.origWidth + '×' + ch.origHeight))
          + '<br>변환 WebP · ' + formatBytes(ch.bytes) + ' · ' + ch.width + '×' + ch.height
          + ' · 품질 ' + ch.quality.toFixed(2)
          + '<br>저장 경로 ' + escHtml(ch.src)
          + (ch.over ? '<br>⚠ 최저 품질·최소 해상도에서도 300KB를 넘었습니다. 더 단순한 사진을 권장합니다.' : '') + '</p>';
      }
    } else if (curSrc) {
      meta = '<p class="bte-meta">현재 파일 ' + escHtml(curSrc) + '</p>';
    }
    if (ch && ch.error) meta += '<p class="bte-meta err">' + escHtml(ch.error) + '</p>';

    return '<section class="bte-slot" data-slot="' + id + '">'
      + '<div class="bte-slot-head"><b>' + escHtml(slot.label) + ' 예시</b><span>' + escHtml(stateLabel) + '</span></div>'
      + '<div class="bte-drop" data-act="drop">'
      +   (thumbs ? '<div class="bte-thumbs">' + thumbs + '</div>' : '')
      +   '<p class="bte-dropmsg">사진 또는 짧은 영상을 선택하세요 (JPG·PNG·WebP / MP4·15초·5MB 이하)</p>'
      +   '<button type="button" class="bte-btn" data-act="pick"' + (S.busy ? ' disabled' : '') + '>사진·영상 1개</button> '
      +   '<button type="button" class="bte-btn" data-act="pick-collage"' + (S.busy ? ' disabled' : '') + '>▦ 사진 2~4장 합성</button>'
      +   '<input type="file" accept="image/*,video/mp4,.mp4" data-act="file" hidden>'
      +   '<input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" data-act="collage-file" multiple hidden>'
      + '</div>'
      + meta
      + '<label class="bte-label">예시 설명'
      +   '<input type="text" maxlength="' + TEXT_MAX + '" data-act="text" value="' + escHtml(text) + '"'
      +   ((curSrc || (ch && ch.blob)) ? '' : ' disabled placeholder="예시를 먼저 등록하세요"') + '></label>'
      + (ch ? '<button type="button" class="bte-btn" data-act="undo" style="margin-top:7px">↺ 이 예시 변경 취소</button>' : '')
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
      /* 예시 파일 요청은 행을 펼쳤을 때만 일어난다 — 목록을 여는 것만으로 파일이 내려오지 않는다 */
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
    var blocked = S.busy || !n || S.loadError;
    S.el.reset.disabled = S.busy || !n;
    S.el.download.disabled = blocked;
    S.el.save.disabled = blocked;
    S.el.publish.disabled = blocked;
    S.el.dirforget.disabled = S.busy;
    S.el.copycmd.disabled = S.busy;
    /* 게시를 쓸 수 있으면 게시가 기본 동작, 아니면 폴더 저장이 기본 동작 */
    var pub = canPublish();
    S.el.publish.hidden = !pub;
    S.el.save.hidden = !canPickDirectory();
    S.el.save.className = 'bte-btn' + (!pub && !S.el.save.hidden ? ' bte-go' : '');
    S.el.dirforget.hidden = !S.dirHandle;
    S.el.copycmd.hidden = !S.lastCommand;
  }

  /* ── 사진 합성 편집기 ───────────────────────────────────────────── */

  function collageSelected_() {
    return S.collage&&S.collage.items[S.collage.selected];
  }
  function drawCollagePreview_() {
    if(!S.collage||!S.el||!S.el.collageCanvas)return;
    var canvas=S.el.collageCanvas,ctx=canvas.getContext('2d'),items=S.collage.items;
    ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,canvas.width,canvas.height);
    var slots=collageLayout(items.length,canvas.width,canvas.height,8);
    items.forEach(function(item,i){
      var r=slots[i];ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.w,r.h);ctx.clip();
      ctx.fillStyle='#111827';ctx.fillRect(r.x,r.y,r.w,r.h);drawCover(ctx,item.img,r,item);ctx.restore();
      ctx.save();ctx.lineWidth=i===S.collage.selected?6:2;ctx.strokeStyle=i===S.collage.selected?'#22B8C7':'rgba(255,255,255,.85)';
      ctx.strokeRect(r.x+2,r.y+2,r.w-4,r.h-4);
      ctx.fillStyle='rgba(7,20,46,.82)';ctx.beginPath();ctx.arc(r.x+23,r.y+23,16,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#fff';ctx.font='700 15px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i+1),r.x+23,r.y+24);ctx.restore();
    });
  }
  function renderCollageControls_(){
    if(!S.collage||!S.el)return;
    var selected=collageSelected_();
    S.el.collageSelected.textContent='선택 사진 '+(S.collage.selected+1)+' · '+((selected&&selected.file&&selected.file.name)||'');
    S.el.collageZoom.value=Math.round((selected.zoom||1)*100);
    S.el.collageZoomLabel.textContent=Math.round((selected.zoom||1)*100)+'%';
    S.el.collageOrder.innerHTML=S.collage.items.map(function(item,i){
      return '<div class="bte-order-item'+(i===S.collage.selected?' active':'')+'" data-index="'+i+'" draggable="true">'
        +'<img src="'+escHtml(item.url)+'" alt="사진 '+(i+1)+' 미리보기"><span>'+(i+1)+'. '+escHtml(item.file.name)+'</span>'
        +'<div class="bte-order-move"><button type="button" class="bte-btn" data-act="collage-prev"'+(i===0?' disabled':'')+'>←</button>'
        +'<button type="button" class="bte-btn" data-act="collage-next"'+(i===S.collage.items.length-1?' disabled':'')+'>→</button></div></div>';
    }).join('');
  }
  function renderCollageEditor_(){drawCollagePreview_();renderCollageControls_();}
  function closeCollageEditor_(){
    if(!S.collage)return;
    S.collage.items.forEach(function(item){try{URL.revokeObjectURL(item.url);}catch(e){}});
    S.collage=null;if(S.el&&S.el.collage)S.el.collage.hidden=true;
  }
  function openCollageEditor_(c,files){
    if(!c||!c.row||!c.slot||S.busy)return;
    var checked=validateCollageFiles(files);if(!checked.ok){note('합성 실패 · '+checked.error,'err');return;}
    setBusy(true);note((c.row.type||c.key)+' · 사진 '+checked.files.length+'장 미리보기 준비 중…');
    var loaded=[];
    Promise.all(checked.files.map(function(file,index){return loadImage(file).then(function(g){
      loaded.push(g);return {img:g.img,url:g.url,file:file,originalIndex:index,x:0,y:0,zoom:1,rotation:0};
    });})).then(function(items){
      setBusy(false);S.collage={ctx:c,items:items,selected:0,total:checked.total,dragIndex:-1,pointer:null};
      S.el.collage.hidden=false;renderCollageEditor_();S.el.collageCanvas.focus();note('');
    },function(err){
      loaded.forEach(function(g){try{URL.revokeObjectURL(g.url);}catch(e){}});setBusy(false);
      note('합성 실패 · '+((err&&err.message)||err),'err');
    });
  }
  function resetCollageItem_(item){if(!item)return;item.x=0;item.y=0;item.zoom=1;item.rotation=0;}
  function moveSelectedCollage_(dx,dy){
    var item=collageSelected_();if(!item)return;item.x=clamp(item.x+dx,-.5,.5);item.y=clamp(item.y+dy,-.5,.5);drawCollagePreview_();
  }
  function reorderCollage_(from,to){
    if(!S.collage)return;S.collage.items=moveCollageItem(S.collage.items,from,to);S.collage.selected=clamp(to,0,S.collage.items.length-1);renderCollageEditor_();
  }
  function applyCollageEditor_(){
    if(!S.collage||S.busy)return;
    var edit=S.collage,c=edit.ctx,items=edit.items.slice(),files=items.map(function(x){return x.file;});
    var cur=c.row.item&&c.row.item[c.slot],prev=changeOf(c.key,c.slot),keepText=prev?prev.text:String((cur&&cur.text)||'');
    setBusy(true);note((c.row.type||c.key)+' · 조정한 배치로 합성 중…');
    buildCollageResult(items,files,edit.total).then(function(r){
      setChange(c.key,c.slot,{kind:'image',collage:true,manual:true,sourceCount:r.sourceCount,src:r.src,text:keepText,
        blob:r.blob,bytes:r.bytes,width:r.width,height:r.height,quality:r.quality,over:r.over,hash:r.hash,
        origName:r.origName,origBytes:r.origBytes,origWidth:0,origHeight:0,previewUrl:URL.createObjectURL(r.blob),error:''});
      closeCollageEditor_();
      note('합성 완료 · 수동 배치 '+r.sourceCount+'장 → WebP '+formatBytes(r.bytes)+' · '+r.width+'×'+r.height+(r.over?' (목표 300KB 초과)':''),r.over?'err':'ok');
    },function(err){note('합성 실패 · '+((err&&err.message)||err),'err');}).then(function(){setBusy(false);renderList();});
  }
  function onCollageClick(e){
    if(!S.collage)return;var btn=e.target.closest&&e.target.closest('[data-act]'),itemEl=e.target.closest&&e.target.closest('.bte-order-item');
    if(itemEl&&!btn){S.collage.selected=Number(itemEl.getAttribute('data-index'))||0;renderCollageEditor_();return;}
    if(!btn)return;var act=btn.getAttribute('data-act'),item=collageSelected_();
    if(act==='collage-cancel'){closeCollageEditor_();note('합성을 취소했습니다');return;}
    if(act==='collage-up')moveSelectedCollage_(0,-.05);else if(act==='collage-down')moveSelectedCollage_(0,.05);
    else if(act==='collage-left')moveSelectedCollage_(-.05,0);else if(act==='collage-right')moveSelectedCollage_(.05,0);
    else if(act==='collage-rotate'){item.rotation=(item.rotation+90)%360;renderCollageEditor_();}
    else if(act==='collage-photo-reset'){resetCollageItem_(item);renderCollageEditor_();}
    else if(act==='collage-reset'){S.collage.items.sort(function(a,b){return a.originalIndex-b.originalIndex;});S.collage.items.forEach(resetCollageItem_);S.collage.selected=0;renderCollageEditor_();}
    else if(act==='collage-prev'){var i=Number(itemEl&&itemEl.getAttribute('data-index'));reorderCollage_(i,i-1);}
    else if(act==='collage-next'){var j=Number(itemEl&&itemEl.getAttribute('data-index'));reorderCollage_(j,j+1);}
    else if(act==='collage-apply')applyCollageEditor_();
  }
  function onCollageInput(e){
    if(!S.collage||e.target.getAttribute('data-act')!=='collage-zoom')return;
    var item=collageSelected_();item.zoom=clamp(Number(e.target.value)/100,1,2);S.el.collageZoomLabel.textContent=Math.round(item.zoom*100)+'%';drawCollagePreview_();
  }
  function onCollageDragStart(e){var el=e.target.closest&&e.target.closest('.bte-order-item');if(S.collage&&el)S.collage.dragIndex=Number(el.getAttribute('data-index'));}
  function onCollageDrop(e){
    var el=e.target.closest&&e.target.closest('.bte-order-item');if(!S.collage||!el||S.collage.dragIndex<0)return;
    e.preventDefault();var to=Number(el.getAttribute('data-index')),from=S.collage.dragIndex;S.collage.dragIndex=-1;reorderCollage_(from,to);
  }
  function collageCanvasPoint_(e){
    var c=S.el.collageCanvas,r=c.getBoundingClientRect();return{x:(e.clientX-r.left)*c.width/r.width,y:(e.clientY-r.top)*c.height/r.height};
  }
  function onCollagePointerDown(e){
    if(!S.collage)return;var p=collageCanvasPoint_(e),slots=collageLayout(S.collage.items.length,S.el.collageCanvas.width,S.el.collageCanvas.height,8),idx=-1;
    for(var i=0;i<slots.length;i++){var r=slots[i];if(p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h){idx=i;break;}}
    if(idx<0)return;S.collage.selected=idx;var item=collageSelected_(),slot=slots[idx];
    S.collage.pointer={id:e.pointerId,start:p,x:item.x,y:item.y,w:slot.w,h:slot.h};S.el.collageCanvas.classList.add('dragging');
    if(S.el.collageCanvas.setPointerCapture)S.el.collageCanvas.setPointerCapture(e.pointerId);renderCollageControls_();drawCollagePreview_();
  }
  function onCollagePointerMove(e){
    if(!S.collage||!S.collage.pointer||S.collage.pointer.id!==e.pointerId)return;var p=collageCanvasPoint_(e),d=S.collage.pointer,item=collageSelected_();
    item.x=clamp(d.x+(p.x-d.start.x)/d.w,-.5,.5);item.y=clamp(d.y+(p.y-d.start.y)/d.h,-.5,.5);drawCollagePreview_();
  }
  function onCollagePointerUp(e){
    if(!S.collage||!S.collage.pointer||S.collage.pointer.id!==e.pointerId)return;S.collage.pointer=null;S.el.collageCanvas.classList.remove('dragging');
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
    if (act !== 'toggle' && act !== 'pick' && act !== 'pick-collage' && act !== 'undo') return;
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
    if (act === 'pick-collage') {
      var collageInput = c.slotEl && c.slotEl.querySelector('[data-act="collage-file"]');
      if (collageInput) collageInput.click();
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
      /* 예시 파일은 그대로고 설명도 원래대로 돌아왔다면 변경으로 세지 않는다 */
      if (!ch.blob && text === String((cur && cur.text) || '')) { setChange(c.key, c.slot, null); renderList(); }
      else renderSummary();
      return;
    }
    if (!cur || !cur.src) return;
    if (text === String(cur.text || '')) return;
    setChange(c.key, c.slot, {
      src: cur.src, text: text, blob: null,
      kind: cur.kind, bytes: cur.bytes, duration: cur.duration
    });
    c.rowEl.classList.add('changed');
    renderSummary();
  }

  function onListFile(e) {
    var t = e.target;
    if (!t) return;
    var act = t.getAttribute('data-act');
    if (act !== 'file' && act !== 'collage-file') return;
    var files = t.files ? Array.prototype.slice.call(t.files) : [];
    t.value = '';
    if (act === 'collage-file') { if (files.length) acceptCollage(ctx(t), files); }
    else if (files[0]) acceptFile(ctx(t), files[0]);
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
    var dt = e.dataTransfer, files = dt&&dt.files?Array.prototype.slice.call(dt.files):[];
    if (files.length>1) acceptCollage(ctx(zone),files); else if(files[0]) acceptFile(ctx(zone),files[0]);
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
    var video = /^video\//.test(file.type || '') || /\.mp4$/i.test(file.name || '');
    note((c.row.type || c.key) + ' · ' + c.slot + (video ? ' 영상 검증 중…' : ' 사진 변환 중…'));
    convert(file).then(function (r) {
      setChange(c.key, c.slot, {
        kind: r.kind, src: r.src, text: keepText, blob: r.blob, bytes: r.bytes,
        width: r.width, height: r.height, quality: r.quality, over: r.over, hash: r.hash,
        duration: r.duration,
        origName: r.origName, origBytes: r.origBytes, origWidth: r.origWidth, origHeight: r.origHeight,
        previewUrl: URL.createObjectURL(r.blob), error: ''
      });
      note(r.kind === 'video'
        ? '영상 검증 완료 · ' + formatBytes(r.bytes) + ' · ' + r.duration.toFixed(1) + '초'
        : '변환 완료 · ' + formatBytes(r.bytes) + ' · ' + r.width + '×' + r.height
          + (r.over ? ' (목표 300KB 초과)' : ''), r.over ? 'err' : 'ok');
    }, function (err) {
      /* 변환 실패는 기존 등록 내용을 건드리지 않는다 */
      note('변환 실패 · ' + (err && err.message ? err.message : '알 수 없는 오류'), 'err');
    }).then(function () {
      setBusy(false);
      renderList();
    });
  }

  function acceptCollage(c, files) {
    openCollageEditor_(c, files);
  }

  function resetAll() {
    if (S.busy) return;
    if (!changeCount()) return;
    if (typeof confirm === 'function' && !confirm('변환·검증한 예시와 수정한 설명을 모두 되돌립니다. 계속할까요?')) return;
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

  function afterSave(plan, lines, opts) {
    var o = opts || {}, summary = changeSummary(S.changes);
    /* 저장한 예시는 아직 배포되기 전이라 서버에서 못 받는다 —
       미리보기 URL을 그대로 재사용해 화면에서 깨진 미리보기가 보이지 않게 한다. */
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
    if (o.published) {
      S.lastCommand = '';
      msg.push('배포는 GitHub Pages 워크플로가 이어서 진행합니다 — 약 1분 뒤 모든 사용자 화면에 반영됩니다.');
    } else {
      S.lastCommand = commitCommand(summary);
      msg.push('마지막으로 저장소에서 변경 파일을 확인한 뒤 커밋하세요.');
      msg.push('  ' + S.lastCommand);
      msg.push('"📋 커밋 명령 복사" 버튼으로 위 명령을 그대로 복사할 수 있습니다.');
    }
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

  /* ── 게시 · 저장 보조 ─────────────────────────────────────────────
     저장 결과를 사람이 손으로 옮기던 자리를 줄인다.
      · publish  : 호스트가 넘겨준 콜백으로 저장소에 바로 커밋한다(모듈은 직접 요청하지 않는다)
      · 폴더 기억: 한 번 고른 저장소 폴더를 IndexedDB 에 남겨 다음 저장부터 선택을 생략한다
      · 커밋 명령: 로컬 저장 뒤 붙여 넣을 git 명령을 만들어 둔다 */

  var PUBLISH_ERRORS = {
    publish_disabled: '서버에 게시 기능이 켜져 있지 않습니다. "저장소 폴더에 저장" 또는 "파일 다운로드"를 사용하세요.',
    unauthorized: '로그인이 만료되었습니다. 다시 로그인한 뒤 시도해 주세요.',
    forbidden: 'Lv.3 권한이 필요합니다.',
    network: '서버에 연결하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.',
    no_response: '서버가 응답하지 않았습니다. 잠시 뒤 다시 시도해 주세요.',
    bad_path: '허용되지 않는 파일 경로입니다.',
    bad_base64: '업로드 데이터가 손상됐습니다. 다시 시도해 주세요.',
    hash_mismatch: '올린 파일이 변환 결과와 다릅니다. 다시 시도해 주세요.',
    too_large: '파일 용량 제한을 넘었습니다.',
    too_many_files: '한 번에 게시할 수 있는 파일 수를 넘었습니다. 나눠서 게시해 주세요.',
    bad_manifest_size: 'index.json 크기가 허용 범위를 벗어났습니다.',
    invalid_manifest: 'index.json 검증에 실패해 아무 파일도 커밋하지 않았습니다.',
    github_failed: '저장소에 커밋하지 못했습니다.'
  };
  function publishError(r) {
    var code = (r && r.error) || 'no_response';
    var base = PUBLISH_ERRORS[code] || ('게시하지 못했습니다 (' + code + ')');
    var detail = r && (r.detail || (r.errors && r.errors.join('\n· ')));
    return base + (detail ? '\n· ' + detail : '');
  }
  function canPublish() { return !!(S.host && typeof S.host.publish === 'function'); }

  /** 변환이 끝난 결과 blob 만 base64 로 바꾼다(원본은 이 경로에 오지 않는다) */
  function blobBase64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result || ''), at = s.indexOf(',');
        if (at < 0) { reject(new Error('파일을 읽지 못했습니다')); return; }
        resolve(s.slice(at + 1));
      };
      fr.onerror = function () { reject(new Error('파일을 읽지 못했습니다')); };
      fr.readAsDataURL(blob);
    });
  }

  /**
   * 저장소에 바로 커밋한다. 파일을 한 개씩 올린 뒤(①) 마지막에 커밋 한 번(②).
   * 서버가 경로·해시·매니페스트를 다시 검증하므로 화면의 검증을 통과했다고 통과되지 않는다.
   */
  function publishToRepo() {
    if (!canPublish()) throw new Error('이 화면에서는 바로 게시를 쓸 수 없습니다');
    var plan = prepare();
    var summary = changeSummary(S.changes);
    var ask = ['저장소에 바로 커밋하고 배포합니다.', '',
      '· 새 예시 파일 ' + plan.writes.length + '개',
      '· ' + MANIFEST_PATH + ' 갱신',
      '· 약 1분 뒤 모든 사용자 화면에 반영됩니다', '', '계속할까요?'];
    if (typeof confirm === 'function' && !confirm(ask.join('\n'))) { note('게시를 취소했습니다'); return null; }
    setBusy(true);
    var uploaded = [];
    return plan.writes.reduce(function (p, w, i) {
      return p.then(function () {
        note('게시 중 · 파일 ' + (i + 1) + '/' + plan.writes.length + ' 올리는 중…');
        return blobBase64(w.blob).then(function (data) {
          return S.host.publish('blob', { path: w.path, data: data });
        }).then(function (r) {
          if (!r || !r.ok) throw new Error(publishError(r));
          uploaded.push({ path: w.path, sha: r.sha });
        });
      });
    }, Promise.resolve()).then(function () {
      note('게시 중 · 커밋하는 중…');
      /* 파일이 다 올라간 뒤에야 매니페스트를 커밋한다 — 중간에 끊기면 저장소는 그대로다 */
      return S.host.publish('commit', { files: uploaded, manifest: plan.json, summary: summary });
    }).then(function (r) {
      if (!r || !r.ok) throw new Error(publishError(r));
      setBusy(false);
      var lines = [r.unchanged
        ? '이미 같은 내용이 저장소에 있어 새 커밋을 만들지 않았습니다.'
        : '게시 완료 · 새 예시 파일 ' + (r.files || 0) + '개 · ' + MANIFEST_PATH + ' 갱신'];
      if (r.commit) lines.push('커밋 ' + String(r.commit).slice(0, 7) + (r.url ? ' · ' + r.url : ''));
      afterSave(plan, lines, { published: true });
    }, function (e) {
      setBusy(false);
      renderList();
      throw e;
    });
  }

  /* ── 저장소 폴더 기억(IndexedDB) ───────────────────────────────────
     폴더 핸들은 문자열로 못 만든다 — localStorage 가 아니라 IndexedDB 에 담는다.
     핸들을 들고 있어도 권한은 브라우저가 따로 관리하므로 저장할 때마다 확인한다. */
  var DIR_DB = 'baz-type-example', DIR_STORE = 'handles', DIR_KEY = 'repoRoot';
  function idbOpen() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') { reject(new Error('no-idb')); return; }
      var req = indexedDB.open(DIR_DB, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(DIR_STORE)) req.result.createObjectStore(DIR_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('idb-open')); };
    });
  }
  function idbRun(mode, run) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DIR_STORE, mode), req = run(tx.objectStore(DIR_STORE));
        tx.oncomplete = function () { db.close(); resolve(req && req.result); };
        tx.onabort = tx.onerror = function () { db.close(); reject(tx.error || new Error('idb-tx')); };
      });
    });
  }
  function quiet(p, fallback) { return p.then(null, function () { return fallback; }); }
  function dirLoad() { return quiet(idbRun('readonly', function (st) { return st.get(DIR_KEY); }), null); }
  function dirSave(h) { return quiet(idbRun('readwrite', function (st) { return st.put(h, DIR_KEY); }), null); }
  function dirForget() { return quiet(idbRun('readwrite', function (st) { return st['delete'](DIR_KEY); }), null); }

  function ensureWritable(handle) {
    if (!handle || !handle.queryPermission) return Promise.resolve(handle);
    return Promise.resolve(handle.queryPermission({ mode: 'readwrite' })).then(function (state) {
      if (state === 'granted') return handle;
      if (!handle.requestPermission) throw new Error('폴더 쓰기 권한이 없습니다');
      return Promise.resolve(handle.requestPermission({ mode: 'readwrite' })).then(function (next) {
        if (next !== 'granted') throw new Error('폴더 쓰기 권한이 없습니다');
        return handle;
      });
    });
  }
  /** 기억한 폴더가 있으면 그대로, 없거나 권한을 잃었으면 다시 고르게 한다 */
  function pickRoot() {
    var remembered = S.dirHandle;
    if (!remembered) {
      return window.showDirectoryPicker({ mode: 'readwrite', id: 'baz-type-examples' }).then(ensureWritable);
    }
    return ensureWritable(remembered).then(null, function () {
      S.dirHandle = null;
      dirForget();
      note('기억한 폴더를 쓸 수 없어 다시 선택합니다…');
      return window.showDirectoryPicker({ mode: 'readwrite', id: 'baz-type-examples' }).then(ensureWritable);
    });
  }
  function forgetDirectory() {
    if (S.busy) return;
    S.dirHandle = null;
    dirForget();
    note('기억한 저장소 폴더를 지웠습니다. 다음 저장 때 다시 선택합니다.');
    syncButtons();
  }

  /* ── 커밋 명령 복사 ──────────────────────────────────────────────── */
  function copyFallback(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  }
  function copyCommand() {
    if (S.busy || !S.lastCommand) return;
    var text = S.lastCommand;
    function done() { note('커밋 명령을 복사했습니다.\n' + text, 'ok'); }
    function failed() { note('복사하지 못했습니다. 아래 명령을 직접 복사해 주세요.\n' + text, 'err'); }
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { if (copyFallback(text)) done(); else failed(); });
      return;
    }
    if (copyFallback(text)) done(); else failed();
  }

  /** File System Access API — 사용자가 고른 저장소 폴더의 올바른 상대 경로에 저장한다 */
  function saveToDirectory() {
    var plan = prepare();
    if (!canPickDirectory()) throw new Error('이 브라우저는 폴더 저장을 지원하지 않습니다. "파일 다운로드"를 사용하세요.');
    setBusy(true);
    note(S.dirHandle ? '기억한 저장소 폴더를 확인하는 중…' : '저장소 최상위 폴더를 선택하세요…');
    var root = null, mediaDir = null, existing = [], remembered = !!S.dirHandle;
    return pickRoot().then(function (h) {
      root = h;
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
      /* 저장소가 맞다고 확인된 폴더만 기억한다 — 다음 저장부터는 선택 단계가 없다 */
      if (root && root !== S.dirHandle) { S.dirHandle = root; dirSave(root); }
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
        '· 새 예시 파일 ' + (plan.writes.length - existing.length) + '개'];
      if (existing.length) ask.push('· 이미 같은 내용으로 존재해 건너뛰는 파일 ' + existing.length + '개');
      ask.push('· ' + MANIFEST_PATH + ' 덮어쓰기');
      ask.push('', '계속할까요?');
      if (typeof confirm === 'function' && !confirm(ask.join('\n'))) throw new Error('저장을 취소했습니다');
      note('예시 파일 저장 중…');
      /* ① 예시 파일 먼저, ② 검증을 통과한 index.json 은 맨 마지막에 — 중간에 실패해도 매니페스트가 깨지지 않는다 */
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
      var lines = ['저장 완료 · 새 예시 파일 ' + (plan.writes.length - existing.length) + '개 · ' + MANIFEST_PATH + ' 갱신'];
      if (existing.length) lines.push('같은 내용이라 건너뛴 파일 ' + existing.length + '개');
      if (!remembered) lines.push('이 폴더를 기억했습니다 — 다음 저장부터는 선택 없이 바로 씁니다("📂 폴더 변경"으로 해제).');
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
      /* 권한을 여기서 묻지 않는다 — 저장 버튼을 누를 때(사용자 조작 안에서) 확인한다 */
      if (canPickDirectory()) dirLoad().then(function (h) { S.dirHandle = h || null; syncButtons(); });
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
    if(S.collage)closeCollageEditor_();
    revokeAll();
    Object.keys(S.savedPreviews).forEach(function (k) {
      try { URL.revokeObjectURL(S.savedPreviews[k]); } catch (e) {}
    });
    S.savedPreviews = {};
    S.changes = {};
    S.lastCommand = '';
    S.open = false;
    S.el.back.style.display = 'none';
    note('');
  }

  var api = {
    open: open, close: close, convert: convert, convertImage: convertImage, convertVideo: convertVideo,
    convertCollage: convertCollage, encodeWebp: encodeWebp, encodeCollage: encodeCollage,
    canPickDirectory: canPickDirectory, canPublish: canPublish,
    _state: S,                                 /* 디버그용 — 대시보드는 참조하지 않는다 */
    _dir: { load: dirLoad, save: dirSave, forget: dirForget }   /* 디버그·회귀 테스트용 */
  };
  for (var pk in PURE) { if (Object.prototype.hasOwnProperty.call(PURE, pk)) api[pk] = PURE[pk]; }
  return api;
});
