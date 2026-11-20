import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync,statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const pw=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'));
const engine=process.env.PLAYWRIGHT_ENGINE||'webkit';
const browser=await pw[engine].launch({headless:true,executablePath:engine==='webkit'?process.env.PLAYWRIGHT_WEBKIT:undefined,
 channel:engine==='chromium'?'chrome':undefined});
const base='http://localhost:8258',root=fileURLToPath(new URL('../../',import.meta.url)),fallback=fileURLToPath(new URL('../../../delivery-v2/',import.meta.url));
const requests=[
 {id:'test-intake-101',hospitalName:'통합 테스트 강남점',sn:'SN-123',hospitalKey:'first',revision:1,status:'방문예정'},
 {id:'test-intake-102',hospitalName:'통합 테스트 분당점',sn:'SN-456',hospitalKey:'second',revision:1,status:'완료'}
].map(r=>({...r,symptom:'작동 확인',engineer:'담당자',cs:'담당자',sales:'영업',visitAt:'2026-05-30T09:00',registeredAt:'2026-05-30T09:00'}));
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css'};
let attached=false;
try{
 const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  const json=data=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':base},body:JSON.stringify(data)});
  if(url.origin===base){
   if(url.pathname==='/auth.js')return route.fulfill({contentType:'application/javascript',
    body:"window.BazAuth={name:()=> '담당자',token:()=> 'test-token',cachedLevel:()=>3,currentLevel:async()=>3,returnAfterLogin(){}};"});
   if(url.pathname==='/handover-inspection.html')return route.fulfill({contentType:'text/html',body:'<title>Synthetic combined entry</title>'});
   const file=[root,fallback].map(dir=>path.join(dir,decodeURIComponent(url.pathname))).find(name=>existsSync(name)&&statSync(name).isFile())||'';
   if(existsSync(file)&&statSync(file).isFile())return route.fulfill({path:file,contentType:mime[path.extname(file)]});
   return route.fulfill({status:404,body:''});
  }
  if(url.hostname==='yuyoung-production.coaptation.workers.dev'){
   const p=JSON.parse(req.postData()||'{}');
   if(p.action==='work_bootstrap')return json({success:true,requests,hospitals:requests.map(r=>({key:r.hospitalKey,name:r.hospitalName,sn:r.sn})),
    engineers:['담당자'],roster:[],storage:'kv',revision:'1'});
   if(p.action==='work_document_status')return json({success:true,request:requests.find(r=>r.id===p.requestId),records:attached?[{recordId:'already_linked_fixture'}]:[]});
   if(p.action==='work_detail')return json({success:true,request:requests.find(r=>r.id===p.id),history:[],logs:[],requests:[]});
   if(p.action==='work_inspection_links')return json({success:true,items:requests.filter(r=>p.requestIds.includes(r.id)).map(r=>({
    requestId:r.id,revision:r.revision,schema:3,attachment:attached&&r.id===requests[0].id?
     {fileId:'test_pdf',url:'https://drive.google.com/file/d/test_pdf/view',filename:'test.pdf',sha256:'a'.repeat(64),revision:1}:null
   }))});
   return json({success:true,engineer:'담당자',roster:[]});
  }
  if(req.resourceType()==='script')return route.fulfill({contentType:'application/javascript',body:''});
  return json({success:true,menu:[]});
 });

 const service=base+'/hospital-work.html?view=service';
 await page.goto(base+'/index.html');
 assert.equal(await page.locator('#appBtnHandoverInspection').count(),0);
 await page.locator('#appBtnHospitalWork').click();
 await page.waitForURL(service);
 await page.goto(service+'&entry=inspection-search');
 await page.waitForURL(service);
 assert.equal(await page.locator('html').getAttribute('data-inspection-search'),null);

 async function showAll(){
  await page.waitForLoadState('networkidle');
  await page.locator('[data-workspace=all]').click();
  await page.locator('[data-filter=all]').click();
  await page.locator('#search').fill('SN-123');
  await page.waitForFunction(()=>document.getElementById('sync')?.disabled===false);
  await page.waitForFunction(()=>document.getElementById('period-caption')?.textContent.includes('검색 “SN-123”'));
 }
 await showAll();
 const card=page.locator('.mobile-cards [data-open="'+requests[0].id+'"]');
 const register=page.locator('.mobile-cards [data-open-inspection="'+requests[0].id+'"]');
 await card.waitFor();
 assert.match(await card.textContent(),/SN-123/);
 await card.evaluate(button=>button.click());
 const detailEntry=page.locator('#detail button[data-action="work-flow"]');
 await detailEntry.waitFor();
 assert.equal(await detailEntry.textContent(),'통합 작성');
 const combined='**/handover-inspection.html?request='+requests[0].id;
 await detailEntry.evaluate(button=>button.click());
 await page.waitForURL(combined);
 await page.goto(service);await showAll();
 await register.evaluate(button=>button.click());
 await page.waitForURL(combined);

 attached=true;requests[0].revision++;requests[0].status='완료';
 await page.goto(service);await showAll();
 await register.waitFor({state:'hidden'});
 await page.evaluate(id=>localStorage.setItem('baz_handover_inspection_v1:staff:'+encodeURIComponent('담당자')+':'+id+':pending-devices','yes'),requests[0].id);
 await page.reload();await showAll();
 await register.waitFor();
 assert.equal(await register.getAttribute('aria-label'),'처리 결과 등록 이어쓰기');
 await register.evaluate(button=>button.click());await page.waitForURL(combined);
 assert.deepEqual(errors,[]);
 console.log(engine+' PASS: a single service entry, retired bookmark normalization, intake detail and card entry, and pending draft recovery');
}finally{await browser.close();}
