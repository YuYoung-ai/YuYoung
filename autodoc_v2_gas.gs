/*************************************************************************
 * autodoc_v2_gas.gs — AutoDoc v2.5 백엔드 (신규 · v1 autodoc_gas.gs 무관)
 * =======================================================================
 * spec: docs/v2/spec/GOOGLE_APPS_SCRIPT_SPEC.md · API_SPEC.md · GOOGLE_SHEETS_SPEC.md
 * 규약: POST text/plain(프리플라이트 회피) + {action} 라우팅
 * 봉투: 요청 {action, apiVersion, token, workspaceId, requestId, payload}
 *       응답 {ok, apiVersion, requestId, payload} | {ok:false, error:{code,message,retryable}}
 *
 * ── 배포 방법 ──────────────────────────────────────────────────────────
 * 1) 새 Google Sheets 스프레드시트 1개 생성 → URL의 /d/<여기가 SHEET_ID>/edit
 * 2) Apps Script 편집기(스프레드시트 '확장 프로그램 > Apps Script' 또는 새 프로젝트)에
 *    이 파일 내용을 붙여넣기
 * 3) 프로젝트 설정 > 스크립트 속성(Script Properties)에 추가:
 *      SHEET_ID   = 위 스프레드시트 ID (필수)
 *      API_VERSION= 1 (선택)
 *      ADMIN_LEVEL= 2 (선택, 이 레벨 이상이면 관리자)
 *      REQUIRE_AUTH = false  ← 초기 테스트용. 실제 운영 시 true 로 바꾸고 AUTH_URL 설정
 *      AUTH_URL   = (선택) v1 인증 Apps Script /exec — REQUIRE_AUTH=true 일 때 토큰 검증에 사용
 * 4) 편집기에서 함수 `setup` 1회 실행 → 시트 탭 자동 생성 (권한 승인)
 * 5) 배포 > 새 배포 > 유형: 웹 앱 / 실행: 나 / 액세스: 모든 사용자 → /exec URL 복사
 * 6) 그 /exec URL 을 알려주세요 → v2 CONFIG.GAS_URL 에 연결합니다.
 *************************************************************************/

var PROP = PropertiesService.getScriptProperties();
function cfg_(k, d) { var v = PROP.getProperty(k); return (v === null || v === undefined || v === '') ? d : v; }
function apiVersion_() { return Number(cfg_('API_VERSION', '1')); }
function adminLevel_() { return Number(cfg_('ADMIN_LEVEL', '2')); }

/* 컬렉션 = 시트 탭. json 1행 방식 (GOOGLE_SHEETS_SPEC).
   append: 수정 없이 행 추가만 / asset: 같은 id 새 version 행 추가, 구 행 불변. */
var COLLECTIONS = {
  Templates: { asset: true }, Golden: { asset: true }, Prompts: { asset: true },
  DNA: { asset: true }, KB: { asset: false }, Memory: { asset: false }, Rules: { asset: true },
  Learning: { asset: false }, History: { append: true }, Drafts: { asset: false },
  Audit: { append: true }, Workspace: { asset: false }, _Requests: { append: true }
};
var HEADERS = ['id', 'ver', 'updatedAt', 'workspaceId', 'json'];

/* 액션 → 필요 역할 (permission table). 없으면 'user'. */
var PERMS = {
  'v2.bootstrap': 'user',
  'v2.template.list': 'user', 'v2.template.get': 'user',
  'v2.template.save': 'admin', 'v2.template.publish': 'admin', 'v2.golden.designate': 'admin',
  'v2.prompt.list': 'admin', 'v2.prompt.save': 'admin', 'v2.prompt.stats': 'admin',
  'v2.import.submit': 'admin',
  'v2.learning.queue': 'admin', 'v2.learning.decide': 'admin',
  'v2.dna.get': 'user', 'v2.dna.snapshot': 'user',
  'v2.kb.list': 'user', 'v2.kb.decide': 'admin', 'v2.kb.merge': 'admin',
  'v2.memory.suggest': 'user', 'v2.memory.feedback': 'user',
  'v2.history.record': 'user', 'v2.history.list': 'user',
  'v2.draft.sync': 'user', 'v2.draft.list': 'user',
  'v2.settings.get': 'user', 'v2.settings.set': 'admin',
  'v2.backup.export': 'admin', 'v2.backup.restore': 'admin'
};

/* ── 엔트리 ──────────────────────────────────────────────────────────── */
function doGet() { return json_({ ok: true, service: 'autodoc-v2', apiVersion: apiVersion_() }); }

function doPost(e) {
  var req = {};
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return err_('E-SCHEMA-JSON', 'JSON 파싱 실패', false, null); }

  var requestId = req.requestId || null;
  try {
    // 버전 협상
    if (req.apiVersion && Number(req.apiVersion) > apiVersion_())
      return err_('E-VERSION', '앱 업데이트가 필요합니다', false, requestId);

    // 멱등: 같은 requestId 재수신이면 이전 결과 반환
    if (requestId) {
      var prev = idemGet_(requestId);
      if (prev) return json_(prev);
    }

    // 인증·권한
    var session = verifyToken_(req.token);
    var need = PERMS[req.action] || 'user';
    if (need === 'admin' && session.role !== 'admin')
      return audit_(session, req, err_('E-PERM-ROLE', '권한이 없습니다', false, requestId), true);

    var handler = ROUTER[req.action];
    if (!handler) return err_('E-NOTFOUND', '알 수 없는 action: ' + req.action, false, requestId);

    var ws = req.workspaceId || 'default';
    var payload = handler(req.payload || {}, { session: session, ws: ws });

    var res = { ok: true, apiVersion: apiVersion_(), requestId: requestId, payload: payload };
    if (requestId) idemPut_(requestId, res);
    return json_(res);
  } catch (ex) {
    var code = (ex && ex.appCode) || 'E-INTERNAL';
    return err_(code, String((ex && ex.message) || ex), code === 'E-INTERNAL', requestId);
  }
}

/* ── 인증 ────────────────────────────────────────────────────────────── */
function verifyToken_(token) {
  var require = String(cfg_('REQUIRE_AUTH', 'false')) === 'true';
  if (!require) {
    // 초기 테스트 모드: 토큰 유무와 무관하게 관리자 세션 (운영 전 REQUIRE_AUTH=true 로 잠그세요)
    return { userId: 'dev', level: adminLevel_(), role: 'admin' };
  }
  if (!token) throw appErr_('E-AUTH-EXPIRED', '로그인이 필요합니다');
  var authUrl = cfg_('AUTH_URL', '');
  if (!authUrl) throw appErr_('E-AUTH-EXPIRED', 'AUTH_URL 미설정');
  var level = 0, userId = null;
  try {
    // GAS→GAS 는 POST 시 302 redirect 에서 본문이 유실되므로 반드시 GET
    // (inspection_gas 와 동일 패턴). 인증 서버 액션명은 'verify'.
    var r = UrlFetchApp.fetch(
      authUrl + '?action=verify&token=' + encodeURIComponent(String(token)),
      { method: 'get', muteHttpExceptions: true, followRedirects: true });
    var body = JSON.parse(r.getContentText() || '{}');
    if (body && (body.ok || body.valid)) { level = Number(body.level || 0); userId = body.name || body.userId || null; }
  } catch (err) { /* 실패 = 미인증 */ }
  if (level <= 0) throw appErr_('E-AUTH-EXPIRED', '토큰 검증 실패');
  return { userId: userId, level: level, role: (level >= adminLevel_() ? 'admin' : 'user') };
}

/* ── 라우터 (핸들러) ─────────────────────────────────────────────────── */
var ROUTER = {
  'v2.bootstrap': function (p, ctx) {
    return {
      workspaceId: ctx.ws,
      apiVersion: apiVersion_(),
      role: ctx.session.role,
      templates: repoList_('Templates', ctx.ws, true),
      golden: repoList_('Golden', ctx.ws, true),
      settings: repoGet_('Workspace', 'settings', ctx.ws) || {},
      dnaVersion: (repoLatest_('DNA', ctx.ws) || {}).ver || 0
    };
  },

  'v2.template.list': function (p, ctx) { return { items: repoList_('Templates', ctx.ws, true) }; },
  'v2.template.get': function (p, ctx) { return repoGet_('Templates', p.id, ctx.ws, p.version); },
  'v2.template.save': function (p, ctx) { return repoPutAsset_('Templates', p.record, ctx); },
  'v2.template.publish': function (p, ctx) { return repoPutAsset_('Templates', p.record, ctx); },
  'v2.golden.designate': function (p, ctx) { return repoPutAsset_('Golden', p.record, ctx); },

  'v2.prompt.list': function (p, ctx) { return { items: repoList_('Prompts', ctx.ws, true) }; },
  'v2.prompt.save': function (p, ctx) { return repoPutAsset_('Prompts', p.record, ctx); },
  'v2.prompt.stats': function (p, ctx) { return repoPut_('Prompts', p.record, ctx); },

  'v2.import.submit': function (p, ctx) {
    // analysis 봉투 접수 → Learning 대기 레코드 생성 (검증은 클라 Import Gate가 1차 수행)
    var rec = { id: 'lp-' + uid_(), status: 'proposed', grade: p.grade || 'review', analysis: p.analysis || p };
    return repoAppendId_('Learning', rec, ctx);
  },
  'v2.learning.queue': function (p, ctx) {
    var items = repoList_('Learning', ctx.ws, false).filter(function (r) { return r.status === 'proposed'; });
    if (p.grade) items = items.filter(function (r) { return r.grade === p.grade; });
    return { items: items };
  },
  'v2.learning.decide': function (p, ctx) {
    var rec = repoGet_('Learning', p.id, ctx.ws);
    if (!rec) throw appErr_('E-NOTFOUND', '제안 없음');
    rec.status = p.decision || 'approved'; rec.decidedBy = ctx.session.userId; rec.reason = p.reason || '';
    if (p.correction) rec.correction = p.correction;
    repoPut_('Learning', rec, ctx);
    // 승인분만 대상 저장소 반영 (I2)
    if (rec.status === 'approved' || rec.status === 'corrected') applyLearning_(rec, ctx);
    return rec;
  },

  'v2.dna.get': function (p, ctx) { return repoLatest_('DNA', ctx.ws) || { ver: 0, json: {} }; },
  'v2.dna.snapshot': function (p, ctx) { return repoGet_('DNA', p.id || 'dna', ctx.ws, p.version); },

  'v2.kb.list': function (p, ctx) { return { items: repoList_('KB', ctx.ws, false) }; },
  'v2.kb.decide': function (p, ctx) { var r = p.record; r.status = p.decision || 'active'; return repoPut_('KB', r, ctx); },
  'v2.kb.merge': function (p, ctx) {
    var into = repoGet_('KB', p.intoId, ctx.ws); if (!into) throw appErr_('E-NOTFOUND', '대상 용어 없음');
    into.synonyms = (into.synonyms || []).concat(p.synonyms || []);
    var from = repoGet_('KB', p.termId, ctx.ws); if (from) { from.status = 'merged'; from.mergedInto = p.intoId; repoPut_('KB', from, ctx); }
    return repoPut_('KB', into, ctx);
  },

  'v2.memory.suggest': function (p, ctx) { return { items: repoList_('Memory', ctx.ws, false).filter(function (m) { return m.field === p.field; }) }; },
  'v2.memory.feedback': function (p, ctx) { return { ok: true }; },

  'v2.history.record': function (p, ctx) { return repoAppendId_('History', p.record || p, ctx); },
  'v2.history.list': function (p, ctx) { return { items: repoList_('History', ctx.ws, false).slice(0, 200) }; },

  'v2.draft.sync': function (p, ctx) {
    var r = p.record || p; r.id = r.id || (r.templateId + '::' + (r.draftId || 'current')); r.userId = ctx.session.userId;
    return repoPut_('Drafts', r, ctx);
  },
  'v2.draft.list': function (p, ctx) {
    // 'dev' = REQUIRE_AUTH=false 시절(파일럿 초기) 저장분 — 인증 전환 후에도 보이게 유지
    return { items: repoList_('Drafts', ctx.ws, false).filter(function (d) { return d.userId === ctx.session.userId || d.userId === 'dev'; }) };
  },

  'v2.settings.get': function (p, ctx) { return repoGet_('Workspace', p.key || 'settings', ctx.ws) || {}; },
  'v2.settings.set': function (p, ctx) { var r = p.record || p; r.id = p.key || 'settings'; return repoPut_('Workspace', r, ctx); },

  'v2.backup.export': function (p, ctx) {
    var out = {}; Object.keys(COLLECTIONS).forEach(function (t) { if (t !== '_Requests' && t !== 'Audit') out[t] = repoList_(t, ctx.ws, false); });
    return { backup: out, at: new Date().toISOString() };
  },
  'v2.backup.restore': function (p, ctx) {
    var b = p.backup || {}; var n = 0;
    Object.keys(b).forEach(function (t) { if (!COLLECTIONS[t]) return; (b[t] || []).forEach(function (rec) { repoPut_(t, rec, ctx); n++; }); });
    return { restored: n };
  }
};

/* 승인된 학습을 대상 저장소에 반영 (개념) — analysis.target 이 있으면 그 컬렉션에 upsert */
function applyLearning_(rec, ctx) {
  try {
    var t = rec.analysis && rec.analysis.target;
    if (t && t.store && COLLECTIONS[capitalize_(t.store)]) {
      // 간단화: DNA 등은 새 버전 append
      var coll = capitalize_(t.store);
      var latest = repoLatest_(coll, ctx.ws) || { ver: 0, json: {} };
      var jsonObj = latest.json || {};
      if (t.path) setPath_(jsonObj, t.path, rec.correction ? rec.correction.after : (t.after !== undefined ? t.after : rec.analysis.after));
      repoPutAsset_(coll, { id: coll.toLowerCase(), ver: (latest.ver || 0) + 1, json: jsonObj }, ctx);
    }
  } catch (e) { /* 반영 실패는 무시 (제안은 승인 상태 유지) */ }
}

/* ── Repo (Sheets json 1행) ──────────────────────────────────────────── */
function ss_() { var id = cfg_('SHEET_ID', ''); if (!id) throw appErr_('E-INTERNAL', 'SHEET_ID 미설정'); return SpreadsheetApp.openById(id); }
function sheet_(tab) {
  var s = ss_().getSheetByName(tab);
  if (!s) { s = ss_().insertSheet(tab); s.appendRow(HEADERS); }
  return s;
}
function rowsToObjs_(tab) {
  var s = sheet_(tab); var vals = s.getDataRange().getValues(); if (vals.length < 2) return [];
  var head = vals[0]; var ji = head.indexOf('json');
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    try { var o = JSON.parse(vals[i][ji] || '{}'); o.__row = i + 1; out.push(o); } catch (e) {}
  }
  return out;
}
function repoList_(tab, ws, latestOnly) {
  var all = rowsToObjs_(tab).filter(function (o) { return !ws || !o.workspaceId || o.workspaceId === ws; });
  if (!latestOnly) return all;
  var byId = {}; all.forEach(function (o) { var k = o.id; if (!byId[k] || (o.ver || 0) >= (byId[k].ver || 0)) byId[k] = o; });
  return Object.keys(byId).map(function (k) { return byId[k]; });
}
function repoGet_(tab, id, ws, version) {
  var all = rowsToObjs_(tab).filter(function (o) { return o.id === id && (!ws || !o.workspaceId || o.workspaceId === ws); });
  if (version != null) return all.filter(function (o) { return String(o.ver) === String(version); })[0] || null;
  return all.sort(function (a, b) { return (b.ver || 0) - (a.ver || 0); })[0] || null;
}
function repoLatest_(tab, ws) { var l = repoList_(tab, ws, true); return l.sort(function (a, b) { return (b.ver || 0) - (a.ver || 0); })[0] || null; }

function writeRow_(tab, rec, ctx, upsert) {
  var s = sheet_(tab);
  rec.workspaceId = rec.workspaceId || ctx.ws;
  rec.updatedAt = new Date().toISOString();
  var row = [rec.id, rec.ver || '', rec.updatedAt, rec.workspaceId, JSON.stringify(rec)];
  if (upsert) {                                // 같은 id 행이 있으면 그 자리를 갱신(append 금지 — 상태 전이 엔티티)
    var cur = repoGet_(tab, rec.id, ctx.ws);
    if (cur && cur.__row) { s.getRange(cur.__row, 1, 1, HEADERS.length).setValues([row]); auditWrite_(tab, rec, ctx); return rec; }
  }
  s.appendRow(row);
  auditWrite_(tab, rec, ctx);
  return rec;
}
function repoPut_(tab, rec, ctx) {           // upsert: 같은 id 는 제자리 갱신 (Learning/KB/Drafts/Workspace 등)
  var lock = LockService.getScriptLock(); lock.tryLock(15000);
  try { return writeRow_(tab, rec, ctx, true); } finally { lock.releaseLock(); }
}
function repoPutAsset_(tab, rec, ctx) {       // 버전 불변: 새 ver 행 추가 (Templates/Golden/DNA/Prompts)
  var lock = LockService.getScriptLock(); lock.tryLock(15000);
  try {
    if (rec.ver == null) { var cur = repoGet_(tab, rec.id, ctx.ws); rec.ver = (cur && cur.ver ? cur.ver : 0) + 1; }
    return writeRow_(tab, rec, ctx, false);
  } finally { lock.releaseLock(); }
}
function repoAppendId_(tab, rec, ctx) { rec.id = rec.id || uid_(); rec.at = rec.at || new Date().toISOString(); return repoPut_(tab, rec, ctx); }

/* ── Audit (append-only 해시 체인) ──────────────────────────────────── */
function auditWrite_(tab, rec, ctx) {
  if (tab === 'Audit' || tab === '_Requests') return;
  try {
    var s = sheet_('Audit');
    var prevHash = PROP.getProperty('AUDIT_LAST_HASH') || '';
    var entry = { id: 'au-' + uid_(), at: new Date().toISOString(), actor: (ctx.session && ctx.session.userId) || 'system',
      action: tab + '.write', target: { store: tab, id: rec.id, ver: rec.ver || null }, ws: ctx.ws, prevHash: prevHash };
    var hash = hash_(prevHash + JSON.stringify(entry)); entry.hash = hash;
    s.appendRow([entry.id, '', entry.at, ctx.ws, JSON.stringify(entry)]);
    PROP.setProperty('AUDIT_LAST_HASH', hash);
  } catch (e) {}
}
function audit_(session, req, response, denied) { // 권한 거부 기록
  try {
    var s = sheet_('Audit');
    s.appendRow(['au-' + uid_(), '', new Date().toISOString(), req.workspaceId || 'default',
      JSON.stringify({ action: req.action, actor: (session && session.userId) || null, denied: !!denied })]);
  } catch (e) {}
  return response;
}

/* ── 멱등 대장 (_Requests, 최근 7일) ─────────────────────────────────── */
function idemGet_(requestId) {
  var all = rowsToObjs_('_Requests'); for (var i = all.length - 1; i >= 0; i--) if (all[i].requestId === requestId) return all[i].res;
  return null;
}
function idemPut_(requestId, res) {
  try {
    var s = sheet_('_Requests');
    s.appendRow([requestId, '', new Date().toISOString(), res.payload && res.payload.workspaceId || 'default',
      JSON.stringify({ requestId: requestId, res: res, at: new Date().toISOString() })]);
  } catch (e) {}
}

/* ── 유틸 ────────────────────────────────────────────────────────────── */
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function err_(code, message, retryable, requestId) {
  return json_({ ok: false, apiVersion: apiVersion_(), requestId: requestId || null, error: { code: code, message: message, retryable: !!retryable } });
}
function appErr_(code, message) { var e = new Error(message); e.appCode = code; return e; }
function uid_() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function capitalize_(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }
function hash_(s) { var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s); return b.map(function (x) { return ('0' + (x & 0xff).toString(16)).slice(-2); }).join(''); }
function setPath_(obj, path, val) { var ks = String(path).split('.'); var o = obj; for (var i = 0; i < ks.length - 1; i++) { o[ks[i]] = o[ks[i]] || {}; o = o[ks[i]]; } o[ks[ks.length - 1]] = val; }

/* ── 최초 1회 실행: 시트 탭 생성 ─────────────────────────────────────── */
function setup() {
  Object.keys(COLLECTIONS).forEach(function (tab) { sheet_(tab); });
  return 'AutoDoc v2 탭 생성 완료: ' + Object.keys(COLLECTIONS).join(', ');
}

/* ── 유지보수(1회): 상태 전이 탭의 중복 행 정리 — id 별 최신 행만 남김.
 *    upsert 도입 전 append 로 쌓인 잔여 행(예: 승인해도 안 사라지던 Learning)을 청소. */
function cleanup() {
  var mutable = ['Learning', 'Drafts', 'KB', 'Memory', 'Rules', 'Workspace'];
  var report = {};
  mutable.forEach(function (tab) {
    var s = ss_().getSheetByName(tab); if (!s) { report[tab] = 'no-tab'; return; }
    var vals = s.getDataRange().getValues(); if (vals.length < 2) { report[tab] = 0; return; }
    var head = vals[0]; var idi = head.indexOf('id');
    var byId = {}; for (var i = 1; i < vals.length; i++) { byId[vals[i][idi]] = vals[i]; } // 마지막(최신) 행 우선
    var rows = Object.keys(byId).map(function (k) { return byId[k]; });
    s.clearContents(); s.appendRow(head);
    if (rows.length) s.getRange(2, 1, rows.length, head.length).setValues(rows);
    report[tab] = rows.length;
  });
  return report;
}
