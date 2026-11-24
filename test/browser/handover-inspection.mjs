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
const handpieceDetail='약액 누수로 인한 HP 외, 내부 세척 완료';
const equipmentDetail='약액 유입 미발생 및 예방 차원 내부 세척 실시';
const sheetPart='시트 교체품';
const master={success:true,parts:['내부 세척',sheetPart,sheetPart]};
const typeFromFile={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css'};
try{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 const page=await context.newPage();
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 let source,receipt,linked=false,dropResponse=true,linkFailure=true;
 const writes=[],queries=[],uploads=[];
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  const json=result=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':base},body:JSON.stringify(result)});
  if(url.origin===base){
   if(url.pathname==='/hospital-work.html')return route.fulfill({contentType:typeFromFile['.html'],body:'<main>CS 서비스 현황</main>'});
   if(url.pathname==='/auth.js')return route.fulfill({contentType:'application/javascript',
    body:"window.BazAuth={name:()=> '검증 담당자',token:()=> 'synthetic-token',withToken:u=>u,currentLevel:async()=>3,cachedLevel:()=>3};"});
   const file=path.join(root,decodeURIComponent(url.pathname));
   const type=typeFromFile[path.extname(file)];
   if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({path:file,contentType:type});
   return route.fulfill({status:404,body:''});
  }
  if(url.hostname==='script.google.com'&&url.searchParams.get('action')==='master')return json(master);
  if(url.hostname==='script.google.com'&&url.searchParams.get('action')==='handover_bootstrap')
   return json({success:true,hospdb:{success:true,data:[]},master});
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
    assert.equal(p.result,'교체');
    assert.equal(p.part,'내부 세척');
    assert.equal(p.detail,equipmentDetail);
    writes.push(p);
    source={recordId:p.reqId,hospitalName:p.hosp,sn:p.sn,date:p.date,engineer:p.fse,gubun:p.gubun,part:p.part,detail:p.detail,result:p.result,version:'v1'};
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
   if(p.action==='work_inspection_source_link'){
    assert.equal(p.sheetVersion,receipt.version);
    if(linkFailure){linkFailure=false;return json({success:false,error:'합성 접수 연결 지연'});}
    linked=true;
    return json({success:true,request,recordId:p.recordId,sourceLinked:true});
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
 const legacyPage=await context.newPage();
 legacyPage.on('pageerror',e=>errors.push(e.message));
 await legacyPage.goto(base+'/handover.html');
 const legacyParts=legacyPage.locator('#part option');
 const combinedOptions=form.locator('#replacedPart option:not([hidden])');
 await legacyParts.filter({hasText:sheetPart}).waitFor({state:'attached'});
 await combinedOptions.filter({hasText:sheetPart}).waitFor({state:'attached'});
 const orderedParts=await combinedOptions.allTextContents();
 assert.deepEqual(orderedParts,await legacyParts.allTextContents());
 assert.deepEqual(orderedParts.slice(0,7),[
  '내부 세척',"Handpiece Ass'y","Foot-SW Ass'y",'Foot-SW Connector(장비)',
  'Foot-SW cable','Cradle (거치대)','SD Card'
 ]);
 assert.equal(await legacyPage.locator('#part').inputValue(),'없음');
 await legacyPage.close();
 await form.locator('#inspList').waitFor({state:'visible'});
 await frame().waitForFunction(()=>getComputedStyle(document.getElementById('inspList')).display==='grid');
 assert.equal(await form.locator('#nextDate').count(),0);
 const alignedFields=()=>frame().evaluate(()=>{
  const rect=id=>document.getElementById(id).getBoundingClientRect();
  const equals=(a,b)=>Math.abs(a-b)<1;
  const pair=(a,b)=>equals(rect(a).top,rect(b).top)&&equals(rect(a).height,rect(b).height)&&equals(rect(a).width,rect(b).width);
  return {
   reception:[['receiveDate','receiver'],['product','serialNo'],['subscription','version'],['inspectDate','csName']].every(ids=>pair(...ids)),
   signatures:pair('csSigBox','hsSigBox'),
   hospitalNameAbove:rect('hospitalName').bottom<=rect('hsSigBox').top,
   clearButtons:equals(
    document.querySelector('[data-clear="cs"]').getBoundingClientRect().top,
    document.querySelector('[data-clear="hs"]').getBoundingClientRect().top),
   productIsSelect:document.getElementById('product').tagName==='SELECT'
  };
 });
 const expectedAlignment={reception:true,signatures:true,hospitalNameAbove:true,clearButtons:true,productIsSelect:true};
 assert.deepEqual(await alignedFields(),expectedAlignment);
 await frame().evaluate(()=>{document.documentElement.dataset.theme='dark';});
 assert.deepEqual(await alignedFields(),expectedAlignment);
 const layout=()=>frame().evaluate(()=>{
  const [first,second]=Array.from(document.querySelectorAll('#inspList .insp-item')).map(item=>item.getBoundingClientRect());
  const reception=document.getElementById('receptionCard').getBoundingClientRect();
  const action=document.getElementById('actionCard').getBoundingClientRect();
  return {checksInRow:first.top===second.top&&first.left<second.left,commonInRow:reception.top===action.top,
   stepsHidden:getComputedStyle(document.getElementById('stepBar')).display==='none',
   sharedFields:['hospital','serialNo','inspectDate','csName','actionDetail'].every(id=>document.querySelectorAll('#'+id).length===1),
   fits:document.documentElement.scrollWidth<=window.innerWidth};
 });
 assert.deepEqual(await layout(),{checksInRow:true,commonInRow:false,stepsHidden:true,sharedFields:true,fits:true});
 await page.setViewportSize({width:1150,height:850});
 await frame().waitForFunction(()=>window.innerWidth>=800);
 assert.deepEqual(await layout(),{checksInRow:true,commonInRow:true,stepsHidden:true,sharedFields:true,fits:true});
 assert.deepEqual(await alignedFields(),expectedAlignment);
 await page.setViewportSize({width:390,height:844});
 const selectAs=async(cat,sub)=>{
  await form.locator('#asCat').selectOption(cat);
  await form.locator('#asSub').selectOption(sub);
 };
 const checkAction=async(part,detail)=>{
  assert.equal(await form.locator('#replacedPart').inputValue(),part);
  assert.equal(await form.locator('#actionDetail').inputValue(),detail);
  assert.equal(await form.locator('#cc_action').textContent(),String(detail.length));
 };
 await selectAs('핸드피스','H03');
 await checkAction('내부 세척',handpieceDetail);
 assert.equal(await frame().evaluate(()=>saveCurrentTask()),true);
 await page.reload();
 await ready();
 await render();
 await checkAction('내부 세척',handpieceDetail);
 await selectAs('노즐','N08');
 await checkAction('','');
 await selectAs('장비','E24');
 await checkAction('내부 세척',equipmentDetail);
 await form.locator('#replacedPart').selectOption(sheetPart);
 await form.locator('#actionDetail').fill('현장 확인 내용');
 await selectAs('핸드피스','H03');
 await checkAction(sheetPart,'현장 확인 내용');
 await frame().evaluate(()=>{
  const data=collectFormData();
  data.basic.replacedPart='이전 초안 교체품';
  applyFormData(data);
 });
 await checkAction('이전 초안 교체품','현장 확인 내용');
 await form.locator('#replacedPart').selectOption('');
 assert.equal(await combinedOptions.filter({hasText:'이전 초안 교체품'}).count(),0);
 await form.locator('#actionDetail').fill('');
 await selectAs('장비','E24');
 await checkAction('내부 세척',equipmentDetail);
 await form.locator('[data-n="1"] [data-r="수리"]').click();
 await form.locator('[data-n="2"] [data-r="교체"]').click();
 await frame().evaluate(async()=>{
  document.getElementById('pdfFormat').value='simplified';
  document.getElementById('combined-hpOut').value='SYNTHETIC-OUT';
  document.getElementById('combined-hpIn').value='SYNTHETIC-IN';
  await generatePDF(false);
 });
 assert.equal(writes.length,1);assert.equal(uploads.length,0);
 assert.deepEqual(queries,[writes[0].reqId]);
 assert.match(await form.locator('#pdfUploadStatus').textContent(),/합성 접수 연결 지연/);
 assert.equal(page.url(),address,'the form stays open while delivery is pending');
 await page.reload();
 await ready();
 await render();
 await checkAction('내부 세척',equipmentDetail);
 await frame().evaluate(()=>generatePDF(false));
 assert.deepEqual(queries,[writes[0].reqId]);
 assert.equal(writes.length,1);assert.equal(uploads.length,0);
 assert.equal(page.url(),address,'the entry stays open until delivery and comment attachment succeed');
 assert.equal(await form.getByRole('link',{name:'기존 내역서에서 이어쓰기'}).getAttribute('href'),
  'inspection.html?request='+request.id+'&record='+source.recordId);
 await Promise.all([
  page.waitForURL(base+'/hospital-work.html?request='+request.id),
  form.locator('#pdfUploadRetry').click()
 ]);
 assert.equal(await page.locator('main').innerText(),'CS 서비스 현황');
 assert.equal(writes.length,1);assert.equal(uploads.length,1);
 await page.goto(address);
 await ready();
 const legacyCurrent=await frame().evaluate(async()=>{
  const repo=BazInspectionRepository.create({indexedDB,storage:localStorage,owner:draftRepository.owner});
  await repo.ready();return repo.current();
 });
 assert.equal(legacyCurrent,null);
 await page.reload();
 await ready();
 await checkAction('내부 세척',equipmentDetail);
 await frame().evaluate(()=>localStorage.removeItem('baz_handover_inspection_v1:'+draftRepository.owner+':'+combinedRequest));
 await page.reload();
 await form.locator('#generateBtn').waitFor({state:'attached'});
 const rejected=await frame().evaluate(()=>inspectionSessionReady.then(()=>'',error=>error.message));
 assert.match(rejected,/저장된 현장 기록/);
 assert.equal(writes.length,1);
 assert.deepEqual(errors,[]);
 console.log(engine+' PASS: shared replacement options, A/S defaults, draft recovery, one Sheet row after lost response, link retry, one PDF submit and safe legacy fallback');
}finally{await browser.close();}
