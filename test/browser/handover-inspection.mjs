import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const pw=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'));
const engine=process.env.PLAYWRIGHT_ENGINE||'webkit';
const browser=await pw[engine].launch({headless:true,executablePath:engine==='webkit'?process.env.PLAYWRIGHT_WEBKIT:undefined,
 channel:engine==='chromium'?'chrome':undefined});
const base='http://localhost:8256',root=fileURLToPath(new URL('../../',import.meta.url));
const request={id:'request_combined_123',hospitalName:'통합 검증 병원',sn:'SN123',engineer:'검증 담당자',gubun:'점검',
 registeredAt:'2026-11-19T09:00',visitAt:'2026-11-19T12:00'};
const typeFromFile={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css'};
try{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 const page=await context.newPage();
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 let source,receipt,linked=false,dropResponse=true,linkFailure=true;
 const writes=[],queries=[],uploads=[];
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  const json=result=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':base},body:JSON.stringify(result)});
  if(url.origin===base){
   if(url.pathname==='/auth.js')return route.fulfill({contentType:'application/javascript',
    body:"window.BazAuth={name:()=> '검증 담당자',token:()=> 'synthetic-token',withToken:u=>u,currentLevel:async()=>3,cachedLevel:()=>3};"});
   const file=path.join(root,decodeURIComponent(url.pathname));
   const type=typeFromFile[path.extname(file)];
   if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({path:file,contentType:type});
   return route.fulfill({status:404,body:''});
  }
  if(url.hostname==='script.google.com'&&req.method()==='POST'){
   const p=JSON.parse(req.postData());
   if(p.action==='inspection_pdf_job_source')return json({success:true,receipt});
   if(p.action==='inspection_pdf_job_lookup')return json({success:true,state:'missing'});
   if(p.action==='inspection_pdf_job_submit'){
    assert.equal(linked,true);
    assert.equal(p.recordId,source.recordId);
    assert.equal(p.requestId,request.id);
    assert.equal(p.sourceVersion,receipt.version);
    assert.equal(p.sourceBasis.fingerprint,receipt.basis.simplified.fingerprint);
    uploads.push(p);
    return json({success:true,state:'complete',jobId:p.uploadId,sha256:p.sha256,recordId:p.recordId,requestId:p.requestId,
     received:true,commentAttached:true,pdf:{url:'https://drive.google.com/file/d/synthetic-combined/view',revision:1,sha256:p.sha256}});
   }
   if(p.reqId){
    assert.equal(p.hosp,request.hospitalName);assert.equal(p.sn,request.sn);
    assert.equal(p.hpOut,'SYNTHETIC-OUT');assert.equal(p.hpIn,'SYNTHETIC-IN');
    writes.push(p);
    source={recordId:p.reqId,hospitalName:p.hosp,sn:p.sn,date:p.date,engineer:p.fse,gubun:p.gubun,detail:p.detail,result:p.result,version:'v1'};
    receipt={recordId:source.recordId,source,version:'sheet-v1',pdfRevision:0,basis:Object.fromEntries(
     ['standard','simplified'].map(format=>[format,{format,fingerprint:'a'.repeat(64)}]))};
    if(dropResponse){dropResponse=false;return route.abort();}
    return json({success:true,row:2,recordId:p.reqId,inspectionReceipt:receipt});
   }
  }
  if(url.hostname==='script.google.com'&&url.searchParams.get('action')==='savecheck'){
   const id=url.searchParams.get('reqId');
   queries.push(id);
   return json({success:true,reqId:id,found:id===source.recordId,result:{success:true,row:2,recordId:source.recordId}});
  }
  if(url.hostname==='yuyoung-production.coaptation.workers.dev'){
   const p=JSON.parse(req.postData()||'{}');
   if(p.action==='work_document_status'||p.action==='work_document_retry')
    return json({success:true,request,source,sourceLinked:linked,records:linked?[{recordId:source.recordId}]:[]});
   if(p.action==='work_handover_detail')return json({success:true,source,workDetail:{request:{...request,revision:1},history:[]}});
   if(p.action==='work_field_result_link'){
    if(linkFailure){linkFailure=false;return json({success:false,error:'합성 접수 연결 지연'});}
    linked=true;
    return json({success:true});
   }
  }
  return json({success:true,data:[]});
 });
 const address=base+'/handover-inspection.html?request='+request.id;
 await page.goto(address);
 const form=page.frameLocator('#inspectionForm');
 const frame=()=>page.frames().find(f=>f.url().includes('inspection.html?combined='));
 const ready=async()=>{
  await form.locator('#generateBtn').waitFor({state:'attached'});
  const state=await frame().evaluate(async()=>await inspectionSessionReady);
  assert.equal(state.success,true,state.error||errors.join('; '));
  assert.equal(await form.locator('#generateBtn').textContent(),'시트 기록 및 PDF 발행');
 };
 const render=()=>frame().evaluate(()=>{
  BazInspectionPdf.libraries=async()=>{};
  BazInspectionPdf.body=async()=>[];
  BazInspectionPdf.assemble=async()=>({blob:new Blob(['%PDF-1.7 synthetic combined report']),pdf:null,passes:1});
 });
 assert.equal(await page.getByRole('link',{name:'기존 Handover로 작성'}).getAttribute('href'),'handover.html?request='+request.id);
 await ready();
 await render();
 await frame().evaluate(async()=>{
  document.getElementById('pdfFormat').value='simplified';
  document.getElementById('actionDetail').value='장비 동작 확인 및 조치';
  document.getElementById('combined-result').value='정상';
  document.getElementById('combined-hpOut').value='SYNTHETIC-OUT';
  document.getElementById('combined-hpIn').value='SYNTHETIC-IN';
  await generatePDF(false);
 });
 assert.equal(writes.length,1);assert.equal(uploads.length,0);
 assert.match(await form.locator('#pdfGenerationState').textContent(),/PDF 준비 실패/);
 await page.reload();
 await ready();
 await render();
 assert.equal(await form.locator('#actionDetail').inputValue(),'장비 동작 확인 및 조치');
 await frame().evaluate(()=>generatePDF(false));
 assert.deepEqual(queries,[writes[0].reqId]);
 assert.equal(writes.length,1);assert.equal(uploads.length,0);
 assert.match(await form.locator('#pdfGenerationState').textContent(),/합성 접수 연결 지연/);
 assert.equal(await form.getByRole('link',{name:'기존 내역서에서 이어쓰기'}).getAttribute('href'),
  'inspection.html?request='+request.id+'&record='+source.recordId);
 await frame().evaluate(()=>generatePDF(false));
 await frame().waitForFunction(()=>window.BazPerf.samples().some(s=>s.name==='pdf_delivery_total'));
 assert.equal(await form.locator('#doneTitle').textContent(),'점검 내역서 저장 완료');
 assert.equal(writes.length,1);assert.equal(uploads.length,1);
 const legacyCurrent=await frame().evaluate(async()=>{
  const repo=BazInspectionRepository.create({indexedDB,storage:localStorage,owner:draftRepository.owner});
  await repo.ready();return repo.current();
 });
 assert.equal(legacyCurrent,null);
 await page.reload();
 await ready();
 assert.equal(await form.locator('#actionDetail').inputValue(),'장비 동작 확인 및 조치');
 await frame().evaluate(()=>localStorage.removeItem('baz_handover_inspection_v1:'+draftRepository.owner+':'+combinedRequest));
 await page.reload();
 await form.locator('#generateBtn').waitFor({state:'attached'});
 const rejected=await frame().evaluate(async()=>await inspectionSessionReady);
 assert.equal(rejected.success,false);
 assert.match(rejected.error,/저장된 현장 기록/);
 assert.equal(writes.length,1);
 assert.deepEqual(errors,[]);
 console.log(engine+' PASS: separate route, preserved input after reload, one Sheet row after lost response, link retry, one PDF submit and safe legacy fallback');
}finally{await browser.close();}
