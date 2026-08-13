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
 *   · 지도 말풍선에 병원 정보·최근 이력이 담기고 클러스터 상태에서도 열림
 *   · 확대/축소 뒤 타일 재계산(회색 타일 자가 복구)
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

const payload = BazHistoryApi.buildPayload({ hosp: 'A병원', records: dirty, who: '홍길동', baseRev: 3, baseSourceRev: 27, token: 'tk' });
ck('페이로드에 병원명·이력·요청자·편집/원본 revision·토큰이 담긴다',
  payload.action === 'history_save' && payload.hosp === 'A병원' && payload.who === '홍길동' &&
  payload.baseRev === 3 && payload.baseSourceRev === 27 && payload.token === 'tk' && payload.records.length === 2);

const okRes = BazHistoryApi.classifyResponse({ success: true, rev: 4, sourceRev: 29, records: clean, updatedAt: '2026-08-12 10:00', updatedBy: '홍길동' });
ck('저장 성공 응답 분류', okRes.ok && okRes.rev === 4 && okRes.sourceRev === 29 && okRes.records.length === 2 && !okRes.conflict);

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
  ${grab(GAS, 'histPublicRecord_')}
  ${grab(GAS, 'histPublicList_')}
  ${grab(GAS, 'histDerivedState_')}
  ${histMergeSrc}
  return { histSanitize_, histMerge_, histDerivedState_ };
`)({ MAX_LEN: 2000, MAX_RECORDS: 300 }, ['d', 't', 'pt', 'sy', 'f', 'pay', 'm', 'fx', 'p']);

const gasClean = gasFns.histSanitize_([{ d: '2026.8.3', sy: 'x', hack: '<script>', t: '점검' }]);
ck('서버도 허용 목록 밖 필드를 제거한다',
  gasClean.length === 1 && !('hack' in gasClean[0]) && gasClean[0].d === '2026-08-03');

const merged = gasFns.histMerge_(
  { records: [{ d: '2026-06-01', sy: '편집본' }], cutoff: '2026-06-30', cutoffRow: 20 },
  [{ d: '2026-06-01', sy: '삭제된 원본', _srcRow: 20 }, { d: '2026-07-15', sy: '편집 이후 새 기록', _srcRow: 21 }]
);
ck('편집본은 기준일 이하를 대체하고, 이후 새 기록만 이어 붙인다',
  merged.length === 2 && merged[0].sy === '편집 이후 새 기록' && merged[1].sy === '편집본' &&
  merged.every(r => !Object.prototype.hasOwnProperty.call(r, '_srcRow')));
const sameDayMerged = gasFns.histMerge_(
  { records: [{ d: '2026-08-12', sy: '오전 편집본' }], cutoff: '2026-08-12', cutoffRow: 30 },
  [{ d: '2026-08-12', sy: '오전 원본', _srcRow: 30 }, { d: '2026-08-12', sy: '오후 새 기록', _srcRow: 31 }]
);
ck('같은 날짜에 나중에 추가된 현장 기록도 기준행으로 구분해 이어 붙인다',
  sameDayMerged.length === 2 && sameDayMerged.some(r => r.sy === '오후 새 기록'));
const absorbed = gasFns.histMerge_(
  { records: sameDayMerged, cutoff: '2026-08-12', cutoffRow: 31 },
  [{ d: '2026-08-12', sy: '오전 원본', _srcRow: 30 }, { d: '2026-08-12', sy: '오후 새 기록', _srcRow: 31 }]
);
ck('새 원본을 포함해 다시 저장한 뒤에는 같은 기록이 중복되지 않는다', absorbed.length === 2);

const histSaveSrc = grab(GAS, 'histSave_');
ck('서버 저장은 레벨 2 이상만 허용한다', /verifyLevel_\([\s\S]{0,40}\)\s*;[\s\S]{0,80}lv\s*<\s*2/.test(histSaveSrc));
ck('서버 저장은 잠금 획득 뒤에만 진행하고 반드시 해제한다',
  /waitLock\(15000\);\s*held\s*=\s*true/.test(histSaveSrc) && /if\(held\)[\s\S]*releaseLock/.test(histSaveSrc));
ck('편집 revision 또는 현장 원본 revision 불일치는 저장하지 않고 conflict 로 응답한다',
  /baseRev\s*!==\s*curRev/.test(histSaveSrc) && /baseSourceRev\s*!==\s*src\.maxRow/.test(histSaveSrc) && /conflict:true/.test(histSaveSrc));
ck('잠금 획득 실패 뒤에는 읽기·쓰기를 계속하지 않는다',
  histSaveSrc.indexOf("catch(lockErr){ return") < histSaveSrc.indexOf('histReadAll_()'));
ck('수정자·수정시각 감사 로그를 남긴다',
  /HIST\.LOG_SHEET/.test(histSaveSrc) && /whoName/.test(histSaveSrc));
ck('저장 후 이슈이력 데이터·rev 캐시를 무효화한다', /syncCacheDrop_\('handover_issuehist'\)/.test(histSaveSrc));
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
/* 지도가 상단 전폭으로 돌아오면서 결과 목록은 다시 본문 스크롤을 쓴다 →
   휠 확대가 꺼져 있으면 아무것도 가로채지 않고 그대로 흘려보내야 한다. */
function runWheel(zoomable) {
  const state = { marked: false, zoomNoted: false, hint: 0, prevented: false, listScrolled: false };
  const fn = new Function('state', `
    var pcMapCtl={markUserView:function(){state.marked=true;}};
    var document={getElementById:function(){ state.listScrolled=true; return null; }};
    function pcMapZoomableWanted(){return ${zoomable ? 'true' : 'false'};}
    function pcMapShowWheelHint(){state.hint++;}
    function pcMapNoteZoom(){state.zoomNoted=true;}
    ${grab(SRC, 'pcMapHandleWheel')}
    return pcMapHandleWheel;
  `)(state);
  fn({ deltaY: 180, deltaMode: 0, cancelable: true, preventDefault() { state.prevented = true; } });
  return state;
}
const wheelOff = runWheel(false);
ck('휠 확대가 꺼져 있으면 휠을 가로채지 않는다(페이지가 그대로 스크롤된다)',
  !wheelOff.prevented && !wheelOff.listScrolled && wheelOff.hint === 1);
const wheelOn = runWheel(true);
ck('휠 확대가 켜져 있으면 사용자 조작으로 기록하고 타일 재계산을 예약한다',
  wheelOn.marked && wheelOn.zoomNoted && wheelOn.hint === 0);
ck('휠 리스너가 passive 로 등록된다(preventDefault 를 쓰지 않음)',
  /addEventListener\('wheel', pcMapHandleWheel, \{passive:true, capture:true\}\)/.test(inlineJs) &&
  !/pcLeft'\);?\s*\n?\s*if\(window\.innerWidth>=1200/.test(inlineJs));
ck('+/− 버튼 확대·축소는 유지된다', /data-mapctl="zin"/.test(SRC) && /data-mapctl="zout"/.test(SRC) && /function pcMapZoom/.test(inlineJs));
ck('내부 스크롤 영역에 overscroll-behavior 가 적용된다',
  /#filterRail\{[^}]*overscroll-behavior:contain/.test(SRC) && /\.pc-dm-sheet\{[^}]*overscroll-behavior:contain/.test(SRC));
ck('120ms 뒤 중심·배율을 다시 덮던 코드가 제거되었다',
  !/setTimeout\(function\(\)\{\s*pcMapTimer=null;[\s\S]{0,120}applyFocus\(\)/.test(inlineJs));
const resetState = new Function(`
  var pcMapTimer=null, pcMapObj={}, pcMapClusterer={}, pcSelOv={}, pcFocusIW={};
  var pcMapMarkers=[1], pcMarkerByName={x:1}, pcRecentOverlays=[1], pcProgOverlays=[1], pcNearbyMarkers=[1];
  var pcBaseKey='x', pcOverlayKey='y', pcNearKey='z';
  var pcMapBounds={}, pcMapBoundsAny=true, pcMapFocusBounds={}, pcMapFocusAny=true;
  var calls={cancel:0, reset:0};
  var pcMapCtl={cancelRelayout:function(){calls.cancel++;},resetAutoFit:function(){calls.reset++;}};
  ${grab(SRC, 'pcMapReset')}
  pcMapReset();
  return {calls:calls, all:pcMapBounds, allAny:pcMapBoundsAny, focus:pcMapFocusBounds, focusAny:pcMapFocusAny};
`)();
ck('지도 재생성 시 예약 relayout과 전체/결과 범위를 모두 초기화한다',
  resetState.calls.cancel === 1 && resetState.calls.reset === 1 &&
  resetState.all === null && !resetState.allAny && resetState.focus === null && !resetState.focusAny);
/* 지도는 '상단 전폭 고정' 하나로 일원화 — 1200px 이상 3열(지도 오른쪽 칸) 규칙은 제거됐다.
   3열에서 #pcLeft 가 자체 스크롤 컨테이너가 되며 생기던 이중 스크롤·휠 우회도 함께 사라진다. */
ck('1200px 이상 3열(지도 오른쪽 칸) 레이아웃이 제거되었다',
  !/@media\(min-width:1200px\)/.test(SRC) &&
  !/#pcRight\{[^}]*grid-column:3/.test(SRC) &&
  !/#pcPane\{display:contents/.test(SRC));
ck('지도는 목록 위에 전폭으로 sticky 고정된다',
  /body\.mode-window #pcRight\{height:var\(--pc-map-h,400px\);[^}]*position:sticky/.test(SRC) &&
  SRC.indexOf("id=\"pcRight\"") < SRC.indexOf("id=\"pcToolbar\"") &&
  SRC.indexOf("id=\"pcToolbar\"") < SRC.indexOf("id=\"pcLeft\""));
ck('표 뷰는 기존대로 지도를 숨기고 전체 폭을 쓴다',
  /body\.mode-window\.pc-table #pcRight\{display:none/.test(SRC) &&
  /classList\.toggle\('pc-table', pcListView==='table'\)/.test(inlineJs));
ck('#pcLeft 가 더 이상 자체 스크롤 컨테이너가 아니다',
  !/#pcLeft\{[\s\S]{0,160}overflow:auto/.test(SRC));
ck('높이 조절 핸들이 넓은 화면에서도 살아 있다',
  !/min-width:1200px[\s\S]{0,2000}#pcMapGrip\{display:none/.test(SRC) &&
  /id="pcMapGrip"/.test(SRC));
ck('mode-window 자동 선택과 지도 sticky 해제 breakpoint 가 일치한다',
  /var PC_WIDE_MIN=980/.test(inlineJs) &&
  /min-width:'\+PC_WIDE_MIN\+'px/.test(inlineJs) &&
  /@media\(max-width:980px\)\{ body\.mode-window #pcRight/.test(SRC));

/* ════════════════════════════════════════════════════════════════════
   9. 지도 말풍선(병원 정보 + 이력) · '내 주변 5km' 제거
   ════════════════════════════════════════════════════════════════════ */
section('9. 지도 말풍선 · 내 주변 5km 제거');

/* ── 9-1. '내 주변 5km N-CARE 병원 조회'(브라우저 위치 기준 필터) 완전 제거 ──
   지도에 뜨는 '검색 결과 주변 5km 참고 마커'(pcDrawNearby)는 다른 기능이라 남는다. */
ck('내 주변 5km 버튼·상태 영역이 사라졌다',
  !/id="nearbyBtn"/.test(SRC) && !/id="nearbyState"/.test(SRC) && !/id="nearbyBox"/.test(SRC));
ck('위치 기반 필터 코드(nearbyMode·myPos·BazNearby)가 남아 있지 않다',
  !/\bnearbyMode\b/.test(inlineJs) && !/\bBazNearby\b/.test(SRC) && !/js\/baz-nearby\.js/.test(SRC));
ck('baz-nearby.js 모듈 파일이 삭제되었다', !fs.existsSync(path.join(ROOT, 'js', 'baz-nearby.js')));
for (const lang of ['ko', 'en', 'ja']) {
  const at = SRC.indexOf('  ' + lang + ':{ title:');
  const seg = SRC.slice(at, at + 12000);
  ck('위치 조회 문자열이 ' + lang.toUpperCase() + ' 에서 제거되고 지도 문자열은 남았다',
    !/nearbyOn:/.test(seg) && !/locDenied:/.test(seg) && !/emptyNear:/.test(seg) &&
    /mapFitResult:/.test(seg) && /lgProg:/.test(seg) && /mapNearby:/.test(seg));
}
ck('검색 결과 주변 5km 참고 마커는 그대로 유지된다',
  /function pcDrawNearby/.test(inlineJs) && /function pcNearbyOf/.test(inlineJs) &&
  /mapNearby/.test(inlineJs));
ck('필터 칩 클릭이 더 이상 위치 모드에 막히지 않는다',
  /closest\('\[data-filter\]'\); if\(!c\) return;/.test(inlineJs));

/* ── 9-2. 상세는 '별도 창' 하나로 통일 ────────────────────────────────────
   지도 위 말풍선(InfoWindow)은 제거됐다. 카카오 InfoWindow 는 open() 시점에
   아직 문서에 붙지 않은 content 노드를 재서 흰 버블 크기를 정하는데, 그 시점에는
   CSS(grid/flex/max-height)가 적용되지 않아 버블이 첫 줄 높이로만 잡히고
   나머지 내용이 흰 배경 밖 지도 타일 위로 흘러나왔다(읽을 수 없는 상태). */
ck('지도 말풍선(InfoWindow)이 제거되었다',
  !/new kakao\.maps\.InfoWindow/.test(inlineJs) && !/pcFocusIW/.test(inlineJs) &&
  !/pcMapInfoNode/.test(inlineJs) && !/\.pc-iw/.test(SRC));
ck('오른쪽 상세 drawer 도 제거되고 별도 창 하나만 남았다',
  !/id="pcDetail"/.test(SRC) && !/pcBackMap/.test(SRC) &&
  !/#pcRight\.detail/.test(SRC) && !/pcRightMode/.test(inlineJs));
ck('pcSelect 는 화면 폭·뷰와 무관하게 항상 별도 창을 연다',
  /function pcSelect\(name\)\{[\s\S]{0,420}BazModal\.open\(document\.getElementById\('pcDetailModal'\)/.test(inlineJs) &&
  !/function pcSelect\(name\)\{[\s\S]{0,420}pcListView==='table'/.test(inlineJs));
ck('별도 창 본문이 전체 이력을 그린다(pcRenderDetail 기본 대상)',
  /box = box \|\| document\.getElementById\('pcDetailModalBody'\)/.test(inlineJs));
ck('별도 창에 role/aria-modal 과 닫기 수단이 있다',
  /class="pc-dm-sheet" role="dialog" aria-modal="true"/.test(SRC) &&
  /id="pcDetailModalClose"/.test(SRC));
/* 폴링 재렌더가 열어 둔 창을 닫아 버리면 안 된다 */
ck('재렌더는 열려 있는 창을 닫지 않고 내용만 갱신한다',
  !/if\(pcListView!=='table'\) pcCloseDetailModal\(\)/.test(inlineJs) &&
  /_dm\.classList\.contains\('show'\) && pcSelName\)\{\s*\n\s*pcRenderDetail\(pcSelName/.test(inlineJs));

/* ── 9-3. 카드·마커 클릭 → 지도 이동·확대 + 별도 창 ───────────────────────
   [회귀] 예전에는 setLevel(tgt,{animate}) 직후 panTo(pos) 를 불렀다. 카카오는 확대
   애니메이션 중 들어온 panTo 를 흘려버려서, 배율이 바뀌는 첫 클릭에서는 지도가
   확대만 되고 이동하지 않았다. 두 번째부터는 배율이 이미 목표값이라 setLevel 이
   no-op → 애니메이션이 없어 panTo 가 먹혔다("처음엔 안 되다가 몇 번 누르면 된다").
   → 배율이 바뀌든 아니든 setCenter 가 반드시 불리는지 검사한다. */
function runFocus(startLevel, hosp) {
  const state = { calls: [], announced: null, ring: null, focusName: null };
  const fn = new Function('state', `
    'use strict';
    var PC_FOCUS_LEVEL=4;
    var pcFocusName=null, pcListView='cards', pcList=[];
    var pcMapObj={
      getLevel:function(){ return state.level; },
      setLevel:function(l){ state.calls.push('setLevel:'+l); state.level=l; },
      setCenter:function(c){ state.calls.push('setCenter:'+c.lat+','+c.lng); },
      panTo:function(){ state.calls.push('panTo'); }
    };
    state.level=${startLevel};
    var kakao={maps:{LatLng:function(lat,lng){ this.lat=lat; this.lng=lng; }}};
    var document={querySelectorAll:function(){ return { forEach:function(){} }; }};
    var pcMapCtl={markUserView:function(){ state.calls.push('markUserView'); }};
    function pcMapVisible(){ return true; }
    function pcMapSelRing(n){ state.ring=n; }
    function pcMapCtlSync(){}
    function pcHospByName(){ return state.hosp; }
    function pcRender(){}
    ${grab(SRC, 'pcFocusHospOnMap')}
    return function(n){ var r=pcFocusHospOnMap(n, null); state.focusName=pcFocusName; return r; };
  `)(state);
  state.hosp = hosp;
  state.ok = fn(hosp && hosp.n);
  return state;
}
const farZoom = runFocus(9, { n: '성민의원', lat: 37.5, lng: 127.03 });
ck('배율이 바뀌는 첫 클릭에서도 중심 이동이 반드시 일어난다',
  farZoom.ok && farZoom.calls.some(c => c.startsWith('setLevel:')) &&
  farZoom.calls.some(c => c === 'setCenter:37.5,127.03'), farZoom.calls.join(' > '));
ck('확대 애니메이션과 경쟁하던 panTo 를 더 이상 쓰지 않는다',
  !farZoom.calls.includes('panTo') && !/panTo\(/.test(inlineJs), farZoom.calls.join(' > '));
ck('병원 이동에는 애니메이션 옵션을 주지 않는다(결정적 이동)',
  /if\(cur!==tgt\) pcMapObj\.setLevel\(tgt\); \}catch/.test(inlineJs) &&
  !/setLevel\(tgt,/.test(inlineJs));
const nearZoom = runFocus(3, { n: '성민의원', lat: 37.5, lng: 127.03 });
ck('이미 가까이 본 배율은 강제로 축소하지 않고 중심만 옮긴다',
  nearZoom.ok && !nearZoom.calls.some(c => c.startsWith('setLevel:')) &&
  nearZoom.calls.some(c => c === 'setCenter:37.5,127.03'), nearZoom.calls.join(' > '));
ck('이동한 병원을 선택 강조하고 사용자 조작으로 기록한다',
  farZoom.ring === '성민의원' && farZoom.calls.includes('markUserView') && farZoom.focusName === '성민의원');
const noCoord = runFocus(9, { n: '오블리브의원 서울오리진점', lat: null, lng: null });
ck('좌표가 없으면 지도를 건드리지 않고 실패를 알린다',
  noCoord.ok === false && noCoord.calls.length === 0);

/* 좌표가 없는 병원: 실패 캐시를 무시하고 그 병원만 1회 재지오코딩 */
ck('클릭한 병원만 즉시 재지오코딩하는 경로가 있다',
  /function pcGeocodeOne\(h, cb\)/.test(inlineJs) &&
  /pcGeoRetried\[addr\]/.test(inlineJs) &&
  /geoCache\[addr\]=\{lat:la,lng:ln\}; geoSaveCache\(\);/.test(inlineJs));
ck('재지오코딩에 성공하면 마커를 다시 그리고 그 위치로 이동한다',
  /pcBaseKey='';[\s\S]{0,160}pcShowMap\(pcList\|\|\[\]\);[\s\S]{0,80}pcFocusHospOnMap\(name, null\)/.test(inlineJs));
ck('끝내 좌표가 없으면 창은 띄우되 이유를 알린다',
  /mapNoCoord/.test(inlineJs) && /bazToast\(t\('mapNoCoord'\)\)/.test(inlineJs));
for (const lang of ['ko', 'en', 'ja']) {
  const at = SRC.indexOf('  ' + lang + ':{ title:');
  ck('좌표 없음 안내가 ' + lang.toUpperCase() + ' 에 있다',
    /mapNoCoord:/.test(SRC.slice(at, at + 12000)));
}

/* 클릭 진입점 통일 */
ck('카드·표·지도 마커가 모두 같은 진입점(pcOpenHosp)으로 모인다',
  /function pcOpenHosp\(name\)/.test(inlineJs) &&
  /function pcPickHosp\(name\)\{ pcOpenHosp\(name\); \}/.test(inlineJs) &&
  /addListener\(mk,'click',function\(\)\{ pcPickHosp\(h\.n\); \}\)/.test(inlineJs));
ck('진입점이 지도 이동과 별도 창을 함께 처리한다',
  /function pcOpenHosp\(name\)\{[\s\S]{0,900}pcFocusHospOnMap\(name, null\)[\s\S]{0,400}pcSelect\(name\)/.test(inlineJs));
ck('표 뷰·접힘에서는 지도를 억지로 되살리지 않고 창만 띄운다',
  /function pcOpenHosp\(name\)\{[\s\S]{0,400}if\(pcMapVisible\(\)\)\{/.test(inlineJs));
ck('같은 카드를 다시 눌러도 해제되지 않는다(해제는 지도 ✕ 버튼)',
  !/if\(pcFocusName===name && pcSelName===name\)\{ pcClearHospFocus\(\); return; \}/.test(inlineJs) &&
  /data-mapctl="clearsel"/.test(SRC));

/* ── 9-4. 확대/축소 뒤 타일 자가 복구 ─────────────────────────────────── */
const zoomFix = new Function('state', `
  'use strict';
  var pcMapObj=state.map;
  var pcMapCtl={scheduleRelayout:function(){state.relayouts++;}};
  function pcMapVisible(){ return state.visible; }
  var setTimeout=function(fn){ state.timers.push(fn); return state.timers.length; };
  var clearTimeout=function(){ state.cleared++; };
  ${grab(SRC, 'pcMapNoteZoom')}
  ${grab(SRC, 'pcMapIdleFix')}
  var pcZoomDirty=false, pcZoomFixT=0;
  return {
    note: function(){ pcZoomDirty=true; },
    idle: function(){
      if(!pcZoomDirty) return;
      if(pcZoomFixT) { state.cleared++; }
      pcZoomFixT=1;
      state.timers.push(function(){ pcZoomFixT=0; if(!pcZoomDirty||!pcMapObj||!pcMapVisible()) return; pcZoomDirty=false; pcMapCtl.scheduleRelayout(); });
    },
    dirty: function(){ return pcZoomDirty; }
  };
`);
const zf = { map: {}, visible: true, relayouts: 0, timers: [], cleared: 0 };
const zoom = zoomFix(zf);
zoom.idle();
ck('배율이 바뀌지 않았으면 idle 에 타일 재계산을 걸지 않는다', zf.timers.length === 0);
zoom.note(); zoom.idle(); zoom.note(); zoom.idle();
zf.timers.forEach(fn => fn());
ck('확대/축소가 있었으면 지도가 멈춘 뒤 타일 재계산을 1회만 건다',
  zf.relayouts === 1 && zf.cleared >= 1);
ck('zoom_changed·idle 이 타일 복구 훅에 연결되어 있다',
  /'zoom_changed',function\(\)\{ pcMapCtlSync\(\); pcMapNoteZoom\(\); \}/.test(inlineJs) &&
  /'idle',function\(\)\{ pcMapViewSaveDebounced\(\); pcMapIdleFix\(\); \}/.test(inlineJs));
ck('타일 재계산은 중심·배율을 건드리지 않는다(relayout 요청만)',
  /pcMapCtl\.scheduleRelayout\(\);\s*\n\s*\}, 260\);/.test(inlineJs));
ck('연타 확대는 애니메이션을 끄고 마지막 한 번만 부드럽게 한다',
  /var fast=\(Date\.now\(\)-pcLastZoomAt\)<300;/.test(inlineJs) &&
  /if\(fast\) pcMapObj\.setLevel\(lv\);/.test(inlineJs));
ck('크기 0 컨테이너에는 지도를 만들지 않고 미룬다',
  /box\.width<40 \|\| box\.height<40/.test(inlineJs) && /pcShowMap\(list\); \}, 120\);/.test(inlineJs));

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
  'baz-hospital-data', 'baz-history-api'];
for (const m of modules) {
  ck(m + '.js 가 존재하고 페이지에서 로드된다',
    fs.existsSync(path.join(ROOT, 'js', m + '.js')) && SRC.includes('js/' + m + '.js'));
}
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
/* 정확한 번호를 박아 두면 다른 페이지를 고쳐 캐시를 올릴 때마다 이 테스트가 깨진다
   (sw.js 자체가 "수정할 때마다 반드시 올리라"고 요구한다). 하한만 확인한다. */
const swVer = Number((sw.match(/baz-cs-v(\d+)/) || [])[1] || 0);
ck(`서비스워커 캐시 버전이 갱신되었다(≥124) — 현재 v${swVer}`, swVer >= 124);
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
