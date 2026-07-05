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
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("병원정보DB");
    if (!sheet) throw new Error("'병원정보DB' 시트를 찾을 수 없습니다.");

    var lastRow = sheet.getLastRow();
    if (lastRow < 3) return ok([]);

    // B~M (12개 열), 3행부터  ← 기존 10 → 12로 변경
    var values = sheet.getRange(3, 2, lastRow - 2, 12).getValues();

    var hospitals = values
      .filter(function(r){ return String(r[0]).trim() !== ""; })
      .map(function(r){
        return {
          name:      String(r[0]).trim(),   // B: 병원명
          sn:        String(r[1]).trim(),   // C: S/N
          region:    String(r[2]).trim(),   // D: 지역
          address:   String(r[3]).trim(),   // E: 주소
          lastVisit: String(r[4]).trim(),   // F: 최근점검일자
          status:    String(r[5]).trim(),   // G: 점검상태
          sales:     String(r[6]).trim(),   // H: 영업담당
          asType:    String(r[7]).trim(),   // I: AS유무상
          ncare:     String(r[8]).trim(),   // J: N-CARE
          client:    String(r[9]).trim(),   // K: 거래처
          hpVer:     String(r[10]).trim(),  // L: HP_Ver  ← 추가
          uiVer:     String(r[11]).trim()   // M: UI_Ver  ← 추가
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