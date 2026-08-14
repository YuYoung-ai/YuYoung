/*******************************************************************
 * BAZ BIOMEDIC CS — 현장 처리 현황(handover) 확장 웹앱  v3.4.1
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
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║ ★★ v3.2 적용 순서 ★★                                            ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *  1) 편집기에 이 코드를 붙여넣고 [저장]
 *  2) ★먼저★ 함수 목록에서 setupHandoverColumns 를 골라 [실행]
 *     → 사진 열 + 아래 열들이 없으면 만들어 준다(있으면 건드리지 않음):
 *        장비 S/N 사진 · UI Ver · HP Ver · 노즐 제조일자 · A/S 결과 · 비고 ·
 *        장비 구분 · 유형 코드 · 로그인 사용자
 *     ※ 이 열들이 없으면 저장은 되지만 해당 값은 기록되지 않고, 응답 warnings 로
 *       "저장되지 않았다"고 알린다(프런트가 '저장됨'이라고 말하지 않는다).
 *  3) [배포 > 배포 관리 > ✏️ > 버전: 새 버전 > 배포]  ※ "새 배포"가 아님(URL 유지)
 *  4) 확인: 배포URL + ?action=ping → {"success":true,"ver":"3.4.1"}
 *
 * v3.1 주요 변경
 *  · 사진 저장 실패를 성공으로 처리하지 않는다(행도 쓰지 않고 실패 응답)
 *  · 같은 reqId 동시 요청이 두 행·두 사진을 만들지 않는다(락 안 재확인 + 영속 기록)
 *  · 전송로그에서 token·사진 base64 제거(허용 목록 기반 재구성)
 *  · 인증 서버 장애 시 '검증되지 않은 임의 토큰'을 통과시키지 않는다
 *  · 화면 입력(UI/HP Ver·노즐 제조일자·A/S 결과·비고·장비 구분·유형 코드)을 실제 열에 기록
 *  · 사용자 입력이 시트 수식으로 해석되지 않게 방어 + 서버측 길이·허용값 검증
 *
 * v3.2 주요 변경
 *  · force=1 조회는 서버 캐시를 우회해 수동 새로고침의 최신성을 보장
 *  · all·병원DB·이슈이력·부트스트랩에 rev/nochange 조건부 응답 적용
 *  · 데이터 캐시와 리비전 메타를 함께 무효화해 오래된 nochange 방지
 *
 * 엔드포인트
 *  POST                          : 행 기록 (수기 입력 열만 기록, 수식 열 보존)
 *                                  응답 {success, row, photo:{required,saved,fileId,error},
 *                                        savedFields, warnings, error}
 *  GET ?action=savecheck&reqId=… : [v3.1] 저장 결과 조회(응답 유실 시 실제 기록 여부 판정)
 *  GET ?action=handover_bootstrap: [v3.1] handover 부트 1콜(병원DB·마스터·템플릿·자동대상)
 *  POST {action:'history_save'}  : [v3.0] 병원 처리 이력 편집 저장 (Lv.2 토큰 · rev 충돌 검사)
 *                                  {hosp, records:[…], who, baseRev, token}
 *                                  → 성공 {success:true, rev, records, updatedAt, updatedBy}
 *                                  → 충돌 {success:false, conflict:true, rev, records}
 *                                  ※ '이슈이력편집'·'이슈이력로그' 탭은 첫 저장 때 자동 생성
 *  POST {action:'weeklywrite'}   : [v2.1] 주간업무보고 본문을 작성자 탭 최상단에 삽입
 *  POST {action:'menu_save'}     : [v2.2] 허브 메뉴 표시/레벨/순서 저장 (Lv.3 토큰 필요)
 *  GET ?action=ping              : 콜드스타트 예열
 *  GET ?action=all&force=1|rev=  : 대시보드/주간보고용 전체 데이터(강제/조건부)
 *  GET ?action=hospdb&force=1|rev= : 병원정보DB 목록(강제/조건부)
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

/* [Core 통합] 병원정보DB(rich) — 주소·S/N·좌표(N·O열)·상태·최근점검·HP/UI버전 전체 필드.
   ★ 이 병원정보DB 는 handover 자신의 바인딩 스프레드시트에 '병원정보DB' 탭으로 이미 존재한다
     (기존 hospital_gas 가 읽던 것과 같은 시트 — 원본은 handover). 그래서 기본은 로컬 시트를 읽는다.
   ★ SS_ID 는 병원정보DB 가 '다른' 스프레드시트에 있을 때만 채우는 선택 override(대개 비워둔다). */
var HOSPDB_RICH = { SHEET: '병원정보DB', SS_ID: '' };
function richHospSS_(){
  var id = HOSPDB_RICH.SS_ID;
  if(!id){ try{ id = PropertiesService.getScriptProperties().getProperty('RICH_HOSPDB_SS_ID') || ''; }catch(e){} }
  if(id){ try{ return SpreadsheetApp.openById(id); }catch(e){} }
  return ss_();   /* 기본: handover 자신의 바인딩 스프레드시트 */
}

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

/* [v3.1][보안] 전송로그에 남길 수 있는 필드 — 허용 목록.
   ★ 예전 logSafe_ 는 payload 전체를 복사한 뒤 snPhoto 만 요약했다. 그래서
     payload.token(로그인 토큰)이 '전송로그' 시트에 평문으로 그대로 쌓였다.
     시트 열람 권한만 있으면 남의 세션 토큰을 그대로 주워 쓸 수 있는 상태였다.
   ★ "복사 후 일부 삭제" 방식은 필드가 하나 늘 때마다 다시 새는 구조다.
     → 여기 적힌 업무 필드만 새 객체에 담는다(기본 거부). */
var LOG_FIELDS = ['action','reqId','date','hosp','fse','gubun','eqKind','cat','type','code',
                  'part','cost','sn','hpIn','hpOut','uVer','wVer','verUI','verHP',
                  'nozzleDate','nozzleReuse','result','nsFill','nsAmt','jet'];
var LOG_MAX_LEN = 300;   /* 한 필드 길이 상한 — 내용/비고가 길어도 로그 셀을 넘기지 않는다 */

/** 로그용 payload — 허용 목록 기반으로 "새로 구성"한다(토큰·사진 base64 원천 차단) */
function logSafe_(payload){
  if(!payload || typeof payload !== 'object') return {};
  var o = {};
  for(var i=0;i<LOG_FIELDS.length;i++){
    var k = LOG_FIELDS[i];
    if(!Object.prototype.hasOwnProperty.call(payload, k)) continue;
    var v = payload[k];
    if(v === null || v === undefined || v === '') continue;
    if(typeof v === 'object') continue;                    /* 중첩 객체는 통째로 제외 */
    o[k] = String(v).slice(0, LOG_MAX_LEN);
  }
  /* 사진은 "붙었는지"만 남긴다 — base64 본문은 절대 로그에 넣지 않는다 */
  if(payload.snPhoto) o.photoKB = Math.round(String(payload.snPhoto).length * 3 / 4 / 1024);
  /* 내용·비고는 길이만(개인 메모가 로그 시트로 새지 않게) */
  if(payload.detail) o.detailLen = String(payload.detail).length;
  if(payload.remark) o.remarkLen = String(payload.remark).length;
  return o;
}

/* ═══════════ [v3.1] 저장 계약 · 검증 · 멱등성 ═══════════════════════════════
 *  왜 필요한가
 *   ① 화면에는 있는데 시트에 저장되지 않던 필드(UI/HP Ver·노즐 제조일자·A/S 결과·
 *      비고·장비 구분·유형 코드)를 실제 열에 기록한다. 열이 없으면 조용히 버리지 않고
 *      응답 warnings 로 알린다(프런트가 "저장됨"이라고 말하지 않게).
 *   ② 사용자 입력이 =IMPORTXML(...) 같은 수식으로 해석되지 않게 막는다.
 *   ③ 같은 reqId 동시 요청이 두 행·두 사진을 만들지 않게 락 안에서 다시 확인한다.
 */

/* 프런트 payload 키 → 시트 헤더 별칭(허용 목록). 첫 번째로 찾은 열에 쓴다.
   ※ 짧은 별칭('UI','HP')은 넣지 않는다 — HP_SN(IN/OUT) 뒤의 'Ver' 열과 헷갈린다. */
var HANDOVER_FIELD_COLS = {
  eqKind     : ['장비 구분','장비구분','장비종류','장비 종류'],
  verUI      : ['UI Ver','UI버전','UI 버전','UI Version'],
  verHP      : ['HP Ver','HP버전','HP 버전','HP Version'],
  nozzleDate : ['노즐 제조일자','노즐제조일자','노즐 제조일','노즐제조일'],
  result     : ['A/S 결과','AS 결과','처리 결과','처리결과'],
  remark     : ['비고','비고/특이사항','특이사항','비고 / 특이사항'],
  code       : ['유형 코드','유형코드','코드'],
  authUser   : ['로그인 사용자','작성자(로그인)','기록 계정']
};
/* 값 길이 상한 — 서버에서도 반드시 확인한다(클라이언트만 믿지 않는다) */
var HANDOVER_MAX_LEN = {
  hosp:120, fse:40, gubun:20, eqKind:20, cat:60, type:120, code:20, part:120,
  cost:40, sn:120, hpIn:60, hpOut:60, uVer:20, wVer:20, verUI:40, verHP:40,
  nozzleDate:40, nozzleReuse:4, result:60, detail:4000, remark:2000,
  nsFill:20, nsAmt:20, jet:20
};
var HANDOVER_ENUM = {
  gubun      : ['A/S','점검'],
  eqKind     : ['병원 장비','데모 장비'],
  nozzleReuse: ['O','X'],
  nsFill     : ['O','X'],
  nsAmt      : ['정상','부족','과다'],
  jet        : ['가능','교육 필요']
};

/** 시트 셀에 안전하게 넣을 값 — 수식 주입 방어.
 *  '=' '+' '@' 로 시작하거나 '-' 뒤에 숫자가 아닌 문자가 오면 앞에 작은따옴표를 붙여
 *  Sheets 가 텍스트로 확정하게 한다(표시값에는 따옴표가 보이지 않는다). */
function safeCell_(v){
  if(v === null || v === undefined) return '';
  if(typeof v === 'number' || typeof v === 'boolean') return v;
  var s = String(v);
  if(!s) return '';
  if(/^[=+@\t\r]/.test(s)) return "'" + s;
  if(/^-/.test(s) && !/^-\s*[\d.,]/.test(s)) return "'" + s;
  return s;
}

/** 교체비용 정규화 — 쉼표·원·공백 허용, 음수·NaN·문자열은 거부.
 *  @returns {{ok:boolean, value:(number|string), error:string}} */
function normCost_(v){
  var s = String(v == null ? '' : v).trim();
  if(!s) return {ok:true, value:'무상', error:''};
  if(/^무상$/i.test(s)) return {ok:true, value:'무상', error:''};
  var t = s.replace(/[,\s원]/g, '');
  if(!/^\d+(\.\d+)?$/.test(t)) return {ok:false, value:'', error:'교체비용은 숫자만 입력하세요: '+s.slice(0,20)};
  var n = Number(t);
  if(!isFinite(n) || n < 0) return {ok:false, value:'', error:'교체비용이 올바르지 않습니다'};
  return {ok:true, value:n, error:''};
}

/** 서버측 payload 검증 — 필수값·길이·허용값. 실패 목록과 정리된 값을 함께 돌려준다. */
function hvValidate_(payload){
  var errors = [], warnings = [], clean = {};
  Object.keys(HANDOVER_MAX_LEN).forEach(function(k){
    var v = payload[k];
    if(v === null || v === undefined) { clean[k] = ''; return; }
    var s = String(v);
    if(s.length > HANDOVER_MAX_LEN[k]){
      s = s.slice(0, HANDOVER_MAX_LEN[k]);
      warnings.push(k + ' 값이 길어 ' + HANDOVER_MAX_LEN[k] + '자로 잘렸습니다');
    }
    clean[k] = s.trim();
  });
  clean.detail = String(payload.detail == null ? '' : payload.detail).slice(0, HANDOVER_MAX_LEN.detail);
  clean.remark = String(payload.remark == null ? '' : payload.remark).slice(0, HANDOVER_MAX_LEN.remark);

  if(!clean.hosp) errors.push('병원명은 필수입니다');
  if(!clean.fse)  errors.push('담당 FSE는 필수입니다');

  Object.keys(HANDOVER_ENUM).forEach(function(k){
    if(!clean[k]) return;
    if(HANDOVER_ENUM[k].indexOf(clean[k]) < 0){
      warnings.push(k + ' 값이 허용 목록에 없어 비웠습니다: ' + clean[k].slice(0,20));
      clean[k] = '';
    }
  });
  if(!clean.nozzleReuse) clean.nozzleReuse = 'X';   /* P열 기본값 */

  var c = normCost_(payload.cost);
  if(!c.ok) errors.push(c.error); else clean.cost = c.value;

  /* 처리일: 비었으면 오늘(Asia/Seoul) · 형식이 깨졌으면 오류 */
  var d = String(payload.date || '').trim();
  if(!d) clean.date = Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd');
  else if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) errors.push('처리일 형식이 올바르지 않습니다(yyyy-MM-dd)');
  else clean.date = d;

  return {ok: errors.length === 0, errors: errors, warnings: warnings, clean: clean};
}

/* ── 멱등성 저장소 ────────────────────────────────────────────────────────
   예전에는 CacheService 만 썼다. 캐시는 ① 언제든 축출될 수 있고 ② 락 "밖"에서만
   확인해서, 같은 reqId 요청 두 개가 동시에 들어오면 둘 다 캐시 미스로 통과해
   행 2줄·사진 2장이 만들어졌다.
   → ScriptProperties(영속) + 캐시(빠름) 2단으로 두고, 반드시 락 안에서 다시 확인한다. */
var REQ_PROP_PREFIX = 'hvreq_';
var REQ_KEEP = 300;                 /* 보관 건수 — 넘으면 오래된 것부터 정리 */
var REQ_TTL_MS = 24 * 3600 * 1000;  /* 보관 기간 */

function reqKey_(reqId){ return REQ_PROP_PREFIX + reqId; }

/** 저장된 결과 조회 (캐시 → 프로퍼티). 없으면 null */
function reqGet_(reqId){
  if(!reqId) return null;
  try{
    var c = CacheService.getScriptCache().get(reqKey_(reqId));
    if(c) return JSON.parse(c);
  }catch(e){}
  try{
    var p = PropertiesService.getScriptProperties().getProperty(reqKey_(reqId));
    if(p) return JSON.parse(p);
  }catch(e){}
  return null;
}

/** 결과 저장 (영속 + 캐시) */
function reqPut_(reqId, result){
  if(!reqId) return;
  var body = JSON.stringify(result);
  try{ PropertiesService.getScriptProperties().setProperty(reqKey_(reqId), body); }catch(e){}
  try{ CacheService.getScriptCache().put(reqKey_(reqId), body, 21600); }catch(e){}
}

/** 오래된 멱등성 기록 정리 — 프로퍼티 저장소가 무한히 자라지 않게 */
function reqPrune_(){
  if(Math.random() > 0.05) return;   /* 쓰기 20회당 평균 1회 — 매 요청의 락 구간을 늘리지 않는다 */
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var now = Date.now(), rows = [];
  Object.keys(all).forEach(function(k){
    if(k.indexOf(REQ_PROP_PREFIX) !== 0) return;
    var ts = 0;
    try{ ts = Number((JSON.parse(all[k]||'{}') || {}).ts) || 0; }catch(e){}
    if(ts && now - ts > REQ_TTL_MS){ try{ props.deleteProperty(k); }catch(e){} return; }
    rows.push({k:k, ts:ts});
  });
  if(rows.length <= REQ_KEEP) return;
  rows.sort(function(a,b){ return a.ts - b.ts; });               /* 오래된 것부터 */
  rows.slice(0, rows.length - REQ_KEEP).forEach(function(r){
    try{ props.deleteProperty(r.k); }catch(e){}
  });
}

/** 업로드해 둔 사진을 되돌린다(행 기록 실패·중복 요청 판정 시 고아 파일 방지) */
function photoDiscard_(photoFile){
  if(!photoFile || !photoFile.id) return false;
  try{ DriveApp.getFileById(photoFile.id).setTrashed(true); return true; }
  catch(e){ Logger.log('[photo] 정리 실패(무시): ' + e); return false; }
}

/** 방금 쓴 행을 되돌린다 — 사진 수식 기록이 실패했을 때 "반쯤 저장된 행"을 남기지 않는다 */
function rowRollback_(sh, row, cols){
  try{
    (cols||[]).forEach(function(c){ if(c) sh.getRange(row, c).clearContent(); });
    return true;
  }catch(e){ Logger.log('[row] 롤백 실패: ' + e); return false; }
}

/** 사진 저장 결과 블록 — 응답 형식을 한 곳에서 만든다 */
function photoResult_(required, saved, fileId, error){
  return {required: !!required, saved: !!saved, fileId: String(fileId||''), error: String(error||'')};
}

/* ================= POST: 행 기록 ================= */
function doPost(e){
  _readAllMemo = null;          /* GAS 실행 컨테이너 재사용에 대비한 요청 스코프 초기화 */
  var lock = LockService.getScriptLock();
  var payload = {};
  var photoFile = null;      /* [v2.8] 락 잡기 전에 끝내 둔 사진 업로드 결과 */
  var committed = false;     /* [v3.1] 행이 확정됐는가 — 확정 후에는 사진을 지우지 않는다 */
  var writeSheet = null, writeRow = 0, written = []; /* 중간 셀 쓰기 실패도 전부 롤백 */
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

    /* action 이 비어 있는 요청만 handover 행 기록이다. 알 수 없는 action 이
       아래 공통 기록 경로로 흘러 사진 없는 행을 만드는 것을 차단한다. */
    var knownActions = ['progress_save','progress_restore','history_save','weeklywrite',
                        'menu_save','weeklyauto_save','labeldone','photo_add','photo_abandon'];
    if(actName && knownActions.indexOf(actName) < 0){
      return json_({success:false, error:'알 수 없는 action: '+String(actName).slice(0,40)});
    }
    var isHandover = !actName;

    /* [v3.4] 사진 전용 액션은 여기서 끝낸다 — 인증은 위에서 이미 통과했고, 아래의
       handover 행 검증·snPhoto 필수 검사·전역 20초 락으로 흘러가면 안 된다.
       Drive 업로드는 photoAdd_ 안에서 전역 락 밖에 두고, 메타 확정 구간만 짧은 락을 쓴다. */
    if(actName === 'photo_add')     return json_(photoAdd_(payload));
    if(actName === 'photo_abandon') return json_(photoAbandon_(payload));

    /* [v2.8] 같은 기록의 재전송을 걸러낸다(멱등성).
       콜드스타트 때 GAS가 JSON 대신 HTML을 돌려주면 프런트의 1차 요청은 "실패"로 보이고
       no-cors 로 같은 내용을 한 번 더 보낸다. 그런데 1차 요청이 서버에서는 이미 기록됐을
       수 있어, 그대로 두면 같은 행이 두 줄 쌓이고 사진도 Drive에 두 번 올라간다.
       프런트가 붙여 보낸 reqId 를 10분간 기억해 두 번째 요청은 첫 결과를 그대로 돌려준다. */
    var reqId = String((payload && payload.reqId) || '').replace(/[^A-Za-z0-9_-]/g,'').slice(0,64);
    if(isHandover && !reqId){
      return json_({success:false, row:null,
        photo:photoResult_(true, false, '', 'reqId-missing'),
        error:'안전한 중복 방지를 위해 reqId가 필요합니다 — 화면을 새로고침한 뒤 다시 저장해 주세요.'});
    }
    /* 빠른 경로: 이미 처리된 요청이면 사진 업로드도 하지 않고 첫 결과를 그대로 돌려준다.
       ★ 이것만으로는 부족하다 — 동시 요청 두 개는 둘 다 여기를 통과한다.
         락을 잡은 뒤 아래에서 한 번 더 확인한다(double-checked). */
    if(reqId){
      var early = reqGet_(reqId);
      if(early) return json_(early.result);
    }

    /* [v2.8] 사진 업로드는 락 "밖"에서 먼저 끝낸다.
       Drive는 콜드스타트 때 몇 초씩 걸리는데, 그걸 락 안에서 하면 동시에 기록하는
       두 번째 FSE가 20초 대기를 넘겨 통째로 실패한다. 업로드는 행 번호와 무관하므로
       미리 해 두고, 락 안에서는 수식 한 줄만 쓴다. */
    /* 사진 필수 여부: 사진이 실제로 왔거나, 클라이언트가 "이 요청은 사진 필수"라고 선언한 경우.
       후자가 있어야 "사진을 붙였다고 생각했는데 payload 에 안 실린" 사고를 서버가 잡아낸다. */
    /* handover 사진 필수 여부를 클라이언트 플래그에 맡기지 않는다.
       action 없는 행 기록은 서버가 무조건 사진을 요구한다. */
    var photoRequired = isHandover;
    /* [v3.4] S/N 사진은 두 경로 모두 허용한다.
       · Legacy — payload.snPhoto 에 base64 가 실려 온다(기존 클라이언트)
       · New    — payload.photos 에 kind:'SN' 참조가 정확히 1개 있고, 그 사진이
                  recordId(=reqId)+clientPhotoId 로 사진 시트에서 확인된다
       예전에는 snPhoto 가 없으면 무조건 실패라 신규 참조 요청이 전부 거부됐다. */
    var photoRefs = isHandover ? hvPhotoRefs_(payload) : [];
    var usesRefs  = photoRefs.length > 0;
    var snPhotoFileId = '', linkPhotos = null, causeCount = 0;
    if(photoRequired && !usesRefs && !(payload && payload.snPhoto)){
      var mfail = {success:false, row:null,
        photo: photoResult_(true, false, '', 'photo-missing'),
        error: '사진이 필수인 기록인데 사진이 전송되지 않았습니다 — 다시 첨부해 주세요.'};
      return json_(mfail);
    }
    var photoErr = '';
    if(photoRequired && !usesRefs){
      try{
        photoFile = savePhoto_(payload.snPhoto, {
          date: payload.date || '', hosp: payload.hosp || '', sn: payload.sn || ''
        });
      }catch(pe){
        /* [v3.1] 예전에는 여기서 실패해도 행 기록을 그대로 진행하고 success:true 를 돌려줬다.
           프런트는 그 응답을 보고 "기록 완료"를 띄우며 화면의 사진까지 지웠다 —
           현장에서 찍은 라벨 사진이 아무 데도 남지 않은 채 사라졌다.
           → 사진이 필수인 요청은 사진까지 성공해야 전체 성공이다. 행도 쓰지 않는다. */
        photoFile = null;
        photoErr = String(pe && pe.message ? pe.message : pe);
        log_('PHOTO_ERR:'+pe, null, logSafe_(payload));
        var pfail = {success:false, row:null,
          photo: photoResult_(true, false, '', photoErr),
          error: '사진 저장 실패 — 기록하지 않았습니다: ' + photoErr};
        return json_(pfail);
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

    /* [v3.0] 병원 처리 이력 편집 저장(Lv.2) — progress_save 와 같은 이유로 전역 락 "밖".
       이력 편집은 '이슈이력편집' 시트만 건드리고 handover 행 기록과 저장소가 다르며,
       histSave_ 가 자체 락으로 동시 수정을 막는다. 전역 20초 락에 묶으면 현장에서
       기록을 올리는 동안 편집 저장이 통째로 실패한다. */
    if(payload && payload.action==='history_save') return json_(histSave_(payload));

    lock.waitLock(20000);

    /* [v2.1] JSON 파싱 직후 신규 액션 라우팅 — handover 행 기록보다 먼저
       (아래 액션들은 자체 락이 없어 전역 락 안에 둔다) */
    if(payload && payload.action==='weeklywrite') return json_(wkWrite_(payload));
    if(payload && payload.action==='menu_save')   return json_(menuSave_(payload));
    if(payload && payload.action==='weeklyauto_save') return json_(weeklyAutoSave_(payload));  /* 주간 자동기재 대상 저장(Lv.3) */
    if(payload && payload.action==='labeldone')    return json_(labelDone_(payload));  /* [v2.9] 내려받은 병원 작성 일자 기록 */

    /* ★ [v3.1] 락 안에서 멱등성 재확인 — 같은 reqId 요청 두 개가 동시에 들어와도
       뒤에 들어온 쪽은 여기서 걸린다(첫 결과를 그대로 돌려주고, 자기가 올린 사진은 지운다).
       예전에는 락 밖 캐시 확인 한 번뿐이라 동시 요청이 둘 다 통과해 행·사진이 두 벌 생겼다. */
    if(reqId){
      var dup = reqGet_(reqId);
      if(dup){
        photoDiscard_(photoFile);            /* 중복 업로드된 Drive 파일 정리 */
        return json_(dup.result);
      }
    }

    /* [v3.4.1] 참조 사진은 사진 추가/폐기와 같은 ScriptLock 안에서 다시 확인한다.
       예전에는 락 밖에서 확인한 뒤 행 락을 기다리는 사이 photo_abandon 이 파일을
       지울 수 있어, 휴지통 파일을 가리키는 메인 행이 저장될 수 있었다. */
    if(photoRequired && usesRefs){
      var rp = hvResolvePhotos_(reqId, photoRefs);
      if(!rp.ok){
        return json_({success:false, row:null,
          photo: photoResult_(true, false, '', 'photo-ref-invalid'),
          error: '사진 연결 실패 — 기록하지 않았습니다: ' + rp.error});
      }
      snPhotoFileId = rp.snFileId; linkPhotos = rp.list; causeCount = rp.causeCount;
    }

    /* [v3.1] 서버측 검증 — 필수값·길이·허용값·비용 숫자 (클라이언트만 믿지 않는다) */
    var vres = hvValidate_(payload);
    if(!vres.ok){
      photoDiscard_(photoFile);
      var vfail = {success:false, row:null,
        photo: photoResult_(photoRequired, false, '', photoRequired ? '기록이 거부되어 사진을 저장하지 않았습니다' : ''),
        errors: vres.errors, error: vres.errors.join(' · ')};
      return json_(vfail);
    }
    var P = vres.clean;
    var warnings = vres.warnings.slice();

    var sh = sheet_(CONFIG.SHEET_NAME);
    if(!sh){ photoDiscard_(photoFile); return json_({success:false, row:null, photo:photoResult_(photoRequired,false,'','시트 없음'), error:'시트 없음: '+CONFIG.SHEET_NAME}); }
    var hdr = findHeader_(sh);
    if(!hdr){ photoDiscard_(photoFile); return json_({success:false, row:null, photo:photoResult_(photoRequired,false,'','헤더 탐지 실패'), error:'헤더(처리일/병원명) 탐지 실패'}); }

    /* [v3.1] 사진 열 확인을 "행을 쓰기 전에" 한다.
       예전에는 행을 다 쓴 뒤에야 열이 없다는 걸 알고 경고만 붙인 채 success:true 였다.
       사진이 필수인 요청이 사진 없이 기록되는 것은 성공이 아니다. */
    var snFileForSheet = photoFile ? photoFile.id : snPhotoFileId;
    var photoCol = snFileForSheet ? colBy_(hdr, PHOTO_COLS) : 0;
    if(snFileForSheet && !photoCol){
      log_('PHOTO_NOCOL', hdr, {file:snFileForSheet});
      photoDiscard_(photoFile);   /* 신규 참조 경로는 photoFile 이 null 이라 no-op */
      var nofail = {success:false, row:null,
        photo: photoResult_(true, false, '', 'no-photo-column'),
        error: '시트에 \''+PHOTO.COL_NAME+'\' 열이 없어 사진을 기록할 수 없습니다 — '
             + '편집기에서 setupHandoverColumns() 를 실행한 뒤 다시 저장하세요.'};
      return json_(nofail);
    }

    /* 신규 참조 경로는 기록 ID가 조인 키다. 일반 셀을 한 칸이라도 쓰기 전에
       초기 설정 누락을 확인해 실패 행이 시트에 일부 남지 않게 한다. */
    var recCol = colBy_(hdr, REC_ID_COLS);
    if(usesRefs && !recCol){
      return json_({success:false, row:null,
        photo:photoResult_(true,false,'','no-record-id-column'),
        error:'시트에 기록 ID 열이 없습니다 — setupPhotoSheet() 를 실행한 뒤 다시 저장하세요.'});
    }

    var row = lastDataRow_(sh, hdr) + 1;
    if(row > sh.getMaxRows()) sh.insertRowAfter(sh.getMaxRows());
    writeSheet = sh; writeRow = row;

    written = [];   /* 롤백 대상 열 */
    function put_(col, value){
      if(!col) return false;
      sh.getRange(row, col).setValue(safeCell_(value));
      written.push(col);
      return true;
    }

    /* 프런트 payload 키 → 시트 열 매핑 (기존 열) */
    var m = {
      '처리일'   : P.date,
      '병원명'   : P.hosp,
      'CS 담당자': P.fse,
      '점검/AS'  : P.gubun,
      '대분류'   : P.cat,
      '유형'     : P.type,
      '교체품'   : P.part,
      '교체비용' : P.cost,
      '내용'     : P.detail,
      /* 노즐 "재사용"(O/X) — 신규 키 nozzleReuse 우선, 구버전 payload.nozzle 은 하위 호환 */
      '노즐 재사용' : (String(payload.nozzleReuse != null ? payload.nozzleReuse : (payload.nozzle||''))
                        .trim().toUpperCase() === 'O' ? 'O' : 'X')
    };
    Object.keys(m).forEach(function(k){ put_(hdr.map[k], m[k]); });

    /* 장비 S/N (Q열 '장비SN' 등 · 열이 존재하고 값이 있을 때만) */
    var snCol = colBy_(hdr, ['장비SN','장비 SN','장비 S/N','S/N(장비)']);
    if(snCol && P.sn) put_(snCol, P.sn);
    /* [v3.4] 기록 ID — 사진 시트와 잇는 유일한 조인 키. 열이 있을 때만 기록한다
       (setupPhotoSheet 전 배포에서도 기존 저장이 계속 동작해야 한다).
       롤백 대상(written)에 포함되도록 put_ 를 쓴다. */
    if(recCol && reqId) put_(recCol, reqId);
    /* 사용자 숙련도 평가 (R·S·T열 · 열이 존재하고 값이 있을 때만) */
    var nsFillCol = colBy_(hdr, ['NS 충진 여부','NS충진여부','NS 충진']);
    if(nsFillCol && P.nsFill) put_(nsFillCol, P.nsFill);
    var nsAmtCol  = colBy_(hdr, ['NS 충진량','NS충진량']);
    if(nsAmtCol && P.nsAmt) put_(nsAmtCol, P.nsAmt);
    var jetCol    = colBy_(hdr, ['젯 분사 판단','젯분사 판단','젯 분사']);
    if(jetCol && P.jet) put_(jetCol, P.jet);
    /* HP 교체 정보 (열이 존재할 때만) */
    if(hdr.map['HP_SN(IN)']  && P.hpIn)  put_(hdr.map['HP_SN(IN)'],  P.hpIn);
    if(hdr.map['__VER_IN']   && P.uVer)  put_(hdr.map['__VER_IN'],   P.uVer);
    if(hdr.map['HP_SN(OUT)'] && P.hpOut) put_(hdr.map['HP_SN(OUT)'], P.hpOut);
    if(hdr.map['__VER_OUT']  && P.wVer)  put_(hdr.map['__VER_OUT'],  P.wVer);

    /* [v3.1] 화면에는 있는데 시트에 저장되지 않던 필드들 —
       열이 있으면 저장하고, 없으면 warnings 로 알린다(프런트가 '저장됨'이라 하지 않게). */
    var authUser = authName_(payload && payload.token);
    var extras = {
      eqKind:P.eqKind, verUI:P.verUI, verHP:P.verHP, nozzleDate:P.nozzleDate,
      result:P.result, remark:P.remark, code:P.code,
      authUser:(authUser && authUser !== P.fse) ? authUser : ''
    };
    var savedFields = {}, missingCols = [];
    Object.keys(HANDOVER_FIELD_COLS).forEach(function(k){
      var v = extras[k];
      var col = colBy_(hdr, HANDOVER_FIELD_COLS[k]);
      if(!col){
        savedFields[k] = false;
        if(v) missingCols.push(HANDOVER_FIELD_COLS[k][0]);
        return;
      }
      if(v) put_(col, v);
      savedFields[k] = !!v;
    });
    if(missingCols.length){
      warnings.push('시트에 다음 열이 없어 저장되지 않았습니다: ' + missingCols.join(', ')
                  + ' — 편집기에서 setupHandoverColumns() 를 실행하세요.');
    }

    /* [v2.8] 장비 S/N 사진 (U열) — 업로드는 위에서 이미 끝났고 여기선 수식만 쓴다.
       수식 기록이 실패하면 "행만 남고 사진은 없는" 반쯤 저장된 상태가 되므로 행을 되돌린다. */
    var photoSaved = false;
    if(snFileForSheet && photoCol){
      try{
        sh.getRange(row, photoCol).setFormula(photoFormula_(snFileForSheet));
        written.push(photoCol);  /* 수식 뒤의 행 높이 조정이 실패해도 사진 열까지 롤백 */
        if(PHOTO.ROW_HEIGHT > 0) sh.setRowHeight(row, PHOTO.ROW_HEIGHT);
        photoSaved = true;
      }catch(fe){
        var rolled = rowRollback_(sh, row, written);
        /* 롤백 자체가 실패했다면 남은 행의 사진 수식이 파일을 계속 참조할 수 있으므로
           파일을 지우지 않고 관리자 확인이 가능하게 보존한다. */
        if(rolled) photoDiscard_(photoFile);
        log_('PHOTO_FORMULA_ERR:'+fe, hdr, logSafe_(payload));
        var ffail = {success:false, row:null,
          photo: photoResult_(true, false, snFileForSheet, String(fe)),
          error: rolled ? '사진 기록 실패 — 기록을 되돌렸습니다: ' + fe
                        : '사진 기록 실패 후 행 롤백도 실패했습니다 — 관리자에게 행 '+row+' 확인을 요청하세요: '+fe};
        return json_(ffail);
      }
    }

    /* [v3.4.1] 메인 행과 사진 메타데이터를 함께 확정한다. 사진 승격이 실패했는데
       success:true 를 반환하면 ORPHAN 정리에서 실제 기록 사진이 삭제될 수 있다.
       따라서 사진 승격까지 성공한 뒤에만 committed 로 바꾼다. */
    var photoLinked = [];
    if(linkPhotos && linkPhotos.length){
      try{
        var linkedCount = hvCommitPhotos_(reqId, linkPhotos, P.hosp, P.sn);
        if(linkedCount !== linkPhotos.length) throw new Error('사진 연결 수 불일치');
        photoLinked = linkPhotos.map(function(it){
          return {clientPhotoId:it.clientPhotoId, kind:it.kind, seq:it.seq,
                  fileId:it.fileId, desc:it.desc};
        });
      }catch(e){
        var linkRolled = rowRollback_(sh, row, written);
        log_('PHOTO_LINK_ERR:'+e, hdr, null);
        return json_({success:false, row:null,
          photo:photoResult_(true,false,snFileForSheet||'',String(e)),
          error:linkRolled ? '사진 연결 실패 — 기록을 되돌렸습니다: '+e
                           : '사진 연결 실패 후 행 롤백도 실패했습니다 — 관리자에게 행 '+row+' 확인을 요청하세요: '+e});
      }
    }
    /* 여기부터는 행과 사진 메타데이터가 함께 확정됐다. */
    committed = true;
    log_('OK', hdr, logSafe_(payload));
    /* 방금 쓴 기록이 조회에 바로 보이도록 관련 캐시를 전부 비운다.
       (조각 캐시라 remove 하나로는 안 되고 bazCacheDrop_ 를 써야 한다) */
    try{ bazDropHandoverCaches_(P.hosp); }catch(e){}
    /* 재고 원장 사용처 자동 기입 (실패해도 본 기록에는 영향 없음) */
    var inv = {done:false, msg:''};
    try{ inv = invRecordUsage_(payload) || inv; }catch(e){ inv = {done:false, msg:'재고 기입 오류(무시): '+e}; }
    if(inv.msg) log_(inv.done?'INV_OK':'INV_SKIP', hdr, {inv:inv.msg});
    var msg = '✅ '+ P.hosp +' 기록 완료 (행 '+row+')';
    warnings.forEach(function(w){ msg += '\n⚠️ ' + w; });
    if(inv.msg) msg += '\n' + (inv.done?'✅ ':'⚠️ ') + inv.msg;
    var out = {success:true, row:row, sheet:CONFIG.SHEET_NAME,
               photo: photoResult_(photoRequired, photoSaved, snFileForSheet||'', ''),
               photos: photoLinked, recordId: reqId,
               savedFields: savedFields, warnings: warnings,
               fseMismatch: !!(authUser && authUser !== P.fse), authUser: authUser,
               inv:inv, msg:msg, error:''};
    /* 재전송·동시 요청이 같은 결과를 받도록 영속 저장 (위 double-checked 확인과 한 쌍) */
    if(reqId) reqPut_(reqId, {ts:Date.now(), result:out, row:row});
    return json_(out);
  }catch(err){
    log_('ERR:'+err, null, logSafe_(payload));
    var rollbackOk = true;
    if(!committed && writeSheet && writeRow) rollbackOk = rowRollback_(writeSheet, writeRow, written);
    if(!committed && rollbackOk) photoDiscard_(photoFile);   /* 반쪽 행이 없을 때만 고아 사진 정리 */
    return json_({success:false, row:null,
      photo: photoResult_(!!(payload && payload.snPhoto), false, '', String(err)),
      error:String(err) + ((!committed && !rollbackOk) ? ' · 행 롤백 실패 — 관리자 확인 필요(행 '+writeRow+')' : '')});
  }finally{
    try{ lock.releaseLock(); }catch(_){}
    /* 멱등성 정리는 응답 작성·전역 락 해제 뒤에만 확률 실행한다. */
    try{ reqPrune_(); }catch(_){}
  }
}

/* ================= GET: 조회 ================= */
function doGet(e){
  _readAllMemo = null;          /* 전역 변수는 실행 컨테이너 사이에 남을 수 있으므로 매 요청 초기화 */
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

    if(action==='ping'){
      /* warm=1(keepWarm·클라이언트 선제 예열) → 스프레드시트 핸들까지 열어 둔다.
         그냥 ping 은 GAS 인스턴스만 깨우고 시트는 콜드로 남아 '첫 시트 불러오기·첫 기록'이
         늦었다. 여기서 기록 대상 시트를 한 번 여는 것만으로 첫 실데이터 요청의 시트 지연이 사라진다. */
      var warmed = false;
      if(p.warm){ try{ ss_().getSheetByName(CONFIG.SHEET_NAME); warmed = true; }catch(_){} }
      return json_({success:true, ver:'3.4.1', warmed:warmed, pong:new Date().toISOString()});
    }
    if(action==='all')    return json_(getAll_(p));
    if(action==='hospdb') return json_(getHospDB_(p));
    if(action==='hospdbrich') return json_(getHospDBRich_(p));  /* [Core] 병원정보DB 전체필드(hospital_gas 대체) */
    if(action==='issuehist')  return json_(getIssueHist_(p));   /* [Core] 병원별 이슈이력(hospital_issue_gas 대체) */
    if(action==='bootstrap')  return json_(getBootstrap_(p));   /* [Core] hospital-pc 부트 1콜(hospdbrich+issuehist) */
    if(action==='inventory') return json_(getInventory_());
    if(action==='ncare')  return json_(getNcare_());            /* [v2.3] N-care 가입 현황 */
    if(action==='recent') return json_(getRecent_(p.hosp||'', Number(p.limit)||5));
    if(action==='today')  return json_(getToday_(p.fse||'', p.token||''));
    /* [v3.1] 저장 결과 조회 — 응답을 못 받은 요청이 실제로 기록됐는지 확인한다.
       no-cors 재전송으로 "보냈으니 됐겠지" 하던 자리를 대체하는 인증된 판정 API. */
    if(action==='savecheck') return json_(saveCheck_(p));
    /* [v3.1] handover 부트 1콜 — 버전·병원DB·마스터·FSE·템플릿·자동대상을 한 번에 */
    if(action==='handover_bootstrap') return json_(getHandoverBootstrap_(p));
    if(action==='master') return json_(getMaster_());
    if(action==='guide')  return json_(gateGuide_(p));          /* [v2.1] Lv.3 토큰 게이트 */
    if(action==='weekly') return json_(wkGetWeekly_(p));        /* [v2.1] 주간 처리 내역 */
    if(action==='menu')   return json_(menuGet_());             /* [v2.1] 허브 메뉴 설정 */
    if(action==='weeklyauto') return json_(weeklyAutoGet_());   /* 주간 자동기재 대상 작성자 목록 */
    if(action==='contenttpl') return json_(contentTplGet_());  /* 처리내용 자동완성 템플릿 */
    if(action==='progress') return json_(progGet_(p));          /* [v2.4] 진행중 공유 상태 ([v2.7] rev 조건부 응답) */
    if(action==='labellist') return json_(labelList_(p));       /* [v2.8] 장비 Label List 원본 */
    if(action==='snphoto')   return json_(snPhotos_(p));    /* [v2.8] 장비 S/N 사진 base64 (?sz= 로 썸네일) */
    if(action==='photolist') return json_(photoList_(p));   /* [v3.4] 사진 메타 보조 조회(로그인 필수) */
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

/* 사진 없는 전체 읽기는 한 GAS 실행 안에서 한 번만 수행한다.
   bootstrap의 issuehist + all 재생성이 같은 시트 스냅샷을 공유하도록 한다. */
var _readAllMemo = null;
function readAllMemo_(){
  if(_readAllMemo) return _readAllMemo;
  _readAllMemo = readAll_();
  return _readAllMemo;
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
  try{ syncCacheDrop_('handover_bootstrap'); }catch(e){}
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

/** dataURL(base64 JPEG) → Drive 파일 저장 · {id, url} 반환
    meta.key 를 주면 파일명 끝에 붙인다 — 같은 병원·같은 날 사진이 동명이 되는 것을 막는다
    (예전에는 `날짜_병원_SN` 고정이라 원인 사진 여러 장이 전부 같은 이름이었다). */
function savePhoto_(dataUrl, meta){
  var s = String(dataUrl||'');
  var mm = s.match(/^data:(image\/[a-z+.-]+);base64,([\s\S]+)$/i);
  if(!mm) throw new Error('사진 형식 오류 (dataURL 아님)');
  var mime = mm[1], b64 = mm[2].replace(/\s/g,'');
  var ext  = mime.indexOf('png')>=0 ? 'png' : (mime.indexOf('webp')>=0 ? 'webp' : 'jpg');
  var name = [safeName_((meta&&meta.date)||''), safeName_((meta&&meta.hosp)||''),
              safeName_((meta&&meta.sn)||''), safeName_((meta&&meta.key)||'')].filter(Boolean).join('_') || 'sn_photo';
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

/* ═══════════ [v3.4] 다중 사진 — '현장 사진' 정규화 시트 ═══════════
 *  왜 별도 시트인가: 사진 1장당 메인 시트에 열을 늘리면 헤더가 무한히 자라고
 *  기존 열 탐색(colBy_)과 Excel 출력이 전부 흔들린다. 사진은 행으로 쌓는다.
 *
 *  조인 키는 '기록ID'(= 저장 요청의 reqId = 클라이언트 recordId) 하나다.
 *  병원명+S/N 은 같은 병원 재방문 시 충돌하므로 조인 키로 쓰지 않는다.
 *
 *  [보안 주의] 사진은 savePhoto_ 가 ANYONE_WITH_LINK 로 공유한다(=IMAGE 렌더링·
 *  썸네일 대리 조회에 필요). 링크를 아는 사람은 누구나 열람할 수 있다.
 *  S/N 라벨과 달리 '문제 원인 사진'에는 병원 내부·환자 주변 환경이 함께 찍힐 수
 *  있으므로, 촬영 범위를 좁히도록 화면에서 안내한다. 이 공개 범위는 안정성과
 *  속도를 우선한 의도적 선택이다(비공개 전환은 후속 범위).
 */
var SNAP = {
  SHEET     : '현장 사진',
  KIND_SN   : 'SN',
  KIND_CAUSE: 'CAUSE',
  MAX_CAUSE : 5,                 /* 기록당 원인 사진 상한 */
  ST_ORPHAN : 'ORPHAN',          /* 업로드됐지만 아직 기록에 연결되지 않음 */
  ST_OK     : 'OK',              /* 기록에 연결 완료 */
  MAX_DESC  : 200
};
var SNAP_HEAD = ['기록ID','사진ID','병원명','장비S/N','사진구분','순번',
                 'Drive파일ID','사진설명','등록일시','업로드상태','요청ID'];
var SNAP_ERR_SETUP = '현장 사진 시트가 준비되지 않았습니다 — Apps Script 편집기에서 setupPhotoSheet() 를 먼저 실행하세요.';
var REC_ID_COLS = ['기록 ID','기록ID','recordId'];

/** 사진 시트 확보(없으면 생성). histSheet_ 가 헤더 스키마 마이그레이션까지 해 준다. */
function photoSheet_(){ return histSheet_(SNAP.SHEET, SNAP_HEAD); }
/** 이미 만들어진 경우에만 반환 — 신규 action 이 시트를 몰래 만들지 않게 한다 */
function photoSheetIfReady_(){ return sheet_(SNAP.SHEET); }

function photoKeyClean_(v){ return String(v==null?'':v).replace(/[^A-Za-z0-9_-]/g,'').slice(0,64); }
function photoDescClean_(v){ return String(v==null?'':v).replace(/[\r\n\t]+/g,' ').trim().slice(0, SNAP.MAX_DESC); }

/** 사진 시트 전체를 한 번만 읽어 객체 배열로 — 행마다 조회하지 않는다 */
function photoReadAll_(){
  var sh = photoSheetIfReady_();
  if(!sh) return [];
  var last = sh.getLastRow();
  if(last < 2) return [];
  var v = sh.getRange(2, 1, last-1, SNAP_HEAD.length).getDisplayValues();
  var out = [];
  for(var i=0;i<v.length;i++){
    var r = v[i];
    if(!String(r[0]||'').trim() && !String(r[6]||'').trim()) continue;   /* 완전 빈 행 스킵 */
    out.push({ recordId:String(r[0]||'').trim(), photoId:String(r[1]||'').trim(),
               hosp:String(r[2]||'').trim(), sn:String(r[3]||'').trim(),
               kind:String(r[4]||'').trim().toUpperCase(), seq:Number(r[5])||0,
               fileId:String(r[6]||'').trim(), desc:String(r[7]||''),
               at:String(r[8]||''), status:String(r[9]||'').trim().toUpperCase(),
               reqId:String(r[10]||'').trim(), _row:i+2 });
  }
  return out;
}

/** recordId+photoId 복합키 조회 — 멱등성의 기준 */
function photoFind_(rows, recordId, photoId){
  for(var i=0;i<rows.length;i++){
    if(rows[i].recordId===recordId && rows[i].photoId===photoId) return rows[i];
  }
  return null;
}
/** Drive 파일 ID 중복 방지(백필용) */
function photoHasFile_(rows, fileId){
  for(var i=0;i<rows.length;i++){ if(rows[i].fileId===fileId) return true; }
  return false;
}
function photoRowValues_(o){
  return [ o.recordId, o.photoId, safeCell_(o.hosp||''), safeCell_(o.sn||''), o.kind,
           Number(o.seq)||0, o.fileId, safeCell_(o.desc||''),
           o.at || Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm:ss'),
           o.status, o.reqId||'' ];
}
function photoAppend_(sh, o){
  sh.getRange(sh.getLastRow()+1, 1, 1, SNAP_HEAD.length).setValues([photoRowValues_(o)]);
}

/**
 * POST {action:'photo_add', recordId, clientPhotoId, uploadReqId, kind, seq, hosp, sn, date, desc, dataUrl, token}
 * 사진 1장만 업로드한다. Drive 업로드는 전역 락 밖에서, 메타 확정만 짧은 락 안에서.
 * 멱등 키는 recordId+clientPhotoId 복합키 — 같은 사진 재전송이 Drive 파일을 늘리지 않는다.
 */
function photoAdd_(p){
  var recordId = photoKeyClean_(p && p.recordId);
  var photoId  = photoKeyClean_(p && p.clientPhotoId);
  if(!recordId || !photoId) return {success:false, error:'recordId·clientPhotoId 가 필요합니다'};
  var sh = photoSheetIfReady_();
  if(!sh) return {success:false, error:SNAP_ERR_SETUP};

  var kind = String((p&&p.kind)||'').trim().toUpperCase();
  if(kind !== SNAP.KIND_SN && kind !== SNAP.KIND_CAUSE){
    return {success:false, error:'사진 구분은 SN 또는 CAUSE만 가능합니다'};
  }
  var seq  = Math.max(1, Math.min(Number(p&&p.seq)||1, SNAP.MAX_CAUSE));

  /* 1) 락 밖 사전 조회 — 이미 올라간 사진이면 업로드 자체를 건너뛴다 */
  var pre = photoFind_(photoReadAll_(), recordId, photoId);
  if(pre) return {success:true, dedup:true, clientPhotoId:photoId, fileId:pre.fileId, status:pre.status};

  /* 2) Drive 업로드는 반드시 락 밖 — 콜드스타트가 락 보유 시간을 잡아먹지 않게 */
  var file = null;
  try{ file = savePhoto_(p && p.dataUrl, {date:p&&p.date, hosp:p&&p.hosp, sn:p&&p.sn, key:photoId}); }
  catch(e){ return {success:false, error:'사진 저장 실패: '+e}; }

  /* 3) 짧은 전용 락 안에서 재조회(double-check) — 동시 요청 둘이 각자 올려도 하나만 남는다 */
  var lock = LockService.getScriptLock(), held = false;
  try{ lock.waitLock(15000); held = true; }
  catch(lockErr){
    photoDiscard_(file);
    return {success:false, busy:true, error:'busy — 사진 등록이 진행 중입니다. 잠시 후 다시 시도하세요.'};
  }
  try{
    var again = photoFind_(photoReadAll_(), recordId, photoId);
    if(again){
      photoDiscard_(file);                       /* 방금 올린 중복 파일 회수 */
      return {success:true, dedup:true, clientPhotoId:photoId, fileId:again.fileId, status:again.status};
    }
    photoAppend_(sh, {recordId:recordId, photoId:photoId, hosp:p&&p.hosp, sn:p&&p.sn,
      kind:kind, seq:seq, fileId:file.id, desc:photoDescClean_(p&&p.desc),
      status:SNAP.ST_ORPHAN, reqId:photoKeyClean_((p&&p.uploadReqId)||photoId)});
    return {success:true, dedup:false, clientPhotoId:photoId, fileId:file.id, status:SNAP.ST_ORPHAN};
  }catch(err){
    photoDiscard_(file);
    return {success:false, error:String(err)};
  }finally{
    if(held){ try{ lock.releaseLock(); }catch(_){} }
  }
}

/**
 * POST {action:'photo_abandon', recordId, clientPhotoId, token}
 * 아직 기록에 연결되지 않은(ORPHAN) 사진만 폐기한다. 연결 완료(OK)는 거부.
 * 실패해도 행은 남으므로 cleanupOrphanPhotos 가 나중에 정리한다.
 */
function photoAbandon_(p){
  var recordId = photoKeyClean_(p && p.recordId);
  var photoId  = photoKeyClean_(p && p.clientPhotoId);
  if(!recordId || !photoId) return {success:false, error:'recordId·clientPhotoId 가 필요합니다'};
  var sh = photoSheetIfReady_();
  if(!sh) return {success:false, error:SNAP_ERR_SETUP};

  var lock = LockService.getScriptLock(), held = false;
  try{ lock.waitLock(15000); held = true; }
  catch(lockErr){ return {success:false, busy:true, error:'busy — 잠시 후 다시 시도하세요.'}; }
  try{
    var hit = photoFind_(photoReadAll_(), recordId, photoId);
    if(!hit) return {success:true, removed:false, reason:'not-found'};
    if(hit.status === SNAP.ST_OK){
      return {success:false, error:'이미 기록에 연결된 사진은 폐기할 수 없습니다'};
    }
    try{ DriveApp.getFileById(hit.fileId).setTrashed(true); }
    catch(e){
      /* 메타 행을 먼저 없애면 재시도·정기 정리 모두 불가능한 영구 고아가 된다. */
      Logger.log('[photo] abandon Drive 정리 실패(메타 유지): '+e);
      return {success:false, error:'Drive 사진 정리에 실패했습니다 — 잠시 후 다시 시도하세요'};
    }
    sh.deleteRow(hit._row);
    return {success:true, removed:true, clientPhotoId:photoId};
  }catch(err){
    return {success:false, error:String(err)};
  }finally{
    if(held){ try{ lock.releaseLock(); }catch(_){} }
  }
}

/** GET ?action=photolist&recIds=A,B,C — 보조/관리용. 기본 경로는 labelList_ 가 함께 반환한다 */
function photoList_(p){
  var want = String((p&&p.recIds)||'').split(',').map(photoKeyClean_).filter(Boolean);
  var rows = photoReadAll_();
  var out = {};
  rows.forEach(function(r){
    if(r.status !== SNAP.ST_OK) return;
    if(want.length && want.indexOf(r.recordId) < 0) return;
    (out[r.recordId] = out[r.recordId] || []).push(
      {clientPhotoId:r.photoId, kind:r.kind, seq:r.seq, fileId:r.fileId, desc:r.desc});
  });
  Object.keys(out).forEach(function(k){ out[k] = photoSortList_(out[k]); });
  return {success:true, count:Object.keys(out).length, photos:out};
}
/** S/N 먼저, 그 다음 원인 사진을 순번대로 — Excel 열 순서와 화면 순서를 같게 유지 */
function photoSortList_(list){
  return list.sort(function(a,b){
    if(a.kind!==b.kind) return a.kind===SNAP.KIND_SN ? -1 : 1;
    return (a.seq||0)-(b.seq||0);
  });
}

/** recordId → 사진 배열 맵. 사진 시트를 한 번만 읽는다(행마다 조회 금지) */
function photoMapByRecord_(){
  var map = {};
  photoReadAll_().forEach(function(r){
    if(r.status !== SNAP.ST_OK) return;
    (map[r.recordId] = map[r.recordId] || []).push(
      {clientPhotoId:r.photoId, kind:r.kind, seq:r.seq, fileId:r.fileId, desc:r.desc});
  });
  Object.keys(map).forEach(function(k){ map[k] = photoSortList_(map[k]); });
  return map;
}

/* ── 최종 저장에서의 사진 연결 ─────────────────────────────────────────────
   클라이언트는 최종 payload 에 Drive 파일 ID 를 보내지 않는다. 서버가
   recordId+clientPhotoId 로 시트를 조회해 파일 ID 를 결정한다 — 위조된 파일 ID 를
   "검증"하는 구조가 아니라 애초에 받지 않는 구조다. */

/** payload.photos 정규화 (fileId 는 무시한다) */
function hvPhotoRefs_(payload){
  var arr = (payload && payload.photos && payload.photos.length) ? payload.photos : [];
  var out = [];
  for(var i=0;i<arr.length;i++){
    var o = arr[i] || {};
    var id = photoKeyClean_(o.clientPhotoId);
    var kind = String(o.kind||'').trim().toUpperCase();
    out.push({ clientPhotoId:id,
      kind:kind,
      seq:Math.max(1, Math.min(Number(o.seq)||1, SNAP.MAX_CAUSE)),
      desc:photoDescClean_(o.desc) });
  }
  return out;
}

/** recordId+clientPhotoId → Drive 파일 ID 결정. 남의 recordId 사진은 조회되지 않는다. */
function hvResolvePhotos_(recordId, refs){
  if(!photoSheetIfReady_()) return {ok:false, error:SNAP_ERR_SETUP};
  var rows = photoReadAll_(), sn = [], causes = [], list = [];
  if(refs.length > SNAP.MAX_CAUSE + 1){
    return {ok:false, error:'사진은 S/N 1장과 원인 사진 최대 '+SNAP.MAX_CAUSE+'장까지 등록할 수 있습니다'};
  }
  var seen = {};
  for(var i=0;i<refs.length;i++){
    if(!refs[i].clientPhotoId) return {ok:false, error:'사진 ID가 비어 있습니다'};
    if(refs[i].kind !== SNAP.KIND_SN && refs[i].kind !== SNAP.KIND_CAUSE){
      return {ok:false, error:'허용되지 않은 사진 구분입니다: '+refs[i].kind};
    }
    if(seen[refs[i].clientPhotoId]){
      return {ok:false, error:'같은 사진이 중복 참조됐습니다: '+refs[i].clientPhotoId};
    }
    seen[refs[i].clientPhotoId] = true;
    var hit = photoFind_(rows, recordId, refs[i].clientPhotoId);
    if(!hit) return {ok:false, error:'연결할 수 없는 사진입니다(업로드 기록 없음): '+refs[i].clientPhotoId};
    if(hit.status !== SNAP.ST_ORPHAN && hit.status !== SNAP.ST_OK){
      return {ok:false, error:'사진 상태가 연결 가능하지 않습니다: '+refs[i].clientPhotoId};
    }
    if(hit.kind !== refs[i].kind){
      return {ok:false, error:'업로드된 사진 구분과 저장 요청이 다릅니다: '+refs[i].clientPhotoId};
    }
    if(!hit.fileId) return {ok:false, error:'Drive 파일 ID가 없는 사진입니다: '+refs[i].clientPhotoId};
    var item = {clientPhotoId:refs[i].clientPhotoId, kind:refs[i].kind, seq:refs[i].seq,
                desc:refs[i].desc, fileId:hit.fileId, at:hit.at, _row:hit._row,
                previousStatus:hit.status};
    if(item.kind===SNAP.KIND_SN) sn.push(item); else causes.push(item);
    list.push(item);
  }
  if(sn.length !== 1) return {ok:false, error:'장비 S/N 사진은 정확히 1장이어야 합니다(현재 '+sn.length+'장)'};
  if(causes.length > SNAP.MAX_CAUSE) return {ok:false, error:'원인 사진은 최대 '+SNAP.MAX_CAUSE+'장입니다'};
  return {ok:true, snFileId:sn[0].fileId, list:list, causeCount:causes.length};
}

/** 행 확정 후 ORPHAN → OK 승격 + 설명·순번을 최종 payload 기준으로 재반영 */
function hvCommitPhotos_(recordId, list, hosp, sn){
  var sh = photoSheetIfReady_();
  if(!sh || !list || !list.length) return 0;
  var n = 0, changed = [];
  try{
    list.forEach(function(it){
      var before = sh.getRange(it._row, 1, 1, SNAP_HEAD.length).getValues()[0];
      sh.getRange(it._row, 1, 1, SNAP_HEAD.length).setValues([photoRowValues_({
        recordId:recordId, photoId:it.clientPhotoId, hosp:hosp, sn:sn, kind:it.kind,
        seq:it.seq, fileId:it.fileId, desc:it.desc, at:it.at,
        status:SNAP.ST_OK, reqId:recordId})]);
      changed.push({row:it._row, values:before});
      n++;
    });
  }catch(e){
    /* 일부 사진만 OK 로 남지 않도록 가능한 범위에서 이전 행을 복원한다. */
    for(var i=changed.length-1;i>=0;i--){
      try{ sh.getRange(changed[i].row,1,1,SNAP_HEAD.length).setValues([changed[i].values]); }
      catch(re){ Logger.log('[photo] 연결 롤백 실패: '+re); }
    }
    throw e;
  }
  return n;
}

/* ── 초기 설정 · 백필 · 정리 (편집기에서 수동 실행) ───────────────────────── */

/** 1단계: 시트와 기록 ID 열만 만든다. 백필은 backfillLegacyPhotos 가 따로 한다. */
function setupPhotoSheet(){
  photoSheet_();
  var added = ensureRecordIdColumn_();
  photoFolder_();                                   /* Drive 권한 승인 유도 */
  var msg = '✅ 현장 사진 시트 준비 완료' + (added ? ' · 메인 시트에 기록 ID 열 생성' : ' · 기록 ID 열 이미 있음')
          + '\n다음: backfillLegacyPhotos(200) 을 잔여 0 이 될 때까지 반복 실행하세요.';
  Logger.log(msg);
  return msg;
}

/** 메인 시트에 '기록 ID' 열이 없으면 마지막 헤더 오른쪽에 만든다 */
function ensureRecordIdColumn_(){
  var sh = sheet_(CONFIG.SHEET_NAME);
  if(!sh) throw new Error('시트 없음: ' + CONFIG.SHEET_NAME);
  var hdr = findHeader_(sh);
  if(!hdr) throw new Error('헤더(처리일·병원명) 탐지 실패');
  if(colBy_(hdr, REC_ID_COLS)) return false;
  var lastCol = 0;
  hdr.headers.forEach(function(h,i){ if(String(h||'').trim()) lastCol = i+1; });
  var at = lastCol + 1;
  if(sh.getMaxColumns() < at) sh.insertColumnsAfter(sh.getMaxColumns(), at - sh.getMaxColumns());
  sh.getRange(hdr.row, at).setValue(REC_ID_COLS[0]).setFontWeight('bold');
  try{ sh.getRange(hdr.row+1, at, Math.max(1, sh.getMaxRows()-hdr.row), 1).setNumberFormat('@'); }catch(e){}
  sh.setColumnWidth(at, 150);
  return true;
}

var BACKFILL_CURSOR = 'snap_backfill_row';
/**
 * 2단계: 기존 행에 영구 기록 ID를 부여하고 S/N 사진을 현장 사진 시트에 등록한다.
 * ScriptProperties 에 마지막 처리 행을 남겨 반복 실행할 수 있다(6분 한도 회피).
 * 멱등: 이미 기록 ID 가 있거나 같은 Drive 파일 ID 가 등록돼 있으면 건너뛴다.
 */
function backfillLegacyPhotos(batchSize){
  var n = Math.max(1, Math.min(Number(batchSize)||200, 1000));
  var sh = sheet_(CONFIG.SHEET_NAME);
  var hdr = sh && findHeader_(sh);
  if(!hdr) throw new Error('헤더 탐지 실패');
  var recCol = colBy_(hdr, REC_ID_COLS);
  if(!recCol) throw new Error('기록 ID 열이 없습니다 — setupPhotoSheet() 를 먼저 실행하세요');
  var photoCol = colBy_(hdr, PHOTO_COLS);
  var psh = photoSheetIfReady_();
  if(!psh) throw new Error(SNAP_ERR_SETUP);

  var props = PropertiesService.getScriptProperties();
  var start = Math.max(hdr.row+1, Number(props.getProperty(BACKFILL_CURSOR)) || (hdr.row+1));
  var last = lastDataRow_(sh, hdr);
  if(start > last){ return {success:true, done:true, processed:0, next:start, last:last}; }

  var end = Math.min(last, start + n - 1);
  var cnt = end - start + 1;
  var recVals = sh.getRange(start, recCol, cnt, 1).getDisplayValues();
  var phFx    = photoCol ? sh.getRange(start, photoCol, cnt, 1).getFormulas() : null;
  var phVal   = photoCol ? sh.getRange(start, photoCol, cnt, 1).getDisplayValues() : null;
  var hospCol = colBy_(hdr, ['병원명']), snCol = colBy_(hdr, ['장비SN','장비 SN','SN']);
  var hospVals = hospCol ? sh.getRange(start, hospCol, cnt, 1).getDisplayValues() : null;
  var snVals   = snCol   ? sh.getRange(start, snCol,   cnt, 1).getDisplayValues() : null;

  var known = photoReadAll_();
  var newRecIds = [], appendRows = [], made = 0, linked = 0;
  for(var i=0;i<cnt;i++){
    var row = start + i;
    var rec = String(recVals[i][0]||'').trim();
    var fileId = phFx ? photoIdFromFormula_(phFx[i][0] || (phVal?phVal[i][0]:'')) : '';
    if(!rec){
      /* 행 번호는 정렬로 바뀔 수 있으므로 파일 ID 앞자리를 함께 넣어 충돌을 막는다 */
      rec = 'LEGACY-' + row + '-' + (fileId ? fileId.slice(0,8) : Utilities.getUuid().slice(0,8));
      made++;
    }
    newRecIds.push([rec]);
    if(fileId && !photoHasFile_(known, fileId)){
      appendRows.push(photoRowValues_({
        recordId:rec, photoId:'LEGACYSN-'+fileId.slice(0,12), hosp:hospVals?hospVals[i][0]:'',
        sn:snVals?snVals[i][0]:'', kind:SNAP.KIND_SN, seq:1, fileId:fileId, desc:'',
        status:SNAP.ST_OK, reqId:rec}));
      known.push({recordId:rec, photoId:'', fileId:fileId, status:SNAP.ST_OK});
      linked++;
    }
  }
  sh.getRange(start, recCol, cnt, 1).setValues(newRecIds);
  if(appendRows.length){
    psh.getRange(psh.getLastRow()+1, 1, appendRows.length, SNAP_HEAD.length).setValues(appendRows);
  }
  props.setProperty(BACKFILL_CURSOR, String(end+1));
  var res = {success:true, done:(end>=last), processed:cnt, idsCreated:made, photosLinked:linked,
             from:start, to:end, last:last, next:end+1};
  Logger.log(JSON.stringify(res));
  return res;
}

/** 백필 진행 상황 */
function getPhotoMigrationStatus(){
  var sh = sheet_(CONFIG.SHEET_NAME), hdr = sh && findHeader_(sh);
  if(!hdr) return {success:false, error:'헤더 탐지 실패'};
  var last = lastDataRow_(sh, hdr);
  var total = Math.max(0, last - hdr.row);
  var cursor = Number(PropertiesService.getScriptProperties().getProperty(BACKFILL_CURSOR)) || (hdr.row+1);
  var done = Math.max(0, Math.min(total, cursor - hdr.row - 1));
  var res = {success:true, total:total, done:done, remain:Math.max(0, total-done),
             lastRow:last, cursor:cursor, photoRows:photoReadAll_().length,
             hasRecordIdCol:!!colBy_(hdr, REC_ID_COLS), hasPhotoSheet:!!photoSheetIfReady_()};
  Logger.log(JSON.stringify(res));
  return res;
}

/** 오래된 ORPHAN(기록에 끝내 연결되지 않은) 사진과 Drive 파일 정리 */
function cleanupOrphanPhotos(maxAgeHours){
  var maxAge = Math.max(1, Number(maxAgeHours)||48);
  var sh = photoSheetIfReady_();
  if(!sh) return {success:false, error:SNAP_ERR_SETUP};
  var cutoff = Date.now() - maxAge*3600*1000;
  var rows = photoReadAll_(), removed = 0, kept = 0;
  /* 아래에서 위로 지워야 행 번호가 밀리지 않는다 */
  rows.sort(function(a,b){ return b._row - a._row; }).forEach(function(r){
    if(r.status === SNAP.ST_OK){ kept++; return; }
    var t = Date.parse(String(r.at||'').replace(' ','T'));
    if(isNaN(t) || t > cutoff){ kept++; return; }
    var trashed = false;
    try{ DriveApp.getFileById(r.fileId).setTrashed(true); trashed = true; }
    catch(e){ Logger.log('[photo] 고아 Drive 정리 실패(메타 유지): '+e); }
    if(trashed){ try{ sh.deleteRow(r._row); removed++; }catch(e){} }
    else kept++;
  });
  var res = {success:true, removed:removed, kept:kept, maxAgeHours:maxAge};
  Logger.log(JSON.stringify(res));
  return res;
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

/**
 * [v3.1] handover 화면의 모든 입력이 실제로 저장될 열을 한 번에 만든다 — 편집기에서 1회 실행.
 *  · 사진 열('장비 S/N 사진') 포함
 *  · UI Ver · HP Ver · 노즐 제조일자 · A/S 결과 · 비고 · 장비 구분 · 유형 코드 · 로그인 사용자
 *  이미 있는 열은 건드리지 않고, 없는 열만 마지막 헤더 오른쪽에 덧붙인다.
 *  (수식·자동 열은 손대지 않는다 — 헤더 추가만 한다)
 */
function setupHandoverColumns(){
  var sh = sheet_(CONFIG.SHEET_NAME);
  if(!sh){ Logger.log('❌ 시트 없음: ' + CONFIG.SHEET_NAME); return '시트없음'; }
  var hdr = findHeader_(sh);
  if(!hdr){ Logger.log('❌ 헤더(처리일/병원명) 탐지 실패'); return '헤더없음'; }

  /* 만들 열 목록: 사진 + 저장 계약 필드 (첫 번째 별칭을 헤더 이름으로 쓴다) */
  var want = [{key:'photo', names:PHOTO_COLS, label:PHOTO.COL_NAME, width:100}];
  Object.keys(HANDOVER_FIELD_COLS).forEach(function(k){
    want.push({key:k, names:HANDOVER_FIELD_COLS[k], label:HANDOVER_FIELD_COLS[k][0], width:0});
  });

  var lastNamed = 0;
  hdr.headers.forEach(function(h,i){ if(String(h).trim()) lastNamed = i+1; });

  var made = [], kept = [];
  want.forEach(function(w){
    if(colBy_(hdr, w.names)){ kept.push(w.label); return; }
    var col = ++lastNamed;
    if(col > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), col - sh.getMaxColumns());
    sh.getRange(hdr.row, col).setValue(w.label);
    if(w.width) sh.setColumnWidth(col, w.width);
    made.push(w.label + '(' + colLetter_(col) + '열)');
    hdr = findHeader_(sh);   /* 다음 colBy_ 가 새 헤더를 보도록 갱신 */
    hdr.headers.forEach(function(h,i){ if(String(h).trim()) lastNamed = Math.max(lastNamed, i+1); });
  });

  var folder = photoFolder_();                          /* Drive 권한 승인 유도 */
  Logger.log('✅ 이미 있던 열: %s', kept.join(', ') || '(없음)');
  Logger.log('✅ 새로 만든 열: %s', made.join(', ') || '(없음)');
  Logger.log('📁 사진 저장 폴더: %s (%s)', folder.getName(), folder.getId());
  return {made:made, kept:kept};
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
  /* [v3.4] 기록 ID 를 함께 읽는다. slim_ 에 넣지 않는 이유는 대시보드가 쓰는
     ?action=all 응답이 행마다 커지기 때문 — 여기서만 원본 행에서 꺼낸다. */
  var hit = [];
  readAll_(true).rows.forEach(function(o){                      /* true = 사진 열까지 읽기 */
    var r = slim_(o);
    var d = parseD_(r.date);
    if(!d || d < from || d > to) return;
    var nm = String(r.hosp||'').trim();
    if(!nm) return;
    if(doneSet[norm_(nm)]){ doneHit[norm_(nm)] = nm; return; }   /* 이미 작성 → 제외 */
    if(qf){
      var f = norm_(r.fse);
      if(!(f && (f===qf || f.indexOf(qf)>=0 || qf.indexOf(f)>=0))) return;
    }
    r._recId = String(pickH_(o, REC_ID_COLS)||'').trim();
    hit.push(r);
  });

  /* 병원+S/N 중복 제거 — 뒤(최근) 기록이 앞 기록을 덮어쓴다 */
  var seen = {}, order = [];
  hit.forEach(function(r){
    var key = norm_(r.hosp) + '|' + norm_(r.sn);
    if(!(key in seen)) order.push(key);
    seen[key] = r;
  });

  /* [v3.4] 사진 시트를 '한 번만' 읽어 recordId 맵으로 만든다 — 행마다 조회하면
     행 수만큼 시트 왕복이 생기고, photolist 를 따로 부르면 URL 이 길어지고 왕복이 는다. */
  var photoMap = {};
  try{ photoMap = photoMapByRecord_(); }catch(e){ Logger.log('[label] 사진 맵 실패(무시): '+e); }

  var rows = order.map(function(key){
    var r = seen[key];
    var recId = r._recId || '';
    var list = (recId && photoMap[recId]) ? photoMap[recId] : [];
    /* 기록 ID 가 아직 없는 legacy 행은 S/N 파일 ID 로만 폴백한다 */
    if(!list.length && r.snPhotoId){
      list = [{clientPhotoId:'', kind:SNAP.KIND_SN, seq:1, fileId:r.snPhotoId, desc:''}];
    }
    var snHit = null;
    for(var i=0;i<list.length;i++){ if(list[i].kind===SNAP.KIND_SN){ snHit=list[i]; break; } }
    return {
      date: r.date, hosp: r.hosp, sn: r.sn, fse: r.fse, gubun: r.gubun,
      note: /\[데모장비\]/.test(String(r.detail||'')) ? '데모 장비' : '병원 장비',
      recordId: recId,
      photoId: (snHit && snHit.fileId) || r.snPhotoId || '',   /* 기존 label.html 호환(단수) */
      photos: list                                              /* 신규 UI 용(S/N + 원인) */
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
/* [v3.4] 배치 상한 — label.html 의 PHOTO_BATCH 와 반드시 같은 값이어야 한다.
   서버가 초과분을 조용히 잘라내므로(아래 slice) 불일치하면 사진이 말없이 누락된다.
   썸네일 응답은 원본의 1/10 수준이라 4 → 8 로 올린다. */
var SNPHOTO_MAX = 8;
var SNPHOTO_DEF_SZ = 800;

/** Drive 가 만들어 둔 썸네일을 서버가 대신 받아 온다.
 *  GAS 에는 이미지 리사이즈 API 가 없어서, 예전에는 원본 blob 을 그대로 base64 로
 *  부풀려(약 1.33배) 내려보냈다 — label.html 이 느린 핵심 원인이었다.
 *  파일은 savePhoto_ 가 ANYONE_WITH_LINK 로 공유하므로 무인증 fetch 로 충분하지만,
 *  공유 설정이 실패한 파일을 위해 OAuth 토큰도 함께 보낸다.
 *  실패하면 기존 원본 blob 경로로 폴백해 동작 자체는 보장한다. */
function snPhotoThumbUrl_(id, sz){
  return 'https://drive.google.com/thumbnail?id=' + id + '&sz=w' + sz;
}
function snPhotoFetchThumbs_(ids, sz){
  var out = {};
  if(!ids.length || typeof UrlFetchApp === 'undefined') return out;
  var token = '';
  try{ token = ScriptApp.getOAuthToken(); }catch(e){}
  var reqs = ids.map(function(id){
    var r = {url:snPhotoThumbUrl_(id, sz), muteHttpExceptions:true, followRedirects:true};
    if(token) r.headers = {Authorization:'Bearer ' + token};
    return r;
  });
  var res;
  try{ res = UrlFetchApp.fetchAll(reqs); }   /* 같은 배치를 병렬로 */
  catch(e){ Logger.log('[snphoto] fetchAll 실패(폴백): '+e); return out; }
  for(var i=0;i<res.length;i++){
    try{
      var r = res[i];
      if(!r || r.getResponseCode() !== 200) continue;
      var blob = r.getBlob();
      var ct = String(blob.getContentType()||'');
      /* 로그인/오류 HTML 을 이미지라고 우기지 않는다 */
      if(ct.indexOf('image/') !== 0) continue;
      var bytes = blob.getBytes();
      if(!bytes || !bytes.length) continue;
      out[ids[i]] = 'data:' + ct + ';base64,' + Utilities.base64Encode(bytes);
    }catch(e){}
  }
  return out;
}
function snPhotos_(p){
  var ids = String(p.ids||'').split(',')
    .map(function(s){ return String(s).trim(); })
    .filter(function(s){ return /^[A-Za-z0-9_-]{20,}$/.test(s); });
  if(!ids.length) return {success:false, error:'ids 파라미터 필요'};
  if(ids.length > SNPHOTO_MAX) ids = ids.slice(0, SNPHOTO_MAX);

  /* sz 를 주면 썸네일 경로, 없으면 예전과 똑같이 원본 — 기존 응답 계약을 깨지 않는다 */
  var wantThumb = String(p.sz||'').trim() !== '';
  var sz = Math.min(Math.max(Number(p.sz) || SNPHOTO_DEF_SZ, 200), 1600);

  var photos = wantThumb ? snPhotoFetchThumbs_(ids, sz) : {};
  var thumbHit = Object.keys(photos).length;
  var failed = [];
  ids.forEach(function(id){
    if(photos[id]) return;
    try{
      var blob = DriveApp.getFileById(id).getBlob();     /* 폴백: 원본 */
      photos[id] = 'data:' + (blob.getContentType()||'image/jpeg') + ';base64,' +
                   Utilities.base64Encode(blob.getBytes());
    }catch(e){ failed.push(id); }
  });
  return {success:true, count:Object.keys(photos).length, photos:photos, failed:failed,
          thumb:thumbHit, sz:wantThumb?sz:0, max:SNPHOTO_MAX};
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
    syncCacheDrop_('handover_all');
    syncCacheDrop_('hv_master');
    syncCacheDrop_('handover_issuehist');    /* [Core] 이슈이력 */
    syncCacheDrop_('handover_hospdb_rich');  /* [Core] 병원정보DB(rich) */
    syncCacheDrop_('handover_hospdb');       /* thin(N-Care 산출용) */
    syncCacheDrop_('handover_bootstrap');    /* handover 부트 묶음 */
    if(hosp){
      var n = norm_(hosp);
      /* getRecent_ 는 limit 별로 키가 갈린다 — 클라이언트가 쓰는 범위만 지운다 */
      for(var i=0;i<=20;i++) bazCacheDrop_('hv_recent_' + n + '_' + i);
      bazCacheDrop_('hv_recent_' + n + '_0');
    }
  }catch(e){}
}

/** 편집기 실행용 — 재배포 직후 캐시(이슈이력·병원정보DB 등)를 즉시 비운다.
    Run 드롭다운에서 runDropCaches 선택해 실행. */
function runDropCaches(){ bazDropHandoverCaches_(); Logger.log('✅ handover 캐시 비움(이슈이력·병원정보DB 포함)'); }

/** 대시보드용 전체 데이터 — 5분 캐시.
    [수정] 예전에는 `if(s.length < 95000)` 이라, 시트가 자라 그 선을 넘는 순간 캐시가
    조용히 무력화되고 모든 요청이 시트를 통째로 다시 읽었다("데이터가 늘수록 느려짐"의
    핵심 원인). 조각 캐시로 바꿔 크기 제한을 없앤다(baz_token_lib.gs). */
function syncForce_(p){ return !!(p && /^(1|true|yes)$/i.test(String(p.force||''))); }

/* [v3.2] 조건부 동기화 메타데이터.
   대용량 조각 캐시를 매번 복원하기 전에 작은 rev 메타만 확인해 변경이 없으면 즉시 끝낸다. */
function syncRevOf_(value){
  var bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(value==null?null:value), Utilities.Charset.UTF_8);
  return bytes.slice(0,12).map(function(b){ return ('0'+((b+256)%256).toString(16)).slice(-2); }).join('');
}
function syncRevParam_(p, name){ return String((p && p[name||'rev']) || '').trim().slice(0,64); }
function syncMetaGet_(key){
  if(typeof bazCacheGet_ !== 'function') return null;
  var raw=bazCacheGet_(key+'__meta');
  if(!raw) return null;
  try{ return JSON.parse(raw); }catch(e){ return null; }
}
function syncMetaPut_(key, out, ttl){
  if(typeof bazCachePut_ !== 'function' || !out || !out.rev) return;
  var meta={rev:out.rev, updated:out.updated||'', count:Number(out.count)||0,
            rows:Number(out._rows)||0};
  try{ bazCachePut_(key+'__meta', JSON.stringify(meta), ttl); }catch(e){}
}
function syncNochange_(key, p, paramName){
  /* force는 메타 캐시만 믿지 않는다. 실제 원본을 다시 읽고 새 rev를 만든 뒤
     syncNochangeFrom_에서만 비교해야 수동 시트 수정도 놓치지 않는다. */
  if(syncForce_(p)) return null;
  var asked=syncRevParam_(p,paramName);
  if(!asked) return null;
  var meta=syncMetaGet_(key);
  if(!meta || meta.rev!==asked) return null;
  return {success:true, nochange:true, rev:meta.rev, updated:meta.updated||'',
          count:Number(meta.count)||0, _rows:Number(meta.rows)||0};
}
function syncNochangeFrom_(out, p, paramName){
  var asked=syncRevParam_(p,paramName);
  if(!asked || !out || !out.rev || asked!==out.rev) return null;
  return {success:true, nochange:true, rev:out.rev, updated:out.updated||'', count:Number(out.count)||0};
}
function syncByteLen_(s){
  try{ return Utilities.newBlob(s).getBytes().length; }
  catch(e){ return String(s==null?'':s).length; }
}
/* [성능] _bytes 는 이미 직렬화한 본문이 있으면 그 길이를 그대로 쓴다.
   여기서 매번 JSON.stringify 를 다시 돌리면 전량 응답(all·bootstrap)이 캐시 저장용 1회,
   계측용 1회, 응답 작성용 1회로 세 번 직렬화된다 — 이 PR이 줄이려는 새로고침 경로에
   그 비용이 그대로 얹힌다. 호출부가 syncBytesFrom_ 로 미리 채워 두면 재직렬화하지 않는다. */
function syncBytesFrom_(out, body){
  if(out && typeof out==='object' && typeof out._bytes!=='number') out._bytes=syncByteLen_(body);
  return out;
}
function syncObserved_(out, started, rows, cacheState){
  if(!out || typeof out!=='object') return out;
  out._ms=Math.max(0, Date.now()-started);
  out._rows=Math.max(0, Number(rows)||Number(out._rows)||0);
  out._cache=cacheState||'miss';
  if(typeof out._bytes!=='number'){
    try{ out._bytes=syncByteLen_(JSON.stringify(out)); }catch(e){ out._bytes=0; }
  }
  return out;
}
function syncCacheDrop_(key){
  if(typeof bazCacheDrop_ !== 'function') return;
  bazCacheDrop_(key); bazCacheDrop_(key+'__meta');
}

function getAll_(p){
  var started=Date.now();
  var same=syncNochange_('handover_all',p,'rev');
  if(same) return syncObserved_(same,started,same._rows,'hit');
  var hit = (!syncForce_(p) && typeof bazCacheGet_ === 'function') ? bazCacheGet_('handover_all') : null;
  if(hit){ try{ var old=JSON.parse(hit), nc=syncNochangeFrom_(old,p,'rev'); syncBytesFrom_(old,hit); return syncObserved_(nc||old,started,old._rows||old.count,'hit'); }catch(e){} }
  var all = readAllMemo_();
  var out = {success:true, count:all.rows.length,
             updated:Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm'),
             data:all.rows.map(slim_), _rows:all.rows.length};
  out.rev=syncRevOf_(out.data);
  var allBody=JSON.stringify(out); syncBytesFrom_(out,allBody);
  try{ if(typeof bazCachePut_ === 'function') bazCachePut_('handover_all', allBody, 300); }catch(e){}
  syncMetaPut_('handover_all',out,300);
  var state=syncForce_(p)?'force':'miss';
  var builtSame=syncNochangeFrom_(out,p,'rev');
  return syncObserved_(builtSame||out,started,all.rows.length,state);
}

/** 병원정보DB 탭 → 병원명·N-Care·지역 목록 (N-Care 미점검 산출용, 10분 캐시) */
function getHospDB_(p){
  var started=Date.now();
  var same=syncNochange_('handover_hospdb',p,'rev');
  if(same) return syncObserved_(same,started,same._rows,'hit');
  var _h = (!syncForce_(p) && typeof bazCacheGet_ === 'function') ? bazCacheGet_('handover_hospdb') : null;
  if(_h){ try{ var old=JSON.parse(_h), nc=syncNochangeFrom_(old,p,'rev'); syncBytesFrom_(old,_h); return syncObserved_(nc||old,started,old._rows||old.count,'hit'); }catch(e){} }
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
  var res={success:true, count:out.length, data:out, _rows:Math.max(0,v.length-hr-1),
    updated:Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm')};
  res.rev=syncRevOf_(res.data);
  /* [수정] 95KB 절벽 제거 — 조각 캐시로 크기 제한 없이 저장 */
  var hdbBody=JSON.stringify(res); syncBytesFrom_(res,hdbBody);
  try{ if(typeof bazCachePut_ === 'function') bazCachePut_('handover_hospdb', hdbBody, 600); }catch(e){}
  syncMetaPut_('handover_hospdb',res,600);
  var state=syncForce_(p)?'force':'miss';
  var builtSame=syncNochangeFrom_(res,p,'rev');
  return syncObserved_(builtSame||res,started,res._rows,state);
}

/** [Core] 병원정보DB(rich) — hospital_gas 를 대체. openById 로 rich 스프레드시트를 읽어
    hospital-pc 가 기대하는 전체 필드({name,sn,region,address,lastVisit,status,sales,asType,
    ncare,client,hpVer,uiVer,lat,lng})로 반환한다. (기존 hospital_gas 응답과 동일 형태) */
function getHospDBRich_(p, revParam){
  var started=Date.now();
  var rp=revParam||'rev', same=syncNochange_('handover_hospdb_rich',p,rp);
  if(same) return syncObserved_(same,started,same._rows,'hit');
  var _c = (!syncForce_(p) && typeof bazCacheGet_ === 'function') ? bazCacheGet_('handover_hospdb_rich') : null;
  if(_c){ try{ var old=JSON.parse(_c), nc=syncNochangeFrom_(old,p,rp); syncBytesFrom_(old,_c); return syncObserved_(nc||old,started,old._rows||old.count,'hit'); }catch(e){} }
  var ss = richHospSS_();
  if(!ss) return {success:false, error:'스프레드시트 접근 불가'};
  var sheet = ss.getSheetByName(HOSPDB_RICH.SHEET);
  if(!sheet) return {success:false, error:"'"+HOSPDB_RICH.SHEET+"' 탭 없음"};
  var lastRow = sheet.getLastRow();
  if(lastRow < 3) return {success:true, data:[]};
  var lastCol = sheet.getLastColumn();
  var width   = Math.max(1, Math.min(14, lastCol - 1));   // B열부터 최대 14개(B~O)
  var values  = sheet.getRange(3, 2, lastRow - 2, width).getValues();
  function num_(v, min, max){ var n = parseFloat(v); return (isNaN(n) || n < min || n > max) ? null : n; }
  var hospitals = values
    .filter(function(r){ return String(r[0]).trim() !== ''; })
    .map(function(r){
      return {
        name:String(r[0]).trim(), sn:String(r[1]||'').trim(), region:String(r[2]||'').trim(),
        address:String(r[3]||'').trim(), lastVisit:String(r[4]||'').trim(), status:String(r[5]||'').trim(),
        sales:String(r[6]||'').trim(), asType:String(r[7]||'').trim(), ncare:String(r[8]||'').trim(),
        client:String(r[9]||'').trim(), hpVer:String(r[10]||'').trim(), uiVer:String(r[11]||'').trim(),
        lat:num_(r[12], 33, 39), lng:num_(r[13], 124, 132)
      };
    });
  var res = {success:true, count:hospitals.length, data:hospitals, _rows:values.length,
    updated:Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm')};
  res.rev=syncRevOf_(res.data);
  var richBody=JSON.stringify(res); syncBytesFrom_(res,richBody);
  try{ if(typeof bazCachePut_ === 'function') bazCachePut_('handover_hospdb_rich', richBody, 600); }catch(e){}
  syncMetaPut_('handover_hospdb_rich',res,600);
  var state=syncForce_(p)?'force':'miss';
  var builtSame=syncNochangeFrom_(res,p,rp);
  return syncObserved_(builtSame||res,started,res._rows,state);
}

/** 날짜 표시값('2026. 8. 3' 등)을 'yyyy-MM-dd'로 정규화 — 클라이언트 parseDateYMD 호환.
    (옛 hospital_issue_gas의 _date()와 동일: 구분자 뒤 공백을 허용해 매칭·zero-pad) */
function _issueDateNorm_(v){
  if(!v) return '';
  var s = String(v).trim();
  var m = s.match(/(\d{4})[-.\/]\s*(\d{1,2})[-.\/]\s*(\d{1,2})/);
  if(m) return m[1] + '-' + ('0'+m[2]).slice(-2) + '-' + ('0'+m[3]).slice(-2);
  return '';
}

/** [Core] 병원별 이슈이력 — hospital_issue_gas 를 대체. 현장 처리 기록에서 직접 산출한다.
    필드 매핑(현장기록 → 이슈이력): 처리일→d · CS담당자→f · 점검/AS→t · 대분류→pt · 유형→sy ·
    교체품→p · 내용→fx · 유무상→pay. (기존 hospital_issue_gas 응답과 동일 형태) */
function getIssueHist_(p, revParam){
  var started=Date.now();
  var rp=revParam||'rev', same=syncNochange_('handover_issuehist',p,rp);
  if(same) return syncObserved_(same,started,same._rows,'hit');
  var _c = (!syncForce_(p) && typeof bazCacheGet_ === 'function') ? bazCacheGet_('handover_issuehist') : null;
  if(_c){ try{ var old=JSON.parse(_c), nc=syncNochangeFrom_(old,p,rp); syncBytesFrom_(old,_c); return syncObserved_(nc||old,started,old._rows||old.count,'hit'); }catch(e){} }
  var raw = histDerivedRaw_();
  var history = {};
  Object.keys(raw).forEach(function(name){ history[name] = histPublicList_(raw[name]); });
  /* [v3.0] 관리자 편집본(이슈이력편집 시트)을 얹는다 — 아래 histMerge_ 참고 */
  var edits = histReadAll_();
  var revs = {};
  var names = {};
  Object.keys(raw).forEach(function(n){ names[n]=1; });
  Object.keys(edits).forEach(function(n){ names[n]=1; });
  Object.keys(names).forEach(function(n){
    var e = edits[n] || null;
    var src = histDerivedState_(n, raw);
    if(e) history[n] = histMerge_(e, raw[n] || []);
    else if(!history[n]) history[n] = [];
    /* sourceRev 는 이 병원의 마지막 원본 행 번호다. 편집 창을 연 뒤 새 현장 기록이
       들어왔는데도 오래된 화면이 통째로 덮어쓰는 일을 막는 두 번째 revision 이다. */
    revs[n] = {
      rev:e ? e.rev : 0, sourceRev:src.maxRow,
      updatedAt:e ? e.updatedAt : '', updatedBy:e ? e.updatedBy : ''
    };
  });
  var sourceRows=(_readAllMemo&&_readAllMemo.rows)?_readAllMemo.rows.length:0;
  var res = {success:true, count:Object.keys(history).length, data:history, revs:revs, _rows:sourceRows,
    updated:Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm')};
  res.rev=syncRevOf_({data:res.data,revs:res.revs});
  var issueBody=JSON.stringify(res); syncBytesFrom_(res,issueBody);
  try{ if(typeof bazCachePut_ === 'function') bazCachePut_('handover_issuehist', issueBody, 600); }catch(e){}
  syncMetaPut_('handover_issuehist',res,600);
  var state=syncForce_(p)?'force':'miss';
  var builtSame=syncNochangeFrom_(res,p,rp);
  return syncObserved_(builtSame||res,started,sourceRows,state);
}

/** 현장 처리 원본을 병원별 이력으로 산출한다.
 *  _srcRow 는 서버 병합/충돌 판정에만 쓰고 histPublicList_ 에서 제거한다. 날짜만으로
 *  cutoff 를 잡으면 같은 날 뒤늦게 들어온 기록을 구분할 수 없어 원본 행 번호를 쓴다. */
function histDerivedRaw_(){
  var all = readAllMemo_();
  var history = {};
  all.rows.forEach(function(o){
    var name = String(o['병원명']||'').trim();
    if(!name) return;
    var s = slim_(o);
    var d = _issueDateNorm_(s.date);   /* '2026. 8. 3' → '2026-08-03' (클라 parseDateYMD 호환) */
    if(!d) return;
    var g = String(s.gubun||'');
    var t = /점검/.test(g) ? '점검' : (/AS/i.test(g) ? 'AS' : g.trim());
    var rec = { d:d, f:s.fse, t:t, pt:s.cat, sy:s.type, fx:s.detail,
                pay:(s.paid || s.cost || ''), _srcRow:Number(o._row)||0 };
    var part = String(s.part||'').trim(); if(part) rec.p = part;
    (history[name] = history[name] || []).push(rec);
  });
  Object.keys(history).forEach(function(n){
    history[n].sort(function(a,b){ return String(b.d||'').localeCompare(String(a.d||'')); });
  });
  return history;
}

/* ═══════════ [v3.0] 병원 처리 이력 편집 (hospital-pc 관리자 편집) ═══════════
 *  왜 시트인가: 편집본이 예전에는 편집한 사람의 localStorage 에만 있었다.
 *  다른 사람에게 보이지 않았고, 그 로컬 값이 서버 이력을 매번 덮어써 최신
 *  현장 기록이 그 PC 에서만 사라졌다. 서버에 두면 모두가 같은 이력을 본다.
 *
 *  이슈이력편집 : 병원명 | 이력JSON | rev | 수정자 | 수정시각 | 기준일 | 건수 | 기준행
 *  이슈이력로그 : 일시 | 병원 | op | 이전건수 | 새건수 | 이전rev | 새rev | 요청자
 *
 *  ── 병합 규칙(histMerge_) ──────────────────────────────────────────
 *  편집본은 "그 시점까지의 이력"을 통째로 대체한다. 다만 편집 이후 현장에서
 *  새로 올라온 기록(처리일 > cutoff)은 계속 이어 붙인다. 그래야 한 번 편집한
 *  병원의 이력이 그날 이후로 영영 얼어붙지 않는다.
 *  (편집자가 지운 옛 기록은 되살아나지 않는다 — cutoff 이하이기 때문)
 */
var HIST = {
  EDIT_SHEET : '이슈이력편집',
  LOG_SHEET  : '이슈이력로그',
  MAX_RECORDS: 300,        // 한 병원 이력 상한
  MAX_LEN    : 2000,       // 한 필드 길이 상한
  MAX_JSON   : 45000       // 셀 5만자 한도 안쪽으로 — 넘으면 저장 거부(잘린 채 저장되면 이력이 깨진다)
};
/* 기준행은 끝에 둔다. v3.0 초안의 7열 시트가 이미 생겼어도 기존 7열 '건수'를
   기준행으로 잘못 읽지 않고, 마지막 열만 안전하게 확장할 수 있다. */
var HIST_EDIT_HEAD = ['병원명','이력JSON','rev','수정자','수정시각','기준일','건수','기준행'];
var HIST_LOG_HEAD  = ['일시','병원','op','이전건수','새건수','이전rev','새rev','요청자'];
/* 클라이언트(js/baz-history-api.js ALLOWED_FIELDS)와 반드시 같아야 한다 */
var HIST_FIELDS = ['d','t','pt','sy','f','pay','m','fx','p'];

function histText_(v){
  if(v==null) return '';
  if(typeof v==='boolean') return '';
  return String(v).trim().slice(0, HIST.MAX_LEN);
}
function histDate_(v){
  var s = histText_(v);
  var m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return m ? (m[1]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[3]).slice(-2)) : '';
}
/** 허용 목록 밖 필드 제거 · 빈 행 제거 · 날짜 정규화 · 내림차순 · 상한 적용 */
function histSanitize_(records){
  var out = [];
  (Array.isArray(records)?records:[]).forEach(function(r){
    if(!r || typeof r!=='object') return;
    var rec = {};
    HIST_FIELDS.forEach(function(k){
      if(!Object.prototype.hasOwnProperty.call(r,k)) return;
      var v = (k==='d') ? histDate_(r[k]) : histText_(r[k]);
      if(v) rec[k] = v;
    });
    if(rec.t && rec.t!=='점검' && rec.t!=='A/S') rec.t = (rec.t.indexOf('점검')>=0) ? '점검' : 'A/S';
    if(!rec.d && !rec.sy && !rec.m && !rec.fx) return;
    out.push(rec);
  });
  out.sort(function(a,b){ return String(b.d||'').localeCompare(String(a.d||'')); });
  return out.slice(0, HIST.MAX_RECORDS);
}
function histSheet_(name, head){
  var sh = sheet_(name);
  if(!sh) sh = ss_().insertSheet(name);
  if(sh.getMaxColumns() < head.length) sh.insertColumnsAfter(sh.getMaxColumns(), head.length-sh.getMaxColumns());
  if(sh.getLastRow() < 1){
    sh.getRange(1,1,1,head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
    try{ sh.getRange(1,1,sh.getMaxRows(),head.length).setNumberFormat('@'); }catch(e){}
  }else{
    /* 내부 전용 시트의 헤더 스키마를 맞춘다. 새 열 추가 배포 때도 수동 작업 불필요. */
    var curHead = sh.getRange(1,1,1,head.length).getDisplayValues()[0];
    var changed = false;
    for(var i=0;i<head.length;i++){ if(String(curHead[i]||'')!==head[i]){ changed=true; break; } }
    if(changed) sh.getRange(1,1,1,head.length).setValues([head]).setFontWeight('bold');
  }
  return sh;
}
/** 편집 시트 전체 읽기 → { 병원명: {records, rev, updatedAt, updatedBy, cutoff, cutoffRow, row} } */
function histReadAll_(){
  var sh = sheet_(HIST.EDIT_SHEET);
  if(!sh || sh.getLastRow() < 2) return {};
  var v = sh.getRange(2, 1, sh.getLastRow()-1, HIST_EDIT_HEAD.length).getDisplayValues();
  var out = {};
  for(var i=0;i<v.length;i++){
    var name = String(v[i][0]||'').trim();
    if(!name) continue;
    var recs = [];
    try{ recs = JSON.parse(v[i][1]||'[]') || []; }catch(e){ recs = []; }
    out[name] = {
      records  : Array.isArray(recs) ? recs : [],
      rev      : Number(v[i][2]) || 0,
      updatedBy: String(v[i][3]||''),
      updatedAt: String(v[i][4]||''),
      cutoff   : String(v[i][5]||''),
      cutoffRow: Number(v[i][7]) || 0,
      row      : i+2
    };
  }
  return out;
}
/** 내부 원본 식별자를 버리고 API 허용 필드만 남긴다. */
function histPublicRecord_(r){
  var out = {};
  HIST_FIELDS.forEach(function(k){ if(r && Object.prototype.hasOwnProperty.call(r,k) && r[k]!=='' && r[k]!=null) out[k]=r[k]; });
  return out;
}
function histPublicList_(records){
  return histSanitize_((records||[]).map(histPublicRecord_));
}
/** 병원별 원본 최신 행/날짜. raw 를 넘기면 같은 요청 안에서 시트를 다시 읽지 않는다. */
function histDerivedState_(name, raw){
  var recs = (raw && raw[name]) || [];
  var maxRow = 0, maxDate = '';
  recs.forEach(function(r){
    var row=Number(r && r._srcRow)||0, d=String((r&&r.d)||'');
    if(row>maxRow) maxRow=row;
    if(d>maxDate) maxDate=d;
  });
  return {maxRow:maxRow, maxDate:maxDate};
}
/** 편집본 + (편집 이후 새로 올라온 현장 기록) */
function histMerge_(edit, derived){
  var out = (edit && Array.isArray(edit.records)) ? histPublicList_(edit.records) : [];
  var cutoffRow = Number(edit && edit.cutoffRow) || 0;
  var cutoff = (edit && edit.cutoff) || '';
  (derived||[]).forEach(function(r){
    /* 신규 데이터는 원본 행으로 정확히 판별한다. 기준행이 없는 구버전 편집본은
       날짜 cutoff 로 호환하고, 원본이 0건이었던 편집은 이후 첫 기록부터 붙인다. */
    var after = cutoffRow ? ((Number(r&&r._srcRow)||0) > cutoffRow)
                          : (cutoff ? String((r&&r.d)||'') > cutoff : true);
    if(after) out.push(histPublicRecord_(r));
  });
  return histSanitize_(out);
}

/**
 * POST {action:'history_save', hosp, records:[…], who, baseRev, baseSourceRev, token}
 *  · 레벨 2(관리자) 이상만
 *  · LockService 로 동시 수정 보호
 *  · baseRev 가 서버 rev 와 다르면 저장하지 않고 {conflict:true} + 서버 최신본 반환
 *    (조용히 덮어쓰면 다른 관리자의 편집이 흔적 없이 사라진다)
 *  · 허용 목록 밖 필드는 서버에서도 한 번 더 제거
 */
function histSave_(p){
  var lv = verifyLevel_((p && p.token) || '');
  if(lv < 2){
    return {success:false, error: MENU.AUTH_VERIFY_URL
      ? 'unauthorized — 이력 편집은 관리자(Lv.2) 인증이 필요합니다.'
      : 'AUTH_VERIFY_URL 미설정 — 이력 편집 거부'};
  }
  var hosp = histText_(p && p.hosp);
  if(!hosp) return {success:false, error:'hosp(병원명) 필요'};
  if(!Array.isArray(p.records)) return {success:false, error:'records(배열) 필요'};
  if(p.records.length > HIST.MAX_RECORDS){
    return {success:false, error:'이력이 너무 많습니다(최대 '+HIST.MAX_RECORDS+'건)'};
  }
  var records = histSanitize_(p.records);
  var payload = JSON.stringify(records);
  if(payload.length > HIST.MAX_JSON){
    return {success:false, error:'이력 용량 초과 — 오래된 기록을 정리한 뒤 다시 저장하세요'};
  }

  var lock = LockService.getScriptLock(), held = false;
  var res = null, logRow = null;
  try{
    try{ lock.waitLock(15000); held = true; }
    catch(lockErr){ return {success:false, error:'busy — 다른 이력 저장이 진행 중입니다. 잠시 후 다시 시도하세요.'}; }
    var all = histReadAll_();
    var cur = all[hosp] || null;
    var curRev = cur ? cur.rev : 0;
    var baseRev = Number(p.baseRev) || 0;
    var derivedAll = histDerivedRaw_();
    var derived = derivedAll[hosp] || [];
    var src = histDerivedState_(hosp, derivedAll);
    var baseSourceRev = Number(p.baseSourceRev) || 0;
    if(baseRev !== curRev || baseSourceRev !== src.maxRow){
      /* 충돌 — 저장하지 않고 서버 최신본을 그대로 돌려준다. 재조회 안내는 클라이언트 몫 */
      return {
        success:false, conflict:true,
        error:(baseRev !== curRev)
          ? 'conflict — 다른 사용자가 먼저 저장했습니다'
          : 'conflict — 편집 중 새 현장 기록이 추가되었습니다',
        hosp:hosp, rev:curRev, sourceRev:src.maxRow,
        records: cur ? histMerge_(cur, derived) : histPublicList_(derived),
        updatedAt: cur ? cur.updatedAt : '', updatedBy: cur ? cur.updatedBy : ''
      };
    }
    var sh = histSheet_(HIST.EDIT_SHEET, HIST_EDIT_HEAD);
    var newRev = curRev + 1;
    var whoName = histText_(p.who) || ('lv'+lv);
    var nowS = Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm:ss');
    /* 이번 저장 화면에 포함된 원본 범위까지 편집본이 흡수한다. 예전 cutoff 를 계속
       유지하면 한번 이어 붙은 새 원본을 다음 저장 때 편집본과 원본에서 이중으로 붙였다. */
    var cutoff = src.maxDate, cutoffRow = src.maxRow;
    var row = [hosp, payload, newRev, whoName, nowS, cutoff, records.length, cutoffRow];
    if(cur) sh.getRange(cur.row, 1, 1, HIST_EDIT_HEAD.length).setValues([row]);
    else    sh.getRange(sh.getLastRow()+1, 1, 1, HIST_EDIT_HEAD.length).setValues([row]);

    logRow = [nowS, hosp, 'history_save',
              cur ? cur.records.length : '', records.length, curRev, newRev, whoName];
    res = {success:true, hosp:hosp, rev:newRev, sourceRev:src.maxRow, records:records,
           updatedAt:nowS, updatedBy:whoName, count:records.length};
  }catch(err){
    return {success:false, error:String(err)};
  }finally{
    if(held){ try{ lock.releaseLock(); }catch(_){} }
  }
  /* 락 밖에서: 감사 로그 + 이슈이력 캐시 무효화(다음 조회부터 편집본이 보이게) */
  try{ if(logRow) histSheet_(HIST.LOG_SHEET, HIST_LOG_HEAD).appendRow(logRow); }catch(e){}
  try{ syncCacheDrop_('handover_issuehist'); }catch(e){}
  return res;
}

/** [Core] hospital-pc 부트 1콜 — rich 병원정보DB + 이슈이력을 한 응답에 합친다.
    각각 조각캐시라 대개 캐시 히트. 클라이언트는 d.hospdb.data / d.issuehist.data 로 사용. */
function getBootstrap_(p){
  var started=Date.now();
  var hospdb=getHospDBRich_(p,'hrev');
  var issuehist=getIssueHist_(p,'irev');
  var allReady=false, allRev='';
  /* 수동 새로고침은 issuehist가 읽은 같은 원본 스냅샷으로 all 캐시도 갱신한다.
     이어지는 hospital-pc 최근처리 조회는 이 캐시를 사용하므로 시트를 두 번 읽지 않는다. */
  /* all 캐시 갱신은 부가 작업이다 — 여기서 실패해도 이미 만들어 둔 hospdb·issuehist 응답까지
     버리면 안 된다. 실패하면 allready:false 로 알리고, 클라이언트가 all 을 force 로 다시 받는다. */
  if(syncForce_(p) && /^(1|true|yes)$/i.test(String(p.refreshall||''))){
    try{
      var all=getAll_({force:'1', rev:syncRevParam_(p,'arev')});
      allReady=!!(all && all.success);
      allRev=(all && all.rev)||'';
    }catch(allErr){
      Logger.log('[bootstrap] all 캐시 갱신 실패(무시): '+allErr);
    }
  }
  var out={success:true, ver:'3.4.1', hospdb:hospdb, issuehist:issuehist,
           allready:allReady, allrev:allRev};
  /* 하위 응답을 다시 직렬화하지 않는다 — bootstrap 은 이 시스템에서 가장 큰 응답이라
     계측 때문에 전량을 한 번 더 문자열로 만들면 새로고침 경로가 그만큼 느려진다. */
  out._bytes=(Number(hospdb&&hospdb._bytes)||0)+(Number(issuehist&&issuehist._bytes)||0);
  var state=syncForce_(p)?'force':
    ((hospdb&&hospdb._cache==='hit'&&issuehist&&issuehist._cache==='hit')?'hit':'miss');
  return syncObserved_(out,started,issuehist&&issuehist._rows,state);
}

/** 특정 병원 최근 이력 */
function getRecent_(hosp, limit){
  if(!hosp) return {success:false, error:'hosp 파라미터 필요'};
  /* [성능] readAll_ 는 시트 전 행 스캔이다. 예전에는 이 경로에 캐시가 하나도 없어
     호출마다 전체를 다시 읽었다(데이터가 늘수록 선형으로 느려짐). */
  var _k = 'hv_recent_' + norm_(hosp) + '_' + (Number(limit)||0);
  var _c = (typeof bazCacheGet_ === 'function') ? bazCacheGet_(_k) : null;
  if(_c){ try{ return JSON.parse(_c); }catch(e){} }
  var all = readAllMemo_();
  var q = norm_(hosp);
  var hit = all.rows.filter(function(o){ return norm_(o['병원명'])===q || norm_(o['병원명']).indexOf(q)>=0; });
  hit = hit.slice(-Math.min(limit, CONFIG.RECENT_MAX)).reverse().map(slim_);
  var _r = {success:true, hosp:hosp, count:hit.length, data:hit};
  try{ if(typeof bazCachePut_ === 'function') bazCachePut_(_k, JSON.stringify(_r), 120); }catch(e){}
  return _r;
}

/** 오늘 기록 */
/**
 * 오늘 기록 조회.
 * [v3.1] fse 가 비었을 때 팀 전체를 돌려주지 않는다 — '오늘 내 기록'인데 남의 기록까지
 * 보이던 문제. 토큰의 로그인 사용자 이름으로 대체하고, 그것도 없으면 거부한다.
 */
function getToday_(fse, token){
  var who = String(fse||'').trim();
  var scope = 'param';
  if(!who){ who = authName_(token); scope = who ? 'account' : ''; }
  if(!who){
    return {success:false, error:'담당 FSE 를 입력하거나 다시 로그인해 주세요 (전체 기록 조회는 제공하지 않습니다)'};
  }
  fse = who;
  var today = Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd');
  /* [성능] 위와 같은 이유로 캐시. 오늘 기록은 자주 바뀌므로 짧게(60초)만 잡는다. */
  var _k = 'hv_today_' + today + '_' + norm_(fse||'');
  var _c = (typeof bazCacheGet_ === 'function') ? bazCacheGet_(_k) : null;
  if(_c){ try{ return JSON.parse(_c); }catch(e){} }
  var all = readAllMemo_();
  var hit = all.rows.filter(function(o){
    var d = String(o['처리일']||'').replace(/\./g,'-').replace(/\s/g,'');
    var okDate = d.indexOf(today)===0;
    var okFse = !fse || norm_(o['CS 담당자'])===norm_(fse);
    return okDate && okFse;
  }).map(slim_);
  var _r = {success:true, date:today, fse:who, scope:scope, count:hit.length, data:hit};
  try{ if(typeof bazCachePut_ === 'function') bazCachePut_(_k, JSON.stringify(_r), 60); }catch(e){}
  return _r;
}

/**
 * [v3.1] GET ?action=savecheck&reqId=…&token=…
 * 저장 요청의 응답을 못 받았을 때(타임아웃·네트워크 끊김) "실제로 기록됐는지"를 판정한다.
 *   found:true  → 서버가 그 요청을 처리했다. result 에 최초 결과가 그대로 들어 있다.
 *   found:false → 서버에 그 요청 기록이 없다(도달하지 못했거나 아직 처리 중).
 * 이 API 가 있어야 프런트가 "확인 중 → 성공/실패"로 갈 수 있고,
 * opaque 응답을 성공으로 우기지 않아도 된다.
 */
function saveCheck_(p){
  var reqId = String((p && p.reqId) || '').replace(/[^A-Za-z0-9_-]/g,'').slice(0,64);
  if(!reqId) return {success:false, error:'reqId 필요'};
  var rec = reqGet_(reqId);
  if(!rec) return {success:true, found:false, reqId:reqId};
  return {success:true, found:true, reqId:reqId, savedAt:rec.ts||0, result:rec.result||null};
}

/**
 * [v3.1] handover 부트 1콜 — 화면이 뜰 때 각각 날리던 GET 3~4개를 한 번에 묶는다.
 * 응답이 커지지 않도록 병원DB는 목록 조회용 최소 필드(hospdb)만 담는다.
 * (전체 필드가 필요하면 기존 ?action=hospdbrich 를 따로 부른다 — 2단 구조)
 */
function getHandoverBootstrap_(p){
  var same=syncNochange_('handover_bootstrap',p,'rev');
  if(same) return same;
  var hit=(!syncForce_(p) && typeof bazCacheGet_==='function') ? bazCacheGet_('handover_bootstrap') : null;
  if(hit){ try{ var old=JSON.parse(hit), nc=syncNochangeFrom_(old,p,'rev'); return nc||old; }catch(e){} }
  var out = {success:true, ver:'3.4.1',
             updated: Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm')};
  function part(name, fn){
    try{ out[name] = fn(); }
    catch(e){ out[name] = {success:false, error:String(e)}; }
  }
  part('hospdb',     function(){ return getHospDBRich_(p); });
  part('master',     function(){ return getMaster_(p); });
  part('contenttpl', function(){ return contentTplGet_(); });
  part('weeklyauto', function(){ return weeklyAutoGet_(); });
  out.rev=syncRevOf_({hospdb:out.hospdb,master:out.master,contenttpl:out.contenttpl,weeklyauto:out.weeklyauto});
  try{ if(typeof bazCachePut_==='function') bazCachePut_('handover_bootstrap',JSON.stringify(out),120); }catch(e){}
  syncMetaPut_('handover_bootstrap',out,120);
  var builtSame=syncNochangeFrom_(out,p,'rev'); if(builtSame) return builtSame;
  return out;
}

/** 유형 마스터: 유형마스터 시트가 있으면 우선, 없으면 데이터에서 추출 */
function getMaster_(p){
  /* [성능] 유형마스터는 거의 안 바뀌는데 readAll_ 전체 스캔까지 하고 있었다 → 10분 캐시 */
  var _c = (!syncForce_(p) && typeof bazCacheGet_ === 'function') ? bazCacheGet_('hv_master') : null;
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
  var all = readAllMemo_();
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
  var all = readAllMemo_();
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
/* [v3.1][보안] 인증 서버 장애 시 정책 — "가용성 폴백"과 "무효 토큰 허용"을 분리한다.
   예전 값(1)은 서버가 잠깐 죽으면 "비어 있지 않은 아무 문자열"이 Lv.1 로 통과했다.
   handover 는 Lv.1 로 쓰기가 열리므로, 인증 서버 장애 = 시트 쓰기 개방이었다.
   지금 발급되는 토큰은 전부 서명 토큰이라 bazVerifyLocal_ 로 네트워크 없이 검증된다.
   따라서 장애 시에도 정상 사용자는 아무 영향이 없고, 검증에 실패한 토큰만 막힌다.
     · 서명 검증 성공        → 그 레벨 (오프라인 허용 · 서버 왕복 0회)
     · 서명 검증 실패        → 0 (서버 장애를 이유로 허용하지 않는다)
     · 서명 토큰이 아님(레거시) + 서버 도달 불가
                             → 예전에 서버가 유효하다고 답한 적 있는 토큰만 그 레벨로 유예
                               (AUTH_GOOD_TTL). 처음 보는 토큰은 0.
   ※ 검증 자체를 끄려면 AUTH_ENFORCE=false 를 쓴다(그쪽이 의도가 분명하다). */
var AUTH_FAILOPEN_LEVEL = 0;          /* 검증 불가 토큰에 부여할 레벨 (0 = 차단) */
var AUTH_GOOD_TTL = 6 * 3600;         /* '예전에 유효했던 레거시 토큰' 유예 시간(초) */
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
  if(loc && loc.ok) return Number(loc.level)||0;
  /* [v3.1] 서명이 실제로 검증됐고 그 결과가 "무효"라면 여기서 끝낸다.
     예전에는 이 경우에도 인증 서버 왕복으로 넘어갔고, 서버가 죽어 있으면
     failopen(1)으로 통과했다 — 위조·만료·폐기 토큰이 서버 장애를 틈타 쓰기 권한을 얻는 길.
     (hmac_error 는 우리 쪽 계산 실패라 '검증 불가'로 보고 아래 경로로 넘긴다) */
  if(loc && loc.ok === false && loc.why !== 'hmac_error') return 0;

  /* ── 2순위(레거시 불투명 토큰): 예전 방식의 인증 서버 왕복 ─────────────────
     여기 오는 토큰은 "서명 토큰 형식이 아니거나(=레거시) 서명 비밀이 아직 없는" 경우뿐이다.
     모든 사용자가 서명 토큰으로 재로그인하면 이 경로는 자연히 사라진다. 전환기 안전망. */
  if(!MENU.AUTH_VERIFY_URL) return AUTH_FAILOPEN_LEVEL;      /* 인증 서버 미설정 */

  var thash = Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token)));
  var key = 'lv_' + thash;
  var goodKey = 'lvok_' + thash;      /* '예전에 유효했다'는 기록 — 장애 시 유예 판단용 */
  var cache = null;
  try{
    cache = CacheService.getScriptCache();
    var hit = cache.get(key);
    if(hit) return Number(hit)||0;
    /* 직전에 인증 서버가 죽어 있었다 → 왕복하지 않는다.
       [v3.1] 단, 무조건 통과시키지 않는다. 예전에 유효하다고 확인된 토큰만 유예한다. */
    if(cache.get(AUTH_DOWN_KEY)){
      var g0 = cache.get(goodKey);
      return g0 ? (Number(g0)||0) : AUTH_FAILOPEN_LEVEL;
    }
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
    /* 못 닿음을 짧게 기억 → 뒤따르는 요청들은 왕복 없이 즉시 판정 */
    try{ if(cache) cache.put(AUTH_DOWN_KEY, '1', AUTH_DOWN_TTL); }catch(_){}
    /* [v3.1] 가용성 폴백은 "이미 유효함이 확인된 토큰"에만 준다.
       처음 보는 임의 문자열은 서버 장애를 이유로 통과시키지 않는다. */
    var g = null; try{ g = cache ? cache.get(goodKey) : null; }catch(_){}
    return g ? (Number(g)||0) : AUTH_FAILOPEN_LEVEL;
  }
  try{
    if(cache){
      cache.remove(AUTH_DOWN_KEY);            /* 살아났으니 차단기 해제 */
      /* ★ 무효 토큰(lv===0)도 캐시한다. 옛 조건 `lv > 0`이 죽은 토큰을 캐시에서 빼
         매 요청 왕복을 유발했다 — 이번 접속 장애의 직접 원인. */
      cache.put(key, String(lv), lv > 0 ? 300 : 60);
      /* 유효했던 사실을 길게 기억(장애 시 유예) · 무효면 그 기록을 지운다 */
      if(lv > 0) cache.put(goodKey, String(lv), AUTH_GOOD_TTL);
      else cache.remove(goodKey);
    }
  }catch(_){}
  return lv;
}

/** [v3.1] 토큰에 담긴 로그인 사용자 이름 (감사 필드·오늘 기록 조회 기준).
 *  서명 토큰에서만 얻을 수 있고, 실패하면 '' — 이름을 신뢰 근거로 쓰지 않는다. */
function authName_(token){
  if(!token) return '';
  try{
    var loc = (typeof bazVerifyLocal_ === 'function') ? bazVerifyLocal_(token) : null;
    if(loc && loc.ok) return String(loc.name||'').trim();
  }catch(e){}
  return '';
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
  var rows = readAllMemo_().rows.map(slim_).filter(function(r){
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
function progBytes_(o){
  try{ return Utilities.newBlob(JSON.stringify(o)).getBytes().length; }
  catch(e){ return JSON.stringify(o).length; }
}
/** cs_progress의 유일한 영속화 경로 — 내부 필드 제거와 크기 가드를 저장 직전에 강제한다. */
function progWrite_(o){
  progStrip_(o);
  var s=JSON.stringify(o), n=progBytes_(o);
  if(n>8000) Logger.log('[progress] 크기 경고 '+n+'B / 담당자 '+Object.keys(o.queues||{}).length+'명');
  if(n>9000) throw new Error('progress-too-large:'+n);
  PropertiesService.getScriptProperties().setProperty('cs_progress',s);
  return n;
}
function progGet_(p){
  var o = progRead_();
  var snap=null, bytes=0, rolloverError='';
  if(o._reset){
    var lock=LockService.getScriptLock(), held=false;
    try{ lock.waitLock(10000); held=true; }
    catch(lockErr){
      Logger.log('[progress] rollover lock 실패: '+lockErr);
      return {success:false, busy:true, error:'busy — 다른 일정 저장 또는 자정 초기화가 진행 중입니다.'};
    }
    try{
      o=progRead_();                         /* 락 안에서 날짜 상태를 다시 확인한다 */
      if(o._reset){
        snap=progStrip_(o);
        deriveProg_(o);
        o.rev=(o.rev||0)+1;
        o.updated=schedNow_();
        try{ bytes=progWrite_(o); }
        catch(writeErr){
          Logger.log('[progress] rollover 저장 실패: '+writeErr);
          return {success:false, _rolloverError:'write-failed', error:String(writeErr)};
        }
      }else{
        progStrip_(o); deriveProg_(o); bytes=progBytes_(o);
      }
    }finally{
      if(held){ try{ lock.releaseLock(); }catch(_){} }
    }
  }else{
    progStrip_(o); deriveProg_(o); bytes=progBytes_(o);
  }
  var rev = o.rev||0;
  /* 일일 초기화 부산물(스냅샷 보존·로그 정리)은 상태 저장 뒤에 — 시트 I/O 실패가 초기화를 되돌리지 않게 */
  if(snap){
    try{ schedSnapshotWrite_(snap.day, snap.queues); }
    catch(e){ rolloverError='snapshot-failed'; Logger.log('[progress] rollover snapshot 실패: '+e); }
    try{ schedLog_([[schedNow_(), '', '', 'day_reset', snap.day||'', '', 'system']]); }
    catch(e){ rolloverError=rolloverError||'log-failed'; Logger.log('[progress] rollover log 실패: '+e); }
    try{ schedLogPrune_(); }
    catch(e){ rolloverError=rolloverError||'prune-failed'; Logger.log('[progress] rollover prune 실패: '+e); }
  }
  /* [v2.7] 변경 없으면 큐 전체 대신 rev 만 반환 — 25초 폴링의 응답·파싱 비용 제거 */
  if(p && String(p.rev||'')!=='' && Number(p.rev)===rev){
    var same={success:true, nochange:true, rev:rev, _bytes:bytes};
    if(rolloverError) same._rolloverError=rolloverError;
    return same;
  }
  var out={success:true, queues:o.queues, prog:o.prog, done:o.done, rev:rev,
           updated:o.updated||'', _bytes:bytes};
  if(rolloverError) out._rolloverError=rolloverError;
  return out;
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
  /* doPost는 progress_save를 전역 락 앞에서 라우팅한다. 따라서 이 함수가 락을
     얻지 못하면 공유 상태를 읽거나 쓰지 않고 busy로 중단해야 한다. */
  var lock = LockService.getScriptLock(), held = false;
  var res = null, logs = [], snap = null;
  try{ lock.waitLock(15000); held=true; }
  catch(lockErr){ return {success:false, busy:true, error:'busy — 다른 일정 저장이 진행 중입니다. 잠시 후 다시 시도하세요.'}; }
  try{
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
    var bytes=progWrite_(o);
    res = {success:true, queues:o.queues, prog:o.prog, done:o.done, rev:o.rev,
           updated:o.updated, _bytes:bytes};
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
  try{ lock.waitLock(15000); held=true; }
  catch(lockErr){ return {success:false, busy:true, error:'busy — 다른 일정 복구가 진행 중입니다. 잠시 후 다시 시도하세요.'}; }
  try{
    var o = progRead_(); progStrip_(o);
    var before = o.queues;
    o.queues = queues; o.done = {};
    deriveProg_(o);
    o.rev = (o.rev||0)+1;
    o.updated = schedNow_();
    var bytes=progWrite_(o);
    res = {success:true, restored:day, queues:o.queues, prog:o.prog, done:o.done,
           rev:o.rev, updated:o.updated, _bytes:bytes};
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
