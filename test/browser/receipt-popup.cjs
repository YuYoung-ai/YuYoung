const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');

const base='http://localhost:8256',root=path.resolve(__dirname,'../..');
const examples=[
  {id:'receipt_001',requestId:'request_001',kind:'receipt',gubun:'A/S',hospitalName:'테스트 병원 <검증>'},
  {id:'receipt_002',requestId:'request_002',kind:'receipt',gubun:'점검',hospitalName:'점검 병원'},
  {id:'receipt_003',requestId:'request_003',kind:'receipt',gubun:'A/S',hospitalName:'두 번째 병원'},
  {id:'receipt_004',requestId:'request_004',kind:'receipt',gubun:'A/S',hospitalName:'홈 화면 병원'}
];
const fixture=`<!doctype html><html lang="ko"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="/css/baz-notifications.css">
  <script src="/js/baz-notification-route.js"></script>
  <script src="/js/baz-notifications.js"></script></head>
  <body><button data-notification-open>알림 <span data-notification-count></span></button>
  <dialog id="draft"><input value="작성 중"></dialog></body></html>`;

async function test(){
 const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome'});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await context.addInitScript(()=>{
   window.BazAuth={token:()=> 'fixture',name:()=> '테스트'};
   Object.defineProperty(navigator,'standalone',{value:true});
   window.addEventListener('baz-open-notification',event=>{window.openedReceipt=event.detail;});
  });
  const page=await context.newPage();
  page.setDefaultTimeout(5000);
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin===base){
    if(url.pathname.endsWith('.html'))return route.fulfill({contentType:'text/html; charset=utf-8',body:fixture});
    const file=path.join(root,url.pathname);
    if(['/js/baz-notification-route.js','/js/baz-notifications.js','/css/baz-notifications.css'].includes(url.pathname))
      return route.fulfill({path:file,contentType:url.pathname.endsWith('.css')?'text/css':'text/javascript'});
   }
   if(url.hostname==='yuyoung-production.coaptation.workers.dev'){
    const {action}=JSON.parse(route.request().postData());
    return route.fulfill({json:action==='notification_list'?{success:true,unread:4,items:examples}:{success:false},
      headers:{'Access-Control-Allow-Origin':base}});
   }
   return route.fulfill({status:404,body:''});
  });
  const popup=page.locator('.baz-receipt-popup');
  const delivered=id=>Promise.all([
   page.waitForResponse(res=>res.url().includes('workers.dev')&&JSON.parse(res.request().postData()).action==='notification_list'),
   page.evaluate(receiptId=>navigator.serviceWorker.dispatchEvent(new MessageEvent('message',{data:{type:'BAZ_NOTIFICATION_RECEIVED',receiptId}})),id)
  ]);
  await page.goto(base+'/hospital-work.html');
  await page.locator('[data-notification-count]').filter({hasText:'4'}).waitFor();
  assert.equal(await popup.count(),0,'opening the application does not show old inbox items');
  await delivered('receipt_002');
  assert.equal(await popup.count(),0,'inspection receipts do not show a popup');
  await delivered('missing_receipt');
  assert.equal(await popup.count(),0,'only an item in the current account inbox is shown');
  await delivered('receipt_001');
  await popup.waitFor({state:'visible'});
  assert.equal(await popup.locator('p').textContent(),examples[0].hospitalName);
  const centered=await popup.evaluate(el=>{
   const box=el.getBoundingClientRect();
   return Math.abs(box.x+box.width/2-innerWidth/2)<2&&Math.abs(box.y+box.height/2-innerHeight/2)<2;
  });
  assert.equal(centered,true,'the receipt dialog is centered on the mobile screen');
  await popup.getByRole('button',{name:'접수 보기'}).click();
  assert.deepEqual(await page.evaluate(()=>window.openedReceipt),{requestId:'request_001',notificationId:'receipt_001'});
  await delivered('receipt_001');
  assert.equal(await popup.isVisible(),false,'repeat delivery is deduplicated');

  await page.locator('#draft').evaluate(dialog=>dialog.showModal());
  await delivered('receipt_003');
  assert.equal(await popup.isVisible(),false,'an open draft is not covered by the popup');
  await page.locator('#draft').evaluate(dialog=>dialog.close());
  await popup.waitFor({state:'visible'});
  await popup.getByRole('button',{name:'닫기'}).click();
  assert.equal(await page.locator('#draft input').inputValue(),'작성 중');

  await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,value:true});
    navigator.serviceWorker.dispatchEvent(new MessageEvent('message',{data:{type:'BAZ_NOTIFICATION_RECEIVED',receiptId:'receipt_004'}}));
  });
  assert.equal(await popup.isVisible(),false,'the hidden app does not show a popup');
  await Promise.all([
    page.waitForResponse(res=>res.url().includes('workers.dev')&&JSON.parse(res.request().postData()).action==='notification_list'),
    page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));})
  ]);
  assert.equal(await popup.isVisible(),false,'returning to the app does not replay a background push');

  await page.goto(base+'/index.html');
  await page.locator('[data-notification-count]').filter({hasText:'4'}).waitFor();
  await delivered('receipt_004');
  await Promise.all([
    page.waitForURL(base+'/hospital-work.html?request=request_004&notification=receipt_004'),
    popup.getByRole('button',{name:'접수 보기'}).click()
  ]);
  console.log('Mobile BAZ CS popup centers, protects drafts, skips other notices and opens the exact request');
 }finally{await browser.close();}
}
test().catch(error=>{console.error(error);process.exitCode=1;});
