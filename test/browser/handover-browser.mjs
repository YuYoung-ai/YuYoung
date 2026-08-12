/************************************************************
 * handover-browser.mjs
 * handover.html 브라우저 검증 (Chromium · Playwright)
 * ----------------------------------------------------------
 * 기본 테스트 묶음(node test/*.mjs)에는 포함하지 않는다 —
 * playwright 와 정적 서버가 필요하다.
 *
 *   npx http-server . -p 8099 -s &
 *   BASE=http://127.0.0.1:8099 node test/browser/handover-browser.mjs
 *
 * GAS·인증 서버는 라우팅으로 가로채 가짜 응답을 준다
 * (실제 병원 데이터·토큰·Drive 를 쓰지 않는다).
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
const ck = (n, c, d) => R.push([c ? '✅' : '❌', n, d || '']);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() => {
  try {
    sessionStorage.setItem('baz_auth_token', 'tok-smoke');
    sessionStorage.setItem('baz_auth_level', '3');
    sessionStorage.setItem('baz_auth_name', '권오성');
    sessionStorage.setItem('baz_auth_expires', new Date(Date.now() + 864e5).toISOString());
    sessionStorage.setItem('baz_auth_verified_ts', String(Date.now()));
    /* 첫 진입에서만 비운다 — reload 초안 복원 테스트가 자기 초안을 지우지 않게 */
    if (!sessionStorage.getItem('__booted')) { localStorage.clear(); sessionStorage.setItem('__booted', '1'); }
  } catch (e) {}
});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
/* 'lostresponse' 시나리오에서 일부러 abort 하므로 그 네트워크 오류는 제외한다 */
page.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/ERR_FAILED|ERR_ABORTED|ERR_CONNECTION/.test(t)) return;
  errs.push('CONSOLE: ' + t);
});
page.on('dialog', d => d.accept());

/* 서버 시나리오 — 테스트가 바꿔 가며 쓴다 */
let scenario = 'ok';
let postCount = 0;
const saved = new Map();

await page.route('**yuyoung-ai.deno.net/**', r => r.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ ok: true, valid: true, level: 3, name: '권오성' })
}));
await page.route('**://script.google.com/**', async r => {
  const req = r.request();
  const u = req.url();
  const j = o => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });

  if (req.method() === 'POST') {
    postCount++;
    const p = JSON.parse(req.postData() || '{}');
    if (scenario === 'photofail') {
      return j({ success: false, row: null, error: '사진 저장 실패 — 기록하지 않았습니다: Drive 오류',
                 photo: { required: true, saved: false, fileId: '', error: 'Drive 오류' } });
    }
    if (scenario === 'lostresponse') { return r.abort(); }            // 응답 유실
    if (scenario === 'photolie') {
      return j({ success: true, row: 9, photo: { required: true, saved: false, fileId: '', error: '열 없음' } });
    }
    if (scenario === 'legacyphoto') return j({ success: true, row: 10 });
    if (scenario === 'slowok') await new Promise(resolve => setTimeout(resolve, 900));
    saved.set(p.reqId, { success: true, row: 100 + saved.size,
      photo: { required: true, saved: true, fileId: 'F1', error: '' },
      savedFields: { verUI: true, verHP: true, nozzleDate: true, result: true, remark: true, code: true, eqKind: true },
      warnings: [], msg: '✅ 기록 완료' });
    return j(saved.get(p.reqId));
  }
  if (u.includes('action=ping')) return j({ success: true, ver: '3.1.0' });
  if (u.includes('action=savecheck')) {
    const id = decodeURIComponent((u.match(/reqId=([^&]+)/) || [])[1] || '');
    if (scenario === 'lostresponse_found') return j({ success: true, found: true, reqId: id, result: { success: true, row: 55, photo: { required: true, saved: true, fileId: 'F9', error: '' } } });
    return j({ success: true, found: false, reqId: id });
  }
  if (u.includes('action=handover_bootstrap')) return j({
    success: true, ver: '3.1.0',
    hospdb: { success: true, data: [
      { name: '테스트병원', sn: 'BV1234,BV5678', ncare: 'Basic', sales: '홍길동', region: '서울 / 경기', hpVer: '1.2', uiVer: '3.0' },
      { name: '다른병원', sn: 'BW9999', ncare: '미가입', sales: '김철수', region: '부산', hpVer: '', uiVer: '' }
    ] },
    master: { success: true, taxonomy: { '장비': [['E01', '메인보드 불량'], ['E02', '풋스위치 작동 불량']] }, parts: ['Main Board'], fse: ['권오성'] },
    contenttpl: { success: true, rows: [] }, weeklyauto: { success: true, writers: [] }
  });
  if (u.includes('action=recent')) {
    const hosp = decodeURIComponent((u.match(/hosp=([^&]+)/) || [])[1] || '');
    return j({ success: true, count: 1, data: [{ date: '2026-08-01', fse: '권오성', gubun: 'A/S', cat: '장비', type: '메인보드 불량', part: 'Main Board', detail: hosp + ' 이력' }] });
  }
  return j({ success: true, data: [] });
});

await page.goto(BASE + '/handover.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

/* 공통: 저장 가능한 상태로 폼 채우기 */
async function fillForm(hosp = '테스트병원') {
  await page.fill('#fse', '권오성');
  await page.fill('#hosp', hosp);
  await page.waitForTimeout(350);
  const item = page.locator('#hospDrop .ac-item').first();
  if (await item.count()) { await item.click(); await page.waitForTimeout(350); }
  await page.fill('#detail', '메인보드 교체');
  await page.fill('#cost', '1,650,000');
  await page.waitForTimeout(200);
}
async function attachPhoto() {
  await page.setInputFiles('#snPhotoFile', {
    name: 'sn.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  });
  await page.waitForTimeout(600);
}

/* 1. 부트스트랩 1콜 · 토큰 · DB 배지 */
const boot = await page.evaluate(() => ({
  badge: document.getElementById('dbBadge').textContent,
  hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
}));
ck('부트스트랩으로 최신 DB 를 받아 배지에 표시한다', boot.badge.includes('최신'), boot.badge);
ck('390px 에서 가로 넘침이 없다', boot.hOverflow === 0);

/* 2. 병원 선택 → 종속 필드 채워짐 → 이름 수정 시 초기화 */
await fillForm();
const picked = await page.evaluate(() => ({
  ui: document.getElementById('verUI').value, hp: document.getElementById('verHP').value,
  snOpts: document.getElementById('sn').options.length,
  recent: document.getElementById('recentCard').style.display
}));
ck('병원 선택 시 S/N·버전·최근 이력이 채워진다',
  picked.ui === '3.0' && picked.hp === '1.2' && picked.snOpts >= 3 && picked.recent === 'block', JSON.stringify(picked));
await page.fill('#hosp', '테스트병원X');
await page.waitForTimeout(300);
const afterEdit = await page.evaluate(() => ({
  ui: document.getElementById('verUI').value, hp: document.getElementById('verHP').value,
  snOpts: document.getElementById('sn').options.length,
  recent: document.getElementById('recentCard').style.display,
  match: document.getElementById('hospMatch').textContent
}));
ck('병원명을 수정하면 종속 정보가 초기화된다',
  afterEdit.ui === '' && afterEdit.hp === '' && afterEdit.snOpts === 2 &&
  afterEdit.recent === 'none' && afterEdit.match.includes('DB 미선택'), JSON.stringify(afterEdit));

/* 3. 비용 쉼표 · NaN 없음 */
await fillForm();
const preview = await page.evaluate(() => {
  document.getElementById('tplB').click();
  return document.getElementById('preview').textContent;
});
ck('쉼표 비용이 NaN 없이 표시된다', preview.includes('1,650,000원') && !preview.includes('NaN'));
await page.evaluate(() => document.getElementById('tplA').click());

/* 4. 사진 없이 저장 → 검증 오류 · 서버 호출 없음 */
const before = postCount;
await page.click('#btnSave');
await page.waitForTimeout(500);
const noPhoto = await page.evaluate(() => ({
  errShown: document.getElementById('errorCard').style.display,
  zoneInvalid: document.getElementById('snPhotoZone').classList.contains('invalid'),
  copyDisabled: document.getElementById('btnCopy').disabled
}));
ck('필수 사진 없이 저장하면 필드 오류를 표시하고 전송하지 않는다',
  postCount === before && noPhoto.errShown === 'block' && noPhoto.zoneInvalid && noPhoto.copyDisabled,
  JSON.stringify(noPhoto));

/* 5. 사진 실패 → 사진 유지 · 복사/이어쓰기 비활성 */
await attachPhoto();
scenario = 'photofail';
await page.click('#btnSave');
await page.waitForTimeout(1200);
const photoFail = await page.evaluate(() => ({
  state: document.getElementById('saveStatus').className,
  photoShown: document.getElementById('snPhotoPrev').style.display,
  copyDisabled: document.getElementById('btnCopy').disabled,
  contDisabled: document.getElementById('btnCont').disabled,
  recent: localStorage.getItem('baz_recent_handover')
}));
ck('사진 저장 실패 시 사진 미리보기가 유지된다', photoFail.photoShown === 'block', JSON.stringify(photoFail));
ck('사진 실패 시 복사·이어쓰기가 활성화되지 않는다', photoFail.copyDisabled && photoFail.contDisabled);
ck('사진 실패 시 실패 상태로 표시된다', photoFail.state.includes('err'));
ck('사진 실패 시 최근 완료를 로컬에 남기지 않는다', !photoFail.recent);

/* 6. success:true 인데 사진 미저장 → 실패로 판정 */
scenario = 'photolie';
await page.click('#btnSave');
await page.waitForTimeout(1200);
const lie = await page.evaluate(() => ({
  state: document.getElementById('saveStatus').className,
  photoShown: document.getElementById('snPhotoPrev').style.display,
  copyDisabled: document.getElementById('btnCopy').disabled
}));
ck('success:true 라도 사진 미저장이면 성공으로 표시하지 않는다',
  lie.state.includes('err') && lie.photoShown === 'block' && lie.copyDisabled, JSON.stringify(lie));

/* 6-b. 구버전 GAS가 photo 블록 없이 success:true → 실패 */
scenario = 'legacyphoto';
await page.click('#btnSave');
await page.waitForTimeout(1200);
const legacy = await page.evaluate(() => ({
  state: document.getElementById('saveStatus').className,
  photoShown: document.getElementById('snPhotoPrev').style.display,
  copyDisabled: document.getElementById('btnCopy').disabled
}));
ck('photo 확인 블록 없는 구버전 성공 응답을 거부한다',
  legacy.state.includes('err') && legacy.photoShown === 'block' && legacy.copyDisabled,
  JSON.stringify(legacy));

/* 6-c. 저장 진행 중 사진 교체·삭제 잠금 */
scenario = 'slowok';
const slowSave = page.click('#btnSave');
await page.waitForTimeout(150);
const lockedPhoto = await page.evaluate(() => ({
  file: document.getElementById('snPhotoFile').disabled,
  remove: document.getElementById('snPhotoRemove').disabled,
  save: document.getElementById('btnSave').disabled
}));
ck('저장 진행 중 사진 입력·삭제·저장 버튼이 잠긴다',
  lockedPhoto.file && lockedPhoto.remove && lockedPhoto.save, JSON.stringify(lockedPhoto));
await slowSave;
await page.waitForTimeout(1000);
await page.evaluate(() => startNewRecord());
await fillForm();
await attachPhoto();

/* 7. 응답 유실 → 결과 불명 (성공으로 처리하지 않음) */
scenario = 'lostresponse';
await page.click('#btnSave');
await page.waitForTimeout(3500);
const unknown = await page.evaluate(() => ({
  state: document.getElementById('saveStatus').className,
  text: document.getElementById('saveStatus').textContent,
  copyDisabled: document.getElementById('btnCopy').disabled,
  photoShown: document.getElementById('snPhotoPrev').style.display,
  acts: [...document.querySelectorAll('#saveActions button')].map(b => b.textContent)
}));
ck('응답을 확인할 수 없으면 성공으로 처리하지 않는다',
  unknown.state.includes('unknown') && unknown.copyDisabled && unknown.photoShown === 'block',
  JSON.stringify({ s: unknown.state, c: unknown.copyDisabled }));
ck('결과 불명이면 재확인·미기록 복사를 제공한다',
  unknown.acts.some(t => t.includes('다시 확인')) && unknown.acts.some(t => t.includes('미기록')),
  unknown.acts.join(' | '));

/* 8. 정상 저장 → 성공 · 사진 정리 · 복사 활성 · dirty 전환 */
scenario = 'ok';
await page.click('#btnSave');
await page.waitForTimeout(1500);
const ok = await page.evaluate(() => ({
  state: document.getElementById('saveStatus').className,
  copyDisabled: document.getElementById('btnCopy').disabled,
  contDisabled: document.getElementById('btnCont').disabled,
  photoShown: document.getElementById('snPhotoPrev').style.display,
  recent: !!localStorage.getItem('baz_recent_handover'),
  draft: !!localStorage.getItem('baz_handover_draft_v1')
}));
ck('확인된 성공에서만 복사·이어쓰기가 열린다',
  ok.state.includes('ok') && !ok.copyDisabled && !ok.contDisabled, JSON.stringify(ok));
ck('성공 후 사진이 정리되고 최근 완료가 기록된다', ok.photoShown === 'none' && ok.recent);
ck('성공 후 초안이 정리된다', !ok.draft);

/* 9. 저장 후 내용 변경 → dirty */
await page.fill('#detail', '내용 수정함');
await page.waitForTimeout(400);
const dirty = await page.evaluate(() => ({
  isDirty: document.body.classList.contains('is-dirty'),
  copyDisabled: document.getElementById('btnCopy').disabled,
  badge: getComputedStyle(document.querySelector('.dirty-badge')).display
}));
ck('저장 후 입력을 바꾸면 dirty 로 전환된다',
  dirty.isDirty && dirty.copyDisabled && dirty.badge !== 'none', JSON.stringify(dirty));

/* 10. 사진 A→B 교체 경합 */
await attachPhoto();
await page.waitForTimeout(300);
const twoPhotos = await page.evaluate(async () => {
  const f = document.getElementById('snPhotoFile');
  const mk = (c) => { const cv = document.createElement('canvas'); cv.width = cv.height = 8;
    const x = cv.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 8, 8); return cv.toDataURL('image/png'); };
  const toFile = async (d, n) => new File([await (await fetch(d)).blob()], n, { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(await toFile(mk('#ff0000'), 'A.png'));
  f.files = dt.files; f.dispatchEvent(new Event('change'));
  const dt2 = new DataTransfer(); dt2.items.add(await toFile(mk('#0000ff'), 'B.png'));
  f.files = dt2.files; f.dispatchEvent(new Event('change'));
  await new Promise(r => setTimeout(r, 900));
  const img = document.getElementById('snPhotoImg');
  const cv = document.createElement('canvas'); cv.width = cv.height = 8;
  cv.getContext('2d').drawImage(img, 0, 0, 8, 8);
  const px = cv.getContext('2d').getImageData(1, 1, 1, 1).data;
  return { r: px[0], b: px[2], busy: document.getElementById('btnSave').disabled };
});
ck('사진 A→B 교체 경합에서 B 만 최신으로 남는다',
  twoPhotos.b > twoPhotos.r, JSON.stringify(twoPhotos));
ck('사진 처리가 끝나면 저장 버튼이 다시 열린다', twoPhotos.busy === false);

/* 11. 새 기록 흐름 */
await page.evaluate(() => startNewRecord());
await page.waitForTimeout(400);
const fresh = await page.evaluate(() => ({
  hosp: document.getElementById('hosp').value,
  detail: document.getElementById('detail').value,
  photoShown: document.getElementById('snPhotoPrev').style.display,
  copyDisabled: document.getElementById('btnCopy').disabled,
  dirty: document.body.classList.contains('is-dirty')
}));
ck('새 기록 시작이 양식을 비우고 잠금을 되돌린다',
  !fresh.hosp && !fresh.detail && fresh.photoShown === 'none' && fresh.copyDisabled && !fresh.dirty,
  JSON.stringify(fresh));

/* 12. 자동완성 키보드 · ARIA */
await page.fill('#hosp', '병원');
await page.waitForTimeout(350);
await page.keyboard.press('ArrowDown');
const kb = await page.evaluate(() => ({
  expanded: document.getElementById('hosp').getAttribute('aria-expanded'),
  active: document.getElementById('hosp').getAttribute('aria-activedescendant'),
  selected: document.querySelectorAll('#hospDrop .ac-item[aria-selected="true"]').length
}));
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
const afterEnter = await page.evaluate(() => ({
  hosp: document.getElementById('hosp').value,
  open: document.getElementById('hospDrop').style.display
}));
ck('자동완성을 방향키·Enter 로 조작할 수 있다',
  kb.expanded === 'true' && !!kb.active && kb.selected === 1 && !!afterEnter.hosp && afterEnter.open === 'none',
  JSON.stringify({ kb, afterEnter }));
await page.fill('#hosp', '병원');
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
ck('Escape 로 자동완성이 닫힌다',
  await page.evaluate(() => document.getElementById('hospDrop').style.display === 'none'));

/* 13. 자동완성이 하단 액션바를 넘지 않는다 */
await page.fill('#hosp', '병원');
await page.waitForTimeout(400);
const drop = await page.evaluate(() => {
  const d = document.getElementById('hospDrop').getBoundingClientRect();
  const a = document.getElementById('actionBar').getBoundingClientRect();
  return { dropBottom: Math.round(d.bottom), barTop: Math.round(a.top), h: Math.round(d.height) };
});
ck('자동완성 목록이 하단 액션바를 가리지 않는다',
  drop.dropBottom <= drop.barTop + 1, JSON.stringify(drop));
await page.keyboard.press('Escape');

/* 14. 초안 복원 */
await page.fill('#fse', '권오성');
await page.fill('#hosp', '초안병원');
await page.fill('#detail', '초안 내용입니다');
await page.waitForTimeout(900);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const draftBar = await page.evaluate(() => ({
  shown: document.getElementById('draftBar').style.display,
  text: document.getElementById('draftBar').textContent
}));
ck('새로고침 후 초안 복원을 제안한다', draftBar.shown === 'block', draftBar.text.slice(0, 40));
await page.click('#draftRestore');
await page.waitForTimeout(500);
const restored = await page.evaluate(() => ({
  hosp: document.getElementById('hosp').value,
  detail: document.getElementById('detail').value,
  note: document.getElementById('snPhotoState').textContent
}));
ck('초안을 복원하면 작성 중이던 내용이 돌아온다',
  restored.hosp === '초안병원' && restored.detail === '초안 내용입니다', JSON.stringify(restored));
ck('사진은 재첨부가 필요함을 알린다', restored.note.includes('다시 첨부'));

/* 15. 여러 폭에서 오류 없음 */
for (const [w, h] of [[320, 640], [390, 844], [430, 932], [768, 1024]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(300);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ck(`${w}px 에서 가로 넘침이 없다`, ov === 0, 'overflow=' + ov);
}
const barFit = await page.evaluate(() => {
  const bs = [...document.querySelectorAll('.actions .btn')];
  return bs.map(b => ({ t: b.textContent.trim().slice(0, 6), w: Math.round(b.getBoundingClientRect().width), sw: b.scrollWidth }));
});
ck('320px 에서도 액션 버튼 글자가 겹치지 않는다',
  barFit.every(b => b.w >= 60), JSON.stringify(barFit));

console.log('');
R.forEach(([m, n, d]) => console.log(m, n, d ? '· ' + d : ''));
const failed = R.filter(r => r[0] === '❌').length;
console.log(`\n결과: ${R.length - failed}/${R.length} 통과`);
if (errs.length) { console.log('\n콘솔/페이지 오류:'); errs.slice(0, 8).forEach(e => console.log('  ' + e)); }
await browser.close();
process.exit(failed || errs.length ? 1 : 0);
