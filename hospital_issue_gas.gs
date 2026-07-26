/**
 * BAZ BIOMEDIC — 병원 점검 현황 → 이슈이력(HISTORY) 제공용 Apps Script  v2
 *
 * 배포 방법:
 *  1) 이 코드를 "병원 점검 현황" 탭이 있는 스프레드시트의
 *     확장 프로그램 > Apps Script 에 붙여넣기 (기존 코드 전체 교체)
 *  2) 배포 > 배포 관리 > ✏️ > 버전: "새 버전" > 배포
 *     ※ "새 배포" 아님 — URL 유지 (hospital.html의 ISSUE_HIST_URL 그대로)
 *
 * ★ v2 변경점 ★
 *  - 열을 위치(O열·P열…)가 아니라 "헤더 이름"으로 찾도록 변경.
 *    체크박스 열이 추가·이동돼도 대분류/유형/교체품 등이 밀리지 않는다.
 *    (헤더를 못 찾으면 기존 위치값으로 폴백)
 *
 * 반환 형식:
 *  { success:true, data:{ "병원명":[ {d,f,t,pt,sy,p,fx,pay}, ... ], ... } }
 */

// ── 설정 ──────────────────────────────────────────
var SPREADSHEET_ID = '12omDiTZ5Z8lyERG-rghaRPjA7l5B_3np5WXkMPCHPNE';
var SHEET_NAME     = '병원 점검 현황';  // 탭 이름이 다르면 수정
var HEADER_SCAN    = 4;                  // 헤더 행 탐색 범위 (1~4행)

// 헤더 이름 후보 (정규화 후 완전일치 → 부분일치). 시트 표기가 조금 달라도 잡히도록 넉넉히.
var HEAD = {
  date:   ['처리일','날짜','일자','방문일','점검일'],
  name:   ['병원명','거래처명','병원'],
  staff:  ['CS담당자','CS 담당자','담당자','FSE','처리자'],
  kind:   ['점검/AS','점검·AS','점검/AS구분','구분','점검AS'],
  bigcat: ['대분류','분류','부위'],
  type:   ['유형','현상','증상'],
  part:   ['교체품','교체부품','교환품','부품'],
  cost:   ['교체비용','비용','유/무상','유무상'],
  content:['내용','상세','처리내용','조치내용','비고']
};

// 폴백 위치 (1-base) — 헤더를 못 찾을 때만 사용 (구버전과 동일)
var FALLBACK = { date:2, name:3, staff:4, kind:14, bigcat:15, type:16, part:17, cost:18, content:19 };

function doGet(e){
  try {
    /* [보안] 로그인 토큰 필수 — 병원별 처리 이력(내용 포함) */
    if (!isAuthed_(e)) return _json({ success:false, error:'unauthorized — 로그인이 필요합니다(토큰 없음/만료)' });

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sh = ss.getSheetByName(SHEET_NAME);
    if(!sh) return _json({ success:false, error:'시트 없음: ' + SHEET_NAME });

    var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    if(lastRow < 2) return _json({ success:true, data:{} });

    // 1) 헤더 행 탐지 + 이름→열 매핑
    var hdr = _findHeader(sh, lastCol);
    var COL = hdr ? hdr.col : _fallbackCol();
    var dataStart = (hdr ? hdr.row : 2) + 1;
    if(lastRow < dataStart) return _json({ success:true, data:{} });

    // 2) 데이터 읽기
    var numRows = lastRow - dataStart + 1;
    var values  = sh.getRange(dataStart, 1, numRows, lastCol).getValues();
    var history = {};

    values.forEach(function(row){
      var name = _cell(row, COL.name);
      if(!name) return;

      var rec = {
        d:  _date(_cellRaw(row, COL.date)),
        f:  _cell(row, COL.staff),
        t:  _kind(_cell(row, COL.kind)),
        pt: _clean(_cell(row, COL.bigcat)),   // 대분류 (체크박스 값 방어)
        sy: _clean(_cell(row, COL.type)),     // 유형
        fx: _clean(_cell(row, COL.content)),  // 내용
        pay:_pay(_cell(row, COL.cost))
      };
      var part = _clean(_cell(row, COL.part));
      if(part) rec.p = part;

      if(!rec.d) return;                       // 날짜 없는 행 스킵
      if(!history[name]) history[name] = [];
      history[name].push(rec);
    });

    // 3) 병원별 최신순 정렬
    Object.keys(history).forEach(function(name){
      history[name].sort(function(a,b){ return (b.d||'').localeCompare(a.d||''); });
    });

    return _json({ success:true, data:history, headerRow: hdr?hdr.row:null, mapped: hdr?hdr.col:null });

  } catch(err){
    return _json({ success:false, error:String(err) });
  }
}

// ── 헤더 탐지 ─────────────────────────────────────
function _norm(s){ return String(s==null?'':s).replace(/\s+/g,'').toLowerCase(); }

function _findHeader(sh, lastCol){
  var scan = Math.min(HEADER_SCAN, sh.getLastRow());
  var grid = sh.getRange(1, 1, scan, lastCol).getDisplayValues();
  for(var r=0; r<grid.length; r++){
    var rowNorm = grid[r].map(_norm);
    // '병원명'과 (처리일/날짜/일자) 중 하나가 같은 행에 있으면 헤더로 인정
    var hasName = HEAD.name.some(function(c){ return rowNorm.indexOf(_norm(c))>=0; });
    var hasDate = HEAD.date.some(function(c){ return rowNorm.indexOf(_norm(c))>=0; });
    if(hasName && hasDate){
      var col = {};
      Object.keys(HEAD).forEach(function(key){
        col[key] = _matchCol(rowNorm, HEAD[key]);   // 1-base, 못 찾으면 0
      });
      // 필수 열(병원명·처리일) 확보 실패 시 헤더로 인정하지 않음
      if(col.name && col.date) return { row:r+1, col:col };
    }
  }
  return null;
}

// 헤더 정규화 배열에서 후보(완전일치 우선 → 부분일치) 열 번호(1-base)
function _matchCol(rowNorm, cands){
  var i, k, q;
  for(i=0;i<cands.length;i++){ q=_norm(cands[i]);
    for(k=0;k<rowNorm.length;k++){ if(rowNorm[k]===q) return k+1; } }
  for(i=0;i<cands.length;i++){ q=_norm(cands[i]); if(!q) continue;
    for(k=0;k<rowNorm.length;k++){ if(rowNorm[k] && (rowNorm[k].indexOf(q)>=0 || q.indexOf(rowNorm[k])>=0)) return k+1; } }
  return 0;
}

function _fallbackCol(){
  var c={}; Object.keys(FALLBACK).forEach(function(k){ c[k]=FALLBACK[k]; }); return c;
}

// ── 셀 접근 ───────────────────────────────────────
function _cell(row, colIdx){ return colIdx ? _str(row[colIdx-1]) : ''; }     // 표시 문자열
function _cellRaw(row, colIdx){ return colIdx ? row[colIdx-1] : ''; }        // 원본(날짜용)

// ── 헬퍼 ──────────────────────────────────────────
function _json(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function _str(v){ return (v===null||v===undefined) ? '' : String(v).trim(); }

// 체크박스/불리언이 잘못 들어온 값 방어 (TRUE/FALSE → 빈 문자열)
function _clean(s){
  var t=_str(s);
  return /^(true|false)$/i.test(t) ? '' : t;
}

// 날짜 → yyyy-MM-dd
function _date(v){
  if(!v) return '';
  if(Object.prototype.toString.call(v)==='[object Date]' && !isNaN(v)){
    return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  var s=String(v).trim();
  var m=s.match(/(\d{4})[-.\/]\s*(\d{1,2})[-.\/]\s*(\d{1,2})/);
  if(m) return m[1]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[3]).slice(-2);
  return '';
}

// 점검/AS → t: A/S→Voc, 점검→점검
function _kind(v){
  var s=_str(v);
  if(!s) return 'Voc';
  if(s.indexOf('점검')!==-1) return '점검';
  return 'Voc';
}

// 교체비용/유무상 → pay: 유상/무상
function _pay(v){
  var s=_str(v);
  if(s.indexOf('유상')!==-1) return '유상';
  // 금액이 적혀 있으면 유상으로 간주 (숫자만 남겼을 때 0 초과)
  var n=Number(s.replace(/[^\d.-]/g,''));
  if(!isNaN(n) && n>0) return '유상';
  return '무상';
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
var AUTH_FAILOPEN_LEVEL = 3;          /* 인증 서버에 닿지 못했을 때 부여할 레벨 */

function verifyLevel_(token){
  if(!AUTH_ENFORCE) return 3;                 /* 검증 끄기 스위치 */
  if(!AUTH_VERIFY_URL) return AUTH_FAILOPEN_LEVEL;      /* 인증 서버 미설정 */
  if(!token) return 0;                        /* 토큰이 아예 없으면 왕복 없이 차단 */

  var key = 'lv_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token)));
  var cache = null;
  try{
    cache = CacheService.getScriptCache();
    var hit = cache.get(key);
    if(hit) return Number(hit)||0;
  }catch(_){}

  /* 인증 서버 왕복 — "토큰이 틀렸다"와 "서버에 닿지 못했다"를 반드시 구분한다.
     둘을 뭉뚱그려 0을 돌려주면, 서버가 잠깐 흔들리거나 스크립트 권한이 빠졌을 때
     토큰이 멀쩡한 사람까지 전부 차단되고 재로그인으로도 풀리지 않는다(실제 발생). */
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
    Logger.log('[auth] 인증 서버 확인 실패(통과 처리): ' + err);
  }

  if(!reached) return AUTH_FAILOPEN_LEVEL;    /* 서버에 못 닿음 → 차단하지 않는다 */
  try{ if(lv > 0 && cache) cache.put(key, String(lv), 300); }catch(_){}
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
