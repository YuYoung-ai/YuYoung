/************************************************************
 * label-browser.mjs
 * label.html 브라우저 검증 (Chromium · Playwright)
 * ----------------------------------------------------------
 * 기본 테스트 묶음(node test/*.mjs)에는 포함하지 않는다 —
 * playwright 와 정적 서버가 필요하다.
 *
 *   npx http-server . -p 8099 -s &
 *   BASE=http://127.0.0.1:8099 node test/browser/label-browser.mjs
 *
 * GAS·인증 서버는 라우팅으로 가로채 가짜 응답을 준다
 * (실제 병원 데이터·토큰·Drive 를 쓰지 않는다).
 *
 * 정적 검사(test/photo-multi.mjs)로는 확인할 수 없는 것만 여기서 본다:
 * 검색·필터·선택·정렬·되돌리기·자동 저장 복구·라이트박스·카드 레이아웃,
 * 그리고 "시트에서 받은 사진을 일괄 배치가 덮어쓰지 않는가" 같은 상호작용.
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
/* 즉시 출력한다 — 중간에 타임아웃이 나도 어디까지 통과했는지 보여야 한다 */
const ck = (n, c, d) => { R.push([c ? '✅' : '❌', n, d || '']); console.log(c ? '✅' : '❌', n, d ? ('— ' + d) : ''); };
const section = t => console.log('\n── ' + t + ' ──');

/* 1×1 JPEG — 사진 응답·파일 첨부에 쓴다 */
const PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL'
  + 'DBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'
  + 'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const JPEG_BYTES = Buffer.from(PX.split(',')[1], 'base64');

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROME || undefined });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(() => {
  try {
    sessionStorage.setItem('baz_auth_token', 'tok-smoke');
    sessionStorage.setItem('baz_auth_level', '3');
    sessionStorage.setItem('baz_auth_name', '권오성');
    sessionStorage.setItem('baz_auth_expires', new Date(Date.now() + 864e5).toISOString());
    sessionStorage.setItem('baz_auth_verified_ts', String(Date.now()));
    /* 첫 진입에서만 비운다 — reload 자동 저장 복구 테스트가 자기 초안을 지우지 않게 */
    if (!sessionStorage.getItem('__booted')) { localStorage.clear(); sessionStorage.setItem('__booted', '1'); }
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

const posts = [];
let photoScenario = 'ok';

await page.route('**yuyoung-ai.deno.net/**', r => r.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ ok: true, valid: true, level: 3, name: '권오성' })
}));
await page.route('**://script.google.com/**', async r => {
  const req = r.request();
  const u = req.url();
  const j = o => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });

  if (req.method() === 'POST') {
    posts.push(JSON.parse(req.postData() || '{}'));
    return j({ success: true, checked: 2, written: 2, missed: 0 });
  }
  if (u.includes('action=ping')) return j({ success: true, ver: '3.4.1' });
  if (u.includes('action=labellist')) {
    return j({
      success: true, count: 3, from: '2026-08-01', to: '2026-08-07',
      excluded: 1, excludedNames: ['이미쓴의원'],
      rows: [
        { hosp: '나피부과의원', sn: 'BV5002', note: '병원 장비', recordId: 'rec_2',
          photos: [{ fileId: 'SN2', kind: 'SN', seq: 1, desc: '' }] },
        { hosp: '가피부과의원', sn: 'BV5001', note: '병원 장비', recordId: 'rec_1',
          photos: [{ fileId: 'SN1', kind: 'SN', seq: 1, desc: '' },
                   { fileId: 'C1', kind: 'CAUSE', seq: 1, desc: '커넥터 파손' },
                   { fileId: 'A1', kind: 'AFTER', seq: 1, desc: '커넥터 교체' }] },
        /* S/N 사진 없이 원인 사진만 있는 행 — 재시도 인덱스 오프바이원을 잡는 케이스 */
        { hosp: '다피부과의원', sn: 'BV5003', note: '데모 장비', recordId: 'rec_3',
          photos: [{ fileId: 'CX', kind: 'CAUSE', seq: 1, desc: '누수' }] }
      ]
    });
  }
  if (u.includes('action=snphoto')) {
    const ids = decodeURIComponent((u.match(/ids=([^&]*)/) || [])[1] || '').split(',').filter(Boolean);
    const photos = {}, failed = [];
    ids.forEach(id => {
      if (photoScenario === 'failCX' && id === 'CX') { failed.push(id); return; }
      photos[id] = PX;
    });
    return j({ success: true, photos, failed });
  }
  return j({ success: false, error: 'unexpected: ' + u });
});

const go = async () => {
  await page.goto(BASE + '/label.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.render === 'function');
};
const rowsOf = () => page.evaluate(() => window.rows.map(r => ({
  h: r.hospital, s: r.sn, n: r.note,
  sn: r.snPhoto ? { id: r.snPhoto.fileId, st: r.snPhoto.state, has: !!r.snPhoto.thumbDataUrl } : null,
  local: !!r.imageDataUrl,
  c: (r.causePhotos || []).map(p => ({ id: p.fileId, st: p.state, d: p.desc, has: !!p.thumbDataUrl })),
  a: r.afterPhoto ? { id: r.afterPhoto.fileId, st: r.afterPhoto.state, d: r.afterPhoto.desc,
                      has: !!r.afterPhoto.thumbDataUrl } : null
})));
const visibleRows = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('#tableHolder [data-row-idx]'))
    .map(e => Number(e.getAttribute('data-row-idx'))));

section('1. 첫 화면');
await go();
ck('빈 목록 안내가 먼저 보인다',
  (await page.textContent('#tableHolder')).includes('아직 입력된 병원이 없습니다'));
ck('기본 조회 기간이 토~금 7일로 채워진다', await page.evaluate(() => {
  const a = document.getElementById('loadFrom').value, b = document.getElementById('loadTo').value;
  if (!a || !b) return false;
  const d = (new Date(b) - new Date(a)) / 864e5;
  return d === 6 && new Date(a + 'T00:00:00').getDay() === 6;   /* 시작이 토요일 */
}));
ck('공용 모듈(BazDom·BazPhoto)이 로드된다',
  await page.evaluate(() => !!(window.BazDom && window.BazPhoto && window.BazModal)));

section('2. 시트에서 불러오기 · lazy loading');
await page.click('#btnLoad');
await page.waitForFunction(() => window.rows.length === 3);
await page.waitForFunction(() => window.rows[0].snPhoto.state === 'ok', null, { timeout: 8000 });
/* 표는 첫 화면 아래에 있다 — 맨 아래 행은 아직 받지 않아야 lazy loading 이 동작하는 것이다 */
ck('첫 화면 밖의 행은 아직 받지 않는다(lazy loading)',
  await page.evaluate(() => window.rows[2].causePhotos[0].state !== 'ok'));
await page.evaluate(() => {
  const el = document.querySelector('[data-row-idx="2"]');
  if (el) el.scrollIntoView({ block: 'center' });
});
await page.waitForFunction(() => window.rows.every(r =>
  window.rowPhotos(r).every(p => p.state === 'ok')), null, { timeout: 8000 });
ck('스크롤하면 IntersectionObserver 가 나머지를 받아 온다', true);
let rs = await rowsOf();
ck('3건을 불러오고 S/N·증상·해결 후 사진을 모두 채운다',
  rs.length === 3 && rs[1].sn.has && rs[1].c[0].has && rs[1].a.has && rs[2].c[0].has,
  JSON.stringify(rs.map(r => r.h)));
ck('해결 후 사진(AFTER)이 별도 칸으로 들어온다',
  rs[1].a.id === 'A1' && rs[1].a.d === '커넥터 교체');
ck('사진 칸이 행마다 S/N·증상·해결 후 3개로 그려진다',
  await page.evaluate(() =>
    document.querySelectorAll('[data-row-idx="1"] .img-cell').length === 3 &&
    Array.from(document.querySelectorAll('[data-row-idx="1"] .ph-name'))
      .map(e => e.textContent).join('|') === 'S/N|증상|해결 후'));
ck('제외된 병원 안내가 뜬다',
  (await page.textContent('#dupNote')).includes('이미쓴의원'));
ck('3장이 모두 있는 행만 완비로 센다',
  (await page.textContent('#badges')).includes('사진 3장 1/3'),
  await page.textContent('#badges'));

section('3. 재시도 인덱스 (S/N 없이 원인 사진만 있는 행)');
photoScenario = 'failCX';
await page.evaluate(() => {
  const r = window.rows[2];
  r.causePhotos[0].state = 'failed';
  r.causePhotos[0].thumbDataUrl = null;
  window.paintPhotoCell(2);
});
const retryAttr = await page.getAttribute('[data-row-idx="2"] .ph-retry', 'onclick');
ck('S/N 사진이 없는 행의 증상 사진 재시도는 0번을 가리킨다',
  /retryPhoto\(2,0\)/.test(retryAttr || ''), retryAttr);
/* 예전 기록(증상 여러 장)의 추가 썸네일도 같은 규칙으로 인덱스를 잡아야 한다 */
const extraAttr = await page.evaluate(() => {
  const r = window.rows[2];
  r.causePhotos.push({ fileId: 'CX2', kind: 'CAUSE', seq: 2, desc: '', thumbDataUrl: null, state: 'failed' });
  window.paintPhotoCell(2);
  const b = document.querySelector('[data-row-idx="2"] .cause-thumbs .ct.fail');
  const at = b ? b.getAttribute('onclick') : '';
  r.causePhotos.pop();
  window.paintPhotoCell(2);
  return at;
});
ck('예전 기록의 추가 증상 사진 재시도도 실제 로딩 위치를 가리킨다',
  /retryPhoto\(2,1\)/.test(extraAttr || ''), extraAttr);
photoScenario = 'ok';
await page.click('[data-row-idx="2"] .ph-retry');
await page.waitForFunction(() => window.rows[2].causePhotos[0].state === 'ok', null, { timeout: 8000 });
ck('재시도로 그 사진이 실제로 다시 받아진다',
  (await page.evaluate(() => !!window.rows[2].causePhotos[0].thumbDataUrl)));

section('4. 검색 · 필터');
await page.fill('#searchInput', '가피부과');
await page.waitForFunction(() => document.querySelectorAll('#tableHolder [data-row-idx]').length === 1);
ck('검색이 병원명으로 걸린다', (await visibleRows()).join() === '1');
await page.fill('#searchInput', '');
await page.waitForFunction(() => document.querySelectorAll('#tableHolder [data-row-idx]').length === 3);
await page.click('#filterChips [data-filter="nophoto"]');
ck('"사진 미완" 필터는 3장이 다 차지 않은 행을 남긴다', (await visibleRows()).join() === '0,2',
  (await visibleRows()).join());
await page.click('#filterChips [data-filter="all"]');

section('5. 선택 · 선택 삭제 · 되돌리기');
await page.click('[data-act="pick"][data-idx="0"]');
await page.click('[data-act="pick"][data-idx="2"]');
ck('선택 배지가 뜬다', (await page.textContent('#badges')).includes('선택 2건'));
await page.click('#btnDeleteSel');
ck('선택 삭제가 두 행을 지운다', (await page.evaluate(() => window.rows.length)) === 1);
await page.click('#btnUndo');
await page.waitForFunction(() => window.rows.length === 3);
rs = await rowsOf();
ck('되돌리기로 사진까지 그대로 복구된다',
  rs.length === 3 && rs[1].sn.has && rs[1].c[0].has);

section('6. 정렬');
await page.selectOption('#sortSelect', 'hospital');
rs = await rowsOf();
ck('병원명 정렬은 rows 자체를 바꾼다(화면과 출력 순서가 같다)',
  rs.map(r => r.h).join(',') === '가피부과의원,나피부과의원,다피부과의원', rs.map(r => r.h).join(','));
ck('정렬 뒤에도 각 행의 사진이 따라간다', rs[0].sn.has && rs[0].c[0].d === '커넥터 파손');
await page.click('#btnUndo');
await page.waitForFunction(() => window.rows[0].hospital === '나피부과의원');

section('7. 사진 일괄 배치가 시트 사진을 덮어쓰지 않는다');
const before = (await rowsOf()).map(r => r.sn.id);
await page.setInputFiles('#bulkPhotos', [{ name: 'a.jpg', mimeType: 'image/jpeg', buffer: JPEG_BYTES }]);
await page.waitForFunction(() => window.rows.some(r => !!r.imageDataUrl), null, { timeout: 15000 });
rs = await rowsOf();
const overwritten = rs.filter((r, i) => before[i] && r.local);
ck('일괄 배치는 시트에서 받은 S/N 사진 칸을 덮어쓰지 않는다',
  overwritten.length === 0, JSON.stringify(rs.map(r => ({ h: r.h, id: r.sn.id, local: r.local }))));
ck('일괄 배치는 빈 사진 칸(다피부과)에 들어간다', rs[2].local === true);
await page.click('#btnUndo');

section('8. 텍스트 일괄 반영');
await page.fill('#bulkText', '병원명\t장비 S/N\t비고\n라의원\tBV9001\t데모 장비\n라의원\tBV9001\t데모 장비\n마의원,BV9002');
await page.click('#btnBulkText');
rs = await rowsOf();
ck('머리글 줄과 중복 줄을 걸러 낸다',
  rs.length === 5 && rs[3].h === '라의원' && rs[4].h === '마의원', JSON.stringify(rs.map(r => r.h)));
ck('쉼표 구분도 인식하고 비고 기본값을 채운다', rs[4].s === 'BV9002' && rs[4].n === '병원 장비');
ck('붙여넣기로 만든 행도 정식 스키마를 가진다(snPhoto·causePhotos 존재)',
  await page.evaluate(() => window.rows.slice(3).every(r =>
    !!r.uid && !!r.snPhoto && Array.isArray(r.causePhotos))));

section('9. 라이트박스');
await page.click('[data-row-idx="1"] .img-cell img');
await page.waitForSelector('#lightbox.show');
ck('사진 클릭으로 크게 보기가 열리고 3장을 넘겨 본다',
  (await page.textContent('#lbCount')) === '1 / 3', await page.textContent('#lbCount'));
await page.click('[data-act="lbnext"]');
ck('증상 사진으로 넘어가고 설명이 채워진다',
  (await page.inputValue('#lbDesc')) === '커넥터 파손');
ck('크게 보기 제목이 칸 이름을 말한다',
  (await page.textContent('#lbTitle')).includes('현장에서 확인한 증상'),
  await page.textContent('#lbTitle'));
await page.fill('#lbDesc', '커넥터 파손(재확인)');
await page.click('#lbClose');
await page.waitForFunction(() => !document.getElementById('lightbox').classList.contains('show'));
ck('라이트박스에서 고친 설명이 데이터에 반영된다',
  (await page.evaluate(() => window.rows[1].causePhotos[0].desc)) === '커넥터 파손(재확인)');
ck('설명은 Excel 계획의 증상 내용 열로 이어진다',
  await page.evaluate(() => {
    const p = window.buildLabelSheetPlan([window.rows[1]], {});
    return p.bodyRows[0].values[p.causeTextCol] === '1. 커넥터 파손(재확인)' &&
           p.bodyRows[0].values[p.afterTextCol] === '커넥터 교체';
  }));
ck('내보내기 열이 정확히 3장 구성이다',
  await page.evaluate(() => window.buildLabelSheetPlan([window.rows[1]], {}).headers.join('|')
    === 'No.|병원명|장비 S/N|S/N 사진|증상 사진|해결 후 사진|증상 내용|조치 내용|비고'));

section('10. 내보내기 범위 · 시트 기록');
posts.length = 0;
await page.evaluate(() => { window.SELECTED = {}; window.SELECTED[window.rows[0].uid] = 1; window.render(); });
ck('선택이 있으면 그 행만 내보내기 대상이다',
  (await page.evaluate(() => window.exportTargets().map(r => r.hospital))).join() === '나피부과의원');
await page.evaluate(() => window.markDownloaded(window.exportTargets()));
await page.waitForFunction(() => true);
ck('시트 기록은 내보낸 행만 보낸다(전체 40곳이 통째로 완료 처리되지 않는다)',
  posts.length === 1 && posts[0].action === 'labeldone' &&
  posts[0].hosps.join() === '나피부과의원', JSON.stringify(posts));
posts.length = 0;
await page.uncheck('#markDone');
const skipMsg = await page.evaluate(() => window.markDownloaded(window.exportTargets()));
ck('기록 체크를 끄면 시트에 아무것도 보내지 않는다',
  posts.length === 0 && /기록 안 함/.test(skipMsg));
await page.check('#markDone');

section('11. 자동 저장 · 복구');
await page.waitForFunction(() => /자동 저장됨/.test(document.getElementById('autoSaveMark').textContent),
  null, { timeout: 5000 });
ck('자동 저장 표시가 뜬다', true);
/* 자동 저장은 debounce(700ms) 라, 그 사이에 창을 닫으면 마지막 편집이 통째로 사라진다.
   타이머가 살아 있는 상태에서 flushDraft 가 확정시키는지 본다. */
await page.evaluate(() => { window.rows[0].note = '플러시 확인'; window.markDirty(); });
await page.evaluate(() => window.flushDraft());
const draftRows = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('baz_label_draft') || 'null');
  return d ? d.rows.map(r => r.h + ':' + r.n) : [];
});
ck('밀린 자동 저장을 창 닫기 전에 확정한다(flushDraft)',
  draftRows.length === 5 && /플러시 확인/.test(draftRows[0]), draftRows.join('|'));
const savedSize = await page.evaluate(() => (localStorage.getItem('baz_label_draft') || '').length);
ck('초안이 localStorage 예산 안에 저장된다', savedSize > 0 && savedSize < 2200000, 'len=' + savedSize);
await go();
await page.waitForSelector('#restoreNote.on');
ck('새로고침하면 복구 안내가 뜬다',
  (await page.textContent('#restoreNote')).includes('이전 작업 5건'),
  await page.textContent('#restoreNote'));
await page.click('#btnRestore');
await page.waitForFunction(() => window.rows.length === 5);
/* 복구 직후에도 lazy loading 규칙은 그대로다 — 보이는 행부터 다시 받는다 */
await page.evaluate(() => {
  const el = document.querySelector('[data-row-idx="1"]');
  if (el) el.scrollIntoView({ block: 'center' });
});
await page.waitForFunction(() => window.rows[1].snPhoto.state === 'ok', null, { timeout: 8000 });
rs = await rowsOf();
ck('복구하면 행·설명이 살아나고 사진은 fileId 로 다시 받아진다',
  rs.length === 5 && rs[1].c[0].d === '커넥터 파손(재확인)' && rs[1].sn.has,
  JSON.stringify(rs.map(r => r.h)));

section('12. 모바일 카드 레이아웃');
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForFunction(() => document.querySelectorAll('#tableHolder .rcard').length === 5,
  null, { timeout: 5000 });
ck('좁은 화면에서는 표 대신 카드로 그린다',
  (await page.evaluate(() => !document.querySelector('#tableHolder table.list'))));
ck('카드에도 사진 셀 계약(data-row-idx)이 그대로 있다',
  (await visibleRows()).join() === '0,1,2,3,4');
await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForFunction(() => !!document.querySelector('#tableHolder table.list'), null, { timeout: 5000 });
ck('넓은 화면으로 돌아오면 다시 표가 된다', true);

section('13. 접근성 · 안전');
ck('사진 칸은 키보드로 조작할 수 있다(role·tabindex)',
  await page.evaluate(() => {
    const c = document.querySelector('.img-cell');
    return c.getAttribute('role') === 'button' && c.getAttribute('tabindex') === '0';
  }));
ck('상태 메시지는 aria-live 로 읽힌다',
  (await page.getAttribute('#statusMsg', 'aria-live')) === 'polite');
ck('병원명에 따옴표가 섞여도 마크업이 깨지지 않는다',
  await page.evaluate(() => {
    window.rows[0].hospital = 'a" onmouseover="alert(1)" x="';
    window.render();
    const inp = document.querySelector('[data-ri="0"][data-field="hospital"]');
    return inp && inp.value === 'a" onmouseover="alert(1)" x="' && !inp.hasAttribute('onmouseover');
  }));

/* ── 결과 ── */
await browser.close();
console.log('');
if (errs.length) { console.log('\n페이지 오류:'); errs.forEach(e => console.log('  ', e)); }
const bad = R.filter(r => r[0] === '❌').length;
console.log('\n──────────────────────────────');
console.log(`통과 ${R.length - bad}/${R.length}` + (errs.length ? ` · 페이지 오류 ${errs.length}건` : ''));
if (bad || errs.length) { console.log('실패 ❌'); process.exit(1); }
console.log('모든 테스트 통과 ✅');
