/************************************************************
 * photo-multi.mjs
 * 다중 사진(장비 S/N + 문제 원인) 등록·조회·출력 회귀 테스트
 * 실행: node test/photo-multi.mjs
 *
 * 정적 문자열 검사만으로는 계약이 지켜지는지 알 수 없는 것들은
 * grab() + new Function 으로 실제 실행해 검증한다.
 ************************************************************/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const read = n => fs.readFileSync(path.join(HERE, '..', n), 'utf8');
const G = read('handover_gas.gs');
const H = read('handover.html');
const L = read('label.html');
const SW = read('sw.js');
const PHOTO_SRC = read('js/baz-photo.js');
const BazPhoto = require_('../js/baz-photo.js');
const BazHandover = require_('../js/baz-handover-core.js');

let pass = 0, total = 0; const fails = [];
function ck(name, cond) { total++; if (cond) { pass++; console.log('✅', name); } else { fails.push(name); console.log('❌', name); } }
function section(t) { console.log('\n── ' + t + ' ──'); }
function grab(src, name) {
  const at = src.search(new RegExp('\\b(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  if (at < 0) throw new Error('함수를 찾지 못했습니다: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', at); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(at, j + 1);
  }
  throw new Error('본문 끝을 찾지 못했습니다: ' + name);
}
const gasFn = (names, ret, inject = {}) => {
  const keys = Object.keys(inject);
  const src = names.map(n => grab(G, n)).join('\n') + '; return ' + ret + ';';
  return new Function(...keys, src)(...keys.map(k => inject[k]));
};

/* ══════════ 1. 사진 시트 구조와 조인 키 ══════════ */
section('사진 시트 구조 · 기록 ID 조인');

ck('메인 시트에는 사진마다 열을 만들지 않고 기록 ID 열 하나만 추가한다',
  /var REC_ID_COLS = \['기록 ID'/.test(G) && /function ensureRecordIdColumn_/.test(G) &&
  !/PHOTO_COLS\.push/.test(G));
ck('현장 사진 시트는 정규화된 11개 열을 쓴다',
  /var SNAP_HEAD = \['기록ID','사진ID','병원명','장비S\/N','사진구분','순번',/.test(G) &&
  /'Drive파일ID','사진설명','등록일시','업로드상태','요청ID'\]/.test(G));
ck('사진 구분은 SN·CAUSE(증상)·AFTER(해결 후) 세 가지를 지원한다',
  /KIND_SN\s*:\s*'SN'/.test(G) && /KIND_CAUSE\s*:\s*'CAUSE'/.test(G) &&
  /KIND_AFTER\s*:\s*'AFTER'/.test(G) && /MAX_AFTER\s*:\s*1/.test(G));
ck('CAUSE 값은 그대로 두고 화면 이름만 증상으로 바꾼다(기존 기록 마이그레이션 없음)',
  /KIND_CAUSE\s*:\s*'CAUSE',\s*\/\* 현장에서 확인한 증상/.test(G) &&
  /MAX_CAUSE\s*:\s*5/.test(G));
ck('시트 생성은 기존 histSheet_ 를 재사용한다(헤더 스키마 자동 마이그레이션)',
  /function photoSheet_\(\)\{ return histSheet_\(SNAP\.SHEET, SNAP_HEAD\); \}/.test(G));
ck('Base64 를 시트 셀에 저장하지 않는다(파일 ID만 기록)',
  !/setValue\([^)]*dataUrl/.test(G) && /Drive파일ID/.test(G));
ck('사용자 입력은 safeCell_ 로 정리해 수식 주입을 막는다',
  /safeCell_\(o\.hosp\|\|''\), safeCell_\(o\.sn\|\|''\)/.test(grab(G, 'photoRowValues_')) &&
  /safeCell_\(o\.desc\|\|''\)/.test(grab(G, 'photoRowValues_')));
ck('신규 구조가 없으면 이해 가능한 오류를 돌려준다',
  /setupPhotoSheet\(\) 를 먼저 실행하세요/.test(G));

/* 메인 시트 기록 ID ↔ 사진 시트 기록 ID 조인 (실제 실행) */
{
  const photoFind = gasFn(['photoFind_'], 'photoFind_');
  const rows = [
    { recordId: 'rec_A', photoId: 'ph_1', fileId: 'F1', status: 'OK' },
    { recordId: 'rec_A', photoId: 'ph_2', fileId: 'F2', status: 'ORPHAN' },
    { recordId: 'rec_B', photoId: 'ph_1', fileId: 'F3', status: 'OK' }
  ];
  ck('조인 실행: 같은 photoId 라도 recordId 가 다르면 다른 사진',
    photoFind(rows, 'rec_A', 'ph_1').fileId === 'F1' &&
    photoFind(rows, 'rec_B', 'ph_1').fileId === 'F3');
  ck('조인 실행: 없는 조합은 null', photoFind(rows, 'rec_C', 'ph_1') === null);
}

/* ══════════ 2. 업로드 멱등성·동시성 ══════════ */
section('photo_add 멱등성 · 동시 요청');

const addSrc = grab(G, 'photoAdd_');
ck('photo_add: 사전 조회 → 락 밖 업로드 → 락 안 재조회(double-check)',
  addSrc.indexOf('photoFind_(photoReadAll_(), recordId, photoId)') <
    addSrc.indexOf('savePhoto_') &&
  addSrc.indexOf('savePhoto_') < addSrc.indexOf('waitLock(15000)') &&
  addSrc.lastIndexOf('photoFind_(photoReadAll_(), recordId, photoId)') > addSrc.indexOf('waitLock(15000)'));
ck('photo_add: 락 안에서 이미 있으면 방금 올린 중복 파일을 회수한다',
  /if\(again\)\{\s*\n?\s*photoDiscard_\(file\);/.test(addSrc));
ck('photo_add: Drive 업로드 전체를 락 안에서 실행하지 않는다',
  addSrc.indexOf('savePhoto_') < addSrc.indexOf('lock.waitLock'));
ck('photo_add: 멱등 키는 clientPhotoId 단독이 아니라 recordId 와의 복합키',
  /rows\[i\]\.recordId===recordId && rows\[i\]\.photoId===photoId/.test(grab(G, 'photoFind_')));
ck('사진 파일명에 사진 ID 를 붙여 동명 충돌을 막는다',
  /safeName_\(\(meta&&meta\.key\)\|\|''\)/.test(grab(G, 'savePhoto_')) &&
  /key:photoId/.test(addSrc));

/* 동시 photo_add 시뮬레이션 — 두 요청이 사전 조회를 모두 통과(둘 다 업로드)한 뒤
   락 안 재조회에서 뒤늦은 쪽이 중복을 발견하는 상황을 실제로 만든다. */
{
  const sheetRows = [];
  let uploaded = 0, discarded = 0, reads = 0;
  const photoFind = gasFn(['photoFind_'], 'photoFind_');
  /* 요청 A 가 읽기 1(사전)·2(락 안)를, 요청 B 가 읽기 3(사전)을 소비하는 동안은 빈 시트 —
     즉 B 의 사전 조회가 A 의 append 보다 먼저 일어난 '진짜 경합' 상황이다.
     읽기 4(B 의 락 안 재조회)부터 A 가 넣은 행이 보인다. */
  const readAll = () => (++reads <= 3 ? [] : sheetRows.slice());
  const mkAdd = () => new Function(
    'photoKeyClean_', 'photoSheetIfReady_', 'photoReadAll_', 'photoFind_', 'savePhoto_',
    'photoDiscard_', 'photoAppend_', 'photoDescClean_', 'LockService', 'Logger', 'SNAP', 'SNAP_ERR_SETUP',
    grab(G, 'photoKindAllowed_') + '\n' + grab(G, 'photoAdd_') + '; return photoAdd_;')(
      s2 => String(s2 || '').replace(/[^A-Za-z0-9_-]/g, ''),
      () => ({}), readAll, photoFind,
      () => { uploaded++; return { id: 'FILE' + uploaded }; },
      () => { discarded++; return true; },
      (sh, o) => sheetRows.push(o),
      s2 => String(s2 || ''),
      { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
      { log: () => {} },
      { KIND_SN: 'SN', KIND_CAUSE: 'CAUSE', KIND_AFTER: 'AFTER', MAX_CAUSE: 5, MAX_AFTER: 1,
        ST_ORPHAN: 'ORPHAN', ST_OK: 'OK' }, 'setup');
  const a = mkAdd()({ recordId: 'rec_1', clientPhotoId: 'ph_1', kind: 'CAUSE', dataUrl: 'd' });
  const b = mkAdd()({ recordId: 'rec_1', clientPhotoId: 'ph_1', kind: 'CAUSE', dataUrl: 'd' });
  ck('동시 photo_add 실행: 두 요청이 모두 업로드해도 시트 행은 1개', uploaded === 2 && sheetRows.length === 1);
  ck('동시 photo_add 실행: 늦은 쪽의 중복 Drive 파일은 회수된다', discarded === 1);
  ck('동시 photo_add 실행: 두 요청이 같은 파일 ID 를 돌려받는다',
    a.success === true && b.success === true && a.fileId === b.fileId && b.dedup === true);

  /* 재전송(순차 재요청)은 업로드조차 하지 않는다 */
  const before = uploaded;
  const again = mkAdd()({ recordId: 'rec_1', clientPhotoId: 'ph_1', kind: 'CAUSE', dataUrl: 'd' });
  ck('재전송 실행: 같은 clientPhotoId 는 Drive 업로드 없이 dedup',
    uploaded === before && again.dedup === true && again.fileId === a.fileId);
}

/* ══════════ 3. 최종 저장 — payload 에 fileId 를 받지 않는다 ══════════ */
section('최종 저장 · 사진 연결');

ck('최종 payload 에 Drive 파일 ID 를 싣지 않는다',
  !/fileId/.test(BazHandover.buildPayload({ hosp: 'H', fse: 'F', sn: 'S' },
    { photos: [{ clientPhotoId: 'x', kind: 'SN', fileId: 'FORGED' }] }).photos[0] &&
    JSON.stringify(BazHandover.buildPayload({ hosp: 'H', fse: 'F', sn: 'S' },
      { photos: [{ clientPhotoId: 'x', kind: 'SN', fileId: 'FORGED' }] }).photos)));
ck('서버는 payload 의 fileId 를 읽지 않고 시트에서 결정한다',
  !/o\.fileId/.test(grab(G, 'hvPhotoRefs_')) &&
  /photoFind_\(rows, recordId, refs\[i\]\.clientPhotoId\)/.test(grab(G, 'hvResolvePhotos_')));

{
  const resolve = gasFn(['hvResolvePhotos_', 'photoFind_', 'photoKindAllowed_'], 'hvResolvePhotos_', {
    photoSheetIfReady_: () => ({}),
    photoReadAll_: () => ([
      { recordId: 'rec_1', photoId: 'sn1', fileId: 'FSN', kind: 'SN', status: 'ORPHAN', at: 't', _row: 2 },
      { recordId: 'rec_1', photoId: 'c1', fileId: 'FC1', kind: 'CAUSE', status: 'ORPHAN', at: 't', _row: 3 },
      { recordId: 'other', photoId: 'x9', fileId: 'FX', kind: 'CAUSE', status: 'ORPHAN', at: 't', _row: 4 }
    ]),
    SNAP: { KIND_SN: 'SN', KIND_CAUSE: 'CAUSE', KIND_AFTER: 'AFTER', MAX_CAUSE: 5, MAX_AFTER: 1,
            ST_ORPHAN: 'ORPHAN', ST_OK: 'OK' },
    SNAP_ERR_SETUP: 'setup'
  });
  const ok = resolve('rec_1', [
    { clientPhotoId: 'sn1', kind: 'SN', seq: 1, desc: '' },
    { clientPhotoId: 'c1', kind: 'CAUSE', seq: 1, desc: '누수' }]);
  ck('연결 실행: fileId 없이 recordId+clientPhotoId 로 파일이 결정된다',
    ok.ok === true && ok.snFileId === 'FSN' && ok.list.length === 2);
  const forged = resolve('rec_1', [
    { clientPhotoId: 'sn1', kind: 'SN', seq: 1 }, { clientPhotoId: 'x9', kind: 'CAUSE', seq: 1 }]);
  ck('연결 실행: 다른 recordId 의 사진은 연결을 거부한다',
    forged.ok === false && /업로드 기록 없음/.test(forged.error));
  const bogus = resolve('rec_1', [{ clientPhotoId: 'NOPE', kind: 'SN', seq: 1 }]);
  ck('연결 실행: 조작된 clientPhotoId 는 거부된다', bogus.ok === false);
  const noSn = resolve('rec_1', [{ clientPhotoId: 'c1', kind: 'CAUSE', seq: 1 }]);
  ck('연결 실행: S/N 사진이 없으면 거부된다',
    noSn.ok === false && /정확히 1장/.test(noSn.error));
  const duplicate = resolve('rec_1', [
    { clientPhotoId: 'sn1', kind: 'SN', seq: 1 }, { clientPhotoId: 'sn1', kind: 'CAUSE', seq: 1 }]);
  ck('연결 실행: 같은 clientPhotoId 중복 참조를 거부한다',
    duplicate.ok === false && /중복 참조/.test(duplicate.error));
  const wrongKind = resolve('rec_1', [
    { clientPhotoId: 'sn1', kind: 'SN', seq: 1 }, { clientPhotoId: 'c1', kind: 'SN', seq: 1 }]);
  ck('연결 실행: 업로드 당시 사진 구분과 다른 참조를 거부한다',
    wrongKind.ok === false && /사진 구분/.test(wrongKind.error));
}

const doPost = grab(G, 'doPost');
ck('S/N 필수 검사가 legacy(base64)와 신규(참조) 두 경로를 모두 허용한다',
  /if\(photoRequired && !usesRefs && !\(payload && payload\.snPhoto\)\)/.test(doPost) &&
  /if\(photoRequired && usesRefs\)/.test(doPost));
ck('신규 경로도 기존 S/N 사진 열에 같은 =IMAGE\\(\\) 수식을 기록한다',
  /var snFileForSheet = photoFile \? photoFile\.id : snPhotoFileId;/.test(doPost) &&
  /setFormula\(photoFormula_\(snFileForSheet\)\)/.test(doPost));
ck('기존 photo.required·saved·fileId 응답 계약을 유지한다',
  /photo: photoResult_\(photoRequired, photoSaved, snFileForSheet\|\|'', ''\)/.test(doPost));
ck('사진 결과는 photos 배열로 추가만 하고 기존 필드를 지우지 않는다',
  /photos: photoLinked, recordId: reqId,/.test(doPost));
ck('기록 ID 는 롤백 대상(put_)으로 메인 시트에 기록한다',
  /if\(recCol && reqId\) put_\(recCol, reqId\);/.test(doPost));
ck('기록 ID 열 누락은 메인 행을 쓰기 전에 거부한다',
  doPost.indexOf("var recCol = colBy_(hdr, REC_ID_COLS)") < doPost.indexOf("var row = lastDataRow_(sh, hdr) + 1"));
ck('사진 메타 연결까지 성공한 뒤에만 행을 최종 확정한다',
  doPost.indexOf('hvCommitPhotos_') < doPost.indexOf('committed = true'));
ck('행 확정 전 실패는 같은 recordId의 재시도를 막는 캐시에 저장하지 않는다',
  (doPost.match(/reqPut_\(reqId/g)||[]).length === 1 &&
  doPost.indexOf('reqPut_(reqId') > doPost.indexOf('var out ='));
ck('클라이언트는 S/N과 원인 사진 참조를 함께 보내고 base64는 최종 payload에서 제외한다',
  /photo:''/.test(H) && /\(snRef\?\[snRef\]:\[\]\)\.concat\(causeRefs\(\)\)/.test(H));
ck('최종 저장 실패 시 사진을 즉시 삭제하지 않는다(ORPHAN 유지 → 재시도 가능)',
  !/photoDiscard_\(linkPhotos/.test(doPost) && /photo-ref-invalid/.test(doPost));
ck('클라이언트는 저장 실패 후에도 같은 recordId 를 유지한다',
  /function resetRecordId\(\)\{ RECORD_ID = ''; \}/.test(H) &&
  /var reqId=recordId\(\);/.test(H) &&
  !/resetRecordId\(\)[\s\S]{0,80}FAILED/.test(H));

/* ══════════ 4. 삭제·교체·고아 정리 ══════════ */
section('삭제 · 교체 · 고아 파일');

ck('photo_abandon 이 존재하고 knownActions 에 등록돼 있다',
  /function photoAbandon_/.test(G) && /'photo_add','photo_abandon'/.test(G));
ck('연결 완료(OK)된 사진은 abandon 으로 지울 수 없다',
  /if\(hit\.status === SNAP\.ST_OK\)\{[\s\S]{0,120}이미 기록에 연결된 사진은 폐기할 수 없습니다/.test(grab(G, 'photoAbandon_')));
ck('사진 삭제 시 클라이언트가 abandon 을 호출한다',
  /action:'photo_abandon'/.test(H) && /function causeRemove/.test(H));
ck('교체는 삭제 후 새 clientPhotoId 를 발급한다',
  /BazPhoto\.newPhotoId\(\)/.test(H));
ck('cleanupOrphanPhotos 가 오래된 ORPHAN 만 정리한다',
  /function cleanupOrphanPhotos\(maxAgeHours\)/.test(G) &&
  /if\(r\.status === SNAP\.ST_OK\)\{ kept\+\+; return; \}/.test(grab(G, 'cleanupOrphanPhotos')));
ck('고아 정리는 아래 행부터 지워 행 번호가 밀리지 않게 한다',
  /sort\(function\(a,b\)\{ return b\._row - a\._row; \}\)/.test(grab(G, 'cleanupOrphanPhotos')));

/* ══════════ 5. 시트 생성 / 백필 분리 ══════════ */
section('초기 설정 · 백필 분리');

ck('setupPhotoSheet 은 시트·열 생성만 하고 백필을 실행하지 않는다',
  /function setupPhotoSheet\(\)/.test(G) &&
  /photoSheet_\(\);/.test(grab(G, 'setupPhotoSheet')) &&
  /ensureRecordIdColumn_\(\)/.test(grab(G, 'setupPhotoSheet')) &&
  !/backfillLegacyPhotos\([0-9]*\)\s*;/.test(grab(G, 'setupPhotoSheet')));
ck('backfillLegacyPhotos 는 배치 크기를 받고 커서를 저장한다',
  /function backfillLegacyPhotos\(batchSize\)/.test(G) &&
  /props\.setProperty\(BACKFILL_CURSOR, String\(end\+1\)\)/.test(G));
ck('백필은 영구 legacy 기록 ID 를 만든다(행 정렬에도 불변)',
  /'LEGACY-' \+ row \+ '-' \+ \(fileId \? fileId\.slice\(0,8\)/.test(G));
ck('백필은 같은 Drive 파일 ID 를 중복 생성하지 않는다',
  /if\(fileId && !photoHasFile_\(known, fileId\)\)/.test(G));
ck('getPhotoMigrationStatus 가 전체·완료·잔여를 보고한다',
  /function getPhotoMigrationStatus\(\)/.test(G) &&
  /remain:Math\.max\(0, total-done\)/.test(G));

/* ══════════ 6. label 조회 성능 ══════════ */
section('label 조회 · 재시도 · lazy loading');

ck('배치 상한이 서버·클라이언트에서 같은 값이다',
  /var SNPHOTO_MAX = 8;/.test(G) && /var PHOTO_BATCH=8;/.test(L));
ck('썸네일은 서버가 Drive 에서 대신 받아 온다',
  /function snPhotoFetchThumbs_/.test(G) && /UrlFetchApp\.fetchAll\(reqs\)/.test(G));
ck('썸네일 응답은 상태코드와 Content-Type 을 확인한다',
  /getResponseCode\(\) !== 200/.test(G) && /ct\.indexOf\('image\/'\) !== 0/.test(G));
ck('썸네일 실패 시 기존 원본 blob 으로 폴백한다',
  /DriveApp\.getFileById\(id\)\.getBlob\(\);\s*\/\* 폴백: 원본 \*\//.test(G));
ck('sz 파라미터가 없으면 기존 응답 계약을 그대로 유지한다',
  /var wantThumb = String\(p\.sz\|\|''\)\.trim\(\) !== '';/.test(G));
ck('실패해도 photoId(fileId)를 지우지 않는다 — 재시도가 가능해야 한다',
  !/rows\[i\]\.photoId = ''/.test(L) && /state='failed'/.test(L));
ck('서버가 알려주는 failed 목록을 실제로 사용한다', /d&&d\.failed/.test(L));
ck('사진 묶음 완료 시 표 전체가 아니라 해당 셀만 갱신한다',
  /function paintPhotoCell/.test(L) &&
  /cell\.innerHTML=photoCellHtml\(rows\[idx\], idx\)/.test(L) &&
  /paintPhotoCell\(Number\(i\)\)/.test(grab(L, 'loadPhotos')) &&
  !/\brender\(\)/.test(grab(L, 'loadPhotos')) &&
  !/innerHTML/.test(grab(L, 'loadPhotos')));
ck('제한 동시 요청으로 배치를 병렬 처리한다',
  /var PHOTO_PARALLEL=3;/.test(L) && /Math\.min\(PHOTO_PARALLEL, batches\.length\)/.test(L));
ck('진행률을 받은 수/전체 수로 표시한다',
  /'사진 '\+\(done\+failed\)\+'\/'\+total\+'장 받는 중…'/.test(L));
ck('IntersectionObserver 로 보이는 사진부터 받는다',
  /new IntersectionObserver/.test(L) && /rootMargin:'200px'/.test(L));
ck('같은 Drive 파일은 캐시에서 재사용한다', /PHOTO_CACHE\[ph\.fileId\]/.test(L));
ck('실패 사진에 재시도 버튼을 제공한다',
  /function retryPhoto/.test(L) && /onclick="retryPhoto\(/.test(L));
ck('실패 사진 한 장 재시도는 다른 미로딩·실패 사진을 함께 요청하지 않는다',
  /targets:\[\{row:rowIdx, pi:photoIdx, ph:ph\}\]/.test(grab(L, 'retryPhoto')));
ck('기존 단일 S/N 데이터도 정상 표시된다(구버전 서버 폴백)',
  /r\.photoId \? \[\{fileId:r\.photoId, kind:'SN', seq:1, desc:''\}\] : \[\]/.test(L));
ck('사진은 S/N · 증상 · 해결 후 3칸 고정으로 표시된다',
  /var PHOTO_SLOTS = \[/.test(L) &&
  /kind:'SN'/.test(L) && /kind:'CAUSE'/.test(L) && /kind:'AFTER'/.test(L) &&
  /class="ph-slots"/.test(L));
ck('예전 기록의 추가 증상 사진도 버리지 않고 보여 준다',
  /cause-thumbs/.test(L) && /row\.causePhotos/.test(L) &&
  /\(row\.causePhotos \|\| \[\]\)\.slice\(1\)/.test(L));
ck('로딩·Excel 순서가 S/N → 증상 → 해결 후 로 서버 정렬과 같다',
  /if\(row\.afterPhoto && row\.afterPhoto\.fileId\) out\.push\(row\.afterPhoto\);/.test(grab(L, 'rowPhotos')) &&
  /function photoKindRank_/.test(G));
ck('labelList_ 가 사진 시트를 한 번만 읽어 recordId 맵으로 만든다',
  /photoMap = photoMapByRecord_\(\)/.test(G) &&
  !/photoReadAll_\(\)[\s\S]{0,200}order\.map/.test(G));
ck('labelList_ 응답이 recordId·photos 를 포함하고 photoId 단수도 유지한다',
  /recordId: recId,/.test(G) && /photos: list/.test(G) && /photoId: \(snHit && snHit\.fileId\)/.test(G));
ck('기록 ID 가 없는 legacy 행은 S/N 파일 ID 로 폴백한다',
  /if\(!list\.length && r\.snPhotoId\)/.test(G));
ck('photolist 는 doGet 로그인 검증 뒤에 라우팅된다',
  grab(G, 'doGet').indexOf("verifyLevel_(p.token||'') < 1") <
    grab(G, 'doGet').indexOf("action==='photolist'"));

/* ══════════ 7. Excel 출력 ══════════ */
section('Excel 동적 사진 열 · 상세 시트');

{
  const src = ['maxCauseCount', 'maxExtraCount', 'asItemText', 'driveViewUrl', 'colLetter_', 'buildLabelSheetPlan']
    .map(n => grab(L, n)).join('\n');
  const P = new Function(src + '; return {plan:buildLabelSheetPlan, col:colLetter_};')();
  /* causes: 증상 사진 설명 배열(첫 장이 '증상', 나머지는 예전 기록의 '추가 증상')
     after : 해결 후 사진 설명(없으면 null) */
  const mk = (hosp, causes, hasSn, after) => ({
    hospital: hosp, sn: 'S-' + hosp, note: '병원 장비', imageDataUrl: null,
    asCat: '장비', asType: '냉각수 누수',
    snPhoto: { fileId: 'F' + hosp, thumbDataUrl: hasSn ? 'data:sn' : null, state: 'ok', desc: '' },
    causePhotos: causes.map((d, i) => ({ fileId: 'C' + hosp + i, thumbDataUrl: 'data:c', seq: i + 1, desc: d, state: 'ok' })),
    afterPhoto: after == null
      ? { fileId: '', thumbDataUrl: null, seq: 1, desc: '', state: 'ok' }
      : { fileId: 'A' + hosp, thumbDataUrl: 'data:a', seq: 1, desc: after, state: 'ok' }
  });

  /* 새 기록만 있는 경우 — 정확히 3장 구성이어야 한다 */
  const fresh = P.plan([mk('N', ['누수'], true, '커넥터 교체')], { date: '2026-08', author: '김' });
  ck('새 기록은 사진 열이 정확히 3개다(S/N · 증상 · 해결 후)',
    fresh.headers.join('|') ===
      'No.|병원명|장비 S/N|A/S 항목|S/N 사진|증상 사진|해결 후 사진|증상 내용|조치 내용|비고',
    fresh.headers.join('|'));
  ck('handover 에서 고른 A/S 항목을 대분류 / 소분류 형태로 싣는다',
    fresh.bodyRows[0].values[fresh.asCol] === '장비 / 냉각수 누수',
    String(fresh.bodyRows[0].values[fresh.asCol]));
  ck('추가 증상 사진 열은 예전 기록이 없으면 아예 생기지 않는다', fresh.maxExtra === 0);
  ck('A/S 항목 열은 장비 S/N 다음, 사진 열 앞에 온다',
    fresh.asCol === 3 && fresh.snCol === 4);
  ck('세 사진이 각자의 열에 배치된다',
    fresh.images.length === 3 &&
    fresh.images.find(im => im.kind === 'SN').col === fresh.snCol &&
    fresh.images.find(im => im.kind === 'CAUSE').col === fresh.causeCol &&
    fresh.images.find(im => im.kind === 'AFTER').col === fresh.afterCol);
  ck('증상 내용과 조치 내용을 각각 다른 열에 쓴다',
    fresh.bodyRows[0].values[fresh.causeTextCol] === '1. 누수' &&
    fresh.bodyRows[0].values[fresh.afterTextCol] === '커넥터 교체');
  ck('사진 상세 시트가 구분을 증상·해결 후로 적는다',
    fresh.detailRows.map(r => r[2]).join('|') === 'S/N|증상|해결 후');

  /* 예전 기록(증상 사진 여러 장)이 섞인 경우 */
  const rows = [mk('A', ['누수', '파손'], true, '패킹 교체'), mk('B', [], true, null),
                mk('C', ['x', 'y', 'z'], true, null)];
  const p = P.plan(rows, { date: '2026-08', author: '김', maxExtra: 4 });

  ck('예전 기록의 추가 증상 사진은 별도 열로 뒤에 붙는다',
    p.headers.join('|') ===
      'No.|병원명|장비 S/N|A/S 항목|S/N 사진|증상 사진|추가 증상 사진 1|추가 증상 사진 2|해결 후 사진|증상 내용|조치 내용|비고',
    p.headers.join('|'));
  ck('추가 증상 사진 개수를 데이터에서 계산한다(증상 첫 장은 제외)', p.maxExtra === 2);
  ck('사진 열 순서: S/N(4) · 증상(5) · 추가(6~) · 해결 후',
    p.snCol === 4 && p.causeCol === 5 && p.extraStart === 6 && p.afterCol === 8);
  ck('모든 행의 열 구조가 동일하다',
    p.bodyRows.every(r => r.values.length === p.headers.length));
  ck('사진이 없는 셀은 공백을 유지한다',
    p.bodyRows[1].values.slice(p.causeCol, p.causeTextCol).every(v => v === ''));
  ck('증상 사진은 첫 장이 고정 열, 나머지가 추가 열로 순서대로 간다',
    p.images.filter(im => im.rowIdx === p.bodyRows[2].rowIdx && im.kind === 'CAUSE')
      .map(im => im.col).join(',') === [p.causeCol, p.extraStart, p.extraStart + 1].join(','));
  ck('증상 내용은 순번에 맞춰 1. 설명 / 2. 설명 형태',
    p.bodyRows[0].values[p.causeTextCol] === '1. 누수 / 2. 파손');
  ck('제목·날짜 병합 범위가 동적 열 수를 따라간다', P.col(p.headers.length) === 'L');
  ck('사진 상세 시트 행을 만든다(원본 링크 포함)',
    p.detailHeaders.join('|') === '병원명|장비 S/N|사진 구분|순번|사진|설명|원본 링크' &&
    p.detailRows.length === 9 &&
    /^https:\/\/drive\.google\.com\/file\/d\/CA0\/view$/.test(p.detailRows[1][6]),
    'detailRows=' + p.detailRows.length);

  const missed = mk('M', ['실패 사진', '정상 사진'], true, null);
  missed.causePhotos[0].thumbDataUrl = null;
  const mp = P.plan([missed], {});
  const secondCause = mp.images.find(im => im.kind === 'CAUSE' && im.seq === 2);
  ck('중간 사진 로딩 실패가 있어도 다음 사진의 상세 행이 밀리지 않는다',
    secondCause && secondCause.detailRowIdx === 4 && mp.detailRows[2][5] === '정상 사진');

  const only = P.plan([mk('Z', [], true, null)], {});
  ck('S/N 사진 1장만 있는 예전 데이터도 같은 3열 구조로 출력된다',
    only.maxExtra === 0 &&
    only.headers.join('|') ===
      'No.|병원명|장비 S/N|A/S 항목|S/N 사진|증상 사진|해결 후 사진|증상 내용|조치 내용|비고' &&
    only.images.length === 1);
  const noAs = P.plan([Object.assign(mk('Q', [], true, null), { asCat: '', asType: '' })], {});
  ck('A/S 항목이 없으면 빈 칸으로 두고 열 구조는 그대로 유지한다',
    noAs.bodyRows[0].values[noAs.asCol] === '' &&
    noAs.bodyRows[0].values.length === noAs.headers.length);
  const typeOnly = P.plan([Object.assign(mk('R', [], true, null), { asCat: '' })], {});
  ck('대분류 없이 소분류만 있으면 소분류만 적는다',
    typeOnly.bodyRows[0].values[typeOnly.asCol] === '냉각수 누수');
}

ck('Excel 출력용 이미지는 600~720px 이내로 만든다',
  /var EXPORT_IMG_PX=720;/.test(L) && /cropToCover\(src, EXPORT_IMG_PX, EXPORT_IMG_PX\)/.test(L) &&
  !/cropToCover\([^)]*1000/.test(L));
ck('같은 사진은 workbook image ID 를 재사용한다(메인·상세 중복 저장 없음)',
  /if\(imgIdCache\[key\] !== undefined\) return imgIdCache\[key\];/.test(L) &&
  /var id2 = await imageIdFor\(im2\.src, im2\.fileId\)/.test(L));
ck('crop 결과도 fileId 기준으로 캐시한다', /cropCache\[key\] \|\| \(cropCache\[key\] =/.test(L));
ck('이미지 가공 동시 실행은 2개로 제한한다',
  /Promise\.all\(\[drainImages\(\), drainImages\(\)\]\)/.test(L));
ck('원본 Drive 링크를 셀 하이퍼링크로 제공한다',
  /hyperlink:driveViewUrl\(im\.fileId\)/.test(L));
ck('lazy loading 된 사진도 Excel 생성 전에 모두 로드한다',
  /await ensureAllPhotosLoadedForExport\(\)/.test(L) &&
  /function ensureAllPhotosLoadedForExport/.test(L));
ck('로드 실패 사진은 조용히 빈 셀로 두지 않고 사용자에게 알린다',
  /function confirmExportWithMissing/.test(L) && /res\.failed\.length\+'곳을 받지 못했습니다/.test(L));
ck('PPT 생성 기능은 유지된다(시트에서 받은 S/N 썸네일도 사용)',
  /async function exportPPT/.test(L) &&
  /var pptImg = row\.imageDataUrl \|\| \(row\.snPhoto && row\.snPhoto\.thumbDataUrl\);/.test(L));
ck('Label 작성 완료 기록(labeldone)이 유지된다',
  /action:'labeldone'/.test(L) && /function markDownloaded/.test(L));
ck('서버가 A/S 대분류·소분류를 labellist 응답에 실어 준다',
  /asCat: r\.cat \|\| '',/.test(G) && /asType: r\.type \|\| '',/.test(G) &&
  /row\.asCat = r\.asCat\|\|''; row\.asType = r\.asType\|\|'';/.test(L));
ck('검색이 A/S 항목까지 훑는다',
  /function searchText/.test(L) &&
  /\[row\.hospital, row\.sn, row\.note, row\.asCat, row\.asType\]/.test(L) &&
  /A\/S 항목 · 비고 검색/.test(L));
ck('A/S 소분류는 표에서 고칠 수 있고 대분류는 시트 값 그대로 둔다',
  /function asCellHtml/.test(L) &&
  /fieldHtml\(idx,'asType'/.test(L) && !/fieldHtml\(idx,'asCat'/.test(L));
ck('직접 입력·붙여넣기·일괄 배치는 S/N 사진에 연결된다',
  /rows\[idx\]\.snPhoto\.thumbDataUrl = resized;/.test(L) &&
  /function applyBulkPhotos/.test(L) && /function handleCellPaste/.test(L));
ck('세 칸 어디에나 직접 첨부·드래그·붙여넣기를 할 수 있다',
  /function setSlotPhoto/.test(L) && /function clearSlotPhoto/.test(L) &&
  /setRowImageFromFile\(idx, file, cell\.getAttribute\('data-slot'\) \|\| 'sn'\)/.test(L));

/* ══════════ 8. 클라이언트 압축·동시성 (실제 실행) ══════════ */
section('압축 기준 · 동시 실행 제한');

ck('S/N 1600px·원인 1280px 기준이 정의돼 있다',
  BazPhoto.PRESET.SN.maxDim === 1600 && BazPhoto.PRESET.CAUSE.maxDim === 1280);
ck('목표 용량: S/N 600~900KB · 원인 400~700KB',
  BazPhoto.PRESET.SN.softBytes === 600 * 1024 && BazPhoto.PRESET.SN.targetBytes === 900 * 1024 &&
  BazPhoto.PRESET.CAUSE.softBytes === 400 * 1024 && BazPhoto.PRESET.CAUSE.targetBytes === 700 * 1024);
{
  const sizes = { 0.90: 1500000, 0.82: 900000, 0.74: 640000, 0.66: 500000, 0.58: 380000 };
  const r = BazPhoto.chooseQuality(q => sizes[q], { targetBytes: 700 * 1024, softBytes: 400 * 1024 });
  ck('압축 실행: 목표를 넘으면 품질을 단계적으로 낮춘다',
    r.quality === 0.74 && r.over === false && r.tried.length === 3);
  const small = BazPhoto.chooseQuality(() => 200000, { targetBytes: 900 * 1024, softBytes: 600 * 1024 });
  ck('압축 실행: 이미 작으면 화질을 깎지 않는다', small.quality === 0.90 && small.tried.length === 1);
  const big = BazPhoto.chooseQuality(() => 5000000, { targetBytes: 700 * 1024, softBytes: 400 * 1024 });
  ck('압축 실행: 최저 품질에도 초과하면 over 로 알린다', big.over === true && big.quality === 0.58);
  ck('압축 실행: 목표 초과 시 해상도를 한 단계 줄인다', BazPhoto.shrinkDim(1280) === 1088);
  ck('압축 실행: 긴 변 기준으로만 축소하고 확대하지 않는다',
    BazPhoto.fitSize(4000, 3000, 1600).w === 1600 && BazPhoto.fitSize(800, 600, 1600).w === 800);
  ck('toBlob·Object URL 로 메모리를 아낀다', /URL\.createObjectURL/.test(read('js/baz-photo.js')));
}
{
  let live = 0, peak = 0;
  const mk = (k, fail) => ({
    key: k, run: () => { live++; peak = Math.max(peak, live);
      return new Promise((res, rej) => setTimeout(() => { live--; fail ? rej(new Error('x')) : res(k); }, 5)); }
  });
  const r1 = await BazPhoto.pool([mk('a'), mk('b'), mk('c', true), mk('d'), mk('e')], { limit: 2 });
  ck('풀 실행: 동시 실행은 2개를 넘지 않는다', peak === 2);
  ck('풀 실행: 실패는 격리되고 나머지는 성공한다',
    Object.keys(r1.errors).join() === 'c' && Object.keys(r1.results).sort().join() === 'a,b,d,e');
  const r2 = await BazPhoto.pool([mk('a'), mk('b'), mk('c'), mk('d'), mk('e')], { limit: 2, done: r1.results });
  ck('풀 실행: 재시도는 실패분만 다시 실행한다(성공분 재전송 없음)',
    r2.ran.join() === 'c' && Object.keys(r2.results).sort().join() === 'a,b,c,d,e');
}

/* ══════════ 9. 기존 계약 보존 ══════════ */
section('기존 기능 보존');

ck('기존 snPhoto(base64) payload 호환을 유지한다',
  /snPhoto: opts\.photo \|\| '',/.test(read('js/baz-handover-core.js')) &&
  /payload\.snPhoto/.test(doPost));
ck('S/N 사진 없이 저장하면 여전히 차단된다',
  BazHandover.validate({ hosp: 'A', fse: 'B', sn: 'C' }, { hasPhoto: false })
    .errors.some(e => e.field === 'snPhoto'));
ck('원인 사진 최대 5장을 클라이언트·서버가 같은 값으로 강제한다',
  BazHandover.MAX_CAUSE_PHOTOS === 5 && /MAX_CAUSE : 5/.test(G) &&
  BazPhoto.MAX_CAUSE === 5);
ck('업로드하지 못한 원인 사진이 있으면 저장을 막는다',
  BazHandover.validate({ hosp: 'A', fse: 'B', sn: 'C' }, { hasPhoto: true, causePending: 1 })
    .errors.some(e => e.field === 'causePhoto'));
ck('저장 완료 전 화면을 닫으면 경고한다',
  /beforeunload/.test(H) && /function hasUnfinishedPhotoWork/.test(H) &&
  /return !!SN_PHOTO \|\| CAUSE_SLOTS\.length>0;/.test(H));
ck('S/N 사진도 개별 압축·업로드 후 참조로 최종 저장한다',
  /BazPhoto\.compress\(file,\{kind:'SN'\}\)/.test(H) &&
  /uploadPhotoSlot\([^\n]+, 'SN'\)/.test(H) && /function snPhotoRef/.test(H));
ck('브라우저 압축은 실제 canvas.toBlob 경로를 사용한다',
  /canvas\.toBlob\(/.test(PHOTO_SRC) && /function blobDataUrl/.test(PHOTO_SRC));
ck('원인 사진 슬롯마다 상태를 표시한다(압축·업로드·완료·실패·재시도)',
  /압축 중…/.test(H) && /업로드 중…/.test(H) && /'완료'/.test(H) && /재시도/.test(H));
ck('모바일 촬영을 위해 현장 사진에 capture 를 적용한다',
  (H.match(/capture="environment"/g) || []).length === 2);
ck('현장 촬영 화면이 증상·해결 후 두 칸으로 고정된다',
  /var CAUSE_KINDS = \[/.test(H) &&
  /kind:'CAUSE', title:'현장에서 확인한 증상'/.test(H) &&
  /kind:'AFTER', title:'증상 해결 후'/.test(H) &&
  /id="causeFile_CAUSE"/.test(H) && /id="causeFile_AFTER"/.test(H));
ck('한 칸에는 사진 1장만 — 이미 있으면 새로 받지 않는다',
  /if\(causeSlotOf\(kind\)\)\{ toast\('이 칸에는 이미 사진이 있습니다/.test(H));
ck('업로드는 칸의 사진 구분을 그대로 보낸다',
  /uploadPhotoSlot\(slot, slot\.kind\|\|'CAUSE'\)/.test(H) &&
  /kind:s\.kind\|\|'CAUSE', seq:1/.test(H));
ck('사진 공개 범위(ANYONE_WITH_LINK) 주의를 화면과 코드에 남긴다',
  /링크를 아는 사람이 열람할 수 있습니다/.test(H) && /ANYONE_WITH_LINK/.test(G) &&
  /\[보안 주의\]/.test(G));
ck('index.html 은 이번 범위에서 건드리지 않는다',
  !/baz-photo\.js/.test(read('index.html')));
ck('서비스워커 캐시 버전이 136 이상이다',
  Number((SW.match(/baz-cs-v(\d+)/) || [])[1] || 0) >= 136);
ck('GAS 버전이 3.5.1 로 올라갔다', /ver:'3\.5\.1'/.test(G));

console.log('\n──────────────────────────────');
console.log('통과 ' + pass + '/' + total);
if (fails.length) { fails.forEach(f => console.log(' -', f)); process.exit(1); }
console.log('모든 테스트 통과 ✅');
