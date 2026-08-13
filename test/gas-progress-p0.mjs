/************************************************************
 * gas-progress-p0.mjs
 * 새로고침 부하·진행상태 동시성 P0 회귀 테스트
 * 실행: node test/gas-progress-p0.mjs
 ************************************************************/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const read=n=>fs.readFileSync(path.join(HERE,'..',n),'utf8');
const G=read('handover_gas.gs');
const H=read('hospital-pc.html');
const D=read('dashboard-pc.html');
const SW=read('sw.js');

let pass=0,total=0; const fails=[];
function ck(name,cond){ total++; if(cond){pass++;console.log('✅',name);}else{fails.push(name);console.log('❌',name);} }
function grab(src,name){
  const at=src.search(new RegExp('\\bfunction\\s+'+name.replace(/[$]/g,'\\$&')+'\\s*\\('));
  if(at<0) throw new Error('함수를 찾지 못했습니다: '+name);
  let depth=0;
  for(let j=src.indexOf('{',at);j<src.length;j++){
    if(src[j]==='{') depth++;
    else if(src[j]==='}'&&--depth===0) return src.slice(at,j+1);
  }
  throw new Error('함수 끝을 찾지 못했습니다: '+name);
}

const save=grab(G,'progSave_'), restore=grab(G,'progRestore_'), get=grab(G,'progGet_'),
      write=grab(G,'progWrite_'), prune=grab(G,'reqPrune_'), boot=grab(G,'getBootstrap_'),
      nochange=grab(G,'syncNochange_'), builtNochange=grab(G,'syncNochangeFrom_'),
      hSend=grab(H,'pcProgSend'), hRetry=grab(H,'bazGetRetry'), hTransient=grab(H,'bazTransient_'),
      hBoot=grab(H,'bazBootSync'), dFetch=grab(D,'fetchAllRetry'), dHosp=grab(D,'loadHospDB');

ck('progress_save: waitLock 실패 시 busy 반환',
  /waitLock\(15000\)/.test(save)&&/catch\(lockErr\)\{ return \{success:false, busy:true/.test(save)&&!/tryLock/.test(save));
ck('progress_restore: waitLock 실패 시 busy 반환',
  /waitLock\(15000\)/.test(restore)&&/catch\(lockErr\)\{ return \{success:false, busy:true/.test(restore)&&!/tryLock/.test(restore));
const busySave=new Function('LockService',save+'; return progSave_;')(
  {getScriptLock:()=>({waitLock:()=>{throw new Error('contended');},releaseLock:()=>{}})}
)({op:'q_add',fse:'Kim',hosp:'A'});
ck('progress_save 실행: 락 경합 시 적용 없이 busy 응답',busySave.success===false&&busySave.busy===true);
ck('progress GET: 롤오버 락 획득 뒤 상태 재확인',
  get.indexOf('waitLock(10000)')>=0&&get.indexOf('o=progRead_()')>get.indexOf('waitLock(10000)'));
ck('progress GET: 롤오버 저장은 락 구간 안에서 실행',
  get.indexOf('progWrite_(o)')>get.indexOf('waitLock(10000)')&&get.indexOf('lock.releaseLock()')>get.indexOf('progWrite_(o)'));
ck('progress GET: 락 실패 시 오래된 상태를 성공 응답하지 않음',
  /return \{success:false, busy:true/.test(get));

const directStores=(G.match(/setProperty\('cs_progress'/g)||[]).length;
ck('cs_progress 직접 저장은 progWrite_ 한 곳뿐',directStores===1&&/setProperty\('cs_progress',s\)/.test(write));
ck('progWrite_: 저장 직전 내부 필드 제거',write.indexOf('progStrip_(o)')<write.indexOf("setProperty('cs_progress'"));
ck('progWrite_: 8000B 경고·9000B 차단',/n>8000/.test(write)&&/n>9000/.test(write)&&/progress-too-large/.test(write));

ck('진행상태 쓰기: no-cors blind retry 제거',!H.includes("mode:'no-cors'")&&!H.includes('mode:"no-cors"'));
ck('진행상태 쓰기: AbortController 15초 타임아웃',/AbortController/.test(hSend)&&/15000/.test(hSend)&&/\.abort\(\)/.test(hSend));
ck('진행상태 쓰기 실패: hold 해제 후 즉시 폴링',
  /pcProgHold=0/.test(hSend)&&/pcProgRev=0/.test(hSend)&&/pcProgWake\(\)/.test(hSend));
ck('진행상태 busy: 자동 재전송 없이 사용자에게 알림',/d && d\.busy/.test(hSend)&&/다른 일정 저장/.test(hSend));

ck('병원 조회: timeout·network를 일시 오류로 분류',
  /e\.kind==='network'/.test(hTransient)&&/e\.kind==='timeout'/.test(hTransient));
ck('병원 조회: 700ms → 2100ms 백오프',/2100:700/.test(grab(H,'bazRetryWait_')));
ck('병원 조회: timeout 자동 재시도는 최대 1회',/timeoutRetries<1/.test(hRetry));
ck('전량 조회: 45초·폴링 12초 타임아웃 분리',
  /BAZ_TIMEOUT_FULL=45000/.test(H)&&/BAZ_TIMEOUT_POLL=12000/.test(H)&&
  /DASH_TIMEOUT_FULL=45000/.test(D)&&/DASH_TIMEOUT_PING=10000/.test(D));

ck('force: 메타 rev만으로 nochange 하지 않음',/if\(syncForce_\(p\)\) return null/.test(nochange));
ck('force: 새 원본 rev 계산 뒤에는 nochange 가능',!/syncForce_/.test(builtNochange));
ck('force: 병원 bootstrap에 hrev·irev·arev 동봉',
  /HDB_DATA_REV/.test(hBoot)&&/ISSUE_DATA_REV/.test(hBoot)&&/PC_RECENT_REV/.test(hBoot)&&/refreshall=1/.test(hBoot));
ck('force: 대시보드 all·hospdb에 기존 rev 동봉',
  /force\?'&force=1':''/.test(dFetch)&&/rev\?'&rev=/.test(dFetch)&&/force\?\{force:1,rev:HOSPDB_REV\}/.test(dHosp));

ck('요청 스코프: readAllMemo_ 도입·GET/POST 진입 시 초기화',
  /function readAllMemo_\(/.test(G)&&(G.match(/_readAllMemo = null/g)||[]).length>=3);
const plainReads=(G.match(/readAll_\(\)/g)||[]).length;
ck('사진 없는 readAll_ 직접 호출은 메모 함수 내부 한 곳뿐',plainReads===1);
ck('강제 bootstrap: issuehist와 all 캐시가 같은 원본 읽기를 공유',
  /getAll_\(\{force:'1', rev:syncRevParam_\(p,'arev'\)\}\)/.test(boot)&&/pcLoadRecent\(null,false\)/.test(H));

ck('reqPrune_: 일괄 getProperties + 확률 실행',
  /Math\.random\(\) > 0\.05/.test(prune)&&/getProperties\(\)/.test(prune)&&!/getProperty\(/.test(prune));
ck('reqPrune_: TTL 정리가 보관 건수 검사보다 먼저',
  prune.indexOf('now - ts > REQ_TTL_MS')<prune.indexOf('rows.length <= REQ_KEEP'));
ck('계측: 서버 응답과 클라이언트 콘솔에 시간·행·캐시·바이트 포함',
  /function syncObserved_\(/.test(G)&&/_ms/.test(G)&&/_rows/.test(G)&&/_cache/.test(G)&&/_bytes/.test(G)&&
  /console\.info\('\[동기화\]/.test(H)&&/console\.info\('\[동기화\]/.test(D));

/* deriveProg_ 파생 규칙은 실제 실행해 큐 스키마와 자동 승격을 보존하는지 확인한다. */
const deriveSrc=grab(G,'deriveProg_');
const derive=new Function(deriveSrc+'; return deriveProg_;')();
const state={queues:{Kim:[{h:'A',s:'wait'},{h:'B',s:'done'}]},prog:{},done:{legacy:1}};
derive(state);
ck('deriveProg_: 첫 wait 자동 승격·prog 파생',state.queues.Kim[0].s==='prog'&&state.prog.A==='Kim');
ck('deriveProg_: done 큐 항목을 완료 맵에 파생',state.done.B===1);
ck('deriveProg_: P0에서 레거시 done 의미를 바꾸지 않음',state.done.legacy===1);

/* progWrite_를 mock 저장소에서 실행해 내부 필드 비영속화와 크기 차단을 검증한다. */
const writerSrc=[grab(G,'progStrip_'),grab(G,'progBytes_'),write].join('\n');
let stored='';
const writer=new Function('Utilities','PropertiesService','Logger',writerSrc+'; return progWrite_;')(
  {newBlob:s=>({getBytes:()=>({length:Buffer.byteLength(s)})})},
  {getScriptProperties:()=>({setProperty:(k,v)=>{stored=k+':'+v;}})},
  {log:()=>{}}
);
const small={queues:{Kim:[{h:'A',s:'prog'}]},prog:{A:'Kim'},done:{},_snap:{x:1},_reset:true};
const smallBytes=writer(small);
ck('progWrite_ 실행: _snap/_reset이 저장 JSON에 없음',smallBytes>0&&!stored.includes('_snap')&&!stored.includes('_reset'));
let tooLarge=false;
try{ writer({queues:{Kim:[{h:'X'.repeat(9100),s:'prog'}]},prog:{},done:{}}); }catch(e){ tooLarge=/progress-too-large/.test(String(e)); }
ck('progWrite_ 실행: 9000B 초과를 실제로 차단',tooLarge);

/* 자정 롤오버는 fake Lock/Properties로 실제 실행한다. 첫 읽기 뒤 락을 얻고 다시 읽은 다음
   한 번만 저장하는지, 락 실패에서는 어떤 공유 상태도 쓰지 않는지 검증한다. */
const rolloverSrc=[
  grab(G,'progRead_'),grab(G,'qEnsure_'),grab(G,'qFind_'),deriveSrc,
  grab(G,'progStrip_'),grab(G,'progBytes_'),write,
  "function schedNow_(){ return '2026-08-13 00:00:01'; }",get
].join('\n');
function makeRollover(lockFails){
  let raw=JSON.stringify({day:'2026-08-12',queues:{Kim:[{h:'A',s:'prog'}]},prog:{A:'Kim'},done:{},rev:4});
  let reads=0,writes=0,waits=0,releases=0,snaps=0;
  const props={
    getProperty:k=>{ if(k==='cs_progress') reads++; return k==='cs_progress'?raw:null; },
    setProperty:(k,v)=>{ if(k==='cs_progress'){ writes++; raw=v; } }
  };
  const fn=new Function('Utilities','PropertiesService','Logger','LockService',
    'schedSnapshotWrite_','schedLog_','schedLogPrune_',rolloverSrc+'; return progGet_;')(
    {formatDate:()=> '2026-08-13',newBlob:s=>({getBytes:()=>({length:Buffer.byteLength(s)})})},
    {getScriptProperties:()=>props},{log:()=>{}},
    {getScriptLock:()=>({waitLock:()=>{waits++;if(lockFails)throw new Error('busy');},releaseLock:()=>{releases++;}})},
    ()=>{snaps++;},()=>{},()=>{}
  );
  return {fn,stats:()=>({raw,reads,writes,waits,releases,snaps})};
}
const roll=makeRollover(false), rollOut=roll.fn({rev:4}), rollStats=roll.stats();
const rolledState=JSON.parse(rollStats.raw);
ck('롤오버 실행: 락 안 재확인 후 상태를 정확히 한 번 저장',
  rollOut.success===true&&rollStats.reads===2&&rollStats.waits===1&&rollStats.writes===1&&rollStats.releases===1);
ck('롤오버 실행: 어제 큐를 비우고 rev 증가·내부 필드 제거',
  rolledState.day==='2026-08-13'&&Object.keys(rolledState.queues).length===0&&rolledState.rev===5&&
  !('_snap' in rolledState)&&!('_reset' in rolledState));
ck('롤오버 실행: 어제 스냅샷은 상태 저장 뒤 한 번 기록',rollStats.snaps===1);
const blocked=makeRollover(true), blockedOut=blocked.fn({rev:4}), blockedStats=blocked.stats();
ck('롤오버 실행: 락 실패 시 쓰기·스냅샷 없이 busy',
  blockedOut.success===false&&blockedOut.busy===true&&blockedStats.writes===0&&blockedStats.snaps===0);

ck('배포: 서비스워커 캐시 버전 132 이상',Number((SW.match(/baz-cs-v(\d+)/)||[])[1]||0)>=132);

console.log('\n──────────────────────────────');
console.log('통과 '+pass+'/'+total);
if(fails.length){fails.forEach(f=>console.log(' -',f));process.exit(1);}
console.log('모든 테스트 통과 ✅');
