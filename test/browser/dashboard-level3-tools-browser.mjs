import { createRequire } from 'module';
import { execSync } from 'child_process';

let pw;
try { pw = (await import('playwright')).default; }
catch {
  const roots = [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES];
  try { roots.push(execSync('npm root -g').toString().trim()); } catch {}
  for (const root of roots.filter(Boolean)) {
    try { pw = createRequire(import.meta.url)(root + '/playwright'); break; } catch {}
  }
}
if (!pw) throw new Error('playwright 모듈을 찾을 수 없습니다');

const { chromium } = pw;
const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const IDS = ['recordBtn', 'weeklyBtn', 'monthlyBtn', 'saturdayDutyBtn', 'teMgrBtn'];
let pass = 0, total = 0;
const fails = [];
function ck(name, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(name + (detail ? ' — ' + detail : ''));
  console.log(cond ? '✅' : '❌', name, detail);
}

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROME || undefined });
for (const level of [1, 2, 3]) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  await ctx.addInitScript(lv => {
    sessionStorage.setItem('baz_auth_token', 'tok-level-' + lv);
    sessionStorage.setItem('baz_auth_level', String(lv));
    sessionStorage.setItem('baz_auth_name', '레벨 ' + lv);
    sessionStorage.setItem('baz_auth_expires', new Date(Date.now() + 864e5).toISOString());
    sessionStorage.setItem('baz_auth_verified_ts', String(Date.now()));
    localStorage.setItem('baz_menu_cfg', JSON.stringify({ dashboard: { level: 1 } }));
    localStorage.setItem('baz_dash_view', 'detail');
  }, level);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**yuyoung-ai.deno.net/**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, valid: true, level, name: '레벨 ' + level })
  }));
  await page.route('**://script.google.com/**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, data: [], updated: '2026-08-25 11:00' })
  }));
  await page.goto(BASE + '/dashboard-pc.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#recordBtn', { state: 'attached' });
  const state = await page.evaluate(ids => ids.map(id => {
    const el = document.getElementById(id);
    return { id, hidden: el.hidden, disabled: el.disabled, aria: el.getAttribute('aria-hidden') };
  }), IDS);
  const shouldShow = level === 3;
  ck(`레벨 ${level}. 다섯 버튼 표시 상태`, state.every(x =>
    x.hidden === !shouldShow && x.disabled === !shouldShow && x.aria === String(!shouldShow)),
    JSON.stringify(state));
  ck(`레벨 ${level}. 새로고침·테마 버튼은 표시 유지`,
    await page.isVisible('button[onclick="loadData(true)"]') && await page.isVisible('#themeToggle'));
  if (level < 3) {
    const guarded = await page.evaluate(() => {
      openWeekly(); openMonthly(); openSaturdayDuty(); exOpenTypeExampleManager();
      return {
        weekly: document.getElementById('wkModal').classList.contains('show'),
        monthly: document.getElementById('mnModal').classList.contains('show'),
        saturday: document.getElementById('satModal').classList.contains('show'),
        managerLoaded: !!window.BazTypeExampleManager
      };
    });
    ck(`레벨 ${level}. 직접 함수 호출도 네 기능을 열지 않는다`,
      !guarded.weekly && !guarded.monthly && !guarded.saturday && !guarded.managerLoaded,
      JSON.stringify(guarded));
  }
  ck(`레벨 ${level}. 런타임 오류 없음`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}
await browser.close();

console.log('\n──────────────────────────────');
console.log(`통과 ${pass}/${total}`);
if (fails.length) {
  console.error('실패:\n - ' + fails.join('\n - '));
  process.exit(1);
}
console.log('모든 테스트 통과 ✅');
