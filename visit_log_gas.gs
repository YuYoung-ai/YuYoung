/****************************************************
 * BAZ BIOMEDIC - 병원 방문 로그 연동 (Apps Script)
 *
 * 역할:
 *  - doPost : inspection.html에서 PDF 생성 시 방문 기록을 시트에 저장
 *  - doGet  : hospital.html이 각 병원의 최근 방문일을 읽어감
 *
 * 사용 시트 이름: "방문로그"  (없으면 자동 생성)
 * 컬럼: 타임스탬프 | 병원명 | 방문일 | 구분 | 처리자 | 시리얼
 *
 * ★ [보안 v2] 로그인 토큰 검증 추가 ★
 *   조회·기록 모두 로그인한 사용자만 가능하다(병원명·방문일·담당자 노출 차단).
 *   클라이언트는 조회 시 ?token=... , 기록 시 payload.token 으로 전달한다.
 *   배포: 배포 > 배포 관리 > ✏️ > 버전 "새 버전" > 배포  (URL 유지)
 ****************************************************/

var SHEET_NAME = '방문로그';

// ---- 공통: 시트 가져오기(없으면 생성) ----
function getLogSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['타임스탬프', '병원명', '방문일', '구분', '처리자', '시리얼']);
    sh.setFrozenRows(1);
  }
  return sh;
}

// ---- PDF 생성 시 방문 기록 저장 ----
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // [보안] 로그인 토큰 필수 — 외부인의 무단 기록 차단
    if (verifyLevel_(data.token || '') < 1) {
      return _json({ ok: false, error: 'unauthorized — 로그인이 필요합니다(토큰 없음/만료)' });
    }

    var sh = getLogSheet_();
    sh.appendRow([
      new Date(),                    // 타임스탬프(서버 기록 시각)
      String(data.hospital || ''),   // 병원명
      String(data.visitDate || ''),  // 방문일 (YYYY-MM-DD)
      String(data.type || ''),       // 구분 (점검 / AS)
      String(data.handler || ''),    // 처리자
      String(data.serial || '')      // 시리얼
    ]);
    return _json({ ok: true });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

// ---- 병원별 최근 방문일 읽기 ----
function doGet(e) {
  try {
    // [보안] 로그인 토큰 필수 — 병원명·방문일·담당자가 담긴 데이터
    if (!isAuthed_(e)) {
      return _json({ ok: false, error: 'unauthorized — 로그인이 필요합니다(토큰 없음/만료)' });
    }

    var sh = getLogSheet_();
    var rows = sh.getDataRange().getValues();  // 1행은 헤더
    var latest = {};  // { 병원명: { date, type, handler } }

    for (var i = 1; i < rows.length; i++) {
      var name = String(rows[i][1] || '').trim();
      var visitDate = rows[i][2];
      if (!name || !visitDate) continue;

      var ds = formatDate_(visitDate);
      if (!latest[name] || ds > latest[name].date) {
        latest[name] = {
          date: ds,
          type: String(rows[i][3] || ''),
          handler: String(rows[i][4] || '')
        };
      }
    }

    return _json({ ok: true, visits: latest });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

// ---- 날짜를 YYYY-MM-DD 문자열로 ----
function formatDate_(v) {
  if (v instanceof Date) {
    var y = v.getFullYear();
    var m = ('0' + (v.getMonth() + 1)).slice(-2);
    var d = ('0' + v.getDate()).slice(-2);
    return y + '-' + m + '-' + d;
  }
  // 이미 문자열이면 앞 10자리(YYYY-MM-DD)만
  return String(v).slice(0, 10);
}

// ---- JSON 응답 ----
function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ── [보안] 로그인 토큰 검증 ─────────────────────────────
   auth.js와 동일한 인증 서버에 토큰을 확인해 로그인 사용자만 접근하게 한다.
   인증 서버 왕복이 비싸므로 토큰→레벨을 스크립트 캐시에 5분 보관한다(유효 토큰만).
   ※ AUTH_VERIFY_URL 은 auth.js 의 AUTH_URL 과 반드시 같은 값이어야 한다. */
var AUTH_VERIFY_URL = 'https://script.google.com/macros/s/AKfycbykXiS7tXXx_nNuwXwQ--hgIXMrBSNdBPxOCn8b6H_zg9AWkbdLLqmF0Wn8L8zLaAI/exec';

function verifyLevel_(token) {
  try {
    if (!AUTH_VERIFY_URL || !token) return 0;
    var key = 'lv_' + Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token)));
    var cache = CacheService.getScriptCache();
    try {
      var hit = cache.get(key);
      if (hit) return Number(hit) || 0;
    } catch (_) {}
    var res = UrlFetchApp.fetch(
      AUTH_VERIFY_URL + '?action=verify&token=' + encodeURIComponent(String(token)),
      { method: 'get', muteHttpExceptions: true, followRedirects: true });
    var r = JSON.parse(res.getContentText() || '{}');
    var lv = (r && r.ok) ? (Number(r.level) || 0) : 0;
    try { if (lv > 0) cache.put(key, String(lv), 300); } catch (_) {}
    return lv;
  } catch (e) { return 0; }
}

/* 로그인(Lv.1 이상) 여부 — doGet 용 */
function isAuthed_(e) {
  var p = (e && e.parameter) || {};
  return verifyLevel_(p.token || '') >= 1;
}
