import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const pw=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright');
const engine=process.env.PLAYWRIGHT_ENGINE||'webkit';
const browser=await pw[engine].launch({headless:true,
  executablePath:engine==='webkit'?process.env.PLAYWRIGHT_WEBKIT:undefined,
  channel:engine==='chromium'?'chrome':undefined});
const root=fileURLToPath(new URL('../../',import.meta.url));
const baseFiles=fileURLToPath(new URL('../../../delivery-v2/',import.meta.url));
const base='http://localhost:8256';
const request={id:'request_combined_multiple',hospitalName:'합성 병원',sn:'BWA101',engineer:'검증 담당자',
  registeredAt:'2026-11-19T09:00',visitAt:'2026-11-20T12:00',gubun:'점검',revision:1};
const reopen=process.env.COMBINED_TEST_REOPEN==='1';
const reconnect=process.env.COMBINED_TEST_RECONNECT==='1';
const twoDevices=reopen||reconnect;
const serials=twoDevices?['BWA101','BX102']:['BWA101','BX102','BW103'];
const rows=new Map(),links=new Set(),jobs=new Map(),uploads=[],resumes=[],renders=[];
const sheetRequests=[],linkRequests=[],saveChecks=[];
let startFirstUpload,releaseFirstResponse,releaseFirstLink,finishFirstRender;
const firstUploadStarted=new Promise(resolve=>{startFirstUpload=resolve;});
const firstResponseGate=new Promise(resolve=>{releaseFirstResponse=resolve;});
const firstLinkGate=new Promise(resolve=>{releaseFirstLink=resolve;});
const firstRenderReady=new Promise(resolve=>{finishFirstRender=resolve;});
let allowSecondComment=false;
const media={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css'};

try{
  const context=await browser.newContext({...pw.devices['iPhone 13'],serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    const json=(value,headers={})=>route.fulfill({status:200,contentType:'application/json',
      headers:{'access-control-allow-origin':base,...headers},body:JSON.stringify(value)});
    if(url.origin===base){
      if(url.pathname==='/hospital-work.html')return route.fulfill({contentType:media['.html'],body:'<main>CS 서비스 현황</main>'});
      if(url.pathname==='/auth.js')return route.fulfill({contentType:media['.js'],
        body:"window.BazAuth={name:()=> '검증 담당자',token:()=> 'synthetic-token',withToken:u=>u,currentLevel:async()=>3,cachedLevel:()=>3};"});
      const file=[root,baseFiles].map(dir=>path.join(dir,decodeURIComponent(url.pathname))).find(name=>fs.existsSync(name)&&fs.statSync(name).isFile());
      return file?route.fulfill({path:file,contentType:media[path.extname(file)]}):route.fulfill({status:404,body:''});
    }
    const p=JSON.parse(req.postData()||'{}');
    if(url.hostname==='script.google.com'&&url.searchParams.get('action')==='hospdbrich')
      return json({success:true,data:serials.map((sn,index)=>({name:request.hospitalName,sn,ncare:'구독 '+(index+1)}))});
    if(url.hostname==='script.google.com'&&url.searchParams.get('action')==='savecheck'){
      const reqId=url.searchParams.get('reqId'),row=rows.get(reqId);
      saveChecks.push(reqId);
      return json({success:true,reqId,found:!!row,result:row?.response});
    }
    if(url.hostname==='script.google.com'&&req.method()==='POST'){
      if(p.action==='inspection_pdf_job_source')return json({success:true,receipt:rows.get(p.recordId)?.receipt});
      if(p.action==='inspection_pdf_job_lookup')return json({success:true,state:'missing'});
      if(p.action==='inspection_pdf_job_submit'){
        const row=rows.get(p.recordId);
        assert.ok(links.has(p.recordId));assert.equal(p.requestId,request.id);
        assert.equal(p.sn,row.source.sn);assert.equal(p.sourceVersion,row.receipt.version);
        assert.match(p.filename,new RegExp('_'+p.sn+'_'));
        assert.match(Buffer.from(p.base64,'base64').toString(),new RegExp(row.source.sn+' '+row.source.sn+'-photo'));
        assert.equal(jobs.has(p.uploadId),false);
        uploads.push(p);
        const complete=p.sn===serials[2];
        const job={success:true,state:complete?'complete':'handover',jobId:p.uploadId,filename:p.filename,bytes:p.bytes,
          sha256:p.sha256,recordId:p.recordId,requestId:p.requestId,received:true,commentAttached:complete,
          message:complete?'':'합성 댓글 연결 지연',pdf:{url:'https://drive.google.com/file/d/'+p.recordId+'/view',
            uploadId:p.uploadId,filename:p.filename,revision:1,sha256:p.sha256}};
        jobs.set(p.uploadId,job);
        if(p.sn===serials[0]){
          startFirstUpload();
          await firstResponseGate;
          // Drive accepted the file, but the iPhone never received the reply.
          return route.abort('failed');
        }
        return json(job);
      }
      if(p.action==='inspection_pdf_job_status')return json(jobs.get(p.uploadId)||{success:true,state:'missing'});
      if(p.action==='inspection_pdf_job_resume'){
        assert.equal(p.base64,undefined);
        const prior=jobs.get(p.uploadId);resumes.push(p.uploadId);
        assert.ok(uploads.slice(0,2).some(upload=>upload.recordId===prior.recordId));
        const result=prior.recordId===uploads[0].recordId||allowSecondComment&&prior.recordId===uploads[1].recordId
          ?{...prior,state:'complete',commentAttached:true,message:''}:prior;
        jobs.set(p.uploadId,result);return json(result);
      }
      if(p.reqId){
        assert.equal(url.searchParams.get('inspectionBatch'),'1');
        sheetRequests.push({id:p.reqId,sn:p.sn});
        if(p.sn===serials[1]&&sheetRequests.filter(item=>item.sn===p.sn).length===1){
          await firstUploadStarted;
          return json({success:false,code:'LOCK_BUSY',retryable:true,error:'합성 Apps Script 잠금 사용 중'});
        }
        assert.equal(rows.has(p.reqId),false,'a device retry must not write its sheet row again');
        assert.equal(p.hosp,request.hospitalName);assert.equal(p.date,'2026-11-20');
        assert.equal(p.detail,'조치 '+p.sn);assert.equal(p.hpOut,p.sn+'-HP');
        assert.equal(p.nozzleReuse,'O');assert.equal(p.nsFill,'O');
        assert.equal(p.nsAmt,'정상');assert.equal(p.jet,'가능');
        const source={recordId:p.reqId,hospitalName:p.hosp,sn:p.sn,date:p.date,engineer:p.fse,gubun:p.gubun,
          detail:p.detail,result:p.result,version:'source-'+p.sn};
        const receipt={recordId:source.recordId,source,version:'sheet-'+p.sn,pdfRevision:0,basis:Object.fromEntries(
          ['standard','simplified'].map(format=>[format,{format,fingerprint:'a'.repeat(64)}]))};
        const response={success:true,row:rows.size+2,recordId:p.reqId,inspectionReceipt:receipt};
        rows.set(p.reqId,{source,receipt,response});
        if(p.sn===serials[1])return route.abort('failed');
        return json(response);
      }
    }
    if(url.hostname==='yuyoung-production.coaptation.workers.dev'){
      const row=rows.get(p.recordId),linked=links.has(p.recordId);
      let source=row?.source,pdfStored=false,commentAttached=false;
      if(p.action==='work_document_status'&&uploads.length===serials.length&&p.recordId===uploads[0].recordId){
        const id=uploads[0].uploadId,job=jobs.get(id);
        // The first PDF finished on the server while the browser continued with other devices.
        jobs.set(id,{...job,state:'complete',commentAttached:true,message:''});
        source={...source,pdf:job.pdf};
        pdfStored=commentAttached=true;
      }
      if(p.action==='work_document_status'&&uploads.length===serials.length&&p.recordId===uploads[1].recordId){
        // A different upload for the same record is not proof that this attempt completed.
        source={...source,pdf:{...jobs.get(uploads[1].uploadId).pdf,uploadId:'different-upload'}};
        pdfStored=commentAttached=true;
      }
      if(p.action==='work_document_status'||p.action==='work_document_retry')return json({success:true,request,
        source,pdfStored,commentAttached,sourceLinked:linked,records:[...links].map(id=>{
          const source=rows.get(id).source;return {recordId:id,sn:source.sn,date:source.date};
        })});
      if(p.action==='work_handover_detail')return json({success:true,source:row?.source,workDetail:{request,history:[]}});
      if(p.action==='work_inspection_source_link'){
        assert.equal(p.requestId,request.id);assert.equal(p.sheetVersion,row.receipt.version);
        linkRequests.push(p.recordId);
        if(row.source.sn===serials[0])await firstLinkGate;
        links.add(p.recordId);return json({success:true,request,recordId:p.recordId,sourceLinked:true},{
          'access-control-expose-headers':'Server-Timing','server-timing':'work;dur=210, gas;dur=160'
        });
      }
    }
    return json({success:true,data:[]});
  });

  const address=base+'/handover-inspection.html?request='+request.id;
  await page.goto(address);
  const form=page.frameLocator('#inspectionForm');
  const frame=()=>page.frames().find(f=>f.url().includes('inspection.html?combined='));
  await page.exposeFunction('recordFixturePdf',value=>{
    renders.push(value);
    if(value.serial===serials[0])finishFirstRender();
  });
  async function ready(){
    await form.locator('#combinedDevices').waitFor({state:'visible'});
    const status=await frame().evaluate(()=>inspectionSessionReady);
    assert.equal(status.success,true);
    await frame().evaluate(()=>{
      BazInspectionPdf.libraries=async()=>{};
      BazInspectionPdf.body=async html=>[html];
      BazInspectionPdf.assemble=async([html],photos)=>{
        const serial=document.getElementById('serialNo').value.trim();
        if(!html.includes(serial))throw new Error('wrong serial in printed body');
        if(html.includes('권고 사항'))throw new Error('recommendation row must be omitted from the combined PDF');
        const note=photos.map(photo=>photo.memo).join(',');
        const subscription=document.getElementById('subscription').value;
        if(!html.includes(subscription))throw new Error('missing subscription in printed body');
        await window.recordFixturePdf({serial,note,subscription});
        return {blob:new Blob(['%PDF-1.7 '+serial+' '+note]),pdf:null,passes:1};
      };
    });
  }
  async function fill(serial){
    await frame().evaluate(value=>{
      document.getElementById('serialNo').value=value;
      document.getElementById('actionDetail').value='조치 '+value;
      document.getElementById('combined-hpOut').value=value+'-HP';
      document.getElementById('combined-nozzleReuse').value='O';
      document.getElementById('combined-nsFill').value='O';
      document.getElementById('combined-nsAmt').value='정상';
      document.getElementById('combined-jet').value='가능';
      document.getElementById('pdfFormat').value='simplified';
      state.results[1]='정상';
      state.photos=[{slot:'sn',memo:value+'-photo',
        data:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}];
    },serial);
  }
  const panel=form.locator('#combinedDevices');
  const add=panel.getByRole('button',{name:'+ 장비 추가'});
  const publish=form.locator('#generateBtn');
  const device=index=>panel.locator('[data-device-slot="'+index+'"]');
  await ready();
  await form.locator('#inspectDate').fill('2026-11-20');
  await form.locator('#product').selectOption('CUREJET');
  await form.locator('#version').fill('2.1.1 / 2.6');
  assert.equal(await form.locator('#recommend').isVisible(),false);
  assert.deepEqual(await form.locator('#actionCard .combined-extra-fields [data-handover-field]').evaluateAll(fields=>fields.map(field=>field.dataset.handoverField)),
    ['hpOut','wVer','hpIn','uVer','nozzleDate','nozzleReuse','nsFill','nsAmt','jet']);
  const bulk=form.locator('#combinedInspectionResults');
  const toggle=form.getByRole('button',{name:'일괄 적용'});
  await toggle.click();
  await bulk.getByRole('button',{name:'정상'}).click();
  assert.equal(await frame().evaluate(()=>Object.keys(state.results).length),
    await form.locator('#inspList .insp-item').count());
  await bulk.getByRole('button',{name:'정상'}).click();
  assert.deepEqual(await frame().evaluate(()=>state.results),{});
  await bulk.getByRole('combobox').selectOption('selected');
  assert.equal(await bulk.getByRole('button',{name:'수리'}).isDisabled(),true);
  await form.locator('.insp-item[data-n="1"] .combined-inspection-pick').check();
  await form.locator('.insp-item[data-n="11"] .combined-inspection-pick').check();
  await bulk.getByRole('button',{name:'수리'}).click();
  assert.deepEqual(await frame().evaluate(()=>state.results),{1:'수리',11:'수리'});
  await toggle.click();
  assert.equal(await bulk.isVisible(),false);
  await fill(serials[0]);
  await frame().waitForFunction(()=>document.getElementById('subscription').value==='구독 1');
  await add.click();
  await device(1).and(panel.locator('[aria-pressed="true"]')).waitFor();
  assert.equal(await publish.textContent(),'장비 2대 모두 발행');
  assert.equal(await form.locator('#inspectDate').inputValue(),'2026-11-20');
  assert.equal(await form.locator('#inspectDate').getAttribute('readonly'),'');
  assert.equal(await form.locator('#serialNo').inputValue(),'');
  assert.equal(await form.locator('#product').inputValue(),'CUREJET');
  assert.equal(await form.locator('#version').inputValue(),'2.1.1 / 2.6');
  assert.equal(await form.locator('#subscription').inputValue(),'구독 1');
  assert.deepEqual(await frame().evaluate(()=>state.results),{});
  await fill(serials[0]);
  await publish.click();
  await frame().waitForFunction(()=>document.querySelector('#combinedDevices [role=status]').textContent.includes('중복'),undefined,{timeout:4000})
    .catch(async error=>{throw new Error(await panel.locator('[role=status]').textContent()||errors.join('; ')||error.message);});
  assert.equal(rows.size,0);
  await fill(serials[1]);
  if(!twoDevices){
    await add.click();
    await device(2).and(panel.locator('[aria-pressed="true"]')).waitFor();
    assert.equal(await add.isVisible(),false);
    await panel.getByRole('button',{name:'작성 대상에서 빼기'}).click();
    await device(0).and(panel.locator('[aria-pressed="true"]')).waitFor();
    await add.click();
    await device(2).and(panel.locator('[aria-pressed="true"]')).waitFor();
    await fill(serials[2]);
  }
  await publish.click();
  await device(0).filter({hasText:'접수 연결 · PDF 준비 중'}).waitFor();
  await firstRenderReady;
  assert.equal(links.size,0,'the PDF body is prepared while the first source link is still pending');
  assert.equal(uploads.length,0,'PDF bytes are never sent before source link confirmation');
  releaseFirstLink();
  await device(1).filter({hasText:'자동 재시도 대기'}).waitFor();
  assert.match(await device(0).textContent(),/PDF 전송 확인 중/);
  assert.ok(await publish.isDisabled());
  assert.equal(await form.locator('#loading').isVisible(),false);
  assert.equal(await frame().evaluate(()=>publishCombinedDevices()===combinedBatchRequest),true);
  await device(1).filter({hasText:'시트 기록 완료 · PDF 대기'}).waitFor();
  assert.equal(await panel.evaluate(element=>{
    const panelBounds=element.getBoundingClientRect();
    return [...element.querySelectorAll('[data-device-slot]')].every(tab=>{
      const bounds=tab.getBoundingClientRect();
      return bounds.left>=panelBounds.left&&bounds.right<=Math.min(panelBounds.right,window.innerWidth);
    });
  }),true,'every device status remains within the mobile panel');
  assert.deepEqual(uploads.map(item=>item.sn),[serials[0]],'next sheet and link finish while the original PDF request is still open');
  assert.equal(await form.locator('#serialNo').inputValue(),serials[0]);
  const secondId=sheetRequests.find(item=>item.sn===serials[1]).id;
  const timing=await frame().evaluate(()=>BazPerf.samples());
  assert.equal(timing.filter(item=>item.name==='pdf_delivery_sheet_response'&&item.recordId===secondId).length,2);
  assert.ok(timing.some(item=>item.name==='pdf_delivery_sheet_check'&&item.recordId===secondId));
  assert.ok(timing.some(item=>item.name==='work_inspection_source_link'&&item.recordId===secondId&&
    item.serverMs===210&&item.googleMs===160));
  if(reconnect){
    await context.setOffline(true);
    releaseFirstResponse();
    await device(0).filter({hasText:'네트워크 연결 대기'}).waitFor();
    await device(1).filter({hasText:'네트워크 연결 대기'}).waitFor();
    assert.equal(await frame().evaluate(()=>combinedFlow.batchActive()),true);
    allowSecondComment=true;
    await context.setOffline(false);
    await page.waitForURL(base+'/hospital-work.html?request='+request.id).catch(async error=>{
      const state=frame()&&await frame().evaluate(()=>({online:navigator.onLine,hidden:document.hidden,busy:combinedDeviceBusy,
        batch:combinedFlow.batchActive(),status:document.querySelector('#combinedDevices [role=status]').textContent}));
      throw new Error(JSON.stringify(state),{cause:error});
    });
  }else if(reopen){
    releaseFirstResponse();
    await device(0).filter({hasText:'발행 완료'}).waitFor();
    await device(1).filter({hasText:'자동 재시도 대기'}).waitFor();
    assert.equal(await frame().evaluate(()=>combinedFlow.batchActive()),true);
    allowSecondComment=true;
    await page.reload({waitUntil:'commit'});
    await page.waitForURL(base+'/hospital-work.html?request='+request.id);
  }else{
  releaseFirstResponse();
  await frame().waitForFunction(()=>document.querySelector('#combinedDevices [role=status]').textContent.includes('2/3대 발행 완료'));
  assert.deepEqual(uploads.map(item=>item.sn),serials);
  assert.deepEqual(renders,serials.map((serial,index)=>({serial,note:serial+'-photo',subscription:'구독 '+(index+1)})));
  assert.equal(rows.size,3);assert.equal(links.size,3);
  assert.equal(new Set(uploads.map(item=>item.recordId)).size,3);
  assert.equal(new Set(uploads.map(item=>item.uploadId)).size,3);
  assert.equal(await device(1).getAttribute('aria-pressed'),'true');
  assert.equal(await publish.textContent(),'남은 장비 발행');
  assert.match(await device(0).textContent(),/발행 완료/);
  assert.doesNotMatch(await device(1).textContent(),/발행 완료/);
  assert.equal(page.url(),address,'partial success stays in the combined publication form');
  assert.equal(await frame().evaluate(()=>BazHandoverInspection.hasPending(localStorage,draftRepository.owner,combinedRequest)),true);

  // Reopen with the server receipt as the only remaining copy of the job state.
  await frame().evaluate(()=>new Promise((resolve,reject)=>{
    const open=indexedDB.open('baz-inspection-transfers-v1',1);
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const db=open.result,tx=db.transaction('jobs','readwrite');
      const store=tx.objectStore('jobs'),queued=store.getAll();
      queued.onsuccess=()=>{store.clear();};
      tx.oncomplete=()=>{db.close();resolve(queued.result.map(job=>job.uploadId));};tx.onabort=()=>reject(tx.error);
    };
  })).then(queued=>assert.deepEqual(queued,[uploads[1].uploadId]));
  await page.reload();await ready();
  assert.equal(await device(1).getAttribute('aria-pressed'),'true');
  assert.equal(await form.locator('#actionDetail').inputValue(),'조치 '+serials[1]);
  allowSecondComment=true;
  await Promise.all([page.waitForURL(base+'/hospital-work.html?request='+request.id),publish.click()]);
  }
  assert.equal(rows.size,serials.length);assert.equal(uploads.length,serials.length);assert.equal(renders.length,serials.length);
  assert.equal(new Set(uploads.map(item=>item.recordId)).size,serials.length);
  assert.equal(new Set(uploads.map(item=>item.uploadId)).size,serials.length);
  assert.deepEqual(uploads.map(item=>item.sn),serials);
  assert.equal(resumes.filter(id=>id===uploads[0].uploadId).length,1);
  assert.equal(resumes.filter(id=>id===uploads[1].uploadId).length,reconnect?1:reopen?2:5);
  assert.deepEqual(sheetRequests.filter(item=>item.sn===serials[1]).map(item=>item.id),[uploads[1].recordId,uploads[1].recordId]);
  assert.ok(saveChecks.includes(uploads[1].recordId));
  assert.deepEqual(linkRequests,uploads.map(item=>item.recordId));
  assert.ok([...jobs.values()].every(job=>job.commentAttached));
  const batchTiming=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('baz_inspection_batch_timing')));
  assert.equal(batchTiming?.completed,true);
  assert.equal(batchTiming?.count,serials.length);
  assert.ok(batchTiming?.ms>0);
  await page.goto(address);await ready();
  await frame().waitForFunction(()=>document.getElementById('generateBtn').textContent==='전체 발행 완료');
  assert.ok(await publish.isDisabled());
  assert.equal(await frame().evaluate(()=>BazHandoverInspection.hasPending(localStorage,draftRepository.owner,combinedRequest)||combinedFlow.batchActive()),false);
  await device(1).click();
  assert.equal(await panel.getByRole('link',{name:'선택 장비 PDF 보기'}).getAttribute('href'),jobs.get(uploads[1].uploadId).pdf.url);
  assert.deepEqual(errors,[]);
  const recovery=reconnect?'automatic recovery after reconnect':reopen?'automatic reload recovery':'manual recovery after retry limit';
  console.log(engine+' PASS: '+serials.length+' devices, overlapping operations, lock and lost replies, accurate status and same-job '+recovery);
}finally{await browser.close();}
