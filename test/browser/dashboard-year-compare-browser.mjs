/************************************************************
 * dashboard-pc.html · 연간 비교 기간 UI 브라우저 검증
 * 실행: npx http-server . -p 8099 -s &
 *       BASE=http://127.0.0.1:8099 node test/browser/dashboard-year-compare-browser.mjs
 ************************************************************/
import { createRequire } from 'module';
import { execSync } from 'child_process';
let pw;
try{pw=(await import('playwright')).default;}catch{
  const roots=[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES];
  try{roots.push(execSync('npm root -g').toString().trim());}catch{}
  for(const root of roots.filter(Boolean)){try{pw=createRequire(import.meta.url)(root+'/playwright');break;}catch{}}
}
if(!pw)throw new Error('playwright 모듈을 찾을 수 없습니다');
const {chromium}=pw,BASE=process.env.BASE||'http://127.0.0.1:8099';
let pass=0,total=0;const fails=[],errs=[];
function ck(name,cond,detail=''){total++;if(cond)pass++;else fails.push(name+(detail?' — '+detail:''));console.log(cond?'✅':'❌',name,detail);}
const DATA=[
  {date:'2025-01-02',hosp:'A병원',gubun:'A/S',type:'노즐 누수(약액 유입)',part:'내부 세척'},
  {date:'2025-08-18',hosp:'B병원',gubun:'점검',type:'케이블 불량'},
  {date:'2025-12-20',hosp:'C병원',gubun:'A/S',type:'노즐 막힘'},
  {date:'2026-01-03',hosp:'D병원',gubun:'A/S',type:'노즐 누수(약액 유입)',part:'내부 세척'},
  {date:'2026-07-30',hosp:'E병원',gubun:'A/S',type:'노즐누수(약액 유입)',part:'내부세척'},
  {date:'2026-08-18',hosp:'F병원',gubun:'점검',type:'이상 없음'}
];
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROME||undefined});
const ctx=await browser.newContext({viewport:{width:1440,height:900}});
await ctx.addInitScript(()=>{
  sessionStorage.setItem('baz_auth_token','tok-smoke');sessionStorage.setItem('baz_auth_level','3');
  sessionStorage.setItem('baz_auth_name','테스트');sessionStorage.setItem('baz_auth_expires',new Date(Date.now()+864e5).toISOString());
  sessionStorage.setItem('baz_auth_verified_ts',String(Date.now()));localStorage.setItem('baz_dash_view','exec');
});
const page=await ctx.newPage();
page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
page.on('console',m=>{if(m.type()==='error'&&!/ERR_FAILED|ERR_ABORTED|ERR_CONNECTION/.test(m.text()))errs.push('CONSOLE: '+m.text());});
await page.route('**yuyoung-ai.deno.net/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,valid:true,level:3,name:'테스트'})}));
await page.route('**://script.google.com/**',r=>{
  let body={success:true};if(r.request().url().includes('action=all'))body={success:true,data:DATA,updated:'2026-08-18 09:00'};
  else if(r.request().url().includes('action=hospdb'))body={success:true,data:[]};
  return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
});
await page.goto(BASE+'/dashboard-pc.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.DATA_READY===true);
await page.evaluate(()=>{F.from='2026-08-01';F.to='2026-08-18';buildFilters();apply();});
await page.click('[data-tab="year"]');await page.waitForSelector('#exPaneYear.on');
let text=await page.textContent('#exYcBar');
ck('1. 기본 비교 왼쪽이 전년도 같은 날짜에서 끝난다',text.includes('2025.01.01~2025.08.18'),text);
ck('2. 기본 비교 오른쪽은 현재 기준일까지 표시된다',text.includes('2026.01.01~2026.08.18'));
ck('3. 추정 교체비용 절감액과 산정 결과를 표시한다',text.includes('추정 교체비용 절감액')&&text.includes('₩281,200')&&text.includes('₩562,400'));
await page.locator('#exYcBar input[aria-label="동일 기간 종료일"]').fill('2025-07-18');
await page.locator('#exYcBar input[aria-label="동일 기간 종료일"]').dispatchEvent('change');
ck('4. 왼쪽 종료일의 월·일이 오른쪽 연도에 자동 연동',
  await page.locator('#exYcBar input[aria-label="자동 연동 종료일"]').inputValue()==='2026-07-18');
await page.click('.yc-modepick button:nth-child(2)');
await page.waitForFunction(()=>window.EX_YC_MODE==='custom');
await page.evaluate(()=>ycSetCustomDate('r','to','2026-07-31'));
text=await page.textContent('#exPaneYear');
ck('5. 직접 기간에서 좌우 날짜 입력을 각각 제공',await page.locator('#exYcBar input[type=date]').count()===4);
ck('6. 직접 기간은 2025년 전체 대 2026년 1~7월 분석',text.includes('12개월 ↔ 7개월'),text.match(/월별[^\n]*/)?.[0]||'');
ck('7. PC 연간 비교 패널이 화면 폭을 넘지 않는다',await page.evaluate(()=>document.getElementById('exPaneYear').getBoundingClientRect().right<=innerWidth+1));
await page.click('[data-mode="mobile"]');
ck('8. 모바일 보기에서 좌우 패널이 한 열로 배치',await page.evaluate(()=>getComputedStyle(document.querySelector('#exYcMonthCard .yc-grid')).gridTemplateColumns.split(' ').length===1));
ck('9. 런타임 오류가 없다',errs.length===0,errs.join(' | '));
if(process.env.SHOT)await page.screenshot({path:process.env.SHOT,fullPage:true});
await browser.close();
console.log('\n──────────────────────────────');console.log(`통과 ${pass}/${total}`);
if(fails.length){console.log('실패:');fails.forEach(x=>console.log(' -',x));process.exit(1);}console.log('모든 테스트 통과 ✅');
