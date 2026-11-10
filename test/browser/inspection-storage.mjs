import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../../',import.meta.url));
const playwright=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright');
const engine=process.env.PLAYWRIGHT_ENGINE||'chromium';
const browser=await playwright[engine].launch({headless:true,channel:engine==='chromium'?process.env.PLAYWRIGHT_CHANNEL||'msedge':undefined});
const base='http://localhost:8237',checks=[];
try{
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const u=new URL(route.request().url());
  if(u.origin===base){if(u.pathname==='/fixture')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset=utf-8><script src="/js/baz-inspection-repository.js"></script><script src="/js/baz-inspection-outbox.js"></script>'});return route.fulfill({path:path.join(root,u.pathname),contentType:u.pathname.endsWith('.js')?'application/javascript; charset=utf-8':undefined});}return route.abort();});
 await page.goto(base+'/fixture');
 const result=await page.evaluate(async()=>{
  const assert=(value,message)=>{if(!value)throw Error(message);},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const data={basic:{hospital:'합성 검증 병원'},photos:[0,4,1,2,3,5,6].map(slot=>({slot,memo:'항목 '+slot,data:'data:image/png;base64,aGVsbG8='})),signatures:{cs:'data:image/png;base64,c2lnbg==',hs:null},handover:{recordId:'record-1'},pdfDocument:{id:'pdf-1'}};
  const old={id:'legacy-task',createdAt:1,updatedAt:2,status:'draft',hospital:'합성 검증 병원',data};
  localStorage.setItem('inspection_tasks_v1',JSON.stringify([old]));localStorage.setItem('inspection_sync_delete_v1','["old-delete"]');
  const r=BazInspectionRepository.create({indexedDB,storage:localStorage,owner:'staff:A'});await r.ready();
  assert(localStorage.getItem('inspection_tasks_v1')===null,'verified source removed');assert(localStorage.getItem('inspection_sync_delete_v1')!==null,'unknown old delete intentions retained');
  const legacy=await r.get(old.id);assert(same(legacy.data,data),'all legacy slots/signatures/receipts retained');assert(r.queue('upsert').length===0,'unassigned data never queues uploads');
  const claimed=await r.claim(r.list()[0]);assert(claimed.owner==='staff:A'&&claimed.id===old.id,'explicit copy preserves task identity');assert(r.list().length===2,'legacy original remains');
  const metadata=r.list().find(t=>t.id===claimed.id);assert(typeof metadata.data.photos[0].data==='object','index contains only references');
  const full=await r.get(claimed.id);assert(same(full.data,data),'lazy hydration recreates old cloud wire shape');
  const r2=BazInspectionRepository.create({indexedDB,storage:localStorage,owner:'staff:A'});await r2.ready();const stale=r2.list().find(t=>t.id===claimed.id);
  full.data.basic.hospital='수정 병원';full.updatedAt=3;const saved=await r.save(full);
  let conflict=false,message='';try{await r2.save(stale);}catch(e){message=e.message;conflict=/다른 창/.test(e.message);}assert(conflict,'stale tab cannot overwrite: '+message);
  await r.acknowledge(saved.id,'upsert',claimed.revision);assert(r.queue('upsert').includes(saved.id),'old ACK cannot drop newer save');
  const accountB=BazInspectionRepository.create({indexedDB,storage:localStorage,owner:'staff:B'});await accountB.ready();assert(!accountB.list().some(t=>t.owner==='staff:A'),'account partition isolated');assert((await accountB.get(saved.id)).owner===r.legacyOwner,'other account only sees the unassigned source, never the owned edit');
  const backup=await r.backup([saved.id]);let bad=false;try{await r.restore(backup.replace('수정 병원','변조 병원'));}catch{bad=true;}assert(bad,'tampered backup rejected');
  assert(await accountB.restore(backup)===1,'backup restored');const restored=accountB.list().find(t=>t.id.startsWith('restored-'));assert(restored.owner===r.legacyOwner,'restore does not upload under current account');assert(same((await accountB.get(restored.id)).data,full.data),'editable roundtrip preserved');
  const box=BazInspectionOutbox.create(indexedDB);await box.put({key:'pending',owner:'synthetic',updatedAt:Date.now(),context:{taskId:saved.id},blob:new Blob(['%PDF-original'])});assert((await box.protectedTaskIds()).includes(saved.id),'pending PDF task protected');
  const pending=await box.find('synthetic',{taskId:saved.id});assert(await pending.blob.text()==='%PDF-original','pending PDF unchanged');
  const completed=await r.save({...await r.get(saved.id),status:'completed'});await r.acknowledge(saved.id,'upsert',completed.revision);
  let protectedError=false;try{await r.release(saved.id,{data:full.data,updatedAt:3},[saved.id]);}catch{protectedError=true;}assert(protectedError,'pending/current task cannot release');
  await box.remove('pending');await r.release(saved.id,{data:full.data,updatedAt:3},[]);await r.collectGarbage();assert(r.list().some(t=>t.id===saved.id&&t.owner===r.owner&&t.localReleased),'local release retains a cloud-only marker');assert(!r.queue('remove').includes(saved.id),'local release never queues cloud delete');assert(r.list().some(t=>t.owner===r.legacyOwner),'shared legacy source remains after GC');
  return {tasks:r.list().length,backupBytes:backup.length,legacySlots:legacy.data.photos.map(p=>p.slot)};
 });
 assert.deepEqual(result.legacySlots,[0,4,1,2,3,5,6]);checks.push('Verified migration and all legacy slots; explicit account copy; binary assets and lazy hydration; stale-tab CAS; revision-scoped ACK; account isolation; backup integrity and editable restore; pending PDF protection; local release and shared-asset GC');
 // An IDB transaction abort must retain the source and be resumable after reopening.
 const failed=await browser.newContext({serviceWorkers:'block'}),p2=await failed.newPage();await p2.route('**/*',async route=>{const u=new URL(route.request().url());return u.pathname==='/fixture'?route.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset=utf-8><script src="/js/baz-inspection-repository.js"></script>'}):route.fulfill({path:path.join(root,u.pathname),contentType:u.pathname.endsWith('.js')?'application/javascript; charset=utf-8':undefined});});await p2.goto(base+'/fixture');
 await p2.evaluate(async()=>{
  const task={id:'recover',data:{basic:{},photos:[{slot:3,data:'data:image/png;base64,aGVsbG8='}],signatures:{}},status:'draft'},source=JSON.stringify([task]);localStorage.setItem('inspection_tasks_v1',source);
  const put=IDBObjectStore.prototype.put;let inject=true;IDBObjectStore.prototype.put=function(value){if(inject&&this.name==='assets'){inject=false;throw new DOMException('synthetic quota','QuotaExceededError');}return put.call(this,value);};
  // The automatic retry succeeds and never requires writing the full draft back to LS.
  const r=BazInspectionRepository.create({indexedDB,storage:localStorage,owner:'staff:test'});await r.ready();if(!(await r.get('recover')).data.photos[0].data)throw Error('retry lost photo');
  IDBObjectStore.prototype.put=put;
  const second=JSON.stringify([{...task,id:'recover-after-restart'}]);localStorage.setItem('inspection_tasks_v1',second);
  IDBObjectStore.prototype.put=function(value){if(this.name==='assets')throw new DOMException('synthetic persistent quota','QuotaExceededError');return put.call(this,value);};
  let failed=false;try{await BazInspectionRepository.create({indexedDB,storage:localStorage,owner:'staff:test'}).ready();}catch(e){failed=e.name==='QuotaExceededError';}
  if(!failed||localStorage.getItem('inspection_tasks_v1')!==second)throw Error('failed migration removed original');
  IDBObjectStore.prototype.put=put;const resumed=BazInspectionRepository.create({indexedDB,storage:localStorage,owner:'staff:test'});await resumed.ready();if(!(await resumed.get('recover-after-restart')).data.photos[0].data)throw Error('resume lost source');
 });checks.push('Quota failure rolls back the transaction and retries without rewriting localStorage');
 await failed.close();
 const app=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),ui=await app.newPage(),remote=new Map();
 ui.on('pageerror',e=>errors.push(e.message));ui.on('dialog',d=>d.accept());
 await ui.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url()),json=value=>route.fulfill({contentType:'application/json; charset=utf-8',body:JSON.stringify(value)});
  if(u.origin===base){
   if(u.pathname==='/auth.js')return route.fulfill({contentType:'application/javascript; charset=utf-8',body:"window.BazAuth={name:()=> '합성 검증 담당자',token:()=> 'synthetic-test-token',withToken:u=>u,currentLevel:async()=>3,cachedLevel:()=>3};"});
   return route.fulfill({path:path.join(root,u.pathname),contentType:u.pathname.endsWith('.html')?'text/html; charset=utf-8':u.pathname.endsWith('.js')?'application/javascript; charset=utf-8':undefined});
  }
  if(u.hostname==='script.google.com'){
   const p=req.postData()?JSON.parse(req.postData()):Object.fromEntries(u.searchParams);
   if(p.action==='upsert'){remote.set(p.taskId,{...p,data:JSON.parse(p.data)});return json({success:true});}
   if(p.action==='get')return json({success:true,task:remote.get(p.taskId)});
   if(p.action==='list')return json({success:true,tasks:[...remote.values()]});
   return json({success:true,data:[],ver:'3.9.0',hospdb:{success:true,data:[]},master:{success:true},contenttpl:{success:true,rows:[]},weeklyauto:{success:true,writers:[]}});
  }
  return json({success:true,data:[]});
 });
 await ui.goto(base+'/inspection.html');await ui.evaluate(()=>inspectionStorageReady);
 const integrated=await ui.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;const photo=canvas.toDataURL('image/png');
  applyFormData({basic:{hospital:'합성 검증 병원',serialNo:'TEST-SN',inspectDate:'2026-11-10'},photos:[{slot:0,data:photo,memo:'S/N'}],signatures:{cs:photo,hs:null}});
  // Saturate localStorage while leaving IndexedDB available, as seen on PC Chrome.
  let fill='';for(let n=4*1024*1024;n>=1024;n=Math.floor(n/2)){try{localStorage.setItem('synthetic-storage-fill',fill+'x'.repeat(n));fill+='x'.repeat(n);}catch{}}
  const a=saveCurrentTask();document.getElementById('serialNo').value='TEST-NEW';const b=saveCurrentTask();if(!await a||!await b)throw Error('overlapping save failed');
  const id=_currentTaskId,task=await draftRepository.get(id);if(task.data.basic.serialNo!=='TEST-NEW')throw Error('last edit lost');
  if(loadTasks().filter(t=>t.owner===draftRepository.owner).length!==1)throw Error('duplicate auto drafts');
  if(localStorage.getItem('inspection_tasks_v1')!==null)throw Error('new draft stored in localStorage');
  if(!await newTask())throw Error('newTask failed');if(!await openTask(id))throw Error('openTask failed');
  if(state.photos[0].data!==photo||sigStore.cs!==photo)throw Error('open lost assets');
  await duplicateTask(id);const copy=loadTasks().find(t=>t.id!==id&&t.data.photos?.length);if(!copy||copy.data.handover||copy.data.pdfDocument)throw Error('copy identity failed');
  await openTask(copy.id);state.photos[0].memo='복사본 수정';await saveCurrentTask();if((await draftRepository.get(id)).data.photos[0].memo!=='S/N')throw Error('copy changed original');
  await openTask(id);await cloudSyncTask(getTask(id),{silent:true});
  return {id,photo,fillBytes:fill.length,tasks:loadTasks().length};
 });
 assert.ok(integrated.fillBytes>4*1024*1024);assert.equal(remote.get(integrated.id).data.photos[0].data,integrated.photo,'cloud compatibility uses the original data URL wire format');
 await ui.reload();await ui.evaluate(()=>inspectionStorageReady);assert.equal(await ui.evaluate(()=>state.photos[0]?.data),integrated.photo,'current draft restores from IDB with full localStorage');
 await ui.locator('#inspectionStorageBtn').click();await ui.getByRole('heading',{name:'초안 저장 공간',exact:true}).waitFor();assert.match(await ui.locator('[data-summary]').textContent(),/초안 3개/);
 if(process.env.OUTPUT_DIR){fs.mkdirSync(process.env.OUTPUT_DIR,{recursive:true});await ui.screenshot({path:path.join(process.env.OUTPUT_DIR,'초안-저장공간-모바일.png')});}
 const denied=await ui.evaluate(async()=>{
  document.querySelector('dialog').close();const before=_currentTaskId,put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value){if(this.name==='assets')throw new DOMException('synthetic quota','QuotaExceededError');return put.call(this,value);};
  document.getElementById('serialNo').value='UNSAVED';const ok=await newTask();IDBObjectStore.prototype.put=put;
  const held=!ok&&_currentTaskId===before&&v('serialNo')==='UNSAVED';await saveCurrentTask();return held;
 });assert.equal(denied,true,'failed draft persistence blocks navigation and retains current form');
 checks.push('Full mobile form: nearly full localStorage, overlapping autosaves, one draft identity, async new/open/duplicate, independent copied assets, legacy cloud wire format, reload from IDB, storage management dialog, failed-save navigation guard');
 const performanceResult=await page.evaluate(async()=>{
  const r=BazInspectionRepository.create({indexedDB,storage:localStorage,owner:'staff:performance'});await r.ready();
  for(let i=0;i<100;i++)await r.save({id:'perf-'+i,createdAt:1,updatedAt:2,status:'draft',data:{basic:{hospital:'합성 성능 검증 '+i},photos:[0,4,1,2,5,6].map(slot=>({slot,data:'data:image/jpeg;base64,'+btoa(('photo-'+i+'-'+slot+';').padEnd(16384,'x'))})),signatures:{cs:null,hs:null}}});
  let start=performance.now();const list=r.list(),listMs=performance.now()-start;const own=list.filter(t=>t.owner===r.owner);if(own.length!==100||JSON.stringify(own).includes('data:image'))throw Error('metadata list loads photo body');
  const task=await r.get('perf-0');task.data.basic.hospital='텍스트 수정';start=performance.now();await r.save(task);return {tasks:own.length,photos:own.reduce((sum,t)=>sum+t.data.photos.length,0),listMs:Number(listMs.toFixed(2)),textSaveMs:Number((performance.now()-start).toFixed(2))};
 });checks.push('100 tasks / 600 photos: metadata-only list and measured text save');
 await app.close();assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,result,performanceResult,errors},null,2));
}finally{await browser.close();}
