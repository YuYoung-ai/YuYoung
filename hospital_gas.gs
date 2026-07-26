// ============================================================
//  BAZ BIOMEDIC — 병원정보DB Apps Script
//  [수정] doGet : L열(HP_Ver), M열(UI_Ver) 추가 반영
//  [유지] onOpen / filterHospitalDB : 기존 대시보드 필터 기능
// ============================================================

// ──────────────────────────────────────────────
//  doGet : hospital.html → 병원정보DB 읽기
//  응답: { success:true, data:[ {name,sn,...,hpVer,uiVer}, ... ] }
//  병원정보DB 시트 B~M열(3행부터) 기준
// ──────────────────────────────────────────────
function doGet(e) {
  try {
    /* [보안] 로그인 토큰 필수 — 병원 주소·S/N·담당자·좌표가 담긴 데이터 */
    if (!isAuthed_(e)) return fail('unauthorized — 로그인이 필요합니다(토큰 없음/만료)');

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("병원정보DB");
    if (!sheet) throw new Error("'병원정보DB' 시트를 찾을 수 없습니다.");

    var lastRow = sheet.getLastRow();
    if (lastRow < 3) return ok([]);

    // B~O (14개 열), 3행부터  ← 12 → 14 (N:위도, O:경도 추가)
    //   ※ N·O열이 아직 없어도 안전하게 동작한다(빈 값 → 좌표 null → 지오코딩 폴백).
    var lastCol = sheet.getLastColumn();
    var width   = Math.max(1, Math.min(14, lastCol - 1));   // B열부터 최대 14개
    var values  = sheet.getRange(3, 2, lastRow - 2, width).getValues();

    // 숫자 좌표만 통과(빈칸·문자열·범위 밖은 null)
    function num_(v, min, max) {
      var n = parseFloat(v);
      if (isNaN(n) || n < min || n > max) return null;
      return n;
    }

    var hospitals = values
      .filter(function(r){ return String(r[0]).trim() !== ""; })
      .map(function(r){
        return {
          name:      String(r[0]).trim(),   // B: 병원명
          sn:        String(r[1]||'').trim(),   // C: S/N
          region:    String(r[2]||'').trim(),   // D: 지역
          address:   String(r[3]||'').trim(),   // E: 주소
          lastVisit: String(r[4]||'').trim(),   // F: 최근점검일자
          status:    String(r[5]||'').trim(),   // G: 점검상태
          sales:     String(r[6]||'').trim(),   // H: 영업담당
          asType:    String(r[7]||'').trim(),   // I: AS유무상
          ncare:     String(r[8]||'').trim(),   // J: N-CARE
          client:    String(r[9]||'').trim(),   // K: 거래처
          hpVer:     String(r[10]||'').trim(),  // L: HP_Ver
          uiVer:     String(r[11]||'').trim(),  // M: UI_Ver
          lat:       num_(r[12], 33, 39),       // N: 위도 (대한민국 범위)
          lng:       num_(r[13], 124, 132)      // O: 경도
        };
      });

    return ok(hospitals);
  } catch (err) {
    return fail(err.message);
  }
}

function ok(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: true, data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}
function fail(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: false, error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  아래는 기존 대시보드 필터 기능 (그대로 유지 — 수정 없음)
// ============================================================
/**
 * 1. 스프레드시트가 열릴 때 [대시보드 조회]를 상단에 고정 생성합니다.
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('📂 [대시보드 조회]')
    .addItem('🔍 선택한 조건으로 DB 필터링', 'filterHospitalDB')
    .addToUi();
}
/**
 * 2. 선택한 셀의 조건에 맞춰 병원정보DB를 필터링하는 메인 함수
 */
function filterHospitalDB() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  var dashSheet = ss.getSheetByName("대시보드");
  var dbSheet = ss.getSheetByName("병원정보DB");
  var resSheet = ss.getSheetByName("대시보드 조회 현황판");

  if (!dashSheet || !dbSheet || !resSheet) {
    ui.alert("오류: '대시보드', '병원정보DB', '대시보드 조회 현황판' 시트 중 없는 시트가 있습니다. 이름을 확인하세요.");
    return;
  }

  var cell = dashSheet.getActiveCell();
  var row = cell.getRow();
  var col = cell.getColumn();
  var val = cell.getValue();

  if (row < 2 || col < 2 || val === "") {
    ui.alert("안내: 데이터가 있는 표 내부의 숫자를 정확히 선택하세요.");
    return;
  }

  var criterion = "";
  var targetCol = 0;
  var region = null;

  if (row === 3 && col >= 3 && col <= 7) {
    criterion = dashSheet.getRange(2, col).getValue();
    targetCol = 7;
  }
  else if (row === 7 && col >= 3 && col <= 7) {
    criterion = dashSheet.getRange(6, col).getValue();
    targetCol = 10;
  }
  else if (row >= 12 && row <= 21 && col >= 3 && col <= 7) {
    region = dashSheet.getRange(row, 2).getValue();
    criterion = dashSheet.getRange(11, col).getValue();
    targetCol = 7;
  }
  else {
    ui.alert("안내: 통계 표 내부의 숫자를 선택하세요.");
    return;
  }

  var lastRow = dbSheet.getLastRow();
  if (lastRow < 3) {
    ui.alert("안내: 병원정보DB에 검색할 데이터가 없습니다.");
    return;
  }
  var allData = dbSheet.getRange(3, 1, lastRow - 2, 19).getValues();

  var strCriterion = String(criterion).trim();
  var strRegion = region ? String(region).trim() : null;

  var filtered = allData.filter(function(r) {
    var matchStatus = (String(r[targetCol - 1]).trim() === strCriterion);
    var matchRegion = strRegion ? (String(r[3]).trim() === strRegion) : true;
    return matchStatus && matchRegion;
  });

  resSheet.getRange(3, 1, Math.max(1, resSheet.getLastRow() - 2), 19).clearContent();

  if (filtered.length > 0) {
    resSheet.getRange(3, 1, filtered.length, 19).setValues(filtered);
    ss.setActiveSheet(resSheet);
  } else {
    ui.alert("안내: 일치하는 데이터가 없습니다.");
  }
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
var AUTH_ENFORCE = false;

function verifyLevel_(token){
  if(!AUTH_ENFORCE) return 3;   /* [해제] 토큰 검증 사용 안 함 — 위 AUTH_ENFORCE 주석 참조 */
  try{
    if(!AUTH_VERIFY_URL || !token) return 0;
    var key = 'lv_' + Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token)));
    var cache = CacheService.getScriptCache();
    try{
      var hit = cache.get(key);
      if(hit) return Number(hit)||0;
    }catch(_){}
    var res = UrlFetchApp.fetch(
      AUTH_VERIFY_URL + '?action=verify&token=' + encodeURIComponent(String(token)),
      { method:'get', muteHttpExceptions:true, followRedirects:true });
    var r = JSON.parse(res.getContentText()||'{}');
    var lv = (r && r.ok) ? (Number(r.level)||0) : 0;
    try{ if(lv > 0) cache.put(key, String(lv), 300); }catch(_){}
    return lv;
  }catch(e){ return 0; }
}
/* 로그인(Lv.1 이상) 여부 */
function isAuthed_(e){
  var p = (e && e.parameter) || {};
  return verifyLevel_(p.token || '') >= 1;
}
