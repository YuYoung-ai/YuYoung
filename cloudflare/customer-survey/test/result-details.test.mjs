import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../src/worker.js';
import {database} from './d1.mjs';
globalThis.fetch=async(_u,r)=>{const {token}=JSON.parse(r.body);return Response.json(token==='admin'?{ok:true,name:'CS 관리자',level:2}:token==='staff'?{ok:true,name:'일반 직원',level:1}:{ok:false});};
async function setup(){const DB=database(),env={DB,SALES_LOGIN_LIMITER:{limit:async()=>({success:true})}};
 const call=async(path,p={},token='admin')=>{const r=await worker.fetch(new Request('https://test'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(p)}),env);return {status:r.status,p:await r.json()};};
 const definition={questions:[{id:'score',type:'rating',title:'만족도',required:false},{id:'opinion1',type:'text',title:'제품 의견',required:false},{id:'opinion2',type:'text',title:'서비스 의견',required:false}]};
 const c=(await call('/staff/campaign-create',{title:'상세 검증 조사',definition})).p.campaign;await call('/staff/campaign-update',{campaignId:c.id,state:'open'});
 function hospital(name){const id=crypto.randomUUID(),code=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','').slice(0,16);DB.raw.prepare('INSERT INTO survey_hospitals(id,name,name_key,code,created_at,created_by) VALUES(?,?,?,?,?,?)').run(id,name,name,code,Date.now(),'test');return {id,code,name};}
 async function response(h,opinions={}){const r=await call('/public/submit',{code:h.code,campaignId:c.id,submissionId:crypto.randomUUID(),answers:{score:4,opinion1:'',opinion2:'',...opinions}},null);assert.equal(r.status,201);}
 const details=(kind,p={},token='admin')=>call('/staff/result-details',{campaignId:c.id,kind,...p},token);
 return {DB,c,call,hospital,response,details};
}
async function populated(){const s=await setup(),a=s.hospital('배포 참여 병원'),b=s.hospital('배포 미참여 병원'),c=s.hospital('직접 참여 병원');for(const h of [a,a,b])await s.call('/staff/delivery',{campaignId:s.c.id,hospitalId:h.id,channel:'sms'});await s.response(a,{opinion1:'사용법 영상이 필요합니다.',opinion2:'점검 안내를 자세히 부탁드립니다.'});await s.response(c);return {...s,a,b,third:c};}
test('네 카드 상세의 대상과 합계가 일치하며 개인별 선택 답변을 반환하지 않는다',async()=>{
 const s=await populated(),p=(await s.call('/staff/results',{campaignId:s.c.id,summaryOnly:true})).p;
 assert.deepEqual(p.totals,{responses:2,hospitals:2,comments:2,sent:2,sentResponded:1,rate:50});assert.equal(p.responses,undefined);
 for(const [kind,n] of [['sent',2],['responded',2],['rate',2],['comments',2]]){const r=await s.details(kind);assert.equal(r.status,200);assert.equal(r.p.total,n);assert.equal(r.p.rows.length,n);assert.ok(r.p.rows.every(r=>!('answers' in r)));}
 const rows=(await s.details('sent')).p.rows,a=rows.find(r=>r.hospitalId===s.a.id),b=rows.find(r=>r.hospitalId===s.b.id);assert.equal(a.deliveryCount,2);assert.equal(a.responseInPeriod,true);assert.equal(b.submittedAt,null);assert.equal(b.responseInPeriod,false);
 const direct=(await s.details('responded')).p.rows.find(r=>r.hospitalId===s.third.id);assert.equal(direct.deliveredAt,null);
});
test('CS와 영업팀의 반복 전달은 이력에 남고 배포 병원 수는 중복 집계하지 않는다',async()=>{
 const s=await populated(),password='history-test-only-2026';await s.call('/staff/sales-password',{password});const token=(await s.call('/sales/login',{password},null)).p.token;assert.equal((await s.call('/sales/delivery',{campaignId:s.c.id,hospitalId:s.a.id,channel:'onsite'},token)).status,200);
 const history=(await s.details('history',{hospitalId:s.a.id})).p;assert.equal(history.total,3);assert.deepEqual(history.rows.map(r=>r.channel).sort(),['onsite','sms','sms']);assert.ok(history.rows.every(r=>!('created_by' in r)));
 assert.equal((await s.call('/staff/results',{campaignId:s.c.id})).p.totals.sent,2);
});
test('응답 기간은 참여·의견·응답률에 적용하며 배포 분모와 이력은 회차 전체를 유지한다',async()=>{
 const s=await populated();s.DB.raw.prepare('UPDATE survey_responses SET submitted_at=? WHERE hospital_id=?').run(1000,s.a.id);s.DB.raw.prepare('UPDATE survey_responses SET submitted_at=? WHERE hospital_id=?').run(2000,s.third.id);
 const p=(await s.call('/staff/results',{campaignId:s.c.id,from:1500,until:2500})).p;assert.equal(p.totals.hospitals,1);assert.equal(p.totals.sent,2);assert.equal(p.totals.rate,0);assert.equal(p.totals.comments,0);
 const rate=(await s.details('rate',{from:1500,until:2500})).p;assert.equal(rate.total,2);assert.equal(rate.rows.find(r=>r.hospitalId===s.a.id).responseInPeriod,false);
 assert.equal((await s.details('responded',{from:1500,until:2500})).p.total,1);assert.equal((await s.details('comments',{from:1500,until:2500})).p.total,0);
});
test('서술형 답변만 문항별로 표시하고 검색·정렬·빈 답변을 정확히 처리한다',async()=>{
 const s=await populated();s.DB.raw.prepare('UPDATE survey_responses SET submitted_at=1000 WHERE hospital_id=?').run(s.a.id);await s.response(s.b,{opinion1:'소모품 배송 일정을 알고 싶습니다.'});s.DB.raw.prepare('UPDATE survey_responses SET submitted_at=2000 WHERE hospital_id=?').run(s.b.id);
 let r=(await s.details('comments')).p;assert.equal(r.total,3);assert.equal(r.rows[0].name,s.b.name);assert.equal(r.rows[0].questionTitle,'제품 의견');
 assert.equal((await s.details('comments',{sort:'oldest'})).p.rows[0].name,s.a.name);assert.equal((await s.details('comments',{search:'점검 안내'})).p.total,1);assert.equal((await s.details('comments',{search:s.a.name})).p.total,2);
 for(const search of ['%','_','\' OR 1=1 --'])assert.equal((await s.details('comments',{search})).p.total,0);
 assert.equal((await s.details('sent',{search:'미참여'})).p.total,1);
});
test('상세 목록은 50건 제한 이후도 페이지로 모두 조회하며 빈 서술형 회차를 지원한다',async()=>{
 const s=await setup();for(let i=0;i<57;i++){const h=s.hospital('병원 '+String(i).padStart(2,'0'));s.DB.raw.prepare('INSERT INTO survey_deliveries VALUES(?,?,?,?,?)').run(s.c.id,h.id,'sms',i,'test');}
 const first=(await s.details('sent')).p,next=(await s.details('sent',{page:1})).p;assert.equal(first.total,57);assert.equal(first.rows.length,50);assert.equal(first.hasMore,true);assert.equal(next.rows.length,7);assert.equal(next.hasMore,false);assert.equal(new Set([...first.rows,...next.rows].map(r=>r.hospitalId)).size,57);
 s.DB.raw.prepare('UPDATE survey_campaigns SET definition=? WHERE id=?').run(JSON.stringify({questions:[{id:'rating',type:'rating',title:'만족도'}]}),s.c.id);assert.equal((await s.details('comments')).p.total,0);
});
test('상세 API는 CS 권한과 유효한 회차·검색·페이지 요청만 허용한다',async()=>{
 const s=await setup();for(const [token,status] of [[null,401],['bad',401],['staff',403],['sales_fake',403]])assert.equal((await s.details('sent',{},token)).status,status);
 for(const p of [{kind:'unknown'},{page:-1},{page:1.5},{pageSize:100},{search:'a'.repeat(101)},{from:100,until:99},{kind:'history'},{kind:'comments',sort:'DROP'}])assert.equal((await s.details('sent',p)).status,400);
 const other=(await s.call('/staff/campaign-create',{title:'다른 조사'})).p.campaign;assert.equal((await s.details('sent',{campaignId:other.id})).p.total,0);
});
test('기존 최근 전달 기록은 이력으로 한 번만 이관한다',async()=>{
 const s=await populated();s.DB.raw.exec('DELETE FROM survey_delivery_events');const migration=readFileSync(new URL('../migrations/0004_delivery_history.sql',import.meta.url),'utf8');s.DB.raw.exec(migration);s.DB.raw.exec(migration);assert.equal(s.DB.raw.prepare('SELECT COUNT(*) n FROM survey_delivery_events').get().n,2);
});
