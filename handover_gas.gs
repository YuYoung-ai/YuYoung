/*******************************************************************
 * BAZ BIOMEDIC CS — 현장 처리 현황(handover) 확장 웹앱  v2.3.0
 * -----------------------------------------------------------------
 * 역할: 바즈바이오메딕 CS팀 수석 매니저 봇 — 모든 응답은
 *       [문제 확인 ➡️ 문제 해결 ➡️ 후속 조치] 3단계 원칙을 따른다.
 *
 * 배포: 스프레드시트(현장 처리 현황) 컨테이너 바운드 스크립트로 붙여넣기
 *       → 배포 > 새 배포 > 웹 앱 > 실행: 나 / 액세스: 모든 사용자
 *       → 배포 URL을 handover.html 의 HANDOVER_URL 에 입력
 *
 * ★ v2.2 적용 방법 (기존 버전 위에 덮어쓰기) ★
 *  1) Apps Script 편집기에서 기존 코드 전체를 이 파일로 교체
 *  2) 아래 WEEKLY.REPORT_SS_ID 에 업무보고서_CS 스프레드시트 ID 입력
 *     (주소창 /d/ 와 /edit 사이 문자열)
 *  3) 배포 > 배포 관리 > ✏️ > 버전: "새 버전" > 배포
 *     ※ "새 배포"가 아님 — URL이 바뀌면 앱 전체가 깨집니다
 *
 * 엔드포인트
 *  POST                          : 행 기록 (수기 입력 열만 기록, 수식 열 보존)
 *  POST {action:'weeklywrite'}   : [v2.1] 주간업무보고 본문을 작성자 탭 최상단에 삽입
 *  POST {action:'menu_save'}     : [v2.2] 허브 메뉴 표시/레벨/순서 저장 (Lv.3 토큰 필요)
 *  GET ?action=ping              : 콜드스타트 예열
 *  GET ?action=all               : 대시보드/주간보고용 전체 데이터
 *  GET ?action=hospdb            : 병원정보DB 목록
 *  GET ?action=inventory         : 재고 요약 4종
 *  GET ?action=recent&hosp=병원명&limit=5 : 해당 병원 최근 처리 이력
 *  GET ?action=today&fse=이름    : 오늘 기록 확인 (fse 생략 시 전체)
 *  GET ?action=master            : 유형 마스터(대분류/유형/코드/3단계 가이드/교체품)
 *  GET ?action=guide&type=유형&token=… : 3단계 원칙 답변 [v2.1: Lv.3 토큰 게이트]
 *  GET ?action=weekly&fse=이름&mon=YYYY-MM-DD : [v2.1] 해당 주(월~금) 처리 내역
 *  GET ?action=menu              : [v2.2] 허브 메뉴 설정(표시/레벨/순서, 메뉴설정 탭)
 *******************************************************************/

var CONFIG = {
  SHEET_NAME : '현장 처리 현황(handover)', // 기록 대상 시트
  MASTER_SHEET : '유형 마스터',             // 대분류/유형/문제확인/문제해결/후속조치 열
  LOG_SHEET  : '전송로그',                  // 수신 로그
  HEADER_SCAN: 6,                           // 헤더 행 탐색 범위 (1~6행)
  RECENT_MAX : 10
};

/* 재고 연동 — 두 시트를 역할 분리:
   ① SPREADSHEET_ID(재고 관리 원장): handover 기록 시 사용처 자동 "기입" 대상
   ② SUMMARY(CS 서비스 현황 > 대시보드 탭): 주간보고 재고 4종 "조회" — 이미
      Handpiece(Repair)/(새제품)·Foot s/w(새제품)/(Repair) 형태로 집계돼 있음 */
var INVENTORY = {
  SPREADSHEET_ID: '1pFIdZ_aUNadN45osR6LYsxdqPYKlu0B70r-SUTIVzBM',
  SUMMARY: {
    SPREADSHEET_ID: '12omDiTZ5Z8lyERG-rghaRPjA7l5B_3np5WXkMPCHPNE',
    SHEET: '대시보드',
    BUCKETS: {
      hpRepair  : {label:'Handpiece (Repair)'},
      hpNew     : {label:'Handpiece (새제품)'},
      footNew   : {label:'Foot s/w (새제품)'},
      footRepair: {label:'Foot s/w (Repair)'}
    }
  }
};

/* [v2.3] N-care 가입 현황 — 재고와 같은 대시보드 시트에서 표 읽기 (점검 PPT용)
   SPREADSHEET_ID/SHEET 를 비워두면 INVENTORY.SUMMARY 값을 그대로 사용.
   표 구조(라벨 기준 자동 탐지): 등급 헤더(Basic/Standard/Pro/Premium/CurePass 또는 미가입) +
     가입 병원 수 / 정상 운영 병원 수 / 점검 대상 병원 수 / 점검률 행,
     하단 요약(전체 가입자 · 정상 운영 병원 · 정상 운영률) */
var NCARE = {
  SPREADSHEET_ID: '',      // 비우면 INVENTORY.SUMMARY.SPREADSHEET_ID 사용
  SHEET: '',               // 비우면 INVENTORY.SUMMARY.SHEET 사용
  TIERS: ['Basic','Standard','Pro','Premium','CurePass']   // 마지막(미가입) 라벨은 CurePass로 표기
};

/* 앱이 직접 기록하는 열 — 이 외의 열(NO·거래처·N-Care·보증기한 등
   수식/자동 열)은 절대 건드리지 않는다.
   ※ 장비SN(Q열)·HP_SN(IN/OUT)·Ver는 payload 값이 있을 때만 별도로 기록 */
var WRITE_COLS = ['처리일','병원명','CS 담당자','점검/AS','대분류','유형','교체품','교체비용','내용','노즐 재사용'];

/* [v2.1] 주간업무보고 — weekly.html 연동
   REPORT_SS_ID: ★필수★ 업무보고서_CS 스프레드시트 ID (주소창 /d/ 와 /edit 사이)
   작성자 탭 이름 = 작성자명 + TAB_SUFFIX (예: 권오성 → 권오성2)
   새 보고는 HEADER_ROW 바로 아래(최상단)에 삽입: [기록일시 | 주차 | 기간 | 본문] 4열 */
var WEEKLY = {
  REPORT_SS_ID: '',          // ★ 여기에 업무보고서_CS 스프레드시트 ID 입력 ★
  TAB_SUFFIX : '2',
  HEADER_ROW : 1
};

/* [v2.1] 메뉴 관리 + 수석 매니저 가이드 토큰 게이트 — index.html 연동
   AUTH_VERIFY_URL: auth.js 의 AUTH_URL 과 동일한 값 (인증 웹앱 /exec)
   ※ 비워두면 menu_save(저장)와 guide(수석 매니저 가이드)가 전부 거부됩니다 */
var MENU = {
  SHEET: '메뉴설정',
  AUTH_VERIFY_URL: 'https://script.google.com/macros/s/AKfycbykXiS7tXXx_nNuwXwQ--hgIXMrBSNdBPxOCn8b6H_zg9AWkbdLLqmF0Wn8L8zLaAI/exec'
};

/* ================= 공통 유틸 ================= */
function ss_(){ return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(name){
  var sh = ss_().getSheetByName(name);
  if(sh) return sh;
  /* 공백 차이 허용: '유형마스터' ↔ '유형 마스터' */
  var q = norm_(name);
  return ss_().getSheets().filter(function(s){ return norm_(s.getName())===q; })[0] || null;
}
function json_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function norm_(s){ return String(s==null?'':s).replace(/\s+/g,'').toLowerCase(); }

/** 헤더 행 자동 탐지: '처리일'과 '병원명'이 함께 있는 행 */
function findHeader_(sh){
  var last = Math.min(CONFIG.HEADER_SCAN, sh.getLastRow());
  var rng = sh.getRange(1,1,last,sh.getLastColumn()).getDisplayValues();
  for(var r=0;r<rng.length;r++){
    var row = rng[r].map(norm_);
    if(row.indexOf('처리일')>=0 && row.indexOf('병원명')>=0){
      var map = {};                       // 열이름 → 1-based 열번호 (첫 등장)
      rng[r].forEach(function(h,i){
        var k = String(h).trim();
        if(k && map[k]===undefined) map[k]=i+1;
      });
      /* HP_SN(IN)/HP_SN(OUT) 뒤의 중복 'Ver' 열 위치 분리 */
      var raw = rng[r].map(function(h){return String(h).trim();});
      var inIdx = raw.indexOf('HP_SN(IN)'), outIdx = raw.indexOf('HP_SN(OUT)');
      if(inIdx>=0){ for(var i=inIdx+1;i<raw.length;i++){ if(raw[i]==='Ver'){ map['__VER_IN']=i+1; break; } } }
      if(outIdx>=0){ for(var j=outIdx+1;j<raw.length;j++){ if(raw[j]==='Ver'){ map['__VER_OUT']=j+1; break; } } }
      return { row:r+1, map:map, headers:raw };
    }
  }
  return null;
}

/** 데이터 마지막 행 — 헤더 바로 아래부터 "연속된" 데이터 블록만 인정.
 *  (O열 체크박스처럼 끝까지 채워진 열이나, appendRow로 시트 바닥에
 *   박힌 잔여 행에 속지 않도록 처리일·병원명 기준 + 빈 행 20개면 종료) */
function lastDataRow_(sh, hdr){
  var c1 = hdr.map['처리일'], c2 = hdr.map['병원명'];
  var start = hdr.row+1;
  var total = sh.getMaxRows()-hdr.row;
  if(total<1) return hdr.row;
  var v1 = sh.getRange(start, c1, total, 1).getDisplayValues();
  var v2 = c2 ? sh.getRange(start, c2, total, 1).getDisplayValues() : null;
  var last = hdr.row, gap = 0;
  for(var i=0;i<total;i++){
    var filled = String(v1[i][0]).trim()!=='' || (v2 && String(v2[i][0]).trim()!=='');
    if(filled){ last = start+i; gap = 0; }
    else if(++gap >= 20) break;   // 연속 블록 종료 → 바닥 잔여 행 무시
  }
  return last;
}

/** 바닥 잔여 행 탐지: 연속 블록 밖에 처리일/병원명이 있는 행 목록 */
function findStray(){
  var sh = sheet_(CONFIG.SHEET_NAME), hdr = findHeader_(sh);
  var end = lastDataRow_(sh, hdr);
  var c1 = hdr.map['처리일'], c2 = hdr.map['병원명'];
  var start = end+1, total = sh.getMaxRows()-end;
  if(total<1) return [];
  var v1 = sh.getRange(start, c1, total, 1).getDisplayValues();
  var v2 = sh.getRange(start, c2, total, 1).getDisplayValues();
  var out = [];
  for(var i=0;i<total;i++){
    if(String(v1[i][0]).trim()!=='' || String(v2[i][0]).trim()!==''){
      out.push({row:start+i, date:v1[i][0], hosp:v2[i][0]});
    }
  }
  Logger.log('잔여 행 %s건: %s', out.length, JSON.stringify(out));
  return out;
}

/** 바닥 잔여 행 청소 — 편집기에서 1회 실행 (잔여 행의 기록 열만 비움) */
function cleanupStray(){
  var sh = sheet_(CONFIG.SHEET_NAME), hdr = findHeader_(sh);
  var stray = findStray();
  var cols = WRITE_COLS.map(function(k){return hdr.map[k];}).filter(Boolean)
    .concat([hdr.map['HP_SN(IN)'],hdr.map['__VER_IN'],hdr.map['HP_SN(OUT)'],hdr.map['__VER_OUT'],
             colBy_(hdr,['장비SN','장비 SN'])].filter(Boolean));
  stray.forEach(function(s){
    cols.forEach(function(c){ sh.getRange(s.row, c).clearContent(); });
  });
  Logger.log('청소 완료: %s행', stray.length);
  return stray.length;
}

function log_(status, hdr, payload){
  try{
    var sh = sheet_(CONFIG.LOG_SHEET) || ss_().insertSheet(CONFIG.LOG_SHEET);
    sh.appendRow([ new Date(), status,
      hdr ? 'hdrRow='+hdr.row : 'hdr=?',
      hdr ? JSON.stringify(pickCols_(hdr)) : '',
      hdr ? JSON.stringify(hdr.headers) : '',
      JSON.stringify(payload||{}) ]);
  }catch(e){}
}
function pickCols_(hdr){
  var o={}; WRITE_COLS.forEach(function(k){ if(hdr.map[k]) o[k]=hdr.map[k]; });
  return o;
}

/* ================= POST: 행 기록 ================= */
function doPost(e){
  var lock = LockService.getScriptLock();
  var payload = {};
  try{
    lock.waitLock(20000);
    payload = JSON.parse(e.postData.contents||'{}');

    /* [v2.1] JSON 파싱 직후 신규 액션 라우팅 — handover 행 기록보다 먼저 */
    if(payload && payload.action==='weeklywrite') return json_(wkWrite_(payload));
    if(payload && payload.action==='menu_save')   return json_(menuSave_(payload));
    if(payload && payload.action==='progress_save') return json_(progSave_(payload));  /* [v2.4] 진행중 공유 상태 */

    var sh = sheet_(CONFIG.SHEET_NAME);
    if(!sh) return json_({success:false, error:'시트 없음: '+CONFIG.SHEET_NAME});
    var hdr = findHeader_(sh);
    if(!hdr) return json_({success:false, error:'헤더(처리일/병원명) 탐지 실패'});

    var row = lastDataRow_(sh, hdr) + 1;
    if(row > sh.getMaxRows()) sh.insertRowAfter(sh.getMaxRows());

    /* 프런트 payload 키 → 시트 열 매핑 */
    var m = {
      '처리일'   : payload.date  || Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd'),
      '병원명'   : payload.hosp  || '',
      'CS 담당자': payload.fse   || '',
      '점검/AS'  : payload.gubun || '',
      '대분류'   : payload.cat   || '',
      '유형'     : payload.type  || '',
      '교체품'   : payload.part  || '',
      '교체비용' : payload.cost  || '',
      '내용'     : payload.detail|| '',
      '노즐 재사용' : (String(payload.nozzle||'').trim().toUpperCase()==='O' ? 'O' : 'X')  /* P열 · 기본 X */
    };
    Object.keys(m).forEach(function(k){
      var c = hdr.map[k];
      if(c) sh.getRange(row, c).setValue(m[k]);
    });
    /* 장비 S/N (Q열 '장비SN' 등 · 열이 존재하고 값이 있을 때만) */
    var snCol = colBy_(hdr, ['장비SN','장비 SN','장비 S/N','S/N(장비)']);
    if(snCol && payload.sn) sh.getRange(row, snCol).setValue(payload.sn);
    /* HP 교체 정보 (열이 존재할 때만) */
    if(hdr.map['HP_SN(IN)']  && payload.hpIn)  sh.getRange(row, hdr.map['HP_SN(IN)']).setValue(payload.hpIn);
    if(hdr.map['__VER_IN']   && payload.uVer)  sh.getRange(row, hdr.map['__VER_IN']).setValue(payload.uVer);
    if(hdr.map['HP_SN(OUT)'] && payload.hpOut) sh.getRange(row, hdr.map['HP_SN(OUT)']).setValue(payload.hpOut);
    if(hdr.map['__VER_OUT']  && payload.wVer)  sh.getRange(row, hdr.map['__VER_OUT']).setValue(payload.wVer);

    log_('OK', hdr, payload);
    try{ CacheService.getScriptCache().remove('handover_all'); }catch(_){}
    /* 재고 원장 사용처 자동 기입 (실패해도 본 기록에는 영향 없음) */
    var inv = invRecordUsage_(payload);
    if(inv.msg) log_(inv.done?'INV_OK':'INV_SKIP', hdr, {inv:inv.msg});
    var msg = '✅ '+ (payload.hosp||'') +' 기록 완료 (행 '+row+')';
    if(inv.msg) msg += '\n' + (inv.done?'✅ ':'⚠️ ') + inv.msg;
    return json_({success:true, row:row, sheet:CONFIG.SHEET_NAME, inv:inv, msg:msg});
  }catch(err){
    log_('ERR:'+err, null, payload);
    return json_({success:false, error:String(err)});
  }finally{
    try{ lock.releaseLock(); }catch(_){}
  }
}

/* ================= GET: 조회 ================= */
function doGet(e){
  var p = (e && e.parameter) || {};
  var action = p.action || 'ping';
  try{
    if(action==='ping')   return json_({success:true, ver:'2.6.0', pong:new Date().toISOString()});
    if(action==='all')    return json_(getAll_());
    if(action==='hospdb') return json_(getHospDB_());
    if(action==='inventory') return json_(getInventory_());
    if(action==='ncare')  return json_(getNcare_());            /* [v2.3] N-care 가입 현황 */
    if(action==='recent') return json_(getRecent_(p.hosp||'', Number(p.limit)||5));
    if(action==='today')  return json_(getToday_(p.fse||''));
    if(action==='master') return json_(getMaster_());
    if(action==='guide')  return json_(gateGuide_(p));          /* [v2.1] Lv.3 토큰 게이트 */
    if(action==='weekly') return json_(wkGetWeekly_(p));        /* [v2.1] 주간 처리 내역 */
    if(action==='menu')   return json_(menuGet_());             /* [v2.1] 허브 메뉴 설정 */
    if(action==='progress') return json_(progGet_());           /* [v2.4] 진행중 공유 상태 */
    return json_({success:false, error:'알 수 없는 action: '+action});
  }catch(err){
    return json_({success:false, error:String(err)});
  }
}

/** 시트 전체를 객체 배열로 (수식 결과 포함 표시값) */
function readAll_(){
  var sh = sheet_(CONFIG.SHEET_NAME);
  if(!sh) return {hdr:null, rows:[]};
  var hdr = findHeader_(sh);
  if(!hdr) return {hdr:null, rows:[]};
  var last = lastDataRow_(sh, hdr);
  if(last <= hdr.row) return {hdr:hdr, rows:[]};
  var vals = sh.getRange(hdr.row+1, 1, last-hdr.row, sh.getLastColumn()).getDisplayValues();
  var rows = vals.map(function(v, i){
    var o = {_row: hdr.row+1+i};
    hdr.headers.forEach(function(h,c){ if(h) o[h]=v[c]; });
    /* 중복 Ver 분리 */
    if(hdr.map['__VER_IN'])  o['VerIN']  = v[hdr.map['__VER_IN']-1];
    if(hdr.map['__VER_OUT']) o['VerOUT'] = v[hdr.map['__VER_OUT']-1];
    return o;
  }).filter(function(o){ return String(o['처리일']||'').trim()!==''; });
  return {hdr:hdr, rows:rows};
}

/** 헤더 표기 차이 흡수: 정규화 완전일치 → 부분일치 순 */
function pickH_(o, cands){
  var keys=Object.keys(o);
  for(var i=0;i<cands.length;i++){
    var q=norm_(cands[i]);
    for(var k=0;k<keys.length;k++){ if(norm_(keys[k])===q) return o[keys[k]]; }
  }
  for(var i2=0;i2<cands.length;i2++){
    var q2=norm_(cands[i2]);
    for(var k2=0;k2<keys.length;k2++){ if(q2 && norm_(keys[k2]).indexOf(q2)>=0) return o[keys[k2]]; }
  }
  return '';
}

/** 헤더맵에서 후보 이름으로 열번호 찾기(정규화 완전일치 → 부분일치) · 없으면 0 */
function colBy_(hdr, cands){
  var keys=Object.keys(hdr.map);
  for(var i=0;i<cands.length;i++){ var q=norm_(cands[i]);
    for(var k=0;k<keys.length;k++){ if(norm_(keys[k])===q) return hdr.map[keys[k]]; } }
  for(var i2=0;i2<cands.length;i2++){ var q2=norm_(cands[i2]);
    for(var k2=0;k2<keys.length;k2++){ if(q2 && norm_(keys[k2]).indexOf(q2)>=0) return hdr.map[keys[k2]]; } }
  return 0;
}

function slim_(o){
  return {
    date : o['처리일']||'', hosp: o['병원명']||'', fse: o['CS 담당자']||'',
    gubun: o['점검/AS']||'', cat: o['대분류']||'', type: o['유형']||'',
    part : o['교체품']||'', cost: o['교체비용']||'', detail: o['내용']||'',
    sn   : pickH_(o,['장비SN','장비 SN','SN']),
    ncare: pickH_(o,['N-Care','NCare','N케어','엔케어']),
    warranty: pickH_(o,['보증기한','보증']),
    paid : pickH_(o,['유/무상','유무상','유·무상']),
    hpIn : o['HP_SN(IN)']||'', verIn: o['VerIN']||'',
    hpOut: o['HP_SN(OUT)']||'', verOut: o['VerOUT']||'',
    nozzleReuse: (String(pickH_(o,['노즐 재사용','노즐재사용'])||'').trim().toUpperCase()==='O' ? 'O' : 'X')  /* P열 · 기본 X */
  };
}

/** 대시보드용 전체 데이터 — 5분 스크립트 캐시 (100KB 이내일 때만) */
function getAll_(){
  var cache = CacheService.getScriptCache();
  try{
    var hit = cache.get('handover_all');
    if(hit) return JSON.parse(hit);
  }catch(e){}
  var all = readAll_();
  var out = {success:true, count:all.rows.length,
             updated:Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm'),
             data:all.rows.map(slim_)};
  try{
    var s = JSON.stringify(out);
    if(s.length < 95000) cache.put('handover_all', s, 300);
  }catch(e){}
  return out;
}

/** 병원정보DB 탭 → 병원명·N-Care·지역 목록 (N-Care 미점검 산출용, 10분 캐시) */
function getHospDB_(){
  var cache = CacheService.getScriptCache();
  try{ var hit=cache.get('handover_hospdb'); if(hit) return JSON.parse(hit); }catch(e){}
  var sh = sheet_('병원정보DB');
  if(!sh) return {success:false, error:'병원정보DB 탭 없음'};
  var v = sh.getDataRange().getDisplayValues();
  var hr=-1, hmap={};
  for(var r=0;r<Math.min(5,v.length);r++){
    if(v[r].map(norm_).indexOf('병원명')>=0){
      hr=r;
      v[r].forEach(function(h,i){ var k=String(h).trim(); if(k && hmap[k]===undefined) hmap[k]=i; });
      break;
    }
  }
  if(hr<0) return {success:false, error:'병원정보DB 헤더(병원명) 탐지 실패'};
  function col(cands){
    var keys=Object.keys(hmap);
    for(var i=0;i<cands.length;i++){ var q=norm_(cands[i]);
      for(var k=0;k<keys.length;k++) if(norm_(keys[k])===q) return hmap[keys[k]]; }
    for(var i2=0;i2<cands.length;i2++){ var q2=norm_(cands[i2]);
      for(var k2=0;k2<keys.length;k2++) if(q2 && norm_(keys[k2]).indexOf(q2)>=0) return hmap[keys[k2]]; }
    return -1;
  }
  var cName=col(['병원명']), cNc=col(['N-Care','NCare','N케어']),
      cRg=col(['지역','거래처']), cFse=col(['영업 담당자','영업담당','담당자']);
  var out=[];
  for(var i=hr+1;i<v.length;i++){
    var n=String(v[i][cName]||'').trim();
    if(!n) continue;
    out.push({ n:n,
      ncare: cNc>=0?String(v[i][cNc]).trim():'',
      r:     cRg>=0?String(v[i][cRg]).trim():'',
      sale:  cFse>=0?String(v[i][cFse]).trim():'' });
    if(out.length>=800) break;
  }
  var res={success:true, count:out.length, data:out,
    updated:Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm')};
  try{ var s=JSON.stringify(res); if(s.length<95000) cache.put('handover_hospdb', s, 600); }catch(e){}
  return res;
}

/** 특정 병원 최근 이력 */
function getRecent_(hosp, limit){
  if(!hosp) return {success:false, error:'hosp 파라미터 필요'};
  var all = readAll_();
  var q = norm_(hosp);
  var hit = all.rows.filter(function(o){ return norm_(o['병원명'])===q || norm_(o['병원명']).indexOf(q)>=0; });
  hit = hit.slice(-Math.min(limit, CONFIG.RECENT_MAX)).reverse().map(slim_);
  return {success:true, hosp:hosp, count:hit.length, data:hit};
}

/** 오늘 기록 */
function getToday_(fse){
  var today = Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd');
  var all = readAll_();
  var hit = all.rows.filter(function(o){
    var d = String(o['처리일']||'').replace(/\./g,'-').replace(/\s/g,'');
    var okDate = d.indexOf(today)===0;
    var okFse = !fse || norm_(o['CS 담당자'])===norm_(fse);
    return okDate && okFse;
  }).map(slim_);
  return {success:true, date:today, count:hit.length, data:hit};
}

/** 유형 마스터: 유형마스터 시트가 있으면 우선, 없으면 데이터에서 추출 */
function getMaster_(){
  var out = {success:true, source:'', taxonomy:{}, parts:[], fse:[], guides:{}};
  var msh = sheet_(CONFIG.MASTER_SHEET);
  if(msh && msh.getLastRow()>1){
    /* 기대 헤더: 대분류 | 유형 | 코드 | 문제확인 | 문제해결 | 후속조치 */
    var mv = msh.getDataRange().getDisplayValues();
    var mh = mv[0].map(function(s){return String(s).trim();});
    var ci = {cat:mh.indexOf('대분류'), type:mh.indexOf('유형'), code:mh.indexOf('코드'),
              chk:mh.indexOf('문제확인'), fix:mh.indexOf('문제해결'), fup:mh.indexOf('후속조치')};
    for(var r=1;r<mv.length;r++){
      var cat=mv[r][ci.cat], typ=mv[r][ci.type];
      if(!cat||!typ) continue;
      (out.taxonomy[cat]=out.taxonomy[cat]||[]).push([ci.code>=0?mv[r][ci.code]:'', typ]);
      out.guides[typ]={
        chk: ci.chk>=0?mv[r][ci.chk]:'', fix: ci.fix>=0?mv[r][ci.fix]:'', fup: ci.fup>=0?mv[r][ci.fup]:''
      };
    }
    out.source='유형마스터 시트';
  }
  /* 데이터 기반 보강: 실제 기록에서 대분류/유형·교체품·담당자 유니크 추출 */
  var all = readAll_();
  all.rows.forEach(function(o){
    var cat=String(o['대분류']||'').trim(), typ=String(o['유형']||'').trim();
    if(cat&&typ){
      var arr=(out.taxonomy[cat]=out.taxonomy[cat]||[]);
      if(!arr.some(function(p){return p[1]===typ;})) arr.push(['',typ]);
    }
    var part=String(o['교체품']||'').trim();
    if(part && out.parts.indexOf(part)<0) out.parts.push(part);
    var f=String(o['CS 담당자']||'').trim();
    if(f && out.fse.indexOf(f)<0) out.fse.push(f);
  });
  if(!out.source) out.source='기록 데이터 추출';
  return out;
}

/* ================= 재고 관리 시트 연동 ================= */
function invOpen_(){ return SpreadsheetApp.openById(INVENTORY.SPREADSHEET_ID); }
function invSheetByName_(ss, name){
  if(!name) return null;
  var sh = ss.getSheetByName(name);
  if(sh) return sh;
  var q = norm_(name);
  /* 완전일치 → 부분일치 순 */
  var all = ss.getSheets();
  return all.filter(function(s){ return norm_(s.getName())===q; })[0]
      || all.filter(function(s){ return norm_(s.getName()).indexOf(q)>=0 || q.indexOf(norm_(s.getName()))>=0; })[0]
      || null;
}
/* 순수 숫자 셀 판정 ('106', '1,650' O / '2026-06-25', 'HP1.2.2' X) */
function invNum_(s){
  var t=String(s==null?'':s).trim().replace(/,/g,'');
  if(t==='' || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}
/* 라벨 셀 기준 주변에서 첫 숫자 탐색.
   ★ 우선순위가 중요: 라벨들이 가로로 나란한 표(재고 현황 4칸)에서
   왼쪽 대각선을 먼저 보면 옆 라벨의 값을 집어가 한 칸씩 밀린다.
   ① 라벨 바로 아래(같은 열, 8행) → ② 같은 행 오른쪽(3열)
   → ③ 아래-오른쪽 대각 → ④ 아래-왼쪽(최후) 순서로 본다 */
function invNear_(v, r, c){
  function at(rr,cc){
    if(rr>=v.length || cc<0 || cc>=v[rr].length) return null;
    var n=invNum_(v[rr][cc]);
    return n!=null ? {value:n, at:'R'+(rr+1)+'C'+(cc+1)} : null;
  }
  var hit, dr, dc;
  for(dr=1; dr<=8; dr++){ if(hit=at(r+dr, c)) return hit; }          /* ① 같은 열 아래 */
  for(dc=1; dc<=3; dc++){ if(hit=at(r, c+dc)) return hit; }          /* ② 같은 행 오른쪽 */
  for(dr=1; dr<=8; dr++){ for(dc=1; dc<=3; dc++){                    /* ③ 아래-오른쪽 */
    if(hit=at(r+dr, c+dc)) return hit; } }
  for(dr=1; dr<=8; dr++){ if(hit=at(r+dr, c-1)) return hit; }        /* ④ 아래-왼쪽 */
  return null;
}
/** 버킷 1개 값 읽기 */
function invBucket_(ss, cfg){
  if(!cfg || !cfg.sheet) return {value:null, note:'미설정'};
  var sh = invSheetByName_(ss, cfg.sheet);
  if(!sh) return {value:null, note:'탭 없음: '+cfg.sheet};
  if(cfg.cell){
    var n=invNum_(sh.getRange(cfg.cell).getDisplayValue());
    return {value:n, sheet:sh.getName(), at:cfg.cell, note:n==null?'셀이 숫자가 아님':''};
  }
  if(cfg.sum){
    var tot=0, any=false;
    sh.getRange(cfg.sum).getDisplayValues().forEach(function(row){
      row.forEach(function(x){ var n=invNum_(x); if(n!=null){ tot+=n; any=true; } });
    });
    return {value:any?tot:null, sheet:sh.getName(), at:cfg.sum, note:any?'':'범위에 숫자 없음'};
  }
  if(cfg.colSum){
    /* 상위 12행에서 열 헤더 탐색 → 그 아래 전체 숫자 합산 (빈 열이면 0) */
    var hr=Math.min(12, sh.getLastRow());
    var hv=sh.getRange(1,1,hr,sh.getLastColumn()).getDisplayValues();
    var q2=norm_(cfg.colSum);
    for(var r2=0;r2<hv.length;r2++){
      for(var c2=0;c2<hv[r2].length;c2++){
        if(norm_(hv[r2][c2])===q2){
          var body=sh.getRange(r2+2, c2+1, Math.max(sh.getLastRow()-r2-1,1), 1).getDisplayValues();
          var t2=0;
          body.forEach(function(row){ var n=invNum_(row[0]); if(n!=null) t2+=n; });
          return {value:t2, sheet:sh.getName(), at:'col R'+(r2+1)+'C'+(c2+1)+' 이하 합산'};
        }
      }
    }
    return {value:null, sheet:sh.getName(), note:'열 헤더 못 찾음: '+cfg.colSum};
  }
  if(cfg.label){
    var rows=Math.min(15, sh.getLastRow());
    var v=sh.getRange(1,1,rows,sh.getLastColumn()).getDisplayValues();
    var q=norm_(cfg.label);
    for(var r=0;r<v.length;r++){
      for(var c=0;c<v[r].length;c++){
        if(norm_(v[r][c]).indexOf(q)>=0){
          var hit=invNear_(v, r, c);
          if(hit) return {value:hit.value, sheet:sh.getName(), at:hit.at, label:v[r][c]};
        }
      }
    }
    return {value:null, sheet:sh.getName(), note:'라벨 못 찾음: '+cfg.label};
  }
  return {value:null, note:'label/cell/sum 중 하나 필요'};
}
/** 각 탭 상단 요약 블록의 라벨-숫자 후보 목록 (설정 검증용) */
function invCandidates_(sh){
  var rows=Math.min(12, sh.getLastRow());
  if(rows<1) return [];
  var v=sh.getRange(1,1,rows,sh.getLastColumn()).getDisplayValues();
  var out=[];
  for(var r=0;r<v.length && out.length<15;r++){
    for(var c=0;c<v[r].length && out.length<15;c++){
      var t=String(v[r][c]).trim();
      if(!t || invNum_(t)!=null || /^\d{4}-\d{2}/.test(t)) continue;
      var hit=invNear_(v, r, c);
      if(hit) out.push({label:t, value:hit.value, at:hit.at});
    }
  }
  return out;
}
/** 재고 조회: CS 서비스 현황 > 대시보드 탭의 재고 현황 4칸 */
function getInventory_(){
  try{
    var ss = SpreadsheetApp.openById(INVENTORY.SUMMARY.SPREADSHEET_ID);
    var buckets={}, summary={};
    Object.keys(INVENTORY.SUMMARY.BUCKETS).forEach(function(k){
      var cfg = INVENTORY.SUMMARY.BUCKETS[k];
      var b = invBucket_(ss, {sheet:cfg.sheet||INVENTORY.SUMMARY.SHEET,
                              label:cfg.label, cell:cfg.cell, sum:cfg.sum, colSum:cfg.colSum});
      buckets[k]=b; summary[k]=b.value;
    });
    return {success:true,
      spreadsheet:ss.getName(),
      summary:summary, buckets:buckets,
      sheets:ss.getSheets().map(function(s){return {name:s.getName(), gid:s.getSheetId()};}),
      updated:Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm')};
  }catch(err){
    return {success:false, error:'재고 요약 시트 접근 실패: '+err};
  }
}
/* ═══════════ [v2.3] N-care 가입 현황 (점검 PPT용) ═══════════ */
/** 대시보드 시트에서 N-care 가입 현황 표를 라벨 기준으로 읽는다.
 *  반환: {success, tiers:[…5], joined:[…], normal:[…], target:[…], rate:[…],
 *         totalJoined, totalNormal, normalRate, updated} */
function getNcare_(){
  try{
    /* 후보 시트: NCARE 지정 우선 → 재고 요약 스프레드시트의 모든 탭 스캔 */
    var books=[];
    if(NCARE.SPREADSHEET_ID) books.push(SpreadsheetApp.openById(NCARE.SPREADSHEET_ID));
    books.push(SpreadsheetApp.openById(INVENTORY.SUMMARY.SPREADSHEET_ID));
    var candidates=[];
    books.forEach(function(ss){
      var only = NCARE.SHEET ? [ss.getSheetByName(NCARE.SHEET)].filter(Boolean) : ss.getSheets();
      only.forEach(function(sh){ if(sh) candidates.push(sh); });
    });

    /* Basic/Standard 헤더 + N-care 관련 라벨 개수로 점수화 → 최고점 시트 선택 */
    var best=null;
    candidates.forEach(function(sh){
      var v = sh.getDataRange().getDisplayValues();
      var hr=-1, hc=-1;
      for(var r=0;r<v.length && hr<0;r++){
        var rn=v[r].map(norm_);
        var bi=rn.indexOf('basic'), si=rn.indexOf('standard');
        if(bi>=0 && si>=0){ hr=r; hc=bi; }
      }
      if(hr<0) return;
      var flat=norm_(v.map(function(row){return row.join(' ');}).join(' '));
      var score=0;
      ['정상운영','점검대상','점검률','전체가입자','정상운영률','curepass'].forEach(function(kw){
        if(flat.indexOf(norm_(kw))>=0) score++;
      });
      if(!best || score>best.score) best={sh:sh, v:v, hr:hr, hc:hc, score:score};
    });
    if(!best) return {success:false, error:'등급 헤더(Basic/Standard) 있는 시트 없음'};

    var v=best.v, hr=best.hr, hc=best.hc;
    var cols=[hc, hc+1, hc+2, hc+3, hc+4];

    function findRow(cands){
      for(var r=hr;r<v.length;r++){
        for(var c=0;c<v[r].length;c++){
          var t=norm_(v[r][c]);
          for(var k=0;k<cands.length;k++){ if(t && t.indexOf(norm_(cands[k]))>=0) return r; }
        }
      }
      return -1;
    }
    function readCols(r){
      if(r<0) return [null,null,null,null,null];
      return cols.map(function(c){ return (c<v[r].length)? _num_(v[r][c]) : null; });
    }
    function readColsRaw(r){
      if(r<0) return ['','','','',''];
      return cols.map(function(c){ return (c<v[r].length)? String(v[r][c]).trim() : ''; });
    }

    var rJoin  = findRow(['가입 병원 수','가입병원수']);
    var joined = readCols(rJoin>=0 ? rJoin : hr+1);
    var normal = readCols(findRow(['정상운영병원','정상 운영 병원']));
    var target = readCols(findRow(['점검대상','점검 대상']));
    var rate   = readColsRaw(findRow(['점검률']));

    function findVal(cands){
      for(var r=0;r<v.length;r++){
        for(var c=0;c<v[r].length;c++){
          var t=norm_(v[r][c]);
          for(var k=0;k<cands.length;k++){
            if(t && t.indexOf(norm_(cands[k]))>=0){
              var m=String(v[r][c]).match(/(\d[\d,]*)/);
              if(m) return Number(m[1].replace(/,/g,''));
              var near=invNear_(v, r, c); return near?near.value:null;
            }
          }
        }
      }
      return null;
    }
    function findPct(cands){
      for(var r=0;r<v.length;r++){
        for(var c=0;c<v[r].length;c++){
          var t=norm_(v[r][c]);
          for(var k=0;k<cands.length;k++){
            if(t && t.indexOf(norm_(cands[k]))>=0){
              var m0=String(v[r][c]).match(/(\d+%)/); if(m0) return m0[1];
              for(var dc=1;dc<=5;dc++){ var cc=c+dc; if(cc<v[r].length){ var s=String(v[r][cc]).trim(); if(/%/.test(s)) return s; } }
            }
          }
        }
      }
      return null;
    }

    var tiers = NCARE.TIERS.slice();
    var lastHead = (cols[4]<v[hr].length)? String(v[hr][cols[4]]).trim() : '';
    if(lastHead && !/미가입/.test(lastHead)) tiers[4]=lastHead;

    /* 진단용 원본 그리드 (내용 있는 행만, 앞 14열, 20자 절단) */
    var grid=[];
    for(var gr=0; gr<Math.min(v.length,40); gr++){
      var cells=v[gr].slice(0,14).map(function(x){ x=String(x||'').trim(); return x.length>20?x.slice(0,20)+'…':x; });
      if(cells.some(function(x){return x!=='';})) grid.push({r:gr+1, c:cells});
    }

    return {success:true,
      tiers: tiers,
      joined: joined, normal: normal, target: target, rate: rate,
      totalJoined: findVal(['전체 가입자','전체가입자']),
      totalNormal: findVal(['정상 운영 병원','N-care 운영 현황','ncare운영현황']),
      normalRate:  findPct(['정상 운영률','정상운영률']),
      sheet: best.sh.getName(), spreadsheet: best.sh.getParent().getName(),
      headerRow: hr+1, basicCol: hc+1, score: best.score, grid: grid,
      updated: Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm')};
  }catch(err){
    return {success:false, error:'N-care 현황 시트 접근 실패: '+err};
  }
}
function _num_(s){
  var t=String(s==null?'':s).trim().replace(/,/g,'');
  if(t==='' || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** 진단용 — 편집기에서 실행: 요약 탭 라벨-숫자 후보 + 버킷 결과 */
function inspectInventory(){
  var r = getInventory_();
  try{
    var ss = SpreadsheetApp.openById(INVENTORY.SUMMARY.SPREADSHEET_ID);
    var sh = invSheetByName_(ss, INVENTORY.SUMMARY.SHEET);
    if(sh) r.candidates = invCandidates_(sh);
  }catch(e){}
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}
/** 재고 원장 열 매핑: 품명·사용일이 있는 헤더 행 탐지, SN 3개 열 위치 분리 */
function findLedgerCols_(sh){
  var rows=Math.min(12, sh.getLastRow());
  if(rows<1) return null;
  var v=sh.getRange(1,1,rows,sh.getLastColumn()).getDisplayValues();
  for(var r=0;r<rows;r++){
    var h=v[r].map(function(x){return String(x).trim();});
    if(h.indexOf('품명')>=0 && h.indexOf('사용일')>=0){
      var m={row:r+1};
      ['품명','출고일','출고처','출고수량','사용일','사용자','사용처','사용수량'].forEach(function(k){ m[k]=h.indexOf(k)+1; });
      var snCols=[]; h.forEach(function(x,i){ if(x.toUpperCase()==='SN') snCols.push(i+1); });
      m.snOut = snCols.filter(function(c){return m['출고수량'] && c>m['출고수량'];})[0] || 0;  /* 출고 SN */
      m.snUse = snCols.filter(function(c){return m['사용수량'] && c>m['사용수량'];})[0] || 0;  /* 회수(탈거) SN */
      return m;
    }
  }
  return null;
}

/** handover 기록 → 재고 원장 사용처 자동 기입
 *  규칙: 유상(교체비용 있음)=새제품 탭 우선, 무상=Repair 탭 우선 / 풋스위치는 담당자 출고분 매칭 */
function invRecordUsage_(p){
  try{
    if(!INVENTORY.SPREADSHEET_ID) return {done:false, msg:''};
    var ss=invOpen_();
    var snIn=String(p.hpIn||'').trim().toUpperCase();
    var isFoot=/풋|FOOT/i.test(String(p.part||''));
    var today=p.date||Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd');

    /* ① HP 교체: 장착 SN을 출고 SN에서 찾아 기입 */
    if(snIn){
      var paidNew = Number(String(p.cost||'').replace(/[^\d]/g,''))>0;
      var order = paidNew
        ? ['CS 재고 수량(새제품)','CS 재고 수량(Repair)']
        : ['CS 재고 수량(Repair)','CS 재고 수량(새제품)'];
      for(var t=0;t<order.length;t++){
        var sh=invSheetByName_(ss, order[t]); if(!sh) continue;
        var m=findLedgerCols_(sh); if(!m||!m.snOut||!m['사용일']) continue;
        var last=sh.getLastRow(); if(last<=m.row) continue;
        var n=last-m.row;
        var sns =sh.getRange(m.row+1, m.snOut,    n,1).getDisplayValues();
        var uses=sh.getRange(m.row+1, m['사용일'],n,1).getDisplayValues();
        for(var i=0;i<n;i++){
          if(String(sns[i][0]).trim().toUpperCase()===snIn && String(uses[i][0]).trim()===''){
            var row=m.row+1+i;
            sh.getRange(row, m['사용일']).setValue(today);
            if(m['사용자'])   sh.getRange(row, m['사용자']).setValue(p.fse||'');
            if(m['사용처'])   sh.getRange(row, m['사용처']).setValue(p.hosp||'');
            if(m['사용수량']) sh.getRange(row, m['사용수량']).setValue(1);
            if(m.snUse && p.hpOut) sh.getRange(row, m.snUse).setValue(String(p.hpOut).trim().toUpperCase());
            return {done:true, msg:'재고['+sh.getName()+'] '+snIn+' → '+(p.hosp||'')+' 기입 (행 '+row+')'};
          }
        }
      }
      return {done:false, msg:'재고: 출고 SN '+snIn+' 미발견 — 미출고이거나 이미 기입됨'};
    }

    /* ② 풋스위치 교체: SN 없음 → 담당자 출고분 중 미사용 첫 행 */
    if(isFoot){
      var fsh=invSheetByName_(ss,'CS 재고 수량(풋스위치)');
      if(!fsh) return {done:false, msg:''};
      var fm=findLedgerCols_(fsh);
      if(!fm||!fm['출고처']||!fm['사용일']) return {done:false, msg:''};
      var lastF=fsh.getLastRow(); if(lastF<=fm.row) return {done:false, msg:''};
      var nf=lastF-fm.row;
      var outs=fsh.getRange(fm.row+1, fm['출고처'], nf,1).getDisplayValues();
      var usef=fsh.getRange(fm.row+1, fm['사용일'], nf,1).getDisplayValues();
      for(var j=0;j<nf;j++){
        if(String(outs[j][0]).trim()===String(p.fse||'').trim() && String(usef[j][0]).trim()===''){
          var rw=fm.row+1+j;
          fsh.getRange(rw, fm['사용일']).setValue(today);
          if(fm['사용자'])   fsh.getRange(rw, fm['사용자']).setValue(p.fse||'');
          if(fm['사용처'])   fsh.getRange(rw, fm['사용처']).setValue(p.hosp||'');
          if(fm['사용수량']) fsh.getRange(rw, fm['사용수량']).setValue(1);
          return {done:true, msg:'재고[풋스위치] '+(p.fse||'')+' 보유분 → '+(p.hosp||'')+' 기입 (행 '+rw+')'};
        }
      }
      return {done:false, msg:'재고: '+(p.fse||'')+' 앞으로 출고된 풋스위치 잔여분 없음'};
    }

    return {done:false, msg:''};  /* 교체 없음 → 재고 기입 대상 아님 */
  }catch(e){
    return {done:false, msg:'재고 기입 실패: '+e};
  }
}




/** 3단계 원칙 가이드 텍스트 */
function getGuide_(type){
  if(!type) return {success:false, error:'type 파라미터 필요'};
  var m = getMaster_();
  var g = m.guides[type];
  var all = readAll_();
  var q = norm_(type);
  var cases = all.rows.filter(function(o){ return norm_(o['유형'])===q; }).slice(-3).reverse().map(slim_);
  var text =
    '📌 ['+type+'] 대응 가이드\n\n'+
    '1️⃣ 문제 확인\n'+ ((g&&g.chk) ? g.chk : ' - 증상 재현 및 발생 조건(장비 S/N·HP Ver·노즐 상태) 확인\n - 최근 동일 유형 이력 '+cases.length+'건 참조') +'\n\n'+
    '2️⃣ 문제 해결\n'+ ((g&&g.fix) ? g.fix : (cases.length ? cases.map(function(c){return ' - ['+c.date+' '+c.hosp+'] '+(c.part!=='없음'&&c.part?('교체품: '+c.part+' / '):'')+(c.detail||'').split('\n')[0];}).join('\n') : ' - 유형마스터 시트에 해결 절차를 등록해 주세요.')) +'\n\n'+
    '3️⃣ 후속 조치\n'+ ((g&&g.fup) ? g.fup : ' - 조치 완료 후 정상 동작을 담당자에게 시각적으로 확인\n - 처리 내용을 현장 처리 현황 시트에 당일 기록\n - N-Care/보증 대상 여부 확인 후 비용 안내');
  return {success:true, type:type, guide:text, recentCases:cases};
}

/* ═══════════════ [v2.1] 인증 토큰 검증 (auth 웹앱 연동) ═══════════════ */
/** 토큰을 인증 서버에 검증 → 레벨(0=무효, 1=일반, 2=관리자, 3=수석 매니저)
 *  ※ 반드시 GET 사용: GAS→GAS POST는 302 리다이렉트를 POST로 재시도해
 *    "Page Not Found"가 되는 UrlFetchApp 고질 문제가 있다 (GET은 정상). */
function verifyLevel_(token){
  try{
    if(!MENU.AUTH_VERIFY_URL || !token) return 0;
    var res = UrlFetchApp.fetch(
      MENU.AUTH_VERIFY_URL + '?action=verify&token=' + encodeURIComponent(String(token)),
      { method:'get', muteHttpExceptions:true, followRedirects:true });
    var r = JSON.parse(res.getContentText()||'{}');
    return (r && r.ok) ? (Number(r.level)||0) : 0;
  }catch(e){ return 0; }
}

/** [v2.1] 수석 매니저 가이드 게이트 — guide는 Lv.3 토큰 필요
 *  (master는 handover.html 대분류/소분류 드롭다운이 쓰므로 계속 개방) */
function gateGuide_(p){
  var lv = verifyLevel_(p.token||'');
  if(lv < 3){
    return {success:false, error: MENU.AUTH_VERIFY_URL
      ? 'unauthorized — 수석 매니저(Lv.3) 인증 필요'
      : 'AUTH_VERIFY_URL 미설정 — 가이드 접근 거부'};
  }
  return getGuide_(p.type||'');
}

/* ═══════════════ [v2.1] 주간업무보고 (weekly.html 연동) ═══════════════ */
/** 'YYYY-MM-DD' | 'YYYY. M. D' 등 → Date (실패 시 null) */
function parseD_(s){
  var t=String(s||'').replace(/\s/g,'').replace(/\./g,'-').replace(/-+$/,'');
  var pth=t.split('-');
  var y=Number(pth[0])||0, m=Number(pth[1])||0, d=Number(pth[2])||0;
  if(m>12){ var s1=String(pth[1]||'');
    if(s1.length===3){ m=Number(s1[0]); d=Number(s1.slice(1)); }
    else if(s1.length===4){ m=Number(s1.slice(0,2)); d=Number(s1.slice(2)); }
    if(m>12){ m=0; d=0; } }
  if(d>31) d=0;
  return (y&&m&&d) ? new Date(y, m-1, d) : null;
}

/** GET ?action=weekly&fse=이름&mon=YYYY-MM-DD(월요일)
 *  보고 주간(전주 토요일 ~ 금요일) + 담당자 필터된 handover 기록 반환 */
function wkGetWeekly_(p){
  var fse = String(p.fse||'').trim();
  var monS = String(p.mon||'').trim();
  if(!monS) return {success:false, error:'mon(주 시작일 YYYY-MM-DD) 파라미터 필요'};
  var mon = parseD_(monS);
  if(!mon) return {success:false, error:'mon 형식 오류: '+monS};
  var sat = new Date(mon); sat.setDate(sat.getDate()-2);            /* 전주 토요일부터 */
  var fri = new Date(mon); fri.setDate(fri.getDate()+4); fri.setHours(23,59,59,0);
  var qf = norm_(fse);
  var rows = readAll_().rows.map(slim_).filter(function(r){
    var d = parseD_(r.date);
    if(!d || d<sat || d>fri) return false;
    if(!qf) return true;
    var f = norm_(r.fse);
    return !!f && (f===qf || f.indexOf(qf)>=0 || qf.indexOf(f)>=0);
  });
  return {success:true, fse:fse, mon:monS, count:rows.length, data:rows,
          updated:Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm')};
}

/** POST {action:'weeklywrite', writer, mon, week, range, body}
 *  업무보고서_CS의 작성자 탭(이름+SUFFIX, 예: 권오성2) 최상단에 삽입
 *  기록 형식: [기록일시 | 주차 | 기간 | 본문] 4열 */
function wkWrite_(p){
  if(!WEEKLY.REPORT_SS_ID)
    return {success:false, error:'WEEKLY.REPORT_SS_ID 미설정 — 업무보고서_CS 스프레드시트 ID를 입력하세요'};
  var writer = String(p.writer||'').trim();
  if(!writer) return {success:false, error:'writer(작성자) 필요'};
  var body = String(p.body||'').trim();
  if(!body) return {success:false, error:'body(본문) 필요'};

  var ss = SpreadsheetApp.openById(WEEKLY.REPORT_SS_ID);
  var tab = writer + WEEKLY.TAB_SUFFIX;                  /* 권오성 → 권오성2 */
  var sh = ss.getSheetByName(tab);
  if(!sh){                                               /* 공백 차이 등 정규화 폴백 */
    var q = norm_(tab);
    sh = ss.getSheets().filter(function(s){ return norm_(s.getName())===q; })[0] || null;
  }
  if(!sh) return {success:false, error:'탭 없음: '+tab+' — 업무보고서_CS에 작성자 탭을 만들어 주세요'};

  var at = Math.min(WEEKLY.HEADER_ROW, Math.max(sh.getLastRow(),1));
  sh.insertRowAfter(at);                                 /* 헤더 바로 아래 = 최상단 삽입 */
  var row = at+1;
  sh.getRange(row, 1, 1, 4).setValues([[
    Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm'),
    String(p.week||''), String(p.range||''), body
  ]]);
  sh.getRange(row, 4).setWrap(true);
  return {success:true, sheet:sh.getName(), row:row};
}

/* ═══════════ [v2.2] 허브 메뉴 관리 (index.html 연동 · 표시/레벨/순서) ═══════════ */
/** GET ?action=menu → {success, menu:[{id,name,show,level,order}…]}
 *  메뉴설정 탭: [id | name | show | level | order | 저장일시]
 *  (v2.1의 '숨김 key 목록' 구형 시트도 읽어서 menu 형식으로 변환) */
function menuGet_(){
  var sh = sheet_(MENU.SHEET);
  var now = Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm');
  if(!sh) return {success:true, menu:[], updated:now};   /* 탭 없으면 기본값 동작 */
  var v = sh.getDataRange().getDisplayValues();
  if(v.length<2) return {success:true, menu:[], updated:now};
  var head = v[0].map(norm_);
  var menu = [];
  if(head.indexOf('id')>=0){                             /* v2.2 형식 */
    for(var i=1;i<v.length;i++){
      var id = String(v[i][0]||'').trim();
      if(!id) continue;
      menu.push({ id:id, name:String(v[i][1]||'').trim(),
                  show: norm_(v[i][2])!=='false' && norm_(v[i][2])!=='x' && norm_(v[i][2])!=='숨김',
                  level: Number(v[i][3])||1, order: Number(v[i][4])||99 });
    }
  }else{                                                 /* v2.1 구형: 숨김 key 목록 */
    for(var j=1;j<v.length;j++){
      var k = String(v[j][0]||'').trim();
      if(k) menu.push({id:k, name:'', show:false, level:1, order:99});
    }
  }
  return {success:true, menu:menu, updated:now};
}

/** POST {action:'menu_save', token, menu:[{id,name,show,level,order}…]} — Lv.3 토큰 필수
 *  (구버전 프런트의 hidden:[key…] 형식도 수용) */
function menuSave_(p){
  var lv = verifyLevel_(p.token||'');
  if(lv < 3){
    return {success:false, error: MENU.AUTH_VERIFY_URL
      ? 'unauthorized — 보안레벨 3(수석 매니저) 토큰 필요'
      : 'AUTH_VERIFY_URL 미설정 — 저장 거부'};
  }
  var menu = Array.isArray(p.menu) ? p.menu : null;
  if(!menu && Array.isArray(p.hidden)){                  /* 구형 페이로드 변환 */
    menu = p.hidden.map(function(k){ return {id:String(k).trim(), name:'', show:false, level:1, order:99}; });
  }
  if(!menu) return {success:false, error:'menu(또는 hidden) 배열 필요'};

  var sh = sheet_(MENU.SHEET) || ss_().insertSheet(MENU.SHEET);
  sh.clearContents();
  var now = Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm');
  var rows = [['id','name','show','level','order','저장일시']];
  menu.forEach(function(m){
    if(!m || !m.id) return;
    rows.push([ String(m.id).trim(), String(m.name||''),
                m.show===false ? 'FALSE' : 'TRUE',
                Number(m.level)||1, Number(m.order)||99, now ]);
  });
  sh.getRange(1,1,rows.length,6).setValues(rows);
  return {success:true, count:rows.length-1, updated:now};
}

/* ═══════════ [v2.5] 진행중 + 현장 일정(인원별 업무 큐) 공유 상태 ═══════════
 *  ScriptProperties에 단일 JSON 저장:
 *    { queues:{담당자:[{h:병원명, s:'wait'|'prog'|'done'} ...]},   // 단일 진실 소스
 *      prog:{병원명:담당자},   // 파생: 각 큐의 s==='prog'
 *      done:{병원명:1},        // 파생: s==='done' + 레거시 완료 표기
 *      updated }
 *  불변량: 큐당 prog 최대 1개. wait 있고 prog 없으면 맨 앞 wait 자동 승격.
 *  op 기반 원자적 갱신(LockService)으로 다중 사용자 동시 편집 시 덮어쓰기 방지.
 *  GET  ?action=progress
 *  POST {action:'progress_save', op, ...}
 *    큐:   q_add{fse,hosp} · q_remove{fse,hosp} · q_move{fse,hosp,to} · q_done{fse,hosp} · q_clear{fse}
 *    레거시: set{hosp,fse} · clear{hosp} · done{hosp} · replace{prog,done}
 */
function progRead_(){
  var raw = PropertiesService.getScriptProperties().getProperty('cs_progress') || '{}';
  var o = {}; try{ o = JSON.parse(raw) || {}; }catch(e){ o = {}; }
  if(!o.prog   || typeof o.prog   !== 'object') o.prog = {};
  if(!o.done   || typeof o.done   !== 'object') o.done = {};
  if(!o.queues || typeof o.queues !== 'object') o.queues = {};
  /* [v2.6] 일일 자동 초기화: 날짜(Asia/Seoul)가 바뀌면 어제 일정을 비운다 */
  var today = Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd');
  if(o.day && o.day !== today){ o.queues = {}; o.prog = {}; o.done = {}; o._reset = true; }
  o.day = today;
  /* 레거시 prog(큐 없이 저장된 진행중)을 큐로 마이그레이션 */
  Object.keys(o.prog).forEach(function(hosp){
    var fse = o.prog[hosp];
    var q = qEnsure_(o, fse);
    if(qFind_(q, hosp) < 0) q.unshift({h:hosp, s:'prog'});
  });
  return o;
}
function qEnsure_(o, fse){ if(!o.queues[fse]) o.queues[fse] = []; return o.queues[fse]; }
function qFind_(q, hosp){ for(var i=0;i<q.length;i++){ if(q[i].h===hosp) return i; } return -1; }
function qRemoveAll_(o, hosp){
  Object.keys(o.queues).forEach(function(fse){
    o.queues[fse] = o.queues[fse].filter(function(x){ return x.h !== hosp; });
  });
}
/** 큐 → prog/done 파생 재계산. wait 있고 prog 없으면 맨 앞 wait 승격 */
function deriveProg_(o){
  var prog = {};
  Object.keys(o.queues).forEach(function(fse){
    var q = o.queues[fse];
    if(!q.length){ delete o.queues[fse]; return; }
    if(!q.some(function(x){ return x.s==='prog'; })){
      for(var i=0;i<q.length;i++){ if(q[i].s==='wait'){ q[i].s='prog'; break; } }
    }
    q.forEach(function(it){
      if(it.s==='prog') prog[it.h] = fse;
      if(it.s==='done') o.done[it.h] = 1;
    });
  });
  o.prog = prog;
}
function progGet_(){
  var o = progRead_();
  deriveProg_(o);
  if(o._reset){ delete o._reset; try{ PropertiesService.getScriptProperties().setProperty('cs_progress', JSON.stringify(o)); }catch(e){} }  // 일일 초기화 영속화
  return {success:true, queues:o.queues, prog:o.prog, done:o.done, updated:o.updated||''};
}
function progSave_(p){
  var lock = LockService.getScriptLock();
  try{
    lock.waitLock(15000);
    var o = progRead_();
    var op   = String(p.op||'').trim();
    var hosp = String(p.hosp||'').trim();
    var fse  = String(p.fse||'').trim();

    if(op==='q_add' && fse && hosp){
      qRemoveAll_(o, hosp);                 // 한 병원은 한 사람의 일정에만
      qEnsure_(o, fse).push({h:hosp, s:'wait'});
      if(o.done[hosp]) delete o.done[hosp];
    } else if(op==='q_remove' && fse && hosp){
      var qr = qEnsure_(o, fse); var ir = qFind_(qr, hosp);
      if(ir>=0) qr.splice(ir,1);
    } else if(op==='q_move' && fse && hosp){
      var qm = qEnsure_(o, fse); var im = qFind_(qm, hosp);
      if(im>=0){
        var to = Math.max(0, Math.min(qm.length-1, Number(p.to)));
        var item = qm.splice(im,1)[0];
        qm.splice(to, 0, item);
      }
    } else if(op==='q_done' && fse && hosp){
      var qd = qEnsure_(o, fse); var id = qFind_(qd, hosp);
      if(id>=0){ qd[id].s='done'; o.done[hosp]=1; }
    } else if(op==='q_clear' && fse){
      delete o.queues[fse];
    } else if(op==='set' && hosp){
      qRemoveAll_(o, hosp);
      var qs = qEnsure_(o, fse);
      qs.forEach(function(x){ if(x.s==='prog') x.s='wait'; });   // 기존 prog 강등
      qs.unshift({h:hosp, s:'prog'});
      if(o.done[hosp]) delete o.done[hosp];
    } else if(op==='clear' && hosp){
      qRemoveAll_(o, hosp);
    } else if(op==='done' && hosp){
      var found=false;
      Object.keys(o.queues).forEach(function(f){
        var q=o.queues[f], i=qFind_(q,hosp);
        if(i>=0){ q[i].s='done'; found=true; }
      });
      o.done[hosp]=1;
    } else if(op==='replace'){
      o.queues = {};
      o.prog = (p.prog && typeof p.prog==='object') ? p.prog : {};
      o.done = (p.done && typeof p.done==='object') ? p.done : {};
      Object.keys(o.prog).forEach(function(h){ qEnsure_(o, o.prog[h]).push({h:h, s:'prog'}); });
    } else {
      return {success:false, error:'알 수 없는 op: '+op};
    }
    deriveProg_(o);
    if(o._reset) delete o._reset;
    o.updated = Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm:ss');
    PropertiesService.getScriptProperties().setProperty('cs_progress', JSON.stringify(o));
    return {success:true, queues:o.queues, prog:o.prog, done:o.done, updated:o.updated};
  }catch(err){
    return {success:false, error:String(err)};
  }finally{
    try{ lock.releaseLock(); }catch(_){}
  }
}