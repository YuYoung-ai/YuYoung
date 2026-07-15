/*******************************************************************
 * BAZ BIOMEDIC CS — A/S 점검 작업 협업(사인대기) 웹앱  v1.0.0
 * -----------------------------------------------------------------
 * 역할: inspection.html 의 작업 목록(Task)을 Google Sheets에 저장/조회하여
 *       엔지니어와 접수 담당자가 서로 다른 기기에서 같은 작업을 이어받는다.
 *
 * 설계 원칙 (3-2단계 요구사항)
 *  - 오프라인 우선: 클라이언트는 localStorage를 항상 사용하고,
 *    사인대기(waiting_signature) 전환·최종 완료(completed) 시에만 Sheets에 동기화.
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
function verifyLevel_(token){
  try{
    if(!CFG.AUTH_VERIFY_URL || !token) return 0;
    var res = UrlFetchApp.fetch(
      CFG.AUTH_VERIFY_URL + '?action=verify&token=' + encodeURIComponent(String(token)),
      { method:'get', muteHttpExceptions:true, followRedirects:true });
    var r = JSON.parse(res.getContentText()||'{}');
    return (r && r.ok) ? (Number(r.level)||0) : 0;
  }catch(e){ return 0; }
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
