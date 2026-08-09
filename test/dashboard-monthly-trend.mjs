/************************************************************
 * dashboard-monthly-trend.mjs
 * 보고 모드 ①주간 핵심보고 "월별 A/S·점검 처리 추이" 회귀 테스트
 * 실행: node test/dashboard-monthly-trend.mjs
 * ----------------------------------------------------------
 * 무빌드 헤드리스. dashboard-pc.html 에서 집계·렌더 함수 원문을 그대로
 * 꺼내 실행하므로, HTML 안의 로직이 바뀌면 이 테스트가 같이 깨진다.
 * (autodoc/v2/test/regression.mjs 와 같은 방식)
 ************************************************************/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', 'dashboard-pc.html'), 'utf8');

let pass = 0, total = 0;
const fails = [];
const ck = (n, c, d) => {
  total++;
  if (c) pass++; else fails.push(n + (d ? ' — ' + d : ''));
  console.log((c ? '✅' : '❌'), n, d || '');
};

/* ── dashboard-pc.html 에서 함수/변수 원문 추출 ──────────────
   중괄호 짝을 세어 함수 본문 끝을 찾는다. 이 파일의 주석·문자열 안 중괄호는
   모두 짝이 맞아(예: "→ {y,m,d,q}") 단순 카운트로 충분하다. */
function grab(name) {
  const at = SRC.search(new RegExp('\\bfunction\\s+' + name.replace(/[$]/g, '\\$') + '\\s*\\('));
  if (at < 0) throw new Error('함수를 찾지 못했습니다: ' + name);
  let i = SRC.indexOf('{', at), depth = 0;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}' && --depth === 0) return SRC.slice(at, j + 1);
  }
  throw new Error('본문 끝을 찾지 못했습니다: ' + name);
}
function grabVar(decl) {
  const at = SRC.indexOf(decl);
  if (at < 0) throw new Error('선언을 찾지 못했습니다: ' + decl);
  return SRC.slice(at, SRC.indexOf('\n', at));
}

const FNS = [
  'esc', 'normD', 'costNum', 'nkey', 'rowDate', 'monday', 'addD', 'ymd',
  'isDemoRecord', 'recScope', 'exToday', 'exBaseDate',
  'filteredRows_', 'hospStateFilter_', 'exWindowBaseRows_', 'exWindowRows',
  'buildWeekTrend', 'exCountRange_', 'buildMonthTrend', 'buildMonthTrendCompare',
  'exMonthTrendNote_', 'exNum', 'exMD_', 'exMonthTrendLabel_',
  'exMonthCmpTile_', 'exMonthTrendBody_'
];
const src = [
  grabVar('var RAW=[];'),
  grabVar('var F={year:'),
  grabVar('var DEMO_MARK='),
  grabVar('var EX_MONTH_TREND_N='),
  ...FNS.map(grab),
  'return {' + FNS.join(',') + ', setRAW:function(v){RAW=v;}, setF:function(v){F=v;}, getF:function(){return F;}};'
].join('\n');
const D = new Function(src)();

/* ── boot() 과 같은 방식으로 원본 행을 준비한다 ── */
const emptyF = () => ({
  year: [], month: [], quarter: [], gubun: [], paid: [], ncare: [], cat: [], fse: [],
  type: [], part: [], hosp: [], noz: [], skill: [], scope: [], hospQ: '', from: '', to: ''
});
function load(rows, over) {
  D.setRAW(rows.map(r => {
    const o = Object.assign({ hosp: '', fse: '', gubun: '', cat: '', type: '', part: '', cost: '', detail: '', sn: '' }, r);
    const dd = D.normD(o.date);
    o._y = dd.y; o._m = dd.m; o._d = dd.d; o._q = dd.q; o._cost = D.costNum(o.cost);
    o.ncare = o.ncare || '미가입'; o.paid = o.paid || '';
    return o;
  }));
  D.setF(Object.assign(emptyF(), over || {}));
}
/* 기준일 = 보고 화면에서 고른 기간의 끝날(F.to) */
const base = (from, to) => ({ from, to });
const monthOf = (tr, m) => tr.find(t => t.m === m);

/* ══════ 1. 같은 병원·같은 날 장비 2대 처리 → 2건 ══════ */
{
  load([
    { date: '2026-08-05', hosp: '가나병원', gubun: 'A/S', sn: 'SN-1' },
    { date: '2026-08-05', hosp: '가나병원', gubun: 'A/S', sn: 'SN-2' }
  ], base('2026-08-01', '2026-08-09'));
  const aug = monthOf(D.buildMonthTrend(), 8);
  ck('1. 같은 병원·같은 날 장비 2대 → A/S 2건 (dedupe 안 함)', aug.as === 2 && aug.n === 2, 'as=' + aug.as + ' n=' + aug.n);
}
/* 같은 병원·날짜·담당자까지 완전히 같아도 행 수만큼 센다 */
{
  load([
    { date: '2026-08-05', hosp: '가나병원', gubun: 'A/S', fse: '김프로' },
    { date: '2026-08-05', hosp: '가나병원', gubun: 'A/S', fse: '김프로' },
    { date: '2026-08-05', hosp: '가나병원', gubun: 'A/S', fse: '김프로' }
  ], base('2026-08-01', '2026-08-09'));
  ck('1-b. 병원+날짜+담당자가 같아도 3행 → 3건', monthOf(D.buildMonthTrend(), 8).as === 3);
}

/* ══════ 2. 같은 병원·같은 날 A/S와 점검 → 각 시리즈 1건 ══════ */
{
  load([
    { date: '2026-08-05', hosp: '가나병원', gubun: 'A/S' },
    { date: '2026-08-05', hosp: '가나병원', gubun: '점검' }
  ], base('2026-08-01', '2026-08-09'));
  const aug = monthOf(D.buildMonthTrend(), 8);
  ck('2. 같은 병원·같은 날 A/S·점검 → 각 1건, 합계 2건', aug.as === 1 && aug.insp === 1 && aug.n === 2);
}

/* ══════ 3. 처리일(date) 기준 월별 분류 ══════ */
{
  load([
    { date: '2026-08-01', hosp: 'A', gubun: 'A/S' },
    { date: '2026-07-31', hosp: 'A', gubun: 'A/S' },
    { date: '2026-06-15', hosp: 'A', gubun: '점검' },
    { date: '2026-03-02', hosp: 'A', gubun: '점검' },
    { date: '2026-02-28', hosp: 'A', gubun: 'A/S' },   /* 6개월 창(3~8월) 밖 */
    { date: '2026. 5. 9', hosp: 'A', gubun: 'A/S' }    /* 시트 표기 흔들림(공백·점) 흡수 */
  ], base('2026-08-01', '2026-08-09'));
  const tr = D.buildMonthTrend();
  ck('3. 최근 6개월 구간 = 3~8월', tr.length === 6 && tr[0].m === 3 && tr[5].m === 8);
  ck('3-b. 처리일로 월 분류 (8월1 · 7월1 · 6월1 · 5월1 · 3월1)',
    monthOf(tr, 8).n === 1 && monthOf(tr, 7).n === 1 && monthOf(tr, 6).n === 1 &&
    monthOf(tr, 5).n === 1 && monthOf(tr, 3).n === 1);
  ck('3-c. 6개월 창 밖(2월) 기록은 빠진다', tr.reduce((a, t) => a + t.n, 0) === 5);
  ck('3-d. 지난 달은 1일~말일 전체', D.ymd(monthOf(tr, 7).to) === '2026-07-31');
  ck('3-e. 현재 월은 1일~기준일까지만', D.ymd(monthOf(tr, 8).to) === '2026-08-09' && monthOf(tr, 8).cur === true);
}

/* ══════ 4. 전월 동기간 비교 (8/1~8/9 vs 7/1~7/9) ══════ */
{
  load([
    /* 8월 1~9일: A/S 6 · 점검 3 = 9건 */
    ...Array.from({ length: 6 }, (_, i) => ({ date: '2026-08-0' + (i + 1), hosp: 'A', gubun: 'A/S' })),
    ...Array.from({ length: 3 }, (_, i) => ({ date: '2026-08-0' + (i + 1), hosp: 'B', gubun: '점검' })),
    /* 7월 1~9일: A/S 2 · 점검 2 = 4건 */
    { date: '2026-07-02', hosp: 'A', gubun: 'A/S' }, { date: '2026-07-03', hosp: 'A', gubun: 'A/S' },
    { date: '2026-07-04', hosp: 'B', gubun: '점검' }, { date: '2026-07-09', hosp: 'B', gubun: '점검' },
    /* 7월 10일 이후 — 동기간 비교에 들어가면 안 된다 */
    { date: '2026-07-20', hosp: 'A', gubun: 'A/S' }, { date: '2026-07-28', hosp: 'A', gubun: 'A/S' }
  ], base('2026-08-01', '2026-08-09'));
  const tr = D.buildMonthTrend(), mc = D.buildMonthTrendCompare(tr);
  ck('4. 전월 동기간 구간 = 7/1~7/9', D.ymd(mc.from) === '2026-07-01' && D.ymd(mc.to) === '2026-07-09');
  ck('4-b. 전월 동기간 4건 (7/10 이후 2건 제외)', mc.prev.n === 4, 'prev=' + mc.prev.n);
  ck('4-c. 이번 달 9건 · 증감 +5건', mc.cur.n === 9 && mc.d.n === 5);
  ck('4-d. 증감률 +125%', mc.pct === 125, 'pct=' + mc.pct);
  ck('4-e. 시리즈별 증감 A/S +4 · 점검 +1', mc.d.as === 4 && mc.d.insp === 1);
  ck('4-f. 전월 전체(월간 막대)는 6건 — 동기간 비교와 다르다', monthOf(tr, 7).n === 6);
}
/* 전월에 같은 일자가 없으면 전월 말일까지 */
{
  load([{ date: '2026-02-28', hosp: 'A', gubun: 'A/S' }], base('2026-03-01', '2026-03-31'));
  const mc = D.buildMonthTrendCompare(D.buildMonthTrend());
  ck('4-g. 기준일 3/31 → 전월 동기간은 2/1~2/28로 클램프',
    D.ymd(mc.to) === '2026-02-28' && mc.clipped === true, 'to=' + D.ymd(mc.to));
}

/* ══════ 5. 전월 처리 건수가 0건인 경우 ══════ */
{
  load([{ date: '2026-08-03', hosp: 'A', gubun: 'A/S' }, { date: '2026-08-04', hosp: 'A', gubun: '점검' }],
    base('2026-08-01', '2026-08-09'));
  const mc = D.buildMonthTrendCompare(D.buildMonthTrend());
  ck('5. 전월 0건 → 증감률은 null (Infinity 아님)', mc.prev.n === 0 && mc.pct === null);
  ck('5-b. 전월 0건이어도 건수 차이는 계산', mc.d.n === 2);
  const tile = D.exMonthCmpTile_(mc);
  ck('5-c. 요약 타일에 %가 없고 "증감률 없음"을 적는다',
    tile.indexOf('%') < 0 && tile.indexOf('증감률 없음') >= 0);
  ck('5-d. Infinity·NaN 문자열이 화면에 나오지 않는다', !/Infinity|NaN/.test(tile));
}

/* ══════ 6. 데모 데이터 제외 ══════ */
{
  load([
    { date: '2026-08-05', hosp: '가나병원', gubun: 'A/S' },
    { date: '2026-08-05', hosp: '데모병원', gubun: 'A/S', detail: '[데모장비] 데모 운영 점검' },
    { date: '2026-08-06', hosp: '가나병원', gubun: '점검', detail: '[ 데모 장비 ] 공백 표기' }
  ], base('2026-08-01', '2026-08-09'));
  const aug = monthOf(D.buildMonthTrend(), 8);
  ck('6. 데모 장비 기록 제외 (대괄호 안팎 공백 허용)', aug.n === 1 && aug.as === 1 && aug.insp === 0,
    'n=' + aug.n);
}
{
  /* 병원명에 "데모"가 들어갔다는 이유만으로 고객 기록을 빼면 안 된다(기존 기준 유지) */
  load([{ date: '2026-08-05', hosp: '데모기념병원', gubun: 'A/S', detail: '노즐 교체' }],
    base('2026-08-01', '2026-08-09'));
  ck('6-b. 병원명에 "데모"만 있는 고객 기록은 제외하지 않는다', monthOf(D.buildMonthTrend(), 8).n === 1);
}

/* ══════ 7. 보고 기준일 변경 시 월 구간 재계산 ══════ */
{
  const rows = [
    { date: '2026-08-05', hosp: 'A', gubun: 'A/S' },
    { date: '2026-05-05', hosp: 'A', gubun: 'A/S' },
    { date: '2026-01-05', hosp: 'A', gubun: '점검' }
  ];
  load(rows, base('2026-08-01', '2026-08-09'));
  const t1 = D.buildMonthTrend();
  load(rows, base('2026-05-01', '2026-05-31'));
  const t2 = D.buildMonthTrend();
  ck('7. 기준일 8/9 → 3~8월 창', t1[0].m === 3 && t1[5].m === 8);
  ck('7-b. 기준일을 5/31로 되돌리면 12~5월 창으로 재계산',
    t2[0].m === 12 && t2[0].y === 2025 && t2[5].m === 5 && t2[5].y === 2026);
  ck('7-c. 과거 기준일에서는 그 시점의 1월 기록이 창 안에 들어온다', monthOf(t2, 1).n === 1);
  ck('7-d. 과거 기준일에서는 미래(8월) 기록이 집계되지 않는다', t2.reduce((a, t) => a + t.n, 0) === 2);
  /* 연도 경계를 넘는 6개월 창의 라벨이 어긋나지 않아야 한다 */
  ck('7-e. 연말 경계 라벨 (2025-12 ~ 2026-05)',
    t2.map(t => t.y + '-' + t.m).join(' ') === '2025-12 2026-1 2026-2 2026-3 2026-4 2026-5');
}
/* 기간을 지정하지 않으면 오늘로 떨어진다 */
{
  load([], {});
  const t = D.buildMonthTrend(), now = new Date();
  ck('7-f. 기간 미지정 시 기준일 = 오늘', t[5].m === now.getMonth() + 1 && t[5].y === now.getFullYear());
}

/* ══════ 8. 필터 변경 시 요약·그래프가 같은 집계를 쓴다 ══════ */
{
  const rows = [
    { date: '2026-08-05', hosp: 'A', gubun: 'A/S', fse: '김프로', type: '노즐막힘' },
    { date: '2026-08-06', hosp: 'B', gubun: 'A/S', fse: '이프로', type: '누수' },
    { date: '2026-07-05', hosp: 'A', gubun: 'A/S', fse: '김프로', type: '노즐막힘' }
  ];
  load(rows, base('2026-08-01', '2026-08-09'));
  const all = D.buildMonthTrend(), allC = D.buildMonthTrendCompare(all);
  load(rows, Object.assign(base('2026-08-01', '2026-08-09'), { fse: ['김프로'] }));
  const one = D.buildMonthTrend(), oneC = D.buildMonthTrendCompare(one);
  ck('8. 담당자 필터 없음 → 8월 2건 / 전월 동기간 1건', monthOf(all, 8).n === 2 && allC.prev.n === 1);
  ck('8-b. 담당자 필터 적용 → 8월 1건 (그래프 갱신)', monthOf(one, 8).n === 1);
  ck('8-c. 같은 필터가 전월 동기간 비교에도 적용된다 (요약 갱신)', oneC.prev.n === 1 && oneC.d.n === 0);
  /* 렌더 본문도 같은 집계에서 나온다 */
  const body = D.exMonthTrendBody_(one, oneC);
  ck('8-d. 카드 본문 수치가 집계와 일치', body.indexOf('>1건<') >= 0);
  /* 기간 필터(F.from/to)는 추이 집계를 좁히지 않는다 — 기준일로만 쓴다 */
  ck('8-e. 선택 기간 밖(7월) 기록도 추이에는 남는다', monthOf(all, 7).n === 1);
}

/* ══════ 9. 데이터가 없을 때 빈 상태 표시 ══════ */
{
  load([], base('2026-08-01', '2026-08-09'));
  const tr = D.buildMonthTrend(), mc = D.buildMonthTrendCompare(tr);
  const body = D.exMonthTrendBody_(tr, mc);
  ck('9. 0건이면 빈 상태 문구', body.indexOf('ex-empty') >= 0 && body.indexOf('처리 기록 없음') >= 0);
  ck('9-b. 빈 상태에서는 막대를 그리지 않는다', body.indexOf('ex-mchart') < 0);
  ck('9-c. 0건이어도 예외 없이 비교 객체는 만들어진다', mc && mc.cur.n === 0 && mc.pct === null);
  ck('9-d. 0건이면 특이사항 문장을 만들지 않는다', D.exMonthTrendNote_(mc) === null);
}

/* ══════ 10. 특이사항 자동 생성 조건 ══════ */
const noteFor = (cur, prev) => D.exMonthTrendNote_({
  month: 8, cur: cur, prev: prev, from: new Date(2026, 6, 1), to: new Date(2026, 6, 9), day: 9, clipped: false,
  d: { n: cur.n - prev.n, as: cur.as - prev.as, insp: cur.insp - prev.insp },
  pct: prev.n > 0 ? Math.round((cur.n - prev.n) / prev.n * 100) : null
});
{
  const n1 = noteFor({ n: 9, as: 6, insp: 3 }, { n: 4, as: 2, insp: 2 });
  ck('10. 5건 증가 → 특이사항 생성', !!n1);
  ck('10-b. 예시 문구 형식 일치',
    n1 === '8월 A/S·점검 처리는 전월 동기간 대비 <b class="ex-up">5건 증가</b>했습니다. A/S 4건, 점검 1건 증가했습니다.',
    n1);
  ck('10-c. 3건 차이(6.0%)는 조건 미달 → 생성 안 함',
    noteFor({ n: 53, as: 30, insp: 23 }, { n: 50, as: 30, insp: 20 }) === null);
  ck('10-d. 건수 차이는 4건이어도 증감률 20% 이상이면 생성',
    !!noteFor({ n: 14, as: 8, insp: 6 }, { n: 10, as: 6, insp: 4 }));
  ck('10-e. 감소도 생성 · 감소 문구', /6건 감소/.test(noteFor({ n: 4, as: 2, insp: 2 }, { n: 10, as: 6, insp: 4 }) || ''));
  ck('10-f. 전월 0건이어도 5건 이상이면 생성(증감률 없이)',
    !!noteFor({ n: 6, as: 6, insp: 0 }, { n: 0, as: 0, insp: 0 }));
  ck('10-g. 비교 대상 데이터가 아예 없으면 생성 안 함',
    noteFor({ n: 0, as: 0, insp: 0 }, { n: 0, as: 0, insp: 0 }) === null);
  ck('10-h. 증가·감소가 섞이면 각각 표기',
    /A\/S 6건 증가, 점검 1건 감소했습니다\./.test(noteFor({ n: 10, as: 8, insp: 2 }, { n: 5, as: 2, insp: 3 }) || ''));
}

/* ══════ 렌더 결과 검증 (Window/Mobile·다크모드는 CSS 변수·클래스로 확인) ══════ */
{
  load([
    { date: '2026-08-05', hosp: 'A', gubun: 'A/S' }, { date: '2026-08-06', hosp: 'A', gubun: 'A/S' },
    { date: '2026-08-06', hosp: 'B', gubun: '점검' },
    { date: '2026-07-05', hosp: 'A', gubun: 'A/S' }
  ], base('2026-08-01', '2026-08-09'));
  const tr = D.buildMonthTrend(), mc = D.buildMonthTrendCompare(tr);
  const body = D.exMonthTrendBody_(tr, mc);
  ck('R1. 최근 6개월 묶음 막대 = 6열', (body.match(/class="ex-mcol/g) || []).length === 6);
  ck('R2. 각 열에 A/S·점검 두 막대', (body.match(/class="ex-mbar as"/g) || []).length === 6 &&
    (body.match(/class="ex-mbar insp"/g) || []).length === 6);
  ck('R3. 현재 월에 "진행 중" 표시', body.indexOf('ex-mnow">진행 중') >= 0 &&
    (body.match(/ex-mnow/g) || []).length === 1);
  ck('R4. 월 합계 표시', body.indexOf('ex-mtot') >= 0);
  ck('R5. 툴팁·aria에 A/S·점검·합계를 모두 적는다',
    /aria-label="2026년 8월 · A\/S 2건 · 점검 1건 · 합계 3건 · 8\.1~8\.9 \(진행 중\)"/.test(body));
  ck('R6. 상단 요약 4종', /이번 달 총 처리/.test(body) && /A\/S 처리/.test(body) &&
    /점검 처리/.test(body) && /전월 동기간 대비/.test(body));
  ck('R7. 고정 색상 없이 기존 토큰만 사용(인라인 색 없음)', !/style="[^"]*(#|rgb)/.test(body));
}
/* 스타일·마크업이 기존 토큰/레이아웃 규칙을 지키는지 원문에서 확인 */
{
  ck('S1. A/S 네이비 · 점검 청록 토큰 재사용',
    /\.ex-mbar\.as \.b\{background:var\(--navy\)\}/.test(SRC) &&
    /\.ex-mbar\.insp \.b\{background:var\(--teal\)\}/.test(SRC));
  ck('S2. "진행 중" 표식도 기존 변수(--amber) 사용', /\.ex-mnow\{[^}]*var\(--amber\)/.test(SRC));
  ck('S3. 새 카드 CSS에 하드코딩 색이 없다',
    !/\.ex-m(trend|sum|legend|chart|col|tot|bars|bar|now)[^{]*\{[^}]*#[0-9A-Fa-f]{3,6}/.test(SRC));
  ck('S4. 좁은 화면(Window/Mobile 토글·모바일) 대응 규칙 존재',
    /body\.ex-narrow \.ex-mchart\{height:150px/.test(SRC) &&
    /body\.ex-narrow \.ex-msum\{grid-template-columns:repeat\(2/.test(SRC));
  ck('S5. 카드 DOM 이 주간 핵심보고 탭에 있다',
    /<section class="ex-pane on" id="exPaneSummary">[\s\S]*?id="exMonthTrendCard"[\s\S]*?<\/section>/.test(SRC));
  ck('S6. 다크모드는 body.dark 가 토큰을 바꿔 그대로 반영된다',
    /body\.dark\{[\s\S]*?--navy:#5E82C8[\s\S]*?--teal:#54AAD0[\s\S]*?--amber:#D9A93F/.test(SRC));
}

/* ══════ 기존 기능 유지 회귀 ══════ */
{
  load([
    { date: '2026-08-05', hosp: 'A', gubun: 'A/S' },      /* 수요일 */
    { date: '2026-08-08', hosp: 'A', gubun: '점검' },      /* 토요일 — 8주 추이는 월~금만 */
    { date: '2026-08-06', hosp: 'B', gubun: '점검' }
  ], base('2026-08-03', '2026-08-09'));
  const wt = D.buildWeekTrend();
  ck('K1. 8주 서비스 추이 유지 (8주 · 월~금 · 처리일 기준)',
    wt.length === 8 && wt[7].as === 1 && wt[7].insp === 1 && wt[7].n === 2);
  ck('K2. 8주 추이도 같은 기준일(F.to)을 쓴다', D.ymd(wt[7].mon) === '2026-08-03');
  /* 두 카드는 같은 처리 기록을 쓰지만 기간 단위가 다르다 —
     8주 추이는 보고 기준과 같은 월~금만, 월별 추이는 그 달 전체(주말 포함)를 본다. */
  ck('K3. 월별 추이는 8주 추이가 뺀 토요일 기록까지 포함해 3건',
    monthOf(D.buildMonthTrend(), 8).n === 3);
}
{
  /* PPT 생성 코드는 이 변경에서 손대지 않았다 */
  ck('K4. 주간 PPT 생성부(buildWeekData/genWeekly) 그대로 존재',
    /function buildWeekData\(/.test(SRC) && /function gubunRows\(/.test(SRC));
  ck('K5. 월간 PPT 생성부(buildMonthData) 그대로 존재 — 새 buildMonthTrend 와 별개',
    /function buildMonthData\(m0, scope, manualDetail, trendMode\)\{/.test(SRC));
  ck('K6. "이전 대비 증가한 유형" 카드 유지', /id="exVocUpCard"/.test(SRC) && /VOC 유형 변화/.test(SRC));
  ck('K7. 8주 카드 색(A/S 빨강·점검 청록) 그대로 — 새 카드와 구분',
    /\.ex-vbar\.as \.b\{background:var\(--red\)\}/.test(SRC) &&
    /\.ex-vbar\.insp \.b\{background:var\(--teal\)\}/.test(SRC));
  ck('K8. 데모 제외 기준(isDemoRecord) 재사용 — 새 판정 로직 없음',
    (SRC.match(/var DEMO_MARK=/g) || []).length === 1);
}

console.log(`\n===== 월별 처리 추이 회귀 결과: ${pass}/${total} 통과 =====`);
if (fails.length) { console.log('실패:'); fails.forEach(f => console.log('  -', f)); }
process.exit(pass === total ? 0 : 1);
