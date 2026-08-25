/************************************************************
 * 주간 핵심보고 KPI → 처리 이력 필터 브라우저 검증
 * 실행: BASE=http://127.0.0.1:8099 node test/browser/dashboard-kpi-history-browser.mjs
 ************************************************************/
import { createRequire } from 'module';
import { execSync } from 'child_process';

let pw;
try { pw=(await import('playwright')).default; }
catch {
  const roots=[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES];
  try{roots.push(execSync('npm root -g').toString().trim());}catch{}
  for(const root of roots.filter(Boolean)){try{pw=createRequire(import.meta.url)(root+'/playwright');break;}catch{}}
}
if(!pw)throw new Error('playwright 모듈을 찾을 수 없습니다');
const {chromium}=pw,BASE=process.env.BASE||'http://127.0.0.1:8099';
let pass=0,total=0;const fails=[],errs=[];
function ck(name,cond,detail=''){total++;if(cond)pass++;else fails.push(name+(detail?' — '+detail:''));console.log(cond?'✅':'❌',name,detail);}

const DATA=[
  {date:'2026-08-10',hosp:'A병원',gubun:'A/S',cat:'핸드피스',type:'노즐 누수(약액 유입)',part:'내부 세척',fse:'김프로',ncare:'N-Care'},
  {date:'2026-08-11',hosp:'A병원',gubun:'A/S',cat:'핸드피스',type:'노즐누수(약액유입)',part:'내부세척',fse:'이기사',ncare:'N-Care'},
  {date:'2026-08-12',hosp:'B병원',gubun:'A/S',cat:'장비',type:'케이블 불량',part:'Cable Set',cost:'1,650,000',paid:'무상',fse:'김프로',ncare:'미가입'},
  {date:'2026-08-13',hosp:'C병원',gubun:'점검',cat:'핸드피스',type:'노즐 누수(약액 유입)',part:'없음',fse:'김프로',ncare:'미가입'},
  {date:'2026-08-14',hosp:'D병원',gubun:'점검',cat:'장비',type:'이상 없음',part:'없음',fse:'이기사',ncare:'미가입'},
  {date:'2026-08-04',hosp:'E병원',gubun:'A/S',cat:'핸드피스',type:'노즐 누수(약액 유입)',part:'내부 세척',fse:'김프로',ncare:'미가입'},
  {date:'2026-08-05',hosp:'F병원',gubun:'점검',cat:'장비',type:'이상 없음',part:'없음',fse:'이기사',ncare:'미가입'}
];

const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROME||undefined});
const ctx=await browser.newContext({viewport:{width:1680,height:960}});
await ctx.addInitScript(()=>{
  sessionStorage.setItem('baz_auth_token','tok-kpi');sessionStorage.setItem('baz_auth_level','3');
  sessionStorage.setItem('baz_auth_name','테스트');sessionStorage.setItem('baz_auth_expires',new Date(Date.now()+864e5).toISOString());
  sessionStorage.setItem('baz_auth_verified_ts',String(Date.now()));
  localStorage.setItem('baz_dash_view','exec');localStorage.setItem('baz_viewmode','window');
});
const page=await ctx.newPage();
page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
page.on('console',m=>{if(m.type()==='error'&&!/ERR_FAILED|ERR_ABORTED|ERR_CONNECTION/.test(m.text()))errs.push('CONSOLE: '+m.text());});
await page.route('**yuyoung-ai.deno.net/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,valid:true,level:3,name:'테스트'})}));
await page.route('**://script.google.com/**',r=>{
  const u=r.request().url();let body={success:true};
  if(u.includes('action=all'))body={success:true,data:DATA,updated:'2026-08-25 09:00'};
  else if(u.includes('action=hospdb'))body={success:true,data:[]};
  else if(u.includes('action=ping'))body={success:true};
  return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
});

await page.goto(BASE+'/dashboard-pc.html',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.DATA_READY===true);
await page.evaluate(()=>{F.from='2026-08-10';F.to='2026-08-14';buildFilters();apply();});

const dims=await page.locator('#exKpis [data-hist-dim]').evaluateAll(els=>els.map(e=>e.dataset.histDim));
ck('1. 주간 KPI 7개와 요청 카드 5개의 처리 이력 버튼이 렌더링',
  await page.locator('#exKpis .ex-kpi').count()===7&&['kpiTotal','kpiAs','kpiInsp','kpiHosp','kpiSaving'].every(x=>dims.includes(x)),JSON.stringify(dims));
ck('2. 추정 절감액은 내부 세척 2건 × 281,200원',
  (await page.textContent('#exKpis [data-hist-dim="kpiSaving"]')).includes('₩562,400'));

await page.click('#exMoreBtn');
await page.waitForSelector('#exDrawer.on');
let modal=await page.evaluate(()=>({
  years:[...document.querySelectorAll('#exYear .chip')].map(x=>x.textContent.trim()),
  months:[...document.querySelectorAll('#exMonth .chip')].map(x=>x.textContent.trim()),
  quarters:[...document.querySelectorAll('#exQuarter .chip')].map(x=>x.textContent.trim()),
  paid:[...document.querySelectorAll('#exPaid .chip')].map(x=>x.textContent.trim())
}));
ck('2-b. 보고 상세필터에 연·월·분기와 유상·무상 선택을 표시',
  modal.years.includes('2026년')&&modal.months.includes('8월')&&modal.quarters.includes('3분기')&&
  modal.paid.join('|')==='유상|무상',JSON.stringify(modal));
await page.click('#exQuarter [data-v="1"]');
modal=await page.evaluate(()=>({shown:document.getElementById('exFCount').textContent,quarter:F.quarter.slice()}));
ck('2-c. 보고 상세필터의 분기 선택을 상단 기간과 함께 실제 집계에 적용',
  modal.quarter[0]==='1'&&modal.shown.includes('표시 0건'),JSON.stringify(modal));
await page.click('#exQuarter [data-v="1"]');
await page.click('#exPaid [data-v="유상"]');
modal=await page.evaluate(()=>({shown:document.getElementById('exFCount').textContent,paid:F.paid.slice()}));
ck('2-d. 교체비용이 있는 기록만 유상 필터로 집계',
  modal.paid.length===1&&modal.paid[0]==='유상'&&modal.shown.includes('표시 1건'),JSON.stringify(modal));
await page.click('#exPaid [data-v="유상"]');
await page.click('#exMoreBtn');

await page.click('#exKpis [data-hist-dim="kpiTotal"]');
await page.waitForSelector('#exListModal.show');
modal=await page.evaluate(()=>({
  title:document.getElementById('exListTitle').textContent,
  count:document.getElementById('hstCount').textContent,
  breakdown:document.getElementById('hstBreakdown').textContent,
  hasType:!!document.getElementById('hstType'),
  evidence:document.querySelectorAll('.hst-evidence-thumb').length
}));
ck('3. 전체 서비스 이력은 선택 기간 5건과 구분·VOC 유형 건수를 표시',
  modal.title==='전체 서비스 건수'&&modal.count.includes('5건')&&modal.breakdown.includes('A/S 3건')
  &&modal.breakdown.includes('점검 2건')&&modal.breakdown.includes('VOC 유형별 건수')&&modal.hasType&&modal.evidence===0,JSON.stringify(modal));
await page.click('#hstBreakdown [data-hst-count-key="gubun"][data-hst-count-value="A/S"]');
modal=await page.evaluate(()=>({count:document.getElementById('hstCount').textContent,gubun:document.getElementById('hstGubun').value,
  rows:document.querySelectorAll('#hstTableHost tbody tr').length,other:!!document.querySelector('#hstBreakdown [data-hst-count-value="점검"]'),
  active:document.querySelector('#hstBreakdown [data-hst-count-value="A/S"]').getAttribute('aria-pressed')}));
ck('3-b. 구분 건수 칩 클릭 시 해당 구분 처리 이력만 표시',modal.gubun==='A/S'&&modal.rows===3&&modal.count.includes('3건'),JSON.stringify(modal));
ck('3-c. 선택 후에도 다른 구분 버튼이 유지되고 선택 상태가 강조',modal.other&&modal.active==='true',JSON.stringify(modal));
await page.click('#hstBreakdown [data-hst-count-key="gubun"][data-hst-count-value="A/S"]');
modal=await page.evaluate(()=>({gubun:document.getElementById('hstGubun').value,rows:document.querySelectorAll('#hstTableHost tbody tr').length}));
ck('3-d. 같은 구분 칩을 다시 누르면 해당 필터만 해제',modal.gubun==='all'&&modal.rows===5,JSON.stringify(modal));
await page.click('#hstBreakdown [data-hst-count-key="gubun"][data-hst-count-value="A/S"]');
await page.click('#hstBreakdown [data-hst-count-key="gubun"][data-hst-count-value="점검"]');
modal=await page.evaluate(()=>({gubun:document.getElementById('hstGubun').value,rows:document.querySelectorAll('#hstTableHost tbody tr').length}));
ck('3-e. 같은 그룹의 다른 구분 칩을 누르면 즉시 전환',modal.gubun==='점검'&&modal.rows===2,JSON.stringify(modal));
await page.evaluate(()=>exResetHistoryFilters_());
await page.click('#hstBreakdown [data-hst-count-key="type"][data-hst-count-value="케이블 불량"]');
modal=await page.evaluate(()=>({count:document.getElementById('hstCount').textContent,breakdown:document.getElementById('hstBreakdown').textContent,type:document.getElementById('hstType').value}));
ck('4. VOC 유형별 건수 칩 클릭 시 표시 건수와 두 요약이 함께 갱신',
  modal.type==='케이블 불량'&&modal.count.includes('1건')&&modal.breakdown.includes('A/S 1건')&&modal.breakdown.includes('케이블 불량 1건'),JSON.stringify(modal));
modal=await page.evaluate(()=>({title:document.getElementById('hstPhotoTitle').textContent,
  panelHidden:document.getElementById('hstPhotoPanel').hidden,bodyHidden:document.getElementById('hstPhotoBody').hidden,
  expanded:document.getElementById('hstPhotoToggle').getAttribute('aria-expanded'),
  thumbs:document.querySelectorAll('#hstPhotoPanel .hst-evidence-thumb').length,status:document.getElementById('hstPhotoStatus').textContent}));
ck('4-b. VOC 유형을 골라도 예시 본문은 기본 접힘으로 필터와 이력 목록을 우선 표시',
  modal.title.includes('케이블 불량')&&!modal.panelHidden&&modal.bodyHidden&&modal.expanded==='false'&&modal.thumbs===0&&modal.status.includes('접힘'),JSON.stringify(modal));
await page.click('#hstPhotoToggle');
await page.waitForSelector('#hstPhotoBody:not([hidden]) .hst-evidence-thumb');
modal=await page.evaluate(()=>({thumbs:document.querySelectorAll('#hstPhotoPanel .hst-evidence-thumb').length,
  bodyHidden:document.getElementById('hstPhotoBody').hidden,expanded:document.getElementById('hstPhotoToggle').getAttribute('aria-expanded'),
  status:document.getElementById('hstPhotoStatus').textContent}));
ck('4-c. 예시자료 보기 버튼을 눌렀을 때만 선택 유형 미리보기를 표시',
  !modal.bodyHidden&&modal.expanded==='true'&&modal.thumbs===1&&modal.status.includes('표준 예시'),JSON.stringify(modal));
await page.click('#hstPhotoPanel .hst-evidence-thumb');
await page.waitForSelector('#hstEvidenceViewer:not([hidden])');
ck('4-d. VOC 예시자료가 절감 근거자료와 같은 전체화면 뷰어를 사용',
  (await page.getAttribute('#hstEvidenceImage','src')).includes('equipment-cable')&&
  (await page.getAttribute('#hstEvidenceViewer','aria-label')).includes('선택 VOC 유형 예시자료'));
await page.evaluate(()=>exCloseSavingEvidence_());
await page.click('#hstPhotoToggle');
modal=await page.evaluate(()=>({bodyHidden:document.getElementById('hstPhotoBody').hidden,
  expanded:document.getElementById('hstPhotoToggle').getAttribute('aria-expanded'),label:document.getElementById('hstPhotoToggle').textContent}));
ck('4-e. 같은 버튼을 다시 누르면 예시 본문이 즉시 접힌다',
  modal.bodyHidden&&modal.expanded==='false'&&modal.label.includes('보기'),JSON.stringify(modal));
await page.evaluate(()=>closeExList());

async function openAndRead(dim){
  await page.click('#exKpis [data-hist-dim="'+dim+'"]');
  await page.waitForSelector('#exListModal.show');
  const out=await page.evaluate(()=>({
    title:document.getElementById('exListTitle').textContent,
    count:document.getElementById('hstCount').textContent,
    rows:document.querySelectorAll('#hstTableHost tbody tr').length,
    text:document.getElementById('exListBody').textContent
  }));
  await page.evaluate(()=>closeExList()); return out;
}
const asHist=await openAndRead('kpiAs'), inspHist=await openAndRead('kpiInsp'), hospHist=await openAndRead('kpiHosp'), savingHist=await openAndRead('kpiSaving');
ck('5. A/S 카드 이력은 A/S 3건으로 제한',asHist.rows===3&&asHist.text.includes('A/S 3건')&&!asHist.text.includes('점검 2건'),JSON.stringify(asHist));
ck('6. 점검 카드 이력은 점검 2건으로 제한',inspHist.rows===2&&inspHist.text.includes('점검 2건')&&!inspHist.text.includes('A/S 3건'),JSON.stringify(inspHist));
ck('7. 서비스 병원 카드는 중복 제거 4곳과 처리 5건을 함께 표시',
  hospHist.count.includes('4곳')&&hospHist.count.includes('처리 5건'),JSON.stringify(hospHist));
ck('8. 절감액 이력은 내부 세척 2건과 562,400원만 표시',
  savingHist.rows===2&&savingHist.count.includes('₩562,400')&&savingHist.text.includes('내부 세척 2건'),JSON.stringify(savingHist));
await page.click('#exKpis [data-hist-dim="kpiSaving"]');
await page.waitForSelector('#exListModal.show');
ck('9. 절감액 이력 상단에 근거자료 미리보기 4장을 표시',
  await page.locator('#exListBody .hst-evidence-thumb').count()===4&&
  (await page.textContent('#exListBody .hst-evidence-head')).includes('281,208원 절사'));
await page.locator('#exListBody .hst-evidence-thumb').nth(1).click();
await page.waitForSelector('#hstEvidenceViewer:not([hidden])');
let viewer=await page.evaluate(()=>({
  title:document.getElementById('hstEvidenceTitle').textContent,
  src:document.getElementById('hstEvidenceImage').getAttribute('src'),
  count:document.getElementById('hstEvidenceCount').textContent,
  fullscreen:[...document.querySelectorAll('#hstEvidenceViewer button')].some(b=>b.textContent.includes('전체화면'))
}));
ck('10. 근거자료를 화면 전체 뷰어로 열고 원본·전체화면 기능을 제공',
  viewer.title.includes('화학적 세척')&&viewer.src.endsWith('handpiece-quality-review-02.png')&&viewer.count==='2 / 4'&&viewer.fullscreen,JSON.stringify(viewer));
await page.keyboard.press('ArrowRight');
ck('11. 키보드로 다음 근거자료 이동',
  (await page.getAttribute('#hstEvidenceImage','src')).endsWith('handpiece-quality-review-03.png')&&await page.textContent('#hstEvidenceCount')==='3 / 4');
await page.keyboard.press('Escape');
ck('12. Escape로 전체화면 뷰어 닫기',await page.locator('#hstEvidenceViewer').getAttribute('hidden')!==null);
await page.evaluate(()=>closeExList());

await page.click('[data-tab="year"]');
await page.waitForSelector('#exPaneYear.on');
ck('13. 연간 비교분석 절감액 카드에도 근거자료 버튼 적용',await page.locator('#exPaneYear .yc-kpi-evidence').count()>=1);
await page.locator('#exPaneYear .yc-kpi-evidence').first().click();
await page.waitForSelector('#hstEvidenceViewer:not([hidden])');
ck('14. 연간 절감액 카드가 같은 근거자료 뷰어를 연다',
  (await page.getAttribute('#hstEvidenceImage','src')).endsWith('handpiece-quality-review-01.png'));
await page.evaluate(()=>exCloseSavingEvidence_());
await page.click('[data-tab="summary"]');
await page.waitForSelector('#exPaneSummary.on');
ck('15. PC에서 7개 KPI가 한 줄로 배치',await page.evaluate(()=>getComputedStyle(document.getElementById('exKpis')).gridTemplateColumns.split(' ').length===7));
ck('16. 런타임 오류가 없다',errs.length===0,errs.join(' | '));

await browser.close();
console.log('\n──────────────────────────────');console.log(`통과 ${pass}/${total}`);
if(fails.length){console.log('실패:');fails.forEach(x=>console.log(' -',x));process.exit(1);}console.log('모든 테스트 통과 ✅');
