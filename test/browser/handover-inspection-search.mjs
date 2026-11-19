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
const base='http://localhost:8258',root=fileURLToPath(new URL('../../',import.meta.url));
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
    body:"window.BazAuth={name:()=> '담당자',token:()=> 'test-token',cachedLevel:()=>1,currentLevel:async()=>1,returnAfterLogin(){}};"});
   if(url.pathname==='/handover-inspection.html')return route.fulfill({contentType:'text/html',body:'<title>Synthetic pilot entry</title>'});
   const file=path.join(root,decodeURIComponent(url.pathname));
   if(existsSync(file)&&statSync(file).isFile())return route.fulfill({path:file,contentType:mime[path.extname(file)]});
   return route.fulfill({status:404,body:''});
  }
  if(url.hostname==='yuyoung-production.coaptation.workers.dev'){
   const p=JSON.parse(req.postData()||'{}');
   if(p.action==='work_bootstrap')return json({success:true,requests,hospitals:requests.map(r=>({key:r.hospitalKey,name:r.hospitalName,sn:r.sn})),
    engineers:['담당자'],roster:[],storage:'kv',revision:'1'});
   if(p.action==='work_document_status')return json({success:true,request:requests.find(r=>r.id===p.requestId),records:[]});
   if(p.action==='work_inspection_links')return json({success:true,items:requests.filter(r=>p.requestIds.includes(r.id)).map(r=>({
    requestId:r.id,revision:r.revision,schema:3,attachment:attached&&r.id===requests[0].id?
     {fileId:'test_pdf',url:'https://drive.google.com/file/d/test_pdf/view',filename:'test.pdf',sha256:'a'.repeat(64),revision:1}:null
   }))});
   return json({success:true,engineer:'담당자',roster:[]});
  }
  if(req.resourceType()==='script')return route.fulfill({contentType:'application/javascript',body:''});
  return json({success:true,menu:[]});
 });
 await page.goto(base+'/index.html');
 await page.getByRole('button',{name:/Handover·점검 내역서 통합 작성/}).click();
 await page.waitForURL('**/hospital-work.html?view=service&entry=inspection-search');
 const search=page.locator('#search');
 const completed=page.locator('.mobile-cards [data-open-inspection="'+requests[1].id+'"]');
 const styleCandidate=page.locator('.mobile-cards [data-open-inspection="'+requests[0].id+'"]');
 await page.getByText('병원명 또는 장비 S/N을 입력하세요.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.activeElement.id),'search');
 await search.fill('분당');
 await page.locator('.mobile-cards [data-open="'+requests[1].id+'"]').waitFor();
 assert.equal(await completed.count(),0);
 await search.fill('SN-123');
 await styleCandidate.waitFor();
 const position=await styleCandidate.evaluate(b=>{
  const button=b.getBoundingClientRect(),card=b.closest('.mobile-card').getBoundingClientRect();
  return {right:card.right-button.right,top:button.top-card.top,width:button.width,height:button.height};
 });
 assert.ok(position.right<25&&position.top<25&&position.width===48&&position.height===48,JSON.stringify(position));
 await styleCandidate.click();
 await page.waitForURL('**/handover-inspection.html?request='+requests[0].id);
 attached=true;
 requests[0].revision++;
 await page.goBack();
 await search.fill('SN-123');
 await page.locator('.mobile-cards [data-open="'+requests[0].id+'"]').waitFor();
 await styleCandidate.waitFor({state:'hidden'});
 assert.deepEqual(errors,[]);
 console.log(engine+' PASS: search by hospital or serial across periods, right-side card action, direct exact-request navigation, and completion hides the button');
}finally{await browser.close();}
