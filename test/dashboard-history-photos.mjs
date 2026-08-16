/************************************************************
 * dashboard-history-photos.mjs
 * 대시보드 선택 행 대표 사진 경량 조회 회귀 테스트
 * 실행: node test/dashboard-history-photos.mjs
 ************************************************************/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DASH = fs.readFileSync(path.join(HERE, '..', 'dashboard-pc.html'), 'utf8');
const GAS = fs.readFileSync(path.join(HERE, '..', 'handover_gas.gs'), 'utf8');

let pass=0, total=0;
const fails=[];
function ck(name, ok, detail){
  total++;
  if(ok) pass++; else fails.push(name+(detail?' — '+detail:''));
  console.log(ok?'✅':'❌',name,detail||'');
}
function grab(src,name){
  const at=src.search(new RegExp('\\bfunction\\s+'+name.replace(/[$]/g,'\\$')+'\\s*\\('));
  if(at<0) throw new Error('함수를 찾지 못했습니다: '+name);
  let depth=0;
  for(let i=src.indexOf('{',at);i<src.length;i++){
    if(src[i]==='{') depth++;
    else if(src[i]==='}'&&--depth===0) return src.slice(at,i+1);
  }
  throw new Error('본문 끝을 찾지 못했습니다: '+name);
}

const dashSig=new Function(grab(DASH,'exHistoryPhotoSig_')+';return exHistoryPhotoSig_;')();
const gasSig=new Function(grab(GAS,'historyPhotoSig_')+';return historyPhotoSig_;')();
const thumb=new Function(grab(DASH,'exDriveThumbUrl_')+';return exDriveThumbUrl_;')();
const sample={date:'2026-08-15',hosp:'가병원',fse:'김기사',gubun:'A/S',cat:'장비',
  type:'노즐 누수',part:'Valve',detail:'교체 후 정상',sn:'SN-100'};

ck('1. 브라우저와 GAS의 행 지문이 동일하다',dashSig(sample)===gasSig(sample),dashSig(sample));
ck('2. 행 내용이 한 글자라도 달라지면 지문이 달라진다',
  dashSig(sample)!==dashSig({...sample,detail:'교체 후 정상.'}));
ck('3. Drive 썸네일은 GAS 프록시가 아닌 직접 URL이다',
  thumb('AbCdEfGhIjKlMnOpQrStUvWxYz12')==='https://drive.google.com/thumbnail?id=AbCdEfGhIjKlMnOpQrStUvWxYz12&sz=w1200');
ck('4. 비정상 파일 ID는 URL로 만들지 않는다',thumb('javascript:alert(1)')==='');

const panel=grab(DASH,'exHistoryPhotoPanel_');
const select=grab(DASH,'exSelectHistory_');
const show=grab(DASH,'exShowHistory_');
ck('5. 사진 패널은 증상·처리 결과 각 한 칸만 가진다',
  (panel.match(/hstPhotoSymptom"/g)||[]).length===1 &&
  (panel.match(/hstPhotoAfter"/g)||[]).length===1);
ck('6. 패널 생성 시 img src가 없어 행 선택 전에는 이미지 요청이 없다',
  !/<img[^>]+src=/.test(panel));
ck('7. 모달 열기 자체에는 GAS·fetch 호출이 없다',
  !/\bfetch\s*\(|\bgv(?:Retry)?\s*\(|loadData\s*\(/.test(show));
ck('8. 행 선택 때만 전용 소형 API를 호출한다',
  /gvRetry\('historyphotos',\{row:Number\(r\.row\),sig:sig\},2,12000\)/.test(select));
ck('9. 대시보드 대표 사진 경로는 Base64 snphoto를 사용하지 않는다',
  !/snphoto|data:image|base64/i.test(select+'\n'+panel+'\n'+grab(DASH,'exHistoryPhotoSlot_')));
ck('10. all 응답에는 사진 ID 대신 물리 행 번호만 추가한다',
  /data:all\.rows\.map\(function\(o\)\{\s*var s=slim_\(o\); s\.row=Number\(o\._row\)\|\|0; return s;/.test(GAS));

/* GAS endpoint를 실제 함수 원문으로 실행하되 Sheets만 메모리 mock으로 대체한다. */
const headers=['처리일','병원명','CS 담당자','점검/AS','대분류','유형','교체품','내용','장비SN','기록 ID'];
const values=['2026-08-15','가병원','김기사','A/S','장비','노즐 누수','Valve','교체 후 정상','SN-100','rec-001'];
const headerMap={}; headers.forEach((h,i)=>headerMap[h]=i+1);
let rangeCalls=[];
const sheet={
  getLastRow:()=>12,
  getLastColumn:()=>headers.length,
  getRange:(row,col,nr,nc)=>{
    rangeCalls.push([row,col,nr,nc]);
    if(row!==12||col!==1||nr!==1||nc!==headers.length) throw new Error('unexpected range');
    return {getDisplayValues:()=>[values.slice()]};
  }
};
const photoRows=[
  {kind:'AFTER',seq:1,status:'OK',fileId:'AfterFileId123456789012345',desc:'완료'},
  {kind:'CAUSE',seq:2,status:'OK',fileId:'CauseSecond12345678901234',desc:'두 번째'},
  {kind:'SN',seq:1,status:'OK',fileId:'SerialFileId12345678901234',desc:'라벨'},
  {kind:'CAUSE',seq:1,status:'OK',fileId:'CauseFirst123456789012345',desc:'첫 번째'},
  {kind:'CAUSE',seq:0,status:'ORPHAN',fileId:'OrphanFileId1234567890123',desc:'미연결'}
];
const runtime=[
  "var CONFIG={SHEET_NAME:'현장 처리 현황(handover)'};",
  "var REC_ID_COLS=['기록 ID','기록ID','recordId'];",
  "var SNAP={ST_OK:'OK',KIND_SN:'SN',KIND_CAUSE:'CAUSE',KIND_AFTER:'AFTER',MAX_DESC:200};",
  'var __sheet=arguments[0], __photos=arguments[1];',
  'function sheet_(){return __sheet;}',
  'function findHeader_(){return {row:1,headers:'+JSON.stringify(headers)+',map:'+JSON.stringify(headerMap)+'};}',
  "function norm_(s){return String(s==null?'':s).replace(/\\s+/g,'').toLowerCase();}",
  grab(GAS,'pickH_'),
  grab(GAS,'slim_'),
  grab(GAS,'photoKeyClean_'),
  grab(GAS,'photoDescClean_'),
  grab(GAS,'photoKindRank_'),
  grab(GAS,'photoSortList_'),
  'function photoReadRecord_(id){return id===\'rec-001\'?__photos.slice():[];}',
  grab(GAS,'historyPhotoSig_'),
  grab(GAS,'historyPhotos_'),
  'return {run:historyPhotos_,sig:historyPhotoSig_};'
].join('\n');
const api=new Function(runtime)(sheet,photoRows);
const sig=api.sig(sample);
const result=api.run({row:12,sig});

ck('11. 선택 조회는 메인 시트의 정확한 한 행만 읽는다',
  rangeCalls.length===1 && rangeCalls[0].join(',')==='12,1,1,10',JSON.stringify(rangeCalls));
ck('12. CAUSE는 순번이 가장 앞선 대표 1장만 반환한다',
  result.success && result.symptom && result.symptom.fileId==='CauseFirst123456789012345');
ck('13. AFTER는 대표 1장만 반환하고 SN·ORPHAN은 제외한다',
  result.after && result.after.fileId==='AfterFileId123456789012345' &&
  JSON.stringify(result).indexOf('SerialFileId')<0 && JSON.stringify(result).indexOf('OrphanFileId')<0);
ck('14. 응답에는 Base64·Blob 데이터가 없다',
  !/base64|data:image|blob/i.test(JSON.stringify(result)));

rangeCalls=[];
const stale=api.run({row:12,sig:'00000000'});
ck('15. 행 정렬·수정으로 지문이 어긋나면 STALE_ROW로 거부한다',
  stale.success===false && stale.code==='STALE_ROW');
const endpoint=grab(GAS,'historyPhotos_');
ck('16. endpoint는 DriveApp·getBlob·전체 readAll을 호출하지 않는다',
  !/DriveApp|getBlob|readAll_|photoReadAll_|snPhotos_/.test(endpoint));
ck('17. doGet 라우트는 기존 토큰 인증 게이트 안에 있다',
  GAS.indexOf("if(action==='historyphotos')")>GAS.indexOf("if(verifyLevel_(p.token||'') < 1)"));

/* ══════ 18~21. 경계 행 처리 ══════ */
{
  /* 헤더 행·시트 끝 밖·내용이 빈 행은 사진을 주지 않고 STALE_ROW 로 막는다 */
  const hdrRow=api.run({row:1,sig});
  ck('18. 헤더 행 번호는 STALE_ROW 로 거부한다', hdrRow.success===false && hdrRow.code==='STALE_ROW');
  const past=api.run({row:99,sig});
  ck('19. 시트 마지막 행을 넘는 번호는 STALE_ROW 로 거부한다',
    past.success===false && past.code==='STALE_ROW');
  const bad=api.run({row:12,sig:'ZZZZ'});
  ck('20. 형식이 어긋난 sig 는 BAD_REQUEST 로 막는다',
    bad.success===false && bad.code==='BAD_REQUEST');
  const noRow=api.run({sig});
  ck('21. row 누락은 시트를 읽지 않고 BAD_REQUEST', noRow.success===false && noRow.code==='BAD_REQUEST');
}

/* ══════ 22~28. all 스키마 전환 · 배포 직후 캐시 호환성 ══════
   배포 직후 이전 v1 본문/메타가 스크립트 캐시에 남아 있어도
   row 없는 데이터를 nochange 로 돌려주면 대시보드에서 사진을 못 연다. */
{
  const gasNames=['getAll_','slim_','pickH_','syncForce_','syncRevParam_','syncMetaGet_','syncMetaPut_',
    'syncNochange_','syncNochangeFrom_','syncBytesFrom_','syncObserved_','syncRevOf_','syncByteLen_'];
  function buildAll(rowsData){
    const cache={};
    const pre=[
      'var __cache=arguments[0], __rows=arguments[1];',
      'var Utilities={formatDate:function(){return "2026-08-16 10:00";},',
      '  computeDigest:function(a,s){var h=0,o=[];for(var i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))|0;}',
      '    for(var j=0;j<12;j++){o.push((h>>((j%4)*8))&255);} return o;},',
      '  DigestAlgorithm:{SHA_256:1}, Charset:{UTF_8:1}};',
      'function bazCacheGet_(k){return Object.prototype.hasOwnProperty.call(__cache,k)?__cache[k]:null;}',
      'function bazCachePut_(k,v){__cache[k]=v;}',
      'function readAllMemo_(){return {rows:__rows};}',
      'function norm_(s){return String(s==null?"":s).replace(/\\s+/g,"").toLowerCase();}'
    ].join('\n');
    return new Function([pre].concat(gasNames.map(n=>grab(GAS,n)))
      .concat(['return {getAll_:getAll_,cache:__cache};']).join('\n'))(cache, rowsData);
  }
  const mkRow=(i)=>({_row:100+i,'처리일':'2026-08-1'+(i%9),'병원명':'병원'+i,'CS 담당자':'김기사',
    '점검/AS':'A/S','대분류':'장비','유형':'노즐 누수','교체품':'V','내용':'상세'+i,'장비SN':'SN'+i});

  let a=buildAll([mkRow(0),mkRow(1)]);
  const fresh=a.getAll_({});
  ck('22. all 응답에 schema=2 와 행별 물리 행 번호 row 가 실린다',
    fresh.schema===2 && fresh.data[0].row===100 && fresh.data[1].row===101);
  ck('23. all 응답에 사진 ID·recordId 는 실리지 않는다',
    JSON.stringify(fresh.data).indexOf('recordId')<0 && !('snPhotoId' in fresh.data[0]));
  ck('24. 같은 rev 재요청은 nochange 로 응답한다', a.getAll_({rev:fresh.rev}).nochange===true);

  a=buildAll([mkRow(0),mkRow(1)]);
  a.cache['handover_all']=JSON.stringify(
    {success:true,count:2,updated:'old',data:[{date:'2026-08-10',hosp:'병원0'}],_rows:2,rev:'OLDREV123456'});
  a.cache['handover_all__meta']=JSON.stringify({rev:'OLDREV123456',updated:'old',count:2,rows:2});
  const afterV1=a.getAll_({rev:'OLDREV123456'});
  ck('25. 배포 직후 v1 메타가 남아 있어도 nochange 로 돌려보내지 않는다', afterV1.nochange!==true);
  ck('26. v1 본문 캐시를 재사용하지 않고 row 포함 데이터를 새로 만든다',
    afterV1.schema===2 && afterV1.data[0].row===100);

  a=buildAll([]);
  const empty=a.getAll_({});
  ck('27. 빈 데이터셋에서도 스키마 전환이 정상이다',
    empty.schema===2 && empty.count===0 && empty.data.length===0 &&
    Number(JSON.parse(a.cache['handover_all__meta']||'{}').schema)===2);
  a=buildAll([{'처리일':'2026-08-10','병원명':'병원X'}]);
  ck('28. _row 가 없는 행도 row=0 으로 안전하게 처리한다', a.getAll_({}).data[0].row===0);
}

/* ══════ 29~33. 접근성 · 레이아웃 회귀 방지 ══════ */
{
  /* 주석 설명문이 아니라 실제로 만들어지는 속성 문자열만 본다 */
  const table=grab(DASH,'exHistoryTable_').replace(/\/\*[\s\S]*?\*\//g,'');
  ck('29. <tr> 에 role="button" 을 주지 않는다(표의 행·열 의미 보존)',
    !/role="button"/.test(table));
  ck('30. 선택 행은 aria-current 로 표시한다',
    /aria-current/.test(grab(DASH,'exSelectHistory_')));
  /* 사진 패널이 열려도 이력 표가 0 높이로 접히면 목록을 쓸 수 없다 */
  ck('31. 사진 패널은 공간이 모자라면 스스로 줄고 내부 스크롤한다',
    /\.hst-photo-panel\{flex:0 1 auto;min-height:0;[^}]*overflow-y:auto\}/.test(DASH));
  ck('32. 이력 표에 최소 높이가 보장된다',
    /\.hst-view \.hst-table-wrap\{min-height:\d+px\}/.test(DASH));
  ck('33. 모바일에서는 이력 화면 전체가 스크롤된다',
    /\.hst-view\{overflow-y:auto;/.test(DASH));
  ck('34. 토큰 만료는 재로그인 안내로 구분한다',
    /kind==='auth'/.test(grab(DASH,'exSelectHistory_')));
  /* 사진 <img>는 로드 완료 전까지 hidden 이다. 여기에 loading="lazy" 를 함께 주면
     레이아웃 상자가 없어 뷰포트와 겹치지 않고, 브라우저가 요청을 영원히 미뤄
     onload 가 오지 않는다 → 사진이 절대 표시되지 않는다(실측 확인). */
  ck('35. 대표 사진 <img>에 loading="lazy" 를 쓰지 않는다',
    !/loading="lazy"/.test(panel.replace(/\/\*[\s\S]*?\*\//g,'')));
  ck('36. 대표 사진 <img>는 로드 전까지 hidden 이다',
    (panel.match(/hidden>/g)||[]).length===2);
}

console.log('\n──────────────────────────────');
console.log(`통과 ${pass}/${total}`);
if(fails.length){ console.log('실패:'); fails.forEach(f=>console.log(' -',f)); process.exit(1); }
console.log('모든 테스트 통과 ✅');
