/************************************************************
 * type-example-manager.mjs
 * VOC 유형별 대표 사진 등록 도구 회귀 테스트
 * 실행: node test/type-example-manager.mjs
 *
 * 브라우저 Canvas/WebP 인코딩은 Node 에서 실행할 수 없으므로,
 * 모듈은 순수 함수(키·해시·경로·검증·매니페스트 갱신)와 DOM 의존부를 분리해 두었다.
 * 여기서는 순수 함수는 실제로 실행하고, DOM 의존부는 소스 계약으로 검사한다.
 ************************************************************/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require_ = createRequire(import.meta.url);
const read = n => fs.readFileSync(path.join(ROOT, n), 'utf8');

const DASH = read('dashboard-pc.html');
const SW = read('sw.js');
const SRC = read('js/type-example-manager.js');
const README = read('assets/type-examples/README.md');
const MANIFEST = JSON.parse(read('assets/type-examples/index.json'));
const M = require_('../js/type-example-manager.js');

let pass = 0, total = 0; const fails = [];
function ck(name, ok, detail) {
  total++; if (ok) pass++; else fails.push(name + (detail ? ' — ' + detail : ''));
  console.log(ok ? '✅' : '❌', name, detail || '');
}
function section(t) { console.log('\n── ' + t + ' ──'); }

/* ══════════ 1. 일반 로딩 경로와의 분리 ══════════ */
section('일반 로딩 / 관리 경로 분리');

ck('1. 대시보드는 관리 JS를 정적으로 포함하지 않는다',
  !/<script[^>]+type-example-manager/.test(DASH) &&
  (DASH.match(/<script src=/g) || []).length === 1 && /<script src="auth\.js">/.test(DASH));
ck('2. 관리 JS는 버튼을 누를 때만 동적으로 붙인다',
  /EX_TE_MGR_SRC='js\/type-example-manager\.js'/.test(DASH) &&
  /createElement\('script'\)/.test(DASH) && /document\.head\.appendChild\(s\)/.test(DASH));
ck('3. 진입 버튼은 기존 화면을 건드리지 않는 헤더 도구 영역에 있다',
  /id="teMgrBtn"[\s\S]{0,120}onclick="exOpenTypeExampleManager\(\)"/.test(DASH));
ck('4. 로딩 중 중복 클릭을 막는다',
  /if\(EX_TE_MGR_LOADING\) return;/.test(DASH) && /btn\.disabled=true/.test(DASH));
ck('5. 관리 화면 오류는 대시보드로 번지지 않게 격리한다',
  /function exTypeExampleManagerOpen_\(\)\{[\s\S]{0,400}try\{[\s\S]{0,400}catch\(e\)\{[\s\S]{0,80}toast\(/.test(DASH));
ck('6. 자동 실행·프리로드가 없다(사용자 클릭만 진입점)',
  !/exOpenTypeExampleManager\(\)\s*;/.test(DASH.replace(/onclick="exOpenTypeExampleManager\(\)"/g, '')) &&
  !/rel="(?:preload|prefetch|modulepreload)"/.test(DASH));

/* ══════════ 2. GAS/Drive/Sheets 미사용 ══════════ */
section('GAS · Drive · Sheets 요청 없음');

ck('7. 관리 모듈에 네트워크 호출 자체가 없다',
  !/\bfetch\s*\(/.test(SRC) && !/XMLHttpRequest|EventSource|WebSocket|navigator\.sendBeacon|import\s*\(/.test(SRC));
ck('8. 관리 모듈에 GAS·Drive·Sheets 흔적이 없다',
  !/script\.google|googleusercontent|drive\.google|spreadsheets|gvRetry|HANDOVER_URL|action=|\bDriveApp\b/i.test(SRC));
ck('9. 관리 모듈은 base64·dataURL 로 사진을 다루지 않는다',
  !/data:image|toDataURL|btoa\s*\(|FileReader/.test(SRC));
ck('10. 유형 목록·매니페스트는 대시보드가 이미 받아 둔 것을 넘겨받는다',
  /rows: RAW,/.test(DASH) && /loadManifest: exTypeExampleLoad_/.test(DASH) &&
  /typeof h\.loadManifest === 'function' \? h\.loadManifest\(\)/.test(SRC));
ck('11. js/baz-photo.js 를 재사용하지 않는다(모듈·대시보드 어느 쪽에서도 부르지 않는다)',
  !/BazPhoto/.test(SRC) && !/BazPhoto|baz-photo\.js/.test(DASH) &&
  /별도 변환기를 둔다\(공유·수정하지 않는다\)/.test(SRC));
ck('11-b. baz-photo.js 의 압축 계약(JPEG·PRESET)은 그대로다', (() => {
  const P = read('js/baz-photo.js');
  return /'image\/jpeg'/.test(P) && /SN:\s*\{ maxDim: 1600/.test(P) &&
    /CAUSE:\s*\{ maxDim: 1280/.test(P) && !/type-example|webp/i.test(P);
})());
ck('12. dashboard-pc.html 에 대표 사진 Base64 가 들어가지 않았다',
  !/data:image\/(?:webp|jpeg|png);base64/.test(DASH));
ck('13. 관리 모듈은 외부 CDN·외부 URL을 전혀 쓰지 않는다',
  !/https?:\/\//.test(SRC));
/* 대시보드의 기존 PPT·Excel CDN 은 이 작업 범위 밖이다 — 개수가 늘지 않았는지만 본다 */
ck('13-b. 대시보드에 새 외부 스크립트를 추가하지 않았다',
  (DASH.match(/https?:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)/g) || []).length === 6 &&
  !/type-example-manager/.test((DASH.match(/https?:\/\/[^"'\s]+/g) || []).join(' ')));

/* ══════════ 3. 유형 키 · loose-key 보존 ══════════ */
section('유형 키 생성 · 중복 방지');

const rows = [
  { cat: '핸드피스', type: '노즐 누수(약액유입)' },   /* 시트의 legacy 표기(공백 없음) */
  { cat: '핸드피스', type: '노즐  누수(약액 유입)' },  /* 공백이 여러 개인 표기 */
  { cat: '장비', type: '풋스위치 작동 불량' },
  { cat: '노즐', type: '크랙' },
  { cat: '노즐', type: '' }                            /* 유형 없음 → 키 생성 안 함 */
];
const list = M.buildTypeRows(rows, MANIFEST);
const leakKeys = list.filter(r => /누수/.test(r.key)).map(r => r.key);

ck('14. 대분류|유형 키를 만들고 공백을 정규화한다',
  M.makeKey(' 장비 ', '노즐   누수') === '장비|노즐 누수' && M.makeKey('장비', '') === '');
ck('15. 공백만 다른 표기는 index.json 의 기존 키를 그대로 보존한다',
  leakKeys.length === 1 && leakKeys[0] === '핸드피스|노즐 누수(약액 유입)');
ck('16. 관리 도구가 중복 키를 새로 만들지 않는다',
  new Set(list.map(r => M.looseKey(r.key))).size === list.length);
ck('17. index.json 에만 있는 유형도 목록에 합친다',
  list.some(r => r.key === '핸드피스|노즐 체결 강함' && r.inManifest && !r.inData) &&
  list.length === Object.keys(MANIFEST.items).length + 1);   /* 새 유형은 노즐|크랙 하나뿐 */
ck('18. 실제 데이터가 없어도 index.json 항목만으로 목록을 만든다',
  M.buildTypeRows([], MANIFEST).length === Object.keys(MANIFEST.items).length);
ck('19. 등록 상태 4가지를 판정한다',
  M.slotState({ symptom: { src: 'a' }, after: { src: 'b' } }) === 'both' &&
  M.slotState({ symptom: { src: 'a' } }) === 'symptom' &&
  M.slotState({ after: { src: 'b' } }) === 'after' && M.slotState(null) === 'none');
ck('20. 사용자가 키를 직접 타이핑하는 입력칸이 없다',
  !/data-act="key"/.test(SRC) && /data-key="' \+ escHtml\(row\.key\)/.test(SRC));

/* ══════════ 4. SHA-256 경로 · 중복 제거 ══════════ */
section('SHA-256 파일명 · 중복 제거');

const bytesA = new TextEncoder().encode('type-example-A');
const bytesB = new TextEncoder().encode('type-example-B');
const hashA = await M.sha256Hex12(bytesA);
const hashA2 = await M.sha256Hex12(new TextEncoder().encode('type-example-A'));
const hashB = await M.sha256Hex12(bytesB);

ck('21. 해시는 hex 12자리다', /^[0-9a-f]{12}$/.test(hashA) && hashA === hashA2 && hashA !== hashB);
ck('22. 경로는 assets/type-examples/media/<hash12>.webp 다',
  M.mediaPath(hashA) === 'assets/type-examples/media/' + hashA + '.webp' &&
  M.isMediaPath(M.mediaPath(hashA)) && !M.isMediaPath('assets/type-examples/media/ABCDEF012345.webp'));
ck('22-b. 영상도 내용 해시 MP4 경로를 사용한다',
  M.mediaPath(hashA, 'video') === 'assets/type-examples/media/' + hashA + '.mp4' &&
  M.isMediaPath(M.mediaPath(hashA, 'video')) && M.mediaKind(M.mediaPath(hashA, 'video')) === 'video');
{
  const blob = { size: 1234 };
  const writes = M.planWrites({
    '장비|A': { symptom: { src: M.mediaPath(hashA), blob, bytes: 1234 } },
    '장비|B': { after: { src: M.mediaPath(hashA), blob, bytes: 1234 } },   /* 같은 변환 결과 */
    '장비|C': { symptom: { src: M.mediaPath(hashB), blob, bytes: 999 } },
    '장비|D': { symptom: { src: 'assets/type-examples/old/x.webp', blob: null } } /* 설명만 수정 */
  });
  ck('23. 같은 Blob(같은 해시)은 한 번만 저장한다',
    writes.length === 2 && writes.filter(w => w.path === M.mediaPath(hashA)).length === 1);
  ck('24. 새 파일이 없는 변경(설명만 수정)은 파일 쓰기 목록에 넣지 않는다',
    !writes.some(w => /old\/x\.webp/.test(w.path)));
}
ck('25. 긴 변 1200px 상한 · 확대 금지',
  M.fitSize(4032, 3024, 1200).w === 1200 && M.fitSize(800, 600, 1200).w === 800 &&
  M.MAX_DIM === 1200);
{
  /* 품질을 먼저 낮추고, 최저 품질에서도 크면 해상도를 줄인다 */
  const big = await M.pickEncoding((dim, q) => Promise.resolve({ bytes: dim * 400, width: dim, height: dim }), { startDim: 1200 });
  const easy = await M.pickEncoding((dim, q) => Promise.resolve({ bytes: Math.round(200 * 1024 * q), width: dim, height: dim }), { startDim: 1200 });
  ck('26. 300KB 이하가 될 때까지 품질 → 해상도 순으로 낮춘다',
    big.dim < 1200 && big.bytes <= M.TARGET_BYTES && easy.dim === 1200 && easy.quality === M.QUALITY_STEPS[0]);
  const hopeless = await M.pickEncoding(() => Promise.resolve({ bytes: 5 * 1024 * 1024 }), { startDim: 1200 });
  ck('27. 끝까지 목표를 못 맞추면 over 로 알린다', hopeless.over === true);
}
ck('28. WebP 로만 인코딩하고 캔버스 재인코딩으로 메타데이터를 제거한다',
  /'image\/webp'/.test(SRC) && /blob\.type !== 'image\/webp'/.test(SRC) &&
  /drawImage/.test(SRC) && !/'image\/jpeg'/.test(SRC));
ck('29. 브라우저가 못 여는 파일(HEIC 등)은 이해 가능한 안내를 낸다',
  /HEIC\/HEIF/.test(SRC) && /img\.onerror/.test(SRC));
ck('29-b. 영상은 MP4·15초·5MB 제한을 코드에서 강제한다',
  M.VIDEO_MAX_SECONDS === 15 && M.VIDEO_MAX_BYTES === 5 * 1024 * 1024 &&
  /영상은 15초 이하만/.test(SRC) && /영상은 5MB 이하만/.test(SRC) && /재생할 수 없는 MP4/.test(SRC));
ck('29-c. MP4 내부 avc1·avc3 표식으로 H.264 코덱을 제한한다',
  M.hasAvcCodec(new TextEncoder().encode('....avc1....')) &&
  M.hasAvcCodec(new TextEncoder().encode('....avc3....')) &&
  !M.hasAvcCodec(new TextEncoder().encode('....hvc1....')) && /H\.264\(avc1\/avc3\)만 허용/.test(SRC));
{
  const two=M.collageLayout(2,1200,900,12),three=M.collageLayout(3,1200,900,12),four=M.collageLayout(4,1200,900,12);
  ck('29-d. 합성 레이아웃은 2장 좌우·3장 대소·4장 2×2로 계산한다',
    two.length===2&&two[0].h===900&&three.length===3&&three[0].h===900&&three[1].h<900&&
    four.length===4&&four.every(r=>r.w<1200&&r.h<900));
}
ck('29-e. 합성은 사진 2~4장·장당 10MB·전체 30MB·1200×900 이내로 제한한다',
  M.COLLAGE_MAX_FILES===4&&M.COLLAGE_FILE_MAX_BYTES===10*1024*1024&&
  M.COLLAGE_TOTAL_MAX_BYTES===30*1024*1024&&M.COLLAGE_WIDTH===1200&&
  /합성은 사진 2~4장을 선택/.test(SRC)&&/width \* COLLAGE_RATIO/.test(SRC));
ck('29-f. 합성 결과도 WebP·내용 해시 파일명·300KB 목표 경로를 그대로 사용한다',
  /function encodeCollage/.test(SRC)&&/pickEncoding\(function \(dim, q\) \{ return encodeCollage/.test(SRC)&&
  /sha256Hex12\(buf\)/.test(SRC)&&/src: mediaPath\(hash\)/.test(SRC));
ck('29-g. 수동 순서 변경과 위치·확대 범위를 안전하게 제한한다',
  M.moveCollageItem(['A','B','C'],0,2).join('')==='BCA'&&M.clamp(3,1,2)===2&&M.clamp(-1,-.5,.5)===-.5);
ck('29-h. 합성 입력 검증은 사진 수·파일별 용량·전체 용량을 생성 전에 차단한다',
  !M.validateCollageFiles([{name:'a.jpg',type:'image/jpeg',size:100}]).ok&&
  !M.validateCollageFiles([1,2].map((_,i)=>({name:`${i}.jpg`,type:'image/jpeg',size:11*1024*1024}))).ok&&
  M.validateCollageFiles([1,2,3,4].map((_,i)=>({name:`${i}.jpg`,type:'image/jpeg',size:1024}))).ok);

/* ══════════ 5. index.json 갱신 규칙 ══════════ */
section('index.json 갱신 · 검증');

const NEW_A = M.mediaPath(hashA), NEW_B = M.mediaPath(hashB);
const next = M.applyChanges(MANIFEST, {
  /* legacy 표기로 들어와도 기존 키에 흡수돼야 한다 */
  '핸드피스|노즐 누수(약액유입)': { after: { src: NEW_A, text: '세척 후 정상' } },
  '노즐|크랙': { symptom: { src: NEW_B, text: '노즐 크랙' } }
}, '2026-08-24');

ck('30. schema 와 기존 items 를 모두 보존한다',
  next.schema === 1 &&
  Object.keys(MANIFEST.items).every(k => !!next.items[k]) &&
  next.items['장비|풋스위치 작동 불량'].symptom.src === MANIFEST.items['장비|풋스위치 작동 불량'].symptom.src);
ck('31. 바꾼 슬롯만 갱신하고 나머지 슬롯은 그대로 둔다',
  next.items['핸드피스|노즐 누수(약액 유입)'].after.src === NEW_A &&
  next.items['핸드피스|노즐 누수(약액 유입)'].symptom.src === MANIFEST.items['핸드피스|노즐 누수(약액 유입)'].symptom.src);
ck('32. 공백만 다른 키로 들어와도 새 키를 만들지 않는다',
  !next.items['핸드피스|노즐 누수(약액유입)'] &&
  Object.keys(next.items).length === Object.keys(MANIFEST.items).length + 1);
ck('33. 사진 설명은 text 에 저장한다',
  next.items['노즐|크랙'].symptom.text === '노즐 크랙');
ck('34. updatedAt 은 저장 시점의 로컬 날짜 YYYY-MM-DD 다',
  next.updatedAt === '2026-08-24' &&
  M.todayLocal(new Date(2026, 0, 3, 23, 30)) === '2026-01-03');
ck('35. JSON 은 2칸 들여쓰기로 직렬화한다',
  M.serializeManifest(next).split('\n')[1].startsWith('  "') &&
  M.serializeManifest(next).endsWith('}\n') &&
  M.serializeManifest(MANIFEST) === read('assets/type-examples/index.json').replace(/\r\n/g, '\n'));
ck('36. 정상 매니페스트는 검증을 통과한다',
  M.validateManifest(next, { newFiles: [NEW_A, NEW_B] }).ok === true);

function bad(manifest, opt) { return M.validateManifest(manifest, opt || {}); }
ck('37. schema 가 1이 아니면 거부한다',
  !bad({ ...next, schema: 2 }).ok && !bad({ ...next, schema: '1' }).ok);
ck('38. items 가 객체가 아니면 거부한다',
  !bad({ schema: 1, updatedAt: '2026-08-24', items: [] }).ok &&
  !bad({ schema: 1, updatedAt: '2026-08-24', items: null }).ok);
ck('39. 경로 탈출·외부 URL·data URL 을 거부한다',
  ['../secret.webp', 'assets/type-examples/../secret.webp', 'https://example.com/a.webp',
   '//example.com/a.webp', 'data:image/png;base64,AA', 'blob:https://x/y', '/etc/passwd',
   'other/dir/a.webp'].every(src => M.isSafeSrc(src) === false) &&
  !bad({ schema: 1, updatedAt: '2026-08-24', items: { '장비|X': { symptom: { src: 'data:image/png;base64,AA' } } } }).ok);
ck('40. 저장소 안 사진·MP4 상대 경로만 허용한다',
  M.isSafeSrc('assets/type-examples/media/0123456789ab.webp') &&
  M.isSafeSrc('assets/type-examples/media/0123456789ab.mp4') &&
  M.isSafeSrc('assets/type-examples/equipment-cable/symptom-4b9d0c6a2e.webp') &&
  !M.isSafeSrc('assets/type-examples/media/0123456789ab.mov'));
ck('41. 새 파일 확장자가 webp·mp4가 아니면 거부한다',
  !bad({ schema: 1, updatedAt: '2026-08-24', items: { '장비|X': { symptom: { src: 'assets/type-examples/media/aa.png' } } } },
    { newFiles: ['assets/type-examples/media/aa.png'] }).ok);
{
  const video={schema:1,updatedAt:'2026-08-24',items:{'장비|영상':{symptom:{
    src:M.mediaPath(hashA,'video'),text:'작동 영상',kind:'video',bytes:1024,duration:8.4
  }}}};
  ck('41-b. 제한 안의 MP4 매니페스트는 허용한다',M.validateManifest(video,{newFiles:[M.mediaPath(hashA,'video')]}).ok);
  video.items['장비|영상'].symptom.bytes=M.VIDEO_MAX_BYTES+1;
  ck('41-c. 5MB를 넘는 영상 매니페스트를 거부한다',!M.validateManifest(video).ok);
  video.items['장비|영상'].symptom.bytes=1024; video.items['장비|영상'].symptom.duration=15.1;
  ck('41-d. 15초를 넘는 영상 매니페스트를 거부한다',!M.validateManifest(video).ok);
}
ck('42. 해시 규칙에 맞지 않는 새 파일 경로를 거부한다',
  !bad(M.applyChanges(MANIFEST, { '장비|X': { symptom: { src: 'assets/type-examples/media/hello.webp' } } }, '2026-08-24'),
    { newFiles: ['assets/type-examples/media/hello.webp'] }).ok);
ck('43. 매니페스트가 참조하지 않는 새 파일을 거부한다',
  !bad(next, { newFiles: [NEW_A, NEW_B, M.mediaPath('0123456789ab')] }).ok);
ck('44. 공백만 다른 중복 키가 있으면 거부한다', (() => {
  const dup = { schema: 1, updatedAt: '2026-08-24', items: {
    '핸드피스|노즐 누수(약액 유입)': { symptom: { src: NEW_A } },
    '핸드피스|노즐 누수(약액유입)': { symptom: { src: NEW_B } }
  } };
  const r = bad(dup, { newFiles: [NEW_A, NEW_B] });
  return !r.ok && r.errors.some(e => /중복 키/.test(e));
})());
ck('45. updatedAt 형식이 틀리면 거부한다', !bad({ ...next, updatedAt: '2026/08/24' }).ok);
ck('46. 검증 실패면 어떤 파일도 쓰지 않는다 — prepare 가 예외로 막는다',
  /if \(!v\.ok\) throw new Error\('검증 실패/.test(SRC) &&
  /var plan = prepare\(\);/.test(SRC.slice(SRC.indexOf('function saveToDirectory'))) &&
  /var plan = prepare\(\);/.test(SRC.slice(SRC.indexOf('function saveByDownload'))));
ck('47. index.json 은 사진을 모두 쓴 뒤 마지막에 저장한다',
  SRC.indexOf("writeFile(mediaDir, baseName(w.path), w.blob)") <
  SRC.indexOf("writeFile(teDir, 'index.json', plan.json)"));
ck('48. 교체로 참조가 끊긴 기존 파일은 정리 후보로만 안내하고 자동 삭제하지 않는다',
  /* 노즐 누수 after 를 새 파일로 바꿨으니 옛 after 파일 하나만 후보가 된다 */
  M.cleanupCandidates(MANIFEST, next).length === 1 &&
  M.cleanupCandidates(MANIFEST, next)[0] === MANIFEST.items['핸드피스|노즐 누수(약액 유입)'].after.src &&
  /* 같은 파일을 계속 참조하는 항목은 후보가 아니다 */
  M.cleanupCandidates(MANIFEST, MANIFEST).length === 0 &&
  !/removeEntry|removeFile|fs\.unlink/.test(SRC) && /정리 후보\(자동 삭제하지 않음\)/.test(SRC));
ck('49. 기존 폴더·기존 파일을 마이그레이션하지 않는다',
  Object.values(MANIFEST.items).flatMap(i => [i.symptom, i.after]).filter(Boolean)
    .every(p => fs.existsSync(path.join(ROOT, p.src))) &&
  !/rename|migrat/i.test(SRC));

/* ══════════ 6. 저장 · GitHub 직접 커밋 없음 ══════════ */
section('저장 방식');

ck('50. GitHub PAT·OAuth·직접 커밋 기능이 없다',
  !/github|token|oauth|Authorization|api\.github/i.test(SRC));
ck('51. 저장은 사용자의 명시적 클릭에서만 시작한다',
  /el\.save\.addEventListener\('click'/.test(SRC) && /el\.download\.addEventListener\('click'/.test(SRC) &&
  !/setTimeout\([^)]*saveToDirectory|setInterval/.test(SRC));
ck('52. File System Access 가 있으면 폴더 저장, 없으면 다운로드 폴백',
  /typeof window\.showDirectoryPicker === 'function'/.test(SRC) &&
  /if \(!canPickDirectory\(\)\) \{\s*\n\s*el\.save\.hidden = true;/.test(SRC) &&
  /function saveByDownload/.test(SRC));
ck('53. 폴더 저장은 저장소인지 확인한 뒤 쓴다',
  /assets', 'type-examples'\], false\)/.test(SRC) && /index\.json 이 없습니다/.test(SRC));
ck('54. 덮어쓰기 전에 확인을 받는다',
  /confirm\(ask\.join\('\\n'\)\)/.test(SRC) && /덮어쓰기/.test(SRC));
ck('55. 다운로드 폴백은 저장소 경로를 함께 안내하고 ZIP 라이브러리를 쓰지 않는다',
  SRC.includes("' + f.name + '  →  ' + f.path") && /다운로드한 파일을 저장소의 아래 경로에/.test(SRC) &&
  !/jszip|new JSZip|\.zip'/i.test(SRC));

/* ══════════ 7. 서비스워커 캐시 정책 ══════════ */
section('서비스워커 캐시');

ck('56. 내용 해시 WebP 만 캐시 우선 대상이다',
  /const TYPE_EXAMPLE_IMMUTABLE = \/\\\/assets\\\/type-examples\\\/media\\\/\[0-9a-f\]\{12\}\\\.webp\$\//.test(SW) &&
  /IMMUTABLE\.test\(req\.url\) \|\| TYPE_EXAMPLE_IMMUTABLE\.test\(new URL\(req\.url\)\.pathname\)/.test(SW));
{
  const re = SW.match(/const TYPE_EXAMPLE_IMMUTABLE = (\/.*\/);/)[1];
  const rx = new Function('return ' + re)();
  ck('57. index.json 과 기존 폴더 사진은 캐시 우선이 아니다(네트워크 우선 유지)',
    rx.test('/assets/type-examples/media/0123456789ab.webp') &&
    !rx.test('/assets/type-examples/index.json') &&
    !rx.test('/assets/type-examples/equipment-cable/symptom-4b9d0c6a2e.webp') &&
    !rx.test('/assets/type-examples/media/0123456789ab.webp.json') &&
    !rx.test('/js/type-example-manager.js'));
}
ck('58. 대표 사진·관리 JS를 프리캐시에 넣지 않는다',
  !/type-example/.test(SW.slice(SW.indexOf('const ASSETS'), SW.indexOf('];', SW.indexOf('const ASSETS')))));
ck('58-b. MP4는 사용자 재생 요청만 네트워크로 보내고 CacheStorage에 넣지 않는다',
  /const TYPE_EXAMPLE_VIDEO/.test(SW) &&
  /TYPE_EXAMPLE_VIDEO\.test\(new URL\(req\.url\)\.pathname\)[\s\S]*?event\.respondWith\(fetch\(req\)\)/.test(SW));
ck('59. GAS 요청 무캐시 정책이 그대로다',
  /req\.url\.includes\('script\.google\.com'\)/.test(SW) && /event\.respondWith\(fetch\(req\)\)/.test(SW));
ck('60. 배포 변경에 맞춰 CACHE_VERSION 을 올렸다',
  Number((SW.match(/baz-cs-v(\d+)/) || [])[1] || 0) >= 148);

/* ══════════ 8. UI 안전성 · 문서 ══════════ */
section('UI 안전성 · 문서');

ck('61. 실제 처리 기록이 아닌 표준 예시임을 화면에 알린다',
  /실제 처리 기록이 아니라 VOC 유형별 표준 예시/.test(SRC));
ck('61-b. 영상 제한과 기본 재생 정책을 관리 화면에 표시한다',
  /MP4\(H\.264\/AVC\)·15초 이하·5MB 이하/.test(SRC) && /기본 음소거/.test(SRC));
ck('61-c. 관리 화면에서 사진 2~4장 합성 선택과 브라우저 내부 처리 기준을 안내한다',
  /data-act="pick-collage"/.test(SRC)&&/data-act="collage-file" multiple/.test(SRC)&&
  /원본은 서버로 전송되지 않습니다/.test(SRC));
ck('61-d. 합성 편집기는 순서·드래그 위치·확대·회전·자동 초기화를 제공한다',
  /data-el="collage-canvas"/.test(SRC)&&/data-act="collage-zoom"/.test(SRC)&&/data-act="collage-rotate"/.test(SRC)&&
  /data-act="collage-reset"/.test(SRC)&&/pointermove/.test(SRC)&&/draggable="true"/.test(SRC));
ck('62. 개인정보 노출 금지 안내가 있다',
  /환자·직원 얼굴, 병원명, 장비 S\/N, 문서·모니터의 개인정보/.test(SRC));
ck('63. 처리 중 중복 클릭을 막는다',
  /if \(S\.busy\) return;/.test(SRC) && /function setBusy/.test(SRC) && /S\.el\.save\.disabled = S\.busy/.test(SRC));
ck('64. 변환 실패는 기존 데이터를 건드리지 않고 오류만 표시한다',
  /변환 실패 · /.test(SRC) && /기존 등록 내용을 건드리지 않는다/.test(SRC));
ck('65. 관리 화면은 대시보드 DOM·상태를 바꾸지 않는다',
  !/getElementById\('(?:hst|ex|wk|app|loading)/.test(SRC) && !/RAW\s*=|EX_HISTORY_STATE/.test(SRC));
ck('66. 대분류 필터·유형 검색·미등록만 보기 기능이 있다',
  /data-act="cat"/.test(SRC) && /data-act="query"/.test(SRC) && /data-act="missing"/.test(SRC));
ck('67. 드래그앤드롭과 파일 선택을 모두 지원한다',
  /addEventListener\('drop'/.test(SRC) && /data-act="file"/.test(SRC) && /input\.click\(\)/.test(SRC));
ck('68. 원본·변환 파일 크기와 해상도를 함께 보여준다',
  /원본 ' \+ escHtml/.test(SRC) && /변환 WebP · '/.test(SRC) && /function formatBytes/.test(SRC));
ck('69. 변경된 항목과 취소·초기화를 제공한다',
  /변경된 항목 ' \+ c \+ '건/.test(SRC) && /data-act="reset"/.test(SRC) && /data-act="undo"/.test(SRC));
ck('70. PC 2열 · 모바일 1열 레이아웃과 다크모드에 대응한다',
  /\.bte-slots\{display:grid;grid-template-columns:repeat\(2/.test(SRC) &&
  /@media\(max-width:760px\)\{\.bte-slots\{grid-template-columns:1fr\}/.test(SRC) &&
  /body\.dark \.bte-state/.test(SRC) && /var\(--surface,/.test(SRC));
ck('71. README 에 관리 화면 등록 절차와 비상 수동 절차가 모두 있다',
  /## 등록 절차 \(권장 · 대시보드 관리 화면\)/.test(README) &&
  /## 등록 절차 \(비상용 · 수동\)/.test(README) &&
  /🖼 예시자료 관리/.test(README) && /git status/.test(README) && /15초 이하, 5MB 이하/.test(README));
ck('72. README 에 합성 배치와 공통 전체화면 출력 절차가 있다',
  /사진 2~4장 합성/.test(README)&&/4장은 2×2/.test(README)&&/공통 전체화면 뷰어/.test(README));
ck('73. README 에 수동 순서·프레이밍·확대·회전 조정 절차가 있다',
  /프레이밍 위치/.test(README)&&/확대·90도 회전/.test(README)&&/순서를 바꿀 수 있습니다/.test(README));

console.log('\n──────────────────────────────');
console.log(`통과 ${pass}/${total}`);
if (fails.length) { console.log('실패:'); fails.forEach(f => console.log(' -', f)); process.exit(1); }
console.log('모든 테스트 통과 ✅');
