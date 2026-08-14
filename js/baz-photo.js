/************************************************************
 * baz-photo.js — 사진 압축 · 동시 실행 제한 · 식별자
 * ----------------------------------------------------------
 * 왜 필요한가:
 *  · 예전 압축은 `canvas.toDataURL('image/jpeg', 0.82)` 고정이었다. 원본이 크면
 *    결과도 그대로 커져 한 요청에 실려 나갔고, 작으면 불필요하게 화질을 깎았다.
 *    → 목표 용량을 정하고 품질을 단계적으로 낮춰 그 선에 맞춘다.
 *  · dataURL 은 base64 라 실제 바이트보다 약 1.33배 크다. 가능한 곳에서는
 *    toBlob() + Object URL 을 써서 브라우저 메모리 사용을 줄인다.
 *  · 사진 여러 장을 한꺼번에 올리면 회선·GAS 실행 슬롯을 다 잡아먹는다.
 *    → pool() 로 동시 실행을 제한하고, 성공한 항목은 재시도에서 건너뛴다.
 *
 * ES5 호환(빌드 없음). 브라우저는 window.BazPhoto, Node 는 module.exports.
 * ※ index.html 은 이 모듈을 쓰지 않는다(1차 범위 제외 — 회귀 위험).
 ************************************************************/
(function (root, factory) {
  var api = factory();
  root.BazPhoto = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /* 용도별 압축 기준.
     S/N 라벨은 글자를 읽을 수 있어야 해서 더 크게, 원인 사진은 상황 파악이
     목적이라 더 작게 잡는다. */
  var PRESET = {
    SN:    { maxDim: 1600, targetBytes: 900 * 1024, softBytes: 600 * 1024, minQuality: 0.58 },
    CAUSE: { maxDim: 1280, targetBytes: 700 * 1024, softBytes: 400 * 1024, minQuality: 0.58 }
  };
  /* 품질 하강 계단 — 첫 시도가 목표 안에 들면 더 내려가지 않는다 */
  var QUALITY_STEPS = [0.90, 0.82, 0.74, 0.66, 0.58];
  var MAX_CAUSE = 5;

  function preset(kind) {
    return (String(kind || '').toUpperCase() === 'SN') ? PRESET.SN : PRESET.CAUSE;
  }

  /** dataURL 의 실제 바이트 수(base64 → 원본) */
  function dataUrlBytes(dataUrl) {
    var s = String(dataUrl || '');
    var at = s.indexOf(',');
    if (at < 0) return 0;
    var b64 = s.slice(at + 1);
    var pad = 0;
    if (b64.charAt(b64.length - 1) === '=') pad++;
    if (b64.charAt(b64.length - 2) === '=') pad++;
    return Math.max(0, Math.floor(b64.length * 3 / 4) - pad);
  }

  /** 긴 변을 maxDim 에 맞춘 크기(확대하지 않음) */
  function fitSize(w, h, maxDim) {
    if (!(w > 0 && h > 0)) return { w: 0, h: 0 };
    var m = Math.max(w, h);
    if (m <= maxDim) return { w: w, h: h };
    var r = maxDim / m;
    return { w: Math.max(1, Math.round(w * r)), h: Math.max(1, Math.round(h * r)) };
  }

  /**
   * 목표 용량 기반 품질 선택(순수 함수 — 테스트 대상).
   * measure(quality) 가 그 품질에서의 바이트 수를 돌려준다.
   * softBytes 이하가 되면 즉시 채택하고, 끝까지 targetBytes 를 못 맞추면
   * 마지막(가장 낮은) 품질을 쓰되 over:true 로 알린다.
   */
  function chooseQuality(measure, opt) {
    var o = opt || {};
    var target = Number(o.targetBytes) || PRESET.CAUSE.targetBytes;
    var soft = Number(o.softBytes) || Math.round(target * 0.7);
    var minQ = Number(o.minQuality) || 0.58;
    var steps = (o.steps || QUALITY_STEPS).filter(function (q) { return q >= minQ; });
    if (!steps.length) steps = [minQ];
    var best = null, tried = [];
    for (var i = 0; i < steps.length; i++) {
      var q = steps[i];
      var bytes = measure(q);
      tried.push({ quality: q, bytes: bytes });
      best = { quality: q, bytes: bytes, over: bytes > target };
      if (bytes <= soft) return { quality: q, bytes: bytes, over: false, tried: tried, reason: 'soft' };
      if (bytes <= target) return { quality: q, bytes: bytes, over: false, tried: tried, reason: 'target' };
    }
    best.tried = tried;
    best.reason = 'min-quality';
    return best;
  }

  /** 목표를 못 맞췄을 때 한 번 더 줄일 크기 (0.85배) */
  function shrinkDim(maxDim) { return Math.max(320, Math.round(maxDim * 0.85)); }

  /* ── 브라우저 전용 구간 ─────────────────────────────────────────────── */

  function canUseDom() {
    return typeof document !== 'undefined' && typeof Image !== 'undefined';
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () {
        try { URL.revokeObjectURL(url); } catch (e) {}
        reject(new Error('이미지를 불러올 수 없습니다 (HEIC면 "가장 호환성 높게" 촬영 권장)'));
      };
      img.src = url;
    });
  }

  function drawTo(img, w, h) {
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';          /* PNG 투명 → JPEG 검정 방지 */
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  }

  function canvasJpeg(canvas, quality) {
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) {
        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error('사진 압축 결과를 만들지 못했습니다')); return; }
          resolve({ blob: blob, bytes: blob.size, quality: quality, dataUrl: '' });
        }, 'image/jpeg', quality);
        return;
      }
      /* 구형 브라우저 폴백 — 이 경로에서만 dataURL 을 즉시 만든다. */
      try {
        var url = canvas.toDataURL('image/jpeg', quality);
        resolve({ blob: null, bytes: dataUrlBytes(url), quality: quality, dataUrl: url });
      } catch (e) { reject(e); }
    });
  }

  function blobDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error || new Error('압축 사진을 읽지 못했습니다')); };
      r.readAsDataURL(blob);
    });
  }

  /**
   * 파일 → 목표 용량에 맞춘 JPEG dataURL.
   * 반환 {dataUrl, bytes, quality, width, height, over}
   */
  function compress(file, opt) {
    var o = opt || {};
    var base = preset(o.kind);
    var maxDim = Number(o.maxDim) || base.maxDim;
    var target = Number(o.targetBytes) || base.targetBytes;
    var soft = Number(o.softBytes) || base.softBytes;
    var minQ = Number(o.minQuality) || base.minQuality;
    if (!canUseDom()) return Promise.reject(new Error('브라우저 환경이 아닙니다'));

    return loadImage(file).then(function (got) {
      function renderAt(dim) {
        var size = fitSize(got.img.width, got.img.height, dim);
        var canvas = drawTo(got.img, size.w, size.h);
        var steps = QUALITY_STEPS.filter(function (q) { return q >= minQ; });
        if (!steps.length) steps = [minQ];
        var idx = 0, last = null;
        function attempt() {
          var q = steps[idx++];
          return canvasJpeg(canvas, q).then(function (enc) {
            last = enc;
            if (enc.bytes <= soft) { enc.reason = 'soft'; enc.over = false; return enc; }
            if (enc.bytes <= target) { enc.reason = 'target'; enc.over = false; return enc; }
            if (idx < steps.length) return attempt();
            enc.reason = 'min-quality'; enc.over = true; return enc;
          });
        }
        return attempt().then(function (enc) { return { enc: enc || last, size: size }; });
      }

      return renderAt(maxDim).then(function (r) {
        if (!r.enc.over) return r;
        return renderAt(shrinkDim(maxDim)).then(function (r2) {
          return r2.enc.bytes < r.enc.bytes ? r2 : r;
        });
      }).then(function (r) {
        var data = r.enc.dataUrl ? Promise.resolve(r.enc.dataUrl) : blobDataUrl(r.enc.blob);
        return data.then(function (url) {
          return { dataUrl:url, bytes:r.enc.bytes, quality:r.enc.quality,
            width:r.size.w, height:r.size.h, over:!!r.enc.over };
        });
      }).finally(function () {
        try { URL.revokeObjectURL(got.url); } catch (e) {}
      });
    });
  }

  /* ── 동시 실행 제한 풀 ──────────────────────────────────────────────── */

  /**
   * tasks: [{key, run: function() -> Promise}]
   * 이미 성공한 key 는 done 에 담아 넘기면 실행하지 않는다(실패분만 재시도).
   * 반환 {results:{key:value}, errors:{key:error}, ran:[key]}
   */
  function pool(tasks, opt) {
    var o = opt || {};
    var limit = Math.max(1, Number(o.limit) || 2);
    var done = o.done || {};
    var list = (tasks || []).filter(function (t) { return t && !Object.prototype.hasOwnProperty.call(done, t.key); });
    var results = {}, errors = {}, ran = [];
    Object.keys(done).forEach(function (k) { results[k] = done[k]; });
    var idx = 0;

    function next() {
      if (idx >= list.length) return Promise.resolve();
      var t = list[idx++];
      ran.push(t.key);
      if (typeof o.onStart === 'function') { try { o.onStart(t.key); } catch (e) {} }
      return Promise.resolve()
        .then(function () { return t.run(); })
        .then(function (v) {
          results[t.key] = v;
          if (typeof o.onDone === 'function') { try { o.onDone(t.key, v, null); } catch (e) {} }
        }, function (e) {
          errors[t.key] = e;
          if (typeof o.onDone === 'function') { try { o.onDone(t.key, null, e); } catch (e2) {} }
        })
        .then(next);
    }

    var workers = [];
    for (var i = 0; i < Math.min(limit, list.length); i++) workers.push(next());
    return Promise.all(workers).then(function () {
      return { results: results, errors: errors, ran: ran };
    });
  }

  /* ── 식별자 ─────────────────────────────────────────────────────────── */

  function uid(prefix) {
    var p = prefix || 'p';
    try {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) return p + crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    } catch (e) {}
    return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  /** 기록 1건을 식별. 저장·savecheck·재전송까지 같은 값을 유지한다. */
  function newRecordId() { return uid('rec_'); }
  /** 사진 1장을 식별. 재시도해도 같은 값을 유지해야 Drive 중복이 생기지 않는다. */
  function newPhotoId() { return uid('ph_'); }
  /** 업로드 요청 1회의 멱등 키 */
  function newUploadReqId() { return uid('up_'); }

  return {
    PRESET: PRESET, QUALITY_STEPS: QUALITY_STEPS, MAX_CAUSE: MAX_CAUSE,
    preset: preset, dataUrlBytes: dataUrlBytes, fitSize: fitSize,
    chooseQuality: chooseQuality, shrinkDim: shrinkDim,
    compress: compress, pool: pool,
    uid: uid, newRecordId: newRecordId, newPhotoId: newPhotoId, newUploadReqId: newUploadReqId
  };
});
