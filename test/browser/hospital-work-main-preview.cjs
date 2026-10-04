const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
// Use PLAYWRIGHT_MODULE for an existing local runtime; no install is required.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../..'),output=process.env.HOSPITAL_WORK_SCREENSHOTS||path.resolve(root,'../..');
const hospitals=[{name:'샘플피부과 강남점',sn:'TEST-001',region:'서울',sales:'영업 A',asType:'무상',ncare:'Basic',key:'gangnam'},
 {name:'샘플의원 분당점',sn:'TEST-002',region:'경기',sales:'영업 B',asType:'유상',ncare:'Standard',key:'bundang'}];
let requests=[],history=[],ops=new Map(),abortOnce=false,mutationCount=0,calls=[];
let holdDetails=false,heldDetails=[],detailWaiters=[];
let autoSummary=null;
let holdBootstraps=true,heldBootstraps=[],bootstrapWaiters=[];
function nextBootstrap(){return heldBootstraps.length?Promise.resolve(heldBootstraps.shift()):new Promise(resolve=>bootstrapWaiters.push(resolve));}
function nextDetail(){return heldDetails.length?Promise.resolve(heldDetails.shift()):new Promise(resolve=>detailWaiters.push(resolve));}
const stamp=()=>new Date().toISOString();
function request(form,id='sample-'+(requests.length+1)){const h=hospitals.find(x=>x.key===form.hospitalKey);return {id,hospitalId:h.key,hospitalKey:h.key,hospitalName:h.name,sn:h.sn,region:h.region,...form,revision:1,createdAt:stamp(),updatedAt:stamp(),latest:''};}
requests.push(request({hospitalKey:'gangnam',symptom:'사용 중 간헐적인 누수 발생',cs:'CS 샘플',engineer:'엔지니어 A',sales:'영업 A',status:'방문예정',registeredAt:'2026-10-02T09:00',visitAt:'2026-10-05T14:00',deadline:'2026-10-06T18:00'}));
const source={recordId:'sample-report',version:'v1',date:'2026-10-05',hospitalName:hospitals[0].name,engineer:'엔지니어 A',sn:'TEST-001',gubun:'A/S',cat:'점검',type:'누수 확인',detail:'연결부 점검 및 부품 교체 후 정상 동작 확인',result:'정상',part:'연결 부품',cost:'0',remark:'다음 방문 시 재확인'};
function response(action,p){
 if(action==='work_bootstrap')return {success:true,requests,hospitals,engineers:['엔지니어 A','엔지니어 B'],who:{name:'CS 샘플',level:1},autoMatch:autoSummary,updatedAt:stamp()};
 if(action==='work_detail'){const r=requests.find(x=>x.id===p.id);return {success:true,request:r,requests:requests.filter(x=>x.hospitalId===r.hospitalId),history:history.filter(x=>x.requestId===r.id),logs:[],autoMatch:autoSummary,updatedAt:stamp()};}
 if(action==='work_handover_candidates')return {success:true,data:[source],total:1,updatedAt:stamp()};
 if(action==='work_handover_detail')return {success:true,source,updatedAt:stamp()};
 if(ops.has(p.operationId))return ops.get(p.operationId);
 let data,r=requests.find(x=>x.id===(p.id||p.requestId));
 if(action==='work_save'){
   if(p.id&&Number(p.baseRevision)!==r.revision)return {success:false,conflict:true,current:r,error:'다른 사용자가 수정했습니다.'};
   if(!p.id){r=request(p.form);requests.push(r);}else Object.assign(r,p.form,{revision:r.revision+1,updatedAt:stamp()});
   data={success:true,request:r};
 }else if(action==='work_history_add'||action==='work_history_update'){
   let h=p.historyId?history.find(x=>x.id===p.historyId):null;
   if(h&&Number(p.baseHistoryRevision)!==h.revision)return {success:false,conflict:true,current:h,error:'댓글 수정 충돌'};
   if(!h){h={id:'history-'+(history.length+1),requestId:r.id,kind:'comment',author:'CS 샘플',createdAt:stamp(),revision:0};history.push(h);}
   Object.assign(h,{body:p.body,revision:h.revision+1,updatedAt:stamp()});r.revision++;r.latest=p.body;data={success:true,request:r,history:h};
 }else if(action==='work_result_save'){
   const h={id:'result-'+r.id,requestId:r.id,kind:'result',author:'CS 샘플',createdAt:stamp(),updatedAt:stamp(),revision:1,source,memo:p.memo};history.push(h);r.revision++;r.status=p.complete?'완료':'결과확인';r.latest=source.detail;r.completedAt=stamp();r.completedBy='CS 샘플';data={success:true,request:r,history:h};
 }else return {success:false,error:'unknown fixture action '+action};
 mutationCount++;ops.set(p.operationId,JSON.parse(JSON.stringify(data)));return data;
}
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png'};
const server=http.createServer((req,res)=>{const filename=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!filename.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(filename,(err,data)=>{if(err){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(filename)]||'application/octet-stream'}).end(data);});});
let browser;
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1060}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/auth.js',route=>route.fulfill({contentType:'text/javascript',body:"window.BazAuth={name:()=> 'CS 샘플',token:()=> 'fixture-token',cachedLevel:()=>1};"}));
 await page.route('https://script.google.com/**',async route=>{
   const req=route.request(),p=req.method()==='POST'?JSON.parse(req.postData()):Object.fromEntries(new URL(req.url()).searchParams);
   calls.push(p.action);let data=JSON.parse(JSON.stringify(response(p.action,p)));
   if(holdBootstraps&&p.action==='work_bootstrap'){
     const override=await new Promise(resolve=>{const gate={finish:resolve};const waiter=bootstrapWaiters.shift();if(waiter)waiter(gate);else heldBootstraps.push(gate);});
     if(override)data=override;
   }
   if(holdDetails&&p.action==='work_detail'){
     const override=await new Promise(resolve=>{const gate={id:p.id,finish:resolve};const waiter=detailWaiters.shift();if(waiter)waiter(gate);else heldDetails.push(gate);});
     if(override)data=override;
   }
   if(abortOnce&&req.method()==='POST'){abortOnce=false;await route.abort('failed');return;}
   await route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(data)});
 });
 const url=`http://127.0.0.1:${server.address().port}/hospital-work.html`;
 await page.goto(url);const initialBootstrap=await nextBootstrap();
 assert.equal(await page.locator('#sync-state').textContent(),'동기화 진행 중');
 assert.equal(await page.locator('#sync').getAttribute('aria-busy'),'true');
 assert.equal(await page.locator('#sync').isDisabled(),true);
 assert.equal(await page.locator('#sync-time').textContent(),'아직 동기화되지 않았습니다.');
 initialBootstrap.finish();holdBootstraps=false;
 await page.waitForFunction(()=>!document.querySelector('#sync').disabled);
 assert.equal(await page.locator('#sync-state').textContent(),'동기화 완료');
 assert.equal(await page.locator('#sync').getAttribute('aria-busy'),'false');
 assert.equal(await page.locator('#sync-hint').textContent(),'최신 정보는 동기화 버튼을 눌러 확인하세요.');
 assert.equal(await page.locator('#sync').getAttribute('aria-describedby'),'sync-hint');
 await page.locator('#new').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#new').disabled);
 fs.mkdirSync(output,{recursive:true});
 const imagePath=path.join(output,'hospital-work-main-pc.png');
 await page.screenshot({path:imagePath,fullPage:true});
 const encoded=fs.readFileSync(imagePath).toString('base64'),chunkSize=12000;
 for(let i=0;i<Math.ceil(encoded.length/chunkSize);i++)console.log('PC_MAIN_IMAGE_PART '+i+' '+encoded.slice(i*chunkSize,(i+1)*chunkSize));
 console.log('PC_MAIN_IMAGE_PARTS '+Math.ceil(encoded.length/chunkSize));
 await browser.close();server.close();
})().catch(async e=>{console.error(e);if(browser)await browser.close();server.close();process.exitCode=1;});
