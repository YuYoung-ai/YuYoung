/************************************************************
 * N-CARE 점검 운영률 기준일 회귀 테스트
 * 실행: node test/dashboard-ncare-asof.mjs
 *
 * 운영률은 예전에 언제나 브라우저 "오늘"을 기준으로 계산돼,
 * 지난주 보고서에 이번 주 상태가 실렸다. 이제 기준일은
 * "선택 기간의 끝, 단 미래로는 가지 않는다" 규칙을 따른다.
 ************************************************************/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', 'dashboard-pc.html'), 'utf8');
let pass = 0, total = 0; const fails = [];
function ck(name, cond, detail = '') {
  total++; if (cond) pass++; else fails.push(name + (detail ? ' — ' + detail : ''));
  console.log(cond ? '✅' : '❌', name, detail);
}
function grab(name) {
  const at = SRC.search(new RegExp('\\bfunction\\s+' + name.replace(/[$]/g, '\\$') + '\\s*\\('));
  if (at < 0) throw new Error('함수 없음: ' + name);
  let depth = 0;
  for (let j = SRC.indexOf('{', at); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++; else if (SRC[j] === '}' && --depth === 0) return SRC.slice(at, j + 1);
  }
  throw new Error('함수 끝 없음: ' + name);
}
function grabVar(decl) {
  const at = SRC.indexOf(decl);
  if (at < 0) throw new Error('선언 없음: ' + decl);
  return SRC.slice(at, SRC.indexOf('\n', at));
}

/* 오늘을 고정해야 규칙을 검증할 수 있다 — exToday 만 스텁으로 갈아끼운다. */
const TODAY = '2026-08-18';           /* 화요일 */
const FNS = ['nkey', 'rowDate', 'isDemoRecord', 'isNcareVisit',
  'exBaseDate', 'ncareAsOf_', 'ncareAsOfLabel_', 'buildNcareStatus'];
const src = [
  'var RAW=[], HOSPDB=[];',
  grabVar('var F={year:'),
  grabVar('var DEMO_MARK='),
  grabVar('var NCK_ST='),
  "function exToday(){ var t=new Date('" + TODAY + "T00:00:00'); t.setHours(0,0,0,0); return t; }",
  ...FNS.map(grab),
  'return {' + FNS.join(',') + ', exToday:exToday,' +
  ' setRAW:function(v){RAW=v;}, setHOSPDB:function(v){HOSPDB=v;}, setTo:function(v){F.to=v;} };'
].join('\n');
const D = new Function(src)();

function load(rows) {
  D.setRAW(rows.map(r => {
    const p = String(r.date).split('-').map(Number);
    return Object.assign({ ncare: '가입', detail: '' }, r, { _y: p[0], _m: p[1], _d: p[2] });
  }));
}
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

/* ══════ 1. 기준일 규칙 ══════ */
D.setTo('2026-08-15');                      /* 지난주 토요일(보고 주의 끝) — 과거 */
ck('1. 지난주(월~토) 선택 → 기준일은 그 주 토요일', ymd(D.ncareAsOf_()) === '2026-08-15', ymd(D.ncareAsOf_()));
ck('1-b. 기준일이 오늘이 아니면 날짜를 밝힌다', D.ncareAsOfLabel_() === '8.15 기준', D.ncareAsOfLabel_());

D.setTo('2026-08-22');                      /* 이번 주 토요일 — 미래 */
ck('2. 이번 주 선택(끝이 미래) → 오늘로 잘린다', ymd(D.ncareAsOf_()) === TODAY, ymd(D.ncareAsOf_()));
ck('2-b. 기준일이 오늘이면 "오늘 현황"', D.ncareAsOfLabel_() === '오늘 현황', D.ncareAsOfLabel_());

D.setTo('2026-08-31');                      /* 이번 달 말일 — 미래 */
ck('3. 이번 달 선택(끝이 미래) → 오늘로 잘린다', ymd(D.ncareAsOf_()) === TODAY, ymd(D.ncareAsOf_()));

D.setTo('2026-07-31');                      /* 지난달 말일 — 과거 */
ck('4. 지난달 선택 → 그 말일이 기준일', ymd(D.ncareAsOf_()) === '2026-07-31', ymd(D.ncareAsOf_()));

D.setTo('');                                /* 전체 기간 */
ck('5. 전체 기간(기간 없음) → 오늘', ymd(D.ncareAsOf_()) === TODAY, ymd(D.ncareAsOf_()));

/* ══════ 2. 기준일 이후 방문이 과거 운영률을 올리지 않는다 (핵심 회귀) ══════ */
load([
  { date: '2026-06-01', hosp: 'A병원' },    /* 8/14 기준 74일 경과 → 점검 필요 */
  { date: '2026-08-17', hosp: 'A병원' }     /* 기준일 이후 방문 — 8/14 시점에는 없던 일 */
]);
D.setHOSPDB([{ n: 'A병원', ncare: '가입' }]);

D.setTo('2026-08-14');
let S = D.buildNcareStatus();
ck('6. 기준일 이후 방문은 과거 운영률을 올리지 않는다', S.rate === 0, 'rate=' + S.rate + ' days=' + S.list[0].days);
ck('6-b. 마지막 점검일도 기준일 이전 기록으로 잡힌다', ymd(S.list[0].last) === '2026-06-01', ymd(S.list[0].last));

D.setTo('');                                /* 오늘(8/18) 기준이면 8/17 방문이 반영된다 */
S = D.buildNcareStatus();
ck('7. 오늘 기준으로 보면 최근 방문이 반영된다', S.rate === 100 && S.list[0].days === 1,
  'rate=' + S.rate + ' days=' + S.list[0].days);

/* ══════ 3. 구간·공식은 그대로 ══════ */
load([
  { date: '2026-08-10', hosp: 'A병원' },    /* 8/18 기준 8일  → 최근 점검 완료 */
  { date: '2026-07-10', hosp: 'B병원' },    /* 39일 → 점검 예정 */
  { date: '2026-06-10', hosp: 'C병원' },    /* 69일 → 점검 필요 */
  { date: '2026-01-10', hosp: 'D병원' }     /* 220일 → 우선 점검 */
]);
D.setHOSPDB(['A', 'B', 'C', 'D', 'E'].map(x => ({ n: x + '병원', ncare: '가입' })));
D.setTo('');
S = D.buildNcareStatus();
ck('8. 30/60/90일 구간이 그대로', S.cnt[0] === 1 && S.cnt[1] === 1 && S.cnt[2] === 1 && S.cnt[3] === 1 && S.cnt[4] === 1,
  S.cnt.join('/'));
ck('9. 운영률 = 30일 이내 / 전체 가입', S.rate === 20 && S.remain === 4, 'rate=' + S.rate + ' remain=' + S.remain);

/* ══════ 4. 분모(가입 명단)는 시점 보정을 하지 않는다 ══════ */
load([{ date: '2026-08-17', hosp: 'Z병원', ncare: '가입' }]);   /* 기준일(8/14) 이후 기록뿐 */
D.setHOSPDB([]);                                                /* 병원DB 없음 → 기록 기반 모집단 */
D.setTo('2026-08-14');
S = D.buildNcareStatus();
ck('10. 기록 기반 모집단은 기준일 컷오프 전에 모은다(분모 유지)', S.list.length === 1, 'list=' + S.list.length);
ck('10-b. 다만 방문은 반영되지 않아 "점검 기록 없음"', S.cnt[4] === 1 && S.rate === 0, 'cnt4=' + S.cnt[4] + ' rate=' + S.rate);

/* ══════ 5. 화면 문구가 기준일을 따라간다 ══════ */
ck('11. 남아 있는 N-Care 모달·관리대상 배지가 ncareAsOfLabel_() 을 쓴다',
  (SRC.match(/ncareAsOfLabel_\(\)/g) || []).length >= 4,
  (SRC.match(/ncareAsOfLabel_\(\)/g) || []).length + '곳');
ck('12. "오늘 현황" 하드코딩이 남아 있지 않다',
  !/badge:\s*'오늘 현황'/.test(SRC) && !/기준 · 오늘 현황/.test(SRC));
ck('13. 기간이 바뀌면 상세 분석 카드도 다시 그린다', /if\(DATA_READY\)\s*ncareCheck\(\);/.test(SRC));
const actions = grab('renderExecutiveActions');
const ncareCard = actions.slice(actions.indexOf("document.getElementById('exNckCard')"), actions.indexOf('var K=x.skill'));
ck('14. 관리 대상 N-Care 카드에 운영률 수치·비율 막대를 표시하지 않는다',
  !ncareCard.includes('점검 운영률') && !ncareCard.includes('S.rate') && !ncareCard.includes('ex-rate'));
ck('15. 가입 병원 수·기준일·5개 점검 구간·잔여 명단은 유지',
  ['S.list.length','ncareAsOfLabel_()','ST.slice(0,4)','S.cnt[i]','S.cnt[4]','잔여 점검 병원','exShowNck()','N-CARE 가입 병원 기록 없음']
    .every(s=>ncareCard.includes(s)));

console.log('──────────────────────────────');
console.log('통과 ' + pass + '/' + total);
if (fails.length) { console.log('실패:'); fails.forEach(f => console.log(' - ' + f)); process.exit(1); }
console.log('모든 테스트 통과 ✅');
