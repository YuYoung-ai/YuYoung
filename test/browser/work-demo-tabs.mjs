import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../',import.meta.url));
const base='http://localhost:8256';
const stamp='2026-11-24T09:00';
const hospitals=[
 {key:'clinic',name:'검증피부과',sn:'TEST-01'},
 {key:'demo-space',name:'본사 데모 장비',sn:'DEMO-01'},
 {key:'demo-joined',name:'데모장비 2호',sn:'DEMO-02'}
].map(h=>({...h,region:'서울',asType:'무상'}));
function receipt(id,hospital,updates={}){
 const h=hospitals.find(x=>x.key===hospital);
 return {id,hospitalKey:h.key,hospitalId:h.key,hospitalName:h.name,region:h.region,sn:h.sn,
  createdBy:'테스트 CS',cs:'테스트 CS',status:'접수',registeredAt:stamp,visitAt:stamp,
  updatedAt:stamp,createdAt:stamp,revision:1,symptom:'정기 점검',...updates};
}
const requests=[
 receipt('clinic_live','clinic',{symptom:'데모장비 사용 설명 문의'}),
 receipt('demo_live','demo-space'),
 receipt('demo_review','demo-joined',{status:'결과확인',handoverReviewCount:1}),
 receipt('clinic_trash','clinic',{deletedAt:stamp}),
 receipt('demo_trash','demo-joined',{deletedAt:stamp})
];
let qrEnabled=false,lastWrite=null;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
try{
 const context=await browser.newContext({viewport:{width:1440,height:980},serviceWorkers:'block'});
 const errors=[];
 context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  const json=data=>route.fulfill({json:{success:true,...data},headers:{'Access-Control-Allow-Origin':base}});
  if(url.origin===base){
   if(url.pathname==='/auth.js')return route.fulfill({contentType:'text/javascript',
    body:"window.BazAuth={name:()=> '테스트 CS',token:()=> 'fixture',cachedLevel:()=>3};"});
   const file=path.join(root,url.pathname);
   const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'};
   if(fs.existsSync(file)&&fs.statSync(file).isFile())
    return route.fulfill({path:file,contentType:mime[path.extname(file)]});
  }
  if(url.hostname==='yuyoung-production.coaptation.workers.dev'){
   const p=JSON.parse(req.postData()||'{}');
   if(p.action==='qr_config')return json({enabled:qrEnabled});
   if(p.action==='notification_config')return json({admin:true,engineer:'테스트 엔지니어'});
   if(p.action==='work_bootstrap')return json({requests,hospitals,engineers:['테스트 엔지니어'],updatedAt:stamp});
   if(p.action==='work_detail')return json({request:requests.find(r=>r.id===p.id),requests:[],history:[],logs:[],updatedAt:stamp});
   if(p.action==='work_status'){
    lastWrite=p;
    const request=requests.find(r=>r.id===p.requestId);
    request.status=p.status;
    request.revision++;
    return json({request});
   }
   if(p.action==='work_save'){
    lastWrite=p;
    const request=receipt('demo_new',p.form.hospitalKey,p.form);
    requests.push(request);
    return json({request});
   }
   if(p.action==='work_roster')return json({roster:[],rosterMonth:p.rosterMonth});
   return json({data:[],items:[],unread:0});
  }
  return route.fulfill({status:404,body:''});
 });
 const address=base+'/hospital-work.html';
 const page=await context.newPage();
 await page.goto(address+'?view=service');
 await page.locator('#new').waitFor();
 await page.waitForFunction(()=>!document.querySelector('#new').disabled);
 await page.locator('[data-workspace=all]').click();
 const demo=page.getByRole('tab',{name:'데모장비'});
 const service=page.getByRole('tab',{name:'서비스 현황'});
 const rows=()=>page.locator('#list tbody tr[data-inline-form]').evaluateAll(els=>els.map(el=>el.dataset.inlineForm).sort());
 assert.deepEqual(await rows(),['clinic_live']);
 assert.equal(await page.locator('#count-total').textContent(),'1');
 assert.equal(await page.locator('#workspace-alerts').isVisible(),false);
 await page.locator('#edit-mode').click();
 await page.locator('tbody [data-edit-field=symptom][data-edit-request=clinic_live]').press('Enter');
 await page.locator('tbody [data-inline-field=symptom]').fill('병원 접수 수정 초안');
 assert.match(await page.locator('#inline-draft-count').textContent(),/1건/);
 await demo.click();
 assert.match(await page.locator('#inline-draft-count').textContent(),/0건/);
 assert.equal(await page.locator('#inline-save-all').isDisabled(),true);
 await service.click();
 assert.match(await page.locator('#inline-draft-count').textContent(),/1건/);
 await page.locator('#edit-mode').click();
 await service.press('ArrowRight');
 assert.equal(await demo.getAttribute('aria-selected'),'true');
 assert.equal(await page.locator('#service-panel').getAttribute('aria-labelledby'),'demo-tab');
 assert.match(page.url(),/view=demo/);
 assert.equal(await page.locator('h1:visible').textContent(),'데모장비 현황');
 assert.deepEqual(await rows(),['demo_live','demo_review']);
 assert.equal(await page.locator('#count-total').textContent(),'2');
 assert.equal(await page.locator('#count-review').textContent(),'1');
 assert.equal(await page.locator('#review-alert-count').textContent(),'1건');
 assert.equal(await page.locator('#source-review-alert [data-open]').getAttribute('data-open'),'demo_review');
 await page.setViewportSize({width:390,height:844});
 await page.locator('.mobile-cards [data-open=demo_live]').waitFor();
 assert.equal(await page.locator('.mobile-cards [data-open-inspection=demo_live]').isVisible(),true);
 assert.equal(await page.locator('.mobile-cards [data-open=clinic_live]').count(),0);
 await page.setViewportSize({width:1440,height:980});
 await page.locator('[data-metric=review]').click();
 assert.deepEqual(await rows(),['demo_review']);
 await page.locator('[data-metric=all]').click();
 await page.locator('#search').fill('2호');
 await page.waitForFunction(()=>document.getElementById('list-count').textContent==='1건 · 전체 2건');
 assert.deepEqual(await rows(),['demo_review']);
 await page.locator('#search').fill('');
 await page.locator('tbody [data-open=demo_live]').click();
 await page.locator('#detail[open][aria-busy=false]').waitFor();
 assert.equal(await page.locator('#detail').isVisible(),true);
 await page.locator('#detail-status-select').selectOption('처리중');
 await page.waitForFunction(()=>document.querySelector('#save-status').textContent.startsWith('서버 저장 완료'));
 assert.equal(lastWrite.action,'work_status');
 assert.equal(lastWrite.requestId,'demo_live');
 await page.locator('#detail [data-action=close-detail]').click();
 await page.locator('#trash-toggle').click();
 assert.deepEqual(await rows(),['demo_trash']);
 await page.locator('#empty-trash').click();
 await page.locator('#lifecycle-dialog[open]').waitFor();
 assert.equal(await page.locator('#lifecycle-list li').count(),1);
 assert.match(await page.locator('#lifecycle-list').textContent(),/데모장비 2호/);
 await page.locator('#cancel-lifecycle').click();
 await service.click();
 assert.deepEqual(await rows(),['clinic_trash']);
 await page.locator('#trash-toggle').click();
 await demo.click();
 await page.locator('#new').click();
 await page.locator('#hospital-input').fill('본사 데모 장비');
 await page.locator('#symptom').fill('데모장비 접수 검증');
 await page.locator('#request-form button[type=submit]').click();
 await page.locator('#editor').waitFor({state:'hidden'});
 assert.equal(lastWrite.action,'work_save');
 assert.equal(lastWrite.form.hospitalKey,'demo-space');
 await page.locator('#detail [data-action=close-detail]').click();
 assert.deepEqual(await rows(),['demo_live','demo_new','demo_review']);

 await page.goto(address+'?request=demo_live');
 await page.waitForFunction(()=>document.getElementById('detail').open);
 assert.equal(await demo.getAttribute('aria-selected'),'true');
 assert.match(page.url(),/view=demo/);
 await page.locator('#detail [data-action=close-detail]').click();
 await page.goto(address+'?view=demo');
 await page.waitForFunction(()=>!document.getElementById('new').disabled);
 assert.equal(await demo.getAttribute('aria-selected'),'true');
 assert.equal(await page.locator('#qr-workflow-open').isVisible(),false);

 qrEnabled=true;
 await page.goto(address+'?view=demo');
 await page.locator('#reservation-open').waitFor({state:'visible'});
 assert.equal(await demo.getAttribute('aria-selected'),'true');
 assert.equal(await page.locator('#service-panel').isVisible(),true);
 await page.locator('#reservation-open').click();
 assert.equal(await page.locator('#service-panel').isVisible(),false);
 assert.equal(await page.locator('#reservation-panel').isVisible(),true);
 await demo.click();
 assert.equal(await page.locator('#service-panel').isVisible(),true);
 assert.equal(await page.locator('#reservation-panel').isVisible(),false);
 assert.deepEqual(errors,[]);
 console.log('PASS: demo tabs, name-only classification, scoped metrics and trash, new receipts and status writes, deep links, and reservation tab');
}finally{
 await browser.close();
}
