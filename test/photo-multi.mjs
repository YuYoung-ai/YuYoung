/************************************************************
 * photo-multi.mjs
 * 사진(장비 S/N + 이미 쌓인 현장 사진) 등록·조회·출력 회귀 테스트
 *
 * [v3.9] handover.html 의 '현장 사진(증상·해결 후)' 입력 화면은 전송 데이터 문제로
 * 삭제했다. 서버·리포트(label.html)의 CAUSE/AFTER 계약은 이미 쌓인 기록을 읽기
 * 위해 그대로 살아 있으므로, 그쪽 검사는 그대로 둔다.
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
  addSrc.indexOf('photoFindInSheet_(recordId, photoId)') <
    addSrc.indexOf('savePhoto_') &&
  addSrc.indexOf('savePhoto_') < addSrc.indexOf('waitLock(15000)') &&
  addSrc.lastIndexOf('photoFindInSheet_(recordId, photoId)') > addSrc.indexOf('waitLock(15000)'));
ck('photo_add: 11열 전체 대신 기록ID 1열에서 현재 기록 범위만 찾는다',
  !/photoReadAll_/.test(addSrc) &&
  /getRange\(2,1,last-1,1\)/.test(grab(G, 'photoReadRecord_')) &&
  /getRange\(first,1,end-first\+1,SNAP_HEAD\.length\)/.test(grab(G, 'photoReadRecord_')));
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
  /* 요청 A 가 읽기 1(사전)·2(락 안)를, 요청 B 가 읽기 3(사전)을 소비하는 동안은 빈 시트 —
     즉 B 의 사전 조회가 A 의 append 보다 먼저 일어난 '진짜 경합' 상황이다.
     읽기 4(B 의 락 안 재조회)부터 A 가 넣은 행이 보인다. */
  const findInSheet = (recordId, photoId) => {
    reads++;
    const rows = reads <= 3 ? [] : sheetRows.slice();
    return rows.find(r => r.recordId === recordId && r.photoId === photoId) || null;
  };
  const mkAdd = () => new Function(
    'photoKeyClean_', 'photoSheetIfReady_', 'photoFindInSheet_', 'savePhoto_',
    'photoDiscard_', 'photoAppend_', 'photoDescClean_', 'LockService', 'Logger', 'SNAP', 'SNAP_ERR_SETUP',
    grab(G, 'photoKindAllowed_') + '\n' + grab(G, 'photoAdd_') + '; return photoAdd_;')(
      s2 => String(s2 || '').replace(/[^A-Za-z0-9_-]/g, ''),
      () => ({}), findInSheet,
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
    photoReadRecord_: () => ([
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
ck('사진 3장 상태는 사진별 쓰기가 아니라 한 범위 setValues 로 확정한다',
  /range\.setValues\(after\)/.test(grab(G, 'hvCommitPhotos_')) &&
  !/forEach[\s\S]*sh\.getRange\(it\._row/.test(grab(G, 'hvCommitPhotos_')));
ck('행 확정 전 실패는 같은 recordId의 재시도를 막는 캐시에 저장하지 않는다',
  (doPost.match(/reqPut_\(reqId/g)||[]).length === 1 &&
  doPost.indexOf('reqPut_(reqId') > doPost.indexOf('var out ='));
ck('클라이언트는 S/N 사진 참조만 보내고 base64는 최종 payload에서 제외한다',
  /photo:''/.test(H) && /photos:\(snRef\?\[snRef\]:\[\]\)/.test(H));
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
  /action:'photo_abandon'/.test(H) && /function clearSnPhoto/.test(H) &&
  /abandonPhoto\(oldId\)/.test(grab(H, 'clearSnPhoto')));
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

/* ══════════ 7-B. A/S 항목별 증상·조치 집계 ══════════ */
section('A/S 항목별 증상·조치 (asreport)');

const AS = read('asreport.html');

ck('asreport 는 로그인 검증 뒤에 라우팅된다',
  grab(G, 'doGet').indexOf("verifyLevel_(p.token||'') < 1") <
    grab(G, 'doGet').indexOf("action==='asreport'"));
ck('사례 상한이 있고 잘라낸 건수를 함께 돌려준다',
  /var ASREPORT_MAX_CASES = 50;/.test(G) &&
  /truncated: g\.truncated/.test(G) && /g\.cases\.pop\(\); g\.truncated\+\+;/.test(G));
ck('증상(CAUSE)과 해결 후(AFTER)를 나눠 담는다',
  /if\(ph\.kind === SNAP\.KIND_AFTER\) after\.push\(item\); else symptom\.push\(item\);/.test(G));
ck('유형마스터의 표준 대응을 대분류+유형에 붙인다',
  /guidesByItem\[asItemKey_\(g\.cat, g\.type\)\]/.test(G) && /guidesByItem/.test(grab(G, 'getMaster_')));

/* 집계 실행 — 그룹핑·분포·상한이 실제로 동작하는지 본다 */
{
  const rows = [
    { '처리일':'2026-08-01','병원명':'가','CS 담당자':'권','대분류':'장비','유형':'냉각수 누수',
      '교체품':'호스','내용':'누수','기록 ID':'r1','A/S 결과':'부품 교체' },
    { '처리일':'2026-08-02','병원명':'나','CS 담당자':'권','대분류':'장비','유형':'냉각수 누수',
      '교체품':'호스','내용':'누수2','기록 ID':'r2','A/S 결과':'부품 교체' },
    { '처리일':'2026-08-03','병원명':'가','CS 담당자':'김','대분류':'장비','유형':'냉각수 누수',
      '교체품':'피팅','내용':'누수3','기록 ID':'r3','A/S 결과':'조치 완료' },
    { '처리일':'2026-08-04','병원명':'다','CS 담당자':'김','대분류':'핸드피스','유형':'발열',
      '교체품':'','내용':'발열','기록 ID':'r4','A/S 결과':'이상없음' },
    { '처리일':'2025-01-01','병원명':'라','CS 담당자':'김','대분류':'장비','유형':'냉각수 누수',
      '교체품':'','내용':'기간 밖','기록 ID':'r5','A/S 결과':'' }
  ];
  const photoMap = {
    r1: [{ kind:'SN', seq:1, fileId:'S1', desc:'' },
         { kind:'CAUSE', seq:1, fileId:'C1', desc:'물맺힘' },
         { kind:'AFTER', seq:1, fileId:'A1', desc:'교체 후 정상' }]
  };
  const asReport = gasFn(['asReport_', 'asTally_', 'asItemKey_', 'asCaseLatestFirst_'], 'asReport_', {
    parseD_: s2 => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s2||'').trim());
                     return m ? new Date(+m[1], +m[2]-1, +m[3]) : null; },
    norm_: s2 => String(s2==null?'':s2).replace(/\s+/g,'').toLowerCase(),
    readAll_: () => ({ rows }),
    slim_: o => ({ date:o['처리일'], hosp:o['병원명'], fse:o['CS 담당자'], gubun:o['점검/AS']||'',
                   cat:o['대분류'], type:o['유형'], part:o['교체품'], cost:o['교체비용']||'',
                   detail:o['내용'], sn:o['장비SN']||'', snPhotoId:'' }),
    pickH_: (o, cols) => { for (const c of (cols||[])) if (o[c] != null && o[c] !== '') return o[c]; return ''; },
    photoMapByRecord_: () => photoMap,
    getMaster_: () => ({
      guides: { '냉각수 누수': { chk:'잘못된 공통값', fix:'잘못된 조치', fup:'' } },
      guidesByItem: {
        ['장비\u001f냉각수누수']: { chk:'확인', fix:'호스 교체', fup:'재확인' }
      }
    }),
    REC_ID_COLS: ['기록 ID'],
    HANDOVER_FIELD_COLS: { result:['A/S 결과'], remark:['비고'], code:['유형 코드','코드'] },
    SNAP: { KIND_SN:'SN', KIND_CAUSE:'CAUSE', KIND_AFTER:'AFTER' },
    ASREPORT_MAX_CASES: 50, ASREPORT_MAX_CASES_HARD: 500,
    Logger: { log(){} },
    Utilities: { formatDate: d => [d.getFullYear(),
      String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-') }
  });

  const out = asReport({ from:'2026-07-01', to:'2026-08-31' });
  ck('집계 실행: 기간 밖 기록은 빠진다', out.success === true && out.total === 4);
  ck('집계 실행: 대분류/소분류로 묶고 건수 순으로 정렬한다',
    out.items.map(i => i.cat + '/' + i.type).join('|') === '장비/냉각수 누수|핸드피스/발열',
    out.items.map(i => i.cat + '/' + i.type).join('|'));
  ck('집계 실행: 병원 수는 중복을 뺀 값이다',
    out.items[0].count === 3 && out.items[0].hospCount === 2);
  ck('집계 실행: 교체품·결과 분포를 많은 순으로 센다',
    JSON.stringify(out.items[0].parts) === '[["호스",2],["피팅",1]]' &&
    JSON.stringify(out.items[0].results) === '[["부품 교체",2],["조치 완료",1]]');
  const photographed = out.items[0].cases.find(c => c.recordId === 'r1');
  ck('집계 실행: 증상과 해결 후 사진을 나눠 담는다',
    photographed.symptom.length === 1 && photographed.symptom[0].desc === '물맺힘' &&
    photographed.after.length === 1 && photographed.after[0].desc === '교체 후 정상' &&
    photographed.snPhoto === 'S1');
  ck('집계 실행: 표준 대응(유형마스터)을 붙인다',
    out.items[0].guide && out.items[0].guide.fix === '호스 교체' && out.items[1].guide === null);

  const cut = asReport({ from:'2026-07-01', to:'2026-08-31', maxCases:1 });
  ck('집계 실행: 사례 상한에는 최신 사례를 남기고 잘라낸 수를 알려 준다',
    cut.items[0].cases.length === 1 && cut.items[0].cases[0].date === '2026-08-03' &&
    cut.items[0].truncated === 2 && cut.items[0].count === 3,
    JSON.stringify(cut.items[0].cases));
  const one = asReport({ from:'2026-07-01', to:'2026-08-31', type:'발열' });
  ck('집계 실행: 소분류로 좁혀 조회할 수 있다',
    one.items.length === 1 && one.items[0].type === '발열');
  const byFse = asReport({ from:'2026-07-01', to:'2026-08-31', fse:'권' });
  ck('집계 실행: 담당 FSE 로 좁힐 수 있다', byFse.total === 2);
}

ck('리포트 화면이 증상·조치를 나란히 보여 준다',
  /class="pane sym"/.test(AS) && /class="pane act"/.test(AS) &&
  /현장에서 확인한 증상/.test(AS) && /조치 · 해결/.test(AS));
ck('asreport는 PC·모바일 보기 전환을 제공하고 선택을 기억한다',
  /id="viewPc"/.test(AS) && /id="viewMobile"/.test(AS) &&
  /function setViewMode/.test(AS) && /baz_asreport_view_mode/.test(AS));
ck('asreport 모바일 보기는 유형 가로 선택줄·증상/조치 1열을 쓴다',
  /body\.view-mobile \.tlist\{[^}]*display:flex/.test(AS) &&
  /body\.view-mobile \.pair\{grid-template-columns:1fr\}/.test(AS));
ck('asreport PC 보기는 기존 넓은 2단 리포트를 기본으로 유지한다',
  /\.wrap\{max-width:1320px/.test(AS) &&
  /\.split\{display:grid;grid-template-columns:minmax\(260px,340px\) 1fr/.test(AS));
ck('엑셀은 요약·사례 두 시트로 나간다',
  /addWorksheet\('A\/S 항목 요약'\)/.test(AS) && /addWorksheet\('증상·조치 사례'\)/.test(AS) &&
  /function buildAsReportPlan/.test(AS));
ck('보고서용 텍스트를 클립보드로 복사할 수 있다',
  /function reportText/.test(AS) && /navigator\.clipboard\.writeText/.test(AS));
ck('상한으로 잘린 사실을 화면과 텍스트 양쪽에서 알린다',
  /조회 상한으로 생략됨/.test(AS) && /사례 '\+it\.truncated\+'건 생략/.test(AS));
ck('엑셀 요약에도 내보낸 사례와 조회 상한 생략 수를 적는다',
  /'내보낸 사례','조회 상한 생략'/.test(AS));
ck('허브 메뉴에 A/S 항목별 타일이 있다',
  /id="appBtnAsReport"/.test(read('index.html')) &&
  /asreport:\s*\{name:/.test(read('index.html')));

/* ══════════ 7-C. 사진 설명 자주 쓰는 문구 ══════════ */
section('자주 쓰는 문구 · 관리자 검수');

ck('문구 시트는 구분·문구·대분류·유형·순서·사용 6열이다',
  /var PHRASE_HEAD = \['구분','문구','대분류','유형','순서','사용'\];/.test(G));
ck('문구 저장은 Lv.3 토큰을 요구한다',
  /function photoPhraseSave_/.test(G) &&
  /verifyLevel_\(p\.token\|\|''\);\s*\n\s*if\(lv < 3\)/.test(grab(G, 'photoPhraseSave_')));
ck('문구 조회는 로그인만 되면 가능하다(입력 보조)',
  grab(G, 'doGet').indexOf("verifyLevel_(p.token||'') < 1") <
    grab(G, 'doGet').indexOf("action==='photophrase'"));
ck('POST 허용 목록에 photophrase_save 가 등록돼 있다',
  /'photophrase_save'\]/.test(G) &&
  /payload\.action==='photophrase_save'/.test(G));
ck('문구는 시트 수식 주입을 막고 길이를 자른다',
  /safeCell_\(String\(r\.text==null\?'':r\.text\)/.test(G) &&
  /slice\(0, PHRASE\.MAX_LEN\)/.test(G));

/* 저장 정규화 실행 — 중복·빈칸·사용여부가 시트 행으로 어떻게 떨어지는지 */
{
  const saved = [];
  const save = new Function(
    'verifyLevel_', 'MENU', 'PHRASE', 'PHRASE_HEAD', 'safeCell_', 'sheet_', 'ss_', 'Utilities',
    grab(G, 'phraseKind_') + '\n' + grab(G, 'phraseKindLabel_') + '\n' +
    grab(G, 'photoPhraseSave_') + '; return photoPhraseSave_;')(
      () => 3, { AUTH_VERIFY_URL: 'x' },
      { SHEET: '사진문구', MAX: 200, MAX_LEN: 100 },
      ['구분', '문구', '대분류', '유형', '순서', '사용'],
      v => String(v == null ? '' : v),
      () => ({ clearContents(){}, getRange: (r, c, nr, nc) => ({ setValues(v){ saved.push({ r, v }); } }) }),
      () => ({ insertSheet(){ return null; } }),
      { formatDate: () => '2026-08-15 00:00' });

  const out = save({ token: 't', rows: [
    { kind: 'CAUSE', text: '호스 연결부 물맺힘', cat: '장비', type: '냉각수 누수', order: 1, on: true },
    { kind: 'AFTER', text: '부품 교체 후 정상', on: true },
    { kind: 'CAUSE', text: '호스 연결부  물맺힘', on: true },   /* 공백만 다른 중복 */
    { kind: 'CAUSE', text: '   ', on: true },                   /* 빈 문구 */
    { kind: 'CAUSE', text: '보류 문구', on: false }
  ]});
  const body = saved.find(x => x.r === 2);
  ck('문구 저장 실행: 중복·빈칸을 접고 개수를 알려 준다',
    out.success === true && out.count === 3 && out.skipped === 2, JSON.stringify(out));
  ck('문구 저장 실행: 구분을 증상/해결 라벨로 적는다',
    body.v[0][0] === '증상' && body.v[1][0] === '해결', JSON.stringify(body.v.map(r => r[0])));
  ck('문구 저장 실행: 사용 꺼짐은 지우지 않고 FALSE 로 남긴다',
    body.v[2][1] === '보류 문구' && body.v[2][5] === 'FALSE');
  ck('문구 저장 실행: 순서를 1부터 다시 매긴다',
    body.v.map(r => r[4]).join(',') === '1,2,3', body.v.map(r => r[4]).join(','));

  const denied = new Function(
    'verifyLevel_', 'MENU', 'PHRASE', 'PHRASE_HEAD', 'safeCell_', 'sheet_', 'ss_', 'Utilities',
    grab(G, 'phraseKind_') + '\n' + grab(G, 'phraseKindLabel_') + '\n' +
    grab(G, 'photoPhraseSave_') + '; return photoPhraseSave_;')(
      () => 2, { AUTH_VERIFY_URL: 'x' }, { SHEET: 's', MAX: 200, MAX_LEN: 100 },
      [], v => v, () => null, () => null, { formatDate: () => '' });
  const deniedOut = denied({ token: 't', rows: [{ kind: 'CAUSE', text: 'x' }] });
  ck('문구 저장 실행: Lv.2 는 거부된다',
    deniedOut.success === false && /보안레벨 3/.test(deniedOut.error), JSON.stringify(deniedOut));
}

/* [v3.9] 문구는 현장 사진 설명을 채우려고 만든 기능이라 화면과 함께 사라졌다.
   서버 계약(photophrase·photophrase_save)은 위 검사대로 살아 있다. */
ck('현장 화면에 문구 버튼·문구 관리 모달이 남아 있지 않다',
  !/phraseChips_/.test(H) && !/id="phraseAdminBtn"/.test(H) && !/id="pmModal"/.test(H) &&
  !/function togglePhrase/.test(H) && !/function pmSave/.test(H));
ck('문구 목록을 더 이상 화면이 불러오지 않는다',
  !/loadPhrasesCached/.test(H) && !/photophrase/.test(H));

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
{
  const queuePhotoUpload = new Function(
    'var PHOTO_UPLOAD_LIMIT=2, PHOTO_UPLOAD_ACTIVE=0, PHOTO_UPLOAD_WAIT=[];\n' +
    grab(H, 'queuePhotoUpload') + '\n' + grab(H, 'drainPhotoUploads') +
    '; return queuePhotoUpload;')();
  let live=0, peak=0;
  const jobs=[1,2,3,4,5].map(i => queuePhotoUpload(() => {
    live++; peak=Math.max(peak,live);
    return new Promise(resolve => setTimeout(() => { live--; resolve(i); }, 5));
  }));
  const out=await Promise.all(jobs);
  ck('화면 전체 업로드 큐 실행: S/N·증상·해결 후를 합쳐 동시 2개 이하',
    peak===2 && out.join(',')==='1,2,3,4,5');
}

/* ══════════ 9. 기존 계약 보존 ══════════ */
section('기존 기능 보존');

ck('기존 snPhoto(base64) payload 호환을 유지한다',
  /snPhoto: opts\.photo \|\| '',/.test(read('js/baz-handover-core.js')) &&
  /payload\.snPhoto/.test(doPost));
ck('[v3.9] S/N 사진 없이도 저장할 수 있다(선택 항목)',
  BazHandover.validate({ hosp: 'A', fse: 'B', sn: 'C' }, { hasPhoto: false }).ok === true &&
  /photoRequired:false/.test(H));
ck('원인 사진 최대 5장을 클라이언트·서버가 같은 값으로 강제한다',
  BazHandover.MAX_CAUSE_PHOTOS === 5 && /MAX_CAUSE : 5/.test(G) &&
  BazPhoto.MAX_CAUSE === 5);
ck('사진을 처리하는 중에는 저장을 막는다',
  BazHandover.validate({ hosp: 'A', fse: 'B', sn: 'C' }, { hasPhoto: false, photoBusy: true })
    .errors.some(e => e.field === 'snPhoto'));
ck('저장 완료 전 화면을 닫으면 경고한다',
  /beforeunload/.test(H) && /function hasUnfinishedPhotoWork/.test(H) &&
  /return !!SN_PHOTO;/.test(H));
ck('S/N 사진도 개별 압축·업로드 후 참조로 최종 저장한다',
  /BazPhoto\.compress\(file,\{kind:'SN'\}\)/.test(H) &&
  /uploadPhotoSlot\([^\n]+, 'SN'\)/.test(H) && /function snPhotoRef/.test(H));
ck('브라우저 압축은 실제 canvas.toBlob 경로를 사용한다',
  /canvas\.toBlob\(/.test(PHOTO_SRC) && /function blobDataUrl/.test(PHOTO_SRC));
ck('S/N 사진 칸이 압축·업로드·완료·실패·재시도 상태를 알린다',
  /사진 처리 중…/.test(H) && /S\/N 사진 업로드 중…/.test(H) &&
  /업로드 완료/.test(H) && /사진 업로드 재시도/.test(H));
ck('실제 업로드 동시 실행은 2개로 제한한다',
  /PHOTO_UPLOAD_LIMIT=2/.test(H) && /function queuePhotoUpload/.test(H) &&
  /return queuePhotoUpload\(function\(\)/.test(grab(H, 'uploadPhotoSlot')));
ck('[v3.9] 현장 사진 촬영 화면이 남김없이 사라졌다',
  !/cause-grid/.test(H) && !/CAUSE_KINDS/.test(H) && !/causeFile_/.test(H) &&
  !/capture="environment"/.test(H) && !/CAUSE_SLOTS/.test(H));
ck('사진 공개 범위(ANYONE_WITH_LINK) 주의를 서버 코드에 남긴다',
  /ANYONE_WITH_LINK/.test(G) && /\[보안 주의\]/.test(G));
ck('index.html 은 이번 범위에서 건드리지 않는다',
  !/baz-photo\.js/.test(read('index.html')));
ck('서비스워커 캐시 버전이 139 이상이다',
  Number((SW.match(/baz-cs-v(\d+)/) || [])[1] || 0) >= 139);
ck('GAS 버전이 3.9.0 로 올라갔다', /ver:'3\.9\.0'/.test(G));

console.log('\n──────────────────────────────');
console.log('통과 ' + pass + '/' + total);
if (fails.length) { fails.forEach(f => console.log(' -', f)); process.exit(1); }
console.log('모든 테스트 통과 ✅');
