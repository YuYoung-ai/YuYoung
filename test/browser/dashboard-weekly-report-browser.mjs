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
 {date:'2026-10-20',hosp:'예시 월간 전용병원',gubun:'점검',type:'이상 없음',nsFill:'X',nsAmt:'부족',jet:'교육 필요',nozzleReuse:'O',ncare:'Pro'},
 {date:'2026-10-26',hosp:'예시 A병원',gubun:'A/S',type:'노즐 체결 약함',nsFill:'X',nsAmt:'부족',jet:'교육 필요',nozzleReuse:'X'},
 {date:'2026-10-27',hosp:'예시 B병원',gubun:'A/S',type:'흡입 약함',nsFill:'O',nsAmt:'적정',jet:'정상',nozzleReuse:'O',ncare:'Pro'},
 {date:'2026-10-28',hosp:'예시 C병원',gubun:'A/S',type:'핸드피스 작동 불량',nsFill:'X',nsAmt:'부족',jet:'교육 필요',nozzleReuse:'X'},
 {date:'2026-10-28',hosp:'예시 A병원',gubun:'A/S',type:'노즐누수(약액 유입)',part:'내부 세척'},
 {date:'2026-10-29',hosp:'예시 B병원',gubun:'A/S',type:'노즐누수(약액 유입)',part:'내부 세척'},
 {date:'2026-10-29',hosp:'예시 D병원',gubun:'A/S',type:'이상 없음'},
 {date:'2026-10-30',hosp:'예시 E병원',gubun:'A/S',type:''},
 {date:'2026-10-30',hosp:'예시 A병원',gubun:'A/S',type:'화면 꺼짐'},
 {date:'2026-10-30',hosp:'예시 B병원',gubun:'A/S',type:'화면 멈춤'},
 {date:'2026-10-29',hosp:'예시 D병원',gubun:'점검',type:'냉각수 부족',cost:'20,000'},
 {date:'2026-10-30',hosp:'예시 D병원',gubun:'점검',type:'이상 없음'},
 {date:'2026-10-30',hosp:'예시 E병원',gubun:'점검',type:'무증상',cost:'10,000'},
 {date:'2026-10-30',hosp:'예시 D병원',gubun:'점검',type:'점검이상무',cost:'5,000'},
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

async function assertVocCentered(type){
 const rows=await page.evaluate(type=>{
  const items=buildExecutivePptDeck(exReportSnapFromSel_(type))[0].items;
  const card=BazWeeklyReport.layout(L).voc;
  return items.filter(o=>o.reportVoc!=null).map((name,i)=>{
   const metric=items.find(o=>o.reportVocMetric===i);
   const description=items.filter(o=>o.reportVocDescription===i);
   const last=description.at(-1)||name;
   return {center:card.y+card.top+(i+.5)*card.pitch,
    textCenter:(name.y+last.y+last.h)/2,metricCenter:metric.y+metric.h/2,
    overlap:description.some(o=>o.x+o.w>metric.x)};
  });
 },type);
 assert.equal(rows.length,5);
 for(const row of rows){
  assert(Math.abs(row.textCenter-row.center)<.0001);
  assert(Math.abs(row.metricCenter-row.center)<.0001);
  assert(!row.overlap);
 }
}

try{
 await page.goto('http://127.0.0.1:'+server.address().port+'/dashboard-pc.html');await page.waitForFunction(()=>window.DATA_READY&&window.BazWeeklyReport);
 await page.evaluate(()=>{F.from='2026-10-26';F.to='2026-10-31';buildFilters();apply();openWeekly();document.getElementById('wkSel').value='2026-10-26';exOnReportPeriodChange_('week');EX_PPT_VOC_FOCUS.week=Array.from(document.getElementById('wkVocSel').options).map(o=>o.value).find(v=>/노즐.*누수/.test(v));});
 await page.waitForTimeout(500);
 const state=await page.evaluate(()=>{
  const s=exReportSnapFromSel_('week'),items=buildExecutivePptDeck(s)[0].items,layout=BazWeeklyReport.layout(L);
  const card=layout.voc;
  const vocTexts=items.filter(o=>o.k==='text'&&o.x>=card.x&&o.y>=card.y&&o.y<card.y+card.h);
  return {voc:s.reportVoc,cards:items.filter(o=>o.reportCard),vocTexts,
   inspection:s.kpi.find(k=>k.key==='insp'),inspectionLines:items.filter(o=>o.inspectionDetail).map(o=>o.t),
   counts:items.filter(o=>o.reportManagementCount).map(o=>o.t),
   captions:items.filter(o=>o.manualFileCaption).map(o=>o.t),
   dividers:items.filter(o=>o.reportVocDivider).length,
   hasNotes:items.some(o=>o.t?.includes('특이사항')),
   previousVocHeight:L.change.h,bodyBottom:L.notes.y+L.notes.h,
   applied:items.some(o=>o.actionRepairStartBand||o.actionRepairStartHalo||o.actionRepairStartLabel),
   cumulative:items.some(o=>o.actionSavingCumulative),saving:items.filter(o=>o.actionSavingPeriod).map(o=>o.t)};
 });
 assert.equal(state.applied,false);assert.equal(state.cumulative,false);assert.deepEqual(state.saving,['₩562,400']);
 assert.equal(state.voc.length,5);assert.equal(state.voc[0].name,'노즐 누수(약액 유입)');
 assert.equal(state.voc.at(-1).name,'무증상');assert.match(state.voc.at(-1).desc,/정상 동작/);
 assert.equal(state.voc[0].metric,'2건 · 22.2%');assert.equal(state.voc.at(-1).metric,'1건 · 11.1%');
 assert(!state.voc.some(r=>r.name==='냉각수 부족'));
 assert.equal(state.inspection.value,'4');
 assert.equal(state.inspection.detail,'무증상 3건 (유상 판매 2건 · 15,000원), 냉각수 부족 1건 (유상 판매 20,000원)');
 assert.equal(state.inspectionLines.join('').replaceAll(' ',''),state.inspection.detail.replaceAll(' ',''));
 assert(state.inspectionLines.some(line=>line.includes('15,000원')));
 assert.equal(state.dividers,5);assert.equal(state.hasNotes,false);
 assert.deepEqual(state.counts,['2곳','1곳']);assert.deepEqual(state.captions,['사용자 교육 현황','노즐 재사용 현황']);
 const [vocCard,managementCard]=state.cards;
 assert.deepEqual(state.cards.map(o=>o.reportCard),['VOC 유형','교육·재사용 병원 현황']);
 assert(vocCard.h>state.previousVocHeight&&vocCard.y+vocCard.h<managementCard.y);
 assert.equal(managementCard.y+managementCard.h,state.bodyBottom);
 const managementGrid=await page.evaluate(()=>{
  const items=buildExecutivePptDeck(exReportSnapFromSel_('week'))[0].items;
  return ['교육 필요 병원','노즐 재사용 병원'].map(name=>{
   const row=items.find(o=>o.t===name);
   return items.filter(o=>o.k==='text'&&o.y===row.y&&o.x>=row.x)
    .map(o=>[o.x,o.w,o.h,o.align]);
  });
 });
 assert.equal(managementGrid[0].length,3);
 assert.deepEqual(managementGrid[0],managementGrid[1]);
 assert.deepEqual(state.vocTexts.filter(o=>o.reportVocMetric!=null).map(o=>o.t),state.voc.map(r=>r.metric));
 assert.deepEqual(await page.locator('#wkVocDescRows .wr-voc .wr-voc-metric').allTextContents(),state.voc.map(r=>r.metric));
 await assertVocCentered('week');
 console.log('PASS weekly VOC types, no symptoms, expanded card, bottom placement, current hospital counts, and unchanged savings');
 // Save a description, clear per-report edit, then prove it is reused from the saved dictionary.
 const unregistered=page.locator('.wr-voc').filter({has:page.locator('.missing')}).first();
 const savedName=await unregistered.locator('.wr-symptom').innerText();await unregistered.locator('textarea').fill('작동 이상이 반복적으로 발생하는 현상');await unregistered.getByRole('button',{name:'기본 문구로 저장'}).click();await page.waitForTimeout(150);
 const reused=await page.evaluate(name=>{
  const other=buildExecutiveReportSnapshot({type:'week',from:'2026-10-27',to:'2026-10-31'});
  return other.reportVoc.find(r=>r.name===name);
 },savedName);
 assert.equal(reused.desc,'작동 이상이 반복적으로 발생하는 현상');
 const periods=await page.evaluate(()=>{
  const isolated=buildExecutiveReportSnapshot({type:'week',from:'2026-07-13',to:'2026-07-18'});
  const empty=buildExecutiveReportSnapshot({type:'week',from:'2026-02-02',to:'2026-02-07'});
  return {isolated:isolated.reportVoc.map(r=>r.name),empty:empty.reportVoc.length,zero:empty.management.items.every(r=>r.cur===0),draw:buildExecutivePptDeck(empty).length};
 });
 assert.deepEqual(periods,{isolated:['노즐 누수(약액 유입)'],empty:0,zero:true,draw:1});
 const longDescription='검'.repeat(90);
 await page.locator('.wr-desc').last().fill(longDescription);
 const wrapped=await page.evaluate(()=>{
  const items=buildExecutivePptDeck(exReportSnapFromSel_('week'))[0].items;
  const lines=items.filter(o=>o.reportVocDescription===4);
  return {text:lines.map(o=>o.t).join(''),end:lines.at(-1).y+lines.at(-1).h,divider:items.filter(o=>o.reportVocDivider).at(-1).y};
 });
 assert.equal(wrapped.text,longDescription);assert(wrapped.end<wrapped.divider,'long description fits in the final row');
 await page.locator('.wr-desc').last().fill(state.voc.at(-1).desc);
 console.log('PASS saved description reuse, long descriptions, a week without comparison, and empty periods');
 await page.evaluate(()=>{document.getElementById('wkModal').style.display='block';});
 assert.equal(await page.locator('#wkModal input[type=file]').count(),0,'PDF upload removed');
 assert.equal(await page.locator('#wkNoteBox, .wr-delta').count(),0);
 assert.equal(await page.locator('#wkVocDescBox + .wr-management').count(),1);
 assert.equal(await page.getByRole('button',{name:'사용자 교육 현황.xlsx 다운로드'}).count(),1);
 const [firstHidden,secondHidden]=await page.locator('.wr-voc-excluded-row .wr-symptom').allTextContents();
 const [target,firstRow,removed]=state.voc.map(r=>r.name);
 const action=(name,label)=>page.getByRole('button',{name:name+' '+label,exact:true});
 const merge=name=>page.getByRole('combobox',{name:name+' 편입 대상',exact:true});
 const selectedNames=()=>page.locator('.wr-voc .wr-symptom').allTextContents();
 const current=()=>page.evaluate(()=>exReportSnapFromSel_('week').reportVoc);
 assert(await action(firstHidden,'반영').isDisabled());
 await merge(firstHidden).selectOption(target);
 await merge(secondHidden).selectOption(target);
 assert.equal((await current())[0].metric,'4건 · 44.4%');
 await action(target,'제외').click();
 assert.equal(await merge(firstHidden).inputValue(),'');
 assert.equal(await merge(secondHidden).inputValue(),'');
 await action(target,'반영').click();
 assert.equal((await current()).at(-1).metric,'2건 · 22.2%');
 await page.getByRole('button',{name:'기본 선택으로 되돌리기'}).click();
 assert.deepEqual(await selectedNames(),state.voc.map(r=>r.name));

 await action(removed,'제외').click();
 await merge(firstHidden).selectOption(target);
 await action(firstHidden,'반영').click();
 assert.equal((await current())[0].metric,'2건 · 22.2%');
 await merge(removed).selectOption(target);
 await merge(secondHidden).selectOption(target);
 await action(target,'아래로').click();
 const custom=await current();
 assert.deepEqual(custom.slice(0,2).map(r=>r.name),[firstRow,target]);
 assert.deepEqual(await selectedNames(),custom.map(r=>r.name));
 assert.equal(custom[1].metric,'4건 · 44.4%');
 assert.deepEqual(new Set(custom[1].merged),new Set([removed,secondHidden]));
 assert.equal(custom.at(-1).name,firstHidden);
 await page.locator('#wkSel').selectOption('2026-10-19');
 assert.deepEqual(await selectedNames(),['기타 이전 증상']);
 await page.locator('#wkSel').selectOption('2026-10-26');
 assert.deepEqual(await current(),custom);
 console.log('PASS weekly VOC selection, ordering, merge, reset, and period isolation');
 await page.locator('#wkModal .report-box').screenshot({path:path.join(out,'implemented-editor.png')});
 await page.evaluate(()=>previewWeeklyPPT());await page.waitForSelector('#wkPvModal.show');await page.locator('#wkPvSlides > div').first().screenshot({path:path.join(out,'implemented-weekly-report.png')});
 const previewText=(await page.locator('#wkPvSlides').textContent()).replaceAll('\u00a0',' ');
 assert.match(previewText,/4건 · 44\.4%/);
 const number=page.locator('#wkPvSlides [data-graph-label-key]').first();
 await number.click();assert(await number.evaluate(e=>e.classList.contains('is-selected')));
 await number.click();assert.equal(await number.evaluate(e=>e.classList.contains('is-selected')),false);
 for(const kind of ['education','nozzle']){const bytes=await page.evaluate(async kind=>Array.from(await BazWeeklyReport.workbook(exReportSnapFromSel_('week'),kind)),kind);await fs.writeFile(path.join(out,'sample-'+kind+'.xlsx'),Buffer.from(bytes));const zip=await JSZip.loadAsync(Buffer.from(bytes));const sheet=await zip.file('xl/worksheets/sheet2.xml').async('string');assert(sheet.includes('예시 A병원'));assert(!sheet.includes('강남'));}
 await page.evaluate(async()=>{
  closeWkPreview();await loadPptxLib();window.qaWriteFileCalls=[];
  const original=PptxGenJS.prototype.writeFile;
  PptxGenJS.prototype.writeFile=function(options){window.qaWriteFileCalls.push(options.fileName);return original.call(this,options);};
  BazReportFiles.embed=()=>{throw new Error('Automatic attachment processing must not run');};
 });
 const downloadPromise=page.waitForEvent('download');await page.evaluate(()=>makeWeeklyPPT());const download=await downloadPromise;await download.saveAs(path.join(out,'sample-weekly-report.pptx'));
 const zip=await JSZip.loadAsync(await fs.readFile(path.join(out,'sample-weekly-report.pptx'))),slide=await zip.file('ppt/slides/slide1.xml').async('string');
 const weeklyTitle='10월 4주차 CS 주간업무보고_(2026.10.26~2026.10.31)';
 assert.equal(download.suggestedFilename(),weeklyTitle+'.pptx');
 assert(slide.includes(weeklyTitle));
 assert((await zip.file('docProps/core.xml').async('string')).includes('<dc:title>'+weeklyTitle+'</dc:title>'));
 const vocSlide=slide.slice(slide.indexOf('>VOC 유형<'),slide.indexOf('>교육·재사용 병원 현황<'));
 assert.match(vocSlide,/4건 · 44\.4%/);
 let lastIndex=-1;
 for(const r of custom){
  const index=vocSlide.indexOf('>'+r.name+'<');
  assert(index>lastIndex,'PPT shows the selected symptoms in the chosen order');
  lastIndex=index;
 }
 for(const name of [removed,secondHidden])assert(!vocSlide.includes('>'+name+'<'));
 assert.match(slide,/유상 판매/);assert.match(slide,/교육·재사용 병원 현황/);
 assert.doesNotMatch(slide,/특이사항|VOC 증가 현황|A\/S 처리 내역서/);
 assert.equal((slide.match(/<p:oleObj /g)||[]).length,0);
 assert.equal(Object.entries(zip.files).filter(([n,part])=>n.includes('/embeddings/')&&!part.dir).length,0);
 assert(!slide.includes('bazAttach'));
 await page.evaluate(()=>openMonthly());
 await page.selectOption('#mnVocSel','노즐 누수(약액 유입)');
 assert.equal(await page.locator('#mnNoteBox').count(),0);
 for(const name of ['사용자 교육 현황','노즐 재사용 현황']){
  const pending=page.waitForEvent('download');
  await page.locator('#mnManagementDownloads').getByRole('button',{name:name+'.xlsx 다운로드'}).click();
  const file=await pending;
  assert.equal(file.suggestedFilename(),name+'(2026.10.01~2026.10.31).xlsx');
  const wb=await JSZip.loadAsync(await fs.readFile(await file.path()));
  assert((await wb.file('xl/worksheets/sheet2.xml').async('string')).includes('예시 월간 전용병원'));
 }
 const monthEditor=page.locator('#mnVocDescRows');
 const monthBefore=await monthEditor.locator('.wr-voc .wr-symptom').allTextContents();
 const monthlyHidden=await monthEditor.locator('.wr-voc-excluded-row .wr-symptom').first().textContent();
 assert.equal(monthBefore.length,5);
 assert.equal(monthBefore[0],target);
 const monthlyExcluded=monthBefore[2];
 await monthEditor.getByRole('button',{name:monthlyExcluded+' 제외',exact:true}).click();
 await monthEditor.getByRole('button',{name:monthlyHidden+' 반영',exact:true}).click();
 await monthEditor.getByRole('combobox',{name:monthlyExcluded+' 편입 대상',exact:true}).selectOption(target);
 await monthEditor.getByRole('button',{name:target+' 아래로',exact:true}).click();
 await monthEditor.getByRole('textbox',{name:monthlyHidden+' 보조문구',exact:true}).fill(longDescription);
 const monthlyRows=await page.evaluate(()=>{
  const snap=exReportSnapFromSel_('month'),items=buildExecutivePptDeck(snap)[0].items;
  const card=items.find(o=>o.reportCard==='VOC 유형');
  const descriptions=items.filter(o=>o.reportVocDescription===4);
  return {names:snap.reportVoc.map(r=>r.name),metrics:snap.reportVoc.map(r=>r.metric),
   counts:items.filter(o=>o.reportManagementCount).map(o=>o.t),
   cards:items.filter(o=>o.reportCard).map(o=>o.reportCard),
   description:descriptions.map(o=>o.t).join(''),
   descEnd:descriptions.at(-1).y+descriptions.at(-1).h,cardBottom:card.y+card.h};
 });
 assert.deepEqual(monthlyRows.names,[monthBefore[1],target,...monthBefore.slice(3),monthlyHidden]);
 assert.equal(monthlyRows.metrics[1],'3건 · 30%');
 assert.deepEqual(monthlyRows.counts,['3곳','2곳']);
 assert.deepEqual(monthlyRows.cards,['VOC 유형','교육·재사용 병원 현황']);
 assert.equal(monthlyRows.description,longDescription);
 assert(monthlyRows.descEnd<monthlyRows.cardBottom);
 assert.deepEqual(await current(),custom);
 await assertVocCentered('month');
 await page.evaluate(()=>previewMonthlyPPT());
 const monthPreview=(await page.locator('#mnPvSlides').textContent()).replaceAll('\u00a0',' ');
 const monthlyTitle='CS 월간업무보고(2026.10.1~2026.10.31)';
 assert(monthPreview.includes(monthlyTitle));
 assert.match(monthPreview,/노즐 누수 발생 추이/);
 assert.match(monthPreview,/3건 · 30%/);
 assert.match(monthPreview,/교육·재사용 병원 현황/);
 assert.doesNotMatch(monthPreview,/특이사항/);
 await page.locator('#mnPvSlides > div').first().screenshot({path:path.join(out,'implemented-monthly-report.png')});
 await page.evaluate(()=>closeMnPreview());
 const monthlyDownload=page.waitForEvent('download');await page.evaluate(()=>makeMonthlyPPT());const monthFile=await monthlyDownload;
 assert.equal(monthFile.suggestedFilename(),monthlyTitle+'.pptx');
 await monthFile.saveAs(path.join(out,'sample-monthly-report.pptx'));
 const monthlyZip=await JSZip.loadAsync(await fs.readFile(path.join(out,'sample-monthly-report.pptx')));
 const monthlySlide=await monthlyZip.file('ppt/slides/slide1.xml').async('string');
 assert((await monthlyZip.file('docProps/core.xml').async('string')).includes('<dc:title>'+monthlyTitle+'</dc:title>'));
 assert(monthlySlide.includes(monthlyTitle));
 const monthVocSlide=monthlySlide.slice(monthlySlide.indexOf('>VOC 유형<'));
 assert.match(monthVocSlide,/3건 · 30%/);
 let lastMonthIndex=-1;
 for(const name of monthlyRows.names){
  const index=monthVocSlide.indexOf('>'+name+'<');
  assert(index>lastMonthIndex,'monthly PPT shows selected symptoms in the chosen order');
  lastMonthIndex=index;
 }
 assert(!monthVocSlide.includes('>'+monthlyExcluded+'<'));
 assert.match(monthlySlide,/교육·재사용 병원 현황/);
 assert.doesNotMatch(monthlySlide,/특이사항/);
 for(const xml of [slide,monthlySlide]){
  assert.match(xml,/노즐 누수 발생 추이/);
  assert.match(xml,/전체 서비스 건수/);
  assert.match(xml,/A\/S\(VOC\) 건수/);
  assert.match(xml,/점검 건수/);
  assert.doesNotMatch(xml,/노즐 누수\(약액 유입\) · 비율/);
 }
 assert.equal(await page.evaluate(()=>qaWriteFileCalls.length),2,'weekly and monthly both use original writeFile');
 console.log('PASS weekly and monthly title, filename, metadata, and monthly VOC grouping');
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
