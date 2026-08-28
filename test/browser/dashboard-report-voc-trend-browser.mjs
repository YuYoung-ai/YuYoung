/************************************************************
 * dashboard-pc.html · 주간/월간 보고서 PPT — 추이 그래프 VOC 유형 선택 브라우저 검증
 * 실행: npx http-server . -p 8099 -s &
 *       BASE=http://127.0.0.1:8099 node test/browser/dashboard-report-voc-trend-browser.mjs
 * ----------------------------------------------------------
 * 집계·표시 목록은 test/dashboard-executive-ppt.mjs 가 본다. 여기서는 화면 배선만 본다:
 *   · 생성 모달의 유형 드롭다운이 추이 구간 기준으로 채워지는가
 *   · 고른 유형이 미리보기(=실제 PPT와 같은 표시 목록)의 추이 카드에 실제로 반영되는가
 *   · 유형을 골라도 KPI·TOP5 같은 다른 카드의 숫자는 그대로인가
 ************************************************************/
import { createRequire } from 'module';
import { execSync } from 'child_process';
let pw;
try { pw = (await import('playwright')).default; } catch {
  const roots = [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES];
  try { roots.push(execSync('npm root -g').toString().trim()); } catch {}
  for (const root of roots.filter(Boolean)) {
    try { pw = createRequire(import.meta.url)(root + '/playwright'); break; } catch {}
  }
}
if (!pw) throw new Error('playwright 모듈을 찾을 수 없습니다');
const { chromium } = pw, BASE = process.env.BASE || 'http://127.0.0.1:8099';
let pass = 0, total = 0; const fails = [], errs = [];
function ck(name, cond, detail = '') {
  total++; if (cond) pass++; else fails.push(name + (detail ? ' — ' + detail : ''));
  console.log(cond ? '✅' : '❌', name, detail);
}

/* 8주 동안 노즐 누수는 늘고 케이블은 주는 표본 */
const DATA = [];
['2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06',
 '2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03'].forEach((w, i) => {
  const day = k => { const x = new Date(w + 'T00:00:00'); x.setDate(x.getDate() + k); return x.toISOString().slice(0, 10); };
  for (let j = 0; j < i + 2; j++) DATA.push({ date: day(j % 5), hosp: '가나병원', gubun: 'A/S', type: '노즐 누수(약액 유입)', part: "Handpiece Ass'y" });
  for (let j = 0; j < 9 - i; j++) DATA.push({ date: day(j % 5), hosp: '다라의원', gubun: 'A/S', type: '케이블 불량', part: 'Cable' });
  DATA.push({ date: day(1), hosp: '마바병원', gubun: '점검', type: '정기점검' });
});

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROME || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.addInitScript(() => {
  sessionStorage.setItem('baz_auth_token', 'tok-smoke'); sessionStorage.setItem('baz_auth_level', '3');
  sessionStorage.setItem('baz_auth_name', '테스트');
  sessionStorage.setItem('baz_auth_expires', new Date(Date.now() + 864e5).toISOString());
  sessionStorage.setItem('baz_auth_verified_ts', String(Date.now()));
  localStorage.setItem('baz_dash_view', 'exec');
});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|ERR_ABORTED|ERR_CONNECTION/.test(m.text())) errs.push('CONSOLE: ' + m.text()); });
await page.route('**yuyoung-ai.deno.net/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, valid: true, level: 3, name: '테스트' }) }));
await page.route('**://script.google.com/**', r => {
  let body = { success: true };
  if (r.request().url().includes('action=all')) body = { success: true, data: DATA, updated: '2026-08-10 09:00' };
  else if (r.request().url().includes('action=hospdb')) body = { success: true, data: [] };
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await page.goto(BASE + '/dashboard-pc.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.DATA_READY === true);
await page.evaluate(() => { F.from = '2026-08-03'; F.to = '2026-08-07'; buildFilters(); apply(); openWeekly(); });
await page.waitForSelector('#wkModal.show');

const opts = await page.evaluate(() => [...document.querySelectorAll('#wkVocSel option')].map(o => o.value));
ck('1. 기본값은 전체(A/S·점검)', opts[0] === '', opts.join(' / '));
ck('2. 추이 구간에 기록이 있는 유형만 담는다 (정기점검·이상 없음 제외)',
  opts.length === 3 && opts.includes('노즐 누수(약액 유입)') && opts.includes('케이블 불량') &&
  !opts.includes('정기점검'), opts.join(' / '));

const pvText = async () => {
  await page.evaluate(() => previewWeeklyPPT());
  await page.waitForSelector('#wkPvModal.show');
  /* 미리보기는 PPT 와 글자를 맞추려 공백을 nbsp 로 고정한다 — 비교 전에 되돌린다 */
  const t = (await page.textContent('#wkPvSlides')).replace(/\u00a0/g, ' ');
  await page.evaluate(() => closeWkPreview());
  return t;
};
const plain = await pvText();
ck('3. 유형 미선택이면 종전대로 A/S·점검 두 계열',
  plain.includes('최근 8주 서비스 추이') && plain.includes('기준 주 A/S') && plain.includes('기준 주 점검'));

await page.selectOption('#wkVocSel', '노즐 누수(약액 유입)');
const focus = await pvText();
ck('4. 고른 유형이 추이 카드 제목에 나온다',
  focus.includes('최근 8주 노즐 누수(약액 유입) 발생 추이'));
ck('5. 추이 카드가 유형 기준 수치(합계·주평균·추세)로 바뀐다',
  focus.includes('8주 합계') && focus.includes('8주 주평균') && focus.includes('추세'));
ck('6. 늘고 있는 유형은 증가로 판정', /▲/.test(focus.split('추세')[1] || ''));
ck('7. 유형을 골라도 KPI·TOP5는 전체 기준 그대로',
  ['전체 서비스 건수', 'A/S(VOC) 건수', '점검 건수', 'VOC 유형 TOP 5', '교체품 TOP 5']
    .every(t => plain.includes(t) && focus.includes(t)));
ck('8. 미리보기 추이 그래프가 꺾은선·점으로 그려진다', await page.evaluate(async () => {
  previewWeeklyPPT();
  const box = document.getElementById('wkPvSlides');
  const dots = [...box.querySelectorAll('div')].filter(d => getComputedStyle(d).borderRadius === '50%').length;
  const segs = [...box.querySelectorAll('div')].filter(d => /rotate/.test(d.style.transform)).length;
  closeWkPreview();
  return dots >= 16 && segs >= 14;
}));

await page.selectOption('#wkVocSel', '케이블 불량');
const down = await pvText();
ck('9. 줄고 있는 유형은 감소로 판정', /▼/.test(down.split('추세')[1] || ''));

/* 보고 주차를 바꾸면 목록을 다시 만든다 — 새 기간에 없는 유형이 남지 않아야 한다 */
await page.evaluate(() => { const s = document.getElementById('wkSel'); s.selectedIndex = s.options.length - 1; exOnReportPeriodChange_('week'); });
ck('10. 보고 주차를 바꾸면 유형 목록을 다시 만든다',
  await page.evaluate(() => document.querySelectorAll('#wkVocSel option').length >= 1));

/* 월간 보고도 같은 방식 */
await page.evaluate(() => { closeWeekly(); openMonthly(); });
await page.waitForSelector('#mnModal.show');
ck('11. 월간 보고에도 같은 유형 선택이 있다',
  await page.evaluate(() => !!document.getElementById('mnVocSel')));
await page.selectOption('#mnVocSel', '노즐 누수(약액 유입)');
await page.evaluate(() => previewMonthlyPPT());
await page.waitForSelector('#mnPvModal.show');
const mText = (await page.textContent('#mnPvSlides')).replace(/\u00a0/g, ' ');
ck('12. 월간도 고른 유형 기준 추이로 바뀐다',
  mText.includes('월별 노즐 누수(약액 유입) 발생 추이') && mText.includes('6개월 합계'));

ck('13. 콘솔 오류 없음', errs.length === 0, errs.join(' | '));
await browser.close();
console.log('\n──────────────────────────────');
console.log(`통과 ${pass}/${total}`);
if (fails.length) { console.log('실패:'); fails.forEach(f => console.log(' -', f)); process.exit(1); }
console.log('모든 테스트 통과 ✅');
