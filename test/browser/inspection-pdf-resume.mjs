import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const {webkit,devices}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
 ?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright');
const root=fileURLToPath(new URL('../../',import.meta.url));
const base='http://localhost:8256';
const baseline=process.env.INSPECTION_BASELINE;
const changed=baseline?new Set(execFileSync('git',['diff','--name-only',baseline],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/)) :new Set();
const versions=new Map([...changed].filter(file=>!file.startsWith('test/')).map(file=>[file,execFileSync('git',['show',baseline+':'+file],{cwd:root})]));
const request={id:'request_render_resume',hospitalName:'합성 시험 병원',sn:'BWA101',engineer:'시험 담당자',
 registeredAt:'2026-11-26T10:00',visitAt:'2026-11-27T11:00',gubun:'점검',revision:1};
const serials=['BWA101','BX102'];
const identityPath=base+'/handover-inspection.html?request='+request.id;
const donePath=base+'/hospital-work.html?request='+request.id;
const media={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'};
const browser=await webkit.launch({headless:true,executablePath:process.env.PLAYWRIGHT_WEBKIT});

async function run(count,{before=false,fail=false,loseJournal=false,reloadDuringRender=false}={}){
 const context=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'});
 const rows=new Map(),links=new Set(),jobs=new Map(),comments=new Set();
 const writes=[],linkWrites=[],driveCreates=[],bodyMs=[],resumes=[];
 let allowComment=!fail,stalledDisposals=0,stalledRenders=0,page;
 const target=serials[count-1];
 const finishComment=job=>{
  if(job.commentAttached)return job;
  assert.ok(!comments.has(job.recordId),'each device creates one attachment comment');
  comments.add(job.recordId);
  return {...job,state:'complete',commentAttached:true};
 };
 try{
  await context.exposeFunction('recordPdfBody',ms=>bodyMs.push(ms));
  await context.exposeFunction('recordStalledRender',()=>{stalledRenders++;});
  await context.exposeFunction('recordStalledDisposal',()=>{stalledDisposals++;});
  await context.route(/^https?:\/\//,async route=>{
   const req=route.request(),url=new URL(req.url());
   const json=value=>route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':base},body:JSON.stringify(value)});
   if(url.origin===base){
    if(url.pathname==='/hospital-work.html')return route.fulfill({contentType:media['.html'],body:'<main>CS 서비스 현황</main>'});
    if(url.pathname==='/auth.js')return route.fulfill({contentType:media['.js'],
     body:"window.BazAuth={name:()=> '시험 담당자',token:()=> 'synthetic-token',withToken:u=>u,currentLevel:async()=>3,cachedLevel:()=>3};"});
    const name=decodeURIComponent(url.pathname.slice(1)),file=path.join(root,name);
    if(!file.startsWith(root)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404});
    const contentType=media[path.extname(file)];
    return before&&versions.has(name)?route.fulfill({contentType,body:versions.get(name)}):route.fulfill({contentType,path:file});
   }
   const p=JSON.parse(req.postData()||'{}');
   if(url.hostname==='script.google.com'){
    if(url.searchParams.get('action')==='savecheck'){
     const reqId=url.searchParams.get('reqId'),row=rows.get(reqId);
     return json({success:true,reqId,found:!!row,result:row?.response});
    }
    if(p.action==='inspection_pdf_job_source')return json({success:true,receipt:rows.get(p.recordId)?.receipt});
    if(p.action==='inspection_pdf_job_status'||p.action==='inspection_pdf_job_lookup'){
     const job=p.uploadId?jobs.get(p.uploadId):[...jobs.values()].find(job=>job.recordId===p.recordId);
     return json(job||{success:true,state:'missing'});
    }
    if(p.action==='inspection_pdf_job_resume'){
     assert.equal(p.base64,undefined);
     let job=jobs.get(p.uploadId);
     assert.ok(job,'resume uses the original PDF job');
     resumes.push(p.uploadId);
     if(allowComment||rows.get(job.recordId).source.sn!==target)job=finishComment(job);
     jobs.set(p.uploadId,job);
     return json(job);
    }
    if(p.action==='inspection_pdf_job_submit'){
     assert.ok(links.has(p.recordId));
     assert.equal(p.requestId,request.id);
     assert.equal(p.sn,rows.get(p.recordId).source.sn);
     assert.equal(p.sourceVersion,rows.get(p.recordId).receipt.version);
     const document=Buffer.from(p.base64,'base64').toString('latin1');
     assert.match(document,/^%PDF/);
     assert.ok((document.match(/\/Type \/Page\b/g)||[]).length>=2,'includes the body and a separate photo page');
     assert.ok(!jobs.has(p.uploadId)&&!driveCreates.includes(p.recordId),'each device creates one Drive file');
     driveCreates.push(p.recordId);
     let job={success:true,state:'handover',received:true,commentAttached:false,jobId:p.uploadId,
      recordId:p.recordId,requestId:p.requestId,sha256:p.sha256,bytes:p.bytes,filename:p.filename,pdf:{
       uploadId:p.uploadId,fileId:p.recordId,url:'https://drive.google.com/file/d/'+p.recordId+'/view',
       filename:p.filename,revision:1,sha256:p.sha256,bytes:p.bytes}};
     if(allowComment||p.sn!==target)job=finishComment(job);
     jobs.set(p.uploadId,job);
     return json(job);
    }
    if(p.reqId){
     assert.ok(!rows.has(p.reqId),'retry must not submit the same Sheet record');
     writes.push(p.reqId);
     const source={recordId:p.reqId,hospitalName:request.hospitalName,date:p.date,sn:p.sn,engineer:request.engineer,
      gubun:p.gubun,detail:p.detail,cat:p.cat,type:p.type,part:p.part,result:p.result,version:'source-'+p.sn};
     const receipt={recordId:p.reqId,source,version:'sheet-'+p.sn,pdfRevision:0,basis:Object.fromEntries(
      ['standard','simplified'].map(format=>[format,{format,fingerprint:'a'.repeat(64)}]))};
     const response={success:true,row:rows.size+2,recordId:p.reqId,inspectionReceipt:receipt};
     rows.set(p.reqId,{source,receipt,response});
     return json(response);
    }
    return json({success:true,data:[],hospdb:{success:true,data:[]},master:{success:true,parts:['내부 세척']},parts:['내부 세척']});
   }
   if(url.hostname==='yuyoung-production.coaptation.workers.dev'){
    if(p.action==='work_inspection_source_link'){
     assert.equal(p.sheetVersion,rows.get(p.recordId).receipt.version);
     assert.ok(!links.has(p.recordId),'a confirmed link is not written again');
     links.add(p.recordId);linkWrites.push(p.recordId);
     return json({success:true,request,recordId:p.recordId,sourceLinked:true});
    }
    if(p.action==='work_document_status'||p.action==='work_handover_detail'){
     const row=rows.get(p.recordId),job=[...jobs.values()].find(job=>job.recordId===p.recordId);
     const source=row?{...row.source,...(job?{pdf:job.pdf}:{})}:undefined;
     return json({success:true,request,source,pdfStored:!!job,commentAttached:!!job?.commentAttached,sourceLinked:links.has(p.recordId),
      workDetail:{request,history:[]},records:[...links].map(recordId=>rows.get(recordId).source)});
    }
   }
   return json({success:true,data:[]});
  });
  page=await context.newPage();
  page.setDefaultTimeout(12000);
  await page.goto(identityPath);
  const form=page.frameLocator('#inspectionForm');
  const frame=()=>page.frames().find(f=>f.url().includes('inspection.html?combined='));
  const ready=async()=>{await form.locator('#combinedDevices').waitFor();assert.equal((await frame().evaluate(()=>inspectionSessionReady)).success,true);};
  const observe=async({stall=false,shorten=true}={})=>frame().evaluate(({stall,shorten,serial})=>{
   const original=BazPerf.start;
   BazPerf.start=(name,at)=>{
    const started=at??performance.now(),finish=original(name,at);
    return extra=>{if(name==='pdf_body'||name==='pdf_body_prefetch')window.recordPdfBody(performance.now()-started);return finish(extra);};
   };
   if(!stall)return;
   const schedule=window.setTimeout.bind(window),render=BazInspectionPdf.renderPage;
   let stalledDeadline=false;
   window.setTimeout=(fn,ms,...args)=>{
    if(stalledDeadline&&(ms===45000||ms===8000)){
     stalledDeadline=false;
     if(shorten)ms=120;
    }
    return schedule(fn,ms,...args);
   };
   BazInspectionPdf.renderPage=(node,config,cloned)=>{
    if(!node.textContent.includes(serial))return render(node,config,cloned);
    window.pdfTestStallStarted=true;
    stalledDeadline=true;
    window.recordStalledRender();
    return {pending:new Promise(()=>{}),dispose(){window.recordStalledDisposal();}};
   };
  },{stall,shorten,serial:target});
  const fill=serial=>frame().evaluate(serial=>{
   const value=(id,text)=>document.getElementById(id).value=text;
   value('serialNo',serial);value('actionDetail','정기 점검 완료 '+serial);value('product','CUREJET');
   value('hospitalName','합성 서명 담당자');
   state.pay='무상';state.types=['장비 점검'];state.results[1]='정상';
   const image=document.createElement('canvas');image.width=480;image.height=300;
   const pen=image.getContext('2d');pen.fillStyle='#fff';pen.fillRect(0,0,480,300);
   pen.fillStyle='#345887';pen.font='28px sans-serif';pen.fillText('Synthetic '+serial,18,80);
   pen.fillText('Demo signature',18,130);
   sigStore.cs=image.toDataURL('image/png');sigStore.hs=sigStore.cs;
   const photo=image.toDataURL('image/jpeg',.8);
   state.photos=BazInspectionPdf.PHOTO_ORDER.map(slot=>({slot,data:photo,memo:'합성 사진 '+slot,width:480,height:300}));
   image.width=image.height=0;
  },serial);
  const start=()=>form.locator('#generateBtn').evaluate(button=>{button.click();button.click();});
  await ready();
  await fill(serials[0]);
  if(count===2){
   await form.getByRole('button',{name:'+ 장비 추가'}).click();
   await form.locator('[data-device-slot="1"][aria-pressed="true"]').waitFor();
   await fill(serials[1]);
  }
  await observe({stall:fail,shorten:!reloadDuringRender});
  const started=performance.now();
  if(!fail){
   await Promise.all([page.waitForURL(donePath),start()]);
   assert.equal(writes.length,count);assert.equal(linkWrites.length,count);
   assert.equal(driveCreates.length,count);assert.equal(comments.size,count);
   const total=performance.now()-started;
   assert.equal(bodyMs.length,count);
   return {count,bodyMs,elapsedMs:total};
  }

  await start();
  if(reloadDuringRender){
   await frame().waitForFunction(()=>window.pdfTestStallStarted);
   await page.reload();
   await ready();
  }else{
   const failedState=count===2?form.locator('[data-device-slot="1"]'):form.locator('#pdfGenerationState');
   await failedState.filter({hasText:'시트 기록·접수 연결 완료 · PDF 발행 재시도'}).waitFor();
   await frame().waitForFunction(()=>!_pdfStarting&&!combinedDeviceBusy);
   assert.ok(stalledRenders>=2&&stalledDisposals>=2);
   assert.equal(writes.length,count);
   assert.equal(driveCreates.length,count-1);
   if(loseJournal)await frame().evaluate(()=>{
    const key='baz_handover_inspection_v1:'+_storageIdentity+':'+combinedRequest;
    localStorage.removeItem(key);
   });
   await page.reload();
   await ready();
  }
  if(!reloadDuringRender)await start();
  await frame().waitForFunction(()=>Boolean(handoverReference?.recordId));
  await form.getByText(/같은 PDF의 연결을 계속|이어서 진행 필요/).first().waitFor({state:'attached'});
  assert.equal(driveCreates.length,count);
  assert.equal(comments.size,count-1);
  await page.reload();
  await ready();
  allowComment=true;
 if(page.url()===identityPath)await Promise.all([page.waitForURL(donePath),start().catch(error=>{
  if(!/Frame was detached|Execution context was destroyed/.test(error.message))throw error;
 })]);
  assert.equal(rows.size,count);assert.equal(writes.length,count);assert.equal(linkWrites.length,count);
  assert.equal(driveCreates.length,count);assert.equal(comments.size,count);
  assert.ok(resumes.length>=1);
  return {count,sheetWrites:writes.length,driveFiles:driveCreates.length,comments:comments.size,stalledRenders,stalledDisposals,loseJournal,reloadDuringRender};
 }catch(error){
  const state=await page?.frames().find(frame=>frame.url().includes('inspection.html?combined='))?.evaluate(()=>({
   messages:['pdfGenerationState','pdfUploadStatus','combinedDevices','loadingMsg'].map(id=>document.getElementById(id)?.textContent),
   entry:combinedFlow?.entry(_currentTaskId)?.state,
   recordId:handoverReference?.recordId,active:combinedFlow?.batchActive(),locked:_pdfBusy||_pdfStarting
  })).catch(()=>null);
  console.error({count,before,fail,loseJournal,reloadDuringRender,writes:writes.length,links:linkWrites.length,drive:driveCreates.length,comments:comments.size,stalledRenders,state});
  throw error;
 }finally{await context.close();}
}

try{
 if(baseline){
  const rows=[];
  for(const count of [1,2])for(let repeat=0;repeat<3;repeat++){
   rows.push({version:'before',...await run(count,{before:true})});
   rows.push({version:'after',...await run(count)});
  }
  console.log(JSON.stringify({timings:rows}));
 }
 if(!process.argv.includes('--timing-only')){
  for(const scenario of [[1,{fail:true,loseJournal:true}],[2,{fail:true}],[2,{fail:true,reloadDuringRender:true}]]){
   console.log(JSON.stringify(await run(...scenario)));
  }
 }
}finally{await browser.close();}
