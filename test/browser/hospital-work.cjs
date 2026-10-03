const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
// Use PLAYWRIGHT_MODULE for an existing local runtime; no install is required.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../..'),output=process.env.HOSPITAL_WORK_SCREENSHOTS||path.resolve(root,'../..');
const hospitals=[{name:'샘플피부과 강남점',sn:'TEST-001',region:'서울',sales:'영업 A',ncare:'Basic',key:'gangnam'},
 {name:'샘플의원 분당점',sn:'TEST-002',region:'경기',sales:'영업 B',ncare:'Standard',key:'bundang'}];
let requests=[],history=[],ops=new Map(),abortOnce=false,mutationCount=0,calls=[];
let holdDetails=false,heldDetails=[],detailWaiters=[];
let autoSummary=null;
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
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox','--no-zygote','--single-process','--in-process-gpu']}:{channel:process.env.BROWSER_CHANNEL||'msedge'})});
 const page=await browser.newPage({viewport:{width:1440,height:1060}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/auth.js',route=>route.fulfill({contentType:'text/javascript',body:"window.BazAuth={name:()=> 'CS 샘플',token:()=> 'fixture-token',cachedLevel:()=>1};"}));
 await page.route('https://script.google.com/**',async route=>{
   const req=route.request(),p=req.method()==='POST'?JSON.parse(req.postData()):Object.fromEntries(new URL(req.url()).searchParams);
   calls.push(p.action);let data=JSON.parse(JSON.stringify(response(p.action,p)));
   if(holdDetails&&p.action==='work_detail'){
     const override=await new Promise(resolve=>{const gate={id:p.id,finish:resolve};const waiter=detailWaiters.shift();if(waiter)waiter(gate);else heldDetails.push(gate);});
     if(override)data=override;
   }
   if(abortOnce&&req.method()==='POST'){abortOnce=false;await route.abort('failed');return;}
   await route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(data)});
 });
 const url=`http://127.0.0.1:${server.address().port}/hospital-work.html`;
 await page.goto(url);await page.locator('#new').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#new').disabled);
 // Hold the server response: the mobile detail must open before the network completes.
 await page.setViewportSize({width:390,height:844});holdDetails=true;
 await page.locator('.mobile-cards [data-open="sample-1"]').click();const firstDetail=await nextDetail();
 assert.equal(firstDetail.id,'sample-1');
 assert.equal(await page.locator('#detail').isVisible(),true,'detail visible before response');
 assert.equal(await page.locator('.list-panel').isVisible(),false,'mobile list yields to detail immediately');
 assert.ok((await page.locator('#detail .receipt-section').textContent()).includes(requests[0].symptom));
 assert.equal(await page.locator('#detail .detail-section h3 .muted').textContent(),'확인 중','unloaded history is not zero');
 assert.equal(await page.locator('[data-action=edit]').isDisabled(),true);
 assert.equal(await page.locator('#comment-form button[type=submit]').isDisabled(),true);
 assert.equal(await page.locator('#detail').getAttribute('aria-busy'),'true');
 assert.equal(await page.locator('#detail-tools').evaluate(d=>d.open),false,'management starts collapsed');
 assert.equal(await page.locator('#detail').evaluate(d=>d.lastElementChild.id),'detail-tools','management is the final detail section');
 assert.equal(await page.locator('[data-action=edit]').isVisible(),false,'management controls are initially hidden');
 assert.equal(await page.locator('#detail .detail-summary button:not([data-action=close-detail]),#detail .results-section button').count(),0,'summary and results contain no management buttons');
 assert.equal(await page.locator('#detail-status').isVisible(),true,'loading information stays visible when collapsed');
 const detailReads=calls.filter(x=>x==='work_detail').length;
 await page.locator('.mobile-cards [data-open="sample-1"]').evaluate(b=>{b.click();b.click();});
 assert.equal(calls.filter(x=>x==='work_detail').length,detailReads,'double click shares in-flight read');
 await page.locator('#comment-body').fill('상세 확인 중 작성한 초안');
 firstDetail.finish();await page.waitForFunction(()=>document.querySelector('#detail').getAttribute('aria-busy')==='false');
 assert.equal(await page.locator('#comment-body').inputValue(),'상세 확인 중 작성한 초안','response preserves typed draft');
 assert.equal(await page.locator('#comment-body').evaluate(el=>document.activeElement===el),true,'response preserves input focus');
 assert.equal(await page.locator('[data-action=edit]').isDisabled(),false);
 const assigneeBox=await page.locator('.person-name').evaluate(el=>({height:el.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(el).lineHeight),nameWidth:el.clientWidth,chipWidth:el.parentElement.clientWidth,parentWidth:el.parentElement.parentElement.clientWidth,chipStyle:getComputedStyle(el.parentElement).width}));
 assert.ok(assigneeBox.height<=assigneeBox.lineHeight+1,'assignee fits on one line: '+JSON.stringify(assigneeBox));
 // Native disclosure supports keyboard activation and survives same-request refreshes.
 await page.locator('#detail-tools>summary').focus();await page.keyboard.press('Enter');
 assert.equal(await page.locator('[data-action=edit]').isVisible(),true);
 // A failure keeps the visible detail and draft; retry uses a fresh server response.
 await page.locator('[data-action=refresh-detail]').click();const failedDetail=await nextDetail();
 assert.ok((await page.locator('#detail-status').textContent()).includes('이전 상세 표시'));
 failedDetail.finish({success:false,error:'검증용 상세 조회 실패'});
 await page.waitForFunction(()=>document.querySelector('#detail-status').textContent.includes('최신 상세 확인 실패'));
 assert.equal(await page.locator('#detail').isVisible(),true);assert.equal(await page.locator('[data-action=edit]').isDisabled(),true);
 assert.equal(await page.locator('#comment-body').inputValue(),'상세 확인 중 작성한 초안');
 assert.equal(await page.locator('#detail-tools').evaluate(d=>d.open),true,'same-request response preserves disclosure');
 await page.locator('#detail-tools>summary').click();
 assert.equal(await page.locator('#detail-status').isVisible(),true,'failure notice remains visible when collapsed');
 await page.locator('#detail-tools>summary').click();
 await page.locator('[data-action=refresh-detail]').click();const retryDetail=await nextDetail();retryDetail.finish();
 await page.waitForFunction(()=>!document.querySelector('[data-action=edit]').disabled);
 // Closing while loading must not reopen the panel on a late response.
 await page.locator('[data-action=refresh-detail]').click();const closedDetail=await nextDetail();
 await page.getByRole('button',{name:'상세 닫기'}).click();
 closedDetail.finish();holdDetails=false;
 await page.waitForLoadState('networkidle');assert.equal(await page.locator('#detail').isVisible(),false,'late response does not reopen closed detail');
 await page.setViewportSize({width:1440,height:1060});
 await page.getByRole('button',{name:'샘플피부과 강남점',exact:true}).first().click();
 assert.equal(await page.locator('#detail-tools').evaluate(d=>d.open),false,'reopened detail starts collapsed');
 await page.locator('#detail-tools>summary').click();
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
 holdDetails=true;await page.reload();await page.waitForFunction(()=>!document.querySelector('#new').disabled);
 await page.getByRole('button',{name:'샘플피부과 강남점',exact:true}).first().click();const editDraftDetail=await nextDetail();
 assert.ok((await page.locator('#comment-edit-label').textContent()).includes('원본 확인 중'));
 await page.locator('#comment-body').fill('수정한 댓글');editDraftDetail.finish();holdDetails=false;
 await page.waitForFunction(()=>!document.querySelector('#comment-form button[type=submit]').disabled);
 await page.locator('#comment-form button[type=submit]').click();await page.locator('#detail').getByText('수정한 댓글',{exact:true}).waitFor();assert.equal(history.filter(x=>x.kind==='comment').length,1,'edit draft does not create duplicate comment');
 await page.locator('#detail-tools>summary').click();
 await page.getByRole('button',{name:'Handover 결과 불러오기'}).click();await page.locator('[data-source]').first().click();await page.locator('#source-preview').waitFor({state:'visible'});
 assert.ok((await page.locator('#source-preview').textContent()).includes(source.detail));
 await page.locator('#result-memo').fill('고객센터 최종 확인');await page.locator('#save-complete').click();await page.locator('#result-dialog').waitFor({state:'hidden'});
 assert.equal(requests[0].cs,'CS 샘플');assert.equal(requests[0].status,'완료');
 await page.locator('[data-result]').click();await page.locator('#source-preview').waitFor({state:'visible'});
 assert.ok((await page.locator('#source-preview').textContent()).includes(source.detail),'moved comparison control opens original result');
 await page.locator('#close-result').click();
 await page.getByRole('button',{name:'상세 닫기'}).click();
 await page.locator('#new').click();await page.locator('#hospital-input').fill(hospitals[1].name);await page.waitForFunction(()=>document.querySelector('#hospital-match').textContent.includes('TEST-002'));
 assert.equal(await page.locator('#sales').inputValue(),'영업 B');
 await page.locator('#symptom').fill('방문 요청 초안');await page.locator('#close-editor').click();await page.locator('#new').click();assert.equal(await page.locator('#symptom').inputValue(),'방문 요청 초안');
 await page.locator('#engineer').selectOption('엔지니어 B');await page.locator('#visitAt').fill('2026-10-07T11:00');
 abortOnce=true;await page.locator('#request-form button[type=submit]').click();await page.locator('#pending').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#retry').disabled);
 const countBeforeRetry=mutationCount;await page.reload();await page.waitForFunction(()=>!document.querySelector('#new').disabled);await page.locator('#retry').click();await page.locator('#pending').waitFor({state:'hidden'});
 assert.equal(mutationCount,countBeforeRetry,'uncertain-save retry uses same durable operation');assert.equal(requests.length,2);
 // A previous hospital's late failure or success cannot replace the selected detail.
 holdDetails=true;
 await page.getByRole('button',{name:'상세 닫기'}).click();
 await page.locator('[data-filter=all]').click();
 await page.locator('.table-scroll [data-open="sample-1"]').click();const oldFailure=await nextDetail();
 await page.locator('#detail-tools>summary').click();
 await page.locator('.table-scroll [data-open="sample-2"]').click();const newDetail=await nextDetail();
 assert.equal(await page.locator('#detail-tools').evaluate(d=>d.open),false,'switching requests resets disclosure');
 oldFailure.finish({success:false,error:'다른 병원의 늦은 실패'});newDetail.finish();
 await page.waitForFunction(()=>document.querySelector('#detail').getAttribute('aria-busy')==='false');
 assert.ok((await page.locator('#detail h2').textContent()).includes(hospitals[1].name));
 assert.equal(await page.locator('#notice').isVisible(),false,'stale failure is ignored');
 await page.locator('.table-scroll [data-open="sample-1"]').click();const oldSuccess=await nextDetail();
 await page.locator('.table-scroll [data-open="sample-2"]').click();const finalDetail=await nextDetail();
 finalDetail.finish();await page.waitForFunction(()=>document.querySelector('#detail').getAttribute('aria-busy')==='false');
 oldSuccess.finish();holdDetails=false;
 await page.waitForLoadState('networkidle');assert.ok((await page.locator('#detail h2').textContent()).includes(hospitals[1].name),'late success does not replace selected hospital');
 // Verify manual sync keeps filters and does not erase an open form draft.
 await page.getByRole('button',{name:'상세 닫기'}).click();await page.locator('#new').click();await page.locator('#symptom').fill('동기화 중 보존할 초안');
 const syncButton=page.locator('#sync');await syncButton.evaluate(b=>b.click());await page.waitForFunction(()=>!document.querySelector('#sync').disabled);
 assert.equal(await page.locator('#symptom').inputValue(),'동기화 중 보존할 초안');await page.locator('#close-editor').click();
 const reads=calls.length;await page.waitForTimeout(1600);assert.equal(calls.length,reads,'no periodic fetch');
 await page.locator('[data-filter=all]').click();await page.getByRole('button',{name:'샘플피부과 강남점',exact:true}).first().click();
 await page.waitForFunction(()=>document.querySelector('#detail').getAttribute('aria-busy')==='false');
 fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'hospital-work-pc.png'),fullPage:true});
 await page.locator('#theme').click();await page.screenshot({path:path.join(output,'hospital-work-dark.png'),fullPage:true});await page.locator('#theme').click();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'hospital-work-mobile.png'),fullPage:true});
 await page.getByRole('button',{name:'상세 닫기'}).click();
 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'page fits '+width);await page.locator('#new').click();assert.equal(await page.locator('#editor').evaluate(d=>d.scrollWidth<=d.clientWidth),true,'form fits '+width);await page.locator('#close-editor').click();}
 // Display an authoritative automatic result returned by the server, then a manual-review case.
 const automated=requests[1],automaticSource={...source,hospitalName:automated.hospitalName,date:automated.visitAt.slice(0,10),sn:automated.sn,recordId:'auto-report'};
 automated.status='완료';automated.revision++;automated.completedAt=stamp();automated.completedBy='Handover 자동 연결';
 history.push({id:'auto-history',requestId:automated.id,kind:'result',auto:true,source:automaticSource,author:'Handover 자동 연결',createdAt:stamp(),updatedAt:stamp(),revision:1,memo:''});
 autoSummary={completed:[{requestId:automated.id,recordId:automaticSource.recordId}],skipped:[]};
 await page.locator('#sync').click();await page.waitForFunction(()=>!document.querySelector('#sync').disabled);
 assert.ok((await page.locator('#notice').textContent()).includes('1건 자동 연결·완료'));assert.equal(await page.locator('#count-active').textContent(),'0');
 await page.locator('.mobile-cards [data-open="sample-2"]').click();await page.waitForFunction(()=>document.querySelector('#detail').getAttribute('aria-busy')==='false');
 assert.equal(await page.locator('#detail .facts .badge').textContent(),'완료');assert.ok((await page.locator('#detail').textContent()).includes('병원명·방문일 일치'));
 assert.ok((await page.locator('#detail .detail-result .result-fields').textContent()).includes(automaticSource.date));
 assert.equal(await page.locator('#as-result-heading').textContent(),'AS 처리 결과');
 assert.equal(await page.locator('#detail progress').getAttribute('value'),'100');
 assert.equal(await page.locator('.results-section .entry-body').count(),0,'comments are separate from results');
 assert.equal(await page.locator('.comments-section .detail-result').count(),0,'result is outside comment timeline');
 assert.equal(await page.locator('#detail').evaluate(d=>d.scrollWidth<=d.clientWidth),true,'detail fits 320px mobile');
 await page.screenshot({path:path.join(output,'hospital-work-auto-mobile.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.locator('#detail').screenshot({path:path.join(output,'hospital-work-detail-preview.png')});
 await page.locator('#detail-tools>summary').click();
 assert.equal(await page.locator('#detail-checked').isVisible(),true);
 assert.equal(await page.locator('[data-result]').isVisible(),true);
 assert.ok((await page.locator('#detail-tools').textContent()).includes('완료'));
 await page.locator('#detail-tools .request-extra>summary').click();
 assert.equal(await page.locator('#detail-tools .request-extra dd').first().isVisible(),true);
 await page.setViewportSize({width:320,height:844});
 assert.equal(await page.locator('#detail').evaluate(d=>d.scrollWidth<=d.clientWidth),true,'expanded controls fit 320px');
 await page.locator('#detail').screenshot({path:path.join(output,'hospital-work-detail-expanded.png')});
 await page.locator('#detail-tools>summary').click();
 automated.status='방문예정';automated.revision++;history=history.filter(x=>x.id!=='auto-history');
 autoSummary={completed:[],skipped:[{requestId:automated.id,reason:'sources',message:'같은 병원·처리일의 A/S 기록이 여러 건입니다. Handover 결과를 직접 선택하세요.'}]};
 await page.locator('#sync').click();await page.waitForFunction(()=>!document.querySelector('#sync').disabled);
 assert.equal(await page.locator('#auto-match-status').isVisible(),true,'manual-review warning remains visible with controls collapsed');
 assert.ok((await page.locator('#auto-match-status').textContent()).includes('직접 선택'));assert.equal(await page.locator('#detail .facts .badge').textContent(),'방문예정');assert.equal(await page.locator('[data-action=import]').isDisabled(),false);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'automatic-review notice fits mobile');
 // An enabled Deno deployment uses the same UI contract and POST reads. Explicit sync bypasses references.
 const denoPage=await browser.newPage({viewport:{width:390,height:844}}),denoCalls=[];
 denoPage.on('pageerror',e=>errors.push(e.message));
 await denoPage.route('**/auth.js',route=>route.fulfill({contentType:'text/javascript',body:"window.BazAuth={name:()=> 'CS 샘플',token:()=> 'fixture-token',cachedLevel:()=>1,config:()=>Promise.resolve({ok:true,workApi:true})};"}));
 await denoPage.route('https://yuyoung.yuyoung-ai.deno.net/**',async route=>{
   assert.equal(route.request().method(),'POST');const p=route.request().postDataJSON();denoCalls.push(p);
   await route.fulfill({contentType:'application/json',body:JSON.stringify(response(p.action,p))});
 });
 await denoPage.goto('http://127.0.0.1:'+server.address().port+'/hospital-work.html');await denoPage.waitForFunction(()=>!document.querySelector('#new').disabled);
 await denoPage.locator('.mobile-cards [data-open="sample-2"]').click();await denoPage.waitForFunction(()=>document.querySelector('#detail').getAttribute('aria-busy')==='false');
 assert.ok(denoCalls.some(p=>p.action==='work_detail'&&p.token==='fixture-token'));
 await denoPage.locator('#sync').click();await denoPage.waitForFunction(()=>!document.querySelector('#sync').disabled);
 assert.ok(denoCalls.some(p=>p.action==='work_bootstrap'&&p.force==='1'));
 await denoPage.close();
 assert.deepEqual(errors,[]);
 console.log('hospital-work browser: immediate mobile detail, failure/retry, late response isolation, draft retention, manual workflow, automatic completion display/metrics, ambiguous-result notice/manual fallback, Deno POST integration/forced sync, dark/PC/mobile layouts passed.');
 await browser.close();server.close();
})().catch(async e=>{console.error(e);if(browser)await browser.close();server.close();process.exitCode=1;});
