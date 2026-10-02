const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
// Use PLAYWRIGHT_MODULE for an existing local runtime; no install is required.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../..'),output=process.env.HOSPITAL_WORK_SCREENSHOTS||path.resolve(root,'../..');
const hospitals=[{name:'샘플피부과 강남점',sn:'TEST-001',region:'서울',sales:'영업 A',ncare:'Basic',key:'gangnam'},
 {name:'샘플의원 분당점',sn:'TEST-002',region:'경기',sales:'영업 B',ncare:'Standard',key:'bundang'}];
let requests=[],history=[],ops=new Map(),abortOnce=false,mutationCount=0,calls=[];
const stamp=()=>new Date().toISOString();
function request(form,id='sample-'+(requests.length+1)){const h=hospitals.find(x=>x.key===form.hospitalKey);return {id,hospitalId:h.key,hospitalKey:h.key,hospitalName:h.name,sn:h.sn,region:h.region,...form,revision:1,createdAt:stamp(),updatedAt:stamp(),latest:''};}
requests.push(request({hospitalKey:'gangnam',symptom:'사용 중 간헐적인 누수 발생',cs:'CS 샘플',engineer:'엔지니어 A',sales:'영업 A',status:'방문예정',registeredAt:'2026-10-02T09:00',visitAt:'2026-10-05T14:00',deadline:'2026-10-06T18:00'}));
const source={recordId:'sample-report',version:'v1',date:'2026-10-05',hospitalName:hospitals[0].name,engineer:'엔지니어 A',sn:'TEST-001',gubun:'A/S',cat:'점검',type:'누수 확인',detail:'연결부 점검 및 부품 교체 후 정상 동작 확인',result:'정상',part:'연결 부품',cost:'0',remark:'다음 방문 시 재확인'};
function response(action,p){
 if(action==='work_bootstrap')return {success:true,requests,hospitals,engineers:['엔지니어 A','엔지니어 B'],who:{name:'CS 샘플',level:1},updatedAt:stamp()};
 if(action==='work_detail'){const r=requests.find(x=>x.id===p.id);return {success:true,request:r,requests:requests.filter(x=>x.hospitalId===r.hospitalId),history:history.filter(x=>x.requestId===r.id),logs:[],updatedAt:stamp()};}
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
 browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
 const page=await browser.newPage({viewport:{width:1440,height:1060}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/auth.js',route=>route.fulfill({contentType:'text/javascript',body:"window.BazAuth={name:()=> 'CS 샘플',token:()=> 'fixture-token',cachedLevel:()=>1};"}));
 await page.route('https://script.google.com/**',async route=>{
   const req=route.request(),p=req.method()==='POST'?JSON.parse(req.postData()):Object.fromEntries(new URL(req.url()).searchParams);
   calls.push(p.action);const data=response(p.action,p);
   if(abortOnce&&req.method()==='POST'){abortOnce=false;await route.abort('failed');return;}
   await route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(data)});
 });
 const url=`http://127.0.0.1:${server.address().port}/hospital-work.html`;
 await page.goto(url);await page.locator('#new').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#new').disabled);
 await page.getByRole('button',{name:'샘플피부과 강남점',exact:true}).first().click();
 await page.getByRole('button',{name:'기본 정보 수정'}).click();
 await page.locator('#symptom').fill('고객센터 수정 증상');
 requests[0].revision++;requests[0].visitAt='2026-10-06T15:00';
 await page.locator('#request-form button[type=submit]').click();await page.locator('#merge-conflict').waitFor();
 await page.locator('#merge-conflict').click();assert.equal(await page.locator('#visitAt').inputValue(),'2026-10-06T15:00','conflict retains another user schedule');assert.equal(await page.locator('#symptom').inputValue(),'고객센터 수정 증상');
 await page.locator('#request-form button[type=submit]').click();await page.locator('#editor').waitFor({state:'hidden'});
 await page.locator('#comment-body').fill('고객센터 확인 댓글');await page.locator('#comment-form button[type=submit]').click();await page.locator('#detail').getByText('고객센터 확인 댓글',{exact:true}).waitFor();
 await page.getByRole('button',{name:'댓글 수정',exact:true}).click();await page.locator('#comment-body').fill('수정한 댓글');
 await page.getByRole('button',{name:'상세 닫기'}).click();await page.getByRole('button',{name:'샘플피부과 강남점',exact:true}).first().click();
 assert.equal(await page.locator('#comment-body').inputValue(),'수정한 댓글');
 await page.locator('#comment-form button[type=submit]').click();await page.locator('#detail').getByText('수정한 댓글',{exact:true}).waitFor();assert.equal(history.filter(x=>x.kind==='comment').length,1,'edit draft does not create duplicate comment');
 await page.getByRole('button',{name:'Handover 결과 불러오기'}).click();await page.locator('[data-source]').first().click();await page.locator('#source-preview').waitFor({state:'visible'});
 assert.ok((await page.locator('#source-preview').textContent()).includes(source.detail));
 await page.locator('#result-memo').fill('고객센터 최종 확인');await page.locator('#save-complete').click();await page.locator('#result-dialog').waitFor({state:'hidden'});
 assert.equal(requests[0].cs,'CS 샘플');assert.equal(requests[0].status,'완료');
 await page.getByRole('button',{name:'상세 닫기'}).click();
 await page.locator('#new').click();await page.locator('#hospital-input').fill(hospitals[1].name);await page.waitForFunction(()=>document.querySelector('#hospital-match').textContent.includes('TEST-002'));
 assert.equal(await page.locator('#sales').inputValue(),'영업 B');
 await page.locator('#symptom').fill('방문 요청 초안');await page.locator('#close-editor').click();await page.locator('#new').click();assert.equal(await page.locator('#symptom').inputValue(),'방문 요청 초안');
 await page.locator('#engineer').selectOption('엔지니어 B');await page.locator('#visitAt').fill('2026-10-07T11:00');
 abortOnce=true;await page.locator('#request-form button[type=submit]').click();await page.locator('#pending').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#retry').disabled);
 const countBeforeRetry=mutationCount;await page.reload();await page.waitForFunction(()=>!document.querySelector('#new').disabled);await page.locator('#retry').click();await page.locator('#pending').waitFor({state:'hidden'});
 assert.equal(mutationCount,countBeforeRetry,'uncertain-save retry uses same durable operation');assert.equal(requests.length,2);
 // Verify manual sync keeps filters and does not erase an open form draft.
 await page.getByRole('button',{name:'상세 닫기'}).click();await page.locator('#new').click();await page.locator('#symptom').fill('동기화 중 보존할 초안');
 const syncButton=page.locator('#sync');await syncButton.evaluate(b=>b.click());await page.waitForFunction(()=>!document.querySelector('#sync').disabled);
 assert.equal(await page.locator('#symptom').inputValue(),'동기화 중 보존할 초안');await page.locator('#close-editor').click();
 const reads=calls.length;await page.waitForTimeout(1600);assert.equal(calls.length,reads,'no periodic fetch');
 await page.locator('[data-filter=all]').click();await page.getByRole('button',{name:'샘플피부과 강남점',exact:true}).first().click();
 fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'hospital-work-pc.png'),fullPage:true});
 await page.locator('#theme').click();await page.screenshot({path:path.join(output,'hospital-work-dark.png'),fullPage:true});await page.locator('#theme').click();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'hospital-work-mobile.png'),fullPage:true});
 await page.getByRole('button',{name:'상세 닫기'}).click();
 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'page fits '+width);await page.locator('#new').click();assert.equal(await page.locator('#editor').evaluate(d=>d.scrollWidth<=d.clientWidth),true,'form fits '+width);await page.locator('#close-editor').click();}
 assert.deepEqual(errors,[]);
 console.log('hospital-work browser: real form submission, conflict merge, edit draft, Handover import/completion, new draft, durable unknown retry across reload, manual sync, dark/PC/mobile layouts passed.');
 await browser.close();server.close();
})().catch(async e=>{console.error(e);if(browser)await browser.close();server.close();process.exitCode=1;});
