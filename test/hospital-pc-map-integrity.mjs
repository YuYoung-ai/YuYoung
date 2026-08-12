/************************************************************
 * hospital-pc-map-integrity.mjs
 * hospital-pc.html 회귀 테스트 — DOM XSS · 데이터 정합성 · 지도 상태 · 날짜
 * 실행: node test/hospital-pc-map-integrity.mjs
 * ----------------------------------------------------------
 * 무빌드 헤드리스. 두 가지 방식을 섞어 쓴다.
 *   ① js/baz-*.js 공용 모듈은 require 로 그대로 불러 검증한다.
 *   ② hospital-pc.html 안에 남은 함수는 원문을 꺼내 실행한다
 *      (test/dashboard-card-history.mjs 와 같은 방식).
 *
 * 커버리지
 *   · 악성 병원명으로 DOM XSS 가 발생하지 않음
 *   · 빈 서버 필드가 기존 값을 정상적으로 제거
 *   · 이력 서버 저장 성공·실패·권한 부족·revision 충돌
 *   · 자정 전후 Asia/Seoul 날짜 계산
 *   · 지도 접기/펼치기 중심·배율 보존
 *   · 전체화면 진입/종료 중심·배율 및 scrollY 보존
 *   · 연속 relayout 요청이 한 번으로 병합
 *   · 오래된 지도 렌더가 최신 렌더를 덮지 않음
 *   · 내 주변 5km 거리 필터와 모드 해제
 *   · '결과 맞춤' 이 멀리 떨어진 완료 마커 때문에 전국 축척이 되지 않음
 ************************************************************/
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(import.meta.url);

const SRC = fs.readFileSync(path.join(ROOT, 'hospital-pc.html'), 'utf8');
const GAS = fs.readFileSync(path.join(ROOT, 'handover_gas.gs'), 'utf8');

const BazDom = require(path.join(ROOT, 'js', 'baz-dom.js'));
const BazDate = require(path.join(ROOT, 'js', 'baz-date.js'));
const BazHospitalData = require(path.join(ROOT, 'js', 'baz-hospital-data.js'));
const BazMapController = require(path.join(ROOT, 'js', 'baz-map-controller.js'));
const BazScrollLock = require(path.join(ROOT, 'js', 'baz-scroll-lock.js'));
const BazNearby = require(path.join(ROOT, 'js', 'baz-nearby.js'));
const BazHistoryApi = require(path.join(ROOT, 'js', 'baz-history-api.js'));

let pass = 0, total = 0;
const fails = [];
function ck(name, cond, detail) {
  total++;
  if (cond) { pass++; console.log('✅', name, detail || ''); }
  else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('❌', name, detail || ''); }
}
function section(title) { console.log('\n── ' + title + ' ' + '─'.repeat(Math.max(0, 56 - title.length))); }

/* ── HTML 에서 함수 원문 꺼내기 ──────────────────────────────────────── */
function grab(source, name) {
  const at = source.search(new RegExp('\\b(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  if (at < 0) throw new Error('함수를 찾지 못했습니다: ' + name);
  let depth = 0;
  for (let j = source.indexOf('{', at); j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(at, j + 1);
  }
  throw new Error('본문 끝을 찾지 못했습니다: ' + name);
}

/* ════════════════════════════════════════════════════════════════════
   1. DOM XSS — 악성 병원명
   ════════════════════════════════════════════════════════════════════ */
section('1. DOM XSS · 동적 HTML 안전성');

const EVIL_NAMES = [
  `"><img src=x onerror=alert(1)>`,
  `'); alert('xss'); //`,
  `\\'); alert(1); //`,
  `<script>alert(1)</script>병원`,
  `A" onmouseover="alert(1)" x="`,
  `back\\slash'quote"double\`tick`
];

const renderFns = ['pcActionButtons', 'pcActionUrl', 'cardHTML', 'pcStatusBadge', 'pcCardsHTML', 'pcTableHTML']
  .map(n => grab(SRC, n)).join('\n');

const harness = new Function('BazDom', 'stubs', `
  'use strict';
  const escapeHtml = BazDom.escapeHtml, escAttr = BazDom.escapeAttr, stCls = BazDom.statusClass;
  const t = stubs.t, HISTORY = stubs.HISTORY, normalize = stubs.normalize;
  const isNcare = stubs.isNcare, isDue = stubs.isDue, daysSince = stubs.daysSince;
  const dueLevel = stubs.dueLevel, statusDays = stubs.statusDays;
  const getLastHpVer = stubs.ver, getLastUiVer = stubs.ver;
  const pcSkillBadge = stubs.pcSkillBadge, pcIsProg = stubs.no, pcIsDone = stubs.no;
  const pcVendorText = stubs.pcVendorText, pcSelName = null, PC_ST_ORDER = {};
  const pcSort = { key: 'n', dir: 1 };
  ${renderFns}
  return { cardHTML, pcCardsHTML, pcTableHTML, pcStatusBadge, pcActionButtons, pcActionUrl };
`);

const stubs = {
  t: k => k,
  HISTORY: {},
  normalize: s => String(s || '').toLowerCase().replace(/\s+/g, ''),
  isNcare: h => !!(h.nc && h.nc !== '미가입'),
  isDue: () => false,
  daysSince: () => 10,
  dueLevel: () => null,
  statusDays: h => 'lastInsp ' + (h.li || ''),
  ver: () => '',
  pcSkillBadge: () => '',
  no: () => false,
  pcVendorText: h => (h.d || '-')
};
const R = harness(BazDom, stubs);

function evilHospital(name) {
  return { n: name, s: name, rg: name, a: name, li: '2026-08-01', st: name, sa: name, as: name, nc: name, d: name, hpv: '', uiv: '' };
}

let xssClean = true, xssDetail = '';
for (const evil of EVIL_NAMES) {
  const h = evilHospital(evil);
  const html = R.cardHTML(h) + R.pcCardsHTML([h]) + R.pcTableHTML([h], 10) + R.pcStatusBadge(h);
  // 실제 "태그 안"에 이벤트 속성이 생겼는지만 본다 — 이스케이프된 본문 텍스트에
  // onerror= 같은 글자가 그대로 남는 것은 안전하다(마크업으로 해석되지 않는다).
  const tags = html.match(/<[^>]*>/g) || [];
  if (tags.some(tg => /\son[a-z]+\s*=/i.test(tg))) { xssClean = false; xssDetail = '이벤트 속성 주입: ' + evil; break; }
  if (tags.some(tg => /^<script/i.test(tg))) { xssClean = false; xssDetail = '<script> 주입: ' + evil; break; }
  if (tags.some(tg => /^<img/i.test(tg))) { xssClean = false; xssDetail = '태그 탈출: ' + evil; break; }
  // 속성값 안에 원시 따옴표가 남아 속성을 끊지 않는지
  const attrs = html.match(/(?:data-hn|data-hname|data-prog-hn|title|class)="[^"]*"/g) || [];
  if (attrs.some(a => a.slice(a.indexOf('="') + 2, -1).includes('"'))) { xssClean = false; xssDetail = '속성 탈출: ' + evil; break; }
}
ck('악성 병원명으로 DOM XSS 가 발생하지 않는다', xssClean, xssDetail);

// 병원명은 이스케이프된 형태로 반드시 남아 있어야 한다(버튼이 깨지지 않음)
const q = R.cardHTML(evilHospital(`"><img src=x onerror=alert(1)>`));
ck('악성 이름이어도 카드가 렌더되고 이름이 이스케이프되어 남는다',
  q.includes('&quot;&gt;&lt;img') && q.includes('data-hact="nmap"') &&
  q.includes('data-hn="&quot;&gt;&lt;img'));

// 상태 CSS 클래스는 허용 목록에서만 나온다
const allowed = new Set(BazDom.statusClassKeys().map(k => BazDom.statusClass(k)).concat(['st-unknown']));
ck('상태 CSS 클래스는 허용 목록으로만 매핑된다',
  allowed.has(BazDom.statusClass('경고')) &&
  BazDom.statusClass('"><img src=x>') === 'st-unknown' &&
  BazDom.statusClass('아무거나') === 'st-unknown');

// URL 스킴 방어 + 외부 열기 noopener
ck('javascript:/data: URL 은 거부된다',
  BazDom.safeUrl('javascript:alert(1)') === '' &&
  BazDom.safeUrl('data:text/html,<script>') === '' &&
  BazDom.safeUrl('//evil.example') === '' &&
  BazDom.safeUrl('inspection.html?h=x') === 'inspection.html?h=x' &&
  BazDom.safeUrl('https://m.map.naver.com/x') === 'https://m.map.naver.com/x');

const naver = R.pcActionUrl('nmap', { n: `"><img>` });
ck('외부 지도 URL 은 encodeURIComponent 로만 조립된다',
  naver.startsWith('https://m.map.naver.com/') && !naver.includes('<') && !naver.includes('"'));

// 소스 수준: 동적으로 만들어지는 인라인 onclick 이 남아 있지 않아야 한다
const scriptStart = SRC.indexOf('<script>\n/* [보안]');
const inlineJs = SRC.slice(scriptStart, SRC.lastIndexOf('</script>'));
const dynamicOnclick = (inlineJs.match(/onclick=\\?["'][^"']*['"]\s*\+/g) || [])
  .concat(inlineJs.match(/'\s*onclick\s*=/g) || []);
ck('동적으로 만드는 인라인 onclick 이 남아 있지 않다', dynamicOnclick.length === 0,
  dynamicOnclick.length ? dynamicOnclick.join(' | ') : '');
ck('외부 지도 열기에 noopener 가 적용된다', /noopener/.test(fs.readFileSync(path.join(ROOT, 'js', 'baz-dom.js'), 'utf8')));

/* ════════════════════════════════════════════════════════════════════
   2. 병원 DB 병합 — 빈 값이 기존 값을 지운다
   ════════════════════════════════════════════════════════════════════ */
section('2. 병원정보DB 병합 정합성');

function baseHospitals() {
  return [{
    n: 'A병원', s: 'SN-1', rg: '서울', a: '서울시 1', li: '2026-07-01', st: '권고',
    sa: '홍길동', as: '유상', nc: 'Gold', d: '납품 1년 이내', hpv: '1.2', uiv: '3.1',
    lat: 37.5, lng: 127.0
  }];
}

// 담당자·주소·N-CARE·상태를 시트에서 지운 스냅샷
let hs = baseHospitals();
let st = BazHospitalData.mergeRows(hs, [{
  name: 'A병원', sn: 'SN-1', region: '서울', address: '', lastVisit: '2026-07-01',
  status: '', sales: '', asType: '유상', ncare: '', client: '납품 1년 이내',
  hpVer: '1.2', uiVer: '3.1', lat: 37.5, lng: 127.0
}]);
ck('빈 담당자가 기존 값을 제거한다', hs[0].sa === '');
ck('빈 주소가 기존 값을 제거한다', hs[0].a === '');
ck('빈 N-CARE 가 기존 값을 제거한다', hs[0].nc === '');
ck('빈 상태가 기존 값을 제거한다', hs[0].st === '');
ck('지운 값은 통계에도 반영된다(cleared 카운트)', st.cleared === 1, 'cleared=' + st.cleared);

// 응답에 아예 없는 필드는 건드리지 않는다(구버전 백엔드 호환)
hs = baseHospitals();
BazHospitalData.mergeRows(hs, [{ name: 'A병원', sales: '김철수' }]);
ck('응답에 없는 필드는 기존 값을 유지한다', hs[0].a === '서울시 1' && hs[0].sa === '김철수');

// null·0·문자열 좌표 정규화
hs = baseHospitals();
BazHospitalData.mergeRows(hs, [{ name: 'A병원', lat: null, lng: 0, sn: 0 }]);
ck('좌표 null/0 은 null 로 정규화된다', hs[0].lat === null && hs[0].lng === null);
ck('숫자 0 은 문자열 필드에서 값으로 보존된다', hs[0].s === '0');

// 범위 밖 좌표 방어
hs = baseHospitals();
st = BazHospitalData.mergeRows(hs, [{ name: 'A병원', lat: 0.0, lng: 999 }]);
ck('유효범위 밖 좌표는 무시(null)된다', hs[0].lat === null && hs[0].lng === null && st.invalidCoords === 2);

// 병원명 중복
hs = [];
st = BazHospitalData.mergeRows(hs, [
  { name: 'B병원', sales: '홍길동', region: '' },
  { name: 'B병원', sales: '', region: '부산' }
]);
ck('중복 병원명은 한 항목으로 접힌다', hs.length === 1 && st.duplicates === 1);
ck('중복 행의 빈 칸이 앞 줄 값을 지우지 않는다', hs[0].sa === '홍길동' && hs[0].rg === '부산');

// 스냅샷에서 사라진 병원 제거
hs = baseHospitals();
st = BazHospitalData.mergeRows(hs, [{ name: 'C병원' }]);
ck('스냅샷에서 사라진 병원은 메모리에서도 제거된다',
  hs.length === 1 && hs[0].n === 'C병원' && st.removed === 1);

// 날짜 정규화
ck('날짜는 yyyy-MM-dd 로 정규화된다',
  BazHospitalData.normDate('2026. 8. 3') === '2026-08-03' &&
  BazHospitalData.normDate('') === '' &&
  BazHospitalData.normDate('없음') === '');

// bootstrap 폴백 경로가 코드에 있는지
ck('bootstrap 1콜 + 구버전 개별 요청 폴백 경로가 있다',
  /action=bootstrap/.test(inlineJs) && /bootstrap-unsupported|개별 요청으로 폴백/.test(inlineJs));

/* ════════════════════════════════════════════════════════════════════
   3. 이력 서버 저장
   ════════════════════════════════════════════════════════════════════ */
section('3. 이력 편집 서버 저장');

const dirty = [
  { d: '2026.8.3', t: '점검', sy: '노즐 막힘', evil: '<script>', __proto__: undefined, m: 'x' },
  { d: '', sy: '', m: '', fx: '' },                       // 빈 행 → 제거
  { d: '2026-01-05', t: '이상한값', fx: '처리' }
];
const clean = BazHistoryApi.sanitizeRecords(dirty);
ck('허용 목록 밖 필드는 제거된다', clean.every(r => Object.keys(r).every(k => BazHistoryApi.ALLOWED_FIELDS.includes(k))));
ck('빈 행은 제거되고 날짜는 정규화·내림차순 정렬된다',
  clean.length === 2 && clean[0].d === '2026-08-03' && clean[1].d === '2026-01-05');
ck('허용되지 않은 구분값은 A/S 로 보정된다', clean[1].t === 'A/S');
ck('건수 상한이 적용된다',
  BazHistoryApi.sanitizeRecords(Array.from({ length: 400 }, (_, i) => ({ d: '2026-01-01', sy: 's' + i }))).length === BazHistoryApi.MAX_RECORDS);

const payload = BazHistoryApi.buildPayload({ hosp: 'A병원', records: dirty, who: '홍길동', baseRev: 3, token: 'tk' });
ck('페이로드에 병원명·이력·요청자·기준 revision·토큰이 담긴다',
  payload.action === 'history_save' && payload.hosp === 'A병원' && payload.who === '홍길동' &&
  payload.baseRev === 3 && payload.token === 'tk' && payload.records.length === 2);

const okRes = BazHistoryApi.classifyResponse({ success: true, rev: 4, records: clean, updatedAt: '2026-08-12 10:00', updatedBy: '홍길동' });
ck('저장 성공 응답 분류', okRes.ok && okRes.rev === 4 && okRes.records.length === 2 && !okRes.conflict);

const conflictRes = BazHistoryApi.classifyResponse({ success: false, conflict: true, rev: 9, records: clean, error: 'conflict — 다른 사용자가 먼저 저장했습니다' });
ck('revision 충돌 응답은 성공으로 취급하지 않는다', !conflictRes.ok && conflictRes.conflict && conflictRes.rev === 9);

const authRes = BazHistoryApi.classifyResponse({ success: false, error: 'unauthorized — 이력 편집은 관리자(Lv.2) 인증이 필요합니다.' });
ck('권한 부족 응답 분류', !authRes.ok && authRes.unauthorized && !authRes.conflict);

const failRes = BazHistoryApi.classifyResponse({ success: false, error: '시트 없음' });
ck('일반 실패 응답 분류', !failRes.ok && !failRes.conflict && !failRes.unauthorized && failRes.error === '시트 없음');
ck('응답이 아예 아닌 값도 실패로 분류된다', !BazHistoryApi.classifyResponse(null).ok);

// 저장 실패 시 화면을 성공으로 표시하지 않는다(코드 경로 확인)
const saveFn = grab(SRC, 'histSaveEdits');
ck('성공(r.ok) 경로에서만 저장 완료 토스트를 띄운다',
  /if\(r\.ok\)\{[\s\S]*histServerSaved/.test(saveFn) &&
  saveFn.indexOf('histServerSaved') < saveFn.indexOf('r.conflict'));
ck('저장 실패·충돌 시 초안을 남긴다', /saveDraft/.test(saveFn) && /histDraftKept|true\)/.test(saveFn));
ck('로컬 편집본이 서버 이력을 덮어쓰던 재적용 코드가 사라졌다',
  !/baz_hosp_history'\)[\s\S]{0,200}HISTORY\[n\]\s*=/.test(inlineJs));

// 초안 마이그레이션 (구버전 로컬 편집본)
function memStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _dump: () => Object.fromEntries(m)
  };
}
const store = memStorage({ [BazHistoryApi.LEGACY_KEY]: JSON.stringify({ 'A병원': [{ d: '2026-05-01', sy: '옛 편집', bogus: 1 }] }) });
const mig = BazHistoryApi.migrateLegacyDrafts(store);
ck('구버전 로컬 편집본은 초안으로 옮겨진다(삭제하지 않음)',
  mig.migrated === 1 && mig.names[0] === 'A병원' &&
  store.getItem(BazHistoryApi.LEGACY_KEY) === null &&
  BazHistoryApi.readDraft(store, 'A병원').records[0].sy === '옛 편집');

// 서버(Apps Script) 쪽 정규화·병합·권한 게이트
const histSanitizeSrc = grab(GAS, 'histSanitize_');
const histMergeSrc = grab(GAS, 'histMerge_');
const gasFns = new Function('HIST', 'HIST_FIELDS', `
  ${grab(GAS, 'histText_')}
  ${grab(GAS, 'histDate_')}
  ${histSanitizeSrc}
  ${histMergeSrc}
  return { histSanitize_, histMerge_ };
`)({ MAX_LEN: 2000, MAX_RECORDS: 300 }, ['d', 't', 'pt', 'sy', 'f', 'pay', 'm', 'fx', 'p']);

const gasClean = gasFns.histSanitize_([{ d: '2026.8.3', sy: 'x', hack: '<script>', t: '점검' }]);
ck('서버도 허용 목록 밖 필드를 제거한다',
  gasClean.length === 1 && !('hack' in gasClean[0]) && gasClean[0].d === '2026-08-03');

const merged = gasFns.histMerge_(
  { records: [{ d: '2026-06-01', sy: '편집본' }], cutoff: '2026-06-30' },
  [{ d: '2026-06-01', sy: '삭제된 원본' }, { d: '2026-07-15', sy: '편집 이후 새 기록' }]
);
ck('편집본은 기준일 이하를 대체하고, 이후 새 기록만 이어 붙인다',
  merged.length === 2 && merged[0].sy === '편집 이후 새 기록' && merged[1].sy === '편집본');

const histSaveSrc = grab(GAS, 'histSave_');
ck('서버 저장은 레벨 2 이상만 허용한다', /verifyLevel_\([\s\S]{0,40}\)\s*;[\s\S]{0,80}lv\s*<\s*2/.test(histSaveSrc));
ck('서버 저장은 LockService 로 동시 수정을 막는다', /LockService\.getScriptLock\(\)/.test(histSaveSrc) && /waitLock/.test(histSaveSrc));
ck('baseRev 불일치는 저장하지 않고 conflict 로 응답한다',
  /baseRev\s*!==\s*curRev/.test(histSaveSrc) && /conflict:true/.test(histSaveSrc));
ck('수정자·수정시각 감사 로그를 남긴다',
  /HIST\.LOG_SHEET/.test(histSaveSrc) && /whoName/.test(histSaveSrc));
ck('저장 후 이슈이력 캐시를 무효화한다', /bazCacheDrop_\('handover_issuehist'\)/.test(histSaveSrc));
ck('doPost 에 history_save 라우팅이 있다', /action==='history_save'/.test(GAS));

/* ════════════════════════════════════════════════════════════════════
   4. 자정 전후 Asia/Seoul 날짜
   ════════════════════════════════════════════════════════════════════ */
section('4. Asia/Seoul 날짜 · 자정 전환');

// 2026-08-12 23:59:59 KST = 2026-08-12T14:59:59Z
ck('자정 직전(23:59 KST)은 당일로 계산된다',
  BazDate.todayStr(new Date('2026-08-12T14:59:59Z')) === '2026-08-12');
// 2026-08-13 00:00:01 KST = 2026-08-12T15:00:01Z
ck('자정 직후(00:00 KST)는 다음 날로 넘어간다',
  BazDate.todayStr(new Date('2026-08-12T15:00:01Z')) === '2026-08-13');
ck('UTC 기준 날짜와 다른 시각에도 KST 를 따른다',
  BazDate.todayStr(new Date('2026-08-12T16:30:00Z')) === '2026-08-13');

ck('경과일은 자정을 넘기면 하루 늘어난다',
  BazDate.daysSince('2026-08-01', new Date('2026-08-12T14:59:59Z')) === 11 &&
  BazDate.daysSince('2026-08-01', new Date('2026-08-12T15:00:01Z')) === 12);
ck('깨진 날짜는 null 을 돌려준다', BazDate.daysSince('없음') === null && BazDate.daysSince('') === null);

// 자정 전환 구독
let fired = null;
const off = BazDate.onDayChange(d => { fired = d; });
BazDate.checkDayChange(new Date('2026-08-12T14:00:00Z'));   // 기준 등록
BazDate.checkDayChange(new Date('2026-08-12T14:30:00Z'));   // 같은 날 → 알림 없음
const sameDay = fired;
BazDate.checkDayChange(new Date('2026-08-12T15:30:00Z'));   // 날짜 전환
ck('자정을 넘기면 구독자에게 한 번 알린다', sameDay === null && fired === '2026-08-13');
off();
BazDate.resetCache();

ck('페이지가 TODAY 를 로드 시점에 고정하지 않는다',
  !/^\s*const\s+TODAY\s*=\s*new\s+Date\(\)/m.test(inlineJs) && /BazDate\.daysSince/.test(inlineJs));
const viewportMeta = (SRC.match(/<meta name="viewport"[^>]*>/) || [''])[0];
ck('viewport 확대 제한이 제거되었다',
  !!viewportMeta && !/user-scalable/.test(viewportMeta) && !/maximum-scale/.test(viewportMeta), viewportMeta);

/* ════════════════════════════════════════════════════════════════════
   5~8. 지도 상태 · relayout · 렌더 세대 · 전체화면
   ════════════════════════════════════════════════════════════════════ */
section('5~8. 지도 상태 전환 · relayout · 렌더 세대');

function fakeMap(lat, lng, level) {
  return {
    _c: { lat, lng }, _lv: level, relayouts: 0,
    getCenter() { return { getLat: () => this._c.lat, getLng: () => this._c.lng }; },
    setCenter(p) { this._c = { lat: p.lat, lng: p.lng }; },
    getLevel() { return this._lv; },
    setLevel(v) { this._lv = v; },
    relayout() { this.relayouts++; }
  };
}
function makeCtl(map, opts) {
  const queue = [];
  const ctl = BazMapController.create(Object.assign({
    getMap: () => map,
    makeLatLng: (lat, lng) => ({ lat, lng }),
    raf: fn => { queue.push(fn); return queue.length; },
    caf: id => { queue[id - 1] = null; }
  }, opts || {}));
  ctl._tick = () => { const q = queue.splice(0); q.forEach(fn => fn && fn()); };
  return ctl;
}

// 접기 → 펼치기 중심·배율 보존
let map = fakeMap(35.1796, 129.0756, 4);   // 부산 · 확대
let ctl = makeCtl(map);
ctl.beginTransition();                      // 접기 직전 저장
map.setCenter({ lat: 37.5665, lng: 126.978 }); map.setLevel(11);   // 접힘 사이 다른 렌더가 흔듦
ctl.endTransition();
ctl._tick();
ck('접기 → 펼치기에서 중심·배율이 보존된다',
  Math.abs(map._c.lat - 35.1796) < 1e-9 && Math.abs(map._c.lng - 129.0756) < 1e-9 && map._lv === 4,
  JSON.stringify({ c: map._c, lv: map._lv }));
ck('전환 한 번에 relayout 도 한 번', map.relayouts === 1, 'relayouts=' + map.relayouts);

// 전체화면 진입/종료 중심·배율 보존
map = fakeMap(35.1796, 129.0756, 4);
ctl = makeCtl(map);
ctl.withTransition(() => { map.setLevel(9); });      // 진입: 크기 급변으로 SDK 가 배율을 흔든 상황
ctl._tick();
const afterEnter = { lat: map._c.lat, lv: map._lv };
ctl.withTransition(() => { map.setCenter({ lat: 33, lng: 126 }); });   // 종료
ctl._tick();
ck('전체화면 진입/종료에서 중심·배율이 보존된다',
  afterEnter.lv === 4 && map._lv === 4 && Math.abs(map._c.lat - 35.1796) < 1e-9);

// scrollY 보존 (BazScrollLock)
globalThis.window = {
  scrollY: 0, innerWidth: 1440,
  scrollTo(x, y) { globalThis.window.scrollY = y; }
};
globalThis.document = {
  body: { style: { position: '', top: '', width: '', overflow: '', paddingRight: '' } },
  documentElement: { clientWidth: 1440 }
};
globalThis.window.scrollY = 742;
BazScrollLock.lock('mapfs');
ck('전체화면 진입 시 배경 스크롤이 잠긴다',
  document.body.style.position === 'fixed' && document.body.style.top === '-742px' && BazScrollLock.isLocked());
BazScrollLock.lock('modal:hist');                 // 중첩(이력 모달)
BazScrollLock.unlock('modal:hist');
ck('중첩 모달이 닫혀도 전체화면 잠금은 풀리지 않는다',
  BazScrollLock.isLocked() && BazScrollLock.count() === 1 && document.body.style.position === 'fixed');
BazScrollLock.unlock('mapfs');
ck('전체화면 종료 시 scrollY 가 정확히 복원된다',
  !BazScrollLock.isLocked() && window.scrollY === 742 && document.body.style.position === '');
ck('paddingTop 기반 전체화면 보정이 제거되었다',
  !/pane\.style\.paddingTop\s*=\s*Math\.round/.test(inlineJs) && /BazScrollLock\.lock\('mapfs'\)/.test(inlineJs));

// 연속 relayout 요청이 한 번으로 병합
map = fakeMap(37.5, 127, 6);
ctl = makeCtl(map);
for (let i = 0; i < 12; i++) ctl.scheduleRelayout();
ck('예약만 하고 아직 실행되지 않는다', map.relayouts === 0);
ctl._tick();
ck('연속 relayout 요청 12회가 1회로 병합된다', map.relayouts === 1,
  'requests=' + ctl.stats().requestCount + ' relayouts=' + map.relayouts);

// 드래그: 스로틀 + 종료 시 1회 보장
let clock = 1000;
map = fakeMap(37.5, 127, 6);
ctl = makeCtl(map, { now: () => clock });
ctl.dragStart();
for (let i = 0; i < 20; i++) { clock += 5; ctl.dragMove(); }   // 100ms 동안 20회 pointermove
ctl._tick();
const duringDrag = map.relayouts;
ctl.dragEnd();
ctl._tick();
ck('드래그 중 relayout 은 스로틀된다', duringDrag <= 2, 'duringDrag=' + duringDrag);
ck('드래그 종료 시 최종 relayout 이 1회 보장된다', map.relayouts === duringDrag + 1);

// 오래된 비동기 렌더 무효화
ctl = makeCtl(fakeMap(37.5, 127, 6));
const genOld = ctl.beginRender();
const genNew = ctl.beginRender();
ck('오래된 지도 렌더는 최신 렌더를 덮지 않는다', ctl.isStale(genOld) && !ctl.isStale(genNew));

// 자동 맞춤 게이트: 데이터가 그대로면 맞추지 않는다 / 사용자가 만졌으면 보호
clock = 100000;
ctl = makeCtl(fakeMap(37.5, 127, 6), { now: () => clock, userHoldMs: 60000 });
ck('첫 목록은 자동 맞춤한다', ctl.shouldAutoFit('sig-A') === true);
ck('같은 목록 재렌더(폴링)에서는 맞추지 않는다', ctl.shouldAutoFit('sig-A') === false);
ctl.markUserView();
ck('사용자가 지도를 옮긴 뒤에는 데이터가 바뀌어도 위치를 덮지 않는다', ctl.shouldAutoFit('sig-B') === false);
clock += 61000;
ck('보호 시간이 지나면 다시 자동 맞춤한다', ctl.shouldAutoFit('sig-C') === true);
ck("'결과 맞춤' 버튼은 사용자 보호를 무시하고 강제로 맞춘다", ctl.shouldAutoFit('sig-C', { force: true }) === true);

// 지도 휠 기본 비활성화
ck('PC/Window 모드에서 지도 휠 확대가 기본 비활성화된다',
  /setZoomable\(pcMapZoomableWanted\(\)\)/.test(inlineJs) && /baz_pc_mapinteract/.test(inlineJs));
ck('+/− 버튼 확대·축소는 유지된다', /data-mapctl="zin"/.test(SRC) && /data-mapctl="zout"/.test(SRC) && /function pcMapZoom/.test(inlineJs));
ck('내부 스크롤 영역에 overscroll-behavior 가 적용된다',
  /#filterRail\{[^}]*overscroll-behavior:contain/.test(SRC) && /#pcDetail\{[^}]*overscroll-behavior:contain/.test(SRC));
ck('120ms 뒤 중심·배율을 다시 덮던 코드가 제거되었다',
  !/setTimeout\(function\(\)\{\s*pcMapTimer=null;[\s\S]{0,120}applyFocus\(\)/.test(inlineJs));
ck('mode-window 자동 선택과 지도 sticky 해제 breakpoint 가 일치한다',
  /var PC_WIDE_MIN=980/.test(inlineJs) &&
  /min-width:'\+PC_WIDE_MIN\+'px/.test(inlineJs) &&
  /@media\(max-width:980px\)\{ body\.mode-window #pcRight/.test(SRC));

/* ════════════════════════════════════════════════════════════════════
   9. 내 주변 5km
   ════════════════════════════════════════════════════════════════════ */
section('9. 내 주변 5km N-CARE');

const SEOUL = { lat: 37.5665, lng: 126.9780 };
const hospitals = [
  { n: '가까운N', nc: 'Gold', lat: 37.5700, lng: 126.9800 },   // ≈0.4km
  { n: '3km N', nc: 'Silver', lat: 37.5935, lng: 126.9780 },   // ≈3.0km
  { n: '먼N', nc: 'Gold', lat: 37.7000, lng: 126.9780 },       // ≈14.8km → 제외
  { n: '가까운미가입', nc: '미가입', lat: 37.5670, lng: 126.9785 },  // N-CARE 아님 → 제외
  { n: '좌표없음', nc: 'Gold', lat: null, lng: null }            // 좌표 없음 → 제외
];
const near = BazNearby.filterNearby(hospitals, SEOUL, { km: 5 });
ck('5km 이내 N-CARE 만 남는다', near.length === 2 && near.every(h => h.nc !== '미가입'),
  near.map(h => h.n).join(','));
ck('거리순으로 정렬된다', near[0].n === '가까운N' && near[1].n === '3km N');
ck('거리(_dist)가 붙고 원본은 오염되지 않는다',
  near[0]._dist < 1 && hospitals[0]._dist === undefined);
ck('위치가 없으면 빈 목록', BazNearby.filterNearby(hospitals, null, { km: 5 }).length === 0);

const states = [];
const nearby = BazNearby.create({
  geolocation: {
    getCurrentPosition(okCb) { okCb({ coords: { latitude: SEOUL.lat, longitude: SEOUL.lng, accuracy: 10 } }); }
  },
  onChange: s => states.push(s)
});
nearby.request();
ck('위치 요청 → 성공 상태 전이', states.join('>') === 'locating>ready' && nearby.isActive());
ck('성공 시 위치 기준 목록을 돌려준다', nearby.apply(hospitals, { km: 5 }).length === 2);
nearby.off();
ck('모드 해제 시 off 로 돌아가고 필터가 풀린다',
  nearby.state() === 'off' && !nearby.isActive() && nearby.apply(hospitals) === null);

const denied = BazNearby.create({
  geolocation: { getCurrentPosition(_ok, err) { err({ code: 1, message: 'denied' }); } }
});
denied.request();
ck('권한 거부 상태를 구분한다', denied.state() === 'denied');

const broken = BazNearby.create({
  geolocation: { getCurrentPosition(_ok, err) { err({ code: 2, message: 'unavailable' }); } }
});
broken.request();
ck('위치 실패 상태를 구분한다', broken.state() === 'failed');

const unsupported = BazNearby.create({ geolocation: null });
unsupported.request();
ck('위치 API 를 쓸 수 없어도 예외 없이 상태만 바뀐다', unsupported.state() === 'unsupported');

ck('필터 영역에 내 주변 5km 버튼이 있다', /id="nearbyBtn"/.test(SRC) && /id="nearbyState"/.test(SRC));
// 지도 제목이 두 기능을 다른 문구로 부른다: 내 위치 기준(nearbyOn) vs 검색 결과 주변(mapNearby)
const titleBlock = inlineJs.slice(inlineJs.indexOf("if(pcRightMode==='map'){"), inlineJs.indexOf("if(pcRightMode==='map'){") + 700);
ck('내 위치 기준 모드와 검색 결과 주변 마커를 구분해 표기한다',
  /nearbyMode/.test(titleBlock) && /nearbyOn/.test(titleBlock) && /mapNearby/.test(titleBlock) &&
  /내 위치 기준 모드|다른 기능/.test(inlineJs));
for (const lang of ['ko', 'en', 'ja']) {
  const seg = SRC.slice(SRC.indexOf('  ' + lang + ':{ title:'), SRC.indexOf('  ' + lang + ':{ title:') + 12000);
  ck('내 주변 5km 문자열이 ' + lang.toUpperCase() + ' 에 있다',
    /nearbyOn:/.test(seg) && /locDenied:/.test(seg) && /mapFitResult:/.test(seg) && /lgProg:/.test(seg));
}

/* ════════════════════════════════════════════════════════════════════
   10. '결과 맞춤' 범위
   ════════════════════════════════════════════════════════════════════ */
section("10. '결과 맞춤' 범위");

// 실제 pcMapFitResults / pcMapFitAll 원문을 꺼내 stub 지도에서 실행
const fitHarness = new Function('state', `
  'use strict';
  var pcMapObj = state.map;
  var pcMapBounds = state.allBounds, pcMapBoundsAny = state.allAny;
  var pcMapFocusBounds = state.focusBounds, pcMapFocusAny = state.focusAny;
  var pcFocusName = state.focusName;
  var pcMapCtl = state.ctl;
  var t = function(k){ return k; };
  var bazToast = function(m){ state.toast = m; };
  var bazAnnounce = function(m){ state.announced = m; };
  var pcMapCtlSync = function(){};
  ${grab(SRC, 'pcMapFitResults')}
  ${grab(SRC, 'pcMapFitAll')}
  return { pcMapFitResults: pcMapFitResults, pcMapFitAll: pcMapFitAll, focusName: function(){ return pcFocusName; } };
`);

// 부산에서 검색한 결과 2곳 + 서울의 '오늘 완료' 마커 하나가 섞인 상황
const focusBounds = { tag: 'busan-only' };
const allBounds = { tag: 'nationwide' };
const fitState = {
  map: { applied: null, setBounds(b) { this.applied = b; } },
  allBounds, allAny: true, focusBounds, focusAny: true,
  focusName: '부산A병원',
  ctl: { clearUserView() { this.cleared = true; }, resetAutoFit() {} }
};
const fit = fitHarness(fitState);
fit.pcMapFitResults();
ck("'결과 맞춤'은 결과 범위만 사용한다(먼 완료 마커로 전국 축척이 되지 않음)",
  fitState.map.applied === focusBounds, 'applied=' + JSON.stringify(fitState.map.applied));
ck("'결과 맞춤'은 병원 하나에 묶인 포커스를 푼다", fit.focusName() === null);
fitState.map.applied = null;
fit.pcMapFitAll();
ck("'전체(완료·진행중 포함)'는 별도 버튼으로 넓은 범위를 쓴다", fitState.map.applied === allBounds);

// 맞출 결과가 없을 때는 조용히 실패하지 않고 알린다
const emptyState = {
  map: { applied: null, setBounds(b) { this.applied = b; } },
  allBounds, allAny: true, focusBounds: null, focusAny: false, focusName: null,
  ctl: { clearUserView() {}, resetAutoFit() {} }
};
const fit2 = fitHarness(emptyState);
ck('맞출 결과가 없으면 화면을 건드리지 않고 안내한다',
  fit2.pcMapFitResults() === false && emptyState.map.applied === null && emptyState.toast === 'mapNoResult');

ck('결과 맞춤·전체 보기 버튼이 UI 에 분리되어 있다',
  /data-mapctl="fitres"/.test(SRC) && /data-mapctl="fitall"/.test(SRC) && /data-mapctl="clearsel"/.test(SRC));
ck('지도 범례가 있다', /id="pcMapLegend"/.test(SRC));

/* ════════════════════════════════════════════════════════════════════
   11. 접근성 · 모달
   ════════════════════════════════════════════════════════════════════ */
section('11. 접근성 · 모달');

ck('이력·상세·비밀번호 모달에 role/aria-modal 이 있다',
  (SRC.match(/role="dialog" aria-modal="true"/g) || []).length >= 3);
ck('모달 제목이 연결되어 있다',
  /aria-labelledby="histName"/.test(SRC) && /aria-labelledby="histPwTitle"/.test(SRC));
ck('정렬 헤더가 키보드로 조작 가능하다',
  /tabindex="0" role="button"/.test(inlineJs) && /aria-sort=/.test(inlineJs) && /pcLeft'\)\.addEventListener\('keydown'/.test(inlineJs));
ck('포커스 트랩·Esc·포커스 복원이 모듈로 제공된다',
  /handleKeydown/.test(fs.readFileSync(path.join(ROOT, 'js', 'baz-modal.js'), 'utf8')) &&
  /BazModal\.bind\(document\)/.test(inlineJs));
ck('상태를 색만으로 전달하지 않는다(범례·배지에 텍스트 병기)',
  /lgDone/.test(SRC) && /st-badge/.test(inlineJs));

/* ════════════════════════════════════════════════════════════════════
   12. 코드 구조 · 배포 경로
   ════════════════════════════════════════════════════════════════════ */
section('12. 코드 구조 · 배포');

const modules = ['baz-dom', 'baz-date', 'baz-scroll-lock', 'baz-modal', 'baz-map-controller',
  'baz-hospital-data', 'baz-nearby', 'baz-history-api'];
for (const m of modules) {
  ck(m + '.js 가 존재하고 페이지에서 로드된다',
    fs.existsSync(path.join(ROOT, 'js', m + '.js')) && SRC.includes('js/' + m + '.js'));
}
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
ck('서비스워커 캐시 버전이 갱신되었다', /baz-cs-v124/.test(sw));
ck('새 모듈이 서비스워커 정책에 문서화되어 있다', /js\/baz-\*\.js/.test(sw));

/* ── 결과 ─────────────────────────────────────────────────────────── */
console.log('\n' + '='.repeat(60));
console.log(`결과: ${pass}/${total} 통과`);
if (fails.length) {
  console.log('\n실패 항목:');
  fails.forEach(f => console.log('  · ' + f));
  process.exit(1);
}
console.log('모든 검사를 통과했습니다.');
