import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);let playwright;
try{playwright=require('playwright');}catch{if(!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES)throw new Error('Install playwright or set CODEX_PRIMARY_RUNTIME_NODE_MODULES');playwright=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'));}
const {webkit}=playwright,root=fileURLToPath(new URL('../../',import.meta.url)),output=path.resolve(process.env.OUTPUT_DIR||path.join(root,'work/inspection-relink'));
fs.mkdirSync(output,{recursive:true});const checks=[],errors=[],base='http://inspection.test';
const browser=await webkit.launch({executablePath:process.env.PLAYWRIGHT_WEBKIT||undefined,headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.addInitScript(()=>{Object.defineProperty(crypto,'randomUUID',{value:undefined});});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));let linked=false,linkFailures=1;const calls=[];
 const source={recordId:'source_new_123',hospitalName:'검증 병원',date:'2026-10-22',sn:'SN1',engineer:'검증 담당자',gubun:'점검',result:'정상',detail:'장비 점검 및 작동 확인',version:'v1'};
 const request={id:'request_new_123',hospitalName:source.hospitalName,sn:source.sn,visitAt:'2026-10-22T10:00',revision:1,symptom:'작동 점검',status:'접수'};
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  const json=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  if(url.origin===base){if(url.pathname==='/auth.js')return route.fulfill({contentType:'application/javascript',body:"window.BazAuth={name:()=> '검증 담당자',token:()=> 'synthetic-token',withToken:u=>u,currentLevel:async()=>3,cachedLevel:()=>3};"});const file=path.join(root,decodeURIComponent(url.pathname));return route.fulfill({path:file,contentType:/\.html$/.test(file)?'text/html; charset=utf-8':/\.js$/.test(file)?'application/javascript':/\.css$/.test(file)?'text/css':undefined});}
  if(url.hostname==='yuyoung-production.coaptation.workers.dev'){
   const p=JSON.parse(req.postData()||'{}');calls.push(p);
   if(p.action==='work_handover_candidates')return json({success:true,data:[source],total:1});
   if(p.action==='work_handover_detail')return json({success:true,source:p.recordId==='source_wrong_123'?{...source,recordId:p.recordId,hospitalName:'다른 병원'}:source,workDetail:{success:true,request,history:[]}});
   if(p.action==='work_field_result_link'){if(linkFailures-->0)return route.abort();linked=true;return json({success:true,request});}
   if(p.action==='work_document_status')return json(!p.recordId?{success:true,request}:linked?{success:true,request,source,sourceLinked:true}:{success:false,retryable:true,code:'SOURCE_PENDING'});
   if(p.action==='work_document_retry')return json(linked?{success:true,request,source,sourceLinked:true}:{success:false,retryable:true,code:'SOURCE_PENDING'});
   return json({success:true,ok:true,name:'검증 담당자',level:3,data:[]});
  }
  if(url.hostname==='script.google.com'){
   if(url.searchParams.get('action')==='handover_bootstrap')return json({success:true,hospdb:{success:true,data:[]},master:{success:true},contenttpl:{success:true,rows:[]},weeklyauto:{success:true,writers:[]}});
   return json({success:true,data:[],ver:'3.9.0'});
  }
  return route.fulfill({status:200,body:''});
 });
 await page.goto(base+'/inspection.html');await page.getByRole('button',{name:'Handover 기록 연결 변경',exact:true}).waitFor();
 const initial=await page.evaluate(()=>{
  const d={basic:{hospital:'기존 병원',inspectDate:'2026-10-21',serialNo:'OLD'},handover:{recordId:'source_old_123',requestId:'request_old_123'},pdfDocument:{url:'https://drive.google.com/file/d/old/view'},pay:'무상',types:['A/S'],photos:[],signatures:{cs:null,hs:null}};
  applyFormData(d);saveCurrentTask();const id=_currentTaskId;
  document.getElementById('hospital').value='검증 병원';document.getElementById('inspectDate').value='2026-10-22';document.getElementById('serialNo').value='SN1';
  const current=collectFormData();saveCurrentTask();return {id,handover:current.handover,pdf:current.pdfDocument,uuid:BazWorkAPI.id()};
 });
 assert.equal(initial.handover,null);assert.equal(initial.pdf,null);assert.match(initial.uuid,/^[a-f0-9-]{36}$/);checks.push('Identity changes detach old record/PDF; Safari UUID fallback works');
 const isolated=await page.evaluate(async()=>{const box=BazInspectionOutbox.create(indexedDB,BazWorkFlow.sameInspectionIdentity),job={key:'synthetic-owner:old',owner:'synthetic-owner',updatedAt:Date.now(),blob:new Blob(['%PDF-old']),context:{taskId:_currentTaskId,hospital:'이전 병원',date:'2026-10-21',sn:'OLD'}};await box.put(job);const wrong=await box.find(job.owner,{taskId:_currentTaskId,hospital:'검증 병원',date:'2026-10-22',sn:'SN1'}),right=await box.find(job.owner,{taskId:_currentTaskId,hospital:'이전 병원',date:'2026-10-21',sn:'OLD'});await box.remove(job.key);return {wrong:!!wrong,right:!!right};});assert.deepEqual(isolated,{wrong:false,right:true});checks.push('Interrupted PDF recovery checks hospital/date/serial as well as task ID');
 await page.getByRole('button',{name:'Handover 기록 연결 변경',exact:true}).click();
 await page.getByRole('button',{name:'현재 병원의 기록 찾기',exact:true}).click();await page.locator('dialog .work-flow-records button').click();
 await page.locator('#relink-request-id').fill(request.id);await page.getByRole('button',{name:'확인한 기록으로 연결',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#relink-record-id')?.disabled===false);
 await page.getByRole('button',{name:'확인한 기록으로 연결',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
 const bound=await page.evaluate(()=>({ref:handoverReference,data:getTask(_currentTaskId).data}));assert.equal(bound.ref.recordId,source.recordId);assert.equal(bound.ref.requestId,request.id);assert.equal(bound.data.basic.hospital,source.hospitalName);const posts=calls.filter(c=>c.action==='work_field_result_link');assert.equal(posts.length,2);assert.equal(posts[0].operationId,posts[1].operationId);checks.push('Manual preview, exact linking and same-operation recovery after a lost response persist');
 // Duplicating an existing report creates an independent document.
 const duplicate=await page.evaluate(()=>{duplicateTask(_currentTaskId);return loadTasks().at(-1).data;});assert.equal(duplicate.handover,null);assert.equal(duplicate.pdfDocument,null);checks.push('Duplicated reports do not inherit source IDs or PDFs');
 await page.getByRole('button',{name:'Handover 기록 연결 변경',exact:true}).click();await page.getByRole('button',{name:'입력한 기록 조회',exact:true}).click();await page.getByRole('button',{name:'확인한 기록으로 연결',exact:true}).waitFor({state:'visible'});
 await page.screenshot({path:path.join(output,'Handover-수동연결-모바일-검증.png'),fullPage:false});
 await page.locator('#relink-record-id').fill('source_wrong_123');await page.getByRole('button',{name:'입력한 기록 조회',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#relink-record-id')?.disabled===false);assert.match(await page.locator('.inspection-relink [role=status]').textContent(),/현재 내역서와 다릅니다/);
 assert.equal(await page.getByRole('button',{name:'확인한 기록으로 연결',exact:true}).isDisabled(),true);checks.push('A manually entered record for another hospital is refused');
 await page.getByRole('button',{name:'닫기',exact:true}).click();
 await page.goto(base+'/handover.html?request='+request.id);await page.waitForFunction(()=>window.BazHandoverFlow?.context());
 await page.evaluate(()=>{setVal('hosp','검증 병원');setVal('date','2026-10-22');setVal('detail','장비 점검 및 작동 확인');SAVED_RECORD_ID='source_new_123';SAVED_SNAPSHOT=BazHandover.snapshot(readForm());enableCopy(true);});
 assert.equal(await page.locator('#btnCont').isDisabled(),false);checks.push('Confirmed sheet save enables continuation while asynchronous request link is pending');
 await page.locator('#btnCont').click();await page.waitForURL('**/inspection.html*');await page.waitForFunction(()=>typeof handoverReference!=='undefined'&&handoverReference?.recordId==='source_new_123');
 const continued=await page.evaluate(()=>({ref:handoverReference,hospital:v('hospital'),tasks:loadTasks().length}));assert.equal(continued.ref.requestId,request.id);assert.equal(continued.hospital,source.hospitalName);assert.ok(continued.tasks>=3);checks.push('Handover continuation opens a new draft with exact source/request; previous drafts retained');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'handover-browser-verification.json'),JSON.stringify({engine:'WebKit',viewport:{width:390,height:844},checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
}finally{await browser.close();}
