/************************************************************
 * hospital-pc-browser.mjs
 * hospital-pc.html 브라우저 수동 검증 자동화 (Chromium · Playwright)
 * ----------------------------------------------------------
 * 이 스크립트는 기본 테스트 묶음(node test/*.mjs)에 포함되지 않는다 —
 * playwright 와 정적 서버가 있어야 돌기 때문이다. 리뷰·재현용이다.
 *
 *   npx http-server . -p 8099 -s &
 *   BASE=http://127.0.0.1:8099 node test/browser/hospital-pc-browser.mjs
 *
 * 카카오 지도 SDK·GAS·인증 서버는 모두 라우팅으로 가로채 가짜 응답을 준다
 * (실제 병원 데이터·토큰을 쓰지 않는다). 확인 항목:
 *   · 악성 병원명이 노드/인라인 핸들러를 만들지 않고 텍스트로만 표시
 *   · 이력 모달 role/aria-modal·포커스 진입·Esc 닫기·스크롤 잠금 해제
 *   · 전체화면 진입/종료 후 scrollY 복원(paddingTop 보정 없음)
 *   · 내 주변 5km 켜기/끄기와 거리 표시
 *   · 카드/표 전환·정렬 헤더 키보드 조작
 *   · KO/EN/JA 전환 후 새 UI 문자열
 *   · 필터 폭 3단계·모바일↔Window·여러 뷰포트에서 예외 없음
 ************************************************************/
import { createRequire } from 'module';
import { execSync } from 'child_process';

/* playwright 는 이 저장소의 의존성이 아니다(package.json 자체가 없다).
   프로젝트에 설치돼 있으면 그것을, 없으면 전역 설치본을 쓴다. */
let pw;
try { pw = (await import('playwright')).default; }
catch {
  const root = execSync('npm root -g').toString().trim();
  pw = createRequire(import.meta.url)(root + '/playwright');
}
const { chromium } = pw;
const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const errs = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  permissions: ['geolocation'],
  geolocation: { latitude: 37.5665, longitude: 126.9780, accuracy: 12 }   // 서울시청
});
await ctx.addInitScript(() => {
  try {
    sessionStorage.setItem('baz_auth_token', 'smoke');
    sessionStorage.setItem('baz_auth_level', '3');
    sessionStorage.setItem('baz_auth_name', '스모크');
    sessionStorage.setItem('baz_auth_expires', new Date(Date.now() + 864e5).toISOString());
    sessionStorage.setItem('baz_auth_verified_ts', String(Date.now()));
  } catch (e) {}
});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|ERR_CONNECTION/.test(m.text())) errs.push('CONSOLE: ' + m.text()); });
await page.route('**://dapi.kakao.com/**', r => r.abort());
await page.route('**yuyoung-ai.deno.net/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, valid: true, level: 3, name: '스모크' }) }));
await page.route('**://script.google.com/**', r => {
  const u = r.request().url();
  const j = o => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (u.includes('action=bootstrap')) return j({ success: true,
    hospdb: { success: true, data: [
      { name: '"><img src=x onerror=window.__XSS=1>병원', sn: 'SN-1', region: '서울', address: '서울시 중구 1', lastVisit: '2026-07-01', status: '경고', sales: "O'Brien\\'); alert(1); //", asType: '유상', ncare: 'Gold', client: '납품 1년 이내', hpVer: '1.2', uiVer: '3.1', lat: 37.5665, lng: 126.978 },
      { name: '부산A병원', sn: 'SN-2', region: '부산', address: '부산시 1', lastVisit: '2026-06-01', status: '권고', sales: '김철수', asType: '', ncare: 'Silver', client: '', hpVer: '', uiVer: '', lat: 35.1796, lng: 129.0756 },
      { name: '가까운N병원', sn: 'SN-3', region: '서울', address: '서울시 종로 1', lastVisit: '2026-05-01', status: '점검대상', sales: '이영희', asType: '', ncare: 'Gold', client: '', hpVer: '', uiVer: '', lat: 37.5700, lng: 126.9800 }
    ] },
    issuehist: { success: true, data: { '부산A병원': [{ d: '2026-06-01', t: '점검', sy: '노즐 막힘', f: '김철수', fx: '세척' }] }, revs: { '부산A병원': { rev: 2 } } } });
  if (u.includes('action=progress')) return j({ success: true, queues: {}, prog: {}, done: {}, rev: 1 });
  return j({ success: true, data: [] });
});
await page.goto(BASE + '/hospital-pc.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);

const R = [];
const ck = (n, c, d) => { R.push([c ? '✅' : '❌', n, d || '']); };

// 1. XSS: 악성 병원명이 노드를 만들지 않는다
const xss = await page.evaluate(() => ({
  flag: !!window.__XSS,
  imgs: document.querySelectorAll('#pcLeft img').length,
  names: [...document.querySelectorAll('#pcLeft .h-name')].map(e => e.textContent),
  inlineHandlers: [...document.querySelectorAll('#pcLeft *')].filter(e => e.getAttributeNames().some(a => a.startsWith('on'))).length
}));
ck('악성 병원명으로 스크립트가 실행되지 않는다', !xss.flag && xss.imgs === 0 && xss.inlineHandlers === 0, JSON.stringify(xss));
ck('악성 이름이 텍스트로 정상 표시된다', xss.names.some(n => n.includes('<img src=x')), xss.names.join(' | '));

// 2. 액션 버튼이 살아 있다(병원명에 따옴표가 있어도)
const nav = await page.evaluate(() => {
  const b = document.querySelector('#pcLeft [data-hact="nmap"]');
  return b ? { has: true, hn: b.getAttribute('data-hn') } : { has: false };
});
ck('따옴표가 섞인 병원명에도 액션 버튼이 만들어진다', nav.has && nav.hn.includes('<img'));

// 3. 카드 클릭 → 선택, 지도 컨트롤의 '선택 해제' 노출
await page.click('#pcLeft .pc-cardwrap:nth-child(2)');
await page.waitForTimeout(200);
ck('카드 클릭 후 화면이 살아 있다', errs.length === 0, errs[0] || '');

// 4. 이력 모달: 열기 → 포커스 진입 → Esc 로 닫기 → 포커스 복원
await page.evaluate(() => window.openHist('부산A병원'));
await page.waitForTimeout(250);
const modalOpen = await page.evaluate(() => ({
  shown: document.getElementById('histModal').classList.contains('show'),
  role: document.querySelector('#histModal .hist-sheet').getAttribute('role'),
  modal: document.querySelector('#histModal .hist-sheet').getAttribute('aria-modal'),
  focusIn: document.getElementById('histModal').contains(document.activeElement),
  locked: window.BazScrollLock.isLocked(),
  bodyPos: document.body.style.position
}));
ck('이력 모달이 role/aria-modal 과 포커스 진입을 갖춘다',
  modalOpen.shown && modalOpen.role === 'dialog' && modalOpen.modal === 'true' && modalOpen.focusIn, JSON.stringify(modalOpen));
ck('모달이 배경 스크롤을 잠근다', modalOpen.locked && modalOpen.bodyPos === 'fixed');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const modalClosed = await page.evaluate(() => ({
  shown: document.getElementById('histModal').classList.contains('show'),
  locked: window.BazScrollLock.isLocked(),
  bodyPos: document.body.style.position
}));
ck('Esc 로 모달이 닫히고 스크롤 잠금이 풀린다', !modalClosed.shown && !modalClosed.locked && modalClosed.bodyPos === '');

// 5. 전체화면 진입/종료 scrollY 보존
await page.evaluate(() => window.scrollTo(0, 400));
await page.waitForTimeout(120);
const beforeY = await page.evaluate(() => window.scrollY);
await page.evaluate(() => pcEnterFullscreen());
await page.waitForTimeout(250);
const inFs = await page.evaluate(() => ({ full: document.body.classList.contains('pc-mapfs'), locked: window.BazScrollLock.isLocked(), pad: document.getElementById('pcPane').style.paddingTop }));
await page.evaluate(() => pcExitFullscreen());
await page.waitForTimeout(300);
const afterY = await page.evaluate(() => window.scrollY);
ck('전체화면이 배경을 잠그고 paddingTop 보정을 쓰지 않는다', inFs.full && inFs.locked && !inFs.pad, JSON.stringify(inFs));
ck('전체화면 종료 후 스크롤 위치가 복원된다', Math.abs(afterY - beforeY) <= 2, `${beforeY} → ${afterY}`);

// 6. 내 주변 5km
await page.click('#nearbyBtn');
await page.waitForTimeout(500);
const nearby = await page.evaluate(() => ({
  pressed: document.getElementById('nearbyBtn').getAttribute('aria-pressed'),
  state: document.getElementById('nearbyState').textContent,
  cards: [...document.querySelectorAll('#pcLeft .h-name')].map(e => e.textContent),
  dist: [...document.querySelectorAll('#pcLeft .h-dist')].length
}));
ck('내 주변 5km 를 켜면 반경 내 N-CARE 만 거리와 함께 보인다',
  nearby.pressed === 'true' && nearby.cards.length === 2 && nearby.dist === 2, JSON.stringify(nearby));
await page.click('#nearbyBtn');
await page.waitForTimeout(400);
const off = await page.evaluate(() => ({ pressed: document.getElementById('nearbyBtn').getAttribute('aria-pressed'), cards: document.querySelectorAll('#pcLeft .h-name').length }));
ck('모드 해제 시 이전 검색·필터 결과로 돌아온다', off.pressed === 'false' && off.cards === 3, JSON.stringify(off));

// 7. 카드/표 전환 + 정렬 헤더 키보드
await page.click('#pcViewToggle [data-view="table"]');
await page.waitForTimeout(300);
const tbl = await page.evaluate(() => ({
  rows: document.querySelectorAll('#pcLeft tbody tr').length,
  th: document.querySelector('#pcLeft th[data-sortkey]').getAttribute('tabindex'),
  sort: document.querySelector('#pcLeft th[data-sortkey]').getAttribute('aria-sort')
}));
await page.focus('#pcLeft th[data-sortkey]');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
const sorted = await page.evaluate(() => document.querySelector('#pcLeft th[data-sortkey]').getAttribute('aria-sort'));
ck('표 뷰 전환과 정렬 헤더 키보드 조작이 동작한다', tbl.rows === 3 && tbl.th === '0' && sorted !== tbl.sort, JSON.stringify({ tbl, sorted }));
await page.click('#pcViewToggle [data-view="cards"]');
await page.waitForTimeout(300);

// 8. 언어 전환 KO/EN/JA
for (const lang of ['en', 'ja', 'ko']) {
  await page.click(`#langSwitch [data-lang="${lang}"]`);
  await page.waitForTimeout(250);
}
const i18n = await page.evaluate(() => ({
  nearby: document.getElementById('nearbyBtnLabel').textContent,
  legend: [...document.querySelectorAll('#pcMapLegend .lg')].map(e => e.textContent.trim()),
  hint: document.getElementById('pcHint').textContent
}));
ck('KO/EN/JA 전환 후에도 새 UI 문자열이 채워진다',
  !!i18n.nearby && i18n.legend.length === 4 && i18n.legend.every(Boolean) && !!i18n.hint, JSON.stringify(i18n));

// 9. 필터 폭 3단계 · 모바일 모드 전환에서 오류 없음
await page.click('#filtToggleBtn'); await page.waitForTimeout(250);
await page.click('#filtToggleBtn'); await page.waitForTimeout(250);
await page.click('#modeToggle [data-mode="mobile"]'); await page.waitForTimeout(400);
const mobile = await page.evaluate(() => ({ cls: document.body.className, cards: document.querySelectorAll('#cardList .h-card').length }));
await page.click('#modeToggle [data-mode="window"]'); await page.waitForTimeout(400);
ck('모바일 ↔ Window 전환에서 화면이 깨지지 않는다', mobile.cls.includes('mode-mobile') && mobile.cards === 3, JSON.stringify(mobile));

// 10. 좁은 화면(1024/768) 렌더
for (const [w, h] of [[1366, 768], [1024, 768], [390, 844]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(350);
}
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(300);
ck('1920/1366/1024/모바일 폭 전환에서 예외가 없다', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log('');
R.forEach(([m, n, d]) => console.log(m, n, d ? '· ' + d : ''));
const failed = R.filter(r => r[0] === '❌').length;
console.log(`\n결과: ${R.length - failed}/${R.length} 통과`);
if (errs.length) { console.log('\n콘솔/페이지 오류:'); errs.slice(0, 10).forEach(e => console.log('  ' + e)); }
await browser.close();
process.exit(failed || errs.length ? 1 : 0);
