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
 {date:'2026-10-29',hosp:'예시 D병원',gubun:'점검',type:'냉각수 부족'},
 {date:'2026-10-30',hosp:'예시 D병원',gubun:'점검',type:'이상 없음'},
 {date:'2026-10-30',hosp:'예시 E병원',gubun:'점검',type:'무증상'},
 {date:'2026-07-13',hosp:'예시 A병원',gubun:'A/S',type:'노즐누수(약액 유입)',part:'내부 세척'}
];
const phrases={};const errors=[];const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||undefined,headless:true});
const context=await browser.newContext({viewport:{width:1550,height:1100},deviceScaleFactor:2,acceptDownloads:true,serviceWorkers:'block'});
await context.addInitScript(()=>{sessionStorage.setItem('baz_auth_token','tok-smoke');sessionStorage.setItem('baz_auth_level','3');sessionStorage.setItem('baz_auth_name','테스트');sessionStorage.setItem('baz_auth_expires',new Date(Date.now()+864e5).toISOString());sessionStorage.setItem('baz_auth_verified_ts',String(Date.now()));localStorage.setItem('baz_dash_view','exec');});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
await page.route('**yuyoung-production.coaptation.workers.dev/**',r=>r.fulfill({json:{ok:true,valid:true,level:3,name:'테스트'}}));
await page.route('**yuyoung-ai.deno.net/**',r=>r.fulfill({json:{ok:true,valid:true,level:3,name:'테스트'}}));
await page.route('**://script.google.com/**',r=>{let a=new URL(r.request().url()).searchParams.get('action'),b={success:true};if(r.request().method()==='POST'){const p=JSON.parse(r.request().postData());phrases[p.name]={name:p.name,text:p.text,revision:1};b.item=phrases[p.name];}else if(a==='all')b={success:true,data,updated:'2026-10-30 09:00'};else if(a==='hospdb')b.data=[];else if(a==='report_phrases')b.items=Object.values(phrases);return r.fulfill({json:b});});

try{
 await page.goto('http://127.0.0.1:'+server.address().port+'/dashboard-pc.html');await page.waitForFunction(()=>window.DATA_READY&&window.BazWeeklyReport);
 await page.evaluate(()=>{F.from='2026-10-26';F.to='2026-10-31';buildFilters();apply();openWeekly();document.getElementById('wkSel').value='2026-10-26';exOnReportPeriodChange_('week');EX_PPT_VOC_FOCUS.week=Array.from(document.getElementById('wkVocSel').options).map(o=>o.value).find(v=>/노즐.*누수/.test(v));});
 await page.waitForTimeout(500);
 const state=await page.evaluate(()=>{
  const s=exReportSnapFromSel_('week'),items=buildExecutivePptDeck(s)[0].items,layout=BazWeeklyReport.layout(L);
  const card=layout.voc;
  const vocTexts=items.filter(o=>o.k==='text'&&o.x>=card.x&&o.y>=card.y&&o.y<card.y+card.h);
  return {voc:s.weeklyVoc,cards:items.filter(o=>o.weeklyCard),vocTexts,
   counts:items.filter(o=>o.weeklyManagementCount).map(o=>o.t),
   captions:items.filter(o=>o.manualFileCaption).map(o=>o.t),
   dividers:items.filter(o=>o.weeklyVocDivider).length,
   firstRowY:card.y+card.top,
   hasNotes:items.some(o=>o.t?.includes('특이사항')),
   previousVocHeight:L.change.h,bodyBottom:L.notes.y+L.notes.h,
   applied:items.some(o=>o.actionRepairStartBand||o.actionRepairStartHalo||o.actionRepairStartLabel),
   cumulative:items.some(o=>o.actionSavingCumulative),saving:items.filter(o=>o.actionSavingPeriod).map(o=>o.t)};
 });
 assert.equal(state.applied,false);assert.equal(state.cumulative,false);assert.deepEqual(state.saving,['₩562,400']);
 assert.equal(state.voc.length,5);assert.equal(state.voc[0].name,'노즐 누수(약액 유입)');
 assert.equal(state.voc.at(-1).name,'무증상');assert.match(state.voc.at(-1).desc,/정상 동작/);
 assert.equal(state.dividers,5);assert.equal(state.hasNotes,false);
 assert.deepEqual(state.counts,['2곳','1곳']);assert.deepEqual(state.captions,['사용자 교육 현황','노즐 재사용 현황']);
 const [vocCard,managementCard]=state.cards;
 assert.deepEqual(state.cards.map(o=>o.weeklyCard),['VOC / 점검 유형','교육·재사용 병원 현황']);
 assert(vocCard.h>state.previousVocHeight&&vocCard.y+vocCard.h<managementCard.y);
 assert.equal(managementCard.y+managementCard.h,state.bodyBottom);
 assert(state.vocTexts.slice(1).every(o=>o.weeklyVoc!=null||o.weeklyDescription!=null),'VOC card shows only names and descriptions');
 const firstName=state.vocTexts.find(o=>o.weeklyVoc===0);
 const firstDescription=state.vocTexts.find(o=>o.weeklyDescription===0);
 assert(Math.abs(firstName.y-state.firstRowY-.04)<.0001,'symptom is lowered by the approved amount');
 assert(Math.abs(firstDescription.y-firstName.y-firstName.h-.05)<.0001,'description keeps the approved gap');
 console.log('PASS weekly VOC types, no symptoms, expanded card, bottom placement, current hospital counts, and unchanged savings');
 // Save a description, clear per-report edit, then prove it is reused from the saved dictionary.
 const unregistered=page.locator('.wr-voc').filter({has:page.locator('.missing')}).first();
 const savedName=await unregistered.locator('.wr-symptom').innerText();await unregistered.locator('textarea').fill('작동 이상이 반복적으로 발생하는 현상');await unregistered.getByRole('button',{name:'기본 문구로 저장'}).click();await page.waitForTimeout(150);
 const reused=await page.evaluate(name=>{
  const other=buildExecutiveReportSnapshot({type:'week',from:'2026-10-27',to:'2026-10-31'});
  return other.weeklyVoc.find(r=>r.name===name);
 },savedName);
 assert.equal(reused.desc,'작동 이상이 반복적으로 발생하는 현상');
 const periods=await page.evaluate(()=>{
  const isolated=buildExecutiveReportSnapshot({type:'week',from:'2026-07-13',to:'2026-07-18'});
  const empty=buildExecutiveReportSnapshot({type:'week',from:'2026-02-02',to:'2026-02-07'});
  return {isolated:isolated.weeklyVoc.map(r=>r.name),empty:empty.weeklyVoc.length,zero:empty.management.items.every(r=>r.cur===0),draw:buildExecutivePptDeck(empty).length};
 });
 assert.deepEqual(periods,{isolated:['노즐 누수(약액 유입)'],empty:0,zero:true,draw:1});
 const longDescription='검'.repeat(90);
 await page.locator('.wr-desc').last().fill(longDescription);
 const wrapped=await page.evaluate(()=>{
  const items=buildExecutivePptDeck(exReportSnapFromSel_('week'))[0].items;
  const lines=items.filter(o=>o.weeklyDescription===4);
  return {text:lines.map(o=>o.t).join(''),end:lines.at(-1).y+lines.at(-1).h,divider:items.filter(o=>o.weeklyVocDivider).at(-1).y};
 });
 assert.equal(wrapped.text,longDescription);assert(wrapped.end<wrapped.divider,'long description fits in the final row');
 await page.locator('.wr-desc').last().fill(state.voc.at(-1).desc);
 console.log('PASS saved description reuse, long descriptions, a week without comparison, and empty periods');
 await page.evaluate(()=>{document.getElementById('wkModal').style.display='block';});
 assert.equal(await page.locator('#wkModal input[type=file]').count(),0,'PDF upload removed');
 assert.equal(await page.locator('#wkNoteBox, .wr-delta').count(),0);
 assert.equal(await page.locator('#wkVocDescBox + .wr-management').count(),1);
 assert.equal(await page.getByRole('button',{name:'사용자 교육 현황.xlsx 다운로드'}).count(),1);
 await page.locator('#wkModal .report-box').screenshot({path:path.join(out,'implemented-editor.png')});
 await page.evaluate(()=>previewWeeklyPPT());await page.waitForSelector('#wkPvModal.show');await page.locator('#wkPvSlides > div').first().screenshot({path:path.join(out,'implemented-weekly-report.png')});
 for(const kind of ['education','nozzle']){const bytes=await page.evaluate(async kind=>Array.from(await BazWeeklyReport.workbook(exReportSnapFromSel_('week'),kind)),kind);await fs.writeFile(path.join(out,'sample-'+kind+'.xlsx'),Buffer.from(bytes));const zip=await JSZip.loadAsync(Buffer.from(bytes));const sheet=await zip.file('xl/worksheets/sheet2.xml').async('string');assert(sheet.includes('예시 A병원'));assert(!sheet.includes('강남'));}
 await page.evaluate(async()=>{
  closeWkPreview();await loadPptxLib();window.qaWriteFileCalls=[];
  const original=PptxGenJS.prototype.writeFile;
  PptxGenJS.prototype.writeFile=function(options){window.qaWriteFileCalls.push(options.fileName);return original.call(this,options);};
  BazReportFiles.embed=()=>{throw new Error('Automatic attachment processing must not run');};
 });
 const downloadPromise=page.waitForEvent('download');await page.evaluate(()=>makeWeeklyPPT());const download=await downloadPromise;await download.saveAs(path.join(out,'sample-weekly-report.pptx'));
 const zip=await JSZip.loadAsync(await fs.readFile(path.join(out,'sample-weekly-report.pptx'))),slide=await zip.file('ppt/slides/slide1.xml').async('string');
 assert.match(slide,/VOC \/ 점검 유형/);assert.match(slide,/교육·재사용 병원 현황/);
 assert.doesNotMatch(slide,/특이사항|VOC 증가 현황|A\/S 처리 내역서/);
 assert.equal((slide.match(/<p:oleObj /g)||[]).length,0);
 assert.equal(Object.entries(zip.files).filter(([n,part])=>n.includes('/embeddings/')&&!part.dir).length,0);
 assert(!slide.includes('bazAttach'));
 const monthlyDownload=page.waitForEvent('download');await page.evaluate(()=>{openMonthly();return makeMonthlyPPT();});await (await monthlyDownload).saveAs(path.join(out,'sample-monthly-report.pptx'));
 const monthlyZip=await JSZip.loadAsync(await fs.readFile(path.join(out,'sample-monthly-report.pptx')));
 assert.match(await monthlyZip.file('ppt/slides/slide1.xml').async('string'),/특이사항/);
 assert.equal(await page.evaluate(()=>qaWriteFileCalls.length),2,'weekly and monthly both use original writeFile');
 console.log('PASS original writeFile used for both reports, zero embedded files and no attachment postprocessing');
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
 console.log('PASS description save, template style/namespace preservation, and separate workbook downloads');
 assert.deepEqual(errors,[]);console.log('PASS no browser runtime errors');
 await fs.writeFile(path.join(out,'report-qa.json'),JSON.stringify({checks:'passed',state,errors},null,2));
}finally{await browser.close();server.close();}
