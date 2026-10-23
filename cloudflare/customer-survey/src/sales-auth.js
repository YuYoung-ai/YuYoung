export async function passwordHash(password,salt){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256);
 return Array.from(new Uint8Array(bits),x=>x.toString(16).padStart(2,'0')).join('');
}
export function createSalesAuth({sql,fail,json,digest,code}){
 const config=env=>sql(env,'SELECT * FROM survey_sales_config WHERE id=1').first();
 const token=req=>(req.headers.get('Authorization')||'').replace(/^Bearer /,'');
 async function session(req,env){
  const t=token(req);if(!/^sales_[a-f0-9]{48}$/.test(t))fail(401,'영업팀 접속 비밀번호를 입력해 주세요.');const hash=await digest(t),c=await config(env);
  const s=await sql(env,'SELECT * FROM survey_sales_sessions WHERE token_hash=?',hash).first();
  if(!c||!c.enabled||!s||s.version!==c.version||s.expires_at<=Date.now())fail(401,'접속이 만료되었거나 비밀번호가 변경되었습니다. 다시 접속해 주세요.');
  return {actor:'sales:'+hash.slice(0,24),hash};
 }
 async function login(req,env,p){
  const c=await config(env);if(!c||!c.enabled)fail(403,'영업팀 접속이 준비되지 않았습니다. CS팀에 문의해 주세요.');
  if(typeof p.password!=='string'||p.password.length>128||p.password.length<10)fail(401,'접속 비밀번호를 확인해 주세요.');
  const actual=await passwordHash(p.password,c.salt);let same=actual.length^c.password_hash.length;for(let i=0;i<actual.length;i++)same|=actual.charCodeAt(i)^(c.password_hash.charCodeAt(i)||0);
  if(same)fail(401,'접속 비밀번호를 확인해 주세요.');
  const t='sales_'+code(),expiresAt=Date.now()+8*3600000;
  await env.DB.batch([sql(env,'DELETE FROM survey_sales_sessions WHERE expires_at<=?',Date.now()),sql(env,'INSERT INTO survey_sales_sessions VALUES(?,?,?,?)',await digest(t),c.version,expiresAt,Date.now())]);
  return json({success:true,token:t,expiresAt});
 }
 async function settings(env){const c=await config(env);return json({success:true,configured:!!c,enabled:!!c?.enabled,updatedAt:c?.updated_at??null});}
 async function setPassword(env,p,auditStatement){
  if(typeof p.password!=='string'||p.password.length<10||p.password.length>128||!p.password.trim())fail(400,'공용 비밀번호를 10~128자로 입력해 주세요.');
  const salt=code(),hash=await passwordHash(p.password,salt);
  await env.DB.batch([sql(env,`INSERT INTO survey_sales_config VALUES(1,?,?,1,1,?) ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash,salt=excluded.salt,version=survey_sales_config.version+1,enabled=1,updated_at=excluded.updated_at`,hash,salt,Date.now()),sql(env,'DELETE FROM survey_sales_sessions'),auditStatement]);
  return json({success:true});
 }
 async function state(env,p,auditStatement){if(typeof p.enabled!=='boolean'||!await config(env))fail(400,'공용 비밀번호를 먼저 설정해 주세요.');await env.DB.batch([sql(env,'UPDATE survey_sales_config SET enabled=?,version=version+1,updated_at=? WHERE id=1',p.enabled?1:0,Date.now()),sql(env,'DELETE FROM survey_sales_sessions'),auditStatement]);return json({success:true});}
 async function logout(req,env){const s=await session(req,env);await sql(env,'DELETE FROM survey_sales_sessions WHERE token_hash=?',s.hash).run();return json({success:true});}
 return {session,login,settings,setPassword,state,logout};
}
