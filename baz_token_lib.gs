/************************************************************
 * BAZ 공통 토큰 라이브러리 (baz_token_lib.gs)
 * ----------------------------------------------------------
 * ★ 이 파일의 내용을 아래 8개 Apps Script 프로젝트 각각에
 *   "새 스크립트 파일"로 추가하세요(복사·붙여넣기).
 *     인증(auth) · handover · hospital · hospital_issue
 *     · visit_log · inspection · ncare_dashboard · chatbot
 *
 * ── 왜 필요한가 ────────────────────────────────────────────
 * 예전 구조는 "불투명 토큰(랜덤 문자열) + 인증 서버 조회"였다.
 * 그래서 데이터 GAS가 요청을 받을 때마다 UrlFetchApp으로 인증
 * 서버에 왕복해야 했고, 다음 문제가 구조적으로 따라왔다.
 *
 *   · 인증 서버 하나가 7개 프로젝트의 단일 병목이 된다
 *   · 인증 서버가 느려지면 전체가 같이 느려진다(증폭)
 *   · 보안 시트의 Tokens 행을 비우면 모든 세션이 즉시 죽고,
 *     죽은 토큰은 캐시되지 않아 매 요청이 왕복을 반복한다
 *   · 인증 서버에 못 닿으면 fail-open으로 권한을 열어 준다(구멍)
 *
 * ── 무엇이 바뀌는가 ────────────────────────────────────────
 * 토큰이 스스로 유효성을 증명한다(HMAC-SHA256 서명).
 *
 *   토큰 = base64url(payload) + "." + base64url(HMAC(secret, payload))
 *   payload = {"n":이름,"l":레벨,"e":만료(초),"ep":에폭}
 *
 * 각 프로젝트는 공유 비밀로 서명만 다시 계산해 비교하면 된다.
 *   → 네트워크 호출 0회. 시트 조회 0회. 공유 상태 0개.
 *   → 인증 서버가 죽어도 이미 로그인한 사람은 계속 쓸 수 있다.
 *   → Tokens 시트를 비워도 아무 일도 일어나지 않는다.
 *
 * ── 일괄 무효화(예전에 "Tokens 행 삭제"로 하던 일) ──────────
 * 스크립트 속성 BAZ_TOKEN_EPOCH 값을 현재보다 큰 수로 올리면
 * 그보다 먼저 발급된 토큰이 전부 무효가 된다. 요청당 추가 I/O
 * 없이 즉시 적용된다. (아래 bazBumpTokenEpoch_ 참고)
 *
 * ── 최초 1회 설정 ──────────────────────────────────────────
 * 8개 프로젝트 모두에 같은 값을 넣어야 한다.
 *   프로젝트 설정 → 스크립트 속성 →
 *     BAZ_TOKEN_SECRET = (32자 이상 랜덤 문자열, 8개 프로젝트 동일)
 *     BAZ_TOKEN_EPOCH  = 1            (선택. 없으면 0으로 간주)
 * 비밀값은 인증 프로젝트에서 bazMakeSecret_()를 실행해 만들면 된다.
 ************************************************************/

/** 스크립트 속성은 실행 1회 안에서 여러 번 읽히므로 메모리에 담아 둔다 */
var _BAZ_TOK_CACHE = null;
function bazTokenConf_(){
  if(_BAZ_TOK_CACHE) return _BAZ_TOK_CACHE;
  var secret = '', epoch = 0;
  try{
    var sp = PropertiesService.getScriptProperties();
    secret = sp.getProperty('BAZ_TOKEN_SECRET') || '';
    epoch  = Number(sp.getProperty('BAZ_TOKEN_EPOCH') || '0') || 0;
  }catch(e){}
  _BAZ_TOK_CACHE = { secret: secret, epoch: epoch };
  return _BAZ_TOK_CACHE;
}

/** base64url 인코딩 (문자열 또는 byte[]) — '=' 패딩 제거 */
function bazB64u_(v){
  var s = (typeof v === 'string')
    ? Utilities.base64EncodeWebSafe(Utilities.newBlob(v).getBytes())
    : Utilities.base64EncodeWebSafe(v);
  return s.replace(/=+$/, '');
}
function bazB64uDecode_(s){
  var pad = s.length % 4;                       /* base64DecodeWebSafe는 패딩을 요구한다 */
  if(pad) s += new Array(5 - pad).join('=');
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(s)).getDataAsString();
}

/** 타이밍 노출을 줄이는 문자열 비교 — 길이가 달라도 끝까지 순회한다 */
function bazSafeEq_(a, b){
  a = String(a); b = String(b);
  var n = Math.max(a.length, b.length), diff = a.length ^ b.length;
  for(var i=0;i<n;i++) diff |= (a.charCodeAt(i)||0) ^ (b.charCodeAt(i)||0);
  return diff === 0;
}

/**
 * 서명 토큰 발급 — 인증(로그인) 프로젝트에서만 사용한다.
 * @param {string} name  로그인한 사람 이름
 * @param {number} level 권한 레벨
 * @param {number} hours 유효 시간(시간). 기본 12
 * @return {{token:string, expires:string}}
 */
function bazIssueToken_(name, level, hours){
  var c = bazTokenConf_();
  if(!c.secret) throw new Error('BAZ_TOKEN_SECRET 스크립트 속성이 설정되지 않았습니다');
  var ttl = (Number(hours) > 0 ? Number(hours) : 12) * 3600;
  var expSec = Math.floor(Date.now()/1000) + ttl;
  var payload = JSON.stringify({ n: String(name||''), l: Number(level)||0, e: expSec, ep: c.epoch });
  var p = bazB64u_(payload);
  var sig = bazB64u_(Utilities.computeHmacSha256Signature(p, c.secret));
  return {
    token: p + '.' + sig,
    expires: new Date(expSec*1000).toISOString()
  };
}

/**
 * 서명 토큰 로컬 검증 — ★ 네트워크 호출이 전혀 없다.
 * @return {null} 서명 토큰 형식이 아니거나 비밀값 미설정 → 호출부가 레거시 경로로 폴백
 *         {{ok:boolean, level:number, name:string, why:string}} 서명 토큰인 경우의 판정
 */
function bazVerifyLocal_(token){
  var c = bazTokenConf_();
  if(!c.secret) return null;                      /* 아직 설정 전 → 레거시 경로 */
  var t = String(token||'');
  var i = t.lastIndexOf('.');
  if(i <= 0 || i === t.length-1) return null;     /* 서명 토큰 형식이 아님 → 레거시 경로 */

  var p = t.slice(0, i), sig = t.slice(i+1);
  var calc;
  try{ calc = bazB64u_(Utilities.computeHmacSha256Signature(p, c.secret)); }
  catch(e){ return {ok:false, level:0, name:'', why:'hmac_error'}; }
  if(!bazSafeEq_(calc, sig)) return {ok:false, level:0, name:'', why:'bad_signature'};

  var o;
  try{ o = JSON.parse(bazB64uDecode_(p)); }
  catch(e){ return {ok:false, level:0, name:'', why:'bad_payload'}; }
  if(!o || typeof o.e === 'undefined') return {ok:false, level:0, name:'', why:'bad_payload'};

  if(Math.floor(Date.now()/1000) > Number(o.e)) return {ok:false, level:0, name:'', why:'expired'};
  if(Number(o.ep||0) < c.epoch) return {ok:false, level:0, name:'', why:'revoked'};   /* 일괄 무효화 */

  return {ok:true, level:Number(o.l)||0, name:String(o.n||''), why:'ok'};
}

/**
 * 발급된 모든 토큰을 즉시 무효화한다(예전의 "Tokens 시트 비우기"를 대체).
 * ★ 8개 프로젝트 모두에서 같은 값으로 올려야 전체에 적용된다.
 *   인증 프로젝트에서 실행해 나온 숫자를 나머지 7개 속성에도 넣으세요.
 */
function bazBumpTokenEpoch_(){
  var sp = PropertiesService.getScriptProperties();
  var next = (Number(sp.getProperty('BAZ_TOKEN_EPOCH')||'0')||0) + 1;
  sp.setProperty('BAZ_TOKEN_EPOCH', String(next));
  _BAZ_TOK_CACHE = null;
  Logger.log('BAZ_TOKEN_EPOCH = ' + next + '  → 8개 프로젝트 모두 이 값으로 맞추세요');
  return next;
}

/** 공유 비밀값 생성 도우미 — 한 번만 실행해 나온 값을 8개 프로젝트에 동일하게 넣는다 */
function bazMakeSecret_(){
  var s = Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      String(Utilities.getUuid()) + Date.now() + Utilities.getUuid())).replace(/=+$/,'');
  Logger.log('BAZ_TOKEN_SECRET = ' + s);
  return s;
}

/************************************************************
 * 조각 캐시 (bazCacheGet_ / bazCachePut_ / bazCacheDrop_)
 * ----------------------------------------------------------
 * CacheService 는 키 하나에 100KB까지만 담을 수 있다. 그래서 예전 코드는
 *   if(s.length < 95000) cache.put(...)
 * 처럼 크면 그냥 포기했다. 시트가 자라 그 선을 넘는 순간 캐시가 조용히
 * 무력화되고, 이후 모든 요청이 시트를 통째로 다시 읽었다.
 * "데이터가 늘수록 점점 느려지는" 원인이 이것이다.
 *
 * 여기서는 큰 값을 조각으로 나눠 저장해 크기 제한을 없앤다.
 * 한글은 UTF-8에서 최대 3바이트이므로 조각을 30000자로 잡아
 * 최악의 경우에도 90KB < 100KB 를 지킨다.
 ************************************************************/
var BAZ_CHUNK = 30000;      /* 조각당 문자 수 (한글 최악 3바이트 → 90KB) */
var BAZ_MAX_CHUNKS = 40;    /* 상한(≈1.2MB). 넘으면 캐시하지 않고 그냥 계산해서 준다 */

function bazCachePut_(key, str, ttlSec){
  if(!key || typeof str !== 'string') return false;
  var ttl = Number(ttlSec) || 300;
  var n = Math.ceil(str.length / BAZ_CHUNK);
  if(n > BAZ_MAX_CHUNKS) return false;
  try{
    var cache = CacheService.getScriptCache();
    var obj = {};
    for(var i=0;i<n;i++) obj[key+'#'+i] = str.substr(i*BAZ_CHUNK, BAZ_CHUNK);
    obj[key+'#m'] = JSON.stringify({n:n, len:str.length});
    cache.putAll(obj, ttl);
    return true;
  }catch(e){ return false; }
}

function bazCacheGet_(key){
  if(!key) return null;
  try{
    var cache = CacheService.getScriptCache();
    var meta = cache.get(key+'#m');
    if(!meta) return null;
    var m = JSON.parse(meta);
    /* n===0(빈 문자열)도 정상 값이다 — `!m.n` 으로 걸러내면 빈 응답이 영영 캐시되지 않는다 */
    if(!m || typeof m.n !== 'number' || m.n < 0) return null;
    var keys = [];
    for(var i=0;i<m.n;i++) keys.push(key+'#'+i);
    var got = cache.getAll(keys);
    var out = '';
    for(var j=0;j<m.n;j++){
      var part = got[key+'#'+j];
      if(part === null || part === undefined) return null;   /* 조각이 하나라도 빠지면 무효 */
      out += part;
    }
    if(out.length !== m.len) return null;                    /* 길이 불일치 → 무효 */
    return out;
  }catch(e){ return null; }
}

function bazCacheDrop_(key){
  if(!key) return;
  try{
    var cache = CacheService.getScriptCache();
    var meta = cache.get(key+'#m');
    var keys = [key+'#m'];
    if(meta){
      var m = JSON.parse(meta);
      for(var i=0;i<(m.n||0);i++) keys.push(key+'#'+i);
    }
    cache.removeAll(keys);
  }catch(e){}
}

/** JSON 응답 캐시 도우미 — build()는 캐시 미스일 때만 실행된다 */
function bazCachedJson_(key, ttlSec, build){
  var hit = bazCacheGet_(key);
  if(hit){ try{ return JSON.parse(hit); }catch(e){} }
  var out = build();
  try{ bazCachePut_(key, JSON.stringify(out), ttlSec); }catch(e){}
  return out;
}

/** 설치 자가진단 — 각 프로젝트에서 한 번씩 실행해 OK가 나오는지 확인한다 */
function bazTokenSelfTest_(){
  var c = bazTokenConf_();
  if(!c.secret){ Logger.log('❌ BAZ_TOKEN_SECRET 미설정 — 스크립트 속성에 넣으세요'); return 'NO_SECRET'; }
  var t = bazIssueToken_('셀프테스트', 2, 1);
  var v = bazVerifyLocal_(t.token);
  if(v && v.ok && v.level === 2 && v.name === '셀프테스트'){
    Logger.log('✅ 정상 — 서명 발급·검증 동작 (epoch=' + c.epoch + ')');
    Logger.log('   비밀값 지문(앞 8자): ' + c.secret.slice(0,8) + '…  ← 8개 프로젝트가 모두 같아야 합니다');
    return 'OK';
  }
  Logger.log('❌ 검증 실패: ' + JSON.stringify(v));
  return 'FAIL';
}
