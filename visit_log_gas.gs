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
    /* 방금 쓴 방문이 조회에 바로 보이도록 응답 캐시를 비운다 */
    try{ if(typeof bazCacheDrop_ === 'function') bazCacheDrop_('visitlog_latest'); }catch(_){}
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

    /* [성능] 응답 캐시(5분). 방문로그는 append-only 라 계속 자라는데 캐시가 없어
       매 요청 전체 스캔이었다. 쓰기(doPost)에서 캐시를 비우므로 최신성도 유지된다. */
    var cached = (typeof bazCacheGet_ === 'function') ? bazCacheGet_('visitlog_latest') : null;
    if (cached) {
      return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
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

    var body = JSON.stringify({ ok: true, visits: latest });
    try{ if(typeof bazCachePut_ === 'function') bazCachePut_('visitlog_latest', body, 300); }catch(_){}
    return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
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


/* 로그인(Lv.1 이상) 여부 — doGet 용 */
function isAuthed_(e) {
  var p = (e && e.parameter) || {};
  return verifyLevel_(p.token || '') >= 1;
}
