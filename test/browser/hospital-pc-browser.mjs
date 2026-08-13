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
 *   · 카드/마커 클릭 → 지도 말풍선에 병원 정보 + 최근 이력
 *   · 지도가 목록 위에 전폭으로 고정(3열 아님)
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

/* ── 가짜 카카오 지도 SDK ────────────────────────────────────────────────
   실제 타일·키 없이 페이지의 지도 경로(생성 → 마커 → 말풍선 → relayout)를
   그대로 지나가게 하는 최소 구현. 검증에 필요한 흔적만 window 에 남긴다.
     window.__fakeMap      지도 인스턴스(relayouts / level / __fire)
     window.__fakeMarkers  만들어진 마커(__fire('click') 로 클릭 발생)
     window.__lastIW       마지막 InfoWindow(openedWithoutMarker) */
const FAKE_KAKAO_SDK = `(function(){
  var W = window;
  function listeners(o){ o.__ls = o.__ls || {}; o.__fire = function(t, a){ (o.__ls[t]||[]).forEach(function(f){ f(a); }); }; return o; }
  function LatLng(lat,lng){ this.lat=lat; this.lng=lng; }
  LatLng.prototype.getLat=function(){ return this.lat; };
  LatLng.prototype.getLng=function(){ return this.lng; };
  function LatLngBounds(){ this.pts=[]; }
  LatLngBounds.prototype.extend=function(p){ if(p) this.pts.push(p); return this; };
  LatLngBounds.prototype.contain=function(){ return true; };
  LatLngBounds.prototype.isEmpty=function(){ return this.pts.length===0; };
  function Map(container, opts){
    listeners(this);
    this.container=container; this.level=(opts&&opts.level)||9;
    this.center=(opts&&opts.center)||new LatLng(37.5,127);
    this.relayouts=0; this.zoomable=true;
    W.__fakeMap=this;
  }
  Map.prototype.getCenter=function(){ return this.center; };
  Map.prototype.setCenter=function(c){ this.center=c; this.__fire('center_changed'); };
  Map.prototype.getLevel=function(){ return this.level; };
  Map.prototype.setLevel=function(l){ if(l===this.level) return; this.level=l; this.__fire('zoom_changed'); };
  Map.prototype.setBounds=function(){ this.__fire('bounds_changed'); };
  Map.prototype.panTo=function(c){ this.center=c; };
  Map.prototype.getBounds=function(){ return new LatLngBounds(); };
  Map.prototype.relayout=function(){ this.relayouts++; };
  Map.prototype.setZoomable=function(v){ this.zoomable=!!v; };
  function Marker(o){ listeners(this); this.position=o.position; this.title=o.title; this.map=null;
    (W.__fakeMarkers=W.__fakeMarkers||[]).push(this); }
  Marker.prototype.setMap=function(m){ this.map=m; };
  Marker.prototype.getPosition=function(){ return this.position; };
  Marker.prototype.setImage=function(){};
  function MarkerImage(){} function Size(){} function Point(){}
  function CustomOverlay(o){ this.position=o.position; this.content=o.content; this.map=null; }
  CustomOverlay.prototype.setMap=function(m){
    this.map=m;
    if(!this.content || !this.content.nodeType) return;
    if(m && m.container) m.container.appendChild(this.content);
    else if(this.content.parentNode) this.content.parentNode.removeChild(this.content);
  };
  CustomOverlay.prototype.setPosition=function(p){ this.position=p; };
  CustomOverlay.prototype.getPosition=function(){ return this.position; };
  function InfoWindow(o){ this.content=o.content; this.position=o.position; this.node=null; W.__lastIW=this; }
  InfoWindow.prototype.open=function(map, marker){
    this.openedWithoutMarker=(marker==null);
    var host=map&&map.container; if(!host) return;
    var box=document.createElement('div');
    box.className='fake-iw';
    box.style.cssText='position:absolute;left:8px;top:8px;background:#fff;z-index:30;';
    if(this.content && this.content.nodeType) box.appendChild(this.content);
    else box.innerHTML=String(this.content||'');
    host.appendChild(box); this.node=box;
  };
  InfoWindow.prototype.close=function(){ if(this.node&&this.node.parentNode) this.node.parentNode.removeChild(this.node); this.node=null; };
  function MarkerClusterer(o){ this.map=o&&o.map; this.markers=[]; }
  MarkerClusterer.prototype.addMarkers=function(ms){ var self=this; (ms||[]).forEach(function(m){ self.markers.push(m); m.setMap(self.map); }); };
  MarkerClusterer.prototype.clear=function(){ this.markers.forEach(function(m){ m.setMap(null); }); this.markers=[]; };
  function Geocoder(){}
  Geocoder.prototype.addressSearch=function(_a, cb){ cb([], 'ZERO_RESULT'); };
  W.kakao = { maps: {
    load: function(cb){ setTimeout(cb, 0); },
    LatLng: LatLng, LatLngBounds: LatLngBounds, Map: Map, Marker: Marker,
    MarkerImage: MarkerImage, Size: Size, Point: Point,
    CustomOverlay: CustomOverlay, InfoWindow: InfoWindow, MarkerClusterer: MarkerClusterer,
    services: { Geocoder: Geocoder, Status: { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT' } },
    event: { addListener: function(t, type, fn){ if(!t) return; t.__ls = t.__ls || {}; (t.__ls[type] = t.__ls[type] || []).push(fn);
      if(!t.__fire) t.__fire = function(k, a){ (t.__ls[k]||[]).forEach(function(f){ f(a); }); }; } }
  } };
})();`;

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
/* 카카오 SDK 를 가짜 구현으로 대체한다. 실제 키·타일 서버를 쓰지 않으면서도
   지도 객체·마커·말풍선이 실제로 만들어지는 경로를 그대로 지나간다.
   (예전에는 abort 해서 '지도를 불러올 수 없습니다' 화면만 검증할 수 있었다) */
await page.route('**://dapi.kakao.com/**', r => r.fulfill({
  status: 200, contentType: 'application/javascript', body: FAKE_KAKAO_SDK
}));
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

// 3. 카드 클릭 → 별도 창(병원 정보 + 처리 이력)이 열린다
await page.click('#pcLeft .pc-cardwrap:nth-child(2)');
await page.waitForTimeout(300);
const cardWin = await page.evaluate(() => ({
  shown: document.getElementById('pcDetailModal').classList.contains('show'),
  name: (document.querySelector('#pcDetailModalBody .pc-dt-name') || {}).textContent,
  hist: document.querySelectorAll('#pcDetailModalBody .tl-item, #pcDetailModalBody .tl-empty').length,
  focusIn: document.getElementById('pcDetailModal').contains(document.activeElement)
}));
ck('카드를 누르면 별도 창에 병원 정보와 이력이 열린다',
  cardWin.shown && !!cardWin.name && cardWin.hist >= 1 && cardWin.focusIn, JSON.stringify(cardWin));
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
ck('Esc 로 별도 창이 닫힌다',
  !(await page.evaluate(() => document.getElementById('pcDetailModal').classList.contains('show'))));
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

// 6. 내 주변 5km 기능이 완전히 사라졌다
const gone = await page.evaluate(() => ({
  btn: !!document.getElementById('nearbyBtn'),
  box: !!document.getElementById('nearbyState'),
  mod: typeof window.BazNearby,
  chips: document.querySelectorAll('.chip[data-filter]').length
}));
ck('내 주변 5km 버튼·상태·모듈이 남아 있지 않다',
  !gone.btn && !gone.box && gone.mod === 'undefined', JSON.stringify(gone));
await page.click('.chip[data-filter="ncare"]');
await page.waitForTimeout(300);
const chipOn = await page.evaluate(() => ({
  on: document.querySelector('.chip[data-filter="ncare"]').classList.contains('on'),
  cards: document.querySelectorAll('#pcLeft .h-name').length
}));
ck('기존 필터 칩은 그대로 동작한다', chipOn.on && chipOn.cards > 0, JSON.stringify(chipOn));
await page.click('.chip[data-filter="all"]');
await page.waitForTimeout(300);

// 7. 카드/표 전환 + 정렬 헤더 키보드
await page.evaluate(() => window.pcCloseDetailModal && window.pcCloseDetailModal());
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
  sub: document.getElementById('hdrSub').textContent,
  legend: [...document.querySelectorAll('#pcMapLegend .lg')].map(e => e.textContent.trim()),
  hint: document.getElementById('pcHint').textContent
}));
ck('KO/EN/JA 전환 후에도 새 UI 문자열이 채워진다',
  !!i18n.sub && !/N-CARE 병원 조회|Nearby N-CARE/.test(i18n.sub) &&
  i18n.legend.length === 4 && i18n.legend.every(Boolean) && !!i18n.hint, JSON.stringify(i18n));

// 9. 필터 폭 3단계 · 모바일 모드 전환에서 오류 없음
await page.click('#filtToggleBtn'); await page.waitForTimeout(250);
await page.click('#filtToggleBtn'); await page.waitForTimeout(250);
await page.click('#modeToggle [data-mode="mobile"]'); await page.waitForTimeout(400);
const mobile = await page.evaluate(() => ({ cls: document.body.className, cards: document.querySelectorAll('#cardList .h-card').length }));
await page.click('#modeToggle [data-mode="window"]'); await page.waitForTimeout(400);
ck('모바일 ↔ Window 전환에서 화면이 깨지지 않는다', mobile.cls.includes('mode-mobile') && mobile.cards === 3, JSON.stringify(mobile));

// 9-b. 넓은 화면에서도 지도는 목록 위에 전폭으로 고정된다(3열 아님)
await page.setViewportSize({ width: 1600, height: 900 });
await page.waitForTimeout(450);
// 앞 단계에서 필터 폭을 바꿔 놨으므로 기본(filt-base)으로 되돌린 뒤 측정한다
for (let i = 0; i < 3 && !(await page.evaluate(() => document.body.classList.contains('filt-base'))); i++) {
  await page.click('#filtToggleBtn'); await page.waitForTimeout(300);
}
const lay = await page.evaluate(() => {
  const r = s => { const e = document.querySelector(s); const b = e && e.getBoundingClientRect(); return b ? { w: Math.round(b.width), x: Math.round(b.x), y: Math.round(b.y), bottom: Math.round(b.bottom) } : null; };
  const left = document.getElementById('pcLeft');
  return {
    rail: r('#filterRail'), left: r('#pcLeft'), right: r('#pcRight'), bar: r('#pcToolbar'),
    leftOverflow: getComputedStyle(left).overflowY,
    rightPos: getComputedStyle(document.getElementById('pcRight')).position,
    hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
  };
});
ck('지도가 결과 목록 위에 있고 같은 폭을 쓴다',
  lay.right.y < lay.bar.y && lay.bar.y < lay.left.y &&
  Math.abs(lay.right.w - lay.left.w) <= 2 && Math.abs(lay.right.x - lay.left.x) <= 2,
  JSON.stringify(lay));
ck('지도가 오른쪽 칸으로 밀려나지 않는다(3열 제거)',
  lay.right.x < lay.rail.x + lay.rail.w + 40 && lay.right.w > 700 && lay.hOverflow === 0, JSON.stringify(lay));
ck('지도는 스크롤에 붙어 있고 결과 목록은 본문 스크롤을 쓴다',
  lay.rightPos === 'sticky' && lay.leftOverflow !== 'auto' && lay.leftOverflow !== 'scroll', JSON.stringify(lay));
const pageScroll = await page.evaluate(async () => {
  window.scrollTo(0, 0);
  const y0 = window.scrollY;
  const ev = new WheelEvent('wheel', { deltaY: 260, bubbles: true, cancelable: true });
  document.getElementById('pcMapPane').dispatchEvent(ev);
  return { prevented: ev.defaultPrevented, y0 };
});
ck('지도 위 휠은 확대가 꺼져 있으면 가로채지 않는다(본문이 그대로 스크롤)',
  !pageScroll.prevented, JSON.stringify(pageScroll));
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(200);

// 9-c. 지도가 실제로 만들어졌는지 (가짜 SDK 경로)
const mapUp = await page.evaluate(() => ({
  created: !!window.__fakeMap,
  fail: !!document.querySelector('.pc-mapfail'),
  markers: (window.__fakeMarkers || []).length
}));
ck('지도 인스턴스와 병원 마커가 만들어진다',
  mapUp.created && !mapUp.fail && mapUp.markers >= 3, JSON.stringify(mapUp));

// 9-d. 카드 클릭 → 지도가 그 병원으로 이동·확대 + 별도 창
// [회귀] 배율이 바뀌는 '첫 클릭'에서도 중심 이동이 반드시 일어나야 한다.
//   예전에는 확대 애니메이션이 도는 사이 중심 이동 요청이 사라져, 처음 몇 번은
//   확대만 되고 지도가 그 병원으로 가지 않았다.
await page.evaluate(() => { window.pcCloseDetailModal && window.pcCloseDetailModal(); window.pcClearHospFocus(); });
await page.waitForTimeout(250);
const firstPick = await page.evaluate(async () => {
  window.__fakeMap.setLevel(9);                     // 전국 축척에서 시작(첫 진입 상태)
  window.pcOpenHosp('부산A병원');
  await new Promise(r => setTimeout(r, 250));
  return {
    level: window.__fakeMap.level,
    lat: window.__fakeMap.center.lat, lng: window.__fakeMap.center.lng,
    shown: document.getElementById('pcDetailModal').classList.contains('show'),
    name: (document.querySelector('#pcDetailModalBody .pc-dt-name') || {}).textContent,
    hist: document.querySelectorAll('#pcDetailModalBody .tl-item').length,
    bubble: !!document.querySelector('.pc-iw')
  };
});
ck('첫 클릭에도 지도가 그 병원 위치로 이동하고 확대된다',
  Math.abs(firstPick.lat - 35.1796) < 1e-6 && Math.abs(firstPick.lng - 129.0756) < 1e-6 && firstPick.level === 4,
  JSON.stringify(firstPick));
ck('클릭과 동시에 별도 창에 병원 정보와 이력이 뜬다',
  firstPick.shown && firstPick.name === '부산A병원' && firstPick.hist >= 1, JSON.stringify(firstPick));
ck('지도 위 말풍선은 더 이상 만들어지지 않는다', !firstPick.bubble);

// 두 번째·세 번째 클릭도 같은 결과 (예전에는 여기서부터만 동작했다)
const secondPick = await page.evaluate(async () => {
  window.pcCloseDetailModal();
  window.pcOpenHosp('가까운N병원');
  await new Promise(r => setTimeout(r, 250));
  return { lat: window.__fakeMap.center.lat, lng: window.__fakeMap.center.lng, level: window.__fakeMap.level,
           name: (document.querySelector('#pcDetailModalBody .pc-dt-name') || {}).textContent };
});
ck('다른 카드를 눌러도 매번 같은 방식으로 이동한다',
  Math.abs(secondPick.lat - 37.57) < 1e-6 && secondPick.level === 4 && secondPick.name === '가까운N병원',
  JSON.stringify(secondPick));

// 9-e. 지도 마커 클릭도 같은 창을 연다
await page.evaluate(() => window.pcCloseDetailModal());
await page.waitForTimeout(200);
await page.evaluate(() => {
  const mk = (window.__fakeMarkers || []).find(m => m.title === '부산A병원');
  mk && mk.__fire('click');
});
await page.waitForTimeout(300);
const mkWin = await page.evaluate(() => ({
  shown: document.getElementById('pcDetailModal').classList.contains('show'),
  name: (document.querySelector('#pcDetailModalBody .pc-dt-name') || {}).textContent,
  lat: window.__fakeMap.center.lat
}));
ck('지도 마커를 눌러도 같은 별도 창이 열리고 지도가 그 병원으로 간다',
  mkWin.shown && mkWin.name === '부산A병원' && Math.abs(mkWin.lat - 35.1796) < 1e-6, JSON.stringify(mkWin));

// 9-f. 좌표가 없는 병원 — 창은 열리고 위치가 없다는 안내가 뜬다
await page.evaluate(() => window.pcCloseDetailModal());
await page.waitForTimeout(200);
const noCoord = await page.evaluate(async () => {
  const h = HOSPITALS.find(x => x.n === '가까운N병원');
  const keep = { lat: h.lat, lng: h.lng, a: h.a };
  h.lat = null; h.lng = null; h.a = '';            // 주소도 없어 지오코딩 폴백도 불가
  window.pcOpenHosp('가까운N병원');
  await new Promise(r => setTimeout(r, 350));
  const out = {
    shown: document.getElementById('pcDetailModal').classList.contains('show'),
    name: (document.querySelector('#pcDetailModalBody .pc-dt-name') || {}).textContent,
    toast: (document.getElementById('bazToast') || {}).textContent || ''
  };
  h.lat = keep.lat; h.lng = keep.lng; h.a = keep.a;
  return out;
});
ck('좌표가 없는 병원도 창은 열리고 위치가 없다는 안내가 나온다',
  noCoord.shown && noCoord.name === '가까운N병원' && /위치 정보가 없습니다/.test(noCoord.toast),
  JSON.stringify(noCoord));
await page.evaluate(() => window.pcCloseDetailModal());
await page.waitForTimeout(200);

// 9-g. 확대/축소 반복 후에도 지도가 살아 있다(타일 재계산 1회)
const zoomLoop = await page.evaluate(async () => {
  window.__fakeMap.relayouts = 0;
  for (let i = 0; i < 8; i++) { pcMapZoom(i % 2 ? 1 : -1); await new Promise(r => setTimeout(r, 30)); }
  window.__fakeMap.__fire('idle');
  await new Promise(r => setTimeout(r, 700));
  return { relayouts: window.__fakeMap.relayouts, level: window.__fakeMap.level, alive: !document.querySelector('.pc-mapfail') };
});
ck('휠·버튼 확대/축소를 반복해도 지도가 유지되고 타일 재계산은 최소로 걸린다',
  zoomLoop.alive && zoomLoop.relayouts >= 1 && zoomLoop.relayouts <= 3, JSON.stringify(zoomLoop));

// 10. 좁은 화면(1024/768) 렌더
for (const [w, h] of [[1920, 1080], [1366, 768], [1024, 768], [390, 844]]) {
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
