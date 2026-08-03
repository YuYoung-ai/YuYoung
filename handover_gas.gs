/*******************************************************************
 * BAZ BIOMEDIC CS — 현장 처리 현황(handover) 확장 웹앱  v2.9.0
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
 *  GET ?action=labellist&from=&to=&fse= : [v2.8] label.html 장비 Label List 원본
 *  GET ?action=snphoto&ids=ID,ID : [v2.8] 장비 S/N 사진 base64 (Drive CORS 우회 프록시)
 *
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║ ★★ v2.8 적용 순서 — 이 순서를 지키지 않으면 웹앱 전체가 멈춥니다 ★★  ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *  v2.8은 사진 저장 때문에 Drive 서비스(DriveApp)를 새로 씁니다. Apps Script는
 *  코드에 있는 서비스로 필요한 권한을 정하는데, 새 권한을 "승인하기 전"에 배포하면
 *  ping·all·recent·menu 까지 전부 권한 오류로 실패합니다.
 *  → 대시보드·허브·현장 처리완료가 한꺼번에 "접속 오류"로 먹통이 됩니다.
 *
 *  1) 편집기에 이 코드를 붙여넣고 [저장]
 *  2) ★먼저★ 함수 목록에서 setupSnPhotoColumn 을 골라 [실행]
 *     → 권한 승인 창이 뜨면 승인 (U열 '장비 S/N 사진' 헤더도 이때 생깁니다)
 *  3) 그 다음에 [배포 > 배포 관리 > ✏️ > 버전: 새 버전 > 배포]
 *     ※ "새 배포"가 아님 — URL이 바뀌면 앱 전체가 깨집니다
 *  4) 확인: 브라우저로 배포 URL + ?action=ping 을 열어
 *     {"success":true,"ver":"2.8.0"} 이 보이면 정상입니다.
 *     구글 권한 오류 페이지가 보이면 2)를 아직 안 한 것입니다.
 *
 *  ※ 조직 정책으로 이 스크립트에 Drive 권한을 줄 수 없다면 v2.8은 쓸 수 없습니다.
 *    (사진 기능만 끄는 방법은 없습니다 — 코드에 DriveApp 이 있으면 권한이 필요합니다)
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

/* [v2.8] 장비 S/N 사진 — Drive 업로드 + 시트 U열 =IMAGE() 썸네일
   ※ =IMAGE()가 그림을 그리려면 파일이 "링크가 있는 사람은 보기 가능" 이어야 한다.
     (URL을 아는 사람은 사진을 볼 수 있다는 뜻 — 사내 공유 범위로만 쓸 것)
   ※ 사진을 시트에 노출하고 싶지 않으면 SHARE:false 로 두면 되지만,
     그 경우 U열 썸네일은 렌더링되지 않고 label.html 불러오기만 동작한다. */
var PHOTO = {
  FOLDER_ID  : '',                    // 비우면 아래 이름으로 자동 생성 후 ScriptProperties에 기억
  FOLDER_NAME: '현장처리_장비SN사진',
  COL_NAME   : '장비 S/N 사진',       // 시트 헤더(U열)
  SHARE      : true,                  // 링크 공유(=IMAGE 렌더링에 필요)
  THUMB_W    : 600,                   // =IMAGE()가 부르는 썸네일 가로폭(px)
  ROW_HEIGHT : 80                     // 사진이 있는 행의 높이(pt) · 0이면 행 높이를 바꾸지 않음
};
var PHOTO_COLS = ['장비 S/N 사진','장비SN사진','장비 SN 사진','SN 사진'];

/* [v2.9] 장비 Label list 시트 — 이미 작성한 병원 제외 + 작성일자 기록
   실제 구성:  A 병원명 | B 작성 유/무(체크박스) | C 작성일자 | D 작성 완료 | E 잔여 병원 수 | … | I 병원명
   B가 체크된 병원 = 이미 라벨을 만든 곳 → 다시 뽑으면 중복이므로 불러오기에서 뺀다.
   내려받으면 그 병원들의 B를 체크하고 C에 그날 날짜를 적는다(이미 적힌 날짜는 보존).
   ※ I열(작성 대기 목록)과 D·E 수식은 건드리지 않는다 — 수기 관리 영역.
   ※ 열 위치가 바뀌어도 헤더 이름으로 찾고, 못 찾으면 FALLBACK 위치를 쓴다. */
var LABELS = {
  SHEET     : '장비 Label list',
  HOSP_COLS : ['병원명','병원','거래처명'],
  DONE_COLS : ['작성 유/무','작성유무','작성 유무','작성여부','작성 여부','중복','체크'],
  DATE_COLS : ['작성일자','작성 일자','작성일','기록일'],
  FALLBACK  : { hosp:1, done:2 },  // 헤더를 못 찾을 때: A열 병원명 · B열 체크박스
  HEADER_SCAN: 5                   // 헤더 행 탐색 범위
};

/* 앱이 직접 기록하는 열 — 이 외의 열(NO·거래처·N-Care·보증기한 등
   수식/자동 열)은 절대 건드리지 않는다.
   ※ 장비SN(Q열)·장비 S/N 사진(U열)·HP_SN(IN/OUT)·Ver는 payload 값이 있을 때만 별도로 기록 */
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

/* [주간 자동기재 대상] — 처리내용 자동완성(handover)·비고 태그(weekly)를 적용할 인원(학습 대상) 목록
   '주간자동설정' 탭 A열(2행부터)에 이름(handover=FSE / weekly=작성자). Lv.3 관리자만 저장 가능. */
var WEEKLY_AUTO = { SHEET: '주간자동설정' };

/* [처리내용 템플릿] — handover 입력 시 대상 인원에게 1차 자동완성할 처리내용 문구
   '처리내용템플릿' 탭 헤더: 대분류 | 유형 | 교체품 | 처리내용 (관리자가 직접 편집) */
var CONTENT_TPL = { SHEET: '처리내용템플릿' };

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
             colBy_(hdr,['장비SN','장비 SN']),
             colBy_(hdr,['NS 충진 여부','NS충진여부']),
             colBy_(hdr,['NS 충진량','NS충진량']),
             colBy_(hdr,['젯 분사 판단','젯분사 판단']),
             colBy_(hdr, PHOTO_COLS)].filter(Boolean));
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

/** [v2.8] 로그용 payload — base64 사진은 요약 문자열로 대체한다.
 *  (dataURL을 그대로 남기면 전송로그 셀이 5만자 한도를 넘겨 기록 자체가 실패한다) */
function logSafe_(payload){
  if(!payload || typeof payload !== 'object') return payload;
  var o = {}, keys = Object.keys(payload);
  for(var i=0;i<keys.length;i++) o[keys[i]] = payload[keys[i]];
  if(o.snPhoto){
    var kb = Math.round(String(o.snPhoto).length * 3 / 4 / 1024);
    o.snPhoto = '[photo ' + kb + 'KB]';
  }
  return o;
}

/* ================= POST: 행 기록 ================= */
function doPost(e){
  var lock = LockService.getScriptLock();
  var payload = {};
  var photoFile = null;      /* [v2.8] 락 잡기 전에 끝내 둔 사진 업로드 결과 */
  try{
    payload = JSON.parse(e.postData.contents||'{}');

    /* [보안] 모든 쓰기는 로그인 토큰 필수 — 외부인의 무단 기록·시트 오염 차단.
       (menu_save·weeklyauto_save 는 각자 Lv.3 검증을 별도로 수행하므로 여기서 제외)
       ※ 사진 업로드보다 반드시 먼저 — 인증 없는 요청이 Drive에 파일을 남기면 안 된다. */
    var actName = (payload && payload.action) || '';
    if(actName !== 'menu_save' && actName !== 'weeklyauto_save'){
      var denied = requireWrite_(payload);
      if(denied) return json_(denied);
    }

    /* [v2.8] 같은 기록의 재전송을 걸러낸다(멱등성).
       콜드스타트 때 GAS가 JSON 대신 HTML을 돌려주면 프런트의 1차 요청은 "실패"로 보이고
       no-cors 로 같은 내용을 한 번 더 보낸다. 그런데 1차 요청이 서버에서는 이미 기록됐을
       수 있어, 그대로 두면 같은 행이 두 줄 쌓이고 사진도 Drive에 두 번 올라간다.
       프런트가 붙여 보낸 reqId 를 10분간 기억해 두 번째 요청은 첫 결과를 그대로 돌려준다. */
    var reqId = String((payload && payload.reqId) || '').replace(/[^A-Za-z0-9_-]/g,'').slice(0,64);
    var dkey = reqId ? 'req_' + reqId : '';
    var dcache = null;
    if(dkey){
      try{
        dcache = CacheService.getScriptCache();
        var seen = dcache.get(dkey);
        if(seen) return ContentService.createTextOutput(seen).setMimeType(ContentService.MimeType.JSON);
      }catch(_){ dcache = null; }
    }

    /* [v2.8] 사진 업로드는 락 "밖"에서 먼저 끝낸다.
       Drive는 콜드스타트 때 몇 초씩 걸리는데, 그걸 락 안에서 하면 동시에 기록하는
       두 번째 FSE가 20초 대기를 넘겨 통째로 실패한다. 업로드는 행 번호와 무관하므로
       미리 해 두고, 락 안에서는 수식 한 줄만 쓴다. */
    if(payload && payload.snPhoto && !actName){
      try{
        photoFile = savePhoto_(payload.snPhoto, {
          date: payload.date || '', hosp: payload.hosp || '', sn: payload.sn || ''
        });
      }catch(pe){
        photoFile = null;    /* 업로드 실패해도 본 기록은 그대로 진행한다 */
        log_('PHOTO_ERR:'+pe, null, {hosp:payload.hosp||'', sn:payload.sn||''});
      }
    }

    /* [성능] 현장 일정(진행중) 저장은 전역 락 "밖"에서 처리한다.
       hospital-pc 가 진행중 토글마다 쏘는 고빈도 경로인데, 예전에는 handover 행 기록과
       같은 20초 락에 묶여 직렬화됐다. 기록 쓰기가 느려지면(시트가 커질수록) 이쪽까지
       waitLock 20초를 넘겨 통째로 실패했다. 이 둘은 서로 다른 저장소를 쓰고
       (progress = ScriptProperties, 기록 = 시트) progSave_/progRestore_ 는 각자 자체
       락을 갖고 있으므로 전역 락이 필요 없다. */
    if(payload && payload.action==='progress_save') return json_(progSave_(payload));  /* [v2.4] 진행중 공유 상태 */
    if(payload && payload.action==='progress_restore') return json_(progRestore_(payload));  /* [v2.7] 스냅샷에서 일정 복구(Lv.3) */

    lock.waitLock(20000);

    /* [v2.1] JSON 파싱 직후 신규 액션 라우팅 — handover 행 기록보다 먼저
       (아래 액션들은 자체 락이 없어 전역 락 안에 둔다) */
    if(payload && payload.action==='weeklywrite') return json_(wkWrite_(payload));
    if(payload && payload.action==='menu_save')   return json_(menuSave_(payload));
    if(payload && payload.action==='weeklyauto_save') return json_(weeklyAutoSave_(payload));  /* 주간 자동기재 대상 저장(Lv.3) */
    if(payload && payload.action==='labeldone')    return json_(labelDone_(payload));  /* [v2.9] 내려받은 병원 작성 일자 기록 */

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
    /* 사용자 숙련도 평가 (R·S·T열 · 열이 존재하고 값이 있을 때만) */
    var nsFillCol = colBy_(hdr, ['NS 충진 여부','NS충진여부','NS 충진']);
    if(nsFillCol && payload.nsFill) sh.getRange(row, nsFillCol).setValue(payload.nsFill);
    var nsAmtCol  = colBy_(hdr, ['NS 충진량','NS충진량']);
    if(nsAmtCol && payload.nsAmt) sh.getRange(row, nsAmtCol).setValue(payload.nsAmt);
    var jetCol    = colBy_(hdr, ['젯 분사 판단','젯분사 판단','젯 분사']);
    if(jetCol && payload.jet) sh.getRange(row, jetCol).setValue(payload.jet);
    /* HP 교체 정보 (열이 존재할 때만) */
    if(hdr.map['HP_SN(IN)']  && payload.hpIn)  sh.getRange(row, hdr.map['HP_SN(IN)']).setValue(payload.hpIn);
    if(hdr.map['__VER_IN']   && payload.uVer)  sh.getRange(row, hdr.map['__VER_IN']).setValue(payload.uVer);
    if(hdr.map['HP_SN(OUT)'] && payload.hpOut) sh.getRange(row, hdr.map['HP_SN(OUT)']).setValue(payload.hpOut);
    if(hdr.map['__VER_OUT']  && payload.wVer)  sh.getRange(row, hdr.map['__VER_OUT']).setValue(payload.wVer);
    /* [v2.8] 장비 S/N 사진 (U열) — 업로드는 위에서 이미 끝났고 여기선 수식만 쓴다 */
    var photoCol = photoFile ? colBy_(hdr, PHOTO_COLS) : 0;
    var photoWarn = '';
    if(photoCol){
      sh.getRange(row, photoCol).setFormula(photoFormula_(photoFile.id));
      if(PHOTO.ROW_HEIGHT > 0) sh.setRowHeight(row, PHOTO.ROW_HEIGHT);
    }else if(photoFile){
      /* 사진은 Drive에 올라갔는데 넣을 열이 없다 → 그냥 두면 조용히 사라진다.
         (setupSnPhotoColumn() 을 아직 실행하지 않은 시트) */
      photoWarn = '시트에 \''+PHOTO.COL_NAME+'\' 열이 없어 사진이 기록되지 않았습니다 — '
                + '편집기에서 setupSnPhotoColumn() 을 실행하세요.';
      log_('PHOTO_NOCOL', hdr, {file:photoFile.id, url:photoFile.url});
    }

    log_('OK', hdr, logSafe_(payload));
    /* 방금 쓴 기록이 조회에 바로 보이도록 관련 캐시를 전부 비운다.
       (조각 캐시라 remove 하나로는 안 되고 bazCacheDrop_ 를 써야 한다) */
    bazDropHandoverCaches_(payload && payload.hosp);
    /* 재고 원장 사용처 자동 기입 (실패해도 본 기록에는 영향 없음) */
    var inv = invRecordUsage_(payload);
    if(inv.msg) log_(inv.done?'INV_OK':'INV_SKIP', hdr, {inv:inv.msg});
    var msg = '✅ '+ (payload.hosp||'') +' 기록 완료 (행 '+row+')';
    if(photoWarn) msg += '\n⚠️ ' + photoWarn;
    if(inv.msg) msg += '\n' + (inv.done?'✅ ':'⚠️ ') + inv.msg;
    var out = {success:true, row:row, sheet:CONFIG.SHEET_NAME, inv:inv, msg:msg};
    /* 재전송이 같은 결과를 받도록 결과를 10분 기억 (위 reqId 중복 차단과 한 쌍) */
    if(dkey && dcache){ try{ dcache.put(dkey, JSON.stringify(out), 600); }catch(_){} }
    return json_(out);
  }catch(err){
    log_('ERR:'+err, null, logSafe_(payload));
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
    /* [보안] 조회 API도 로그인 토큰 필수 — 외부인의 업무 데이터 열람 차단.
       예외: ping(연결 진단), menu(index.html 로그인 화면이 로그인 전에 호출·업무 데이터 없음).
       guide는 아래 gateGuide_에서 Lv.3을 별도로 요구한다. */
    if(action!=='ping' && action!=='menu'){
      if(verifyLevel_(p.token||'') < 1){
        return json_({success:false, error: MENU.AUTH_VERIFY_URL
          ? 'unauthorized — 로그인이 필요합니다(토큰 없음/만료). 다시 로그인 후 시도하세요.'
          : 'AUTH_VERIFY_URL 미설정 — 조회 거부'});
      }
    }

    if(action==='ping')   return json_({success:true, ver:'2.9.0', pong:new Date().toISOString()});
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
    if(action==='weeklyauto') return json_(weeklyAutoGet_());   /* 주간 자동기재 대상 작성자 목록 */
    if(action==='contenttpl') return json_(contentTplGet_());  /* 처리내용 자동완성 템플릿 */
    if(action==='progress') return json_(progGet_(p));          /* [v2.4] 진행중 공유 상태 ([v2.7] rev 조건부 응답) */
    if(action==='labellist') return json_(labelList_(p));       /* [v2.8] 장비 Label List 원본 */
    if(action==='snphoto')   return json_(snPhotos_(p));        /* [v2.8] 장비 S/N 사진 base64 */
    return json_({success:false, error:'알 수 없는 action: '+action});
  }catch(err){
    return json_({success:false, error:String(err)});
  }
}

/** 시트 전체를 객체 배열로 (수식 결과 포함 표시값)
 *  withPhoto=true 일 때만 사진 열을 한 번 더 읽는다 — 대시보드·주간보고가 쓰는
 *  기본 경로(all/recent/today/weekly)에 읽기 왕복과 응답 크기를 늘리지 않기 위해서다.
 *  (사진 ID가 실제로 필요한 곳은 labelList_ 뿐) */
function readAll_(withPhoto){
  var sh = sheet_(CONFIG.SHEET_NAME);
  if(!sh) return {hdr:null, rows:[]};
  var hdr = findHeader_(sh);
  if(!hdr) return {hdr:null, rows:[]};
  var last = lastDataRow_(sh, hdr);
  if(last <= hdr.row) return {hdr:hdr, rows:[]};
  var vals = sh.getRange(hdr.row+1, 1, last-hdr.row, sh.getLastColumn()).getDisplayValues();
  /* [v2.8] 사진 열은 =IMAGE() 수식이라 표시값이 비어 있다 → 그 열만 수식으로 한 번 더 읽는다.
     요청한 경우에만 — 이 추가 왕복이 대시보드 로딩까지 느리게 만들면 안 된다. */
  var pCol = withPhoto ? colBy_(hdr, PHOTO_COLS) : 0, pFx = null;
  if(pCol) pFx = sh.getRange(hdr.row+1, pCol, last-hdr.row, 1).getFormulas();
  var rows = vals.map(function(v, i){
    var o = {_row: hdr.row+1+i};
    hdr.headers.forEach(function(h,c){ if(h) o[h]=v[c]; });
    /* 중복 Ver 분리 */
    if(hdr.map['__VER_IN'])  o['VerIN']  = v[hdr.map['__VER_IN']-1];
    if(hdr.map['__VER_OUT']) o['VerOUT'] = v[hdr.map['__VER_OUT']-1];
    /* 사진: 수식 → 파일 ID (수식이 아니라 URL만 적힌 셀도 흡수) */
    if(pFx) o['__SNPHOTO'] = photoIdFromFormula_(pFx[i][0] || v[pCol-1]);
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

/* 주간 자동기재 대상 작성자 조회 — '주간자동설정' A열 */
function weeklyAutoGet_(){
  var now = Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm');
  var sh = sheet_(WEEKLY_AUTO.SHEET);
  if(!sh) return {success:true, writers:[], updated:now};   /* 탭 없으면 대상 없음(전원 미적용) */
  var v = sh.getDataRange().getDisplayValues();
  var writers=[];
  for(var i=0;i<v.length;i++){
    var name=String(v[i][0]||'').trim();
    if(!name || norm_(name)==='작성자') continue;            /* 헤더/빈칸 스킵 */
    if(writers.indexOf(name)<0) writers.push(name);
  }
  return {success:true, writers:writers, updated:now};
}

/* 주간 자동기재 대상 저장 — Lv.3 토큰 필수 */
function weeklyAutoSave_(p){
  var lv = verifyLevel_(p.token||'');
  if(lv < 3){
    return {success:false, error: MENU.AUTH_VERIFY_URL
      ? 'unauthorized — 보안레벨 3(수석 매니저) 토큰 필요'
      : 'AUTH_VERIFY_URL 미설정 — 저장 거부'};
  }
  var arr = Array.isArray(p.writers) ? p.writers : null;
  if(!arr) return {success:false, error:'writers 배열 필요'};
  var uniq=[];
  arr.forEach(function(w){ var s=String(w||'').trim(); if(s && uniq.indexOf(s)<0) uniq.push(s); });
  var sh = sheet_(WEEKLY_AUTO.SHEET) || ss_().insertSheet(WEEKLY_AUTO.SHEET);
  sh.clear();
  sh.getRange(1,1).setValue('작성자');
  if(uniq.length) sh.getRange(2,1,uniq.length,1).setValues(uniq.map(function(w){return [w];}));
  return {success:true, count:uniq.length, writers:uniq};
}

/* 처리내용 템플릿 조회 — '처리내용템플릿' 시트(대분류|유형|교체품|처리내용) */
function contentTplGet_(){
  var now = Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm');
  var sh = sheet_(CONTENT_TPL.SHEET);
  if(!sh || sh.getLastRow()<2) return {success:true, rows:[], updated:now};   /* 없거나 빈 시트 → 무동작 */
  var v = sh.getDataRange().getDisplayValues();
  var h = v[0].map(function(s){return String(s).trim();});
  var ci = { cat:h.indexOf('대분류'), type:h.indexOf('유형'), part:h.indexOf('교체품'), content:h.indexOf('처리내용') };
  if(ci.cat<0 || ci.type<0 || ci.content<0) return {success:false, error:'처리내용템플릿 헤더(대분류/유형/처리내용) 필요'};
  var rows=[];
  for(var i=1;i<v.length;i++){
    var cat=String(v[i][ci.cat]||'').trim(), type=String(v[i][ci.type]||'').trim(),
        content=String(v[i][ci.content]||'').trim();
    if(!cat && !type && !content) continue;
    rows.push({ cat:cat, type:type,
                part: ci.part>=0 ? String(v[i][ci.part]||'').trim() : '',
                content:content });
  }
  return {success:true, rows:rows, updated:now};
}

/* ═══════════ [v2.8] 장비 S/N 사진 — Drive 업로드 · U열 =IMAGE() ═══════════ */

/** 사진 저장 폴더 확보: PHOTO.FOLDER_ID → ScriptProperties → 없으면 새로 만들고 기억 */
function photoFolder_(){
  if(PHOTO.FOLDER_ID) return DriveApp.getFolderById(PHOTO.FOLDER_ID);
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SN_PHOTO_FOLDER_ID');
  if(id){
    try{ return DriveApp.getFolderById(id); }
    catch(e){ props.deleteProperty('SN_PHOTO_FOLDER_ID'); }   /* 폴더가 지워졌으면 새로 만든다 */
  }
  var folder = DriveApp.createFolder(PHOTO.FOLDER_NAME);
  props.setProperty('SN_PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

/** 파일명에 못 쓰는 문자 제거 */
function safeName_(s){
  return String(s==null?'':s).replace(/[\\\/:*?"<>|\r\n\t]/g,'').trim().slice(0,60);
}

/** dataURL(base64 JPEG) → Drive 파일 저장 · {id, url} 반환 */
function savePhoto_(dataUrl, meta){
  var s = String(dataUrl||'');
  var mm = s.match(/^data:(image\/[a-z+.-]+);base64,([\s\S]+)$/i);
  if(!mm) throw new Error('사진 형식 오류 (dataURL 아님)');
  var mime = mm[1], b64 = mm[2].replace(/\s/g,'');
  var ext  = mime.indexOf('png')>=0 ? 'png' : (mime.indexOf('webp')>=0 ? 'webp' : 'jpg');
  var name = [safeName_((meta&&meta.date)||''), safeName_((meta&&meta.hosp)||''),
              safeName_((meta&&meta.sn)||'')].filter(Boolean).join('_') || 'sn_photo';
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, name + '.' + ext);
  var file = photoFolder_().createFile(blob);
  if(PHOTO.SHARE){
    /* 링크 공유 실패(도메인 정책 등)해도 파일 자체는 남기고 계속 진행한다 */
    try{ file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
    catch(e){ Logger.log('[photo] 링크 공유 설정 실패: ' + e); }
  }
  return {id:file.getId(), url:file.getUrl()};
}

/** Drive 파일 ID → U열에 넣을 =IMAGE() 수식 (모드 1 = 비율 유지하며 셀에 맞춤) */
function photoFormula_(id){
  return '=IMAGE("https://drive.google.com/thumbnail?id=' + id +
         '&sz=w' + (PHOTO.THUMB_W||600) + '", 1)';
}

/** =IMAGE(...)/URL 문자열에서 Drive 파일 ID 추출 · 없으면 '' */
function photoIdFromFormula_(f){
  var s = String(f||'');
  var m = s.match(/[?&]id=([A-Za-z0-9_-]{20,})/) || s.match(/\/d\/([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : '';
}

/** 현장 처리 현황 시트에 '장비 S/N 사진' 열(U열)을 만든다 — 편집기에서 1회 실행.
 *  이미 있으면 그대로 두고, 없으면 마지막 헤더 오른쪽에 헤더를 쓰고 열 너비를 넓힌다.
 *  (첫 실행 시 Drive 권한 승인 창이 뜨도록 폴더 확보도 함께 수행) */
function setupSnPhotoColumn(){
  var sh = sheet_(CONFIG.SHEET_NAME);
  if(!sh){ Logger.log('❌ 시트 없음: ' + CONFIG.SHEET_NAME); return '시트없음'; }
  var hdr = findHeader_(sh);
  if(!hdr){ Logger.log('❌ 헤더(처리일/병원명) 탐지 실패'); return '헤더없음'; }

  var col = colBy_(hdr, PHOTO_COLS);
  if(col){
    Logger.log('✅ 이미 있습니다: %s열(%s) — 헤더 행 %s',
      colLetter_(col), PHOTO.COL_NAME, hdr.row);
  }else{
    /* 마지막으로 "글자가 있는" 헤더의 오른쪽 = U열.
       headers 길이는 시트의 마지막 열까지라, 빈 헤더 칸이 뒤에 있으면 엉뚱하게 멀어진다 */
    var lastNamed = 0;
    hdr.headers.forEach(function(h,i){ if(String(h).trim()) lastNamed = i+1; });
    col = lastNamed + 1;
    if(col > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), col - sh.getMaxColumns());
    sh.getRange(hdr.row, col).setValue(PHOTO.COL_NAME);
    sh.setColumnWidth(col, 100);
    Logger.log('✅ %s열에 "%s" 헤더를 만들었습니다 (헤더 행 %s)',
      colLetter_(col), PHOTO.COL_NAME, hdr.row);
  }

  var folder = photoFolder_();                          /* Drive 권한 승인 유도 */
  Logger.log('📁 사진 저장 폴더: %s (%s)', folder.getName(), folder.getId());
  Logger.log('   → 이 폴더 ID를 PHOTO.FOLDER_ID 에 넣어 고정할 수도 있습니다.');
  return 'OK';
}

/** 1-based 열번호 → 열 문자(A, B, … AA) */
function colLetter_(n){
  var s = '';
  while(n > 0){ var r = (n-1) % 26; s = String.fromCharCode(65+r) + s; n = Math.floor((n-1)/26); }
  return s;
}

/* ═══════════ [v2.9] 장비 Label list 시트 — 중복 제외 · 작성 일자 ═══════════ */

/** '장비 Label list' 시트의 헤더 행과 열 위치를 찾는다.
 *  헤더 이름이 있으면 그걸 쓰고, 없으면 A열 병원명·B열 체크박스로 본다.
 *  → {sh, row, hosp, dup, date} · 시트가 없으면 null */
function labelMap_(){
  var sh = sheet_(LABELS.SHEET);
  if(!sh || sh.getLastRow() < 1) return null;

  var scan = Math.min(LABELS.HEADER_SCAN, sh.getLastRow());
  var grid = sh.getRange(1, 1, scan, Math.max(sh.getLastColumn(),1)).getDisplayValues();

  /* 병원명 헤더가 있는 행을 찾는다 */
  var hdrRow = 0, cols = {};
  for(var r=0; r<grid.length && !hdrRow; r++){
    var names = grid[r].map(function(h){ return String(h).trim(); });
    var found = {};
    names.forEach(function(h, i){
      if(!h) return;
      var q = norm_(h);
      /* 병원명은 A열과 I열에 둘 다 있다 — 먼저 나온 쪽(A열)을 쓴다 */
      if(!found.hosp && LABELS.HOSP_COLS.some(function(c){ return norm_(c)===q; })) found.hosp = i+1;
      if(!found.done && LABELS.DONE_COLS.some(function(c){ return q.indexOf(norm_(c))>=0; })) found.done = i+1;
      if(!found.date && LABELS.DATE_COLS.some(function(c){ return norm_(c)===q; })) found.date = i+1;
    });
    if(found.hosp){ hdrRow = r+1; cols = found; }
  }
  if(!hdrRow){
    /* 헤더 이름을 못 찾았다. 대개는 1행이 헤더인데(A2:A417 처럼 데이터가 2행부터),
       헤더 없이 1행부터 병원명이 들어간 시트도 있다. 체크박스 칸이 실제 boolean 이면
       그 행은 데이터다 — 헤더 칸이라면 글자가 들어 있을 것이기 때문이다. */
    cols = {};
    var probe = sh.getRange(1, LABELS.FALLBACK.done, 1, 1).getValues()[0][0];
    hdrRow = isCheckToken_(probe) ? 0 : 1;
  }

  return {
    sh   : sh,
    row  : hdrRow,
    hosp : cols.hosp || LABELS.FALLBACK.hosp,
    done : cols.done || LABELS.FALLBACK.done,
    date : cols.date || 0                            /* 작성일자 열은 없을 수도 있다 */
  };
}

/** 체크박스가 켜져 있는가 — 체크박스는 true, 수기 입력은 O/Y/1 등도 받아 준다 */
function isChecked_(v){
  if(v === true) return true;
  var s = String(v==null?'':v).trim().toUpperCase();
  return s==='TRUE' || s==='O' || s==='Y' || s==='1' || s==='V' || s==='중복';
}

/** 체크 여부를 나타내는 값처럼 보이는가(켜짐·꺼짐 모두) — 헤더 행 판별에 쓴다.
 *  헤더 칸이라면 '중복'·'체크' 같은 낱말이 들어가지 이런 표기가 오지 않는다. */
function isCheckToken_(v){
  if(typeof v === 'boolean') return true;
  var s = String(v==null?'':v).trim().toUpperCase();
  return s==='TRUE' || s==='FALSE' || s==='O' || s==='X' || s==='Y' || s==='N' ||
         s==='1' || s==='0' || s==='V' || s==='중복';
}

/** 이미 작성한(B열 체크) 병원명 집합(정규화된 이름 → true) · 시트가 없으면 빈 객체 */
function labelDoneSet_(){
  var m = labelMap_();
  if(!m) return {};
  var last = m.sh.getLastRow();
  if(last <= m.row) return {};
  var n = last - m.row;
  var names = m.sh.getRange(m.row+1, m.hosp, n, 1).getDisplayValues();
  var flags = m.sh.getRange(m.row+1, m.done, n, 1).getValues();
  var set = {};
  for(var i=0;i<n;i++){
    var nm = String(names[i][0]||'').trim();
    if(nm && isChecked_(flags[i][0])) set[norm_(nm)] = true;
  }
  return set;
}

/** POST {action:'labeldone', hosps:[병원명…], date:'YYYY-MM-DD'}
 *  내려받기에 포함된 병원을 "작성 완료"로 표시한다 —
 *  B열 '작성 유/무' 체크 + C열 '작성일자'에 그날 날짜.
 *  이 둘이 같이 움직여야 다음 내려받기에서 그 병원이 빠진다(체크만 보고 거른다).
 *  ※ 이미 날짜가 적힌 행은 덮어쓰지 않는다. I열(작성 대기 목록)과 D·E 수식은 손대지 않는다. */
function labelDone_(p){
  var hosps = (p && p.hosps) || [];
  if(!hosps.length) return {success:false, error:'hosps 배열 필요'};
  var date = String((p && p.date) || '').trim() ||
             Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd');

  var m = labelMap_();
  if(!m) return {success:false, error:"시트 없음: "+LABELS.SHEET};
  if(!m.date){
    return {success:false,
      error:"'"+LABELS.DATE_COLS[0]+"' 열을 찾지 못했습니다 — 편집기에서 setupLabelListSheet() 를 실행하세요."};
  }
  var last = m.sh.getLastRow();
  if(last <= m.row) return {success:true, written:0, checked:0, matched:0, missed:0, date:date};

  var n = last - m.row;
  var names = m.sh.getRange(m.row+1, m.hosp, n, 1).getDisplayValues();
  var dRange = m.sh.getRange(m.row+1, m.date, n, 1);
  var cRange = m.sh.getRange(m.row+1, m.done, n, 1);
  var dates  = dRange.getValues();
  var checks = cRange.getValues();

  /* 요청받은 병원명을 정규화해 한 번에 찾는다 */
  var want = {};
  hosps.forEach(function(h){ var q=norm_(h); if(q) want[q]=true; });

  var written = 0, checked = 0, hit = {};
  for(var i=0;i<n;i++){
    var q = norm_(String(names[i][0]||'').trim());
    if(!q || !want[q]) continue;
    hit[q] = true;
    if(String(dates[i][0]||'').trim() === ''){   /* 이미 적힌 날짜는 덮어쓰지 않는다 */
      dates[i][0] = date;
      written++;
    }
    if(!isChecked_(checks[i][0])){
      checks[i][0] = true;                       /* 체크박스 열이므로 boolean 으로 쓴다 */
      checked++;
    }
  }
  if(written) dRange.setValues(dates);
  if(checked) cRange.setValues(checks);

  var missed = Object.keys(want).filter(function(q){ return !hit[q]; }).length;
  return {success:true, written:written, checked:checked,
          matched:Object.keys(hit).length, missed:missed,
          date:date, sheet:LABELS.SHEET};
}

/** '장비 Label list' 시트를 점검하고 '작성 일자' 열이 없으면 만든다 — 편집기에서 실행.
 *  어떤 열을 병원명/중복/작성일자로 인식했는지 로그로 보여 준다. */
function setupLabelListSheet(){
  var m = labelMap_();
  if(!m){ Logger.log('❌ 시트를 찾지 못했습니다: %s', LABELS.SHEET); return '시트없음'; }
  Logger.log('시트 "%s" · 헤더 행 %s', m.sh.getName(), m.row || '(없음 — 1행부터 데이터)');
  Logger.log('  병원명   → %s열', colLetter_(m.hosp));
  Logger.log('  작성유무 → %s열', colLetter_(m.done));

  if(!m.row){
    Logger.log('⚠️ 헤더 행이 없어 \'%s\' 열을 만들 수 없습니다.', LABELS.DATE_COLS[0]);
    Logger.log('   1행에 헤더(병원명 / 작성 유/무 / %s)를 넣고 다시 실행하세요.', LABELS.DATE_COLS[0]);
    return '헤더없음';
  }
  if(!m.date){
    var col = m.sh.getLastColumn() + 1;
    m.sh.getRange(m.row, col).setValue(LABELS.DATE_COLS[0]);
    m.sh.setColumnWidth(col, 110);
    Logger.log('  작성일자 → %s열에 새로 만들었습니다', colLetter_(col));
  }else{
    Logger.log('  작성일자 → %s열 (이미 있음)', colLetter_(m.date));
  }

  var done = labelDoneSet_();
  Logger.log('✅ 작성 완료로 체크된 병원 %s곳 — 이 병원들은 label.html 불러오기에서 빠집니다.',
    Object.keys(done).length);
  return 'OK';
}

/** GET ?action=labellist&from=YYYY-MM-DD&to=YYYY-MM-DD&fse=이름
 *  label.html(장비 Label List 생성기)이 표를 채우는 원본.
 *  같은 병원+S/N 이 여러 번 나오면 가장 최근 기록 1건만 남긴다.
 *  [v2.9] '장비 Label list' 시트에서 작성 완료로 체크(B열)한 병원은 빼고 돌려준다. */
function labelList_(p){
  var from = parseD_(String(p.from||'').trim());
  var to   = parseD_(String(p.to||'').trim());
  if(!from || !to) return {success:false, error:'from/to(YYYY-MM-DD) 파라미터 필요'};
  if(from > to){ var t = from; from = to; to = t; }
  to.setHours(23,59,59,0);

  /* 이미 작성한 병원 (시트가 없으면 빈 목록 → 예전처럼 전부 내려간다) */
  var doneSet = labelDoneSet_();
  var doneHit = {};

  var qf = norm_(String(p.fse||'').trim());
  var hit = readAll_(true).rows.map(slim_).filter(function(r){   /* true = 사진 열까지 읽기 */
    var d = parseD_(r.date);
    if(!d || d < from || d > to) return false;
    var nm = String(r.hosp||'').trim();
    if(!nm) return false;
    if(doneSet[norm_(nm)]){ doneHit[norm_(nm)] = nm; return false; }   /* 이미 작성 → 제외 */
    if(!qf) return true;
    var f = norm_(r.fse);
    return !!f && (f===qf || f.indexOf(qf)>=0 || qf.indexOf(f)>=0);
  });

  /* 병원+S/N 중복 제거 — 뒤(최근) 기록이 앞 기록을 덮어쓴다 */
  var seen = {}, order = [];
  hit.forEach(function(r){
    var key = norm_(r.hosp) + '|' + norm_(r.sn);
    if(!(key in seen)) order.push(key);
    seen[key] = r;
  });

  var rows = order.map(function(key){
    var r = seen[key];
    return {
      date: r.date, hosp: r.hosp, sn: r.sn, fse: r.fse, gubun: r.gubun,
      note: /\[데모장비\]/.test(String(r.detail||'')) ? '데모 장비' : '병원 장비',
      photoId: r.snPhotoId || ''
    };
  });

  var excluded = Object.keys(doneHit);
  return {success:true, count:rows.length, rows:rows,
          excluded:excluded.length,                       /* 이미 작성해서 빠진 병원 수 */
          excludedNames:excluded.map(function(k){ return doneHit[k]; }),
          from:Utilities.formatDate(from,'Asia/Seoul','yyyy-MM-dd'),
          to:  Utilities.formatDate(to,'Asia/Seoul','yyyy-MM-dd'),
          updated:Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm')};
}

/** GET ?action=snphoto&ids=ID1,ID2,…  (한 번에 최대 SNPHOTO_MAX개)
 *  Drive 이미지를 base64 dataURL로 돌려준다.
 *  브라우저가 drive.google.com 을 직접 fetch 하면 CORS 로 막히므로 이 프록시가 필요하다. */
var SNPHOTO_MAX = 4;
function snPhotos_(p){
  var ids = String(p.ids||'').split(',')
    .map(function(s){ return String(s).trim(); })
    .filter(function(s){ return /^[A-Za-z0-9_-]{20,}$/.test(s); });
  if(!ids.length) return {success:false, error:'ids 파라미터 필요'};
  if(ids.length > SNPHOTO_MAX) ids = ids.slice(0, SNPHOTO_MAX);

  var photos = {}, failed = [];
  ids.forEach(function(id){
    try{
      var blob = DriveApp.getFileById(id).getBlob();
      photos[id] = 'data:' + (blob.getContentType()||'image/jpeg') + ';base64,' +
                   Utilities.base64Encode(blob.getBytes());
    }catch(e){ failed.push(id); }
  });
  return {success:true, count:Object.keys(photos).length, photos:photos, failed:failed};
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
  var s = {
    date : o['처리일']||'', hosp: o['병원명']||'', fse: o['CS 담당자']||'',
    gubun: o['점검/AS']||'', cat: o['대분류']||'', type: o['유형']||'',
    part : o['교체품']||'', cost: o['교체비용']||'', detail: o['내용']||'',
    sn   : pickH_(o,['장비SN','장비 SN','SN']),
    ncare: pickH_(o,['N-Care','NCare','N케어','엔케어']),
    warranty: pickH_(o,['보증기한','보증']),
    paid : pickH_(o,['유/무상','유무상','유·무상']),
    hpIn : o['HP_SN(IN)']||'', verIn: o['VerIN']||'',
    hpOut: o['HP_SN(OUT)']||'', verOut: o['VerOUT']||'',
    nozzleReuse: (String(pickH_(o,['노즐 재사용','노즐재사용'])||'').trim().toUpperCase()==='O' ? 'O' : 'X'),  /* P열 · 기본 X */
    /* 사용자 숙련도 평가 (R·S·T열) */
    nsFill: pickH_(o,['NS 충진 여부','NS충진여부','NS 충진']),
    nsAmt : pickH_(o,['NS 충진량','NS충진량']),
    jet   : pickH_(o,['젯 분사 판단','젯분사 판단','젯 분사'])
  };
  /* [v2.8] 장비 S/N 사진(U열) Drive 파일 ID — readAll_(true) 로 읽었을 때만 붙인다.
     실제 이미지는 ?action=snphoto 로 받는다. 항상 넣으면 대시보드가 쓰는
     ?action=all 응답이 행마다 커져 스크립트 캐시(95KB) 한도를 더 빨리 넘긴다. */
  if(o['__SNPHOTO']) s.snPhotoId = o['__SNPHOTO'];
  return s;
}

/** 기록을 쓴 뒤 관련 조회 캐시를 비운다.
    getRecent_ 는 병원명별 키라, 방금 기록한 병원의 것만 정확히 지운다.
    getToday_ 는 오늘 날짜 + 담당자별 키인데 담당자 조합을 다 알 수 없으므로,
    TTL을 60초로 짧게 잡아 자연 만료에 맡긴다(현장 반응 지연 최대 1분). */
function bazDropHandoverCaches_(hosp){
  if(typeof bazCacheDrop_ !== 'function') return;
  try{
    bazCacheDrop_('handover_all');
    bazCacheDrop_('hv_master');
    if(hosp){
      var n = norm_(hosp);
      /* getRecent_ 는 limit 별로 키가 갈린다 — 클라이언트가 쓰는 범위만 지운다 */
      for(var i=0;i<=20;i++) bazCacheDrop_('hv_recent_' + n + '_' + i);
      bazCacheDrop_('hv_recent_' + n + '_0');
    }
  }catch(e){}
}

/** 대시보드용 전체 데이터 — 5분 캐시.
    [수정] 예전에는 `if(s.length < 95000)` 이라, 시트가 자라 그 선을 넘는 순간 캐시가
    조용히 무력화되고 모든 요청이 시트를 통째로 다시 읽었다("데이터가 늘수록 느려짐"의
    핵심 원인). 조각 캐시로 바꿔 크기 제한을 없앤다(baz_token_lib.gs). */
function getAll_(){
  var hit = (typeof bazCacheGet_ === 'function') ? bazCacheGet_('handover_all') : null;
  if(hit){ try{ return JSON.parse(hit); }catch(e){} }
  var all = readAll_();
  var out = {success:true, count:all.rows.length,
             updated:Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm'),
             data:all.rows.map(slim_)};
  try{ if(typeof bazCachePut_ === 'function') bazCachePut_('handover_all', JSON.stringify(out), 300); }catch(e){}
  return out;
}

/** 병원정보DB 탭 → 병원명·N-Care·지역 목록 (N-Care 미점검 산출용, 10분 캐시) */
function getHospDB_(){
  var cache = CacheService.getScriptCache();
  var _h = (typeof bazCacheGet_ === 'function') ? bazCacheGet_('handover_hospdb') : null;
  if(_h){ try{ return JSON.parse(_h); }catch(e){} }
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
  /* [수정] 95KB 절벽 제거 — 조각 캐시로 크기 제한 없이 저장 */
  try{ if(typeof bazCachePut_ === 'function') bazCachePut_('handover_hospdb', JSON.stringify(res), 600); }catch(e){}
  return res;
}

/** 특정 병원 최근 이력 */
function getRecent_(hosp, limit){
  if(!hosp) return {success:false, error:'hosp 파라미터 필요'};
  /* [성능] readAll_ 는 시트 전 행 스캔이다. 예전에는 이 경로에 캐시가 하나도 없어
     호출마다 전체를 다시 읽었다(데이터가 늘수록 선형으로 느려짐). */
  var _k = 'hv_recent_' + norm_(hosp) + '_' + (Number(limit)||0);
  var _c = (typeof bazCacheGet_ === 'function') ? bazCacheGet_(_k) : null;
  if(_c){ try{ return JSON.parse(_c); }catch(e){} }
  var all = readAll_();
  var q = norm_(hosp);
  var hit = all.rows.filter(function(o){ return norm_(o['병원명'])===q || norm_(o['병원명']).indexOf(q)>=0; });
  hit = hit.slice(-Math.min(limit, CONFIG.RECENT_MAX)).reverse().map(slim_);
  var _r = {success:true, hosp:hosp, count:hit.length, data:hit};
  try{ if(typeof bazCachePut_ === 'function') bazCachePut_(_k, JSON.stringify(_r), 120); }catch(e){}
  return _r;
}

/** 오늘 기록 */
function getToday_(fse){
  var today = Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd');
  /* [성능] 위와 같은 이유로 캐시. 오늘 기록은 자주 바뀌므로 짧게(60초)만 잡는다. */
  var _k = 'hv_today_' + today + '_' + norm_(fse||'');
  var _c = (typeof bazCacheGet_ === 'function') ? bazCacheGet_(_k) : null;
  if(_c){ try{ return JSON.parse(_c); }catch(e){} }
  var all = readAll_();
  var hit = all.rows.filter(function(o){
    var d = String(o['처리일']||'').replace(/\./g,'-').replace(/\s/g,'');
    var okDate = d.indexOf(today)===0;
    var okFse = !fse || norm_(o['CS 담당자'])===norm_(fse);
    return okDate && okFse;
  }).map(slim_);
  var _r = {success:true, date:today, count:hit.length, data:hit};
  try{ if(typeof bazCachePut_ === 'function') bazCachePut_(_k, JSON.stringify(_r), 60); }catch(e){}
  return _r;
}

/** 유형 마스터: 유형마스터 시트가 있으면 우선, 없으면 데이터에서 추출 */
function getMaster_(){
  /* [성능] 유형마스터는 거의 안 바뀌는데 readAll_ 전체 스캔까지 하고 있었다 → 10분 캐시 */
  var _c = (typeof bazCacheGet_ === 'function') ? bazCacheGet_('hv_master') : null;
  if(_c){ try{ return JSON.parse(_c); }catch(e){} }
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
  try{ if(typeof bazCachePut_ === 'function') bazCachePut_('hv_master', JSON.stringify(out), 600); }catch(e){}
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
/* 토큰 → 보안 레벨. 인증 서버 왕복이 비싸므로 스크립트 캐시에 5분 보관한다.
   (모든 요청마다 UrlFetchApp을 타면 응답이 크게 느려짐) */
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
   이게 없으면 인증 GAS가 느릴 때 모든 조회가 각자 왕복을 다시 시도하며 지연이 곱해진다.
   (요청 10개 × 타임아웃 = 10배 지연) 60초만 기억해도 그 증폭이 끊긴다. */
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
  if(!MENU.AUTH_VERIFY_URL) return AUTH_FAILOPEN_LEVEL;      /* 인증 서버 미설정 */

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
      MENU.AUTH_VERIFY_URL + '?action=verify&token=' + encodeURIComponent(String(token)),
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
  var url = MENU.AUTH_VERIFY_URL;
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


/* 쓰기 공통 게이트 — 로그인(Lv.1 이상) 필수. 거부 시 표준 오류 반환 */
function requireWrite_(p){
  var lv = verifyLevel_((p && p.token) || '');
  if(lv >= 1) return null;
  return {success:false, error: MENU.AUTH_VERIFY_URL
    ? 'unauthorized — 로그인이 필요합니다(토큰 없음/만료). 다시 로그인 후 시도하세요.'
    : 'AUTH_VERIFY_URL 미설정 — 기록 거부'};
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
 *  [v2.7]
 *   · 배치   POST {action:'progress_save', ops:[{op,fse,hosp,to},…], who}  → 왕복 1회
 *   · 조건부 GET  ?action=progress&rev=N  → 변경 없으면 {success,nochange,rev} 만 반환
 *   · 이력   모든 op를 '현장일정로그' 시트에 append (락 밖에서 · 실패 무시)
 *   · 스냅샷 일일 초기화 시 어제 큐를 '현장일정' 시트에 보존
 *   · 복구   POST {action:'progress_restore', day:'YYYY-MM-DD', token}  (Lv.3)
 */
function progRead_(){
  var raw = PropertiesService.getScriptProperties().getProperty('cs_progress') || '{}';
  var o = {}; try{ o = JSON.parse(raw) || {}; }catch(e){ o = {}; }
  if(!o.prog   || typeof o.prog   !== 'object') o.prog = {};
  if(!o.done   || typeof o.done   !== 'object') o.done = {};
  if(!o.queues || typeof o.queues !== 'object') o.queues = {};
  if(typeof o.rev !== 'number') o.rev = 0;   /* [v2.7] 리비전 — 폴링이 변경 여부만 싸게 확인 */
  /* [v2.6] 일일 자동 초기화: 날짜(Asia/Seoul)가 바뀌면 어제 일정을 비운다.
     [v2.7] 비우기 전 어제 큐를 _snap 으로 넘겨 호출부가 스냅샷 시트에 보존한다. */
  var today = Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd');
  if(o.day && o.day !== today){
    o._snap = {day:o.day, queues:o.queues};
    o.queues = {}; o.prog = {}; o.done = {}; o._reset = true;
  }
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
/** 저장 전 내부 전용 필드 제거 — ScriptProperties 에 새어 나가지 않게 한다 */
function progStrip_(o){ var s=o._snap; delete o._snap; delete o._reset; return s; }
function progGet_(p){
  var o = progRead_();
  deriveProg_(o);
  var snap = null, wasReset = !!o._reset;
  if(wasReset){
    snap = progStrip_(o);
    o.rev = (o.rev||0)+1;
    try{ PropertiesService.getScriptProperties().setProperty('cs_progress', JSON.stringify(o)); }catch(e){}   // 일일 초기화 영속화
  }
  var rev = o.rev||0;
  /* 일일 초기화 부산물(스냅샷 보존·로그 정리)은 상태 저장 뒤에 — 시트 I/O 실패가 초기화를 되돌리지 않게 */
  if(wasReset){
    try{ if(snap) schedSnapshotWrite_(snap.day, snap.queues); }catch(e){}
    try{ schedLog_([[schedNow_(), '', '', 'day_reset', snap?snap.day:'', '', 'system']]); }catch(e){}
    try{ schedLogPrune_(); }catch(e){}
  }
  /* [v2.7] 변경 없으면 큐 전체 대신 rev 만 반환 — 25초 폴링의 응답·파싱 비용 제거 */
  if(p && String(p.rev||'')!=='' && Number(p.rev)===rev) return {success:true, nochange:true, rev:rev};
  return {success:true, queues:o.queues, prog:o.prog, done:o.done, rev:rev, updated:o.updated||''};
}
/** 큐에서 병원의 현재 상태 문자열(없으면 '') — 로그의 '이전 상태' 기록용 */
function qStateOf_(o, hosp){
  var s = '';
  Object.keys(o.queues).forEach(function(f){
    var i = qFind_(o.queues[f], hosp);
    if(i>=0) s = o.queues[f][i].s || '';
  });
  return s;
}
/** op 1건 적용. 적용되면 true, 알 수 없는 op면 op 이름을 반환. logs 에 변경 이력 행을 쌓는다 */
function progApplyOp_(o, spec, logs, who){
  var op   = String((spec&&spec.op)||'').trim();
  var hosp = String((spec&&spec.hosp)||'').trim();
  var fse  = String((spec&&spec.fse)||'').trim();
  var now  = schedNow_();
  function put(f,h,prev,next){ logs.push([now, f, h, op, prev, next, who]); }

  if(op==='q_add' && fse && hosp){
    var prevA = qStateOf_(o, hosp);
    qRemoveAll_(o, hosp);                 // 한 병원은 한 사람의 일정에만
    qEnsure_(o, fse).push({h:hosp, s:'wait'});
    if(o.done[hosp]) delete o.done[hosp];
    put(fse, hosp, prevA, 'wait');
  } else if(op==='q_remove' && fse && hosp){
    var qr = qEnsure_(o, fse); var ir = qFind_(qr, hosp);
    if(ir>=0){ put(fse, hosp, qr[ir].s||'', '(삭제)'); qr.splice(ir,1); }
  } else if(op==='q_move' && fse && hosp){
    var qm = qEnsure_(o, fse); var im = qFind_(qm, hosp);
    if(im>=0){
      var to = Math.max(0, Math.min(qm.length-1, Number(spec.to)));
      var item = qm.splice(im,1)[0];
      qm.splice(to, 0, item);
      put(fse, hosp, '#'+(im+1), '#'+(to+1));
    }
  } else if(op==='q_done' && fse && hosp){
    var qd = qEnsure_(o, fse); var id = qFind_(qd, hosp);
    if(id>=0){ put(fse, hosp, qd[id].s||'', 'done'); qd[id].s='done'; o.done[hosp]=1; }
  } else if(op==='q_clear' && fse){
    /* 인원 일정 전체 삭제 — 되돌릴 수 없으므로 지워지는 병원을 한 줄씩 남긴다 */
    (o.queues[fse]||[]).forEach(function(x){ if(x&&x.h) put(fse, x.h, x.s||'', '(삭제)'); });
    delete o.queues[fse];
  } else if(op==='set' && hosp){
    var prevS = qStateOf_(o, hosp);
    qRemoveAll_(o, hosp);
    var qs = qEnsure_(o, fse);
    qs.forEach(function(x){ if(x.s==='prog') x.s='wait'; });   // 기존 prog 강등
    qs.unshift({h:hosp, s:'prog'});
    if(o.done[hosp]) delete o.done[hosp];
    put(fse, hosp, prevS, 'prog');
  } else if(op==='clear' && hosp){
    put(qOwnerOf_(o, hosp), hosp, qStateOf_(o, hosp), '(삭제)');
    qRemoveAll_(o, hosp);
  } else if(op==='done' && hosp){
    var owner = qOwnerOf_(o, hosp), prevD = qStateOf_(o, hosp);
    Object.keys(o.queues).forEach(function(f){
      var q=o.queues[f], i=qFind_(q,hosp);
      if(i>=0) q[i].s='done';
    });
    o.done[hosp]=1;
    put(owner, hosp, prevD, 'done');
  } else if(op==='replace'){
    o.queues = {};
    o.prog = (spec.prog && typeof spec.prog==='object') ? spec.prog : {};
    o.done = (spec.done && typeof spec.done==='object') ? spec.done : {};
    Object.keys(o.prog).forEach(function(h){ qEnsure_(o, o.prog[h]).push({h:h, s:'prog'}); });
    put('', '', '', '(전체 교체)');
  } else {
    return op || '(빈 op)';
  }
  return true;
}
function qOwnerOf_(o, hosp){
  var f2 = '';
  Object.keys(o.queues).forEach(function(f){ if(qFind_(o.queues[f], hosp)>=0) f2 = f; });
  return f2;
}
/**
 * 진행 상태 저장. 단건 {op,hosp,fse,to} 또는 배치 {ops:[{op,…},…]} 를 받는다.
 * [v2.7] 배치: 자동 완료 연쇄처럼 여러 op가 한 번에 나는 경우 POST 왕복을 1회로 줄인다.
 */
function progSave_(p){
  /* doPost가 이미 같은 스크립트 락을 보유한 채 호출하므로 재획득 실패는 정상 —
     여기서 예외로 죽으면 일정 저장이 통째로 실패하고, 다음 폴링이 옛 상태로 되돌린다.
     tryLock으로 시도만 하고 실패해도 진행한다(직렬화는 doPost의 락이 이미 보장). */
  var lock = LockService.getScriptLock(), held = false;
  var res = null, logs = [], snap = null;
  try{
    try{ held = lock.tryLock(15000); }catch(e){ held = false; }
    var o = progRead_();
    snap = progStrip_(o);            // 저장 중 날짜가 넘어갔으면 어제 큐를 넘겨받아 뒤에서 보존
    var who = String(p.who||'').trim();
    var ops = (p.ops && p.ops.length) ? p.ops.slice(0, 100)
            : [{op:p.op, hosp:p.hosp, fse:p.fse, to:p.to, prog:p.prog, done:p.done}];
    var applied = 0, unknown = '';
    for(var i=0;i<ops.length;i++){
      var r = progApplyOp_(o, ops[i], logs, who);
      if(r===true) applied++; else if(!unknown) unknown = r;
    }
    if(!applied) return {success:false, error:'알 수 없는 op: '+unknown};
    deriveProg_(o);
    o.rev = (o.rev||0)+1;
    o.updated = Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm:ss');
    PropertiesService.getScriptProperties().setProperty('cs_progress', JSON.stringify(o));
    res = {success:true, queues:o.queues, prog:o.prog, done:o.done, rev:o.rev, updated:o.updated};
  }catch(err){
    return {success:false, error:String(err)};
  }finally{
    if(held){ try{ lock.releaseLock(); }catch(_){} }
  }
  /* 시트 기록은 락을 놓은 뒤에 — 시트 I/O가 저장 경로의 락 보유 시간을 늘리지 않게 한다.
     실패해도 상태 저장은 이미 끝났으므로 응답에 영향을 주지 않는다. */
  try{ if(snap) schedSnapshotWrite_(snap.day, snap.queues); }catch(e){}
  try{ schedLog_(logs); }catch(e){}
  return res;
}
/* ═══════════ [v2.7] 현장 일정 — 시트 이력·스냅샷·복구 ═══════════
 *  왜 시트인가: 실시간 상태는 ScriptProperties(cs_progress)에 두어 25초 폴링을 싸게 유지하되,
 *  '누가 언제 무엇을 지웠는가'와 '그날 일정이 무엇이었는가'는 시트에 남긴다.
 *  ScriptProperties는 지워지면 흔적도 복구 수단도 없어, 일정이 통째로 초기화된 사고의
 *  원인 규명과 되돌리기가 불가능했다.
 *
 *  현장일정로그 : 일시 | 담당자 | 병원 | op | 이전상태 | 새상태 | 요청자   (append-only)
 *  현장일정     : 날짜 | 담당자 | 순번 | 병원 | 상태 | 기록일시            (일자별 스냅샷)
 *
 *  ※ 시트 I/O는 반드시 쓰기 경로의 락 밖에서, 실패해도 무시한다(본 저장에 영향 없음).
 *  ※ 읽기(폴링) 경로에는 절대 시트를 넣지 않는다 — 25초 폴링 × 인원수가 GAS 일일
 *    실행시간 한도를 그대로 소모한다.
 */
var SCHED = {
  LOG_SHEET : '현장일정로그',
  SNAP_SHEET: '현장일정',
  KEEP_DAYS : 90               // 로그 보관 기간(초과 행은 일일 초기화 때 정리)
};
var SCHED_LOG_HEAD  = ['일시','담당자','병원','op','이전상태','새상태','요청자'];
var SCHED_SNAP_HEAD = ['날짜','담당자','순번','병원','상태','기록일시'];

function schedNow_(){ return Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm:ss'); }
/** 시트를 얻고, 없으면 만들고 헤더를 세운다 */
function schedSheet_(name, head){
  var sh = sheet_(name);
  if(!sh){ sh = ss_().insertSheet(name); }
  if(sh.getLastRow() < 1){
    sh.getRange(1,1,1,head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
    /* A열(일시·날짜)은 텍스트 고정 — 시트가 날짜로 재해석해 표시형식을 바꾸면
       보관기간 정리(schedLogPrune_)와 날짜 매칭(progRestore_)이 어긋난다 */
    try{ sh.getRange(1,1,sh.getMaxRows(),1).setNumberFormat('@'); }catch(e){}
  }
  return sh;
}
/** 변경 이력 append (여러 행 한 번에) */
function schedLog_(rows){
  if(!rows || !rows.length) return;
  var sh = schedSheet_(SCHED.LOG_SHEET, SCHED_LOG_HEAD);
  sh.getRange(sh.getLastRow()+1, 1, rows.length, SCHED_LOG_HEAD.length).setValues(rows);
}
/** 보관 기간이 지난 로그 행 정리 — 일일 초기화 때 하루 1회만 호출된다 */
function schedLogPrune_(){
  var sh = sheet_(SCHED.LOG_SHEET);
  if(!sh) return;
  var last = sh.getLastRow();
  if(last < 2) return;
  var cutoff = Utilities.formatDate(new Date(Date.now() - SCHED.KEEP_DAYS*864e5),'Asia/Seoul','yyyy-MM-dd');
  var col = sh.getRange(2,1,last-1,1).getDisplayValues();
  var n = 0;
  while(n < col.length){                                   // 시간순 append → 앞에서부터
    var s = String(col[n][0]).trim();
    if(!/^\d{4}-\d{2}-\d{2}/.test(s)) break;               // 형식이 다르면 손대지 않는다(오삭제 방지)
    if(s.slice(0,10) >= cutoff) break;
    n++;
  }
  if(n > 0) sh.deleteRows(2, n);
}
/** 하루치 큐 스냅샷 기록 (같은 날짜가 이미 있으면 건너뜀) */
function schedSnapshotWrite_(day, queues){
  if(!day || !queues) return;
  var props = PropertiesService.getScriptProperties();
  if(props.getProperty('cs_sched_snap_day') === day) return;   // 중복 기록 방지
  var rows = [], now = schedNow_();
  Object.keys(queues).forEach(function(fse){
    (queues[fse]||[]).forEach(function(x, i){
      if(x && x.h) rows.push([day, fse, i+1, x.h, x.s||'', now]);
    });
  });
  /* 시트 기록이 성공한 뒤에 '기록함' 표시 — 먼저 찍으면 쓰기가 실패했을 때 스냅샷이 영영 유실된다 */
  if(rows.length){
    var sh = schedSheet_(SCHED.SNAP_SHEET, SCHED_SNAP_HEAD);
    sh.getRange(sh.getLastRow()+1, 1, rows.length, SCHED_SNAP_HEAD.length).setValues(rows);
  }
  props.setProperty('cs_sched_snap_day', day);                 // 빈 일정도 '기록함'으로 표시
}
/** 현재 큐를 즉시 스냅샷으로 남긴다 (수동 백업 · 복구 전 안전장치) */
function schedSnapshotNow_(day){
  var o = progRead_(); progStrip_(o);
  var d = String(day || o.day || Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd'));
  try{ PropertiesService.getScriptProperties().deleteProperty('cs_sched_snap_day'); }catch(e){}
  schedSnapshotWrite_(d, o.queues);
  return {success:true, day:d};
}
/**
 * 스냅샷 시트에서 해당 날짜의 일정을 되살린다 (사고 복구).
 * 되돌리기 자체가 파괴적이므로 Lv.3 토큰 필요 + 복구 직전 현재 상태를 스냅샷으로 남긴다.
 * POST {action:'progress_restore', day:'YYYY-MM-DD', token}
 */
function progRestore_(p){
  if(verifyLevel_(p.token||'') < 3) return {success:false, error:'unauthorized — 보안레벨 3(수석 매니저) 토큰 필요'};
  var day = String(p.day||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)) return {success:false, error:'day=YYYY-MM-DD 필요'};
  var sh = sheet_(SCHED.SNAP_SHEET);
  if(!sh || sh.getLastRow() < 2) return {success:false, error:'스냅샷 시트 없음: '+SCHED.SNAP_SHEET};

  var v = sh.getRange(2, 1, sh.getLastRow()-1, SCHED_SNAP_HEAD.length).getDisplayValues();
  var picked = [];
  v.forEach(function(r){ if(String(r[0]).trim() === day) picked.push(r); });
  if(!picked.length) return {success:false, error:day+' 스냅샷이 없습니다'};
  picked.sort(function(a,b){ return (Number(a[2])||0) - (Number(b[2])||0); });   // 순번대로

  var queues = {};
  picked.forEach(function(r){
    var fse = String(r[1]).trim(), hosp = String(r[3]).trim(), st = String(r[4]).trim();
    if(!fse || !hosp) return;
    if(!queues[fse]) queues[fse] = [];
    queues[fse].push({h:hosp, s:(st==='prog'||st==='done')?st:'wait'});
  });

  var lock = LockService.getScriptLock(), held = false, res = null;
  try{
    try{ held = lock.tryLock(15000); }catch(e){ held = false; }
    var o = progRead_(); progStrip_(o);
    var before = o.queues;
    o.queues = queues; o.done = {};
    deriveProg_(o);
    o.rev = (o.rev||0)+1;
    o.updated = schedNow_();
    PropertiesService.getScriptProperties().setProperty('cs_progress', JSON.stringify(o));
    res = {success:true, restored:day, queues:o.queues, prog:o.prog, done:o.done, rev:o.rev, updated:o.updated};
    /* 복구 직전 상태를 되돌릴 수 있게 남긴다 */
    try{ PropertiesService.getScriptProperties().deleteProperty('cs_sched_snap_day'); }catch(e){}
    try{ schedSnapshotWrite_('복구전-'+schedNow_().slice(0,10), before); }catch(e){}
  }catch(err){
    return {success:false, error:String(err)};
  }finally{
    if(held){ try{ lock.releaseLock(); }catch(_){} }
  }
  try{ schedLog_([[schedNow_(), '', '', 'restore', '', day, String(p.who||'')]]); }catch(e){}
  return res;
}
