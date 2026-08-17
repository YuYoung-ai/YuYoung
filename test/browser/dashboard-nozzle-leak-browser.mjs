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
  {date:'2026-08-10',hosp:'A병원',gubun:'A/S',type:'노즐 누수(약액 유입)',ncare:'N-Care'},
  {date:'2026-08-11',hosp:'B병원',gubun:'A/S',type:'노즐 누수(약액 유입)',ncare:'미가입'},
  {date:'2026-08-12',hosp:'B병원',gubun:'A/S',type:'노즐누수(약액유입)',ncare:'미가입'},
  {date:'2026-08-12',hosp:'C병원',gubun:'점검',type:'케이블 불량',ncare:'미가입'},
  {date:'2026-08-13',hosp:'D병원',gubun:'A/S',type:'노즐 누수(약액 유입)',ncare:'미가입'}
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
await page.route('**://script.google.com/**',r=>{
  const u=r.request().url();let body={success:true};
  if(u.includes('action=all'))body={success:true,data:DATA,updated:'2026-08-17 09:00'};
  else if(u.includes('action=hospdb'))body={success:true,data:[]};
  else if(u.includes('action=ping'))body={success:true};
  return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
});

await page.goto(BASE+'/dashboard-pc.html',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.DATA_READY===true);
await page.evaluate(()=>{F.from='2026-08-10';F.to='2026-08-14';buildFilters();apply();});
await page.click('[data-tab="leak"]');
await page.waitForSelector('#exPaneLeak.on');
ck('1. 누수 분석 탭이 표시된다',await page.isVisible('#exPaneLeak'));
ck('2. 핵심 지표가 실제 집계값으로 표시된다',(await page.textContent('#exLeakKpis')).includes('노즐 누수(약액 유입)4건'));
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
ck('7. 마지막 평가 기준 문구만 사용한다',!(await page.textContent('#exPaneLeak')).includes('최근 평가'));
const detailText=await page.textContent('#exLeakDetailCard');
ck('8. 병원별 평가일·상태·누수 건수를 함께 표시한다',['노즐 평가일','교육 평가일','사용방식','교육 상태','누수'].every(x=>detailText.includes(x)));
await page.locator('#exLeakNozzleCard .nl-bar-row').first().click();
await page.waitForSelector('#exListModal.show');
ck('9. 그래프 클릭으로 해당 병원 명단이 열린다',(await page.textContent('#exListTitle')).includes('재사용')&&(await page.textContent('#exListBody')).includes('A병원'));
await page.evaluate(()=>closeExList());
ck('10. PC에서 분석 패널이 화면 폭을 넘지 않는다',await page.evaluate(()=>document.getElementById('exPaneLeak').getBoundingClientRect().right<=innerWidth+1));
await page.click('[data-mode="mobile"]');
ck('11. 모바일 보기에서 비교 영역이 한 열로 바뀐다',await page.evaluate(()=>getComputedStyle(document.querySelector('.nl-grid')).gridTemplateColumns.split(' ').length===1&&document.body.classList.contains('ex-narrow')));
ck('12. 런타임 오류가 없다',errs.length===0,errs.join(' | '));
if(process.env.SHOT)await page.screenshot({path:process.env.SHOT,fullPage:true});
await browser.close();
console.log('\n──────────────────────────────');console.log(`통과 ${pass}/${total}`);
if(fails.length){console.log('실패:');fails.forEach(x=>console.log(' -',x));process.exit(1);}console.log('모든 테스트 통과 ✅');
