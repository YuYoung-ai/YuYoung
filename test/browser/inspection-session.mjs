import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../../',import.meta.url)),pw=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright')),engine=process.env.PLAYWRIGHT_ENGINE||'webkit';
const browser=await pw[engine].launch({headless:true,channel:engine==='chromium'?'msedge':undefined,executablePath:engine==='webkit'?process.env.PLAYWRIGHT_WEBKIT:undefined}),base='http://localhost:8251',checks=[],errors=[],calls=[];
let releaseUpload,holdUpload=false,holdResolve=false,releaseResolve;
const source=n=>({recordId:'record-new-'+n,hospitalName:'Synthetic hospital '+n,date:'2026-11-19',sn:'SN-'+n,gubun:'점검',detail:'original action '+n,engineer:'Synthetic engineer'});
const pdf=(filename,sha256)=>({fileId:'synthetic-file',url:'https://drive.google.com/file/d/synthetic-file/view',revision:1,bytes:20,filename,sha256});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url()),json=value=>route.fulfill({contentType:'application/json; charset=utf-8',body:JSON.stringify(value)});
  if(u.protocol==='blob:')return route.continue();
  if(u.origin===base){if(u.pathname==='/auth.js')return route.fulfill({contentType:'application/javascript',body:"window.BazAuth={name:()=> 'Synthetic engineer',token:()=> 'synthetic-only-token',withToken:u=>u,currentLevel:async()=>3,cachedLevel:()=>3};"});return route.fulfill({path:path.join(root,u.pathname),contentType:u.pathname.endsWith('.html')?'text/html; charset=utf-8':u.pathname.endsWith('.js')?'application/javascript; charset=utf-8':undefined});}
  if(req.method()==='GET'&&!u.hostname.includes('script.google.com')&&!u.hostname.includes('coaptation.workers.dev'))return route.fulfill({body:''});
  const p=req.postData()?JSON.parse(req.postData()):Object.fromEntries(u.searchParams);calls.push(p);const n=p.recordId?.slice(-1)||'B',s=source(n);
  if(p.action==='work_handover_detail')return json({success:true,source:s,workDetail:{success:true,request:{id:'request-new-'+n},history:[]}});
  if(p.action==='work_document_status')return json({success:true,request:{id:p.requestId||'request-new-'+n},source:s,sourceLinked:true,pdfStored:true,commentAttached:true});
  if(p.action==='inspection_pdf_resolve'){if(holdResolve)await new Promise(r=>releaseResolve=r);const basis=await page.evaluate(({s,format})=>BazInspectionSession.basis(s,format),{s,format:p.pdfFormat});return json({success:true,recordId:s.recordId,pdf:null,sourceBasis:basis});}
  if(p.action==='inspection_pdf_upload'){if(holdUpload)await new Promise(r=>releaseUpload=r);return json({success:true,recordId:p.recordId,pdf:pdf(p.filename,p.sha256)});}
  return json({success:true,data:[],tasks:[],hospdb:{success:true,data:[]},master:{success:true},contenttpl:{success:true,rows:[]},weeklyauto:{success:true,writers:[]}});
 });
 const ready=async()=>page.evaluate(()=>inspectionSessionReady);
 await page.goto(base+'/inspection.html');await ready();
 await page.evaluate(async()=>{applyFormData({basic:{hospital:'Old hospital A',inspectDate:'2026-11-18',serialNo:'SN-A'},handover:{recordId:'record-old-A',requestId:'request-old-A'},photos:[],signatures:{cs:null,hs:null}});await saveCurrentTask({status:'completed'});window.__oldTask=_currentTaskId;const owner=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(BazAuth.token()))),x=>x.toString(16).padStart(2,'0')).join('');await BazInspectionOutbox.create(indexedDB).put({key:owner+':old-upload',owner,updatedAt:Date.now(),blob:new Blob(['%PDF-original-A']),filename:'old-A.pdf',uploadId:'old-upload',sha256:'a'.repeat(64),baseRevision:0,recorded:false,context:{taskId:_currentTaskId,recordId:'record-old-A',requestId:'request-old-A',hospital:'Old hospital A',date:'2026-11-18',sn:'SN-A'},stages:{pdf:'done',drive:'pending'}});});
 const entries=await page.evaluate(()=>['B','C'].map(n=>BazInspectionSession.write(localStorage,BazAuth,{source:'handover',form:{basic:{hospital:'Synthetic hospital '+n,inspectDate:'2026-11-19',serialNo:'SN-'+n,receiveDate:'2026-11-19',actionDetail:'original action '+n},handover:{recordId:'record-new-'+n,requestId:'request-new-'+n},pay:'무상',types:['장비 점검'],pdfFormat:'simplified'}})));
 calls.length=0;await page.goto(base+'/'+entries[0]);await ready();
 const b=await page.evaluate(async()=>({hospital:v('hospital'),ref:handoverReference.recordId,overlay:document.getElementById('doneOverlay').classList.contains('show'),tasks:loadTasks().length,protected:await BazInspectionOutbox.create(indexedDB).protectedTaskIds()}));assert.equal(b.hospital,'Synthetic hospital B');assert.equal(b.ref,'record-new-B');assert.equal(b.overlay,false);assert.ok(b.tasks>=2);assert.equal(b.protected.length,1);assert.equal(calls.some(p=>p.recordId==='record-old-A'),false);checks.push('new B entry never restores/queries old A; original A Blob/upload preserved');
 const tab=await context.newPage();await tab.goto(base+'/'+entries[1]);await tab.evaluate(()=>inspectionSessionReady);assert.equal(await tab.evaluate(()=>v('hospital')),'Synthetic hospital C');assert.equal(await page.evaluate(()=>v('hospital')),'Synthetic hospital B');await tab.close();checks.push('two entry nonces open independent B/C forms');
 // Use the real canvas/jsPDF pipeline as well as the controlled timing fixtures.
 const rendered=await page.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=900;c.height=1200;const x=c.getContext('2d');x.fillStyle='#dae9ff';x.fillRect(0,0,c.width,c.height);x.fillStyle='#123';x.font='48px sans-serif';x.fillText('SYNTHETIC SN-B',40,120);const image=c.toDataURL('image/jpeg',.8);c.width=c.height=0;
  const data=collectFormData();data.pdfFormat='standard';data.basic.csName='Synthetic engineer';data.photos=[{slot:0,data:image,memo:'synthetic photo'}];data.signatures={cs:image,hs:null};applyFormData(data);
  const result=await generatePDF({qrDraft:true});if(!result)throw Error(document.getElementById('pdfGenerationState')?.textContent||'QR render failed');window.__realPdf=Array.from(new Uint8Array(await result.blob.arrayBuffer()));
  return {bytes:result.blob.size,header:await result.blob.slice(0,4).text(),slots:result.placements.length,photos:result.captured.photos.length};
 });assert.equal(rendered.header,'%PDF');assert.ok(rendered.bytes>10000);assert.ok(rendered.slots>=1);assert.equal(rendered.photos,1);checks.push('real standard PDF, photo page, serialized signature and QR placements render successfully');
 if(process.env.OUTPUT_DIR){fs.mkdirSync(process.env.OUTPUT_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.OUTPUT_DIR,engine+'-synthetic-render.pdf'),Buffer.from(await page.evaluate(()=>window.__realPdf)));}
 const localModes=await page.evaluate(async()=>{
  const open=window.open,download=downloadPdfBlob;let preview=false,blank=false;
  window.open=url=>{preview=String(url).startsWith('blob:');return null;};downloadPdfBlob=(blob,name)=>{blank=blob.size>10000&&name.includes('수기양식');};
  try{await generatePDF({preview:true});await generatePDF({blank:true});return {preview,blank};}finally{window.open=open;downloadPdfBlob=download;}
 });assert.deepEqual(localModes,{preview:true,blank:true});checks.push('real preview and blank form generation remain available');
 // A delayed original transfer may finish after selecting a new task.
 holdUpload=true;
 await page.evaluate(()=>{window.__originalTask=_currentTaskId;window.__originalTransfer=pdfPublisher.publish(new Blob(['%PDF-B-old-transfer']),'old-B.pdf',{...inspectionContext(),sourcePrepared:true});});
 await page.waitForFunction(()=>pdfPublisher.isBusy());while(!releaseUpload)await new Promise(r=>setTimeout(r,10));
 await page.evaluate(async()=>{if(!await newTask())throw Error('new task blocked by another transfer');applyFormData({basic:{hospital:'New hospital D',inspectDate:'2026-11-19',serialNo:'SN-D'},photos:[],signatures:{cs:null,hs:null}});await saveCurrentTask();});
 holdUpload=false;releaseUpload();await page.evaluate(()=>window.__originalTransfer);
 const late=await page.evaluate(async()=>({hospital:v('hospital'),ref:handoverReference,overlay:document.getElementById('doneOverlay').classList.contains('show'),old:(await draftRepository.get(window.__originalTask)).data.pdfDocument?.filename}));assert.equal(late.hospital,'New hospital D');assert.equal(late.ref,null);assert.equal(late.overlay,false);assert.equal(late.old,'old-B.pdf');checks.push('late B response updates only original B task; D editable and no old popup');
 // Failed explicit entry must not display the previously selected hospital.
 await page.goto(base+'/inspection.html?entry=00000000000000000000000000000000');await page.evaluate(()=>inspectionSessionReady.catch(()=>{}));assert.equal(await page.evaluate(()=>inspectionPhase),'error');assert.equal(await page.evaluate(()=>v('hospital')),'');assert.equal(await page.locator('.wrap').evaluate(el=>el.inert),true);checks.push('missing explicit entry fails closed without restoring previous hospital');
 // Server source resolution is deliberately held after the local render.
 const next=await page.evaluate(()=>BazInspectionSession.write(localStorage,BazAuth,{source:'handover',form:{basic:{hospital:'Synthetic hospital B',inspectDate:'2026-11-19',serialNo:'SN-B',receiveDate:'2026-11-19',actionDetail:'frozen action'},handover:{recordId:'record-new-B',requestId:'request-new-B'},pay:'무상',types:['장비 점검'],pdfFormat:'simplified'}}));await page.goto(base+'/'+next);await ready();holdResolve=true;
 await page.evaluate(()=>{
  window.__bodyCount=0;window.__releaseLibrary=null;window.__libraryWaiting=false;
  BazInspectionPdf.libraries=async()=>{window.__libraryWaiting=true;await new Promise(r=>window.__releaseLibrary=r);};
  BazInspectionPdf.body=async html=>{window.__bodyCount++;window.__frozenHtml=html;return [];};
  BazInspectionPdf.assemble=async()=>({blob:new Blob(['%PDF-local-generated']),pdf:null,passes:1});
  window.__generation=generatePDF(false);window.__duplicate=generatePDF(false);window.__samePromise=window.__generation===window.__duplicate;
 });await page.waitForFunction(()=>window.__libraryWaiting);
 await page.evaluate(()=>{document.getElementById('actionDetail').value='edited during render';window.__releaseLibrary();});await page.evaluate(()=>window.__generation);
 assert.equal(await page.evaluate(()=>window.__samePromise),true);assert.equal(await page.evaluate(()=>window.__bodyCount),1);assert.equal(await page.evaluate(()=>window.__frozenHtml.includes('frozen action')&&!window.__frozenHtml.includes('edited during render')),true);assert.equal(await page.locator('#doneOverlay').evaluate(el=>el.classList.contains('show')),true);assert.match(await page.locator('#doneFname').textContent(),/Synthetic hospital B/);checks.push('one frozen render per repeated click; local PDF completes while source server waits');
 while(!releaseResolve)await new Promise(r=>setTimeout(r,10));holdResolve=false;releaseResolve();await page.waitForFunction(()=>!pdfPublisher.isBusy());assert.equal(await page.locator('#doneTitle').textContent(),'점검 내역서 저장 완료');checks.push('validated source resumes upload/comments after local generation');
 // A local repository failure offers a separate PDF path and keeps the form.
 await page.evaluate(()=>{document.getElementById('doneOverlay').classList.remove('show');window.__realSave=draftRepository.save;draftRepository.save=async()=>{throw new DOMException('synthetic quota','QuotaExceededError');};});await page.evaluate(()=>generatePDF(false));assert.match(await page.locator('#pdfGenerationState').textContent(),/초안을 기기에 보관하지 못/);assert.equal(await page.getByRole('button',{name:'PDF만 별도 생성·보관',exact:true}).count(),1);assert.equal(await page.evaluate(()=>v('hospital')),'Synthetic hospital B');checks.push('quota failure preserves form with explicit local-only PDF option');
 const uploadsBefore=calls.filter(p=>p.action==='inspection_pdf_upload').length;
 await page.evaluate(async()=>{BazInspectionPdf.libraries=async()=>{};downloadPdfBlob=()=>{window.__localDownloaded=true;};await generatePDF({localOnly:true});});assert.equal(await page.evaluate(()=>window.__localDownloaded),true);assert.equal(calls.filter(p=>p.action==='inspection_pdf_upload').length,uploadsBefore);assert.match(await page.locator('#pdfGenerationState').textContent(),/PDF만 생성/);checks.push('local-only fallback downloads while repository is unavailable and does not upload');
 await page.evaluate(async()=>{state.pay='';goStep(4,{noScroll:true});await generatePDF(false);});assert.equal(await page.evaluate(()=>_step),1);assert.equal(await page.locator('#payGroup').evaluate(el=>el.classList.contains('field-invalid')),true);checks.push('missing required input reveals its step and persistent validation status');
 assert.deepEqual(errors,[]);
 if(process.env.OUTPUT_DIR){fs.mkdirSync(process.env.OUTPUT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.OUTPUT_DIR,engine+'-session.png')});fs.writeFileSync(path.join(process.env.OUTPUT_DIR,engine+'-session.json'),JSON.stringify({engine,syntheticOnly:true,checks,errors},null,2));}
 console.log(JSON.stringify({engine,checks,errors}));
}finally{await browser.close();}
