/*******************************************************************
 * baz-handover-core.js — 현장 처리완료(handover) 순수 로직 (BazHandover)
 * -----------------------------------------------------------------
 * 왜 분리했나
 *   handover.html 의 최우선 목표는 "사용자에게 저장 성공으로 보인 내용과
 *   실제 시트·사진 기록이 정확히 일치하는 것"이다. 그런데 그 판정 로직이
 *   DOM 조작과 뒤섞여 있어 검증할 수가 없었다. 저장 성공 판정·페이로드
 *   구성·검증·dirty 비교·초안 저장처럼 "틀리면 데이터가 어긋나는" 부분만
 *   여기로 떼어내 테스트가 직접 실행한다.
 *
 * 브라우저: <script src="js/baz-handover-core.js"></script> → window.BazHandover
 * 테스트  : require('../js/baz-handover-core.js')
 *******************************************************************/
(function (root, factory) {
  var api = factory();
  root.BazHandover = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* 저장 상태 — 화면 표시와 후속 동작(복사·이어쓰기·사진 삭제)의 유일한 근거 */
  var SAVE = {
    IDLE: 'idle',
    SAVING: 'saving',       // 전송 중
    CHECKING: 'checking',   // 응답을 못 받아 savecheck 로 확인 중
    SUCCESS: 'success',     // 서버가 확인해 준 성공 — 이때만 "기록 완료"
    FAILED: 'failed',       // 서버가 실패라고 답함
    UNKNOWN: 'unknown'      // 확인 불가 — 성공으로 취급하지 않는다
  };

  /* 업무 필드(스냅샷·초안 대상). 사진 원문과 표시 전용 상태(TPL)는 제외한다. */
  var FORM_FIELDS = [
    'date', 'hosp', 'fse', 'gubun', 'eqKind', 'sn', 'snCustom',
    'verUI', 'verHP', 'hpIn', 'hpOut', 'uVer', 'wVer',
    'nozzleDate', 'nozzleReuse', 'cat', 'sub', 'subCustom', 'part', 'cost',
    'result', 'resultCustom', 'detail', 'remark',
    'nsFill', 'nsAmt', 'jet'
  ];

  var DRAFT_KEY = 'baz_handover_draft_v1';
  var MAX_CAUSE_PHOTOS = 5;      /* 서버 SNAP.MAX_CAUSE 와 같은 값이어야 한다 */
  var MAX_AFTER_PHOTOS = 1;      /* 서버 SNAP.MAX_AFTER 와 같은 값이어야 한다 */
  var MAX_LEN = { detail: 4000, remark: 2000, hosp: 120, fse: 40, photoDesc: 200 };

  function text(v) { return String(v == null ? '' : v).trim(); }

  /* ── 교체비용 ────────────────────────────────────────────────────
     "1,650,000" · "1650000원" 처럼 들어와도 숫자로 읽는다. 예전에는
     Number('1,650,000') → NaN 이라 미리보기에 'NaN원'이 찍히고,
     서버에는 그 문자열이 그대로 갔다. */
  function parseCost(v) {
    var s = text(v);
    if (!s) return { ok: true, empty: true, value: null, display: '', error: '' };
    if (/^무상$/i.test(s)) return { ok: true, empty: false, value: 0, display: '무상', error: '' };
    var t = s.replace(/[,\s원]/g, '');
    if (!/^\d+(\.\d+)?$/.test(t)) {
      return { ok: false, empty: false, value: null, display: '', error: '숫자만 입력하세요 (예: 1650000)' };
    }
    var n = Number(t);
    if (!isFinite(n) || n < 0) return { ok: false, empty: false, value: null, display: '', error: '0 이상 숫자를 입력하세요' };
    return { ok: true, empty: false, value: n, display: n.toLocaleString('ko-KR'), error: '' };
  }

  /** 미리보기용 비용 문구 — 절대 'NaN원'이 나오지 않는다 */
  function costLabel(v) {
    var c = parseCost(v);
    if (c.empty) return '';
    if (!c.ok) return '입력 확인 필요';
    return c.display + '원';
  }

  /* ── 검증 ────────────────────────────────────────────────────────
     필드 단위 결과를 돌려준다(첫 오류로 포커스·요약 표시에 사용). */
  function validate(form, opts) {
    opts = opts || {};
    var errors = [];
    function bad(field, msg) { errors.push({ field: field, msg: msg }); }

    if (!text(form.hosp)) bad('hosp', '병원명을 입력하세요');
    if (!text(form.fse)) bad('fse', '담당 FSE를 입력하세요');
    var sn = text(form.sn) === '__c' ? text(form.snCustom) : text(form.sn);
    if (!sn) bad('sn', '장비 S/N을 선택하거나 입력하세요');
    /* [v3.9] 장비 S/N 사진은 선택이다(photoRequired:false).
       사진을 요구하는 호출자만 opts.photoRequired 로 필수를 켠다.
       붙이는 중(압축·업로드)일 때 저장을 막는 규칙은 그대로다 —
       끝나지 않은 사진은 서버가 기록에 연결할 수 없다. */
    if (opts.photoRequired === true && !opts.hasPhoto) bad('snPhoto', '장비 S/N 사진을 첨부하세요');
    if (opts.photoBusy) bad('snPhoto', '사진 처리가 끝난 뒤 저장하세요');
    /* 붙였는데 업로드가 끝나지 않은 사진은 "사진 없음"과 다르다 — 그대로 저장하면
       사용자는 사진이 함께 기록된 줄 알지만 참조가 실리지 않아 조용히 사라진다. */
    if (opts.photoPending) bad('snPhoto', '업로드하지 못한 장비 S/N 사진이 있습니다 — 재시도하거나 삭제한 뒤 저장하세요');

    var c = parseCost(form.cost);
    if (!c.ok) bad('cost', '교체비용: ' + c.error);

    var d = text(form.date);
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) bad('date', '처리일자 형식을 확인하세요');

    Object.keys(MAX_LEN).forEach(function (k) {
      if (text(form[k]).length > MAX_LEN[k]) bad(k, MAX_LEN[k] + '자 이내로 입력하세요');
    });

    return { ok: errors.length === 0, errors: errors, first: errors[0] || null };
  }

  /* ── 저장 payload ────────────────────────────────────────────────
     화면 필드와 서버 저장 키를 1:1 로 맞춘다. 예전에는 payload.nozzle 하나에
     '노즐 재사용(O/X)'이 들어가고 화면의 '노즐 제조일자'는 아무 데도 가지 않았다. */
  function buildPayload(form, opts) {
    opts = opts || {};
    var c = parseCost(form.cost);
    var sn = text(form.sn) === '__c' ? text(form.snCustom) : text(form.sn);
    var sub = text(form.sub) === '__c' ? text(form.subCustom) : text(form.subLabel || form.sub);
    var result = text(form.result) === '__c' ? text(form.resultCustom) : text(form.result);
    return {
      date: text(form.date),
      hosp: text(form.hosp),
      fse: text(form.fse),
      gubun: text(form.gubun),
      eqKind: text(form.eqKind),
      cat: text(form.cat),
      type: sub,
      code: text(form.code),
      part: text(form.part),
      cost: c.empty ? '무상' : (c.ok ? String(c.value) : text(form.cost)),
      result: result,
      detail: text(form.detail).slice(0, MAX_LEN.detail),
      remark: text(form.remark).slice(0, MAX_LEN.remark),
      hpIn: text(form.hpIn), uVer: text(form.uVer),
      hpOut: text(form.hpOut), wVer: text(form.wVer),
      sn: sn,
      verUI: text(form.verUI),
      verHP: text(form.verHP),
      nozzleDate: text(form.nozzleDate),
      nozzleReuse: text(form.nozzleReuse) === 'O' ? 'O' : 'X',
      /* 하위 호환: 구버전 서버는 payload.nozzle 을 '노즐 재사용'으로 읽는다.
         신규 코드에서는 제조일자와 재사용 여부를 절대 같은 키에 담지 않는다. */
      nozzle: text(form.nozzleReuse) === 'O' ? 'O' : 'X',
      nsFill: text(form.nsFill), nsAmt: text(form.nsAmt), jet: text(form.jet),
      /* [v3.4] 신규 경로에서는 base64 를 싣지 않는다. 사진은 photo_add 로 미리 올리고
         여기서는 참조만 보낸다. Drive 파일 ID 는 클라이언트가 보내지 않는다 —
         서버가 recordId+clientPhotoId 로 사진 시트에서 직접 결정한다. */
      snPhoto: opts.photo || '',
      photos: normalizePhotoRefs(opts.photos),
      /* "이 요청에 사진을 실었다"는 선언 — 붙였는데 payload 에서 빠진 사고를 서버가 잡는다 */
      photoRequired: opts.photoRequired === true,
      reqId: text(opts.reqId),
      token: text(opts.token)
    };
  }

  /* 최종 payload 에 실을 사진 참조 정규화.
     fileId 가 섞여 들어와도 여기서 떨어뜨린다(서버가 받지 않는 계약을 클라에서도 지킨다). */
  function normalizePhotoRefs(list) {
    if (!list || !list.length) return [];
    var out = [], causes = 0, afters = 0;
    for (var i = 0; i < list.length; i++) {
      var o = list[i] || {};
      var id = text(o.clientPhotoId);
      if (!id) continue;
      /* [v3.5] 사진 구분은 SN(장비 S/N) · CAUSE(증상) · AFTER(해결 후) 세 가지다.
         예전에는 SN 이 아니면 전부 CAUSE 로 뭉갰다 — 그대로 두면 해결 후 사진이
         증상 사진으로 저장돼 리포트에서 두 장이 같은 열에 겹친다. */
      var raw = String(o.kind || '').toUpperCase();
      var kind = (raw === 'SN' || raw === 'AFTER') ? raw : 'CAUSE';
      if (kind === 'CAUSE') { causes++; if (causes > MAX_CAUSE_PHOTOS) continue; }
      if (kind === 'AFTER') { afters++; if (afters > MAX_AFTER_PHOTOS) continue; }
      out.push({
        clientPhotoId: id, kind: kind,
        seq: Math.max(1, Math.min(Number(o.seq) || 1, MAX_CAUSE_PHOTOS)),
        desc: text(o.desc).slice(0, MAX_LEN.photoDesc)
      });
    }
    return out;
  }

  /* ── 저장 결과 판정 ──────────────────────────────────────────────
     "성공으로 표시해도 되는가"를 한 곳에서만 정한다.
     opaque(no-cors) 응답이나 파싱 실패는 절대 성공이 아니다. */
  function classifySaveResult(kind, data, opts) {
    opts = opts || {};
    var out = {
      state: SAVE.UNKNOWN, row: null, photoSaved: false, photoRequired: false,
      error: '', warnings: [], savedFields: null, canClearPhoto: false, message: ''
    };
    if (kind === 'opaque') {
      out.state = SAVE.UNKNOWN;
      out.error = '응답을 확인할 수 없습니다';
      return out;
    }
    if (kind === 'timeout') { out.state = SAVE.UNKNOWN; out.error = '응답 시간 초과'; return out; }
    if (kind === 'network') { out.state = SAVE.UNKNOWN; out.error = '네트워크 오류'; return out; }
    if (kind === 'html') { out.state = SAVE.UNKNOWN; out.error = '서버가 데이터 대신 페이지를 반환'; return out; }
    if (kind !== 'json' || !data || typeof data !== 'object') {
      out.state = SAVE.UNKNOWN; out.error = '응답 형식을 해석할 수 없습니다'; return out;
    }

    var photo = (data.photo && typeof data.photo === 'object') ? data.photo : null;
    /* [v3.9] 사진은 선택이다 — 무엇을 확인해야 하는지는 요청이 정한다.
       · opts.photoSent : 이 요청이 실제로 사진을 실어 보냈는가(클라이언트가 안다)
       · photo.required : 서버가 이 요청에 사진을 요구했는가
       사진을 보낸 요청은 저장까지 확인돼야 성공이다. 구버전 GAS는 photo 블록 없이
       {success:true}만 돌려줄 수 있는데, 사진을 보냈는데 그 응답을 성공으로 받아들이면
       실제 저장 여부를 모른 채 화면 사진을 지우게 된다. */
    var photoSent = opts.photoSent === true;
    out.photoRequired = photoSent || !!(photo && photo.required === true);
    out.photoSaved = !!(photo && photo.saved);
    out.warnings = Array.isArray(data.warnings) ? data.warnings.slice() : [];
    out.savedFields = (data.savedFields && typeof data.savedFields === 'object') ? data.savedFields : null;
    out.message = text(data.msg);

    if (data.success !== true) {
      out.state = SAVE.FAILED;
      out.error = text(data.error) || (photo && text(photo.error)) || '저장 실패';
      return out;
    }
    /* 사진이 걸린 요청은 구조화된 사진 확인이 없거나 저장되지 않았으면 성공이 아니다.
       (구버전 서버의 success:true 단독 응답까지 여기서 막는다)
       사진이 없는 기록은 이 관문을 건너뛴다 — 확인할 사진이 없다. */
    if (out.photoRequired && (!photo || !out.photoSaved)) {
      out.state = SAVE.FAILED;
      out.error = (photo && text(photo.error)) ||
        (!photo ? '서버에서 사진 저장 결과를 확인할 수 없습니다 — GAS를 최신 버전으로 재배포해 주세요' :
          '사진이 저장되지 않았습니다');
      return out;
    }
    out.state = SAVE.SUCCESS;
    out.row = (typeof data.row === 'number') ? data.row : null;
    out.canClearPhoto = true;
    return out;
  }

  /** savecheck 응답 → 저장 상태 */
  function classifySaveCheck(data, opts) {
    if (!data || typeof data !== 'object' || data.success !== true) {
      return { state: SAVE.UNKNOWN, result: null };
    }
    if (!data.found) return { state: SAVE.UNKNOWN, result: null, notFound: true };
    var r = classifySaveResult('json', data.result, opts);
    return { state: r.state, result: r };
  }

  /* ── 저장 후 dirty 판정 ──────────────────────────────────────────
     저장 성공 시점의 업무 필드 스냅샷과 비교한다. 양식 표시 전환(TPL)이나
     사진 원문은 업무 데이터가 아니므로 스냅샷에 넣지 않는다. */
  function snapshot(form) {
    var o = {};
    FORM_FIELDS.forEach(function (k) { o[k] = text(form[k]); });
    return o;
  }
  function isDirty(snap, form) {
    if (!snap) return false;
    var cur = snapshot(form);
    for (var i = 0; i < FORM_FIELDS.length; i++) {
      var k = FORM_FIELDS[i];
      if ((snap[k] || '') !== (cur[k] || '')) return true;
    }
    return false;
  }
  /** 같은 내용을 다시 저장하려는가 — 중복 행 방지 */
  function isSameAsSaved(snap, form) { return !!snap && !isDirty(snap, form); }

  /* ── 병원 선택 상태 ──────────────────────────────────────────────
     선택된 병원 객체와 입력 문자열이 어긋나면 종속 필드를 초기화해야 한다.
     (A 병원을 고른 뒤 병원명을 지워도 A의 S/N·버전·이력이 남던 문제) */
  function hospKey(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase(); }
  function selectionMatches(selected, inputValue) {
    if (!selected) return false;
    return hospKey(selected.n) === hospKey(inputValue);
  }
  /** 입력이 선택과 달라졌을 때 비워야 할 항목 목록 */
  function staleDependents() {
    return ['sn', 'snCustom', 'verUI', 'verHP', 'hospMatch', 'recent'];
  }

  /* ── 요청 세대 (오래된 비동기 응답 차단) ─────────────────────────
     병원 A 조회 → B 선택 → A 응답 늦게 도착 같은 경합을 막는다. */
  function createSeq() {
    var n = 0, key = '';
    return {
      next: function (k) { n++; key = String(k == null ? '' : k); return n; },
      isCurrent: function (id, k) {
        if (id !== n) return false;
        if (k === undefined) return true;
        return String(k) === key;
      },
      current: function () { return n; },
      key: function () { return key; },
      cancel: function () { n++; key = ''; }
    };
  }

  /* ── 초안(localStorage) ──────────────────────────────────────────
     공용 PC 를 고려하지 않으므로 적극적으로 남긴다. 사진 원문은 담지 않고
     "사진 재첨부 필요"만 표시한다(용량·수명 문제). */
  function saveDraft(storage, form, extra) {
    try {
      var body = { v: 1, at: Date.now(), form: snapshot(form), hadPhoto: !!(extra && extra.hadPhoto) };
      storage.setItem(DRAFT_KEY, JSON.stringify(body));
      return true;
    } catch (e) { return false; }
  }
  function loadDraft(storage) {
    try {
      var s = storage.getItem(DRAFT_KEY);
      if (!s) return null;
      var o = JSON.parse(s);
      if (!o || !o.form || typeof o.form !== 'object') return null;
      return o;
    } catch (e) { return null; }
  }
  function clearDraft(storage) {
    try { storage.removeItem(DRAFT_KEY); return true; } catch (e) { return false; }
  }
  /** 초안이 "복원할 값이 있는가" — 빈 양식을 되살려 사용자를 놀라게 하지 않는다 */
  function draftHasContent(draft) {
    if (!draft || !draft.form) return false;
    var ignore = { date: 1, gubun: 1, eqKind: 1, nozzleReuse: 1, cat: 1, sub: 1, part: 1, result: 1 };
    return FORM_FIELDS.some(function (k) { return !ignore[k] && text(draft.form[k]); });
  }

  return {
    SAVE: SAVE,
    FORM_FIELDS: FORM_FIELDS,
    DRAFT_KEY: DRAFT_KEY,
    parseCost: parseCost,
    costLabel: costLabel,
    validate: validate,
    normalizePhotoRefs: normalizePhotoRefs,
    MAX_CAUSE_PHOTOS: MAX_CAUSE_PHOTOS,
    MAX_AFTER_PHOTOS: MAX_AFTER_PHOTOS,
    buildPayload: buildPayload,
    classifySaveResult: classifySaveResult,
    classifySaveCheck: classifySaveCheck,
    snapshot: snapshot,
    isDirty: isDirty,
    isSameAsSaved: isSameAsSaved,
    hospKey: hospKey,
    selectionMatches: selectionMatches,
    staleDependents: staleDependents,
    createSeq: createSeq,
    saveDraft: saveDraft,
    loadDraft: loadDraft,
    clearDraft: clearDraft,
    draftHasContent: draftHasContent
  };
});
