import {DEFINITION,validateAnswers,validateDefinition,otherOption,otherKey} from '../../../js/baz-survey-schema.mjs';
import {createSalesAuth} from './sales-auth.js';
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
const fail=(s,m)=>{throw new HttpError(s,m);};
const sql=(env,q,...v)=>env.DB.prepare(q).bind(...v);
const all=async s=>(await s.all()).results||[];
const json=(v,s=200)=>Response.json(v,{status:s});
const id=()=>crypto.randomUUID();
const bearer=r=>(r.headers.get('Authorization')||'').replace(/^Bearer /,'');
export const digest=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))),x=>x.toString(16).padStart(2,'0')).join('');
const code=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),x=>x.toString(16).padStart(2,'0')).join('');
const salesAuth=createSalesAuth({sql,fail,json,digest,code});
const directory=async env=>(await all(sql(env,'SELECT name FROM survey_directory ORDER BY name'))).map(h=>h.name);
async function saveHospital(env,p,actor,now){
 const input=typeof p.name==='string'?p.name.normalize('NFKC').trim().replace(/\s+/g,' '):'';
 if(!input||input.length>100)fail(400,'입점병원 목록에서 병원을 검색·선택해 주세요.');
 const key=input.toLowerCase(),name=(await directory(env)).find(n=>n.toLowerCase()===key);
 if(!name)fail(400,'입점병원 목록에 없는 병원입니다. 목록에서 선택하거나 CS팀에 확인해 주세요.');
 await sql(env,'INSERT OR IGNORE INTO survey_hospitals(id,name,name_key,code,created_at,created_by) VALUES(?,?,?,?,?,?)',id(),name,key,code(),now,actor).run();
 return json({success:true,hospital:await sql(env,'SELECT id,name,code,active FROM survey_hospitals WHERE name_key=?',key).first()});
}
async function body(req){
 if(Number(req.headers.get('Content-Length')||0)>262144)fail(413,'요청이 너무 큽니다.');
 const reader=req.body?.getReader();if(!reader)fail(400,'요청 내용이 없습니다.');let n=0,chunks=[];
 while(true){const p=await reader.read();if(p.done)break;n+=p.value.length;if(n>262144){await reader.cancel();fail(413,'요청이 너무 큽니다.');}chunks.push(p.value);}
 const bytes=new Uint8Array(n);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
 try{const p=JSON.parse(new TextDecoder().decode(bytes));if(!p||typeof p!=='object'||Array.isArray(p))throw Error();return p;}catch{fail(400,'요청 형식을 확인하세요.');}
}
async function staff(req,env,min=1){
 const token=bearer(req);if(!token||token.length>4096)fail(401,'직원 로그인이 필요합니다.');let r,p;
 if(token.startsWith('sales_'))fail(403,'CS 관리자 권한이 필요합니다.');
 try{r=await fetch(env.AUTH_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'verify',token}),signal:AbortSignal.timeout(10000)});if(r.status===401||r.status===403)fail(401,'다시 로그인해 주세요.');if(!r.ok)fail(503,'로그인 서버 연결을 확인하세요.');p=await r.json();}catch(e){if(e instanceof HttpError)throw e;fail(503,'로그인 확인이 지연되고 있습니다.');}
 if(!p.ok||!p.name||!Number.isInteger(Number(p.level))||Number(p.level)<1)fail(401,'다시 로그인해 주세요.');
 if(Number(p.level)<min)fail(403,'관리자 권한이 필요합니다.');
 return {level:Number(p.level),actor:await digest(String(p.name))};
}
const campaign=(e,c)=>typeof c==='string'&&c.length<=100?sql(e,'SELECT * FROM survey_campaigns WHERE id=?',c).first():null;
function publicCampaign(c){return {id:c.id,title:c.title,state:c.state,startsAt:c.starts_at,endsAt:c.ends_at,updatedAt:c.updated_at,definition:JSON.parse(c.definition)};}
function isOpen(c,now){return c&&c.state==='open'&&(c.starts_at==null||c.starts_at<=now)&&(c.ends_at==null||c.ends_at>now);}
async function hospital(env,c){if(!/^[a-f0-9]{48}$/.test(c||''))fail(404,'유효한 병원 설문 링크가 아닙니다.');const h=await sql(env,'SELECT id,name,active FROM survey_hospitals WHERE code=?',c).first();if(!h||!h.active)fail(404,'현재 사용할 수 없는 설문 링크입니다.');return h;}
async function guest(req,env,action){
 const p=await body(req),h=await hospital(env,p.code),now=Date.now();
 const c=action==='resolve'?await sql(env,"SELECT * FROM survey_campaigns WHERE state='open'").first():await campaign(env,p.campaignId);
 if(!c||!isOpen(c,now))fail(410,'현재 접수 중인 설문이 없습니다. 병원 담당자에게 문의해 주세요.');
 if(action==='submit'&&p.definitionVersion&&p.definitionVersion!==JSON.parse(c.definition).version)return json({success:false,error:'설문 문항이 변경되었습니다. 새 설문을 확인한 뒤 다시 참여해 주세요.',code:'SURVEY_CHANGED'},409);
 const existing=await sql(env,'SELECT id,submission_id,answer_hash FROM survey_responses WHERE campaign_id=? AND hospital_id=?',c.id,h.id).first();
 if(action==='resolve')return json({success:true,hospital:h.name,campaign:publicCampaign(c),completed:!!existing,serverNow:now});
 if(action!=='submit')fail(404,'잘못된 요청입니다.');
 if(!/^[a-f0-9-]{36}$/.test(p.submissionId||''))fail(400,'제출 번호를 확인해 주세요.');
 let answers;try{answers=validateAnswers(JSON.parse(c.definition),p.answers);}catch(e){fail(400,e.message);}
 const encoded=JSON.stringify(answers),hash=await digest(encoded);
 if(existing){if(existing.submission_id===p.submissionId&&existing.answer_hash===hash)return json({success:true,completed:true});fail(409,'이 병원은 이번 조사에 이미 참여했습니다.');}
 const inserted=await sql(env,`INSERT OR IGNORE INTO survey_responses(id,campaign_id,hospital_id,submission_id,answer_hash,answers,submitted_at)
 SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM survey_campaigns WHERE id=? AND definition=? AND state='open' AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>?)) AND EXISTS(SELECT 1 FROM survey_hospitals WHERE id=? AND active=1) RETURNING id`,id(),c.id,h.id,p.submissionId,hash,encoded,now,c.id,c.definition,now,now,h.id).first();
 if(!inserted){const saved=await sql(env,'SELECT submission_id,answer_hash FROM survey_responses WHERE campaign_id=? AND hospital_id=?',c.id,h.id).first();if(saved&&saved.submission_id===p.submissionId&&saved.answer_hash===hash)return json({success:true,completed:true});if(saved)fail(409,'이 병원은 이번 조사에 이미 참여했습니다.');const latest=await campaign(env,c.id);if(latest&&latest.definition!==c.definition)return json({success:false,error:'설문 문항이 변경되었습니다. 새 설문을 확인한 뒤 다시 참여해 주세요.',code:'SURVEY_CHANGED'},409);fail(410,'설문 접수가 종료되거나 병원 링크가 중지되었습니다. 담당자에게 문의해 주세요.');}
 return json({success:true,completed:true},201);
}
function nullableTime(v){if(v===null||v===''||v===undefined)return null;if(!Number.isSafeInteger(v)||v<0)fail(400,'조사 일시를 확인해 주세요.');return v;}
const audit=(e,actor,action,target)=>sql(e,'INSERT INTO survey_audit VALUES(?,?,?,?,?)',id(),actor,action,target,Date.now());
function filters(p){const values=[p.campaignId],where=['r.campaign_id=?'];if(p.hospitalId){where.push('r.hospital_id=?');values.push(String(p.hospitalId));}for(const [key,op]of [['from','>='],['until','<']]){if(p[key]!=null){const t=nullableTime(p[key]);where.push('r.submitted_at'+op+'?');values.push(t);}}if(p.from!=null&&p.until!=null&&p.from>=p.until)fail(400,'조회 기간을 확인해 주세요.');return {where:where.join(' AND '),values};}
export function csvCell(value){let s=String(value??'');if(/^[\s]*[=+\-@]/.test(s)||/^[\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
async function results(env,p,c,exporting){
 const f=filters(p),rowsWhere=f.where,v=f.values,def=JSON.parse(c.definition),others=def.questions.filter(otherOption);
 if(exporting){
  const rows=await all(sql(env,'SELECT r.*,h.name FROM survey_responses r JOIN survey_hospitals h ON h.id=r.hospital_id WHERE '+rowsWhere+' ORDER BY r.submitted_at,r.id LIMIT 10001',...v));if(rows.length>10000)fail(400,'조회 기간을 줄여 1만 건 이하로 내려받아 주세요.');
  const columns=['병원명','제출시각 한국시간',...def.questions.map(q=>q.title),...others.map(q=>q.title+' (기타 설명)')];
  const lines=[columns.map(csvCell).join(',')];for(const r of rows){const a=JSON.parse(r.answers);lines.push([r.name,new Date(r.submitted_at+9*3600000).toISOString().replace('T',' ').slice(0,19),...def.questions.map(q=>Array.isArray(a[q.id])?a[q.id].join(' / '):a[q.id]),...others.map(q=>a[otherKey(q)])].map(csvCell).join(','));}
  return new Response('\uFEFF'+lines.join('\r\n'),{headers:{'Content-Type':'text/csv;charset=utf-8','Content-Disposition':"attachment; filename=survey-results.csv"}});
 }
 const textConditions=def.questions.filter(q=>q.type==='text').map(q=>"trim(json_extract(r.answers,'$."+q.id+"'))<>''").join(' OR ')||'0';
 const totals=await sql(env,"SELECT COUNT(*) responses,COUNT(DISTINCT r.hospital_id) hospitals,SUM(CASE WHEN ("+textConditions+") THEN 1 ELSE 0 END) comments FROM survey_responses r WHERE "+rowsWhere,...v).first();
 const sentValues=[c.id],sentWhere=['d.campaign_id=?'];if(p.hospitalId){sentWhere.push('d.hospital_id=?');sentValues.push(p.hospitalId);}
 const sent=await sql(env,'SELECT COUNT(*) n FROM survey_deliveries d WHERE '+sentWhere.join(' AND '),...sentValues).first();
 const respondents=await sql(env,'SELECT COUNT(*) n FROM survey_responses r JOIN survey_deliveries d ON d.campaign_id=r.campaign_id AND d.hospital_id=r.hospital_id WHERE '+rowsWhere,...v).first();
 const distributions={},validCounts={};for(const q of def.questions){if(q.type==='text')continue;
  if(q.type==='multiple'){distributions[q.id]=await all(sql(env,"SELECT j.value value,COUNT(*) count FROM survey_responses r,json_each(r.answers,'$."+q.id+"') j WHERE "+rowsWhere+' GROUP BY j.value',...v));validCounts[q.id]=(await sql(env,"SELECT COUNT(*) n FROM survey_responses r WHERE "+rowsWhere+" AND json_array_length(r.answers,'$."+q.id+"')>0",...v).first()).n;}
  else{distributions[q.id]=await all(sql(env,"SELECT json_extract(r.answers,'$."+q.id+"') value,COUNT(*) count FROM survey_responses r WHERE "+rowsWhere+" AND json_extract(r.answers,'$."+q.id+"') IS NOT NULL AND json_extract(r.answers,'$."+q.id+"')<>'' GROUP BY value",...v));validCounts[q.id]=distributions[q.id].reduce((s,r)=>s+r.count,0);}
 }
 const page=Math.max(0,Math.floor(Number(p.page)||0)),offset=page*50;
 const responses=await all(sql(env,'SELECT r.id,r.submitted_at,h.name,r.answers FROM survey_responses r JOIN survey_hospitals h ON h.id=r.hospital_id WHERE '+rowsWhere+' ORDER BY r.submitted_at DESC,r.id LIMIT 50 OFFSET ?',...v,offset));
 const deliveries=await all(sql(env,`SELECT h.id,h.name,d.channel,d.delivered_at,r.submitted_at FROM survey_deliveries d JOIN survey_hospitals h ON h.id=d.hospital_id LEFT JOIN survey_responses r ON r.campaign_id=d.campaign_id AND r.hospital_id=d.hospital_id WHERE ${sentWhere.join(' AND ')} ORDER BY d.delivered_at DESC LIMIT 200`,...sentValues));
 return json({success:true,campaign:publicCampaign(c),totals:{responses:totals.responses,hospitals:totals.hospitals,comments:totals.comments||0,sent:sent.n,sentResponded:respondents.n,rate:sent.n?respondents.n/sent.n*100:null},distributions,validCounts,responses:responses.map(r=>({...r,answers:JSON.parse(r.answers)})),page,hasMore:offset+responses.length<totals.responses,deliveries});
}
async function staffRoute(req,env,action){
 const who=await staff(req,env,2),p=await body(req),now=Date.now();
 if(action==='sales-settings')return salesAuth.settings(env);
 if(action==='sales-password')return salesAuth.setPassword(env,p,audit(env,who.actor,action,'sales'));
 if(action==='sales-state')return salesAuth.state(env,p,audit(env,who.actor,action,'sales'));
 if(action==='bootstrap')return json({success:true,level:who.level,campaigns:(await all(sql(env,'SELECT * FROM survey_campaigns ORDER BY created_at DESC'))).map(publicCampaign),hospitals:await all(sql(env,'SELECT id,name,code,active FROM survey_hospitals ORDER BY name LIMIT 5000'))});
 // Only the separately imported survey directory supplies issuer choices.
 // Historical hospitals remain available to results and existing customer links.
 if(action==='directory')return json({success:true,names:await directory(env)});
 if(action==='hospital-save')return saveHospital(env,p,who.actor,now);
 if(action==='hospital-state'){
  if(who.level<2)fail(403,'관리자 권한이 필요합니다.');const h=await sql(env,'SELECT id FROM survey_hospitals WHERE id=?',p.hospitalId).first();if(!h)fail(404,'병원을 찾을 수 없습니다.');if(typeof p.active!=='boolean')fail(400,'상태를 확인하세요.');await env.DB.batch([sql(env,'UPDATE survey_hospitals SET active=? WHERE id=?',p.active?1:0,h.id),audit(env,who.actor,'hospital-state',h.id)]);return json({success:true});
 }
 if(action==='campaign-create'){
  const title=typeof p.title==='string'?p.title.trim():'';if(!title||title.length>100)fail(400,'조사 제목을 100자 이내로 입력해 주세요.');const c=id();let def;try{def=validateDefinition(p.definition||DEFINITION);def.version='survey-'+id();}catch(e){fail(400,e.message);}await env.DB.batch([sql(env,"INSERT INTO survey_campaigns VALUES(?,?,'draft',NULL,NULL,?,?,?)",c,title,JSON.stringify(def),now,now),audit(env,who.actor,action,c)]);return json({success:true,campaign:publicCampaign(await campaign(env,c))},201);
 }
 const c=await campaign(env,p.campaignId);if(!c)fail(404,'조사 회차를 선택해 주세요.');
 if(action==='campaign-definition'){
  let def;try{def=validateDefinition(p.definition);def.version='survey-'+id();}catch(e){fail(400,e.message);}
  const title=typeof p.title==='string'?p.title.trim():'';if(!title||title.length>100)fail(400,'조사 제목을 확인해 주세요.');if(!Number.isSafeInteger(p.expectedUpdatedAt))fail(400,'조사를 다시 불러와 주세요.');
  const saved=await sql(env,"UPDATE survey_campaigns SET title=?,definition=?,updated_at=? WHERE id=? AND updated_at=? AND state='draft' AND NOT EXISTS(SELECT 1 FROM survey_responses WHERE campaign_id=?) RETURNING id",title,JSON.stringify(def),Math.max(now,c.updated_at+1),c.id,p.expectedUpdatedAt,c.id).first();
  if(!saved)fail(409,'접수 중이거나 응답이 있는 조사는 문항을 바꿀 수 없습니다. 다른 관리자가 변경한 경우 다시 불러와 주세요.');await audit(env,who.actor,action,c.id).run();return json({success:true});
 }
 if(action==='campaign-update'){
  const title=typeof p.title==='string'?p.title.trim():c.title;if(!title||title.length>100||!['draft','open','closed'].includes(p.state))fail(400,'조사 제목과 상태를 확인하세요.');const start=nullableTime(p.startsAt),end=nullableTime(p.endsAt);if(start!=null&&end!=null&&start>=end)fail(400,'종료 일시는 시작 일시보다 늦어야 합니다.');
  try{await env.DB.batch([sql(env,'UPDATE survey_campaigns SET title=?,state=?,starts_at=?,ends_at=?,updated_at=? WHERE id=?',title,p.state,start,end,now,c.id),audit(env,who.actor,action,c.id)]);}catch(e){if(/UNIQUE|constraint/i.test(String(e)))fail(409,'진행 중인 다른 조사를 먼저 종료해 주세요.');throw e;}return json({success:true});
 }
 if(action==='delivery'){
  const h=await sql(env,'SELECT id,active FROM survey_hospitals WHERE id=?',p.hospitalId).first();if(!h||!h.active)fail(404,'사용 가능한 병원을 선택하세요.');if(!isOpen(c,now))fail(409,'접수 중인 조사에서 배포 이력을 기록해 주세요.');if(!['sms','onsite','other'].includes(p.channel))fail(400,'전달 방식을 선택해 주세요.');await sql(env,'INSERT INTO survey_deliveries VALUES(?,?,?,?,?) ON CONFLICT(campaign_id,hospital_id) DO UPDATE SET channel=excluded.channel,delivered_at=excluded.delivered_at,created_by=excluded.created_by',c.id,h.id,p.channel,now,who.actor).run();return json({success:true});
 }
 if(action==='results'||action==='export')return results(env,p,c,action==='export');
 fail(404,'잘못된 요청입니다.');
}
async function salesRoute(req,env,action){
 if(action==='login'){
  if(!env.SALES_LOGIN_LIMITER)fail(503,'영업팀 접속 설정을 확인해 주세요.');const allowed=await env.SALES_LOGIN_LIMITER.limit({key:'sales-login:'+await digest(req.headers.get('CF-Connecting-IP')||'unknown')});if(!allowed.success)fail(429,'접속 시도가 많습니다. 1분 후 다시 시도해 주세요.');return salesAuth.login(req,env,await body(req));
 }
 const who=await salesAuth.session(req,env);if(action==='logout')return salesAuth.logout(req,env);const p=await body(req),now=Date.now();
 if(action==='bootstrap'){
  const cs=await all(sql(env,"SELECT * FROM survey_campaigns WHERE state='open'"));
  return json({success:true,names:await directory(env),campaigns:cs.map(c=>({id:c.id,title:c.title,state:c.state,startsAt:c.starts_at,endsAt:c.ends_at,questionCount:JSON.parse(c.definition).questions.length}))});
 }
 if(action==='hospital-save')return saveHospital(env,p,who.actor,now);
 if(action==='delivery'){
  const c=await campaign(env,p.campaignId),h=await sql(env,'SELECT id,active FROM survey_hospitals WHERE id=?',String(p.hospitalId||'')).first();if(!h||!h.active)fail(404,'사용 가능한 병원을 선택하세요.');if(!isOpen(c,now))fail(409,'접수 중인 조사를 선택해 주세요.');if(!['sms','onsite','other'].includes(p.channel))fail(400,'전달 방식을 선택해 주세요.');await sql(env,'INSERT INTO survey_deliveries VALUES(?,?,?,?,?) ON CONFLICT(campaign_id,hospital_id) DO UPDATE SET channel=excluded.channel,delivered_at=excluded.delivered_at,created_by=excluded.created_by',c.id,h.id,p.channel,now,who.actor).run();return json({success:true});
 }
 fail(403,'영업팀은 QR·안내 문자 발급과 전달 기록만 사용할 수 있습니다.');
}
export default {async fetch(req,env){
 env={AUTH_URL:'https://yuyoung-production.coaptation.workers.dev',CUSTOMER_PAGE:'https://yuyoung-ai.github.io/YuYoung/customer-survey.html',ALLOWED_ORIGINS:'https://yuyoung-ai.github.io',...env};
 const origin=req.headers.get('Origin'),allowed=new Set(env.ALLOWED_ORIGINS.split(',').map(x=>x.trim()));let r;
 try{
  if(origin&&!allowed.has(origin))fail(403,'허용되지 않은 접속 경로입니다.');const path=new URL(req.url).pathname;
  if(req.method==='OPTIONS')r=new Response(null,{status:204});
  else if(req.method==='GET'&&path==='/health')r=json({success:true,service:'customer-survey',version:1});
  else if(req.method!=='POST')fail(405,'지원하지 않는 요청 방식입니다.');
  else if(path.startsWith('/public/'))r=await guest(req,env,path.slice(8));
  else if(path.startsWith('/sales/'))r=await salesRoute(req,env,path.slice(7));
  else if(path.startsWith('/staff/'))r=await staffRoute(req,env,path.slice(7));else fail(404,'잘못된 요청입니다.');
 }catch(e){r=json({success:false,error:e instanceof HttpError?e.message:'처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.'},e instanceof HttpError?e.status:503);}
 r.headers.set('Cache-Control','no-store');r.headers.set('Referrer-Policy','no-referrer');r.headers.set('X-Content-Type-Options','nosniff');if(origin&&allowed.has(origin)){r.headers.set('Access-Control-Allow-Origin',origin);r.headers.set('Vary','Origin');r.headers.set('Access-Control-Allow-Headers','Authorization,Content-Type');r.headers.set('Access-Control-Allow-Methods','GET,POST,OPTIONS');}return r;
}};
