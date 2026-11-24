import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const base = 'http://localhost:8257', date = '2026-11-24T09:00';
const dateText = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const hospitals = [
  {id:'h1', key:'hospital-first', name:'가온의원', region:'서울', sn:'TEST-01', asType:'무상'},
  {id:'h2', key:'hospital-second', name:'나래의원', region:'서울', sn:'TEST-02', asType:'무상'},
];
const requests = hospitals.map((h, index) => ({id:'r'+(index+1), hospitalId:h.id, hospitalKey:h.key, hospitalName:h.name, region:h.region, sn:h.sn,
  createdBy:'테스트 CS', cs:'테스트 CS', status:'접수', registeredAt:date, visitAt:date, updatedAt:date, createdAt:date, revision:1, symptom:'정기 점검'}));
const uid = 'g:' + 'a'.repeat(43);
const token = Buffer.from(JSON.stringify({u:uid})).toString('base64url') + '.fixture';
const groupKey = hospital => JSON.stringify([hospital.name,hospital.region]);
const memos = new Map();
let revision = 0, loseResponse = true, writes = 0;
const browser = await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome'});
try {
  const context = await browser.newContext({viewport:{width:1440,height:980},serviceWorkers:'block'});
  const errors = [];
  context.on('page',page => page.on('pageerror',error => errors.push(error.message)));
  await context.route('**/*',async route => {
    const req = route.request(), url = new URL(req.url());
    const json = data => route.fulfill({json:{success:true,...data},headers:{'Access-Control-Allow-Origin':base}});
    if (url.origin === base) {
      if (url.pathname === '/auth.js') return route.fulfill({contentType:'text/javascript',
        body:'window.BazAuth={name:()=> "테스트 CS",token:()=> '+JSON.stringify(token)+',cachedLevel:()=>3};'});
      const file = path.join(root,url.pathname);
      const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'};
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({path:file,contentType:mime[path.extname(file)]});
    }
    if (url.hostname === 'yuyoung-production.coaptation.workers.dev') {
      const p = JSON.parse(req.postData() || '{}');
      if (p.action === 'qr_config') return json({enabled:false});
      if (p.action === 'notification_config') return json({admin:true});
      if (p.action === 'work_bootstrap') return json({fieldMemos:true,storage:'kv',revision:'0',requests,hospitals,engineers:[],updatedAt:date});
      if (p.action === 'work_detail') return json({request:requests.find(r => r.id === p.id), requests:[], history:[], logs:[], updatedAt:date});
      if (p.action === 'work_roster') return json({roster:[],rosterMonth:p.rosterMonth});
      if (p.action === 'work_memo_save') {
        writes++;
        const hospital = hospitals.find(h => h.key === (p.hospitalKey || requests.find(r => r.id === p.requestId)?.hospitalKey));
        if (memos.get(p.id)?.operationId !== p.operationId) {
          revision++;
          memos.set(p.id,{...p,hospitalName:hospital.name,region:hospital.region,group:groupKey(hospital),source:p.source || 'unclassified',
            occurredAt:Date.parse(p.occurredAt+':00+09:00'),revision:1,author:'테스트 CS',canEdit:true});
        }
        if (loseResponse) return route.abort();
        return json({memo:memos.get(p.id)});
      }
      if (p.action === 'work_memo_counts') {
        return json({counts:Object.fromEntries(p.ids.map(id => [id,[...memos.values()].filter(m => m.requestId === id).length]))});
      }
      if (p.action === 'work_memo_list' || p.action === 'work_memo_summary') {
        const rows = [...memos.values()].filter(m => (!p.requestId || m.requestId === p.requestId) &&
          (!p.groups?.length || p.groups.includes(m.group)) && (!p.source || p.source === m.source) && (!p.impact || m.impacts?.includes(p.impact)));
        const version = {revision:String(revision),updatedAt:new Date().toISOString()};
        if (p.action === 'work_memo_list') return json({...version,memos:rows,cursor:''});
        if (p.revision === version.revision) return json({...version,nochange:true});
        const groups = new Map();
        for (const memo of rows) {
          const row = groups.get(memo.group) || {group:memo.group,hospitalName:memo.hospitalName,region:memo.region,total:0,impacts:{}};
          row.total++;
          for (const key of memo.impacts || []) row.impacts[key] = (row.impacts[key] || 0) + 1;
          groups.set(memo.group,row);
        }
        return json({...version,groups:[...groups.values()],total:rows.length});
      }
      return json({data:[],items:[],unread:0});
    }
    return route.fulfill({status:404,body:''});
  });
  const address = base+'/hospital-work.html';
  const page = await context.newPage();
  await page.goto(address+'?view=service');
  await page.locator('#field-records-tab').waitFor();
  await page.locator('[data-workspace=all]').click();
  const memoButton = page.locator('#list tbody [data-field-request=r1]');
  const dialog = page.locator('#field-memo-dialog');
  const body = dialog.locator('[name=body]');
  const note = '영업팀의 당일 방문 요청으로 이전 점검 일정 변경 <기록>';
  await memoButton.click();
  assert.match(await dialog.locator('#field-memo-context').textContent(),/가온의원/);
  assert.equal(await dialog.locator('#field-memo-hospital').isHidden(),true);
  await body.fill(note);
  await dialog.locator('[name=occurredAt]').fill(dateText+'T09:00');
  await dialog.locator('[name=source]').selectOption('sales');
  await dialog.locator('[name=impacts][value=schedule]').check();
  await dialog.getByRole('button',{name:'저장',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await page.waitForFunction(() => document.getElementById('field-memo-feedback').textContent.includes('전송 대기'));
  await page.locator('#field-records-tab').click();
  await page.locator('#field-records-pending summary').click();
  loseResponse = false;
  await page.getByRole('button',{name:'다시 전송',exact:true}).click();
  await page.waitForFunction(() => document.getElementById('field-memo-feedback').textContent.includes('저장 완료'));
  assert.ok(writes >= 2);
  assert.equal(memos.size,1);

  await page.locator('#field-records-filters [name=source]').selectOption('sales');
  const cell = page.getByRole('button',{name:'가온의원 · 서울 일정 변경 1건',exact:true});
  await cell.click();
  await page.getByText(note,{exact:true}).waitFor();
  await page.getByRole('button',{name:'상하',exact:true}).click();
  assert.equal(await page.locator('.field-records-hospital-card #field-records-detail').count(),1);
  assert.equal(await page.getByText(note,{exact:true}).isVisible(),true);
  await page.getByRole('button',{name:'좌우',exact:true}).click();
  assert.equal(await page.locator('#field-records-grid > #field-records-detail').count(),1);
  if (process.env.MEMO_SCREENSHOT) await page.screenshot({path:process.env.MEMO_SCREENSHOT});
  await page.getByRole('button',{name:'관련 접수',exact:true}).click();
  await page.locator('#detail [data-receipt-request=r1]').waitFor();
  assert.equal(await page.locator('#list th.read-receipts-column').textContent(),'현장 메모');
  assert.equal(await memoButton.textContent(),'메모 1건');
  await page.locator('#detail').press('Escape');

  await page.locator('#field-records-tab').click();
  await page.locator('#field-memo-new').click();
  await dialog.locator('#field-memo-hospital-search').fill('나래');
  await dialog.locator('[name=hospitalKey]').selectOption('hospital-second');
  await body.fill('접수 없이 받은 병원 요청');
  await dialog.getByRole('button',{name:'저장',exact:true}).click();
  await page.waitForFunction(() => document.getElementById('field-memo-feedback').textContent.includes('저장 완료'));
  await page.locator('#field-records-filters [name=source]').selectOption('');
  await page.getByRole('button',{name:'나래의원 · 서울 전체 1건',exact:true}).waitFor();
  await page.locator('#field-records-hospitals summary').click();
  await page.locator('#field-records-hospital-options').getByText('나래의원 · 서울',{exact:true}).click();
  await page.getByRole('button',{name:'조회',exact:true}).click();
  await page.getByRole('button',{name:'나래의원 · 서울 전체 1건',exact:true}).click();
  await page.getByText('접수 없이 받은 병원 요청',{exact:true}).waitFor();
  assert.equal(await cell.count(),0);
  assert.equal(memos.size,2);

  await page.setViewportSize({width:390,height:844});
  await page.goto(address+'?view=service');
  await page.locator('#field-records-tab').waitFor();
  await page.locator('[data-mode=mobile]').click();
  await page.locator('[data-workspace=all]').click();
  await page.locator('.mobile-cards [data-field-request=r1]').click();
  await dialog.getByText(note,{exact:true}).waitFor();
  assert.equal(await dialog.isVisible(),true);
  assert.deepEqual(errors,[]);
  console.log('field memos: existing card, offline replay, saved counts, detail link, both layouts and standalone hospital filters passed.');
} finally {
  await browser.close();
}
