// ── 기존 onOpen 교체 (메뉴 항목 추가) ──────────────────────────
// 기존 파일의 onOpen 을 아래로 교체하세요.
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📁 대시보드 조회')
    .addItem('선택 항목 조회', 'filterHospitalDB')
    .addSeparator()
    .addItem('빈 위·경도 자동 채우기', 'fillMissingHospitalCoordinates')
    .addItem('주소 변경 자동 갱신 설정 (1회)', 'installHospitalAddressEditTrigger')
    .addToUi();
}
const LAYOUT = {
  HOSP_VALUE_ROW:   4,  HOSP_LABEL_ROW:   3,
  NCARE_VALUE_ROW:  9,  NCARE_LABEL_ROW:  8,
  NORMAL_OP_ROW:    11,
  INSPECT_TGT_ROW:  12,
  NCARE_OP_ROW:     14,
  REGION_START:     26, REGION_END: 35, REGION_LABEL_ROW: 25,
  TOTAL_HOSP_ROW:   4,   // 전체 병원 (B4)
  TOTAL_NCARE_ROW:  9    // 전체 가입자 (B9)
};

/* 병원정보DB 지오코딩
   - E열 주소가 있고 N·O 중 하나라도 빈 행만 채운다.
   - 기존 좌표가 완성된 행은 다시 조회하거나 덮어쓰지 않는다.
   - 설치형 수정 트리거를 1회 설정하면 E열 주소 변경 행만 새 좌표로 갱신한다. */
const HOSPITAL_GEO = {
  SHEET: '병원정보DB',
  START_ROW: 3,
  ADDRESS_COL: 5,     // E
  LAT_COL: 14,        // N
  LNG_COL: 15,        // O
  BATCH_SIZE: 40,
  EDIT_IMMEDIATE_MAX: 20,
  NEXT_ROW_KEY: 'hospital_geo_next_row',
  WORKER: 'continueHospitalGeocode_'
};

function hospitalGeoText_(v){
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}
function hospitalGeoNeedsFill_(address, lat, lng){
  return !!hospitalGeoText_(address) &&
    (hospitalGeoText_(lat) === '' || hospitalGeoText_(lng) === '');
}

/* 메뉴 실행: 현재 좌표가 비어 있는 주소만 처리한다.
   데이터가 많으면 40건씩 나누고 다음 묶음은 1분 뒤 자동으로 계속한다. */
function fillMissingHospitalCoordinates(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(HOSPITAL_GEO.SHEET);
  if(!sh){
    SpreadsheetApp.getUi().alert('안내: 병원정보DB 시트를 찾을 수 없습니다.');
    return;
  }
  PropertiesService.getDocumentProperties().setProperty(
    HOSPITAL_GEO.NEXT_ROW_KEY, String(HOSPITAL_GEO.START_ROW));
  var result = processHospitalGeocodeBatch_();
  ss.toast(hospitalGeoResultText_(result), '위·경도 입력', 5);
}

function hospitalGeoResultText_(r){
  if(!r) return '처리 결과를 확인할 수 없습니다.';
  var s = '성공 '+r.success+'건';
  if(r.failed) s += ' · 주소 확인 필요 '+r.failed+'건';
  if(r.scheduled) s += ' · 남은 행은 자동으로 계속 처리합니다.';
  else s += ' · 처리 완료';
  return s;
}

/* 위·경도 두 값이 모두 있는 행은 그대로 보존한다. */
function processHospitalGeocodeBatch_(){
  var lock = LockService.getDocumentLock();
  if(!lock.tryLock(5000)){
    scheduleHospitalGeocodeContinuation_();
    return {success:0, failed:0, scheduled:true};
  }
  try{
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(HOSPITAL_GEO.SHEET);
    if(!sh) return {success:0, failed:0, scheduled:false};

    var props = PropertiesService.getDocumentProperties();
    var start = Math.max(HOSPITAL_GEO.START_ROW,
      Number(props.getProperty(HOSPITAL_GEO.NEXT_ROW_KEY)) || HOSPITAL_GEO.START_ROW);
    var last = sh.getLastRow();
    if(last < start){
      props.deleteProperty(HOSPITAL_GEO.NEXT_ROW_KEY);
      return {success:0, failed:0, scheduled:false};
    }

    var count = last - start + 1;
    var addresses = sh.getRange(start, HOSPITAL_GEO.ADDRESS_COL, count, 1).getDisplayValues();
    var coordRange = sh.getRange(start, HOSPITAL_GEO.LAT_COL, count, 2);
    var coords = coordRange.getValues();
    var formulas = coordRange.getFormulas();
    var success = 0, failed = 0, requests = 0, stopIndex = count - 1;
    var memo = {};

    for(var i=0; i<count; i++){
      if(!hospitalGeoNeedsFill_(addresses[i][0], coords[i][0], coords[i][1])) continue;
      if(requests >= HOSPITAL_GEO.BATCH_SIZE){ stopIndex = i - 1; break; }
      requests++;
      var point = geocodeHospitalAddress_(addresses[i][0], memo);
      if(point){
        coords[i][0] = point.lat;
        coords[i][1] = point.lng;
        formulas[i][0] = formulas[i][1] = '';
        success++;
      }else{
        failed++;
      }
    }

    if(stopIndex >= 0){
      var output = [];
      for(var j=0; j<=stopIndex; j++){
        output.push([
          formulas[j][0] || coords[j][0],
          formulas[j][1] || coords[j][1]
        ]);
      }
      sh.getRange(start, HOSPITAL_GEO.LAT_COL, output.length, 2).setValues(output);
      if(success) dropHospitalGeoResponseCache_();
    }

    var next = start + stopIndex + 1;
    var scheduled = next <= last;
    if(scheduled){
      props.setProperty(HOSPITAL_GEO.NEXT_ROW_KEY, String(next));
      scheduleHospitalGeocodeContinuation_();
    }else{
      props.deleteProperty(HOSPITAL_GEO.NEXT_ROW_KEY);
    }
    return {success:success, failed:failed, scheduled:scheduled};
  } finally {
    lock.releaseLock();
  }
}

function geocodeHospitalAddress_(address, memo){
  var normalized = hospitalGeoText_(address);
  if(!normalized) return null;
  memo = memo || {};
  if(Object.prototype.hasOwnProperty.call(memo, normalized)) return memo[normalized];
  try{
    var response = Maps.newGeocoder()
      .setLanguage('ko')
      .setRegion('kr')
      .geocode(normalized);
    var result = response && response.results && response.results[0];
    var loc = result && result.geometry && result.geometry.location;
    var lat = loc && Number(loc.lat), lng = loc && Number(loc.lng);
    memo[normalized] = (isFinite(lat) && isFinite(lng)) ? {lat:lat, lng:lng} : null;
  }catch(err){
    console.warn('[geocode] '+normalized+' 변환 실패: '+err);
    memo[normalized] = null;
  }
  Utilities.sleep(100);
  return memo[normalized];
}

/* 1회성 시간 트리거: 대량 입력을 다음 실행으로 안전하게 넘긴다. */
function scheduleHospitalGeocodeContinuation_(){
  var exists = ScriptApp.getProjectTriggers().some(function(t){
    return t.getHandlerFunction() === HOSPITAL_GEO.WORKER;
  });
  if(!exists){
    ScriptApp.newTrigger(HOSPITAL_GEO.WORKER).timeBased().after(60 * 1000).create();
  }
}
function continueHospitalGeocode_(){
  /* 실행 중인 1회성 트리거를 먼저 제거해야 남은 데이터용 다음 트리거를 만들 수 있다. */
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction() === HOSPITAL_GEO.WORKER) ScriptApp.deleteTrigger(t);
  });
  processHospitalGeocodeBatch_();
}

/* 메뉴에서 한 번 실행·승인하면 이후 E열 주소 수정에 반응한다. */
function installHospitalAddressEditTrigger(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var handler = 'handleHospitalAddressEdit_';
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction() === handler) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger(handler).forSpreadsheet(ss).onEdit().create();
  ss.toast('주소 변경 자동 갱신이 설정되었습니다.', '설정 완료', 5);
}

/* hospital_gas.gs가 사용하는 병원정보DB 응답 캐시가 같은 프로젝트에 있으면 즉시 비운다.
   함수가 없는 구형 구성에서도 지오코딩 자체는 정상 동작한다. */
function dropHospitalGeoResponseCache_(){
  try{
    if(typeof bazCacheDrop_ === 'function') bazCacheDrop_('hospdb_all');
  }catch(err){
    console.warn('[geocode] 병원 DB 캐시 삭제 실패: '+err);
  }
}

/* E열과 겹치는 실제 사용자 수정만 처리한다. 주소 삭제 시 좌표도 삭제한다. */
function handleHospitalAddressEdit_(e){
  if(!e || !e.range) return;
  var sh = e.range.getSheet();
  if(sh.getName() !== HOSPITAL_GEO.SHEET) return;
  var firstCol = e.range.getColumn();
  var lastCol = firstCol + e.range.getNumColumns() - 1;
  if(HOSPITAL_GEO.ADDRESS_COL < firstCol || HOSPITAL_GEO.ADDRESS_COL > lastCol) return;

  var firstRow = Math.max(HOSPITAL_GEO.START_ROW, e.range.getRow());
  var lastRow = e.range.getLastRow();
  if(lastRow < firstRow) return;

  var rows = lastRow - firstRow + 1;
  /* 잠금 대기 중이어도 바뀐 주소에 예전 좌표가 남아 노출되지 않게 먼저 비운다. */
  sh.getRange(firstRow, HOSPITAL_GEO.LAT_COL, rows, 2).clearContent();
  dropHospitalGeoResponseCache_();

  var lock = LockService.getDocumentLock();
  if(!lock.tryLock(5000)){
    scheduleHospitalGeocodeFromRow_(firstRow);
    return;
  }
  try{
    var immediate = Math.min(rows, HOSPITAL_GEO.EDIT_IMMEDIATE_MAX);
    var addresses = sh.getRange(firstRow, HOSPITAL_GEO.ADDRESS_COL, immediate, 1).getDisplayValues();
    var out = [], memo = {};
    for(var i=0; i<immediate; i++){
      var point = geocodeHospitalAddress_(addresses[i][0], memo);
      out.push(point ? [point.lat, point.lng] : ['', '']);
    }
    if(out.length) sh.getRange(firstRow, HOSPITAL_GEO.LAT_COL, out.length, 2).setValues(out);
    if(out.some(function(v){ return v[0] !== '' && v[1] !== ''; })) dropHospitalGeoResponseCache_();
    if(rows > immediate) scheduleHospitalGeocodeFromRow_(firstRow + immediate);
  } finally {
    lock.releaseLock();
  }
}

function scheduleHospitalGeocodeFromRow_(row){
  var props = PropertiesService.getDocumentProperties();
  var old = Number(props.getProperty(HOSPITAL_GEO.NEXT_ROW_KEY)) || row;
  props.setProperty(HOSPITAL_GEO.NEXT_ROW_KEY, String(Math.min(old, row)));
  scheduleHospitalGeocodeContinuation_();
}

function filterHospitalDB() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const dashSheet = ss.getSheetByName("대시보드");
  const dbSheet   = ss.getSheetByName("병원정보DB");
  const resSheet  = ss.getSheetByName("대시보드 조회 현황판");

  if (!dashSheet || !dbSheet || !resSheet) {
    ui.alert("안내: 시트 이름(대시보드 / 병원정보DB / 대시보드 조회 현황판)을 확인하세요.");
    return;
  }

  const DB = { REGION: 3, STATUS: 6, NCARE: 9 };
  const NUM_COLS = 19;

  const cell = dashSheet.getActiveCell();
  const row = cell.getRow();
  const col = cell.getColumn();
  const val = cell.getValue();

  if (row < 2 || col < 2 || val === "") {
    ui.alert("안내: 통계 표 내부의 숫자 셀을 먼저 선택한 뒤 실행하세요.");
    return;
  }

  let criterion = "";
  let subCriterion = "";
  let targetCol = 0;
  let region = null;
  let isNcareOnly = false;
  let isNotNormalOnly = false;
  let isUnsubscribed = false;
  let isAllHosp = false;        // [추가] 전체 병원 조회
  let isAllNcare = false;       // [추가] 전체 가입자 조회

  if (row === LAYOUT.TOTAL_HOSP_ROW && col === 2) {        // [추가] B4 전체 병원
    isAllHosp = true;

  } else if (row === LAYOUT.TOTAL_NCARE_ROW && col === 2) { // [추가] B9 전체 가입자
    isAllNcare = true;

  } else if (row === LAYOUT.HOSP_VALUE_ROW && col >= 3 && col <= 7) {
    criterion = dashSheet.getRange(LAYOUT.HOSP_LABEL_ROW, col).getValue();
    targetCol = 7;

  } else if (row === LAYOUT.NCARE_VALUE_ROW && col >= 3 && col <= 7) {
    criterion = dashSheet.getRange(LAYOUT.NCARE_LABEL_ROW, col).getValue();
    targetCol = 10;

  } else if (row === LAYOUT.NORMAL_OP_ROW && col >= 3 && col <= 7) {
    criterion = "정상";
    subCriterion = dashSheet.getRange(LAYOUT.NCARE_LABEL_ROW, col).getValue();
    isNcareOnly = true;
    if (col === 7) isUnsubscribed = true;

  } else if (row === LAYOUT.INSPECT_TGT_ROW && col >= 3 && col <= 7) {
    subCriterion = dashSheet.getRange(LAYOUT.NCARE_LABEL_ROW, col).getValue();
    isNcareOnly = true;
    isNotNormalOnly = true;
    if (col === 7) isUnsubscribed = true;

  } else if (row === LAYOUT.NCARE_OP_ROW && col === 3) {
    criterion = "정상";
    isNcareOnly = true;

  } else if (row >= LAYOUT.REGION_START && row <= LAYOUT.REGION_END && col >= 3 && col <= 7) {
    region = dashSheet.getRange(row, 2).getValue();
    criterion = dashSheet.getRange(LAYOUT.REGION_LABEL_ROW, col).getValue();
    targetCol = 7;

  } else {
    ui.alert("안내: 통계 표 내부의 숫자를 선택하세요.");
    return;
  }

  const lastRow = dbSheet.getLastRow();
  if (lastRow < 3) {
    ui.alert("안내: 병원정보DB에 데이터가 없습니다.");
    return;
  }
  const allData = dbSheet.getRange(3, 1, lastRow - 2, NUM_COLS).getValues();

  const strSub = String(subCriterion).trim();
  const strRegion = region ? String(region).trim() : null;

  const filtered = allData.filter(function (r) {
    const dbStatus = String(r[DB.STATUS]).trim();
    const dbNcare  = String(r[DB.NCARE]).trim();

    // [추가] 전체 병원 → 빈 행 제외하고 전부
    if (isAllHosp) {
      return String(r[1]).trim() !== "";   // B열(병원명) 있으면 포함
    }

    // [추가] 전체 가입자 → 미가입 제외 전부
    if (isAllNcare) {
      return (dbNcare !== "미가입" && dbNcare !== "");
    }

    if (isNcareOnly) {
      const isJoined = (dbNcare !== "미가입" && dbNcare !== "");

      if (isUnsubscribed) {
        const isUnsub = (dbNcare === "미가입");
        if (isNotNormalOnly) {
          return (dbStatus !== "정상" && dbStatus !== "") && isUnsub;
        }
        return (dbStatus === "정상") && isUnsub;
      }

      const matchSub = strSub ? (dbNcare === strSub) : true;

      if (isNotNormalOnly) {
        return (dbStatus !== "정상" && dbStatus !== "") && isJoined && matchSub;
      }
      return (dbStatus === "정상") && isJoined && matchSub;
    }

    const matchStatus = (String(r[targetCol - 1]).trim() === String(criterion).trim());
    const matchRegion = strRegion ? (String(r[DB.REGION]).trim() === strRegion) : true;
    return matchStatus && matchRegion;
  });

  const prevRows = Math.max(1, resSheet.getLastRow() - 2);
  resSheet.getRange(3, 1, prevRows, NUM_COLS).clearContent();

  if (filtered.length > 0) {
    resSheet.getRange(3, 1, filtered.length, NUM_COLS).setValues(filtered);
    ss.setActiveSheet(resSheet);
    ss.toast(filtered.length + "건이 조회되었습니다.", "조회 완료", 3);
  } else {
    ui.alert("일치하는 데이터가 없습니다.");
  }
}

// ══════════════════════════════════════════════════════════════════
// [추가] N-care 가입 현황 웹앱 — 대시보드 PPT(점검) 연동용
//   ※ 위의 onOpen / filterHospitalDB / LAYOUT 는 그대로 두고 이 블록만 추가하세요.
//   배포: 배포 > 새 배포 > 유형: 웹 앱 > 실행: 나 / 액세스: 모든 사용자
//        → 생성된 /exec URL 을 dashboard.html 의 NCARE_URL 에 입력
//   응답: {success, tiers[5], joined[5], normal[5], target[5], rate[5],
//          totalJoined, totalNormal, normalRate}
// ══════════════════════════════════════════════════════════════════
function doGet(e) {
  try {
    /* [보안] 로그인 토큰 필수 — N-Care 운영 지표 */
    if (!isAuthed_(e)) return _nJson({ success:false, error:'unauthorized — 로그인이 필요합니다(토큰 없음/만료)' });

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('대시보드');
    if (!sh) return _nJson({ success:false, error:'대시보드 시트 없음' });

    // C~G(3~7) 5칸 표시값
    function rowCG(r){ return sh.getRange(r, 3, 1, 5).getDisplayValues()[0]; }
    function bVal(r){ return sh.getRange(r, 2).getDisplayValue(); }
    function num(x){
      var t = String(x==null?'':x).replace(/,/g,'').replace(/[^\d.\-]/g,'').trim();
      return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
    }

    // 등급 헤더(행8) — 미가입은 CurePass 로 표기
    var tiers = rowCG(LAYOUT.NCARE_LABEL_ROW).map(function(s){ return String(s).trim(); });
    if (tiers[4] && /미가입/.test(tiers[4])) tiers[4] = 'CurePass';

    var joined = rowCG(LAYOUT.NCARE_VALUE_ROW).map(num);       // 행9  가입 병원 수
    var normal = rowCG(LAYOUT.NORMAL_OP_ROW).map(num);         // 행11 정상 운영 병원 수
    var target = rowCG(LAYOUT.INSPECT_TGT_ROW).map(num);       // 행12 점검 대상 병원 수
    var rate   = rowCG(LAYOUT.INSPECT_TGT_ROW + 1).map(function(s){ return String(s).trim(); }); // 행13 점검률

    // 하단 요약(행14): B~G 중 첫 숫자=정상 운영 병원 수, 첫 %=정상 운영률
    var opRow = sh.getRange(LAYOUT.NCARE_OP_ROW, 2, 1, 6).getDisplayValues()[0];
    var totalNormal = null, normalRate = null;
    opRow.forEach(function(x){
      var n = num(x);
      if (n != null && totalNormal == null) totalNormal = n;
      if (/%/.test(String(x)) && normalRate == null) normalRate = String(x).trim();
    });

    return _nJson({
      success: true,
      tiers: tiers, joined: joined, normal: normal, target: target, rate: rate,
      totalJoined: num(bVal(LAYOUT.TOTAL_NCARE_ROW)),   // B9 전체 가입자
      totalNormal: totalNormal,
      normalRate:  normalRate,
      // 참고용: 병원 서비스 현황(행3 라벨 / 행4 값)
      service: {
        total:  num(bVal(LAYOUT.TOTAL_HOSP_ROW)),
        labels: rowCG(LAYOUT.HOSP_LABEL_ROW).map(function(s){ return String(s).trim(); }),
        counts: rowCG(LAYOUT.HOSP_VALUE_ROW).map(num)
      },
      sheet: '대시보드',
      updated: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm')
    });
  } catch (err) {
    return _nJson({ success:false, error:String(err) });
  }
}
function _nJson(o){
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ── [보안] 로그인 토큰 검증 ─────────────────────────────
   auth.js와 동일한 인증 서버에 토큰을 확인해 로그인 사용자만 데이터를 받게 한다.
   인증 서버 왕복이 비싸므로 스크립트 캐시에 5분 보관한다(유효 토큰만 캐시).
   ※ 클라이언트는 ?token=... 로 전달한다 (auth.js의 BazAuth.withToken 사용) */
var AUTH_VERIFY_URL = 'https://script.google.com/macros/s/AKfycbykXiS7tXXx_nNuwXwQ--hgIXMrBSNdBPxOCn8b6H_zg9AWkbdLLqmF0Wn8L8zLaAI/exec';

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
  if(loc && loc.ok) return Number(loc.level)||0;
  /* 로컬 검증 실패(bad_signature·revoked·expired)는 하드 차단하지 않고 아래 인증 서버 왕복으로
     폴백한다 — 비밀 불일치가 락아웃이 아니라 감속으로 degrade("무조건 장애 안 남"). auth가 최종 판정. */

  /* ── 2순위(레거시 불투명 토큰): 예전 방식의 인증 서버 왕복 ─────────────────
     모든 사용자가 서명 토큰으로 재로그인하면 이 경로는 자연히 사라진다. 전환기 안전망. */
  if(!AUTH_VERIFY_URL) return AUTH_FAILOPEN_LEVEL;      /* 인증 서버 미설정 */

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
      AUTH_VERIFY_URL + '?action=verify&token=' + encodeURIComponent(String(token)),
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
  var url = AUTH_VERIFY_URL;
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

/* 로그인(Lv.1 이상) 여부 */
function isAuthed_(e){
  var p = (e && e.parameter) || {};
  return verifyLevel_(p.token || '') >= 1;
}
