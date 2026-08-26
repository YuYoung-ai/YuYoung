// 영업 담당자 상세필터·모든 보고탭·처리이력 건수 칩·DB 갱신 통합 검증
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright'):await import('playwright');
const BASE=process.env.BASE||'http://127.0.0.1:8099';
let count=0;const errors=[];
function ck(label,ok,detail=''){if(!ok)throw new Error(label+' '+JSON.stringify(detail));count++;console.log('✅ '+label);}
const DATA=[
  {date:'2026-08-18',hosp:'A병원',fse:'처리가',type:'노즐 누수(약액 유입)',part:'내부 세척'},
  {date:'2026-08-19',hosp:'A 병원',fse:'처리나',type:'노즐 누수(약액 유입)',part:'내부 세척'},
  {date:'2026-08-20',hosp:'B병원',fse:'처리가',type:'케이블 불량',cost:'10000'},
  {date:'2026-08-21',hosp:'C병원',fse:'처리가',type:'이상 없음',gubun:'점검'},
  {date:'2026-08-21',hosp:'미등록병원',fse:'처리나',type:'노즐 누수(약액 유입)'},
  {date:'2026-08-11',hosp:'A병원',fse:'처리가',type:'노즐 누수(약액 유입)'},
  {date:'2025-08-11',hosp:'A병원',fse:'처리가',type:'노즐 누수(약액 유입)'}
].map(r=>({gubun:'A/S',cat:'핸드피스',ncare:'미가입',...r}));
let db=[{n:'A 병원',sale:'영업가',ncare:'Basic'},{n:'B병원',sale:'영업나',ncare:'Basic'},
  {n:'C병원',sale:'',ncare:'Basic'},{n:'D병원',sale:'영업가',ncare:'Basic'}];
let apiCalls=0;
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROME||undefined});
try{
  const ctx=await browser.newContext({viewport:{width:1680,height:960}});
  await ctx.addInitScript(()=>{
    sessionStorage.setItem('baz_auth_token','tok-sales-test');sessionStorage.setItem('baz_auth_level','3');
    sessionStorage.setItem('baz_auth_name','테스트');sessionStorage.setItem('baz_auth_expires',new Date(Date.now()+864e5).toISOString());
    sessionStorage.setItem('baz_auth_verified_ts',String(Date.now()));
    localStorage.setItem('baz_dash_view','exec');localStorage.setItem('baz_viewmode','window');
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**yuyoung-ai.deno.net/**',r=>r.fulfill({json:{ok:true,valid:true,level:3,name:'테스트'}}));
  await page.route('**://script.google.com/**',r=>{
    apiCalls++;const u=r.request().url();
    return r.fulfill({json:u.includes('action=all')?{success:true,data:DATA}:
      u.includes('action=hospdb')?{success:true,data:db}:{success:true}});
  });
  await page.goto(BASE+'/dashboard-pc.html');
  await page.waitForFunction(()=>DATA_READY&&!DASH_LOAD_IN_FLIGHT);
  await page.evaluate(()=>{F.from='2026-08-17';F.to='2026-08-21';buildFilters();apply();});
  const initialCalls=apiCalls;
  await page.click('#exMoreBtn');
  ck('영업 담당자가 상세필터 안에 표시',await page.locator('#exDrawer #exSales').isVisible());
  await page.click('#exSales [data-v="영업가"]');
  ck('영업가의 처리 2건으로 주간 KPI 필터링',(await page.textContent('#exKpis [data-hist-dim="kpiTotal"] .vl')).includes('2'));
  ck('상세필터 개수에 영업담당자 포함',(await page.textContent('#exMoreCnt')).includes('1'));
  await page.click('#exMoreBtn');
  for(const tab of ['cause','actions','leak','year']){
    await page.click('[data-tab="'+tab+'"]');
    const s=await page.evaluate(()=>({sales:F.sales,rows:EX_ROWS.length,drawn:EX_DRAWN[EX_TAB],note:document.getElementById('exTabFilterNote').textContent}));
    ck(tab+' 탭 전환에도 담당자 필터 유지 및 정상 렌더',s.sales[0]==='영업가'&&s.rows===2&&s.drawn,s);
  }
  const compare=await page.evaluate(()=>({
    prev:exWindowRows(new Date('2026-08-10'),new Date('2026-08-14T23:59:59')).length,
    year:ycRangeStat_(ycRange_('2025-08-01','2025-08-31')).n,
    ncare:buildNcareStatus().list.map(h=>h.hosp),
    week:buildExecutiveReportSnapshot({type:'week',from:'2026-08-17',to:'2026-08-21'}).kpi[0].value,
    month:buildExecutiveReportSnapshot({type:'month',from:'2026-08-01',to:'2026-08-31'}).kpi[0].value
  }));
  ck('이전 주·연간 비교·N-Care 명단·주간/월간 PPT에 같은 영업담당자 적용',
    compare.prev===1&&compare.year===1&&compare.ncare.length===2&&compare.week==='2'&&compare.month==='3',compare);
  await page.click('[data-view="detail"]');
  ck('상세 분석 모드에서 같은 담당자 선택 유지',await page.locator('#fSales [data-v="영업가"].on').count()===1&&(await page.textContent('#kCnt'))==='2');
  await page.click('#fSales [data-v="__missing__"]');
  ck('상세 영업가+미지정 복수 선택 합집합',(await page.textContent('#kCnt'))==='4');
  await page.click('[data-view="exec"]');await page.click('[data-tab="summary"]');
  await page.evaluate(()=>{F.sales=[];buildFilters();apply();});
  await page.click('#exKpis [data-hist-dim="kpiTotal"]');
  const cards=await page.locator('#hstBreakdown strong').allTextContents();
  ck('구분 → 영업담당자 → VOC 건수 카드 순서',cards.join('|')==='구분 건수|영업 담당자별 건수|VOC 유형별 건수');
  ck('이력 영업담당자 선택 제공',await page.locator('#hstSales').isVisible());
  const salesChip=v=>page.locator('#hstBreakdown [data-hst-count-key="sales"][data-hst-count-value="'+v+'"]');
  await salesChip('영업가').click();
  ck('영업담당자 칩은 고유병원 1곳이 아닌 처리 2건 표시',await page.locator('#hstTableHost tbody tr').count()===2);
  ck('다른 담당자·미지정 칩 유지',await salesChip('영업나').count()===1&&await salesChip('__missing__').count()===1);
  await salesChip('영업가').click();
  ck('같은 칩 재클릭 해제',await page.inputValue('#hstSales')==='all'&&await page.locator('#hstTableHost tbody tr').count()===5);
  await salesChip('영업나').click();
  ck('다른 담당자로 전환',await page.locator('#hstTableHost tbody tr').count()===1&&(await page.textContent('#hstTableHost')).includes('B병원'));
  await page.selectOption('#hstSales','__missing__');
  ck('미지정은 DB 미등록 포함',await page.locator('#hstTableHost tbody tr').count()===2);
  ck('팝업 필터는 전역 KPI를 변경하지 않음',await page.evaluate(()=>F.sales.length===0&&EX_ROWS.length===5));
  await page.click('.hst-reset');
  ck('초기화는 영업담당자도 전체로 복구',await page.inputValue('#hstSales')==='all');
  await page.selectOption('#hstSales','영업가');await page.selectOption('#hstPeriod','prev');
  ck('비교 기간에도 영업담당자 기준 처리이력',await page.locator('#hstTableHost tbody tr').count()===1);
  ck('필터·탭·이력 조작은 추가 GAS 통신 없음',apiCalls===initialCalls,{initialCalls,apiCalls});
  await page.selectOption('#hstPeriod','cur');
  const screenshot=join(tmpdir(),'dashboard-sales-filter-desktop.png');
  await page.screenshot({path:screenshot});console.log('SCREENSHOT '+screenshot);
  for(const width of [1000,390]){
    await page.setViewportSize({width,height:900});
    ck(width+'px 필터 영역이 가로로 넘치지 않음',await page.locator('.hst-controls').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  }
  await page.setViewportSize({width:1680,height:960});
  db=db.map(h=>({...h,sale:h.n==='A 병원'?'':h.sale}));
  await page.evaluate(()=>loadHospDB(true));
  ck('담당자 삭제 시 열린 팝업 조건 유지·결과 0건',await page.inputValue('#hstSales')==='영업가'&&await page.locator('#hstTableHost tbody tr').count()===0);
  await page.selectOption('#hstSales','__missing__');
  ck('갱신된 DB의 미지정 건수가 즉시 재집계',await page.locator('#hstTableHost tbody tr').count()===4);
  await page.evaluate(()=>closeExList());
  ck('런타임 오류 없음',errors.length===0,errors);
  console.log(`\n통과 ${count}/${count}`);
}finally{await browser.close();}
