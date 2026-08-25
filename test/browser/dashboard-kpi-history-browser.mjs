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
  {date:'2026-08-10',hosp:'A병원',gubun:'A/S',type:'노즐 누수(약액 유입)',part:'내부 세척',fse:'김프로',ncare:'N-Care'},
  {date:'2026-08-11',hosp:'A병원',gubun:'A/S',type:'노즐누수(약액유입)',part:'내부세척',fse:'이기사',ncare:'N-Care'},
  {date:'2026-08-12',hosp:'B병원',gubun:'A/S',type:'케이블 불량',part:'Cable Set',fse:'김프로',ncare:'미가입'},
  {date:'2026-08-13',hosp:'C병원',gubun:'점검',type:'노즐 누수(약액 유입)',part:'없음',fse:'김프로',ncare:'미가입'},
  {date:'2026-08-14',hosp:'D병원',gubun:'점검',type:'이상 없음',part:'없음',fse:'이기사',ncare:'미가입'},
  {date:'2026-08-04',hosp:'E병원',gubun:'A/S',type:'노즐 누수(약액 유입)',part:'내부 세척',fse:'김프로',ncare:'미가입'},
  {date:'2026-08-05',hosp:'F병원',gubun:'점검',type:'이상 없음',part:'없음',fse:'이기사',ncare:'미가입'}
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

await page.click('#exKpis [data-hist-dim="kpiTotal"]');
await page.waitForSelector('#exListModal.show');
let modal=await page.evaluate(()=>({
  title:document.getElementById('exListTitle').textContent,
  count:document.getElementById('hstCount').textContent,
  breakdown:document.getElementById('hstBreakdown').textContent,
  hasType:!!document.getElementById('hstType')
}));
ck('3. 전체 서비스 이력은 선택 기간 5건과 구분·VOC 유형 건수를 표시',
  modal.title==='전체 서비스 건수'&&modal.count.includes('5건')&&modal.breakdown.includes('A/S 3건')
  &&modal.breakdown.includes('점검 2건')&&modal.breakdown.includes('VOC 유형별 건수')&&modal.hasType,JSON.stringify(modal));
await page.selectOption('#hstType','케이블 불량');
modal=await page.evaluate(()=>({count:document.getElementById('hstCount').textContent,breakdown:document.getElementById('hstBreakdown').textContent}));
ck('4. VOC 유형 필터 적용 시 표시 건수와 두 건수 요약이 함께 갱신',
  modal.count.includes('1건')&&modal.breakdown.includes('A/S 1건')&&modal.breakdown.includes('케이블 불량 1건'),JSON.stringify(modal));
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
ck('9. PC에서 7개 KPI가 한 줄로 배치',await page.evaluate(()=>getComputedStyle(document.getElementById('exKpis')).gridTemplateColumns.split(' ').length===7));
ck('10. 런타임 오류가 없다',errs.length===0,errs.join(' | '));

await browser.close();
console.log('\n──────────────────────────────');console.log(`통과 ${pass}/${total}`);
if(fails.length){console.log('실패:');fails.forEach(x=>console.log(' -',x));process.exit(1);}console.log('모든 테스트 통과 ✅');
