/************************************************************
 * dashboard-pc.html · 노즐 누수 분석 탭 브라우저 검증
 * 실행: npx http-server . -p 8099 -s &
 *       BASE=http://127.0.0.1:8099 node test/browser/dashboard-nozzle-leak-browser.mjs
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
  {date:'2026-08-08',hosp:'A병원',gubun:'점검',type:'이상 없음',nozzleReuse:'O',nsFill:'X',ncare:'N-Care'},
  {date:'2026-08-09',hosp:'B병원',gubun:'점검',type:'이상 없음',nozzleReuse:'X',nsFill:'O',nsAmt:'적정',jet:'정상',ncare:'미가입'},
  {date:'2026-08-09',hosp:'C병원',gubun:'점검',type:'이상 없음',nozzleReuse:'X',nsAmt:'부족',ncare:'미가입'},
  {date:'2026-08-10',hosp:'A병원',gubun:'A/S',fse:'처리가',type:'노즐 누수(약액 유입)',ncare:'N-Care'},
  {date:'2026-08-11',hosp:'B병원',gubun:'A/S',fse:'처리나',type:'노즐 누수(약액 유입)',ncare:'미가입'},
  {date:'2026-08-12',hosp:'B병원',gubun:'A/S',fse:'처리나',type:'노즐누수(약액유입)',ncare:'미가입'},
  {date:'2026-08-12',hosp:'C병원',gubun:'점검',type:'케이블 불량',ncare:'미가입'},
  {date:'2026-08-13',hosp:'D병원',gubun:'점검',fse:'처리가',type:'노즐 누수(약액 유입)',ncare:'미가입'}
];
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROME||undefined});
const ctx=await browser.newContext({viewport:{width:1440,height:900}});
await ctx.addInitScript(()=>{
  sessionStorage.setItem('baz_auth_token','tok-smoke');sessionStorage.setItem('baz_auth_level','3');
  sessionStorage.setItem('baz_auth_name','테스트');sessionStorage.setItem('baz_auth_expires',new Date(Date.now()+864e5).toISOString());
  sessionStorage.setItem('baz_auth_verified_ts',String(Date.now()));
  localStorage.setItem('baz_dash_view','exec');localStorage.setItem('baz_viewmode','window');
});
const page=await ctx.newPage();
page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
page.on('console',m=>{if(m.type()==='error'&&!/ERR_FAILED|ERR_ABORTED|ERR_CONNECTION/.test(m.text()))errs.push('CONSOLE: '+m.text());});
await page.route('**yuyoung-ai.deno.net/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,valid:true,level:3,name:'테스트'})}));
let apiCalls=0;
await page.route('**://script.google.com/**',r=>{
  apiCalls++;
  const u=r.request().url();let body={success:true};
  if(u.includes('action=all'))body={success:true,data:DATA,updated:'2026-08-17 09:00'};
  else if(u.includes('action=hospdb'))body={success:true,data:[{n:'A병원',sale:'영업가'},{n:'B병원',sale:'영업나'}]};
  else if(u.includes('action=ping'))body={success:true};
  return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
});

await page.goto(BASE+'/dashboard-pc.html',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.DATA_READY===true&&!DASH_LOAD_IN_FLIGHT);
const initialCalls=apiCalls;
await page.evaluate(()=>{F.from='2026-08-10';F.to='2026-08-14';buildFilters();apply();});
await page.click('[data-tab="leak"]');
await page.waitForSelector('#exPaneLeak.on');
ck('1. 누수 분석 탭이 표시된다',await page.isVisible('#exPaneLeak'));
const leakFilterUi=await page.evaluate(()=>( {
  ignored:['exTypeGroup','exNozGroup','exSkillGroup'].every(id=>document.getElementById(id).classList.contains('ignored')),
  disabled:['exTypeGroup','exNozGroup','exSkillGroup'].every(id=>[...document.getElementById(id).querySelectorAll('button,input')].every(el=>el.disabled)),
  note:document.getElementById('exTabFilterNote').textContent
}));
ck('1-b. 누수 탭에서 제외되는 필터를 비활성·안내 표시',
  leakFilterUi.ignored&&leakFilterUi.disabled&&leakFilterUi.note.includes('유형·노즐·교육 상태 필터 제외'),JSON.stringify(leakFilterUi));
ck('2. 핵심 지표가 실제 집계값으로 표시된다',(await page.textContent('#exLeakKpis [data-hist-dim="leak:total"] b'))==='4건');
ck('3. 사용방식·교육 비교 막대가 각각 두 개다',await page.locator('#exLeakNozzleCard .nl-bar-row').count()===2&&await page.locator('#exLeakSkillCard .nl-bar-row').count()===2);
/* 막대 채움이 span 이라 display:block 이 빠지면 inline 으로 남아 0×0 으로 그려진다 — 실제 렌더 크기를 잰다 */
const fillBoxes=await page.evaluate(()=>[...document.querySelectorAll('#exPaneLeak .nl-bar-fill')]
  .map(f=>{const b=f.getBoundingClientRect();return {w:b.width,h:b.height};}));
ck('4. 비교 막대 채움이 실제 크기로 그려진다',fillBoxes.length===4&&fillBoxes.every(b=>b.w>0&&b.h>0),JSON.stringify(fillBoxes));
/* 경고색은 배열 순서가 아니라 위험군(노즐 재사용 · 교육 미흡)에 붙어야 한다 */
const alerts=await page.evaluate(()=>({
  noz:[...document.querySelectorAll('#exLeakNozzleCard .nl-bar-row')].map(r=>r.querySelector('.nl-bar-fill').classList.contains('alert')),
  skl:[...document.querySelectorAll('#exLeakSkillCard .nl-bar-row')].map(r=>r.querySelector('.nl-bar-fill').classList.contains('alert'))}));
ck('5. 경고색은 재사용·교육 미흡 그룹에만 붙는다',
  alerts.noz[0]===true&&alerts.noz[1]===false&&alerts.skl[0]===false&&alerts.skl[1]===true,JSON.stringify(alerts));
ck('6. 2×2 교차분석 셀이 네 개다',await page.locator('#exLeakMatrixCard .nl-heat').count()===4);
const lowMarks=await page.evaluate(()=>[...document.querySelectorAll('#exLeakMatrixCard .nl-heat.lowest')].map(el=>({
  mark:el.querySelector('.nl-low-mark')?.textContent,
  title:el.title,
  border:getComputedStyle(el).borderColor
})));
ck('6-b. 최저 발생 비율 셀에 청록색 최저 표시가 렌더링된다',
  lowMarks.length===1&&lowMarks[0].mark==='최저'&&lowMarks[0].title.includes('비교 그룹 중 최저 비율')
  &&lowMarks[0].border==='rgb(22, 133, 116)',JSON.stringify(lowMarks));
ck('7. 마지막 평가 기준 문구만 사용한다',!(await page.textContent('#exPaneLeak')).includes('최근 평가'));
const detailText=await page.textContent('#exLeakDetailCard');
ck('8. 병원별 평가일·상태·누수 건수를 함께 표시한다',['노즐 평가일','교육 평가일','사용방식','교육 상태','누수'].every(x=>detailText.includes(x)));
ck('8-a. 집계 기준 버튼 대신 짧은 포함 안내만 표시',
  await page.locator('.nl-kpi-basis').count()===0&&(await page.textContent('#exLeakKpis')).includes('A/S·점검 포함 · 미평가 포함')
  &&!(await page.textContent('#exLeakKpis')).includes('띄어쓰기')
  &&!(await page.textContent('#exLeakKpis')).includes('구분 필터 선택'));
const inlineNote=await page.locator('#exLeakKpis .nl-kpi').first().evaluate(el=>{
  const n=el.querySelector('b').getBoundingClientRect(),m=el.querySelector('.nl-kpi-meta').getBoundingClientRect();
  return {beside:m.left>=n.right&&m.top<n.bottom,height:el.getBoundingClientRect().height,font:getComputedStyle(el.querySelector('b')).fontSize};
});
ck('8-a2. PC에서는 건수 오른쪽에 안내 표시·32px 수치·낮은 카드 높이',inlineNote.beside&&inlineNote.font==='32px'&&inlineNote.height<100,JSON.stringify(inlineNote));
ck('8-b. 교차분석의 미평가 제외·분모 기준을 정확히 표시',
  (await page.textContent('#exLeakMatrixCard')).includes('두 평가가 모두 있는 병원만 분석 · 미평가 제외')
  &&!(await page.textContent('#exLeakMatrixCard')).includes('전체 누수 중'));
for(const [key,n] of [['total',4],['reuse',1],['single',2],['good',2],['need',1]]){
  await page.click('#exLeakKpis [data-hist-dim="leak:'+key+'"]');
  await page.waitForSelector('#exListModal.show');
  const state=await page.evaluate(()=>({count:EX_HISTORY_STATE.filtered.length,
    rows:[...document.querySelectorAll('#hstTableHost tbody tr')].length,
    valid:EX_HISTORY_STATE.filtered.every(it=>it.r.date>='2026-08-10'&&hpIsLeakVoc_(it.r)),
    controls:['hstPeriod','hstGubun','hstType','hstFse','hstSales','hstQuery'].every(id=>!!document.getElementById(id)),
    salesCollapsed:!EX_HISTORY_STATE.salesCountsExpanded,previewCollapsed:!EX_HISTORY_STATE.typeExampleExpanded}));
  ck('8-c. '+key+' 카드의 '+n+'건과 공통 이력 필터가 정확히 일치',state.count===n&&state.rows===n&&state.valid&&state.controls&&state.salesCollapsed&&state.previewCollapsed,JSON.stringify(state));
  await page.click('#exListModal .mbtn.cancel');
}
await page.click('#exLeakKpis [data-hist-dim="leak:total"]');
await page.selectOption('#hstGubun','점검');
ck('8-d. 누수 이력 구분 필터는 점검 중 누수 1건만 표시',await page.locator('#hstTableHost tbody tr').count()===1);
await page.click('#exListModal .hst-reset');
await page.selectOption('#hstFse','처리나');
ck('8-e. 처리 담당자 필터 적용',await page.locator('#hstTableHost tbody tr').count()===2);
await page.click('#exListModal .hst-reset');
await page.fill('#hstQuery','B병원');
ck('8-f. 병원 검색으로 복수 처리기록 조회',await page.locator('#hstTableHost tbody tr').count()===2);
await page.selectOption('#hstSales','영업가');
ck('8-g. 서로 교집합이 없는 조건은 0건 표시',await page.locator('#hstTableHost tbody tr').count()===0);
await page.click('#exListModal .hst-reset');
await page.click('#hstSalesCountsToggle');
await page.click('#hstBreakdown [data-hst-count-key="sales"][data-hst-count-value="영업나"]');
ck('8-h. 영업담당자 건수 칩도 이력 필터와 연결',await page.locator('#hstTableHost tbody tr').count()===2);
await page.evaluate(()=>applyHospDB_([{n:'A병원',sale:'영업가'},{n:'B병원',sale:'영업나'}]));
ck('8-i. 병원DB 갱신 후에도 누수 카드 범위·필터·펼침 상태 유지',
  await page.inputValue('#hstSales')==='영업나'&&await page.locator('#hstTableHost tbody tr').count()===2
  &&await page.getAttribute('#hstSalesCountsToggle','aria-expanded')==='true');
await page.click('#exListModal .mbtn.cancel');
await page.evaluate(()=>{F.type=['케이블 불량'];F.noz=['reuse'];F.skill=['need'];apply();});
await page.click('#exLeakKpis [data-hist-dim="leak:total"]');
ck('8-j. 누수 탭에서 제외하는 상단 필터가 이력에도 잘못 적용되지 않음',await page.locator('#hstTableHost tbody tr').count()===4);
await page.click('#exListModal .mbtn.cancel');
await page.evaluate(()=>{F.type=[];F.noz=[];F.skill=[];F.gubun=['점검'];apply();});
await page.click('#exLeakKpis [data-hist-dim="leak:reuse"]');
ck('8-k. 0건 카드도 빈 이력 조회·필터 초기화 가능',await page.locator('#hstTableHost tbody tr').count()===0&&await page.locator('#exListModal .hst-reset').isVisible());
await page.click('#exListModal .mbtn.cancel');
await page.evaluate(()=>{F.gubun=[];apply();});
const fontBefore=await page.locator('#exLeakKpis .nl-kpi').first().evaluate(el=>({label:getComputedStyle(el.querySelector('.nl-label')).fontSize,value:getComputedStyle(el.querySelector('b')).fontSize}));
await page.evaluate(()=>{
  window.TEST_ORIGINAL_NL_DEFS=nlKpiDefs_;
  nlKpiDefs_=function(){return TEST_ORIGINAL_NL_DEFS().concat(Array.from({length:7},(_,i)=>({key:'extra'+i,label:'추가 카드 '+i,group:['nozzle','unknown']})));};
  renderExecutiveLeak();
});
const expandedGrid=await page.evaluate(()=>{const list=[...document.querySelectorAll('#exLeakKpis .nl-kpi')];return {
  count:list.length,lines:new Set(list.map(el=>el.offsetTop)).size,
  fixed:list.every(el=>getComputedStyle(el.querySelector('b')).fontSize==='32px'&&getComputedStyle(el.querySelector('.nl-label')).fontSize==='13px'),
  scroll:getComputedStyle(document.getElementById('exPaneLeak')).overflowY};});
ck('8-l. 12개 카드로 늘어나도 글자는 동일하고 행·스크롤만 늘어남',expandedGrid.count===12&&expandedGrid.lines>1&&expandedGrid.fixed&&expandedGrid.scroll==='auto'&&fontBefore.value==='32px',JSON.stringify(expandedGrid));
await page.click('#exLeakKpis [data-hist-dim="leak:extra0"]');
ck('8-m. 새 카드도 별도 이벤트 코드 없이 같은 처리이력 필터 연결',await page.locator('#hstTableHost tbody tr').count()===1&&(await page.textContent('#hstTableHost')).includes('D병원'));
await page.click('#exListModal .mbtn.cancel');
await page.evaluate(()=>{nlKpiDefs_=TEST_ORIGINAL_NL_DEFS;renderExecutiveLeak();});
if(process.env.SHOT)await page.screenshot({path:process.env.SHOT,fullPage:true});
await page.click('#themeToggle');
ck('8-n. 다크모드에서도 카드 제목·수치 크기는 유지',await page.locator('#exLeakKpis .nl-kpi').first().evaluate(el=>
  getComputedStyle(el.querySelector('b')).fontSize==='32px'&&getComputedStyle(el.querySelector('.nl-label')).fontSize==='13px'));
if(process.env.SHOT)await page.screenshot({path:process.env.SHOT.replace('.png','-dark.png'),fullPage:true});
await page.click('#themeToggle');
await page.locator('#exLeakNozzleCard .nl-bar-row').first().click();
await page.waitForSelector('#exListModal.show');
ck('9. 그래프 클릭으로 해당 병원 명단이 열린다',(await page.textContent('#exListTitle')).includes('재사용')&&(await page.textContent('#exListBody')).includes('A병원'));
await page.evaluate(()=>closeExList());
ck('10. PC에서 분석 패널이 화면 폭을 넘지 않는다',await page.evaluate(()=>document.getElementById('exPaneLeak').getBoundingClientRect().right<=innerWidth+1));
await page.click('[data-mode="mobile"]');
ck('11. 모바일 보기에서 비교 영역이 한 열로 바뀐다',await page.evaluate(()=>getComputedStyle(document.querySelector('.nl-grid')).gridTemplateColumns.split(' ').length===1&&document.body.classList.contains('ex-narrow')));
await page.setViewportSize({width:390,height:844});
const mobile=await page.locator('#exLeakKpis').evaluate(el=>({overflow:el.scrollWidth>el.clientWidth,
  fonts:[...el.querySelectorAll('b')].every(b=>getComputedStyle(b).fontSize==='32px')}));
ck('11-c. 390px 모바일에서도 글자 크기 유지·카드 가로 넘침 없음',!mobile.overflow&&mobile.fonts,JSON.stringify(mobile));
ck('11-c2. 좁은 카드에서 안내만 다음 줄로 이동',await page.locator('#exLeakKpis .nl-kpi').first().evaluate(el=>{
  const n=el.querySelector('b').getBoundingClientRect(),m=el.querySelector('.nl-kpi-meta').getBoundingClientRect();
  return m.top>=n.bottom&&el.scrollWidth<=el.clientWidth;
}));
await page.click('#exLeakKpis [data-hist-dim="leak:total"]');
ck('11-d. 모바일 처리이력은 4건·필터를 정상 표시',await page.locator('#hstTableHost tbody tr').count()===4&&await page.locator('#hstGubun').isVisible());
if(process.env.SHOT)await page.screenshot({path:process.env.SHOT.replace('.png','-mobile-history.png'),fullPage:true});
await page.click('#exListModal .mbtn.cancel');
await page.setViewportSize({width:1440,height:900});
await page.click('[data-tab="summary"]');
const summaryFilterUi=await page.evaluate(()=>( {
  ignored:['exTypeGroup','exNozGroup','exSkillGroup'].some(id=>document.getElementById(id).classList.contains('ignored')),
  enabled:['exTypeGroup','exNozGroup','exSkillGroup'].every(id=>[...document.getElementById(id).querySelectorAll('button,input')].every(el=>!el.disabled))
}));
ck('11-b. 다른 탭으로 돌아오면 필터가 다시 활성화',!summaryFilterUi.ignored&&summaryFilterUi.enabled,JSON.stringify(summaryFilterUi));
ck('12. 런타임 오류가 없다',errs.length===0,errs.join(' | '));
ck('13. 카드·이력 필터 조작은 추가 GAS 통신 없음',apiCalls===initialCalls);
await browser.close();
console.log('\n──────────────────────────────');console.log(`통과 ${pass}/${total}`);
if(fails.length){console.log('실패:');fails.forEach(x=>console.log(' -',x));process.exit(1);}console.log('모든 테스트 통과 ✅');
