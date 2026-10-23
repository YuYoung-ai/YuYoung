import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import linkWorker from '../../survey-link/src/worker.js';
import {shortCode,shortKey} from '../src/short-links.js';
import {database} from './d1.mjs';
import {seedDirectory} from './directory-fixture.mjs';
globalThis.fetch=async()=>Response.json({ok:true,name:'CS 테스트',level:2});
async function setup(){const DB=database();seedDirectory(DB);const env={DB,SHORT_URL_BASE:'https://curejet.coaptation.workers.dev',CUSTOMER_PAGE:'https://yuyoung-ai.github.io/YuYoung/customer-survey.html'};
 const r=await worker.fetch(new Request('https://api.test/staff/hospital-save',{method:'POST',headers:{Authorization:'Bearer admin','Content-Type':'application/json'},body:JSON.stringify({name:'테스트 병원'})}),env);assert.equal(r.status,200);return {DB,env,h:(await r.json()).hospital};}
test('참여 주소는 128비트의 URL-safe 코드이며 정규 형식만 해석한다',()=>{
 for(let i=0;i<20;i++){const code=Array.from(crypto.getRandomValues(new Uint8Array(24)),x=>x.toString(16).padStart(2,'0')).join(''),slug=shortCode(code);assert.equal(slug.length,22);assert.equal(shortKey(slug),code.slice(0,32));assert.match(slug,/^[A-Za-z0-9_-]+$/);}
 for(const bad of ['',null,undefined,'a'.repeat(21),'a'.repeat(23),'a'.repeat(22),'../outside','%00'.repeat(8),'A'.repeat(21)+'='])assert.equal(shortKey(bad),null);
 assert.throws(()=>shortCode('bad'));
});
test('문자·QR용 전용 주소가 해당 병원 설문으로 이동하고 중지·오류를 차단한다',async()=>{
 const {DB,env,h}=await setup(),slug=h.surveyUrl.split('/').at(-1);assert.equal(h.surveyUrl,'https://curejet.coaptation.workers.dev/'+shortCode(h.code));assert.ok(!h.surveyUrl.includes(h.name));
 const binding={async fetch(req){assert.equal(req.redirect,'manual');assert.equal(new URL(req.url).pathname,'/r/'+slug);return worker.fetch(req,env);}};
 const open=()=>linkWorker.fetch(new Request(h.surveyUrl),{SURVEY:binding});let r=await open();assert.equal(r.status,302);assert.equal(r.headers.get('Location'),env.CUSTOMER_PAGE+'#h='+h.code);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('Referrer-Policy'),'no-referrer');
 r=await linkWorker.fetch(new Request(h.surveyUrl,{method:'HEAD'}),{SURVEY:binding});assert.equal(r.status,302);assert.equal(await r.text(),'');
 DB.raw.prepare('UPDATE survey_hospitals SET active=0 WHERE id=?').run(h.id);assert.equal((await open()).status,404);
 assert.equal((await worker.fetch(new Request('https://api.test/r/'+'A'.repeat(22)),env)).status,404);
});
test('전용 주소 Worker는 루트 안내·오류를 처리하며 임의 URL로 연결하지 않는다',async()=>{
 for(const [path,status] of [['/',200],['/health',200],['/https://evil.test',404],['/not-a-code',404]]){const r=await linkWorker.fetch(new Request('https://curejet.test'+path),{});assert.equal(r.status,status);assert.equal(r.headers.get('Location'),null);}
 assert.equal((await linkWorker.fetch(new Request('https://curejet.test/',{method:'POST'}),{})).status,405);
 const r=await linkWorker.fetch(new Request('https://curejet.test/'+'A'.repeat(22)),{SURVEY:{fetch:async()=>{throw Error('offline');}}});assert.equal(r.status,503);
});
test('병원 코드 앞 128비트가 겹치면 DB가 중복 연결을 차단한다',async()=>{
 const {DB,h}=await setup(),other=h.code.slice(0,32)+(h.code.slice(32)==='0000000000000000'?'1111111111111111':'0000000000000000');
 assert.throws(()=>DB.raw.prepare('INSERT INTO survey_hospitals(id,name,name_key,code,created_at,created_by) VALUES(?,?,?,?,?,?)').run('collision','다른 병원','다른 병원',other,Date.now(),'test'),/UNIQUE/);
});
