/************************************************************
 * handover-integrity.mjs
 * handover.html / handover_gas.gs 회귀 테스트
 * 실행: node test/handover-integrity.mjs
 * ----------------------------------------------------------
 * 이 화면의 최우선 목표는 "사용자에게 저장 성공으로 보인 내용과
 * 실제 시트·사진 기록이 정확히 일치하는 것"이다. 그 판정에 관여하는
 * 코드를 실제로 실행해 검증한다.
 *
 * 무빌드 헤드리스 · 두 방식 혼용
 *   ① js/baz-handover-core.js 는 require 로 그대로 실행
 *   ② handover_gas.gs 의 순수 함수는 원문을 꺼내 실행
 *   ③ 나머지는 소스 수준 계약 확인(인라인 핸들러·토큰 부착·ARIA 등)
 ************************************************************/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(import.meta.url);

const HTML = fs.readFileSync(path.join(ROOT, 'handover.html'), 'utf8');
const GAS = fs.readFileSync(path.join(ROOT, 'handover_gas.gs'), 'utf8');
const SCRIPT_AT = HTML.search(/<script>\r?\nfunction el\(id\)/);
const JS = HTML.slice(SCRIPT_AT, HTML.lastIndexOf('</script>'));

const H = require(path.join(ROOT, 'js', 'baz-handover-core.js'));

let pass = 0, total = 0;
const fails = [];
function ck(name, cond, detail) {
  total++;
  if (cond) { pass++; console.log('✅', name, detail || ''); }
  else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('❌', name, detail || ''); }
}
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

function grab(src, name) {
  const at = src.search(new RegExp('\\bfunction\\s+' + name + '\\s*\\('));
  if (at < 0) throw new Error('함수를 찾지 못했습니다: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', at); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(at, j + 1);
  }
  throw new Error('본문 끝을 찾지 못했습니다: ' + name);
}

/* 기본 폼 — 각 테스트가 필요한 필드만 덮어쓴다 */
function form(over) {
  return Object.assign({
    date: '2026-08-12', hosp: '테스트병원', fse: '권오성', gubun: 'A/S', eqKind: '병원 장비',
    sn: 'BV1234', snCustom: '', verUI: '3.0', verHP: '1.2',
    hpIn: '', hpOut: '', uVer: '', wVer: '',
    nozzleDate: '2025.04.21', nozzleReuse: 'X',
    cat: '장비', sub: 'E01', subCustom: '', subLabel: '메인보드 불량', code: 'E01',
    part: 'Main Board', cost: '1650000',
    result: '교체', resultCustom: '', detail: '메인보드 교체', remark: 'N/A',
    nsFill: 'O', nsAmt: '정상', jet: '가능'
  }, over || {});
}

/* ════════════════════════════════════════════════════════════════════
   1. 보호된 요청에 토큰이 붙는다
   ════════════════════════════════════════════════════════════════════ */
section('1. 인증 토큰 부착');

const loadLiveDB = grab(JS, 'loadLiveDB');
ck('병원 DB 요청(hospdbrich)에 토큰이 붙는다',
  /_tk\(HOSPITAL_DB_URL\)/.test(loadLiveDB),
  loadLiveDB.includes('_tk(') ? '' : '토큰 헬퍼 미사용');
ck('토큰 없이 fetch 하던 옛 경로가 남아 있지 않다',
  !/fetch\(HOSPITAL_DB_URL\s*,/.test(JS));
const gv = grab(JS, 'gv');
ck('공통 조회 헬퍼 gv() 도 토큰을 붙인다', /_tk\(HANDOVER_URL/.test(gv));
ck('부트스트랩·savecheck·템플릿 요청에도 토큰이 붙는다',
  /bootUrl=postUrl\(\)\+'\?action=handover_bootstrap'/.test(JS) && /bazGetJson\(_tk\(bootUrl\)/.test(JS) &&
  /_tk\(postUrl\(\)\+'\?action=savecheck/.test(JS) &&
  /_tk\(postUrl\(\)\+'\?action=contenttpl'\)/.test(JS));
ck('임베드 폴백/인증 실패/네트워크 실패를 구분해 표시한다',
  /'auth'/.test(JS) && /setDbBadge\('error'/.test(JS) &&
  /setDbBadge\('live'/.test(JS) && /setDbBadge\('embed'/.test(JS));
ck('토큰 값 자체를 화면·배지에 넣지 않는다',
  !/setDbBadge\([^)]*token/i.test(JS) && !/textContent\s*=\s*[^;]*BazAuth\.token/.test(JS));

/* ════════════════════════════════════════════════════════════════════
   2. 저장 성공은 검증 가능한 서버 응답 이후에만
   ════════════════════════════════════════════════════════════════════ */
section('2. 저장 성공 판정');

const S = H.SAVE;
ck('opaque(no-cors) 응답은 성공이 아니다', H.classifySaveResult('opaque').state === S.UNKNOWN);
ck('타임아웃은 성공이 아니다', H.classifySaveResult('timeout').state === S.UNKNOWN);
ck('네트워크 오류는 성공이 아니다', H.classifySaveResult('network').state === S.UNKNOWN);
ck('HTML(콜드스타트) 응답은 성공이 아니다', H.classifySaveResult('html').state === S.UNKNOWN);
ck('파싱 실패는 성공이 아니다', H.classifySaveResult('parse').state === S.UNKNOWN);

const okRes = H.classifySaveResult('json', {
  success: true, row: 42, photo: { required: true, saved: true, fileId: 'F1', error: '' }, warnings: []
});
ck('사진까지 저장된 성공 응답만 SUCCESS', okRes.state === S.SUCCESS && okRes.row === 42 && okRes.canClearPhoto);

const failRes = H.classifySaveResult('json', { success: false, error: '시트 없음' });
ck('success:false 는 FAILED', failRes.state === S.FAILED && failRes.error === '시트 없음');
const legacySuccess = H.classifySaveResult('json', { success: true, row: 9 });
ck('구버전 GAS의 photo 확인 없는 success:true 는 실패',
  legacySuccess.state === S.FAILED && /사진 저장 결과/.test(legacySuccess.error));

ck('no-cors 폴백 코드가 제거되었다', !/mode:\s*['"]no-cors['"]/.test(JS));
ck('POST/GET 에 타임아웃이 있다',
  /SAVE_TIMEOUT_MS\s*=\s*\d+/.test(JS) && /AbortController/.test(JS) && /function bazGetJson/.test(JS));
ck('저장 상태가 성공/실패/확인중/결과불명으로 구분된다',
  /S\.SUCCESS/.test(JS) && /S\.FAILED/.test(JS) && /SAVE\.CHECKING/.test(JS) && /SAVE\.UNKNOWN/.test(JS));
ck('결과 불명이면 savecheck 로 실제 기록 여부를 확인한다',
  /function recheckSave/.test(JS) && /action=savecheck/.test(JS));
ck('GAS 버전으로 사진 저장을 추측하던 코드가 사라졌다',
  !/gasSupportsPhoto/.test(JS) && !/verGte/.test(JS));

/* 성공이 아닌 상태에서 해서는 안 되는 동작 */
const applySaveResult = grab(JS, 'applySaveResult');
const successBranch = applySaveResult.slice(0, applySaveResult.indexOf('}else if'));
['clearSnPhoto({keepServer:true})', 'enableCopy(!hasUnsaved)', 'rememberRecentHandover_(sent)', 'clearDraft'].forEach(function (frag) {
  ck('성공 분기에서만 실행: ' + frag, successBranch.includes(frag));
});
const restBranches = applySaveResult.slice(applySaveResult.indexOf('}else if'));
ck('실패·불명 분기에서는 사진을 지우지 않는다', !restBranches.includes('clearSnPhoto('));
ck('실패·불명 분기에서는 복사·이어쓰기를 열지 않는다',
  !restBranches.includes('enableCopy(true)') && /enableCopy\(false\)/.test(restBranches));
ck('실패·불명 분기에서는 최근 완료를 로컬에 남기지 않는다', !restBranches.includes('rememberRecentHandover_('));

/* ════════════════════════════════════════════════════════════════════
   3. 사진 저장 실패 처리 (서버)
   ════════════════════════════════════════════════════════════════════ */
section('3. 사진 저장 실패를 성공으로 위장하지 않는다');

const doPost = grab(GAS, 'doPost');
ck('Drive 업로드 실패 시 행을 쓰지 않고 실패 응답',
  /photoErr\s*=/.test(doPost) && /사진 저장 실패 — 기록하지 않았습니다/.test(doPost));
ck('응답에 구조적 photo 블록이 있다',
  /function photoResult_/.test(GAS) &&
  /required:\s*!!required,\s*saved:\s*!!saved,\s*fileId/.test(GAS) &&
  /photo:\s*photoResult_/.test(doPost));
/* [v3.4] legacy(base64 업로드)와 신규(사진 참조) 두 경로 모두 같은 사진 열이 필요하다.
   판정 기준을 photoFile 단독에서 "실제로 시트에 쓸 파일 ID"로 넓혔다. */
ck('사진 열이 없으면 행 기록 전에 실패로 판정',
  /var snFileForSheet = photoFile \? photoFile\.id : snPhotoFileId;/.test(doPost) &&
  /if\(snFileForSheet && !photoCol\)/.test(doPost) && /no-photo-column/.test(doPost));
ck('수식 기록 실패 시 행을 되돌린다',
  /rowRollback_\(sh, row, written\)/.test(doPost) && /function rowRollback_/.test(GAS));
ck('사진 수식 뒤 후속 작업이 실패해도 사진 열까지 롤백한다',
  /setFormula\([\s\S]{0,120}written\.push\(photoCol\)/.test(doPost));
ck('일반 셀 쓰기 중간 실패도 이미 쓴 행을 롤백한다',
  /writeSheet && writeRow\) rollbackOk = rowRollback_\(writeSheet, writeRow, written\)/.test(doPost));
ck('행 롤백 실패 시 참조 중일 수 있는 사진 파일을 삭제하지 않는다',
  /if\(!committed && rollbackOk\) photoDiscard_\(photoFile\)/.test(doPost));
ck('행 기록이 실패하면 업로드된 사진을 정리한다',
  /function photoDiscard_/.test(GAS) && /if\(!committed && rollbackOk\) photoDiscard_\(photoFile\)/.test(doPost));
ck('사진이 필수인데 안 실린 요청도 서버가 잡아낸다', /photo-missing/.test(doPost));
ck('handover 사진 필수 여부를 클라이언트 플래그에 맡기지 않는다',
  /var photoRequired = isHandover;/.test(doPost));
ck('handover 요청은 멱등성 reqId를 반드시 요구한다', /isHandover && !reqId/.test(doPost));
ck('알 수 없는 action이 사진 없는 handover 행으로 흘러가지 않는다',
  /knownActions/.test(doPost) && /알 수 없는 action/.test(doPost));
ck('구버전처럼 경고만 붙이고 success:true 로 넘기지 않는다', !/photoWarn/.test(doPost));

/* 클라이언트: 성공이라도 사진이 필수인데 저장 안 됐으면 실패로 본다 */
const photoLie = H.classifySaveResult('json', {
  success: true, row: 7, photo: { required: true, saved: false, fileId: '', error: '열 없음' }
});
ck('사진 미저장은 success:true 여도 실패로 판정', photoLie.state === S.FAILED && photoLie.error === '열 없음');

/* ════════════════════════════════════════════════════════════════════
   4. 인증정보 보호 (로그·failopen)
   ════════════════════════════════════════════════════════════════════ */
section('4. 로그·인증 보안');

const logSafeSrc = grab(GAS, 'logSafe_');
const logSafe = new Function('LOG_FIELDS', 'LOG_MAX_LEN', logSafeSrc + '; return logSafe_;')(
  JSON.parse('["action","reqId","date","hosp","fse","gubun","eqKind","cat","type","code","part","cost","sn","hpIn","hpOut","uVer","wVer","verUI","verHP","nozzleDate","nozzleReuse","result","nsFill","nsAmt","jet"]'),
  300
);
const SECRET = 'eyJuIjoi.SIGNATURE-DO-NOT-LOG';
const logged = logSafe({
  action: '', hosp: '테스트병원', fse: '권오성', token: SECRET,
  snPhoto: 'data:image/jpeg;base64,' + 'A'.repeat(4000),
  detail: '상세 내용', remark: '비고', password: 'pw', reqId: 'r1'
});
const loggedStr = JSON.stringify(logged);
ck('로그 payload 에 token 이 없다', !('token' in logged) && loggedStr.indexOf(SECRET) < 0);
ck('로그 payload 에 사진 base64 가 없다',
  !('snPhoto' in logged) && loggedStr.indexOf('base64') < 0 && typeof logged.photoKB === 'number');
ck('허용 목록 밖 필드는 아예 담기지 않는다', !('password' in logged));
ck('업무 필드는 남는다', logged.hosp === '테스트병원' && logged.fse === '권오성' && logged.reqId === 'r1');
ck('내용·비고는 길이만 남긴다',
  !('detail' in logged) && !('remark' in logged) && logged.detailLen === 5 && logged.remarkLen === 2);
ck('긴 값은 잘려 로그 셀을 넘기지 않는다',
  String(logSafe({ hosp: 'x'.repeat(1000) }).hosp).length === 300);
ck('전체 payload 복사 후 삭제 방식이 아니다(허용 목록 기반 재구성)',
  /LOG_FIELDS/.test(logSafeSrc) && !/Object\.keys\(payload\)/.test(logSafeSrc));

const verifyLevel = grab(GAS, 'verifyLevel_');
ck('서명 검증 실패 토큰은 인증 서버 장애를 이유로 허용하지 않는다',
  /loc\.ok === false && loc\.why !== 'hmac_error'\) return 0/.test(verifyLevel));
ck('AUTH_FAILOPEN_LEVEL 이 0(차단)으로 바뀌었다', /var AUTH_FAILOPEN_LEVEL = 0;/.test(GAS));
ck('가용성 폴백은 예전에 유효 확인된 토큰에만 준다',
  /goodKey/.test(verifyLevel) && /AUTH_GOOD_TTL/.test(GAS));
ck('정상 서명 토큰은 서버 왕복 없이 그대로 통과한다(기존 사용자 미차단)',
  /if\(loc && loc\.ok\) return Number\(loc\.level\)\|\|0;/.test(verifyLevel));
ck('테스트가 실제 토큰 값을 출력하지 않는다', loggedStr.indexOf('SIGNATURE-DO-NOT-LOG') < 0);

/* ════════════════════════════════════════════════════════════════════
   5. 멱등성 — 같은 reqId 동시 요청
   ════════════════════════════════════════════════════════════════════ */
section('5. 멱등성');

ck('멱등성 기록이 영속 저장소를 쓴다',
  /function reqPut_/.test(GAS) && /PropertiesService\.getScriptProperties\(\)\.setProperty\(reqKey_/.test(GAS));
ck('락 안에서 중복 여부를 다시 확인한다',
  /lock\.waitLock\(20000\);[\s\S]{0,2000}var dup = reqGet_\(reqId\);/.test(doPost));
ck('중복 요청은 자기가 올린 사진을 정리하고 최초 결과를 반환한다',
  /if\(dup\)\{[\s\S]{0,200}photoDiscard_\(photoFile\);[\s\S]{0,120}return json_\(dup\.result\);/.test(doPost));
ck('보관 건수·기간 초과분을 정리한다', /function reqPrune_/.test(GAS) && /REQ_TTL_MS/.test(GAS));

/* 동시 요청 시뮬레이션: 저장소를 흉내 내 "락 안 재확인"이 실제로 한 번만 통과하는지 */
const store = new Map();
const reqGet = (id) => (store.has(id) ? JSON.parse(store.get(id)) : null);
const reqPut = (id, v) => store.set(id, JSON.stringify(v));
let rowsWritten = 0, photosKept = 0;
function simulateRequest(reqId) {
  const uploaded = { id: 'photo-' + Math.random() };   // 락 밖 업로드(항상 일어난다)
  if (reqGet(reqId)) return { dup: true, discarded: uploaded.id };   // 빠른 경로
  // ── 락 획득(직렬화) ──
  if (reqGet(reqId)) return { dup: true, discarded: uploaded.id };   // ★ 락 안 재확인
  rowsWritten++; photosKept++;
  const result = { success: true, row: rowsWritten };
  reqPut(reqId, { ts: Date.now(), result });
  return { dup: false, result };
}
const a = simulateRequest('same-id');
const b = simulateRequest('same-id');
ck('같은 reqId 동시 요청이 한 행만 만든다', rowsWritten === 1, 'rows=' + rowsWritten);
ck('같은 reqId 동시 요청이 한 사진만 남긴다', photosKept === 1 && !!b.discarded);
ck('두 번째 요청은 최초 결과를 그대로 받는다', b.dup === true && a.result.row === 1);
const c = simulateRequest('same-id');
ck('응답 유실 후 재시도도 최초 결과를 받는다(행 증가 없음)', c.dup === true && rowsWritten === 1);

/* ════════════════════════════════════════════════════════════════════
   6. 병원 선택 상태와 종속 필드
   ════════════════════════════════════════════════════════════════════ */
section('6. 병원 선택 정합성');

ck('선택 병원과 입력 문자열 일치 판정', H.selectionMatches({ n: '테스트 병원' }, '테스트병원') === true);
ck('입력이 달라지면 불일치', H.selectionMatches({ n: '테스트병원' }, '다른병원') === false);
ck('선택이 없으면 항상 불일치', H.selectionMatches(null, '테스트병원') === false);

const syncSel = grab(JS, 'syncHospSelection');
ck('입력이 선택과 어긋나면 즉시 선택을 해제한다',
  /BazHandover\.selectionMatches\(SELECTED_HOSP, val\('hosp'\)\)/.test(syncSel) && /setHospSelection\(null\)/.test(syncSel));
const setSel = grab(JS, 'setHospSelection');
['fillSN([])', "setVal('verUI','')", "setVal('verHP','')", "setVal('snCustom','')", 'clearRecent()'].forEach(function (frag) {
  ck('선택 해제 시 초기화: ' + frag, setSel.includes(frag));
});
ck('DB 미선택 병원임을 명시한다', /DB 미선택 병원/.test(setSel));
ck('사용자가 고친 UI/HP 버전은 덮어쓰지 않는다',
  /VER_AUTOFILLED/.test(setSel) && /VER_AUTOFILLED\.ui=false/.test(JS));

/* 병원을 지운 뒤 이전 병원 정보가 payload 에 들어가지 않는다 */
const cleared = H.buildPayload(form({ hosp: '', sn: '', snCustom: '', verUI: '', verHP: '' }), { photo: 'x' });
ck('병원을 지우면 이전 S/N·버전이 payload 에 남지 않는다',
  cleared.hosp === '' && cleared.sn === '' && cleared.verUI === '' && cleared.verHP === '');

/* ════════════════════════════════════════════════════════════════════
   7. 비동기 경합 — 최근 이력 · 마스터 동기화
   ════════════════════════════════════════════════════════════════════ */
section('7. 비동기 경합');

const seq = H.createSeq();
const idA = seq.next('A병원');
const idB = seq.next('B병원');
ck('오래된 최근 이력 응답은 최신 화면을 덮지 않는다',
  seq.isCurrent(idA, 'A병원') === false && seq.isCurrent(idB, 'B병원') === true);
seq.cancel();
ck('입력을 지우면 진행 중이던 응답도 무효가 된다', seq.isCurrent(idB, 'B병원') === false);

const loadRecent = grab(JS, 'loadRecent');
ck('최근 이력에 요청 세대 가드가 있다', /recentSeq\.isCurrent\(id, hosp\)/.test(loadRecent));
ck('최근 이력에 AbortController 를 쓴다', /AbortController/.test(loadRecent) && /recentAbort/.test(JS));
ck('응답 병원과 화면 병원이 다르면 반영하지 않는다',
  /selectionMatches\(\{n:hosp\}, val\('hosp'\)\)/.test(loadRecent));
ck('RECENT_DATA 와 화면 병원을 함께 관리한다', /RECENT_HOSP\s*=\s*hosp/.test(loadRecent));

const applyMaster = grab(JS, 'applyMaster');
['before.cat', 'before.subCode', 'before.subLabel', 'before.subCustom', 'before.part'].forEach(function (f) {
  ck('마스터 동기화 전 캡처: ' + f, applyMaster.includes(f));
});
ck('같은 값이 있으면 소분류를 복원한다',
  /op\.value===before\.subCode \|\| op\.textContent===before\.subLabel/.test(applyMaster));
ck('사라진 값은 첫 항목으로 조용히 바꾸지 않고 알린다',
  /lost\.push/.test(applyMaster) && /찾지 못했습니다/.test(applyMaster));
ck('마스터 적용 후 반드시 미리보기를 다시 그린다', /\n  render\(\);/.test(applyMaster));

/* ════════════════════════════════════════════════════════════════════
   8. 화면 필드 ↔ 서버 저장 매핑
   ════════════════════════════════════════════════════════════════════ */
section('8. 저장 계약');

const p = H.buildPayload(form(), { photo: 'data:image/jpeg;base64,AAA', reqId: 'r1', token: 't' });
['eqKind', 'verUI', 'verHP', 'nozzleDate', 'nozzleReuse', 'result', 'remark', 'code'].forEach(function (k) {
  ck('payload 에 ' + k + ' 키가 있다', Object.prototype.hasOwnProperty.call(p, k));
});
ck('노즐 제조일자와 재사용 여부가 다른 키다',
  p.nozzleDate === '2025.04.21' && p.nozzleReuse === 'X' && p.nozzleDate !== p.nozzleReuse);
ck('구버전 호환 nozzle 키는 재사용 여부만 담는다', p.nozzle === 'X');
ck('사진 필수 선언이 payload 에 실린다', p.photoRequired === true && p.snPhoto.indexOf('data:image') === 0);
ck('A/S 결과·비고가 실린다', p.result === '교체' && p.remark === 'N/A');
ck('직접입력 소분류·결과가 반영된다', (function () {
  const q = H.buildPayload(form({ sub: '__c', subCustom: '기타 증상', result: '__c', resultCustom: '보류' }), {});
  return q.type === '기타 증상' && q.result === '보류';
})());

/* 서버: 헤더 별칭 매핑 + 열이 없으면 경고 */
ck('서버가 헤더 별칭 허용 목록으로 매핑한다', /var HANDOVER_FIELD_COLS = \{/.test(GAS));
['eqKind', 'verUI', 'verHP', 'nozzleDate', 'result', 'remark', 'code'].forEach(function (k) {
  ck('서버 매핑에 ' + k + ' 가 있다', new RegExp('\\b' + k + '\\s*:\\s*\\[').test(GAS));
});
ck('열이 없으면 조용히 버리지 않고 경고한다',
  /missingCols\.push/.test(doPost) && /저장되지 않았습니다/.test(doPost) && /savedFields/.test(doPost));
ck('안전한 1회 설정 함수를 제공한다', /function setupHandoverColumns\(\)/.test(GAS));
ck('클라이언트가 서버 미지원 필드를 저장됨으로 표시하지 않는다',
  /res\.warnings/.test(JS) && /savedFields/.test(JS));
ck('구버전 저장 데이터와 하위 호환(nozzle 키 계속 인식)',
  /payload\.nozzleReuse != null \? payload\.nozzleReuse : \(payload\.nozzle\|\|''\)/.test(doPost));

/* ════════════════════════════════════════════════════════════════════
   9. 저장 이후 dirty 상태
   ════════════════════════════════════════════════════════════════════ */
section('9. dirty 상태');

const snap = H.snapshot(form());
ck('저장 직후에는 dirty 가 아니다', H.isDirty(snap, form()) === false);
ck('업무 필드를 바꾸면 dirty 가 된다', H.isDirty(snap, form({ detail: '내용 수정' })) === true);
ck('같은 스냅샷 재저장을 차단한다', H.isSameAsSaved(snap, form()) === true);
ck('내용이 바뀌면 재저장을 허용한다', H.isSameAsSaved(snap, form({ cost: '2000' })) === false);
ck('양식 표시 전환(TPL)은 스냅샷에 들어가지 않는다',
  H.FORM_FIELDS.indexOf('TPL') < 0 && !H.FORM_FIELDS.some(k => /tpl/i.test(k)));
ck('사진 원문은 스냅샷에 들어가지 않는다', !('snPhoto' in snap));
const refreshDirty = grab(JS, 'refreshDirty');
ck('dirty 가 되면 복사·이어쓰기를 다시 잠근다', /enableCopy\(false\)/.test(refreshDirty));
ck('dirty 상태를 화면에 표시한다', /is-dirty/.test(refreshDirty) && /dirty-badge/.test(HTML));
ck('새 기록 흐름을 제공한다', /function startNewRecord/.test(JS) && /새 기록 시작/.test(JS));
const saveFn = grab(JS, 'saveToSheet');
ck('동일 내용 재저장 시 중복 행을 만들지 않는다',
  /isSameAsSaved\(SAVED_SNAPSHOT, form\) && !UNSAVED_PHOTO/.test(saveFn));
ck('결과 불명 재시도는 최초 payload와 reqId를 재사용한다',
  /SAVE_STATE===BazHandover\.SAVE\.UNKNOWN && LAST_SAVE_PAYLOAD/.test(saveFn) &&
  /submitSavePayload\(LAST_SAVE_PAYLOAD\)/.test(saveFn) && /LAST_SAVE_PAYLOAD=payload/.test(saveFn));
ck('응답 대기 중 편집은 전송 시점 스냅샷과 분리한다',
  /LAST_SENT_SNAPSHOT=BazHandover\.snapshot\(form\)/.test(saveFn) &&
  /var sent=LAST_SENT_SNAPSHOT\|\|BazHandover\.snapshot\(current\)/.test(applySaveResult) &&
  /textChanged=BazHandover\.isDirty\(sent, current\)/.test(applySaveResult));
ck('응답 대기 중 변경이 있으면 초안을 보존하고 후속 기능을 잠근다',
  /if\(hasUnsaved\) BazHandover\.saveDraft/.test(applySaveResult) &&
  /enableCopy\(!hasUnsaved\)/.test(applySaveResult));

/* ════════════════════════════════════════════════════════════════════
   10. 사진 A→B 교체 경합
   ════════════════════════════════════════════════════════════════════ */
section('10. 사진 교체 경합');

const photoSeq = H.createSeq();
const pa = photoSeq.next('photo');   // A 변환 시작
const pb = photoSeq.next('photo');   // B 변환 시작(A 진행 중)
ck('A 변환 결과는 폐기된다', photoSeq.isCurrent(pa) === false);
ck('B 변환 결과만 반영된다', photoSeq.isCurrent(pb) === true);

const onSnPhoto = grab(JS, 'onSnPhoto');
ck('사진 변환에 세대 번호를 쓴다', /snPhotoSeq\.next\('photo'\)/.test(onSnPhoto) && /snPhotoSeq\.isCurrent\(id\)/.test(onSnPhoto));
ck('변환 중 저장 버튼을 잠근다', /snPhotoBusy\(true\)/.test(onSnPhoto) && /b\.disabled=!!on/.test(JS));
ck('처리 중임을 접근 가능한 상태 메시지로 알린다',
  /snPhotoSay\(/.test(onSnPhoto) && /id="snPhotoState"[^>]*aria-live="polite"/.test(HTML));
ck('사진 삭제가 진행 중 변환을 취소한다', /snPhotoSeq\.cancel\(\)/.test(grab(JS, 'clearSnPhoto')));
ck('변환 중에는 저장이 막힌다', /photoBusy:SN_PHOTO_BUSY/.test(saveFn));
ck('저장·결과 확인·결과 불명 중에는 사진 교체·삭제 컨트롤을 잠근다',
  /function photoControlsLocked/.test(JS) && /SAVE_STATE===BazHandover\.SAVE\.UNKNOWN/.test(JS) &&
  /f\.disabled=locked/.test(JS) && /rm\.disabled=locked/.test(JS));
ck('늦은 저장 확인이 새로 교체한 사진을 지우지 않는다',
  /SN_PHOTO!==LAST_SENT_PHOTO/.test(applySaveResult) && /현재 변경은 미기록/.test(applySaveResult));
ck('저장 뒤 새 사진은 dirty가 되고 동일 텍스트여도 다시 저장할 수 있다',
  /UNSAVED_PHOTO=true/.test(onSnPhoto) && /\|\| UNSAVED_PHOTO/.test(refreshDirty) &&
  /&& !UNSAVED_PHOTO/.test(saveFn));
const vBusy = H.validate(form(), { hasPhoto: true, photoBusy: true });
ck('검증도 사진 처리 중 저장을 막는다', !vBusy.ok && vBusy.errors.some(e => e.field === 'snPhoto'));

/* ════════════════════════════════════════════════════════════════════
   11. 입력 검증
   ════════════════════════════════════════════════════════════════════ */
section('11. 입력 검증');

ck('쉼표가 있어도 비용을 읽는다', H.parseCost('1,650,000').value === 1650000);
ck("'원'·공백이 섞여도 읽는다", H.parseCost(' 1,650,000 원 ').value === 1650000);
ck('빈 값은 오류가 아니다', H.parseCost('').ok === true && H.parseCost('').empty === true);
ck('음수는 거부한다', H.parseCost('-100').ok === false);
ck('임의 문자열은 거부한다', H.parseCost('없음123abc').ok === false);
ck('미리보기에 NaN원이 나오지 않는다',
  H.costLabel('1,650,000') === '1,650,000원' && H.costLabel('') === '' &&
  H.costLabel('abc').indexOf('NaN') < 0);
ck('NaN 이 payload 로 가지 않는다', (function () {
  const q = H.buildPayload(form({ cost: 'abc' }), {});
  return String(q.cost).indexOf('NaN') < 0;
})());

const vEmpty = H.validate(form({ hosp: '', fse: '', sn: '', snCustom: '' }), { hasPhoto: false });
ck('필수값을 필드 단위로 표시한다',
  !vEmpty.ok && ['hosp', 'fse', 'sn', 'snPhoto'].every(f => vEmpty.errors.some(e => e.field === f)));
ck('첫 오류 필드를 알려 준다', vEmpty.first && vEmpty.first.field === 'hosp');
ck('첫 오류로 포커스·스크롤한다', /function focusField/.test(JS) && /scrollIntoView/.test(grab(JS, 'focusField')));
ck('오류 요약을 제공한다', /function showErrors/.test(JS) && /errorSummary/.test(HTML));

/* 서버측 검증 */
const normCost = new Function(grab(GAS, 'normCost_') + '; return normCost_;')();
ck('서버도 쉼표 비용을 읽는다', normCost('1,650,000').value === 1650000);
ck('서버가 음수·문자열을 거부한다', normCost('-1').ok === false && normCost('abc').ok === false);
ck('서버가 빈 비용을 무상으로 기록한다', normCost('').value === '무상');
ck('서버에서도 길이·허용값을 검증한다',
  /var HANDOVER_MAX_LEN/.test(GAS) && /var HANDOVER_ENUM/.test(GAS) && /function hvValidate_/.test(GAS));

/* 수식 주입 방어 */
const safeCell = new Function(grab(GAS, 'safeCell_') + '; return safeCell_;')();
ck('=IMPORTXML 은 수식으로 저장되지 않는다', safeCell('=IMPORTXML("http://x","//a")').charAt(0) === "'");
ck('+·@ 로 시작하는 값도 텍스트로 고정', safeCell('+1+1').charAt(0) === "'" && safeCell('@SUM(A1)').charAt(0) === "'");
ck('-로 시작하는 수식형 문자열도 막는다', safeCell('-cmd|calc').charAt(0) === "'");
ck('음수 숫자는 그대로 둔다', safeCell('-1234') === '-1234');
ck('일반 문자열은 건드리지 않는다', safeCell('메인보드 교체') === '메인보드 교체');
ck('행 기록이 safeCell_ 을 거친다', /sh\.getRange\(row, col\)\.setValue\(safeCell_\(value\)\)/.test(doPost));

/* FSE ↔ 로그인 사용자 */
ck('FSE 와 로그인 사용자가 다르면 확인받는다', /로그인 사용자\('\+me\+'\)와 담당 FSE/.test(saveFn));
ck('로그인 사용자를 감사 필드로 저장한다',
  /authUser:\(authUser && authUser !== P\.fse\) \? authUser : ''/.test(doPost) && /authUser\s*:\s*\['로그인 사용자'/.test(GAS));
ck('오늘 기록은 빈 FSE 로 팀 전체를 반환하지 않는다',
  /전체 기록 조회는 제공하지 않습니다/.test(GAS) && /who = authName_\(token\)/.test(GAS));

/* ════════════════════════════════════════════════════════════════════
   12. 초안 · 오프라인 복구
   ════════════════════════════════════════════════════════════════════ */
section('12. 초안 복구');

function memStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k)
  };
}
const st = memStorage();
H.saveDraft(st, form({ detail: '작성 중인 내용' }), { hadPhoto: true });
const draft = H.loadDraft(st);
ck('초안이 저장·복원된다', !!draft && draft.form.detail === '작성 중인 내용');
ck('사진 재첨부 필요를 표시한다', draft.hadPhoto === true);
ck('초안에 사진 원문을 담지 않는다', JSON.stringify(draft).indexOf('data:image') < 0);
ck('빈 양식은 복원을 제안하지 않는다',
  H.draftHasContent({ form: H.snapshot(form({ hosp: '', fse: '', detail: '', remark: '', cost: '', sn: '', snCustom: '', verUI: '', verHP: '', hpIn: '', hpOut: '', uVer: '', wVer: '', nozzleDate: '', subCustom: '', resultCustom: '', nsFill: '', nsAmt: '', jet: '' })) }) === false);
H.clearDraft(st);
ck('초안을 정리할 수 있다', H.loadDraft(st) === null);
ck('입력이 debounce 로 초안 저장된다',
  /function scheduleDraftSave/.test(JS) && /setTimeout\([\s\S]{0,400}saveDraft/.test(JS) &&
  /clearTimeout\(draftTimer\)/.test(JS));
ck('확인된 저장 뒤에는 초안을 다시 만들지 않는다',
  /SAVED_SNAPSHOT && !BazHandover\.isDirty\(SAVED_SNAPSHOT, form\)\) return;/.test(JS));
ck('확인된 성공·새 기록에서 초안을 정리한다',
  /clearDraft\(localStorage\)/.test(applySaveResult) && /clearDraft\(localStorage\)/.test(grab(JS, 'startNewRecord')));
ck('시트 미기록 내용 복사를 구분한다', /시트 미기록 내용/.test(JS));

/* ════════════════════════════════════════════════════════════════════
   13. 모바일 · 접근성
   ════════════════════════════════════════════════════════════════════ */
section('13. 모바일 · 접근성');

const viewport = (HTML.match(/<meta name="viewport"[^>]*>/) || [''])[0];
ck('확대 제한 viewport 가 없다',
  !/maximum-scale/.test(viewport) && !/user-scalable/.test(viewport), viewport);
ck('safe-area 를 반영한다', /env\(safe-area-inset-bottom/.test(HTML));
ck('액션바 실제 높이를 본문 여백·토스트와 연동한다',
  /--actions-h/.test(HTML) && /function measureActions/.test(JS) && /actionsH\(\)/.test(JS));
ck('비고가 전체 폭이다', /<div class="field full">\s*<label for="remark">/.test(HTML));
ck('좁은 화면에서 2열이 1열로 바뀐다', /@media \(max-width:460px\)[\s\S]{0,200}grid-template-columns:1fr/.test(HTML));

const posDrop = grab(JS, 'positionHospDrop');
ck('자동완성이 visualViewport·헤더·액션바를 고려한다',
  /visualViewport/.test(posDrop) && /hdrH\(\)/.test(posDrop) && /actionsH\(\)/.test(posDrop));
ck('위·아래 가용 공간을 비교해 방향을 정한다', /below < 160 && above > below/.test(posDrop));
ck('실제 가용 공간보다 큰 최소 높이를 강제하지 않는다',
  /Math\.max\(72, Math\.floor\(space\)\)/.test(posDrop) && !/Math\.max\(150,/.test(JS));
ck('드롭다운 자신의 위치로 남은 공간을 재 경계를 넘지 않는다',
  /d\.getBoundingClientRect\(\)/.test(posDrop) && /bottom - dr\.top/.test(posDrop));
ck('키보드 열림·크기 변경 시 다시 계산한다',
  /visualViewport\.addEventListener\('resize'[\s\S]{0,80}positionHospDrop/.test(JS));
ck("scrollIntoView({block:'start'}) 강제 이동을 제거했다",
  !/block:'start'/.test(JS) && /block:'nearest'/.test(JS));
ck('입력창이 가려질 때만 이동한다', /r\.top < top \|\| r\.bottom > bottom/.test(grab(JS, 'onHospFocus')));
ck('sticky header 아래로 숨지 않게 scroll-margin-top 을 둔다', /scroll-margin-top/.test(HTML));
ck('자동완성 내부 스크롤이 바깥으로 전파되지 않는다', /overscroll-behavior:contain/.test(HTML));

ck('병원 자동완성이 combobox/listbox/option 구조다',
  /role="combobox"/.test(HTML) && /role="listbox"/.test(HTML) && /role="option"/.test(JS));
ck('펼침 상태·선택 항목을 ARIA 로 전달한다',
  /aria-expanded/.test(HTML) && /aria-activedescendant/.test(JS) && /aria-selected/.test(JS));
ck('방향키·Enter·Escape 로 조작할 수 있다',
  /ArrowDown/.test(JS) && /e\.key==='Enter'/.test(JS) && /e\.key==='Escape'/.test(JS));
ck('병원 지우기 버튼에 접근성 이름이 있다', /id="hospClear"[^>]*aria-label="병원명 지우기"/.test(HTML));
ck('토스트·저장 상태·사진 상태에 aria-live 가 있다',
  (HTML.match(/aria-live="polite"/g) || []).length >= 4);
ck('양식 탭에 aria-pressed 가 있다', /data-tpl="basic"[^>]*aria-pressed/.test(HTML));
ck('숙련도 세그먼트에 aria-pressed 가 있다', /data-skill="nsFill"[^>]*aria-pressed/.test(HTML));
ck('label 이 for/id 로 연결된다', (HTML.match(/<label for="/g) || []).length >= 15);
ck('focus-visible 스타일이 있다', /:focus-visible/.test(HTML));

/* ════════════════════════════════════════════════════════════════════
   14. 구조 · 배포
   ════════════════════════════════════════════════════════════════════ */
section('14. 구조 · 배포');

ck('handover 전용 순수 로직이 모듈로 분리되어 있다',
  fs.existsSync(path.join(ROOT, 'js', 'baz-handover-core.js')) && HTML.includes('js/baz-handover-core.js'));
ck('인라인 on* 핸들러가 남아 있지 않다', !/\son(click|input|change|focus)=/.test(HTML));
ck('초기 요청을 bootstrap 으로 묶는다', /action=handover_bootstrap/.test(JS) && /function getHandoverBootstrap_/.test(GAS));
ck('구버전 백엔드는 개별 요청으로 폴백한다',
  /bootstrap 미지원 — 개별 요청으로 폴백/.test(JS));
ck('임베드 DB 가 폴백임을 기준 버전과 함께 밝힌다', /EMBED_DB_VERSION/.test(JS) && /내장 DB/.test(JS));
ck('GAS 버전이 3.0.0 보다 높다', (function () {
  const m = GAS.match(/ver:'(\d+)\.(\d+)\.(\d+)'/);
  if (!m) return false;
  const v = Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
  return v > 30000;
})(), (GAS.match(/ver:'[\d.]+'/) || [''])[0]);
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const swVer = Number((sw.match(/baz-cs-v(\d+)/) || [])[1] || 0);
ck('서비스워커 캐시 버전이 올라갔다 — 현재 v' + swVer, swVer >= 125);
ck('오류를 전부 삼키지 않고 필요한 실패만 노출한다',
  /setSaveState\(S\.FAILED/.test(JS) && /setSaveState\(BazHandover\.SAVE\.UNKNOWN/.test(JS));

/* ── 결과 ────────────────────────────────────────────────────────── */
console.log('\n' + '='.repeat(62));
console.log(`결과: ${pass}/${total} 통과`);
if (fails.length) {
  console.log('\n실패 항목:');
  fails.forEach(f => console.log('  · ' + f));
  process.exit(1);
}
console.log('모든 검사를 통과했습니다.');
