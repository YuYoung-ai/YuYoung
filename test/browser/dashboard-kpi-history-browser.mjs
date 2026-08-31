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
  {date:'2026-08-05',hosp:'F병원',gubun:'점검',cat:'장비',type:'이상 없음',part:'없음',fse:'이기사',ncare:'미가입'},
  {date:'2026-07-20',hosp:'A병원',gubun:'A/S',cat:'핸드피스',type:'노즐누수(약액유입)',part:"Handpiece Ass'y",fse:'이전기사',sn:'HP-OLD',detail:'과거 누수 · 핸드피스 교체'},
  {date:'2025-03-10',hosp:'G병원',gubun:'A/S',cat:'장비',type:'풋스위치 불량',part:'Foot s/w',fse:'김프로',ncare:'미가입'},
  {date:'2025-07-11',hosp:'H병원',gubun:'점검',cat:'장비',type:' 풋 스위치 동작 불능 ',part:'없음',fse:'이기사',ncare:'미가입'},
  {date:'2026-01-12',hosp:'I병원',gubun:'A/S',cat:'장비',type:'풋스위치 작동 불량',part:'Foot s/w',fse:'김프로',ncare:'미가입'}
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
await page.evaluate(()=>{F.from='2026-08-10';F.to='2026-08-15';buildFilters();apply();});  /* 보고 주 = 월~토 */

const dims=await page.locator('#exKpis [data-hist-dim]').evaluateAll(els=>els.map(e=>e.dataset.histDim));
ck('1. 주간 KPI는 N-Care 운영률·서비스 병원 수를 제외한 5개이며 모두 처리 이력 버튼',
  await page.locator('#exKpis .ex-kpi').count()===5&&
  ['kpiTotal','kpiAs','kpiInsp','cost','kpiSaving'].every(x=>dims.includes(x))&&
  !(await page.textContent('#exKpis')).includes('N-CARE 점검 운영률')&&
  !(await page.textContent('#exKpis')).includes('서비스 병원 수'),JSON.stringify(dims));
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
ck('3. 전체 서비스 이력은 최신 선택 4건과 구분·VOC 유형 건수를 표시',
  modal.title==='전체 서비스 건수'&&modal.count.startsWith('4건')&&modal.breakdown.includes('A/S 2건')
  &&modal.breakdown.includes('점검 2건')&&modal.breakdown.includes('VOC 유형별 건수')&&modal.hasType&&modal.evidence===0,JSON.stringify(modal));
await page.click('#hstBreakdown [data-hst-count-key="gubun"][data-hst-count-value="A/S"]');
modal=await page.evaluate(()=>({count:document.getElementById('hstCount').textContent,gubun:document.getElementById('hstGubun').value,
  rows:document.querySelectorAll('#hstTableHost tbody tr').length,other:!!document.querySelector('#hstBreakdown [data-hst-count-value="점검"]'),
  active:document.querySelector('#hstBreakdown [data-hst-count-value="A/S"]').getAttribute('aria-pressed')}));
ck('3-b. 구분 건수 칩 클릭 시 해당 구분 처리 이력만 표시',modal.gubun==='A/S'&&modal.rows===2&&modal.count.startsWith('2건'),JSON.stringify(modal));
ck('3-c. 선택 후에도 다른 구분 버튼이 유지되고 선택 상태가 강조',modal.other&&modal.active==='true',JSON.stringify(modal));
await page.click('#hstBreakdown [data-hst-count-key="gubun"][data-hst-count-value="A/S"]');
modal=await page.evaluate(()=>({gubun:document.getElementById('hstGubun').value,rows:document.querySelectorAll('#hstTableHost tbody tr').length}));
ck('3-d. 같은 구분 칩을 다시 누르면 해당 필터만 해제',modal.gubun==='all'&&modal.rows===4,JSON.stringify(modal));
await page.click('#hstBreakdown [data-hst-count-key="gubun"][data-hst-count-value="A/S"]');
await page.click('#hstBreakdown [data-hst-count-key="gubun"][data-hst-count-value="점검"]');
modal=await page.evaluate(()=>({gubun:document.getElementById('hstGubun').value,rows:document.querySelectorAll('#hstTableHost tbody tr').length}));
ck('3-e. 같은 그룹의 다른 구분 칩을 누르면 즉시 전환',modal.gubun==='점검'&&modal.rows===2,JSON.stringify(modal));
ck('3-f. 점검에 없는 0건 VOC 유형 칩은 숨김',
  await page.locator('#hstBreakdown [data-hst-count-key="type"][data-hst-count-value="케이블 불량"]').count()===0&&
  await page.locator('#hstBreakdown [data-hst-count-key="type"]').count()===2);
await page.selectOption('#hstType','케이블 불량');
ck('3-g. 선택한 0건 유형은 칩만 숨기고 드롭다운에서 해제 가능',
  await page.inputValue('#hstType')==='케이블 불량'&&await page.locator('#hstTableHost tbody tr').count()===0&&
  await page.locator('#hstBreakdown [data-hst-count-key="type"].is-zero').count()===0);
await page.selectOption('#hstType','all');
ck('3-h. 드롭다운 해제로 이력 복구',await page.locator('#hstTableHost tbody tr').count()===2);
await page.evaluate(()=>exResetHistoryFilters_());
ck('3-i. 조건 초기화 시 양수로 돌아온 유형 칩 복원',
  await page.locator('#hstBreakdown [data-hst-count-key="type"][data-hst-count-value="케이블 불량"]').count()===1);
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
const asHist=await openAndRead('kpiAs'), inspHist=await openAndRead('kpiInsp'), savingHist=await openAndRead('kpiSaving');
ck('5. A/S 카드 이력은 최신 A/S 2건으로 제한',asHist.rows===2&&asHist.text.includes('A/S 2건')&&!asHist.text.includes('점검 2건'),JSON.stringify(asHist));
ck('6. 점검 카드 이력은 점검 2건으로 제한',inspHist.rows===2&&inspHist.text.includes('점검 2건')&&!inspHist.text.includes('A/S 3건'),JSON.stringify(inspHist));
ck('8. 절감액 이력은 최신 내부 세척 1건과 281,200원 표시',
  savingHist.rows===1&&savingHist.count.includes('₩281,200')&&savingHist.count.includes('내부 세척 1건'),JSON.stringify(savingHist));
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
ck('15. PC에서 5개 KPI가 한 줄로 배치',await page.evaluate(()=>getComputedStyle(document.getElementById('exKpis')).gridTemplateColumns.split(' ').length===5));

/* 공백이 다른 누수 VOC도 실제 로딩 → 카드 → 필터 → 이력이 같은 이름/건수로 이어진다. */
await page.click('[data-tab="cause"]');
await page.waitForSelector('#exPaneCause.on');
let normalized=await page.evaluate(()=>({
  cause:exVocTypeCompare_(EX_ROWS,null).filter(t=>hpIsLeakVoc_({type:t.k})),
  leak:buildNozzleLeakCurrent_().leaks,
  variants:RAW.filter(r=>hpIsLeakVoc_(r)&&r.type!=='노즐 누수(약액 유입)').length
}));
ck('15-a. 원인 분석의 누수 항목을 표준 이름 3건으로 합산하고 누수 분석과 일치',
  normalized.cause.length===1&&normalized.cause[0].k==='노즐 누수(약액 유입)'&&
  normalized.cause[0].cur===3&&normalized.leak===3&&normalized.variants===0,JSON.stringify(normalized));
await page.click('#exTypeCard [data-hist-k="노즐 누수(약액 유입)"]');
await page.waitForSelector('#exListModal.show');
normalized=await page.evaluate(()=>({
  rows:document.querySelectorAll('#hstTableHost tbody tr').length,
  options:[...document.getElementById('hstType').options].map(o=>o.value),
  breakdown:document.getElementById('hstBreakdown').textContent
}));
ck('15-b. 원인 분석 카드 원본 3건에서 최신 선택 2건 표시',normalized.rows===2,JSON.stringify(normalized));
ck('15-c. 이력 유형 선택과 건수 칩도 표준 이름 하나로 표시',
  normalized.options.includes('노즐 누수(약액 유입)')&&!normalized.options.includes('노즐누수(약액유입)')&&
  normalized.breakdown.includes('노즐 누수(약액 유입) 2건'),JSON.stringify(normalized));
await page.selectOption('#hstPeriod','prev');
ck('15-d. E병원을 제외하고 A병원의 선택 기간 안 직전 이력을 연결',
  await page.locator('#hstTableHost tbody tr').count()===1&&
  (await page.textContent('#hstTableHost')).includes('2026-08-10')&&
  (await page.textContent('#hstTableHost')).includes('A병원')&&
  !(await page.textContent('#hstTableHost')).includes('E병원'));
await page.selectOption('#hstPeriod','all');
const paired=await page.locator('#hstTableHost tbody tr').allTextContents();
ck('15-d2. 전체 기간은 최신 선택 1건 아래 공유 비교행 1건을 표시',
  paired.length===3&&paired[1].includes('2026-08-11')&&paired[2].includes('2026-08-10')&&paired[2].includes('비교 · 동일비교'),JSON.stringify(paired));
ck('15-d3. 최신 선택일 기준 두 경과일 모두 1일 표시',
  (paired[1].match(/1일/g)||[]).length===2&&paired[0].includes('비교 이력 없음'));
await page.evaluate(()=>closeExList());
await page.evaluate(()=>{F.type=['노즐 누수(약액 유입)'];apply();});
ck('15-e. 공통 유형 필터에서도 공백 변형 기록을 누락하지 않음',await page.evaluate(()=>EX_ROWS.length===3));
await page.evaluate(()=>{F.type=[];apply();});
await page.click('[data-tab="leak"]');
await page.waitForSelector('#exPaneLeak.on');
ck('15-f. 누수 분석 카드 역시 같은 기간 3건 표시',(await page.textContent('#exLeakKpis [data-hist-dim="leak:total"] b'))==='3건');
async function footCount(year){
  await page.evaluate(y=>{F.from='';F.to='';F.year=y?[String(y)]:[];F.type=[];buildFilters();apply();},year);
  await page.click('[data-tab="cause"]');
  await page.waitForSelector('#exPaneCause.on');
  const btn=page.locator('#exTypeCard [data-hist-k="풋스위치 작동 불량"]');
  return Number((await btn.locator('.vl').textContent()).replace(/,/g,''));
}
const foot2025=await footCount(2025),foot2026=await footCount(2026),footAll=await footCount(null);
ck('15-g. 풋스위치 전체 기간 TOP5가 2025년·2026년 합계와 일치',
  foot2025===2&&foot2026===1&&footAll===foot2025+foot2026,
  JSON.stringify({foot2025,foot2026,footAll}));
ck('15-h. 전체 기간에는 구형 명칭 없이 현재 표준명 하나만 표시',await page.evaluate(()=>
  RAW.every(r=>!/풋\s*스위치\s*(?:불량|동작\s*불능)/.test(String(r.type||''))||r.type==='풋스위치 작동 불량')));
await page.click('#exTypeCard [data-hist-k="풋스위치 작동 불량"]');
await page.waitForSelector('#exListModal.show');
ck('15-i. 전체 기간 TOP5 풋스위치 3건과 처리이력 3건이 일치',await page.locator('#hstTableHost tbody tr').count()===3);
await page.evaluate(()=>closeExList());
ck('16. 런타임 오류가 없다',errs.length===0,errs.join(' | '));

await browser.close();
console.log('\n──────────────────────────────');console.log(`통과 ${pass}/${total}`);
if(fails.length){console.log('실패:');fails.forEach(x=>console.log(' -',x));process.exit(1);}console.log('모든 테스트 통과 ✅');
