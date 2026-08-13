import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../ncare_dashboard_gas.gs', import.meta.url), 'utf8');
let pass = 0, fail = 0;
function ck(name, ok, detail=''){
  if(ok){ pass++; console.log('✅', name); }
  else { fail++; console.error('❌', name, detail); }
}
function grab(name){
  const start = SRC.indexOf('function '+name+'(');
  if(start < 0) throw new Error('함수를 찾지 못했습니다: '+name);
  const brace = SRC.indexOf('{', start);
  let depth=0, quote='', esc=false;
  for(let i=brace;i<SRC.length;i++){
    const ch=SRC[i];
    if(quote){ if(esc) esc=false; else if(ch==='\\') esc=true; else if(ch===quote) quote=''; continue; }
    if(ch==='"'||ch==="'"||ch==='`'){ quote=ch; continue; }
    if(ch==='{') depth++;
    if(ch==='}' && --depth===0) return SRC.slice(start,i+1);
  }
  throw new Error('함수 끝을 찾지 못했습니다: '+name);
}

try{
  new vm.Script(SRC);
  ck('0. ncare_dashboard_gas.gs 전체 JavaScript 구문 유효', true);
}catch(err){
  ck('0. ncare_dashboard_gas.gs 전체 JavaScript 구문 유효', false, err.message);
}

const pure = {};
vm.createContext(pure);
vm.runInContext(grab('hospitalGeoText_')+'\n'+grab('hospitalGeoNeedsFill_'), pure);

ck('1. 적용 시트·열·시작 행 고정',
  /SHEET:\s*'병원정보DB'/.test(SRC) && /START_ROW:\s*3/.test(SRC) &&
  /ADDRESS_COL:\s*5/.test(SRC) && /LAT_COL:\s*14/.test(SRC) && /LNG_COL:\s*15/.test(SRC));
ck('2. 주소가 있고 좌표가 모두 비었으면 처리', pure.hospitalGeoNeedsFill_('서울 강남구', '', ''));
ck('3. 위도 또는 경도 한쪽만 비어도 불완전 좌표로 처리',
  pure.hospitalGeoNeedsFill_('서울', 37.1, '') && pure.hospitalGeoNeedsFill_('서울', '', 127.1));
ck('4. 기존 위·경도가 모두 있으면 건너뜀', !pure.hospitalGeoNeedsFill_('서울', 37.1, 127.1));
ck('5. 주소가 비어 있으면 처리하지 않음', !pure.hospitalGeoNeedsFill_('', '', ''));
ck('6. 기존 조회 메뉴를 유지하고 지오코딩 메뉴 추가',
  /addItem\('선택 항목 조회', 'filterHospitalDB'\)/.test(SRC) &&
  /addItem\('빈 위·경도 자동 채우기', 'fillMissingHospitalCoordinates'\)/.test(SRC));
ck('7. Google 한국어·한국 지역 지오코더 사용',
  /Maps\.newGeocoder\(\)/.test(SRC) && /setLanguage\('ko'\)/.test(SRC) && /setRegion\('kr'\)/.test(SRC));
ck('8. 검색 실패 시 0,0을 기록하지 않고 null 처리',
  /memo\[normalized\] = .*\? \{lat:lat, lng:lng\} : null/.test(grab('geocodeHospitalAddress_')));
ck('9. 대량 데이터는 제한된 묶음과 후속 트리거로 처리',
  /BATCH_SIZE:\s*40/.test(SRC) && /timeBased\(\)\.after\(60 \* 1000\)/.test(SRC));
ck('10. 자동 갱신은 권한 승인 가능한 설치형 onEdit 트리거',
  /newTrigger\(handler\)\.forSpreadsheet\(ss\)\.onEdit\(\)\.create\(\)/.test(SRC));
const edit = grab('handleHospitalAddressEdit_');
ck('11. 주소 E열과 겹치는 수정만 처리',
  /ADDRESS_COL < firstCol \|\| HOSPITAL_GEO\.ADDRESS_COL > lastCol/.test(edit));
ck('12. 주소 변경 행의 기존 N·O를 잠금 대기 전 먼저 지움',
  /getRange\(firstRow, HOSPITAL_GEO\.LAT_COL, rows, 2\)\.clearContent\(\)/.test(edit) &&
  edit.indexOf('.clearContent()') < edit.indexOf('LockService.getDocumentLock()'));
ck('13. 주소 삭제·검색 실패는 빈 좌표로 유지', /out\.push\(point \? \[point\.lat, point\.lng\] : \['', ''\]\)/.test(edit));
ck('14. 여러 행 붙여넣기도 전체 행 범위를 인식', /e\.range\.getLastRow\(\)/.test(edit));
ck('15. 동시 실행으로 좌표가 섞이지 않도록 문서 잠금 사용',
  (SRC.match(/LockService\.getDocumentLock\(\)/g)||[]).length >= 2);
ck('16. 좌표 변경 시 병원정보DB 응답 캐시도 즉시 무효화',
  /bazCacheDrop_\('hospdb_all'\)/.test(grab('dropHospitalGeoResponseCache_')) &&
  /dropHospitalGeoResponseCache_\(\)/.test(edit));

console.log(`\n통과 ${pass}/${pass+fail}`);
if(fail) process.exit(1);
