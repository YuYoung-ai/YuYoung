import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import assert from 'node:assert/strict';
let req=createRequire(import.meta.url);
try{req.resolve('playwright');}catch{
 const modules=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
 if(!modules)throw new Error('Install playwright/jszip/pdf-lib or set CODEX_PRIMARY_RUNTIME_NODE_MODULES');
 req=createRequire(path.join(modules,'entry.js'));
}
const {chromium}=req('playwright'),JSZip=req('jszip');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),out=process.env.REPORT_OUTPUT||path.join(os.tmpdir(),'baz-weekly-report-qa');await fs.mkdir(out,{recursive:true});
const server=http.createServer(async(q,r)=>{try{let p=path.resolve(root,'.'+decodeURIComponent(q.url.split('?')[0]));if(!p.startsWith(root+path.sep))throw Error();let b=await fs.readFile(p);r.writeHead(200,{'Content-Type':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':p.endsWith('.html')?'text/html':p.endsWith('.json')?'application/json':'application/octet-stream'});r.end(b);}catch{r.writeHead(404);r.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const data=[
 {date:'2026-10-19',hosp:'예시 A병원',gubun:'A/S',type:'기타 이전 증상',nsFill:'X',nsAmt:'부족',jet:'교육 필요',nozzleReuse:'O'},
 {date:'2026-10-20',hosp:'예시 B병원',gubun:'점검',type:'이상 없음',nsFill:'O',nsAmt:'적정',jet:'정상',nozzleReuse:'O',ncare:'Pro'},
 {date:'2026-10-26',hosp:'예시 A병원',gubun:'A/S',type:'노즐 체결 약함',nsFill:'X',nsAmt:'부족',jet:'교육 필요',nozzleReuse:'X'},
 {date:'2026-10-27',hosp:'예시 B병원',gubun:'A/S',type:'흡입 약함',nsFill:'O',nsAmt:'적정',jet:'정상',nozzleReuse:'O',ncare:'Pro'},
 {date:'2026-10-28',hosp:'예시 C병원',gubun:'A/S',type:'핸드피스 작동 불량',nsFill:'X',nsAmt:'부족',jet:'교육 필요',nozzleReuse:'X'},
 {date:'2026-10-28',hosp:'예시 A병원',gubun:'A/S',type:'노즐누수(약액 유입)',part:'내부 세척'},
 {date:'2026-10-29',hosp:'예시 B병원',gubun:'A/S',type:'노즐누수(약액 유입)',part:'내부 세척'},
 {date:'2026-07-13',hosp:'예시 A병원',gubun:'A/S',type:'노즐누수(약액 유입)',part:'내부 세척'}
];
const phrases={};const errors=[];const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||undefined,headless:true});
const context=await browser.newContext({viewport:{width:1550,height:1100},deviceScaleFactor:2,acceptDownloads:true});
await context.addInitScript(()=>{sessionStorage.setItem('baz_auth_token','tok-smoke');sessionStorage.setItem('baz_auth_level','3');sessionStorage.setItem('baz_auth_name','테스트');sessionStorage.setItem('baz_auth_expires',new Date(Date.now()+864e5).toISOString());sessionStorage.setItem('baz_auth_verified_ts',String(Date.now()));localStorage.setItem('baz_dash_view','exec');});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
await page.route('**yuyoung-ai.deno.net/**',r=>r.fulfill({json:{ok:true,valid:true,level:3,name:'테스트'}}));
await page.route('**://script.google.com/**',r=>{let a=new URL(r.request().url()).searchParams.get('action'),b={success:true};if(r.request().method()==='POST'){const p=JSON.parse(r.request().postData());phrases[p.name]={name:p.name,text:p.text,revision:1};b.item=phrases[p.name];}else if(a==='all')b={success:true,data,updated:'2026-10-30 09:00'};else if(a==='hospdb')b.data=[];else if(a==='report_phrases')b.items=Object.values(phrases);return r.fulfill({json:b});});

try{
 await page.goto('http://127.0.0.1:'+server.address().port+'/dashboard-pc.html');await page.waitForFunction(()=>window.DATA_READY&&window.BazWeeklyReport);
 await page.evaluate(()=>{F.from='2026-10-26';F.to='2026-10-31';buildFilters();apply();openWeekly();document.getElementById('wkSel').value='2026-10-26';exOnReportPeriodChange_('week');EX_PPT_VOC_FOCUS.week=Array.from(document.getElementById('wkVocSel').options).map(o=>o.value).find(v=>/노즐.*누수/.test(v));});
 await page.waitForTimeout(500);
 let state=await page.evaluate(()=>{const s=exReportSnapFromSel_('week'),items=buildExecutivePptDeck(s)[0].items;return {change:s.change,counts:s.management.items,notes:s.notes,layout:BazWeeklyReport.layout(L),applied:items.some(o=>o.actionRepairStartBand||o.actionRepairStartHalo||o.actionRepairStartLabel),cumulative:items.some(o=>o.actionSavingCumulative),saving:items.filter(o=>o.actionSavingPeriod).map(o=>o.t),notesTexts:items.filter(o=>o.weeklyNote!=null)};});
 assert.equal(state.applied,false);assert.equal(state.cumulative,false);assert.deepEqual(state.saving,['₩562,400']);assert.equal(state.change.up.length,3);assert.deepEqual(state.notes.items,[]);assert.equal(state.counts[0].cur,2);assert.equal(state.counts[0].prev,1);assert.equal(state.counts[1].cur,1);assert.equal(state.counts[1].prev,2);assert.equal(state.layout.change.h,2.42);assert.equal(state.layout.notes.h,.85);
 console.log('PASS snapshot, TOP3, count deduplication, prior period, layout, removed markers and cumulative amount');
 // Save a description, clear per-report edit, then prove it is reused from the saved dictionary.
 const unregistered=page.locator('.wr-voc').filter({has:page.locator('.missing')}).first();
 const savedName=(await unregistered.locator('.wr-head strong').innerText()).replace(/^\d+\.\s*/, '');await unregistered.locator('textarea').fill('작동 이상이 반복적으로 발생하는 현상');await unregistered.getByRole('button',{name:'기본 문구로 저장'}).click();await page.waitForTimeout(150);
 const reused=await page.evaluate(name=>{
  const other=buildExecutiveReportSnapshot({type:'week',from:'2026-10-27',to:'2026-10-31'});
  return other.change.up.find(r=>r.k===name);
 },savedName);
 assert.equal(reused.desc,'작동 이상이 반복적으로 발생하는 현상');assert.equal(reused.file,null);
 assert.equal(await page.evaluate(()=>BazWeeklyReport.management(EX_ROWS,[]).items.every(r=>r.prev===null)),true);
 const empty=await page.evaluate(()=>{const s=buildExecutiveReportSnapshot({type:'week',from:'2026-02-02',to:'2026-02-07'});return {n:s.change.up.length,zero:s.management.items.every(r=>r.cur===0),notes:s.notes.items.length,draw:buildExecutivePptDeck(s).length};});
 assert.deepEqual(empty,{n:0,zero:true,notes:0,draw:1});
 console.log('PASS saved description reused in a different period, isolated attachments, absent comparison and empty periods');
 await page.locator('.wr-note').nth(0).fill('다음 주 사용자 교육 일정을 확인합니다.');await page.locator('.wr-note').nth(1).fill('노즐 재사용 병원은 후속 방문을 진행합니다.');
 await page.evaluate(()=>{document.getElementById('wkModal').style.display='block';});
 // Three uploaded PDFs remain local; a small self-contained PDF fixture is used for review.
 const {PDFDocument}=req('pdf-lib');let pdf=await PDFDocument.create();pdf.addPage([200,200]);const pdfBytes=await pdf.save();
 for(let i=0;i<3;i++)await page.locator('.wr-voc input[type=file]').nth(i).setInputFiles({name:'예시내역서'+(i+1)+'.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdfBytes)});
 await page.locator('#wkModal .report-box').screenshot({path:path.join(out,'implemented-editor.png')});
 await page.evaluate(()=>previewWeeklyPPT());await page.waitForSelector('#wkPvModal.show');await page.locator('#wkPvSlides > div').first().screenshot({path:path.join(out,'implemented-weekly-report.png')});
 for(const kind of ['education','nozzle']){const bytes=await page.evaluate(async kind=>Array.from(await BazWeeklyReport.workbook(exReportSnapFromSel_('week'),kind)),kind);await fs.writeFile(path.join(out,'sample-'+kind+'.xlsx'),Buffer.from(bytes));const zip=await JSZip.loadAsync(Buffer.from(bytes));const sheet=await zip.file('xl/worksheets/sheet2.xml').async('string');assert(sheet.includes('예시 A병원'));assert(!sheet.includes('강남'));}
 await page.evaluate(()=>closeWkPreview());const downloadPromise=page.waitForEvent('download');await page.evaluate(()=>makeWeeklyPPT());const download=await downloadPromise;await download.saveAs(path.join(out,'sample-weekly-report.pptx'));
 const zip=await JSZip.loadAsync(await fs.readFile(path.join(out,'sample-weekly-report.pptx'))),slide=await zip.file('ppt/slides/slide1.xml').async('string');assert.equal((slide.match(/<p:oleObj /g)||[]).length,5);assert.equal((slide.match(/progId="Excel.Sheet.12"/g)||[]).length,2);assert.equal((slide.match(/progId="Package"/g)||[]).length,3);
 for(const kind of ['education','nozzle']){
  const wb=await JSZip.loadAsync(await fs.readFile(path.join(out,'sample-'+kind+'.xlsx'))),tpl=await JSZip.loadAsync(await fs.readFile(path.join(root,'assets/report-templates/'+kind+'.xlsx')));
  assert.equal(await wb.file('xl/styles.xml').async('string'),await tpl.file('xl/styles.xml').async('string'),'styles preserved byte for byte');
  assert.equal(await wb.file('xl/workbook.xml').async('string'),await tpl.file('xl/workbook.xml').async('string'),'sheet names and workbook settings preserved');
  const malformed=await page.evaluate(async kind=>{
   const z=await JSZip.loadAsync(await BazWeeklyReport.workbook(exReportSnapFromSel_('week'),kind));
   const doc=new DOMParser().parseFromString(await z.file('xl/worksheets/sheet2.xml').async('string'),'application/xml');
   const ns='http://schemas.openxmlformats.org/markup-compatibility/2006';
   return Array.from(doc.querySelectorAll('*')).some(e=>(e.getAttributeNS(ns,'Ignorable')||'').split(' ').filter(Boolean).some(p=>!e.lookupNamespaceURI(p)));
  },kind);assert.equal(malformed,false,'Office compatibility namespace prefixes remain bound');
 }
 console.log('PASS description save, 2 note lines, template style/namespace preservation, 3 local PDFs and 5 actual PPT embedded objects');
 assert.deepEqual(errors,[]);console.log('PASS no browser runtime errors');
 await fs.writeFile(path.join(out,'report-qa.json'),JSON.stringify({checks:'passed',state,errors},null,2));
}finally{await browser.close();server.close();}
