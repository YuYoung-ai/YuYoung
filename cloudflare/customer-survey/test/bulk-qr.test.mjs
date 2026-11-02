import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {directoryNames,matchingNames,issuedHospital,runBatch,manifestCsv,fileStem,qrSvg,STICKER} from '../../../js/baz-survey-bulk-core.mjs';

const h=name=>({id:name,name,active:1,surveyUrl:'https://curejet.coaptation.workers.dev/test-code'});
test('directory normalization and searching retain selections on other pages',()=>{
 const names=directoryNames([' A 병원 ','Ａ  병원','B 병원','다른 병원',null]);
 assert.deepEqual(new Set(names),new Set(['A 병원','B 병원','다른 병원']));const selected=new Set(['B 병원']);
 assert.deepEqual(matchingNames(names,' a ',selected),['A 병원']);assert.deepEqual(matchingNames(names,'',selected,true),['B 병원']);assert.deepEqual([...selected],['B 병원']);
});
test('bulk runner keeps successful hospitals, rejects suspended links and retries idempotently',async()=>{
 const codes=new Map(),calls=[];const issue=async name=>{calls.push(name);if(name==='네트워크 실패')throw Error('연결 실패');const hospital=codes.get(name)||h(name);codes.set(name,hospital);return name==='중지 병원'?{...hospital,active:0}:hospital;};
 const a=await runBatch(['가 병원','네트워크 실패','중지 병원','나 병원'],{issue});
 assert.equal(a.results.get('가 병원').ok,true);assert.equal(a.results.get('나 병원').ok,true);assert.equal(a.results.get('네트워크 실패').ok,false);assert.match(a.results.get('중지 병원').error,/중지/);assert.equal(a.completed,4);
 const b=await runBatch(['가 병원'],{issue});assert.deepEqual(b.results.get('가 병원').hospital,a.results.get('가 병원').hospital);assert.equal(codes.size,3);
});
test('stop finishes in-flight work and never starts the rest of the queue',async()=>{
 let stop=false;const calls=[];
 const r=await runBatch(['첫 병원','다음 병원','마지막 병원'],{concurrency:1,issue:async name=>{calls.push(name);stop=true;return h(name);},shouldStop:()=>stop});
 assert.deepEqual(calls,['첫 병원']);assert.equal(r.stopped,true);assert.equal(r.completed,1);assert.equal(r.results.size,1);
});
test('authentication failure halts the queue without marking unstarted hospitals as failed',async()=>{
 const err=Object.assign(Error('다시 로그인'),{status:401});const r=await runBatch(['첫 병원','다음 병원'],{concurrency:1,issue:async()=>{throw err;}});
 assert.equal(r.authError,err);assert.equal(r.results.size,1);assert.equal(r.stopped,true);assert.equal(r.results.has('다음 병원'),false);
});
test('batch concurrency is bounded',async()=>{
 let live=0,peak=0;const r=await runBatch(Array.from({length:15},(_,i)=>'병원'+i),{concurrency:3,issue:async name=>{peak=Math.max(peak,++live);await new Promise(resolve=>setTimeout(resolve,1));live--;return h(name);}});
 assert.equal(peak,3);assert.equal(r.completed,15);
});
test('mismatched hospital names and unsafe URLs never enter the output manifest',()=>{
 assert.throws(()=>issuedHospital(h('다른 병원'),'대상 병원'),/일치/);
 for(const url of ['javascript:alert(1)','http://example.test','https://user:secret@example.test','invalid'])assert.throws(()=>issuedHospital({...h('대상 병원'),surveyUrl:url},'대상 병원'),/주소/);
});
test('print manifests escape formulas, quotes and newlines and preserve page/file mappings',()=>{
 const records=[{...h('=SUM(1,2)'),quantity:2,printName:'표시 병원'},{...h('병원 "가"\n분원'),quantity:3}];const csv=manifestCsv(records);
 assert.ok(csv.startsWith('\ufeff'));assert.match(csv,/'=SUM\(1,2\)/);assert.match(csv,/'_?=SUM|0001_=SUM/);assert.match(csv,/병원 ""가""\n분원/);assert.match(csv,/표시 병원/);assert.ok(!/[<>:"/\\|?*\u0000-\u001f]/.test(fileStem(0,'병원/가:*\n')));
});
test('vector QR data uses the existing encoder, four-module margins and requested sticker dimensions',()=>{
 const ctx={window:{},TextEncoder};vm.createContext(ctx);vm.runInContext(readFileSync(new URL('../../../js/vendor/qrcode-1.5.4.min.js',import.meta.url),'utf8'),ctx);
 const modules=ctx.BazQrEncoder.create(h('병원').surveyUrl,{errorCorrectionLevel:'M'}).modules;const svg=qrSvg(modules),size=modules.size+8;
 assert.ok(svg.includes(`viewBox="0 0 ${size} ${size}"`));assert.ok(svg.includes('M4 4'));assert.deepEqual([STICKER.width,STICKER.height],[32,25]);assert.equal(STICKER.margin,4);
});
