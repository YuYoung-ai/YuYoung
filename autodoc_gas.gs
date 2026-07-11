/************************************************************
 * AutoDoc GAS 백엔드 (autodoc_gas.gs)
 * ----------------------------------------------------------
 * Google Sheets 를 템플릿/이력/초안 저장소로 사용합니다.
 *
 * 최초 설정:
 *   1) Apps Script 새 프로젝트에 이 파일을 붙여넣기
 *   2) setup() 을 1회 실행 → AutoDoc DB 스프레드시트 자동 생성
 *      (또는 기존 시트를 쓰려면 스크립트 속성 SHEET_ID 에 ID 입력)
 *   3) 배포 → 웹 앱 → 액세스: 모든 사용자 → /exec URL 복사
 *   4) autodoc/js/core/config.js 의 GAS_URL 에 붙여넣기
 *   ※ 코드 수정 후에는 setup() 재실행(새 탭 생성) + 새 버전 배포
 *
 * API (기존 BAZ CS 규약: GET ?action= / POST text/plain JSON)
 *   GET  ?action=ping                       → {success, ts}
 *   GET  ?action=templates                  → 활성 템플릿 메타 목록 (카탈로그)
 *   GET  ?action=templatesAll               → 전체 템플릿 전문 목록 (관리자)
 *   GET  ?action=template&id=<id>           → 템플릿 JSON 전문
 *   GET  ?action=templateHistory&id=<id>    → 버전 이력 목록
 *   GET  ?action=drafts[&status=대기]       → 초안 목록
 *   POST {action:'log', ...}                → 생성이력 기록
 *   POST {action:'templateSave', ...}       → 템플릿 저장(+이전본 스냅샷)
 *   POST {action:'templateStatus', ...}     → 활성/보관 전환
 *   POST {action:'templateRestore', ...}    → 이력 버전으로 롤백(현재본 스냅샷)
 *   POST {action:'draftSave', ...}          → 초안 제출 (승인 대기)
 *   POST {action:'draftReview', ...}        → 초안 승인/반려
 ************************************************************/

var TAB_TPL   = '템플릿';
var TAB_HIST  = '템플릿이력';
var TAB_LOG   = '생성이력';
var TAB_DRAFT = '초안';

var HEADERS = {};
HEADERS[TAB_TPL]   = ['id', '이름', '분류', '설명', '버전', '최소레벨', '상태', 'formats', 'json', '수정자', '수정일'];
HEADERS[TAB_HIST]  = ['일시', 'id', '버전', 'json', '수정자'];
HEADERS[TAB_LOG]   = ['일시', '사용자', '템플릿', '버전', '포맷'];
HEADERS[TAB_DRAFT] = ['일시', '템플릿id', '템플릿명', '버전', '작성자', 'values', '상태', '검토자', '검토일시', '의견'];

/* ── 최초 1회 실행: 스프레드시트/탭 생성 (재실행 시 누락 탭만 추가) ── */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  var ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('AutoDoc DB');
    props.setProperty('SHEET_ID', ss.getId());
  }
  Object.keys(HEADERS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(HEADERS[name]);
      sh.setFrozenRows(1);
    }
  });
  Logger.log('AutoDoc DB 준비 완료: ' + ss.getUrl());
}

function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw 'SHEET_ID 미설정 — setup() 을 먼저 실행하세요';
  return SpreadsheetApp.openById(id);
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw '탭 없음: ' + name + ' — setup() 재실행';
  return sh;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

function rows_(name) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, HEADERS[name].length).getValues();
}

/* ── GET ── */
function doGet(e) {
  var a = (e && e.parameter && e.parameter.action) || '';
  try {
    if (a === 'ping')            return json_({ success: true, ts: new Date().toISOString() });
    if (a === 'templates')       return json_({ success: true, data: listTemplates_(false) });
    if (a === 'templatesAll')    return json_({ success: true, data: listTemplates_(true) });
    if (a === 'template')        return json_({ success: true, data: getTemplate_(e.parameter.id) });
    if (a === 'templateHistory') return json_({ success: true, data: listHistory_(e.parameter.id) });
    if (a === 'drafts')          return json_({ success: true, data: listDrafts_(e.parameter.status) });
    return json_({ success: false, error: 'unknown action: ' + a });
  } catch (err) {
    return json_({ success: false, error: String(err) });
  }
}

/* ── POST (text/plain JSON — preflight 회피, 기존 규약) ── */
function doPost(e) {
  var b;
  try { b = JSON.parse((e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ success: false, error: 'invalid json' }); }
  try {
    if (b.action === 'log')             return json_(appendLog_(b));
    if (b.action === 'templateSave')    return json_(saveTemplate_(b));
    if (b.action === 'templateStatus')  return json_(setStatus_(b));
    if (b.action === 'templateRestore') return json_(restoreTemplate_(b));
    if (b.action === 'draftSave')       return json_(saveDraft_(b));
    if (b.action === 'draftReview')     return json_(reviewDraft_(b));
    return json_({ success: false, error: 'unknown action: ' + b.action });
  } catch (err) {
    return json_({ success: false, error: String(err) });
  }
}

/* ── 템플릿 목록: all=false → 활성 메타만(카탈로그) / all=true → 전문 포함(관리자) ── */
function listTemplates_(all) {
  return rows_(TAB_TPL)
    .filter(function (r) { return r[0] && (all || String(r[6]) === '활성'); })
    .map(function (r) {
      var meta = {
        id: String(r[0]), name: String(r[1]), category: String(r[2]),
        desc: String(r[3]), version: String(r[4]),
        minLevel: Number(r[5]) || 1, status: String(r[6]),
        formats: String(r[7] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean)
      };
      if (all) { try { return Object.assign(JSON.parse(r[8]), { status: meta.status }); } catch (e) { return meta; } }
      return meta;
    });
}

function getTemplate_(id) {
  var row = findTplRow_(id);
  if (!row) throw '템플릿 없음: ' + id;
  return JSON.parse(row.values[8]);
}

function findTplRow_(id) {
  var rows = rows_(TAB_TPL);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) return { rowNo: i + 2, values: rows[i] };
  }
  return null;
}

/* ── 템플릿 저장: 기존 행이 있으면 이전본을 이력 탭에 스냅샷 후 갱신 ── */
function saveTemplate_(b) {
  var tpl = (typeof b.template === 'string') ? JSON.parse(b.template) : b.template;
  if (!tpl || !tpl.id) throw 'template.id 누락';
  var sh = sheet_(TAB_TPL);
  var now = new Date();
  var row = [
    tpl.id, tpl.name || '', tpl.category || '', tpl.desc || '',
    tpl.version || '1.0.0', tpl.minLevel || 1, b.status || '활성',
    (tpl.formats || []).join(','), JSON.stringify(tpl), b.user || '', now
  ];
  var found = findTplRow_(tpl.id);
  if (found) {
    sheet_(TAB_HIST).appendRow([now, found.values[0], found.values[4], found.values[8], found.values[9]]);
    row[6] = b.status || String(found.values[6]) || '활성';   /* 상태 유지 */
    sh.getRange(found.rowNo, 1, 1, row.length).setValues([row]);
    return { success: true, updated: true, row: found.rowNo };
  }
  sh.appendRow(row);
  return { success: true, created: true };
}

/* ── 활성/보관 전환 ── */
function setStatus_(b) {
  var found = findTplRow_(b.id);
  if (!found) throw '템플릿 없음: ' + b.id;
  var sh = sheet_(TAB_TPL);
  sh.getRange(found.rowNo, 7).setValue(b.status === '보관' ? '보관' : '활성');
  sh.getRange(found.rowNo, 10).setValue(b.user || '');
  sh.getRange(found.rowNo, 11).setValue(new Date());
  return { success: true };
}

/* ── 버전 이력 (최신순) ── */
function listHistory_(id) {
  var out = [];
  rows_(TAB_HIST).forEach(function (r, i) {
    if (String(r[1]) !== String(id)) return;
    out.push({ row: i + 2, ts: String(r[0]), version: String(r[2]), user: String(r[4]) });
  });
  return out.reverse();
}

/* ── 롤백: 이력 행의 json 을 현재본으로 (현재본은 자동 스냅샷) ── */
function restoreTemplate_(b) {
  var sh = sheet_(TAB_HIST);
  var rowNo = Number(b.histRow);
  if (!rowNo || rowNo < 2 || rowNo > sh.getLastRow()) throw '이력 행 번호 오류';
  var r = sh.getRange(rowNo, 1, 1, HEADERS[TAB_HIST].length).getValues()[0];
  if (String(r[1]) !== String(b.id)) throw '이력-템플릿 불일치';
  var tpl = JSON.parse(r[3]);
  return saveTemplate_({ template: tpl, user: b.user || '', status: null });
}

/* ── 초안 제출 ── */
function saveDraft_(b) {
  sheet_(TAB_DRAFT).appendRow([
    new Date(), b.template || '', b.name || '', b.version || '',
    b.user || '', JSON.stringify(b.values || {}), '대기', '', '', ''
  ]);
  return { success: true };
}

/* ── 초안 목록 (최신순, status 필터 선택) ── */
function listDrafts_(status) {
  var out = [];
  rows_(TAB_DRAFT).forEach(function (r, i) {
    if (status && String(r[6]) !== String(status)) return;
    out.push({ row: i + 2, ts: String(r[0]), template: String(r[1]), name: String(r[2]),
               version: String(r[3]), user: String(r[4]), values: String(r[5]),
               status: String(r[6]), reviewer: String(r[7]), comment: String(r[9]) });
  });
  return out.reverse();
}

/* ── 초안 승인/반려 ── */
function reviewDraft_(b) {
  var sh = sheet_(TAB_DRAFT);
  var rowNo = Number(b.row);
  if (!rowNo || rowNo < 2 || rowNo > sh.getLastRow()) throw '초안 행 번호 오류';
  sh.getRange(rowNo, 7, 1, 4).setValues([[
    b.status === '승인' ? '승인' : '반려', b.reviewer || '', new Date(), b.comment || ''
  ]]);
  return { success: true };
}

/* ── 생성 이력 ── */
function appendLog_(b) {
  sheet_(TAB_LOG).appendRow([
    new Date(), b.user || '', b.template || '', b.version || '', b.format || ''
  ]);
  return { success: true };
}
