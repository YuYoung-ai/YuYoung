import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import {database} from './d1.mjs';
import {seedDirectory} from './directory-fixture.mjs';
globalThis.fetch=async(_url,req)=>{const p=JSON.parse(req.body);assert.equal(p.action,'verify','Old directory must never be requested');return Response.json({ok:true,name:'CS 테스트',level:2});};
function setup(){const DB=database();seedDirectory(DB);const env={DB,AUTH_URL:'https://auth.test',SALES_LOGIN_LIMITER:{limit:async()=>({success:true})}};const call=async(path,p={},token='admin')=>{const r=await worker.fetch(new Request('https://worker.test'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(p)}),env);return {status:r.status,p:await r.json()};};return {DB,call};}
async function sales(s){const password='test-directory-only-2026';assert.equal((await s.call('/staff/sales-password',{password})).status,200);return (await s.call('/sales/login',{password})).p.token;}
test('CS와 영업팀 모두 목록 외 병원을 발급하지 못하며 표기를 정규화한다',async()=>{
 const s=setup(),token=await sales(s);
 for(const [prefix,auth] of [['staff','admin'],['sales',token]]){
  for(const name of ['목록에 없는 병원','',null,'a'.repeat(101)])assert.equal((await s.call('/'+prefix+'/hospital-save',{name},auth)).status,400);
 }
 const a=(await s.call('/staff/hospital-save',{name:'  테스트   병원  '})).p.hospital;
 const b=(await s.call('/sales/hospital-save',{name:'테스트 병원'},token)).p.hospital;
 assert.equal(a.name,'테스트 병원');assert.equal(a.code,b.code);
 assert.equal(s.DB.raw.prepare('SELECT COUNT(*) n FROM survey_hospitals').get().n,1);
});
test('목록 교체 후 기존 병원 재유입을 막고 기존 링크와 응답을 유지한다',async()=>{
 const s=setup(),h=(await s.call('/staff/hospital-save',{name:'테스트 병원'})).p.hospital,token=await sales(s);
 const c=(await s.call('/staff/campaign-create',{title:'이전 링크 확인'})).p.campaign;
 assert.equal((await s.call('/staff/campaign-update',{campaignId:c.id,state:'open'})).status,200);
 s.DB.raw.exec("DELETE FROM survey_directory; INSERT INTO survey_directory VALUES('새 입점 병원',1)");
 assert.deepEqual((await s.call('/staff/directory')).p.names,['새 입점 병원']);
 assert.deepEqual((await s.call('/sales/bootstrap',{},token)).p.names,['새 입점 병원']);
 for(const [prefix,auth] of [['staff','admin'],['sales',token]])assert.equal((await s.call('/'+prefix+'/hospital-save',{name:h.name},auth)).status,400);
 assert.equal((await s.call('/public/resolve',{code:h.code})).status,200);
 const answers={source:'전시회',purchase:['품질'],price:4,quality:4,delivery:4,service:4,usability:4,comment:''};
 assert.equal((await s.call('/public/submit',{campaignId:c.id,code:h.code,submissionId:crypto.randomUUID(),answers})).status,201);
 assert.equal((await s.call('/staff/results',{campaignId:c.id})).p.totals.responses,1);
});
test('빈 목록은 기존 병원명으로 대체하지 않고 발급을 제한한다',async()=>{
 const s=setup();await s.call('/staff/hospital-save',{name:'테스트 병원'});const token=await sales(s);s.DB.raw.exec('DELETE FROM survey_directory');
 assert.deepEqual((await s.call('/staff/directory')).p.names,[]);
 assert.deepEqual((await s.call('/sales/bootstrap',{},token)).p.names,[]);
 assert.equal((await s.call('/sales/hospital-save',{name:'테스트 병원'},token)).status,400);
});
