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
 *   POST {action:'ai', task, text, context} → AI 프록시 (Phase 3)
 *   POST {action:'aiTemplate', fileName, fileType, content}
 *        → 양식 텍스트 분석 → 템플릿 JSON 초안 (Phase 4 AI Template Builder)
 *
 * AI 사용 설정 (Phase 3):
 *   스크립트 속성에 ANTHROPIC_API_KEY 추가 (Claude API 키 — 클라이언트 비노출)
 *   선택: AI_MODEL (기본 claude-opus-4-8)
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
    if (b.action === 'ai')              return json_(aiCall_(b));
    if (b.action === 'aiTemplate')      return json_(aiTemplate_(b));
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

/************************************************************
 * AI 프록시 (Phase 3) — Claude API 호출
 * API 키는 스크립트 속성(ANTHROPIC_API_KEY)에만 보관합니다.
 * 요청: {action:'ai', task:'draft|summarize|proofread|translate',
 *        text:'대상 텍스트', context:{template, field, values}}
 * 응답: {success, data:{text, model}}
 ************************************************************/

/* 작업별 지시문 — {field}=입력 항목명, {template}=문서명 */
var AI_TASK_PROMPTS = {
  draft:     '아래 컨텍스트를 참고하여 "{template}" 문서의 "{field}" 항목에 들어갈 초안을 한국어로 작성하라. 보고서에 바로 붙여넣을 수 있는 간결한 개조식(- 항목) 문장으로.',
  summarize: '다음 텍스트를 "{template}" 문서의 "{field}" 항목에 적합하게 핵심만 남겨 간결하게 요약하라. 개조식을 유지하라.',
  proofread: '다음 텍스트의 맞춤법·띄어쓰기·문장을 교정하라. 의미와 형식(개조식/줄바꿈)은 유지하고 표현만 다듬어라.',
  translate: 'Translate the following Korean business report text into professional English. Keep the line structure.'
};

function aiCall_(b) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('ANTHROPIC_API_KEY');
  if (!key) throw 'ANTHROPIC_API_KEY 미설정 — 스크립트 속성에 추가하세요';
  var model = props.getProperty('AI_MODEL') || 'claude-opus-4-8';

  var tmpl = AI_TASK_PROMPTS[b.task];
  if (!tmpl) throw '지원하지 않는 AI 작업: ' + b.task;
  var ctx = b.context || {};
  var instruction = tmpl
    .replace('{template}', String(ctx.template || '문서'))
    .replace('{field}', String(ctx.field || '내용'));

  var user = instruction;
  if (ctx.values && Object.keys(ctx.values).length) {
    user += '\n\n[문서의 다른 입력값 (참고)]\n' + JSON.stringify(ctx.values);
  }
  if (b.text) user += '\n\n[대상 텍스트]\n' + b.text;

  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: model,
      max_tokens: 4096,   /* 보고서 항목 텍스트 — 의도적으로 짧은 출력 */
      system: '당신은 한국 기업의 사내 보고서 작성을 돕는 어시스턴트다. 요청된 결과 텍스트만 출력한다 — 머리말, 설명, 코드펜스, 따옴표를 붙이지 않는다.',
      messages: [{ role: 'user', content: user }]
    }),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body;
  try { body = JSON.parse(res.getContentText()); }
  catch (e) { throw 'AI 응답 파싱 실패 (HTTP ' + code + ')'; }
  if (code !== 200) throw (body.error && body.error.message) || ('AI API 오류 ' + code);
  if (body.stop_reason === 'refusal') throw 'AI가 이 요청을 거절했습니다';

  var text = '';
  (body.content || []).forEach(function (bl) { if (bl.type === 'text') text += bl.text; });
  if (!text.trim()) throw 'AI 응답이 비어 있습니다';
  return { success: true, data: { text: text.trim(), model: body.model } };
}

/************************************************************
 * AI Template Builder (Phase 4)
 * 업로드된 양식에서 추출한 텍스트를 분석해 AutoDoc 템플릿 JSON
 * 초안을 생성합니다. 산출물은 클라이언트(template-builder.js)의
 * normalize()로 한 번 더 검증·보정된 뒤 관리자 검토를 거칩니다.
 ************************************************************/

var AI_TEMPLATE_SPEC = [
  '너는 회사 양식 문서를 분석해 문서 자동화 플랫폼의 "템플릿 JSON"을 설계하는 전문가다.',
  '주어진 양식 텍스트에서 ①고정 서식(제목·표 머리글·라벨)과 ②사용자가 매번 채우는 값을 구분하고,',
  '채우는 값들을 입력 필드(inputs)로, 문서 구조를 레이아웃(layout)으로 설계하라.',
  '',
  '반드시 아래 스키마의 JSON "하나만" 출력하라 (설명·코드펜스 금지):',
  '{',
  ' "id": "영문-소문자-하이픈",',
  ' "name": "문서 이름(한국어)",',
  ' "desc": "카탈로그 한 줄 설명",',
  ' "category": "보고서|회의|품질|점검|기타",',
  ' "minLevel": 1,',
  ' "formats": ["pptx","xlsx","docx","pdf"] 중 이 양식에 적합한 것들,',
  ' "inputs": [ { "key":"영문키", "label":"한국어 라벨",',
  '   "type":"text|number|date|week|select|textarea|table",',
  '   "required":true(핵심 항목만), "placeholder":"예시(선택)",',
  '   "options":["..."](select만), "columns":[{"key","label","type","options"}](table만) } ],',
  ' "rules": [ {"if":"키.length == 0" 또는 "키 == \'\'", "warn":"안내문"} ] (0~2개),',
  ' "layout": { "grid":{"cols":12,"rows":8~14,"gap":0.1}, "pages":[{"blocks":[',
  '   {"component":"header|text|table|card|chart|footer",',
  '    "area":"행시작 / 열시작 / 행끝 / 열끝" (1~13열, 끝 미포함),',
  '    "props":{...}} ]}] }',
  '',
  '컴포넌트 props 규칙:',
  ' header: {"title","subtitle","writer","date"} · text: {"title","content"} ·',
  ' table: {"title","columns":[{"key","label","width":비율}],"rows":"@표입력키"} ·',
  ' card: {"title","value","accent":"$color.primary|accent|success"} · footer: {"text"}',
  '바인딩: "@입력키"=입력값, "@fn.today"=오늘 날짜, "@fn.currentWeek"=이번 주차.',
  '레이아웃 원칙: 1행=header 전체 폭, 마지막 행=footer 전체 폭, 표는 폭 넓게,',
  '짧은 필드(text/date/select)는 card 로 2~3개씩 한 행에, textarea 는 text 블록으로.',
  '블록의 area 는 서로 겹치지 않게 하라. 라벨·문구는 원본 양식의 한국어를 그대로 살려라.'
].join('\n');

function aiTemplate_(b) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('ANTHROPIC_API_KEY');
  if (!key) throw 'ANTHROPIC_API_KEY 미설정 — 스크립트 속성에 추가하세요';
  var model = props.getProperty('AI_MODEL') || 'claude-opus-4-8';

  var content = String(b.content || '').slice(0, 60000);
  if (!content.trim()) throw '분석할 양식 텍스트가 없습니다';

  var user = '[양식 파일] ' + (b.fileName || '') + ' (형식: ' + (b.fileType || '?') + ')\n\n' +
             '[양식에서 추출한 텍스트]\n' + content +
             '\n\n위 양식을 분석해 템플릿 JSON을 출력하라.';

  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: model,
      max_tokens: 16000,
      system: AI_TEMPLATE_SPEC,
      messages: [{ role: 'user', content: user }]
    }),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body;
  try { body = JSON.parse(res.getContentText()); }
  catch (e) { throw 'AI 응답 파싱 실패 (HTTP ' + code + ')'; }
  if (code !== 200) throw (body.error && body.error.message) || ('AI API 오류 ' + code);
  if (body.stop_reason === 'refusal') throw 'AI가 이 요청을 거절했습니다';

  var text = '';
  (body.content || []).forEach(function (bl) { if (bl.type === 'text') text += bl.text; });
  /* 혹시 붙은 코드펜스 제거 후 JSON 추출 */
  text = text.replace(/```json/gi, '```').split('```').filter(function (s) { return s.indexOf('{') >= 0; })[0] || text;
  var start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw 'AI 응답에서 JSON을 찾지 못했습니다';
  var tpl;
  try { tpl = JSON.parse(text.slice(start, end + 1)); }
  catch (e) { throw 'AI 가 생성한 템플릿 JSON 파싱 실패'; }
  return { success: true, data: tpl, model: body.model };
}
