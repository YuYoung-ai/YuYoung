/************************************************************
 * AutoDoc GAS 백엔드 (autodoc_gas.gs)
 * ----------------------------------------------------------
 * Google Sheets 를 템플릿/이력 저장소로 사용합니다.
 *
 * 최초 설정:
 *   1) Apps Script 새 프로젝트에 이 파일을 붙여넣기
 *   2) setup() 을 1회 실행 → AutoDoc DB 스프레드시트 자동 생성
 *      (또는 기존 시트를 쓰려면 스크립트 속성 SHEET_ID 에 ID 입력)
 *   3) 배포 → 웹 앱 → 액세스: 모든 사용자 → /exec URL 복사
 *   4) autodoc/js/core/config.js 의 GAS_URL 에 붙여넣기
 *
 * API (기존 BAZ CS 규약과 동일: GET ?action= / POST text/plain JSON)
 *   GET  ?action=ping                     → {success, ts}
 *   GET  ?action=templates                → 활성 템플릿 메타 목록
 *   GET  ?action=template&id=<id>         → 템플릿 JSON 전문
 *   POST {action:'log', ...}              → 생성이력 기록
 *   POST {action:'templateSave', ...}     → 템플릿 저장(+이전본 스냅샷)
 ************************************************************/

var TAB_TPL  = '템플릿';
var TAB_HIST = '템플릿이력';
var TAB_LOG  = '생성이력';

var HEADERS = {};
HEADERS[TAB_TPL]  = ['id', '이름', '분류', '설명', '버전', '최소레벨', '상태', 'formats', 'json', '수정자', '수정일'];
HEADERS[TAB_HIST] = ['일시', 'id', '버전', 'json', '수정자'];
HEADERS[TAB_LOG]  = ['일시', '사용자', '템플릿', '버전', '포맷'];

/* ── 최초 1회 실행: 스프레드시트/탭 생성 ── */
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

/* ── GET ── */
function doGet(e) {
  var a = (e && e.parameter && e.parameter.action) || '';
  try {
    if (a === 'ping')      return json_({ success: true, ts: new Date().toISOString() });
    if (a === 'templates') return json_({ success: true, data: listTemplates_() });
    if (a === 'template')  return json_({ success: true, data: getTemplate_(e.parameter.id) });
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
    if (b.action === 'log')          return json_(appendLog_(b));
    if (b.action === 'templateSave') return json_(saveTemplate_(b));
    return json_({ success: false, error: 'unknown action: ' + b.action });
  } catch (err) {
    return json_({ success: false, error: String(err) });
  }
}

/* ── 템플릿 메타 목록 (상태=활성만) ── */
function listTemplates_() {
  var sh = sheet_(TAB_TPL);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, HEADERS[TAB_TPL].length).getValues();
  return rows
    .filter(function (r) { return r[0] && String(r[6]) === '활성'; })
    .map(function (r) {
      return {
        id: String(r[0]), name: String(r[1]), category: String(r[2]),
        desc: String(r[3]), version: String(r[4]),
        minLevel: Number(r[5]) || 1,
        formats: String(r[7] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean)
      };
    });
}

/* ── 템플릿 JSON 전문 ── */
function getTemplate_(id) {
  var row = findTplRow_(id);
  if (!row) throw '템플릿 없음: ' + id;
  return JSON.parse(row.values[8]);
}

function findTplRow_(id) {
  var sh = sheet_(TAB_TPL);
  var last = sh.getLastRow();
  if (last < 2) return null;
  var rows = sh.getRange(2, 1, last - 1, HEADERS[TAB_TPL].length).getValues();
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
    sh.getRange(found.rowNo, 1, 1, row.length).setValues([row]);
    return { success: true, updated: true, row: found.rowNo };
  }
  sh.appendRow(row);
  return { success: true, created: true };
}

/* ── 생성 이력 ── */
function appendLog_(b) {
  sheet_(TAB_LOG).appendRow([
    new Date(), b.user || '', b.template || '', b.version || '', b.format || ''
  ]);
  return { success: true };
}
