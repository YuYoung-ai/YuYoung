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
