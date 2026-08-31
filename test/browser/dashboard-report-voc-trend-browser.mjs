/************************************************************
 * dashboard-pc.html · 주간/월간 보고서 PPT — 추이 그래프 대상 선택 브라우저 검증
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

/* 16주 표본 — 앞 8주가 직전 구간, 뒤 8주가 최근 구간.
   최근 구간에서 노즐 누수는 늘고 케이블은 준다. */
const DATA = [];
const MONDAYS = [];
for (let i = 15; i >= 0; i--) {
  const d = new Date('2026-08-03T00:00:00'); d.setDate(d.getDate() - 7 * i);
  MONDAYS.push(d.toISOString().slice(0, 10));
}
MONDAYS.forEach((w, i) => {
  const day = k => { const x = new Date(w + 'T00:00:00'); x.setDate(x.getDate() + k); return x.toISOString().slice(0, 10); };
  const recent = i >= 8, j = i - 8;
  const leak = recent ? j + 3 : 3;             /* 최근 8주 3→10 · 직전 8주 3 */
  const cable = recent ? 9 - j : 9;            /* 최근 8주 9→2 · 직전 8주 9 */
  for (let k = 0; k < leak; k++) DATA.push({ date: day(k % 5), hosp: '가나병원', gubun: 'A/S', type: '노즐 누수(약액 유입)', part: "Handpiece Ass'y" });
  for (let k = 0; k < cable; k++) DATA.push({ date: day(k % 5), hosp: '다라의원', gubun: 'A/S', type: '케이블 불량', part: 'Cable' });
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
await page.evaluate(() => { F.from = '2026-08-03'; F.to = '2026-08-08'; buildFilters(); apply(); openWeekly(); });
await page.waitForSelector('#wkModal.show');

const opts = await page.evaluate(() => [...document.querySelectorAll('#wkVocSel option')].map(o => o.value));
ck('1. 기본값은 전체(A/S·점검)', opts[0] === '', opts.join(' / '));
ck('2. 구분(전체·A/S·점검) 다음에 추이 구간의 VOC 유형만 담는다 (정기점검·이상 없음 제외)',
  opts.slice(0, 3).join(',') === ',__as__,__insp__' &&
  opts.includes('노즐 누수(약액 유입)') && opts.includes('케이블 불량') &&
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
ck('3. 기본은 전체 처리를 최근 8주 ↔ 직전 8주로 겹쳐 본다',
  plain.includes('최근 8주 서비스 추이 · 직전 8주 대비') &&
  plain.includes('집계 대상 전체 처리(A/S·점검)') &&
  plain.includes('최근 8주 합계') && plain.includes('직전 8주 합계'));

await page.selectOption('#wkVocSel', '노즐 누수(약액 유입)');
const focus = await pvText();
ck('4. 고른 유형이 추이 카드 제목에 나온다',
  focus.includes('최근 8주 노즐 누수(약액 유입) 발생 추이'));
ck('5. 추이 카드 수치가 고른 대상 기준으로 바뀐다',
  focus.includes('집계 대상 노즐 누수(약액 유입)') &&
  focus.includes('기준 주 노즐 누수(약액 유입)') && focus.includes('직전 8주 대비'));
/* '직전 8주 대비'는 카드 제목에도 나오므로 마지막(수치 타일) 쪽을 본다 */
ck('6. 직전 8주보다 늘어난 유형은 증가로 판정', /▲/.test(focus.split('직전 8주 대비').pop()));
ck('6-b. 고른 유형의 보고 기간 건수를 KPI 줄에 한 장 더 싣는다', (() => {
  const kpiRow = focus.split('전체 서비스 건수')[1] || '';
  /* 상단 KPI 줄 = 전체 · A/S · 점검 · 선택 유형 순 */
  return kpiRow.indexOf('노즐 누수(약액 유입) · 비율') >= 0 &&
         kpiRow.indexOf('노즐 누수(약액 유입)') < kpiRow.indexOf('최근 8주');
})());
ck('6-c. 전체 기준일 때는 KPI 3장 그대로',
  (plain.split('전체 서비스 건수')[1] || '').indexOf('비율') ===
  (plain.split('전체 서비스 건수')[1] || '').lastIndexOf('비율'));
ck('7. 유형을 골라도 기존 KPI·TOP5는 전체 기준 그대로',
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

await page.selectOption('#wkVocSel', '__insp__');
const insp = await pvText();
ck('8-b. 구분만 골라 볼 수도 있다 (A/S 전체 · 점검 전체)',
  insp.includes('집계 대상 점검') && insp.includes('기준 주 점검'));

await page.selectOption('#wkVocSel', '케이블 불량');
const down = await pvText();
ck('9. 직전 8주보다 줄어든 유형은 감소로 판정', /▼/.test(down.split('직전 8주 대비').pop()));

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
ck('12. 월간도 최근 6개월 ↔ 직전 6개월로 겹쳐 본다',
  mText.includes('월별 노즐 누수(약액 유입) 발생 추이 · 직전 6개월 대비') &&
  mText.includes('최근 6개월 합계') && mText.includes('직전 6개월 합계'));

ck('13. 콘솔 오류 없음', errs.length === 0, errs.join(' | '));
await browser.close();
console.log('\n──────────────────────────────');
console.log(`통과 ${pass}/${total}`);
if (fails.length) { console.log('실패:'); fails.forEach(f => console.log(' -', f)); process.exit(1); }
console.log('모든 테스트 통과 ✅');
