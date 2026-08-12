/*******************************************************************
 * baz-history-api.js — 처리 이력 편집 저장 (BazHistoryApi)
 * -----------------------------------------------------------------
 * 왜 분리했나
 *   관리자(레벨2) 인증까지 받은 이력 편집이 localStorage('baz_hosp_history')
 *   에만 저장됐다. 저장한 사람의 브라우저에서만 보이고, 그 로컬 값이 이후
 *   서버 이력(applyIssueHist)을 매번 덮어써서 다른 사람이 고친 최신 이력이
 *   그 PC 에서는 영영 안 보였다. 편집이 '이 기기'에 갇혀 있다는 사실도
 *   토스트 문구('저장되었습니다 (이 기기)')에만 있었다.
 *   → 서버(handover_gas.gs history_save)에 저장하는 경로로 바꾸고,
 *      localStorage 는 "서버 저장 전 임시 초안" 으로만 쓴다.
 *
 * 여기서는 순수 로직(정규화·페이로드·응답 분류·초안 저장)만 담당한다.
 * 실제 전송은 호출부(hospital-pc.html)가 기존 fetch 계층으로 한다.
 *
 * 브라우저: <script src="js/baz-history-api.js"></script> → window.BazHistoryApi
 * 테스트  : require('../js/baz-history-api.js')
 *******************************************************************/
(function (root, factory) {
  var api = factory();
  root.BazHistoryApi = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* 서버(handover_gas.gs HIST_FIELDS)와 반드시 같아야 하는 허용 목록.
     여기에 없는 필드는 클라이언트에서 이미 버린다(서버도 한 번 더 버린다). */
  var ALLOWED_FIELDS = ['d', 't', 'pt', 'sy', 'f', 'pay', 'm', 'fx', 'p'];
  var MAX_RECORDS = 300;      // 한 병원 이력 상한
  var MAX_LEN = 2000;         // 한 필드 길이 상한
  var TYPES = ['점검', 'A/S'];

  var LEGACY_KEY = 'baz_hosp_history';       // 구버전: 서버를 덮어쓰던 로컬 편집본
  var DRAFT_KEY = 'baz_hosp_history_draft';  // 신버전: 서버 저장 전 임시 초안

  function text(v) {
    if (v == null) return '';
    if (typeof v === 'boolean') return '';
    return String(v).trim().slice(0, MAX_LEN);
  }

  function normDate(v) {
    var s = text(v);
    var m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (!m) return '';
    return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  }

  /**
   * 편집 폼에서 모은 값 → 저장 가능한 이력 배열.
   * · 허용 목록 밖 필드 제거 · 빈 값 필드 제거 · 날짜 정규화
   * · 내용이 아무것도 없는 행 제거 · 날짜 내림차순 · 상한 적용
   */
  function sanitizeRecords(records) {
    var out = [];
    (Array.isArray(records) ? records : []).forEach(function (r) {
      if (!r || typeof r !== 'object') return;
      var rec = {};
      ALLOWED_FIELDS.forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(r, k)) return;
        var v = (k === 'd') ? normDate(r[k]) : text(r[k]);
        if (v) rec[k] = v;
      });
      if (rec.t && TYPES.indexOf(rec.t) < 0) rec.t = (rec.t.indexOf('점검') >= 0) ? '점검' : 'A/S';
      if (!rec.d && !rec.sy && !rec.m && !rec.fx) return;   // 빈 행
      out.push(rec);
    });
    out.sort(function (a, b) { return String(b.d || '').localeCompare(String(a.d || '')); });
    return out.slice(0, MAX_RECORDS);
  }

  /** 서버로 보낼 POST 본문 */
  function buildPayload(o) {
    o = o || {};
    return {
      action: 'history_save',
      hosp: text(o.hosp),
      records: sanitizeRecords(o.records),
      who: text(o.who),
      baseRev: Number(o.baseRev) || 0,
      token: o.token || ''
    };
  }

  /**
   * 서버 응답 분류. 화면이 "성공했다"고 표시해도 되는 경우는 ok===true 뿐이다.
   * @returns {{ok:boolean, conflict:boolean, unauthorized:boolean, error:string,
   *            records:Array|null, rev:number, updatedAt:string, updatedBy:string}}
   */
  function classifyResponse(d) {
    var res = {
      ok: false, conflict: false, unauthorized: false, error: '',
      records: null, rev: 0, updatedAt: '', updatedBy: ''
    };
    if (!d || typeof d !== 'object') { res.error = 'bad-response'; return res; }
    res.rev = Number(d.rev) || 0;
    res.updatedAt = text(d.updatedAt);
    res.updatedBy = text(d.updatedBy);
    if (Array.isArray(d.records)) res.records = d.records;
    if (d.success === true) { res.ok = true; return res; }
    var err = String(d.error || '');
    if (d.conflict === true || /conflict/i.test(err)) { res.conflict = true; res.error = err || 'conflict'; return res; }
    if (/unauthorized|권한|토큰|로그인/i.test(err)) { res.unauthorized = true; res.error = err || 'unauthorized'; return res; }
    res.error = err || 'server-error';
    return res;
  }

  /* ── 초안(localStorage) ────────────────────────────────────────────
     서버 저장이 성공하기 전까지만 유지한다. 서버 응답을 덮어쓰는 용도가 아니다. */
  function readJson(storage, key) {
    try {
      var s = storage && storage.getItem(key);
      if (!s) return null;
      var o = JSON.parse(s);
      return (o && typeof o === 'object') ? o : null;
    } catch (e) { return null; }
  }
  function writeJson(storage, key, obj) {
    try { storage.setItem(key, JSON.stringify(obj)); return true; } catch (e) { return false; }
  }

  function saveDraft(storage, hosp, records) {
    var all = readJson(storage, DRAFT_KEY) || {};
    all[hosp] = { records: sanitizeRecords(records), at: Date.now() };
    return writeJson(storage, DRAFT_KEY, all);
  }
  function readDraft(storage, hosp) {
    var all = readJson(storage, DRAFT_KEY) || {};
    var d = all[hosp];
    return (d && Array.isArray(d.records)) ? d : null;
  }
  function clearDraft(storage, hosp) {
    var all = readJson(storage, DRAFT_KEY);
    if (!all || !Object.prototype.hasOwnProperty.call(all, hosp)) return false;
    delete all[hosp];
    return writeJson(storage, DRAFT_KEY, all);
  }
  function draftNames(storage) {
    var all = readJson(storage, DRAFT_KEY) || {};
    return Object.keys(all);
  }

  /**
   * 구버전 로컬 편집본 마이그레이션.
   * baz_hosp_history 는 서버 이력을 덮어쓰던 값이라 그대로 두면 안 된다.
   * 지우지도 않는다 — 아직 서버에 없는 편집일 수 있으므로 "초안"으로 옮겨
   * 사용자가 확인 후 서버에 반영하거나 버릴 수 있게 한다.
   * @returns {{migrated:number, names:string[]}}
   */
  function migrateLegacyDrafts(storage) {
    var legacy = readJson(storage, LEGACY_KEY);
    if (!legacy) return { migrated: 0, names: [] };
    var drafts = readJson(storage, DRAFT_KEY) || {};
    var names = [];
    Object.keys(legacy).forEach(function (name) {
      if (!Array.isArray(legacy[name])) return;
      // 이미 초안이 있으면 덮지 않는다(더 최근 편집을 잃지 않게)
      if (Object.prototype.hasOwnProperty.call(drafts, name)) return;
      drafts[name] = { records: sanitizeRecords(legacy[name]), at: 0, legacy: true };
      names.push(name);
    });
    if (!writeJson(storage, DRAFT_KEY, drafts)) return { migrated: 0, names: [] };
    try { storage.removeItem(LEGACY_KEY); } catch (e) { /* 지우지 못해도 초안은 이미 옮겨졌다 */ }
    return { migrated: names.length, names: names };
  }

  return {
    ALLOWED_FIELDS: ALLOWED_FIELDS,
    MAX_RECORDS: MAX_RECORDS,
    MAX_LEN: MAX_LEN,
    LEGACY_KEY: LEGACY_KEY,
    DRAFT_KEY: DRAFT_KEY,
    sanitizeRecords: sanitizeRecords,
    buildPayload: buildPayload,
    classifyResponse: classifyResponse,
    saveDraft: saveDraft,
    readDraft: readDraft,
    clearDraft: clearDraft,
    draftNames: draftNames,
    migrateLegacyDrafts: migrateLegacyDrafts
  };
});
