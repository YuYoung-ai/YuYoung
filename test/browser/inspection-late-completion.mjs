import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../../',import.meta.url)),playwright=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright');
const engine=process.env.PLAYWRIGHT_ENGINE||'webkit',browser=await playwright[engine].launch({headless:true,channel:engine==='chromium'?'msedge':undefined}),base='http://localhost:8238';
try{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let pdf=null,uploads=0,repairs=0,attached=false,hold=false,reads=0;
 const source={recordId:'synthetic-record',hospitalName:'합성 복구 검증 병원',date:'2026-11-10',sn:'SYNTHETIC',gubun:'점검'},request={id:'synthetic-request',hospitalName:source.hospitalName};
 const status=()=>({success:true,request,source,sourceLinked:true,pdfStored:!!pdf,commentAttached:attached});
 await page.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url()),json=value=>route.fulfill({contentType:'application/json; charset=utf-8',body:JSON.stringify(value)});
  if(u.origin===base){if(u.pathname==='/auth.js')return route.fulfill({contentType:'application/javascript; charset=utf-8',body:"window.BazAuth={name:()=> '합성 담당자',token:()=> 'synthetic-test-token',withToken:u=>u,currentLevel:async()=>3,cachedLevel:()=>3};"});return route.fulfill({path:path.join(root,u.pathname),contentType:u.pathname.endsWith('.html')?'text/html; charset=utf-8':u.pathname.endsWith('.js')?'application/javascript; charset=utf-8':undefined});}
  const p=req.postData()?JSON.parse(req.postData()):Object.fromEntries(u.searchParams);
  if(u.hostname==='script.google.com'){
   if(p.action==='inspection_pdf_upload'){uploads++;pdf={fileId:'synthetic-pdf',url:'https://drive.google.com/file/d/synthetic-pdf/view',filename:p.filename,sha256:p.sha256,bytes:p.bytes,revision:1};return route.abort();}
   if(p.action==='inspection_pdf_resolve'){reads++;return json({success:true,recordId:source.recordId,pdf,sourceBasis:{v:1,recordId:source.recordId}});}
   return json({success:true,data:[],hospdb:{success:true,data:[]},master:{success:true},contenttpl:{success:true,rows:[]},weeklyauto:{success:true,writers:[]}});
  }
  if(p.action==='work_document_status')return json(status());
  if(p.action==='work_document_retry'){repairs++;if(!hold&&repairs>=2)attached=true;return json(status());}
  if(p.action==='work_handover_detail')return json({success:true,source:{...source,pdf}});
  return json({success:true,data:[]});
 });
 await page.goto(base+'/inspection.html');await page.evaluate(async()=>{await inspectionStorageReady;await window.inspectionWorkflowReady;applyFormData({basic:{hospital:'합성 복구 검증 병원',inspectDate:'2026-11-10',serialNo:'SYNTHETIC'},photos:[],signatures:{cs:null,hs:null}});await saveCurrentTask();const basis=await pdfPublisher.prepare({hospital:v('hospital'),date:v('inspectDate'),sn:v('serialNo'),recordId:'synthetic-record',requestId:'synthetic-request',taskId:_currentTaskId});document.getElementById('doneOverlay').classList.add('show');await pdfPublisher.publish(new Blob(['%PDF-synthetic-delayed']),'synthetic.pdf',basis);});
 assert.equal(uploads,1);assert.ok(reads>=2);assert.equal(attached,true);assert.equal(await page.locator('#doneTitle').textContent(),'점검 내역서 저장 완료');assert.match(await page.locator('#pdfUploadStatus').textContent(),/댓글 첨부 완료/);
 const saved=await page.evaluate(()=>getTask(_currentTaskId).data.pdfDocument);assert.equal(saved.sha256,pdf.sha256);
 // Keep a saved-file attachment job pending, then verify automatic resume on reload.
 hold=true;attached=false;await page.evaluate(async()=>{await pdfPublisher.resume({success:true,recordId:handoverReference.recordId,pdf:uploadedPdfDocument},{...handoverReference,hospital:v('hospital'),date:v('inspectDate'),sn:v('serialNo'),taskId:_currentTaskId});});
 assert.match(await page.locator('#doneTitle').textContent(),/댓글 연결 확인 필요/);assert.equal(uploads,1);
 hold=false;attached=true;await page.reload();await page.waitForFunction(()=>document.getElementById('doneTitle')?.textContent==='점검 내역서 저장 완료');assert.equal(uploads,1,'reopening a pending saved file never uploads bytes');assert.equal(await page.locator('#doneOverlay').evaluate(el=>el.classList.contains('show')),true);
 if(process.env.OUTPUT_DIR){fs.mkdirSync(process.env.OUTPUT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.OUTPUT_DIR,'지연저장-댓글복구-완료.png')});}
 assert.deepEqual(errors,[]);console.log(JSON.stringify({engine,uploads,reads,repairs,autoRestored:true,errors}));
}finally{await browser.close();}
