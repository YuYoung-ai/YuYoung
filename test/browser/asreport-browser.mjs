/************************************************************
 * asreport-browser.mjs
 * asreport.html (A/S 항목별 증상·조치 리포트) 브라우저 검증
 * ----------------------------------------------------------
 * 기본 테스트 묶음(node test/*.mjs)에는 포함하지 않는다 —
 * playwright 와 정적 서버가 필요하다.
 *
 *   npx http-server . -p 8099 -s &
 *   BASE=http://127.0.0.1:8099 node test/browser/asreport-browser.mjs
 *
 * GAS·인증 서버는 라우팅으로 가로채 가짜 응답을 준다.
 ************************************************************/
import { createRequire } from 'module';
import { execSync } from 'child_process';

let pw;
try { pw = (await import('playwright')).default; }
catch {
  const roots = [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES];
  try { roots.push(execSync('npm root -g').toString().trim()); } catch {}
  let last;
  for (const root of roots.filter(Boolean)) {
    try { pw = createRequire(import.meta.url)(root + '/playwright'); break; }
    catch (e) { last = e; }
  }
  if (!pw) throw last || new Error('playwright 모듈을 찾을 수 없습니다');
}
const { chromium } = pw;

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const R = [], errs = [];
const ck = (n, c, d) => { R.push([c ? '✅' : '❌', n, d || '']); console.log(c ? '✅' : '❌', n, d ? ('— ' + d) : ''); };
const section = t => console.log('\n── ' + t + ' ──');

const PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL'
  + 'DBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'
  + 'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROME || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.addInitScript(() => {
  try {
    sessionStorage.setItem('baz_auth_token', 'tok-smoke');
    sessionStorage.setItem('baz_auth_level', '3');
    sessionStorage.setItem('baz_auth_name', '권오성');
    sessionStorage.setItem('baz_auth_expires', new Date(Date.now() + 864e5).toISOString());
    sessionStorage.setItem('baz_auth_verified_ts', String(Date.now()));
    localStorage.clear();
  } catch (e) {}
});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/ERR_FAILED|ERR_ABORTED|ERR_CONNECTION/.test(t)) return;
  errs.push('CONSOLE: ' + t);
});
page.on('dialog', d => d.accept());

let lastQuery = '';
await page.route('**yuyoung-ai.deno.net/**', r => r.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ ok: true, valid: true, level: 3, name: '권오성' })
}));
await page.route('**://script.google.com/**', async r => {
  const u = r.request().url();
  const j = o => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (u.includes('action=ping')) return j({ success: true, ver: '3.6.0' });
  if (u.includes('action=asreport')) {
    lastQuery = u;
    return j({
      success: true, count: 2, total: 4, maxCases: 50,
      from: '2026-05-15', to: '2026-08-15',
      items: [
        {
          cat: '장비', type: '냉각수 누수', code: 'E05', count: 3, hospCount: 2,
          parts: [['냉각 호스', 2], ['피팅', 1]],
          results: [['부품 교체', 2], ['조치 완료', 1]],
          guide: { chk: '누수 지점 육안 확인', fix: '호스·피팅 교체 후 가압 확인', fup: '1주 뒤 재확인' },
          truncated: 2,
          cases: [
            { date: '2026-08-01', hosp: '가피부과의원', fse: '권오성', sn: 'BV5001', gubun: 'A/S',
              part: '냉각 호스', cost: '무상', result: '부품 교체', detail: '펌프 하단에서 냉각수 누수',
              remark: '재발 이력 있음', recordId: 'rec_1', snPhoto: 'SN1',
              symptom: [{ fileId: 'C1', desc: '호스 연결부 물맺힘', seq: 1 }],
              after: [{ fileId: 'A1', desc: '호스 교체 후 누수 없음', seq: 1 }] },
            { date: '2026-07-20', hosp: '나피부과의원', fse: '김담당', sn: 'BV5002', gubun: 'A/S',
              part: '피팅', cost: '35000', result: '조치 완료', detail: '피팅 균열',
              remark: '', recordId: 'rec_2', snPhoto: '',
              symptom: [{ fileId: 'C2', desc: '피팅 크랙', seq: 1 }], after: [] }
          ]
        },
        {
          cat: '핸드피스', type: '발열', code: 'H11', count: 1, hospCount: 1,
          parts: [], results: [['이상없음', 1]], guide: null, truncated: 0,
          cases: [
            { date: '2026-06-11', hosp: '다피부과의원', fse: '권오성', sn: 'BV5003', gubun: '점검',
              part: '', cost: '', result: '이상없음', detail: '사용 중 발열 호소',
              remark: '', recordId: 'rec_3', snPhoto: '',
              symptom: [{ fileId: 'C3', desc: '핸드피스 표면 온도 상승', seq: 1 }], after: [] }
          ]
        }
      ]
    });
  }
  if (u.includes('action=snphoto')) {
    const ids = decodeURIComponent((u.match(/ids=([^&]*)/) || [])[1] || '').split(',').filter(Boolean);
    const photos = {}; ids.forEach(i => { photos[i] = PX; });
    return j({ success: true, photos, failed: [] });
  }
  return j({ success: false, error: 'unexpected: ' + u });
});

section('1. 첫 화면 · 기본 기간');
await page.goto(BASE + '/asreport.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.render === 'function');
ck('안내가 먼저 보인다',
  (await page.textContent('#detail')).includes('왼쪽에서 A/S 항목을 고르세요'));
ck('기본 기간이 최근 3개월로 채워진다', await page.evaluate(() => {
  const a = document.getElementById('fromD').value, b = document.getElementById('toD').value;
  const days = (new Date(b) - new Date(a)) / 864e5;
  return !!a && !!b && days > 80 && days < 100 &&
    document.querySelector('#rangeChips .chip.on').getAttribute('data-range') === 'm3';
}));

section('2. 집계 불러오기');
await page.click('#btnLoad');
await page.waitForFunction(() => window.ITEMS && window.ITEMS.length === 2);
ck('유형 목록이 건수 순으로 뜬다',
  (await page.evaluate(() => Array.from(document.querySelectorAll('.titem .t-type span:first-child'))
    .map(e => e.textContent).join('|'))) === '냉각수 누수|발열');
ck('첫 유형이 자동 선택되고 상세가 열린다',
  (await page.textContent('#detail')).includes('장비 / 냉각수 누수'));
ck('표준 대응(유형마스터)을 함께 보여 준다',
  (await page.textContent('#detail')).includes('호스·피팅 교체 후 가압 확인'));
ck('결과·교체품 분포를 집계해 보여 준다', await page.evaluate(() => {
  const t = document.querySelector('#detail .tally').textContent;
  return t.includes('부품 교체') && t.includes('냉각 호스');
}));
ck('증상과 조치를 나란히 보여 준다', await page.evaluate(() => {
  const c = document.querySelector('#detail .case');
  return c.querySelector('.pane.sym').textContent.includes('호스 연결부 물맺힘') &&
         c.querySelector('.pane.act').textContent.includes('호스 교체 후 누수 없음');
}));
ck('처리 내용·교체품·결과가 조치 쪽에 붙는다', await page.evaluate(() => {
  const c = document.querySelector('#detail .case');
  return c.querySelector('.pane.sym').textContent.includes('펌프 하단에서 냉각수 누수') &&
         c.querySelector('.pane.act').textContent.includes('냉각 호스');
}));

section('3. 잘라낸 사례를 숨기지 않는다');
ck('상한으로 생략된 사례 수를 화면에 알린다',
  (await page.textContent('#cutNote')).includes('2건'),
  await page.textContent('#cutNote'));
ck('선택한 유형에도 생략 배지를 단다',
  (await page.textContent('#detail')).includes('사례 2건 생략'));

section('4. 사진');
await page.waitForFunction(() => !!document.querySelector('#detail .shots img'), null, { timeout: 8000 });
ck('증상·해결 후 사진을 프록시로 받아 붙인다',
  (await page.evaluate(() => document.querySelectorAll('#detail .shots img').length)) === 3);
await page.click('#detail .pane.act .shots img');
await page.waitForSelector('#lightbox.show');
ck('사진을 클릭하면 크게 보기가 열리고 설명을 보여 준다',
  (await page.textContent('#lbTitle')).includes('호스 교체 후 누수 없음'),
  await page.textContent('#lbTitle'));
ck('Drive 원본 링크를 제공한다',
  /drive\.google\.com\/file\/d\/A1\/view$/.test(await page.getAttribute('#lbOpen', 'href')));
await page.click('#lbClose');
await page.waitForFunction(() => !document.getElementById('lightbox').classList.contains('show'));

section('5. 검색 · 대분류 필터');
await page.fill('#search', '발열');
await page.waitForFunction(() => document.querySelectorAll('.titem').length === 1);
ck('유형명으로 검색된다',
  (await page.textContent('.titem')).includes('발열'));
await page.fill('#search', '크랙');
await page.waitForFunction(() => {
  const t = document.querySelectorAll('.titem');
  return t.length === 1 && t[0].textContent.includes('냉각수 누수');
}, null, { timeout: 5000 });
ck('증상 사진 설명으로도 유형이 걸린다',
  (await page.textContent('.titem')).includes('냉각수 누수'));
ck('검색어에 맞는 사례만 상세에 남는다',
  (await page.evaluate(() => document.querySelectorAll('#detail .case').length)) === 1 &&
  (await page.textContent('#detail')).includes('나피부과의원'));
await page.fill('#search', '');
await page.waitForFunction(() => document.querySelectorAll('.titem').length === 2);
await page.selectOption('#catFilter', '핸드피스');
await page.waitForFunction(() => document.querySelectorAll('.titem').length === 1);
ck('대분류 필터가 걸린다', (await page.textContent('.titem')).includes('발열'));
await page.selectOption('#catFilter', '');
await page.waitForFunction(() => document.querySelectorAll('.titem').length === 2);

section('6. 보고서용 텍스트');
await page.evaluate(() => { window.CUR = 0; window.render(); });
const txt = await page.evaluate(() => window.reportText(false));
ck('보고서 텍스트에 유형·건수·표준조치가 들어간다',
  txt.includes('■ 장비 / 냉각수 누수') && txt.includes('3건 · 병원 2곳') &&
  txt.includes('표준 조치: 호스·피팅 교체 후 가압 확인'), txt.split('\n')[2]);
ck('사례가 증상/조치 두 줄로 정리된다',
  txt.includes('- 증상: 호스 연결부 물맺힘 / 펌프 하단에서 냉각수 누수') &&
  txt.includes('- 조치: 호스 교체 후 누수 없음 / 교체품 냉각 호스 / 결과 부품 교체'), '');
ck('생략된 사례가 있으면 텍스트에도 명시한다',
  txt.includes('사례 2건은 조회 상한으로 생략됨'));

section('7. 사례 선택 → 선택분만');
await page.click('#detail .case-pick');
ck('선택 개수가 배지에 반영된다',
  (await page.textContent('#totalBadge')).includes('선택 1'),
  await page.textContent('#totalBadge'));
const selTxt = await page.evaluate(() => window.reportText(true));
ck('선택한 사례만 텍스트로 나온다',
  selTxt.includes('가피부과의원') && !selTxt.includes('나피부과의원'));
ck('선택이 없는 유형은 텍스트에서 통째로 빠진다', !selTxt.includes('발열'));

section('8. 엑셀 계획(순수 함수)');
const exportPhotoReady = await page.evaluate(async () => {
  const ph = window.ITEMS[1].cases[0].symptom[0];
  ph._url = null;
  delete window.PHOTO_CACHE[ph.fileId];
  const before = !!ph._url;
  const result = await window.loadExportPhotos(window.ITEMS, false, window.PICKED);
  return { before, after: !!ph._url, failed: result.failed.length };
});
ck('Excel 직전에 열어 보지 않은 유형의 사진도 모두 받는다',
  !exportPhotoReady.before && exportPhotoReady.after && exportPhotoReady.failed === 0,
  JSON.stringify(exportPhotoReady));
const plan = await page.evaluate(() => {
  const p = window.buildAsReportPlan(window.ITEMS, {});
  return { sum: p.sumHeaders.join('|'), cs: p.caseHeaders.join('|'),
           sumRows: p.sumRows.length, caseRows: p.caseRows.length,
           images: p.images.length, firstSum: p.sumRows[0], firstCase: p.caseRows[0] };
});
ck('요약 시트 열: 유형·건수·분포·표준대응',
  plan.sum === '대분류|소분류|코드|총 건수|병원 수|내보낸 사례|조회 상한 생략|A/S 결과 분포|교체품 분포|표준 문제확인|표준 문제해결|표준 후속조치',
  plan.sum);
ck('사례 시트 열: 증상·조치·사진',
  plan.cs === '대분류|소분류|처리일|병원명|담당 FSE|장비 S/N|구분|증상|조치|교체품|교체비용|A/S 결과|비고|증상 사진|해결 후 사진',
  plan.cs);
ck('요약은 유형 수, 사례는 사례 수만큼 나온다',
  plan.sumRows === 2 && plan.caseRows === 3, `sum=${plan.sumRows} case=${plan.caseRows}`);
ck('분포를 사람이 읽는 문자열로 편다',
  plan.firstSum[7] === '부품 교체 2, 조치 완료 1' && plan.firstSum[8] === '냉각 호스 2, 피팅 1');
ck('요약에 실제 내보낸 사례와 조회 상한 생략 수를 적는다',
  plan.firstSum[5] === 2 && plan.firstSum[6] === 2, JSON.stringify(plan.firstSum));
ck('증상 칸에 사진 설명과 처리 내용을 함께 싣는다',
  plan.firstCase[7] === '호스 연결부 물맺힘 / 펌프 하단에서 냉각수 누수', plan.firstCase[7]);
ck('받아 온 사진은 모두 셀에 배치된다', plan.images === 4, String(plan.images));
const noPhotoPlan = await page.evaluate(() => {
  const snap = window.ITEMS[0].cases[0].symptom[0]._url;
  window.ITEMS[0].cases[0].symptom[0]._url = null;      /* 아직 못 받은 사진 */
  const p = window.buildAsReportPlan(window.ITEMS, {});
  window.ITEMS[0].cases[0].symptom[0]._url = snap;
  return p.images.length;
});
ck('아직 받지 못한 사진은 엑셀에 빈 칸으로 남는다', noPhotoPlan === 3, String(noPhotoPlan));
const selPlan = await page.evaluate(() =>
  window.buildAsReportPlan(window.ITEMS, { onlyPicked: true, picked: window.PICKED }));
ck('선택 내보내기는 선택한 사례만 담는다',
  selPlan.caseRows.length === 1 && selPlan.sumRows.length === 1 &&
  selPlan.caseRows[0][3] === '가피부과의원');

section('9. 서버 계약 · 접근성');
ck('asreport 요청에 기간·FSE·사례 상한을 함께 보낸다',
  /action=asreport/.test(lastQuery) && /from=/.test(lastQuery) && /to=/.test(lastQuery) &&
  /maxCases=50/.test(lastQuery), lastQuery.slice(lastQuery.indexOf('?')));
ck('조회 토큰이 붙는다', /token=/.test(lastQuery));
ck('상태 메시지는 aria-live 로 읽힌다',
  (await page.getAttribute('#statusMsg', 'aria-live')) === 'polite');
ck('병원명에 따옴표가 섞여도 마크업이 깨지지 않는다',
  await page.evaluate(() => {
    window.ITEMS[0].cases[0].hosp = 'a" onmouseover="alert(1)" x="';
    window.render();
    const h = document.querySelector('#detail .c-hosp');
    return h.textContent === 'a" onmouseover="alert(1)" x="' && !h.hasAttribute('onmouseover');
  }));

await browser.close();
if (errs.length) { console.log('\n페이지 오류:'); errs.forEach(e => console.log('  ', e)); }
const bad = R.filter(r => r[0] === '❌').length;
console.log('\n──────────────────────────────');
console.log(`통과 ${R.length - bad}/${R.length}` + (errs.length ? ` · 페이지 오류 ${errs.length}건` : ''));
if (bad || errs.length) { console.log('실패 ❌'); process.exit(1); }
console.log('모든 테스트 통과 ✅');
