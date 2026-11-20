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
  registeredAt:'2026-11-19T09:00',visitAt:'2026-11-19T12:00',gubun:'점검',revision:1};
const serials=['BWA101','BX102','BW103'];
const rows=new Map(),links=new Set(),jobs=new Map(),uploads=[],resumes=[],renders=[];
let allowSecondComment=false;
const media={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css'};

try{
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    const json=value=>route.fulfill({status:200,contentType:'application/json',
      headers:{'access-control-allow-origin':base},body:JSON.stringify(value)});
    if(url.origin===base){
      if(url.pathname==='/auth.js')return route.fulfill({contentType:media['.js'],
        body:"window.BazAuth={name:()=> '검증 담당자',token:()=> 'synthetic-token',withToken:u=>u,currentLevel:async()=>3,cachedLevel:()=>3};"});
      const file=[root,baseFiles].map(dir=>path.join(dir,decodeURIComponent(url.pathname))).find(name=>fs.existsSync(name)&&fs.statSync(name).isFile());
      return file?route.fulfill({path:file,contentType:media[path.extname(file)]}):route.fulfill({status:404,body:''});
    }
    const p=JSON.parse(req.postData()||'{}');
    if(url.hostname==='script.google.com'&&url.searchParams.get('action')==='hospdbrich')
      return json({success:true,data:serials.map((sn,index)=>({name:request.hospitalName,sn,ncare:'구독 '+(index+1)}))});
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
        const complete=p.sn!==serials[1];
        const job={success:true,state:complete?'complete':'handover',jobId:p.uploadId,filename:p.filename,bytes:p.bytes,
          sha256:p.sha256,recordId:p.recordId,requestId:p.requestId,received:true,commentAttached:complete,
          message:complete?'':'합성 댓글 연결 지연',pdf:{url:'https://drive.google.com/file/d/'+p.recordId+'/view',revision:1,sha256:p.sha256}};
        jobs.set(p.uploadId,job);
        return json(job);
      }
      if(p.action==='inspection_pdf_job_status')return json(jobs.get(p.uploadId)||{success:true,state:'missing'});
      if(p.action==='inspection_pdf_job_resume'){
        assert.equal(p.base64,undefined);
        const prior=jobs.get(p.uploadId);resumes.push(p.uploadId);
        assert.equal(prior.recordId,uploads[1].recordId);
        const result=allowSecondComment?{...prior,state:'complete',commentAttached:true,message:''}:prior;
        jobs.set(p.uploadId,result);return json(result);
      }
      if(p.reqId){
        assert.equal(rows.has(p.reqId),false,'a device retry must not write its sheet row again');
        assert.equal(p.hosp,request.hospitalName);assert.equal(p.date,'2026-11-20');
        assert.equal(p.detail,'조치 '+p.sn);assert.equal(p.hpOut,p.sn+'-HP');
        assert.equal(p.nozzleReuse,'O');assert.equal(p.nsFill,'O');
        assert.equal(p.nsAmt,'정상');assert.equal(p.jet,'가능');
        const source={recordId:p.reqId,hospitalName:p.hosp,sn:p.sn,date:p.date,engineer:p.fse,gubun:p.gubun,
          detail:p.detail,result:p.result,version:'source-'+p.sn};
        const receipt={recordId:source.recordId,source,version:'sheet-'+p.sn,pdfRevision:0,basis:Object.fromEntries(
          ['standard','simplified'].map(format=>[format,{format,fingerprint:'a'.repeat(64)}]))};
        rows.set(p.reqId,{source,receipt});
        return json({success:true,row:rows.size+1,recordId:p.reqId,inspectionReceipt:receipt});
      }
    }
    if(url.hostname==='yuyoung-production.coaptation.workers.dev'){
      const row=rows.get(p.recordId),linked=links.has(p.recordId);
      if(p.action==='work_document_status'||p.action==='work_document_retry')return json({success:true,request,
        source:row?.source,sourceLinked:linked,records:[...links].map(id=>{
          const source=rows.get(id).source;return {recordId:id,sn:source.sn,date:source.date};
        })});
      if(p.action==='work_handover_detail')return json({success:true,source:row?.source,workDetail:{request,history:[]}});
      if(p.action==='work_field_result_link'){
        assert.equal(p.requestId,request.id);assert.equal(p.sourceVersion,row.source.version);
        links.add(p.recordId);return json({success:true});
      }
    }
    return json({success:true,data:[]});
  });

  const address=base+'/handover-inspection.html?request='+request.id;
  await page.goto(address);
  const form=page.frameLocator('#inspectionForm');
  const frame=()=>page.frames().find(f=>f.url().includes('inspection.html?combined='));
  await page.exposeFunction('recordFixturePdf',value=>renders.push(value));
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
  await frame().waitForFunction(()=>document.querySelector('#combinedDevices [role=status]').textContent.includes('중복'));
  assert.equal(rows.size,0);
  await fill(serials[1]);
  await add.click();
  await device(2).and(panel.locator('[aria-pressed="true"]')).waitFor();
  assert.equal(await add.isVisible(),false);
  await panel.getByRole('button',{name:'작성 대상에서 빼기'}).click();
  await device(0).and(panel.locator('[aria-pressed="true"]')).waitFor();
  await add.click();
  await device(2).and(panel.locator('[aria-pressed="true"]')).waitFor();
  await fill(serials[2]);
  await publish.click();
  await frame().waitForFunction(()=>document.querySelector('#combinedDevices [role=status]').textContent.includes('2/3대 발행 완료'));
  assert.deepEqual(uploads.map(item=>item.sn),serials);
  assert.deepEqual(renders,serials.map((serial,index)=>({serial,note:serial+'-photo',subscription:'구독 '+(index+1)})));
  assert.equal(rows.size,3);assert.equal(links.size,3);
  assert.equal(new Set(uploads.map(item=>item.recordId)).size,3);
  assert.equal(new Set(uploads.map(item=>item.uploadId)).size,3);
  assert.equal(await device(1).getAttribute('aria-pressed'),'true');
  assert.equal(await publish.textContent(),'남은 장비 발행');
  assert.equal(await frame().evaluate(()=>BazHandoverInspection.hasPending(localStorage,draftRepository.owner,combinedRequest)),true);

  // Reopen with the server receipt as the only remaining copy of the job state.
  await frame().evaluate(()=>new Promise((resolve,reject)=>{
    const open=indexedDB.open('baz-inspection-transfers-v1',1);
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const db=open.result,tx=db.transaction('jobs','readwrite');
      tx.objectStore('jobs').clear();tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);
    };
  }));
  await page.reload();await ready();
  assert.equal(await device(1).getAttribute('aria-pressed'),'true');
  assert.equal(await form.locator('#actionDetail').inputValue(),'조치 '+serials[1]);
  allowSecondComment=true;
  await publish.click();
  await frame().waitForFunction(()=>document.getElementById('generateBtn').textContent==='전체 발행 완료');
  assert.ok(await publish.isDisabled());
  assert.equal(await frame().evaluate(()=>BazHandoverInspection.hasPending(localStorage,draftRepository.owner,combinedRequest)),false);
  assert.equal(rows.size,3);assert.equal(uploads.length,3);assert.equal(renders.length,3);
  assert.deepEqual(resumes,[uploads[1].uploadId,uploads[1].uploadId]);
  assert.ok([...jobs.values()].every(job=>job.commentAttached));
  assert.equal(await panel.getByRole('link',{name:'선택 장비 PDF 보기'}).getAttribute('href'),jobs.get(uploads[1].uploadId).pdf.url);
  assert.deepEqual(errors,[]);
  console.log(engine+' PASS: shared fields, independent photos and records, three-device cap, duplicate check and same-job recovery after reload');
}finally{await browser.close();}
