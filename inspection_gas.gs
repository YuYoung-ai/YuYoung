/*******************************************************************
 * BAZ BIOMEDIC CS — A/S 점검 작업 협업(사인대기) 웹앱  v1.0.0
 * -----------------------------------------------------------------
 * 역할: inspection.html 의 작업 목록(Task)을 Google Sheets에 저장/조회하여
 *       엔지니어와 접수 담당자가 서로 다른 기기에서 같은 작업을 이어받는다.
 *
 * 설계 원칙 (3-2단계 요구사항)
 *  - 오프라인 우선: 클라이언트는 localStorage를 항상 사용하고,
 *    모든 저장(자동저장 포함)을 debounce 후 Sheets에 동기화한다.
 *    (사인대기 전환을 잊어도 시트에 등록되도록 — 상태와 무관하게 upsert)
 *  - 새 로그인 시스템을 만들지 않는다: 기존 auth.js 의 토큰을 그대로 검증.
 *  - 새 서버를 만들지 않는다: 기존 Apps Script + Sheets 구조를 그대로 사용.
 *
 * 배포
 *  1) 점검 작업을 저장할 스프레드시트를 하나 열고(또는 기존 것 재사용),
 *     확장 프로그램 > Apps Script 에 이 파일 전체를 붙여넣는다.
 *  2) 아래 AUTH_VERIFY_URL 에 auth.js 의 AUTH_URL 과 "동일한" /exec URL 입력.
 *  3) 배포 > 새 배포 > 웹 앱 > 실행: 나 / 액세스: 모든 사용자 → /exec URL 복사.
 *  4) 그 URL을 inspection.html 의 TASK_SYNC_URL 에 입력
 *     (또는 브라우저에서 localStorage 'inspection_sync_url' 로 설정).
 *
 * 시트: 'inspection_tasks' (없으면 자동 생성, 헤더 자동 기록)
 *  DocumentNo | TaskID | Status | Hospital | Product | Serial |
 *  Engineer | Receiver | CreatedAt | UpdatedAt | Data(JSON)
 *
 * 엔드포인트
 *  POST {action:'upsert', token, taskId, status, ...메타, data(JSON문자열)}
 *       → 같은 TaskID가 있으면 UpdatedAt 기준 최신만 유지(중복 생성 안 함)
 *  POST {action:'complete', token, taskId, documentNo}
 *       → 해당 작업 Status=completed, UpdatedAt=now 로 갱신
 *  POST {action:'remove', token, taskId}
 *       → 해당 작업 행 삭제 (클라이언트 작업 삭제와 동기화)
 *  GET  ?action=ping
 *  GET  ?action=list&token=…&status=waiting_signature,completed
 *       → 상태 필터된 메타데이터 목록(Data 제외, 가벼움)
 *  GET  ?action=get&token=…&taskId=…   → 해당 작업 1건(Data 포함)
 *******************************************************************/

var CFG = {
  SHEET: 'inspection_tasks',
  // ★ auth.js 의 AUTH_URL 과 동일한 값 입력 (토큰 검증용) ★
  AUTH_VERIFY_URL: 'https://script.google.com/macros/s/AKfycbykXiS7tXXx_nNuwXwQ--hgIXMrBSNdBPxOCn8b6H_zg9AWkbdLLqmF0Wn8L8zLaAI/exec',
  MIN_LEVEL: 1,             // 접근 최소 권한 (auth.js 레벨)
  TZ: 'Asia/Seoul'
};

var HEADERS = ['DocumentNo','TaskID','Status','Hospital','Product','Serial',
               'Engineer','Receiver','CreatedAt','UpdatedAt','Data(JSON)'];

/* ================= 공통 유틸 ================= */
function json_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function ss_(){ return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(){
  var sh = ss_().getSheetByName(CFG.SHEET);
  if(!sh){
    sh = ss_().insertSheet(CFG.SHEET);
    sh.getRange(1,1,1,HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  // 헤더 누락 시 보정
  if(sh.getLastRow()===0){
    sh.getRange(1,1,1,HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function colIndex_(){                       // 헤더명 → 1-based 열 번호
  var sh = sheet_();
  var head = sh.getRange(1,1,1,sh.getLastColumn()||HEADERS.length).getDisplayValues()[0];
  var m = {};
  head.forEach(function(h,i){ if(h) m[String(h).trim()] = i+1; });
  HEADERS.forEach(function(h,i){ if(!m[h]) m[h]=i+1; });   // 폴백: 기대 순서
  return m;
}
function nowISO_(){ return new Date().toISOString(); }

/* auth.js 토큰 검증 (GAS→GAS 는 반드시 GET) → 레벨(0=무효) */
/* ★★ [토큰 검증 해제] ★★ ────────────────────────────────────────
   아래 verifyLevel_ 은 인증 서버로 왕복(UrlFetchApp)해 토큰을 확인한다.
   그 왕복이 한 번이라도 실패하면(스크립트 권한 미승인·인증 서버 오류·쿼터 등)
   catch 가 0을 돌려주고, 그 순간 "토큰이 정상이어도" 모든 사용자·모든 도구가
   통째로 차단된다. 잘못된 토큰과 구분이 안 되기 때문에 재로그인해도 풀리지 않는다.
   실제로 이 상태가 되어 현장 사용이 막혔으므로 검증을 끈다.
   ※ 다시 켜려면 아래 값만 true 로 바꾸면 된다(코드 수정 불필요). */
var AUTH_ENFORCE = true;              /* 토큰 검증 사용 (문제 시 false 로 끄면 전면 개방) */
var AUTH_FAILOPEN_LEVEL = 1;          /* 인증 서버에 닿지 못했을 때 부여할 레벨 */
/* [v2.8] 인증 서버 차단기(circuit breaker) — "못 닿음"을 잠깐 기억하는 시간(초).
   이게 없으면 인증 GAS가 느릴 때 모든 조회가 각자 왕복을 다시 시도하며 지연이 곱해진다. */
var AUTH_DOWN_TTL = 60;
var AUTH_DOWN_KEY = 'auth_down';

function verifyLevel_(token){
  if(!AUTH_ENFORCE) return 3;                 /* 검증 끄기 스위치 */
  if(!token) return 0;                        /* 토큰이 아예 없으면 왕복 없이 차단 */

  /* ── 1순위: 서명 토큰을 로컬에서 검증 (baz_token_lib.gs) ───────────────────
     ★ 네트워크 호출 0회.
     예전에는 요청마다 인증 서버로 UrlFetchApp 왕복을 해서, 인증 서버 하나가 7개
     프로젝트의 단일 병목이 됐다. 게다가 보안 시트 Tokens 탭을 비우면 기기에 남은
     토큰이 전부 lv=0이 되는데 그 결과가 캐시되지 않아(옛 조건 `lv > 0`), 죽은 세션
     하나하나가 매 요청마다 왕복을 무한 반복하는 영구 부하가 됐다 — 접속 오류가
     "점점 잦아지던" 직접 원인. 서명 토큰은 스스로 유효성을 증명하므로 그 구조가
     통째로 사라진다(인증 서버가 죽어도, Tokens를 비워도 영향 없음). */
  var loc = null;
  try{ loc = (typeof bazVerifyLocal_ === 'function') ? bazVerifyLocal_(token) : null; }catch(e){}
  if(loc) return loc.ok ? (Number(loc.level)||0) : 0;

  /* ── 2순위(레거시 불투명 토큰): 예전 방식의 인증 서버 왕복 ─────────────────
     모든 사용자가 서명 토큰으로 재로그인하면 이 경로는 자연히 사라진다. 전환기 안전망. */
  if(!CFG.AUTH_VERIFY_URL) return AUTH_FAILOPEN_LEVEL;      /* 인증 서버 미설정 */

  var key = 'lv_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token)));
  var cache = null;
  try{
    cache = CacheService.getScriptCache();
    var hit = cache.get(key);
    if(hit) return Number(hit)||0;
    /* 직전에 인증 서버가 죽어 있었다면 왕복하지 않고 곧바로 통과시킨다.
       (어차피 결과는 AUTH_FAILOPEN_LEVEL 인데, 왕복 비용만 사용자마다 반복된다) */
    if(cache.get(AUTH_DOWN_KEY)) return AUTH_FAILOPEN_LEVEL;
  }catch(_){}

  /* 인증 서버 왕복 — "토큰이 틀렸다"와 "서버에 닿지 못했다"를 반드시 구분한다.
     둘을 뭉뚱그려 0을 돌려주면, 서버가 잠깐 흔들릴 때 토큰이 멀쩡한 사람까지
     전부 차단되고 재로그인으로도 풀리지 않는다(실제 발생). */
  var lv = 0, reached = false;
  try{
    var res = UrlFetchApp.fetch(
      CFG.AUTH_VERIFY_URL + '?action=verify&token=' + encodeURIComponent(String(token)),
      { method:'get', muteHttpExceptions:true, followRedirects:true });
    var r = JSON.parse(res.getContentText()||'{}');
    if(r && typeof r.ok !== 'undefined'){     /* 인증 서버가 제대로 답한 경우만 판정 */
      reached = true;
      lv = r.ok ? (Number(r.level)||0) : 0;
    }
  }catch(err){
    Logger.log('[auth] 인증 서버 확인 실패: ' + err);
  }

  if(!reached){
    /* 못 닿음을 짧게 기억 → 뒤따르는 요청들은 왕복 없이 즉시 통과 */
    try{ if(cache) cache.put(AUTH_DOWN_KEY, '1', AUTH_DOWN_TTL); }catch(_){}
    return AUTH_FAILOPEN_LEVEL;               /* 서버에 못 닿음 → 차단하지 않는다 */
  }
  try{
    if(cache){
      cache.remove(AUTH_DOWN_KEY);            /* 살아났으니 차단기 해제 */
      /* ★ 무효 토큰(lv===0)도 캐시한다. 옛 조건 `lv > 0`이 죽은 토큰을 캐시에서 빼
         매 요청 왕복을 유발했다 — 이번 접속 장애의 직접 원인. */
      cache.put(key, String(lv), lv > 0 ? 300 : 60);
    }
  }catch(_){}
  return lv;
}

/** 권한 승인 + 인증 서버 연결 자가진단.
 *  편집기에서 이 함수를 한 번 실행하면 (1) UrlFetchApp 권한 승인 창이 뜨고
 *  (2) 인증 서버 왕복이 실제로 되는지 로그로 확인된다. 배포 전에 실행할 것. */
function authSelfTest(){
  var url = CFG.AUTH_VERIFY_URL;
  if(!url){ Logger.log('❌ AUTH_VERIFY_URL 이 비어 있습니다'); return '미설정'; }
  try{
    var res = UrlFetchApp.fetch(url + '?action=verify&token=SELFTEST_BOGUS',
      { method:'get', muteHttpExceptions:true, followRedirects:true });
    var txt = res.getContentText()||'';
    var r = JSON.parse(txt);
    if(r && typeof r.ok !== 'undefined'){
      Logger.log('✅ 인증 서버 연결 정상 (응답: ' + txt + ')');
      Logger.log('   → AUTH_ENFORCE = true 로 두고 배포해도 됩니다.');
      return 'OK';
    }
    Logger.log('⚠️ 응답 형식이 다릅니다: ' + txt.slice(0,200));
    return '형식오류';
  }catch(e){
    var m = String((e && e.message) || e);
    Logger.log('❌ 인증 서버에 닿지 못했습니다: ' + m);
    if(/permission|authoriz|권한|승인|scope|external_request/i.test(m)){
      Logger.log('   원인: 이 프로젝트의 "외부 요청(UrlFetchApp)" 권한이 아직 승인되지 않았습니다.');
      Logger.log('   조치: 이 함수를 다시 실행 → 권한 검토 → 계정 선택 → 고급 →');
      Logger.log('         "(안전하지 않음) ...(으)로 이동" → 허용  까지 끝까지 진행하세요.');
      Logger.log('         (중간에 창을 닫으면 승인이 저장되지 않아 같은 오류가 반복됩니다)');
    }else{
      Logger.log('   원인: 권한 문제가 아닙니다. 네트워크·인증 서버 URL·배포 설정 쪽입니다.');
      Logger.log('   조치: 위 오류 메시지 한 줄을 그대로 알려주세요.');
    }
    return '실패';
  }
}

function authed_(token){ return verifyLevel_(token) >= CFG.MIN_LEVEL; }

/* TaskID로 행 번호 찾기 (없으면 0) */
function findRowByTaskId_(taskId){
  var sh = sheet_(), m = colIndex_();
  var last = sh.getLastRow();
  if(last < 2) return 0;
  var ids = sh.getRange(2, m['TaskID'], last-1, 1).getDisplayValues();
  for(var i=0;i<ids.length;i++){
    if(String(ids[i][0]).trim() === String(taskId).trim()) return i+2;
  }
  return 0;
}

/* ================= POST ================= */
function doPost(e){
  var lock = LockService.getScriptLock();
  var p = {};
  try{
    lock.waitLock(20000);
    p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if(!authed_(p.token)) return json_({success:false, error:'unauthorized'});

    if(p.action === 'upsert')   return json_(upsert_(p));
    if(p.action === 'complete') return json_(complete_(p));
    if(p.action === 'remove')   return json_(remove_(p));
    return json_({success:false, error:'알 수 없는 action: '+p.action});
  }catch(err){
    return json_({success:false, error:String(err)});
  }finally{
    try{ lock.releaseLock(); }catch(_){}
  }
}

/* upsert: 같은 TaskID면 갱신(단, 넘어온 UpdatedAt이 기존보다 최신일 때만), 없으면 추가 */
function upsert_(p){
  if(!p.taskId) return {success:false, error:'taskId 필요'};
  var sh = sheet_(), m = colIndex_();
  var row = {
    'DocumentNo': p.documentNo||'', 'TaskID': p.taskId, 'Status': p.status||'',
    'Hospital': p.hospital||'', 'Product': p.product||'', 'Serial': p.serial||'',
    'Engineer': p.engineer||'', 'Receiver': p.receiver||'',
    'CreatedAt': p.createdAt||nowISO_(), 'UpdatedAt': p.updatedAt||nowISO_(),
    'Data(JSON)': typeof p.data==='string' ? p.data : JSON.stringify(p.data||{})
  };
  var at = findRowByTaskId_(p.taskId);
  if(at){
    // 동기화 규칙: 넘어온 UpdatedAt 이 기존보다 최신일 때만 갱신 (오래된 덮어쓰기 방지)
    var prevU = sh.getRange(at, m['UpdatedAt']).getDisplayValue();
    if(prevU && p.updatedAt && new Date(p.updatedAt) < new Date(prevU)){
      return {success:true, row:at, skipped:'older', taskId:p.taskId};
    }
    HEADERS.forEach(function(h){ sh.getRange(at, m[h]).setValue(row[h]); });
    return {success:true, row:at, updated:true, taskId:p.taskId};
  }
  var newRow = HEADERS.map(function(h){ return row[h]; });
  sh.appendRow(newRow);
  return {success:true, row:sh.getLastRow(), created:true, taskId:p.taskId};
}

/* remove: 해당 TaskID 행 삭제 (클라이언트에서 작업 삭제 시) */
function remove_(p){
  if(!p.taskId) return {success:false, error:'taskId 필요'};
  var at = findRowByTaskId_(p.taskId);
  if(!at) return {success:true, missing:true};   // 이미 없음 → 성공 처리
  sheet_().deleteRow(at);
  return {success:true, removed:true, taskId:p.taskId};
}

/* complete: 상태 completed + UpdatedAt 갱신 (+ 문서번호 반영) */
function complete_(p){
  if(!p.taskId) return {success:false, error:'taskId 필요'};
  var sh = sheet_(), m = colIndex_();
  var at = findRowByTaskId_(p.taskId);
  if(!at) return {success:false, error:'해당 TaskID 없음: '+p.taskId};
  sh.getRange(at, m['Status']).setValue('completed');
  sh.getRange(at, m['UpdatedAt']).setValue(p.updatedAt||nowISO_());
  if(p.documentNo) sh.getRange(at, m['DocumentNo']).setValue(p.documentNo);
  return {success:true, row:at, taskId:p.taskId, status:'completed'};
}

/* ================= GET ================= */
function doGet(e){
  var p = (e && e.parameter) || {};
  var action = p.action || 'ping';
  try{
    if(action === 'ping') return json_({success:true, ver:'1.0.0', pong:nowISO_()});
    if(!authed_(p.token)) return json_({success:false, error:'unauthorized'});
    if(action === 'list') return json_(list_(p));
    if(action === 'get')  return json_(get_(p));
    return json_({success:false, error:'알 수 없는 action: '+action});
  }catch(err){
    return json_({success:false, error:String(err)});
  }
}

/* list: 상태 필터된 메타데이터 (Data 제외 — 목록은 가볍게) */
function list_(p){
  var sh = sheet_(), m = colIndex_();
  var last = sh.getLastRow();
  var wanted = String(p.status||'waiting_signature').split(',').map(function(s){return s.trim();}).filter(Boolean);
  var out = [];
  if(last >= 2){
    var vals = sh.getRange(2,1,last-1, sh.getLastColumn()).getDisplayValues();
    vals.forEach(function(v){
      var status = v[m['Status']-1];
      if(wanted.length && wanted.indexOf(status) < 0) return;
      out.push({
        documentNo: v[m['DocumentNo']-1], taskId: v[m['TaskID']-1], status: status,
        hospital: v[m['Hospital']-1], product: v[m['Product']-1], serial: v[m['Serial']-1],
        engineer: v[m['Engineer']-1], receiver: v[m['Receiver']-1],
        createdAt: v[m['CreatedAt']-1], updatedAt: v[m['UpdatedAt']-1]
      });
    });
  }
  // 사인대기 먼저, 그다음 최신 수정순
  out.sort(function(a,b){
    var aw = a.status==='waiting_signature'?0:1, bw = b.status==='waiting_signature'?0:1;
    if(aw!==bw) return aw-bw;
    return new Date(b.updatedAt||0) - new Date(a.updatedAt||0);
  });
  return {success:true, count:out.length, tasks:out, updated:nowISO_()};
}

/* get: TaskID 1건 (Data 포함) */
function get_(p){
  if(!p.taskId) return {success:false, error:'taskId 필요'};
  var sh = sheet_(), m = colIndex_();
  var at = findRowByTaskId_(p.taskId);
  if(!at) return {success:false, error:'해당 TaskID 없음'};
  var v = sh.getRange(at,1,1, sh.getLastColumn()).getDisplayValues()[0];
  var dataStr = v[m['Data(JSON)']-1] || '{}';
  var data; try{ data = JSON.parse(dataStr); }catch(_){ data = {}; }
  return {success:true, task:{
    documentNo: v[m['DocumentNo']-1], taskId: v[m['TaskID']-1], status: v[m['Status']-1],
    hospital: v[m['Hospital']-1], product: v[m['Product']-1], serial: v[m['Serial']-1],
    engineer: v[m['Engineer']-1], receiver: v[m['Receiver']-1],
    createdAt: v[m['CreatedAt']-1], updatedAt: v[m['UpdatedAt']-1], data: data
  }};
}
