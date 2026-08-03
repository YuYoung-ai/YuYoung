/************************************************************
 * BAZ 인증 서버 (auth_gas.gs) — v4 · 불투명 토큰(비밀 없음)
 * ----------------------------------------------------------
 * ★ 보안 시트(Credentials / Tokens / LoginLog)에 붙어 있는
 *   Apps Script 프로젝트의 Code.gs 에 이 파일 내용을 넣고 재배포하세요.
 *   ── 이 파일 하나만 배포하면 로그인이 즉시 복구됩니다. ──
 *   baz_token_lib.gs / BAZ_TOKEN_SECRET / BAZ_TOKEN_EPOCH 는
 *   이제 auth 에서 전혀 쓰지 않습니다(있어도 무시, 없어도 무방).
 *
 * ── 왜 이렇게 바꿨나 (설계 원칙: 무조건 접속 장애 안 남) ─────
 * 직전 구조(HMAC 서명 토큰)는 8개 프로젝트가 같은 비밀값을 손으로
 * 맞춰야 했고, 그 값을 하나라도 지우거나 어긋내면
 *   · auth 는 로그인 자체가 죽고(비밀 없으면 토큰 발급 불가)
 *   · 데이터 GAS 는 서명 검증에 실패해 조용히 전면 차단됐다.
 * 실제로 이 두 가지가 동시에 터졌다.
 *
 * 그래서 공유 비밀 층을 통째로 걷어냈다.
 *   · 토큰은 그냥 추측 불가능한 랜덤 문자열(불투명 토큰)이다.
 *   · 발급 = Tokens 시트에 한 줄 적기. 외부 호출·비밀·라이브러리 0.
 *   · 검증 = 데이터 GAS 가 이 서버에 물어보면 시트에서 찾아 답한다.
 *     (그 왕복은 데이터 GAS 쪽에서 캐시 + 차단기 + fail-open 으로
 *      감싸져 있어, 이 서버가 느리거나 죽어도 로그인한 사람은
 *      계속 쓴다 — 연동이 안 깨진다.)
 *
 *   → 맞출 비밀이 없으니 어긋날 수도 없다.
 *   → 어떤 스크립트 속성을 지워도 로그인은 죽지 않는다.
 *
 * ── 전원 강제 로그아웃이 필요할 때 ─────────────────────────
 * Tokens 시트 내용을 지우면 됩니다(발급 기록이 곧 세션 목록이므로).
 * 단 그 직후 잠깐은 다들 재로그인해야 합니다.
 *
 * ── API (기존 계약 그대로 — 클라이언트/데이터 GAS 무수정) ────
 *  POST {action:'login',  password}  → {ok, token, level, name, expires}
 *  POST {action:'verify', token}     → {ok, level, name}
 *  POST {action:'logout', token}     → {ok}
 *  GET  ?action=verify&token=…       → {ok, level, name}   (데이터 GAS용)
 *  GET  ?action=ping                 → {ok, ver, mode, ...}  (배포 확인용)
 ************************************************************/

var AUTH_VER = '5.0.0-hybrid';   /* ping 에 노출 — 밖에서 배포 여부를 눈으로 확인하는 표식 */

var AUTH_CFG = {
  CRED_SHEET  : 'Credentials',
  TOKEN_SHEET : 'Tokens',
  LOG_SHEET   : 'LoginLog',
  TTL_HOURS   : 12,        /* 토큰 유효 시간 */
  MAX_TOKENS  : 2000,      /* Tokens 시트 상한(넘으면 오래된 행부터 정리) */
  CRED_TTL    : 300        /* Credentials 캐시(초) — 로그인 핫패스에서 시트 읽기 제거 */
};

/* ── 토큰 발급(하이브리드) ─────────────────────────────────
   비밀이 있으면 HMAC 서명 토큰(무상태·검증 왕복 0), 없으면 불투명 토큰으로 폴백.
   ★ 어떤 경우에도 예외를 던지지 않는다 — 비밀이 없어도 로그인은 죽지 않는다. */
function _authIssue_(name, level, hours){
  try{
    if(typeof bazIssueToken_ === 'function' && typeof bazTokenConf_ === 'function' && bazTokenConf_().secret){
      var s = bazIssueToken_(name, level, hours);
      return { token:s.token, expires:s.expires, signed:true };
    }
  }catch(e){}
  return {
    token:   _authNewToken_(),
    expires: new Date(Date.now() + hours*3600*1000).toISOString(),
    signed:  false
  };
}

/* ── 시트 헬퍼 (어떤 오류도 밖으로 던지지 않는다) ──────────── */
function _authSS_(){ try{ return SpreadsheetApp.getActiveSpreadsheet(); }catch(e){ return null; } }
function _authSheet_(name){ try{ var ss=_authSS_(); return ss ? ss.getSheetByName(name) : null; }catch(e){ return null; } }
function _authJson_(o){
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
function _authNorm_(s){ return String(s==null?'':s).trim().toLowerCase().replace(/\s+/g,''); }

/* 추측 불가능한 불투명 토큰 — UUID 두 개(하이픈 제거). 비밀·서명 없음. */
function _authNewToken_(){
  var a = Utilities.getUuid().replace(/-/g,'');
  var b = Utilities.getUuid().replace(/-/g,'');
  return (a + b);   /* 64 hex chars */
}

/* ── Credentials 시트 읽기 ─────────────────────────────────
   열 이름을 자동 인식한다(비밀번호/password, 레벨/level, 이름/name).
   시트 구조가 조금 달라도 동작하도록 방어적으로 처리한다. */
function _authCreds_(){
  /* [성능] 로그인 핫패스의 Credentials 전체읽기를 CacheService로 감춘다(캐시 히트 시 시트 0회).
     서버측 스크립트 캐시라 외부 노출 없음. 비밀번호 변경은 최대 CRED_TTL 후 반영. */
  try{ var c = CacheService.getScriptCache().get('auth_creds'); if(c) return JSON.parse(c); }catch(e){}
  var out = _authCredsRead_();
  try{ if(out.length) CacheService.getScriptCache().put('auth_creds', JSON.stringify(out), AUTH_CFG.CRED_TTL); }catch(e){}
  return out;
}
function _authCredsRead_(){
  var sh = _authSheet_(AUTH_CFG.CRED_SHEET);
  if(!sh) return [];
  var v;
  try{ v = sh.getDataRange().getDisplayValues(); }catch(e){ return []; }
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
    var last = sh.getLastRow();
    if(last > 5000) sh.deleteRows(2, last - 4000);   /* 로그 상한 */
  }catch(e){}
}

/* ── 토큰 검증 ─────────────────────────────────────────────
   1순위: 서명 토큰이면 로컬 HMAC 검증(시트 0회) — baz_token_lib.gs
   2순위: 불투명 토큰이면 Tokens 시트 조회(col A:토큰 B:레벨 C:만료 D:발급) */
function authVerify_(token){
  if(!token) return {ok:false, error:'no_token'};
  if(typeof bazVerifyLocal_ === 'function'){
    var loc = bazVerifyLocal_(token);            /* 서명 토큰이 아니면 null → 시트 조회로 폴백 */
    if(loc) return loc.ok ? {ok:true, level:loc.level, name:loc.name} : {ok:false, error:loc.why};
  }
  var sh = _authSheet_(AUTH_CFG.TOKEN_SHEET);
  if(!sh) return {ok:false, error:'no_token_sheet'};
  var v;
  try{ v = sh.getDataRange().getDisplayValues(); }catch(e){ return {ok:false, error:'read_error'}; }
  var t = String(token);
  for(var r=1;r<v.length;r++){
    if(String(v[r][0]||'').trim() !== t) continue;
    var exp = new Date(v[r][2]);
    if(!isNaN(exp.getTime()) && exp < new Date()) return {ok:false, error:'expired'};
    return {ok:true, level:Number(v[r][1])||0, name:''};
  }
  return {ok:false, error:'invalid_token'};
}

/* ── 로그인 — 어떤 경우에도 예외를 밖으로 던지지 않는다 ────── */
function authLogin_(password){
  var pw = String(password==null?'':password).trim();
  if(!pw) return {ok:false, error:'no_password'};

  var creds = _authCreds_();
  if(!creds.length) return {ok:false, error:'no_credentials'};

  var hit = null;
  for(var i=0;i<creds.length;i++){ if(creds[i].pw === pw){ hit = creds[i]; break; } }
  if(!hit){ _authLog_('LOGIN_FAIL','', '', '비밀번호 불일치'); return {ok:false, error:'invalid_password'}; }

  var iss = _authIssue_(hit.name, hit.level, AUTH_CFG.TTL_HOURS);

  /* 서명 토큰은 무상태 — Tokens 시트에 안 적어도 검증된다(로그인 핫패스에서 시트 쓰기 제거).
     불투명 폴백 토큰만 검증용으로 Tokens 시트에 기록한다. */
  if(!iss.signed){
    try{
      var sh = _authSheet_(AUTH_CFG.TOKEN_SHEET);
      if(sh){
        sh.appendRow([iss.token, hit.level, iss.expires, new Date().toISOString()]);
        var last = sh.getLastRow();
        if(last > AUTH_CFG.MAX_TOKENS) sh.deleteRows(2, last - Math.floor(AUTH_CFG.MAX_TOKENS*0.75));
      }
    }catch(e){}
  }

  _authLog_('LOGIN_OK', hit.name, hit.level, iss.signed ? 'signed' : 'opaque');
  return {ok:true, token:iss.token, level:hit.level, name:hit.name, expires:iss.expires};
}

/* ── 로그아웃 — 해당 토큰 행을 지운다 ─────────────────────── */
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

/* ── 라우팅 — 무슨 일이 있어도 JSON 을 돌려준다(HTML 오류 페이지 금지) ── */
function doPost(e){
  try{
    var p = {};
    try{ p = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }catch(_){}
    var a = p.action || '';
    if(a === 'login')  return _authJson_(authLogin_(p.password));
    if(a === 'verify') return _authJson_(authVerify_(p.token));
    if(a === 'logout') return _authJson_(authLogout_(p.token));
    return _authJson_({ok:false, error:'unknown_action'});
  }catch(err){
    return _authJson_({ok:false, error:'server_error', detail:String(err)});
  }
}

function doGet(e){
  try{
    var p = (e && e.parameter) || {};
    var a = p.action || 'ping';
    if(a === 'ping'){
      var creds = 0, tok = -1, mode = 'opaque', fp = '';
      try{ creds = _authCreds_().length; }catch(_){}
      try{ var ts = _authSheet_(AUTH_CFG.TOKEN_SHEET); tok = ts ? Math.max(0, ts.getLastRow()-1) : -1; }catch(_){}
      try{
        var conf = (typeof bazTokenConf_ === 'function') ? bazTokenConf_() : {secret:''};
        if(conf.secret){
          mode = 'signed';
          fp = Utilities.base64EncodeWebSafe(
                 Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, conf.secret)).slice(0,8);
        }
      }catch(_){}
      return _authJson_({
        ok:true, ver:AUTH_VER, mode:mode, fp:fp,   /* fp = 비밀 지문(원문 아님) — 8개 프로젝트 정합 확인용 */
        creds:creds, tokens:tok,
        pong:new Date().toISOString()
      });
    }
    if(a === 'verify') return _authJson_(authVerify_(p.token));
    return _authJson_({ok:false, error:'unknown_action'});
  }catch(err){
    return _authJson_({ok:false, error:'server_error', detail:String(err)});
  }
}

/* ── 성능 실측 — 편집기에서 실행해 단계별 ms를 로그로 확인 ──
   목표: 로그인 ≤2000ms. 캐시 웜/콜드 두 번 돌려 비교하세요. */
function authSelfTime(){
  var t0 = Date.now();
  var conf = (typeof bazTokenConf_ === 'function') ? bazTokenConf_() : {secret:''};
  var t1 = Date.now();
  var creds = _authCreds_();                       /* 캐시 히트면 시트 0회 */
  var t2 = Date.now();
  var pw = creds[0] && creds[0].pw;
  var r = pw ? authLogin_(pw) : {ok:false, error:'no_cred'};
  var t3 = Date.now();
  var vr = r.ok ? authVerify_(r.token) : {ok:false};
  var t4 = Date.now();
  if(r.ok && !r.signed) authLogout_(r.token);      /* 불투명 시뮬 토큰만 정리(서명은 무상태) */
  var lines = [
    'mode: ' + (conf.secret ? 'signed' : 'opaque'),
    'bazTokenConf_ : ' + (t1-t0) + 'ms  (자가 프로비저닝 포함)',
    '_authCreds_   : ' + (t2-t1) + 'ms  (' + creds.length + '행, 캐시히트면 시트0회)',
    'authLogin_    : ' + (t3-t2) + 'ms  (' + (r.ok ? (r.signed?'signed·무상태':'opaque·Tokens쓰기') : '❌'+r.error) + ')',
    'authVerify_   : ' + (t4-t3) + 'ms  (' + (vr.ok?'✅':'❌') + ')',
    '── 로그인 총계 : ' + (t3-t0) + 'ms  (목표 ≤2000)'
  ];
  lines.forEach(function(l){ Logger.log(l); });
  return lines.join('\n');
}

/* ── 배포 전 자가진단 — 편집기 실행 드롭다운에서 돌려 보세요 ── */
function authSelfCheck(){
  var out = [];
  var _m = (typeof bazTokenConf_==='function' && bazTokenConf_().secret) ? 'signed' : 'opaque';
  out.push('버전: ' + AUTH_VER + ' (mode: ' + _m + ')');
  out.push('시트: ' + [AUTH_CFG.CRED_SHEET, AUTH_CFG.TOKEN_SHEET, AUTH_CFG.LOG_SHEET]
    .map(function(n){ return n + (_authSheet_(n) ? '✓' : '✗'); }).join(' '));
  out.push('Credentials 행 수: ' + _authCreds_().length);
  var c = _authCreds_()[0];
  if(c){
    var r = authLogin_(c.pw);
    out.push('로그인 시뮬레이션: ' + (r.ok ? '✅ ok (level ' + r.level + ')' : '❌ ' + r.error));
    if(r.ok){
      out.push('발급 토큰 재검증: ' + (authVerify_(r.token).ok ? '✅' : '❌'));
      authLogout_(r.token);   /* 시뮬레이션 토큰은 지운다 */
    }
  }else{
    out.push('⚠️ Credentials 에 로그인 가능한 행이 없습니다 — 비밀번호 열을 확인하세요.');
  }
  out.forEach(function(l){ Logger.log(l); });
  return out.join('\n');
}
