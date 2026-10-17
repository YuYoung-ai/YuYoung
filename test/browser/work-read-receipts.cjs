const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../..'),output=process.env.RECEIPTS_SCREENSHOTS||path.resolve(root,'../outputs');
const fixture='<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/css/baz-read-receipts.css"><body style="font-family:Arial,sans-serif;margin:24px;background:#f5f7fb"><h1>처리 내역</h1><article style="padding:20px;background:white;border-radius:12px"><h2>검증피부과의원</h2><p>장비 점검 및 처리 결과 확인</p><button data-receipt-request="request_0001">알림 읽음 현황</button></article><script>window.BazAuth={token:()=>"fixture"};window.BazNotifications={call:async(action,p)=>{window.calls=(window.calls||[]).concat({action,p});return await (await fetch("/fixture-api",{method:"POST",body:JSON.stringify(p)})).json();}};</script><script src="/js/baz-read-receipts.js"></script>';
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');if(url.pathname==='/fixture'){res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(fixture);return;}
 const filename=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(!filename.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(filename,(err,data)=>{if(err){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':({'.html':'text/html;charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2','.json':'application/json'})[path.extname(filename)]||'application/octet-stream'}).end(data);});
});
let browser;
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
 const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 let fail=false,empty=false,hold=false,held;
 const events=[{id:'event_status',kind:'status',title:'업무 상태가 변경되었습니다',createdAt:'2026-10-17T07:12:00Z'},{id:'event_receipt',kind:'receipt',title:'새 접수가 배정되었습니다',createdAt:'2026-10-16T02:05:00Z'}];
 await page.route('**/fixture-api',async route=>{
  if(hold){held=route;return;}
  const p=route.request().postDataJSON();
  if(fail){await route.abort();return;}
  const historic=p.notificationId===events[1].id;
  await route.fulfill({json:empty?{success:true,requestId:p.requestId,hospitalName:'검증피부과의원',events:[],selected:null,recipients:[],read:0,unread:0,total:0}:{success:true,requestId:p.requestId,hospitalName:'검증피부과의원',events,selected:historic?events[1]:events[0],recipients:[{name:'권오성',readAt:'2026-10-17T07:18:00Z'},{name:'지유영',readAt:historic?'':'2026-10-17T07:21:00Z'},{name:'김민주',readAt:''}],read:historic?1:2,unread:historic?2:1,total:3,pending:false}});
 });
 await page.goto('http://127.0.0.1:'+server.address().port+'/fixture');
 await page.getByRole('button',{name:'알림 읽음 현황',exact:true}).click();
 await page.getByRole('button',{name:'읽음 (2)',exact:true}).waitFor();
 assert.equal(await page.locator('.read-receipts-people li').count(),2);
 assert.match(await page.locator('.read-receipts-people').innerText(),/권오성/);
 assert.match(await page.locator('.read-receipts-people time').first().innerText(),/16:18/,'Korea local time');
 assert.equal(await page.evaluate(()=>document.querySelector('dialog').scrollWidth<=document.querySelector('dialog').clientWidth),true,'mobile dialog fits');
 fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'read-receipts-mobile-read.png')});
 await page.getByRole('button',{name:'미확인 (1)',exact:true}).click();assert.match(await page.locator('.read-receipts-people').innerText(),/김민주/);
 await page.screenshot({path:path.join(output,'read-receipts-mobile-unread.png')});
 await page.locator('[data-receipts-event]').selectOption(events[1].id);await page.getByRole('button',{name:'미확인 (2)',exact:true}).waitFor();
 assert.match(await page.locator('[data-receipt-request]').innerText(),/읽음 2 · 미확인 1/,'older event does not replace latest summary');
 fail=true;await page.getByRole('button',{name:'새로고침',exact:true}).click();await page.getByRole('status').filter({hasText:'조회 실패'}).waitFor();assert.equal(await page.locator('.read-receipts-people li').count(),0,'failed lookup clears old people');
 fail=false;await page.getByRole('button',{name:'새로고침',exact:true}).click();await page.getByRole('button',{name:'미확인 (2)',exact:true}).waitFor();
 await page.keyboard.press('Escape');assert.equal(await page.locator('dialog').evaluate(d=>d.open),false);
 await page.locator('[data-receipt-request]').click();await page.getByRole('button',{name:'읽음 (2)',exact:true}).waitFor();
 assert.equal(await page.locator('[data-receipts-event]').inputValue(),events[0].id,'reopening resets to newest event');
 await page.setViewportSize({width:1280,height:900});await page.screenshot({path:path.join(output,'read-receipts-desktop.png')});
 await page.getByRole('button',{name:'읽음 현황 닫기'}).click();empty=true;
 await page.locator('[data-receipt-request]').click();await page.getByText('최근 30일에 연결된 알림이 없습니다.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'읽음 현황 닫기'}).click();empty=false;hold=true;
 await page.locator('[data-receipt-request]').click();await page.waitForFunction(()=>window.calls.length>=7);
 await page.evaluate(()=>window.dispatchEvent(new Event('baz-auth-logout')));
 for(let i=0;i<20&&!held;i++)await new Promise(resolve=>setTimeout(resolve,20));
 if(held)await held.fulfill({json:{success:true,hospitalName:'late',events,selected:events[0],recipients:[],read:0,unread:0,total:0}});
 await page.waitForTimeout(50);assert.equal(await page.locator('dialog').evaluate(d=>d.open),false,'logout discards in-flight results');
 assert.ok((await page.evaluate(()=>window.calls)).every(x=>x.action==='notification_receipts'),'viewing receipt data never acknowledges notifications');
 assert.deepEqual(errors,[]);
 // Exercise the actual manager and styles as well as the isolated receipt component.
 const app=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),appCalls=[];
 app.on('pageerror',e=>errors.push(e.message));
 await app.route('**/auth.js*',route=>route.fulfill({contentType:'text/javascript',body:'window.BazAuth={name:()=>"현장 A",token:()=>"fixture",cachedLevel:()=>2};'}));
 const at=new Date().toISOString(),month=at.slice(0,7),hospital={id:'h1',key:'h1',name:'검증피부과의원',sn:'SN1',region:'서울'};
 const request={id:'request_0001',hospitalKey:'h1',hospitalId:'h1',hospitalName:hospital.name,sn:'SN1',region:'서울',status:'접수',engineer:'현장 A',cs:'CS 담당',symptom:'장비 점검 요청',registeredAt:at.slice(0,16),visitAt:at.slice(0,16),revision:1,createdBy:'CS 담당',createdAt:at,updatedAt:at};
 await app.route('https://yuyoung.yuyoung-ai.deno.net/**',async route=>{
  const p=route.request().postDataJSON();appCalls.push(p.action);let d={success:true};
  if(p.action==='notification_config')Object.assign(d,{uid:'fixture',engineer:'현장 A',admin:false,devices:[]});
  else if(p.action==='notification_list')Object.assign(d,{items:[],unread:0});
  else if(p.action==='work_review_config')Object.assign(d,{canReview:false,enabled:false});
  else if(p.action==='work_bootstrap')Object.assign(d,{storage:'kv',revision:'1',requests:[request],hospitals:[hospital],engineers:['현장 A'],roster:[],rosterMonth:month,updatedAt:at});
  else if(p.action==='work_roster')Object.assign(d,{roster:[],rosterMonth:month});
  else if(p.action==='work_detail')Object.assign(d,{request,history:[],logs:[],requests:[request],updatedAt:at});
  else if(p.action==='notification_receipts')Object.assign(d,{requestId:request.id,hospitalName:hospital.name,events,selected:events[0],recipients:[{name:'권오성',readAt:at},{name:'지유영',readAt:''}],read:1,unread:1,total:2});
  else throw new Error('Unexpected production API in fixture: '+p.action);
  await route.fulfill({json:d,headers:{'Access-Control-Allow-Origin':'*'}});
 });
 await app.goto('http://127.0.0.1:'+server.address().port+'/hospital-work.html');
 await app.locator('.mobile-cards [data-receipt-request]').click();await app.getByRole('button',{name:'읽음 (1)',exact:true}).waitFor();
 assert.equal(await app.locator('#detail').evaluate(d=>d.open),false,'receipt button does not open request');
 await app.getByRole('button',{name:'읽음 현황 닫기'}).click();
 await app.locator('.mobile-cards [data-open]').click();await app.locator('#detail [data-receipt-request]').filter({hasText:'읽음 1'}).waitFor();
 await app.locator('#comment-body').fill('보존할 댓글 초안');await app.locator('#detail [data-receipt-request]').click();await app.getByRole('button',{name:'읽음 (1)',exact:true}).waitFor();
 await app.screenshot({path:path.join(output,'read-receipts-app-mobile.png')});
 await app.getByRole('button',{name:'읽음 현황 닫기'}).click();assert.equal(await app.locator('#comment-body').inputValue(),'보존할 댓글 초안');assert.equal(await app.locator('#detail').evaluate(d=>d.open),true,'receipt dialog leaves parent detail open');
 assert.ok(!appCalls.some(a=>a==='notification_read'||a==='notification_mark_read'||a.startsWith('work_history_')),'lookup never mutates notifications or drafts');
 assert.deepEqual(errors,[]);console.log('work-read-receipts browser: mobile/desktop layout, names/Korean timestamps, event switching, failure/retry, empty state, logout race, actual manager/list/detail integration and comment-draft preservation passed.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
