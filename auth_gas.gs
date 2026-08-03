/************************************************************
 * BAZ 인증 서버 (auth_gas.gs)
 * ----------------------------------------------------------
 * ★ 보안 시트(Credentials / Tokens / LoginLog)에 붙어 있는
 *   Apps Script 프로젝트에 이 파일을 넣고 재배포하세요.
 *   baz_token_lib.gs 도 같은 프로젝트에 함께 넣어야 합니다.
 *
 * ── 무엇이 달라지나 ────────────────────────────────────────
 * 예전: 로그인하면 랜덤 문자열을 만들어 Tokens 시트에 적어 두고,
 *       데이터 GAS들이 요청마다 이 서버에 "이 토큰 유효해?"를
 *       물어봤다(UrlFetchApp 왕복).
 *
 *       → 이 서버가 7개 프로젝트의 단일 병목이 됐고,
 *         Tokens 시트를 비우면 모든 세션이 죽으면서
 *         죽은 토큰마다 왕복이 무한 반복돼 접속 장애가 났다.
 *
 * 지금: 로그인하면 HMAC으로 **서명된 토큰**을 발급한다.
 *       데이터 GAS는 서명만 다시 계산해 보면 되므로
 *       이 서버에 물어볼 필요가 없다.
 *
 *       → 이 서버는 "로그인할 때"만 쓰인다. 검증 트래픽 0.
 *       → 이 서버가 죽어도 이미 로그인한 사람은 계속 쓴다.
 *       → Tokens 시트를 비워도 아무 일도 일어나지 않는다.
 *
 * ── 전원 강제 로그아웃이 필요할 때 ─────────────────────────
 * Tokens 시트를 비우지 마세요(이제 아무 효과가 없습니다).
 * bazBumpTokenEpoch_() 를 실행하고, 나온 숫자를 8개 프로젝트의
 * 스크립트 속성 BAZ_TOKEN_EPOCH 에 동일하게 넣으면 됩니다.
 *
 * ── API (기존 계약 그대로) ─────────────────────────────────
 *  POST {action:'login',  password}  → {ok, token, level, name, expires}
 *  POST {action:'verify', token}     → {ok, level, name}
 *  POST {action:'logout', token}     → {ok}
 *  GET  ?action=verify&token=…       → {ok, level, name}   (레거시 데이터 GAS용)
 *  GET  ?action=ping                 → {ok, ver}
 ************************************************************/

var AUTH_CFG = {
  CRED_SHEET  : 'Credentials',
  TOKEN_SHEET : 'Tokens',       /* 레거시 호환 + 로그인 기록용. 검증에는 더 이상 쓰지 않는다 */
  LOG_SHEET   : 'LoginLog',
  TTL_HOURS   : 12,             /* 토큰 유효 시간 */
  KEEP_LEGACY : true            /* 예전 불투명 토큰도 당분간 인정(전환 기간 무중단) */
};

function _authSS_(){ return SpreadsheetApp.getActiveSpreadsheet(); }
function _authSheet_(name){ try{ return _authSS_().getSheetByName(name); }catch(e){ return null; } }
function _authJson_(o){
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
function _authNorm_(s){ return String(s==null?'':s).trim().toLowerCase().replace(/\s+/g,''); }

/* ── Credentials 시트 읽기 ─────────────────────────────────
   열 이름을 자동 인식한다(비밀번호/password, 레벨/level, 이름/name).
   시트 구조가 조금 달라도 동작하도록 방어적으로 처리한다. */
function _authCreds_(){
  var sh = _authSheet_(AUTH_CFG.CRED_SHEET);
  if(!sh) return [];
  var v = sh.getDataRange().getDisplayValues();
  if(v.length < 2) return [];
  var head = v[0].map(_authNorm_);
  function col(cands){
    for(var i=0;i<head.length;i++){
      for(var j=0;j<cands.length;j++){ if(head[i].indexOf(cands[j])>=0) return i; }
    }
    return -1;
  }
  var cPw = col(['비밀번호','password','pw','passcode']);
  var cLv = col(['레벨','level','권한','lv']);
  var cNm = col(['이름','name','담당자','사용자']);
  if(cPw < 0) cPw = 0;                       /* 못 찾으면 첫 열을 비밀번호로 본다 */
  var out = [];
  for(var r=1;r<v.length;r++){
    var pw = String(v[r][cPw]||'').trim();
    if(!pw) continue;
    out.push({
      pw   : pw,
      level: (cLv>=0 ? (Number(v[r][cLv])||0) : 1) || 1,
      name : (cNm>=0 ? String(v[r][cNm]||'').trim() : '')
    });
  }
  return out;
}

function _authLog_(kind, name, level, note){
  try{
    var sh = _authSheet_(AUTH_CFG.LOG_SHEET);
    if(!sh) return;
    sh.appendRow([new Date(), kind, name||'', level||'', note||'']);
    /* 로그가 무한히 자라지 않게 상한을 둔다(시트가 커지면 모든 시트 작업이 느려진다) */
    var last = sh.getLastRow();
    if(last > 5000) sh.deleteRows(2, last - 4000);
  }catch(e){}
}

/* ── 레거시 불투명 토큰 조회 (전환 기간에만) ───────────────── */
function _authLegacyLookup_(token){
  if(!AUTH_CFG.KEEP_LEGACY) return null;
  var sh = _authSheet_(AUTH_CFG.TOKEN_SHEET);
  if(!sh) return null;
  var v;
  try{ v = sh.getDataRange().getDisplayValues(); }catch(e){ return null; }
  for(var r=1;r<v.length;r++){
    if(String(v[r][0]||'').trim() !== String(token)) continue;
    var exp = new Date(v[r][2]);
    if(!isNaN(exp.getTime()) && exp < new Date()) return {ok:false};
    return {ok:true, level:Number(v[r][1])||0, name:''};
  }
  return null;   /* 시트에 없음 */
}

/* ── 토큰 검증 (서명 → 로컬, 없으면 레거시 시트) ───────────── */
function authVerify_(token){
  if(!token) return {ok:false, error:'no_token'};
  var loc = bazVerifyLocal_(token);              /* baz_token_lib.gs */
  if(loc) return loc.ok ? {ok:true, level:loc.level, name:loc.name}
                        : {ok:false, error:loc.why};
  var lg = _authLegacyLookup_(token);
  if(lg) return lg.ok ? {ok:true, level:lg.level, name:lg.name} : {ok:false, error:'expired'};
  return {ok:false, error:'invalid_token'};
}

/* ── 로그인 ───────────────────────────────────────────────── */
function authLogin_(password){
  var pw = String(password==null?'':password).trim();
  if(!pw) return {ok:false, error:'no_password'};
  var creds = _authCreds_();
  if(!creds.length) return {ok:false, error:'no_credentials_sheet'};

  var hit = null;
  for(var i=0;i<creds.length;i++){ if(creds[i].pw === pw){ hit = creds[i]; break; } }
  if(!hit){ _authLog_('LOGIN_FAIL','', '', '비밀번호 불일치'); return {ok:false, error:'invalid_password'}; }

  var iss;
  try{ iss = bazIssueToken_(hit.name, hit.level, AUTH_CFG.TTL_HOURS); }
  catch(e){ return {ok:false, error:'secret_not_set', detail:String(e)}; }

  /* Tokens 시트에는 "발급 기록"만 남긴다 — 검증은 서명으로 하므로 이 행이 없어도 무방하다.
     (예전처럼 이 시트를 비워도 로그인한 사람이 튕기지 않는다) */
  try{
    var sh = _authSheet_(AUTH_CFG.TOKEN_SHEET);
    if(sh){
      sh.appendRow([iss.token, hit.level, iss.expires, new Date().toISOString()]);
      var last = sh.getLastRow();
      if(last > 2000) sh.deleteRows(2, last - 1500);      /* 발급 기록도 상한을 둔다 */
    }
  }catch(e){}

  _authLog_('LOGIN_OK', hit.name, hit.level, '');
  return {ok:true, token:iss.token, level:hit.level, name:hit.name, expires:iss.expires};
}

/* ── 로그아웃 ─────────────────────────────────────────────
   서명 토큰은 서버에 상태가 없으므로 개별 폐기가 불가능하다.
   클라이언트가 토큰을 지우는 것으로 충분하며(세션 스토리지),
   전원 강제 로그아웃이 필요하면 bazBumpTokenEpoch_() 를 쓴다.
   레거시 토큰은 시트에서 지워 준다. */
function authLogout_(token){
  try{
    var sh = _authSheet_(AUTH_CFG.TOKEN_SHEET);
    if(sh && token){
      var v = sh.getDataRange().getDisplayValues();
      for(var r=v.length-1;r>=1;r--){
        if(String(v[r][0]||'').trim() === String(token)){ sh.deleteRow(r+1); break; }
      }
    }
  }catch(e){}
  return {ok:true};
}

/* ── 라우팅 ───────────────────────────────────────────────── */
function doPost(e){
  var p = {};
  try{ p = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }catch(_){}
  var a = p.action || '';
  try{
    if(a === 'login')  return _authJson_(authLogin_(p.password));
    if(a === 'verify') return _authJson_(authVerify_(p.token));
    if(a === 'logout') return _authJson_(authLogout_(p.token));
    return _authJson_({ok:false, error:'unknown_action'});
  }catch(err){
    return _authJson_({ok:false, error:'server_error', detail:String(err)});
  }
}

function doGet(e){
  var p = (e && e.parameter) || {};
  var a = p.action || 'ping';
  try{
    if(a === 'ping')   return _authJson_({ok:true, ver:'3.0.0-signed', pong:new Date().toISOString()});
    /* 레거시 데이터 GAS가 아직 GET verify 를 부를 수 있다 — 서명 토큰이면 로컬 판정이라 즉시 응답 */
    if(a === 'verify') return _authJson_(authVerify_(p.token));
    return _authJson_({ok:false, error:'unknown_action'});
  }catch(err){
    return _authJson_({ok:false, error:'server_error', detail:String(err)});
  }
}

/* ── 배포 전 자가진단 — 편집기에서 한 번 실행하세요 ────────── */
function authSelfCheck(){
  var out = [];
  out.push('Credentials 행 수: ' + _authCreds_().length);
  out.push('시트: ' + [AUTH_CFG.CRED_SHEET, AUTH_CFG.TOKEN_SHEET, AUTH_CFG.LOG_SHEET]
    .map(function(n){ return n + (_authSheet_(n) ? '✓' : '✗'); }).join(' '));
  out.push('토큰 서명: ' + bazTokenSelfTest_());
  var c = _authCreds_()[0];
  if(c){
    var r = authLogin_(c.pw);
    out.push('로그인 시뮬레이션: ' + (r.ok ? '✅ ok (level ' + r.level + ')' : '❌ ' + r.error));
    if(r.ok) out.push('발급 토큰 재검증: ' + (authVerify_(r.token).ok ? '✅' : '❌'));
  }
  out.forEach(function(l){ Logger.log(l); });
  return out.join('\n');
}
