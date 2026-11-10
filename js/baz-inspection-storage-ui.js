(function(root){
 'use strict';
 const size=n=>n>=1048576?(n/1048576).toFixed(2)+' MB':Math.ceil(n/1024)+' KB';
 function download(text,name){const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 async function open(o){
  const dialog=document.createElement('dialog');dialog.className='inspection-storage-dialog';dialog.style.cssText='box-sizing:border-box;margin:auto;width:min(660px,calc(100vw - 24px));max-height:85dvh;overflow:auto;padding:22px;border:1px solid #8797ad;border-radius:18px;background:var(--surface,#fff);color:var(--text,#183347);font:inherit;line-height:1.6';
  dialog.innerHTML='<h2>초안 저장 공간</h2><p data-summary role="status">저장소 확인 중…</p><p data-estimate></p><p>초안과 사진은 이 브라우저에 보관됩니다. 기기를 옮기거나 사이트 데이터를 지우기 전에 백업하세요. 백업에는 사진·서명과 병원 정보가 포함됩니다.</p><div style="display:flex;gap:8px;flex-wrap:wrap;margin:16px 0"><button data-current>현재 화면 백업</button><button data-backup>전체 초안 백업</button><button data-import>백업 가져오기</button><button data-cache>조회 캐시 정리</button><button data-gc>사용하지 않는 사진 정리</button><button data-persist>기기 보관 권한 요청</button><button data-raw hidden>이전 저장 원본 백업</button></div><input data-file type="file" accept="application/json,.json" hidden><p data-result role="status" aria-live="polite"></p><div data-tasks></div><p style="font-size:14px">기기에서 정리는 완료 작업의 사진·서명을 포함한 원본을 클라우드에서 다시 확인한 경우에만 가능합니다. 현재 작업과 미완료 PDF 전송은 보호합니다.</p><button data-close>닫기</button>';
  const style=document.createElement('style');style.textContent='.inspection-storage-dialog h2{font-size:22px;margin-bottom:12px}.inspection-storage-dialog p{margin:10px 0}.inspection-storage-dialog button{min-height:44px;padding:10px 12px;border:1px solid #9aabc0;border-radius:9px;background:var(--gray-cell,#edf0f5);color:inherit;font:inherit;font-size:14px;cursor:pointer}.inspection-storage-dialog button:focus-visible{outline:3px solid #2e7d9e}.inspection-storage-dialog::backdrop{background:#101d39aa}';dialog.append(style);
  document.body.append(dialog);dialog.showModal();dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  const q=s=>dialog.querySelector(s),say=t=>{q('[data-result]').textContent=t;};let ready=false,busy=false;
  const wrap=fn=>async()=>{if(busy)return;busy=true;try{o.checkAccount();await fn();}catch(e){say(e.message||'작업을 완료하지 못했습니다.');}finally{busy=false;}};
  q('[data-close]').onclick=()=>{if(!busy)dialog.close();};dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  async function refresh(){
   const cache=root.BazBrowserStorage.inspect();
   if(!ready){q('[data-summary]').textContent='초안 저장소를 열지 못했습니다. 기존 원본을 백업한 뒤 다시 시도하세요.';return;}
   const usage=await o.repository.usage();q('[data-summary]').textContent='초안 '+usage.tasks+'개 · 사진·서명 '+size(usage.bytes)+' · 이전 작업 '+usage.legacy+'개 · 조회 캐시 '+size(cache.cleanableBytes);q('[data-tasks]').replaceChildren();
   for(const task of usage.items){
    const row=document.createElement('div');row.style.cssText='padding:12px 0;border-bottom:1px solid #aaa6';const label=document.createElement('p');label.textContent=task.hospital+' · '+size(task.bytes)+(task.owner===o.repository.legacyOwner?' · 이전 작업 (원본 보존)':'');row.append(label);
    const backup=document.createElement('button');backup.textContent='이 작업 백업';backup.onclick=wrap(async()=>{download(await o.repository.backup([task.id],task.owner),'점검초안-'+task.id+'.json');say('백업 파일을 만들었습니다. 안전하게 보관하세요.');});row.append(backup);
    if(task.owner===o.repository.owner&&task.status==='completed'&&task.id!==o.current()){
     const release=document.createElement('button');release.textContent='기기에서 정리';release.style.marginLeft='8px';release.onclick=wrap(async()=>{
      if(!navigator.onLine)throw new Error('인터넷 연결 후 원본을 확인해야 합니다.');say('클라우드 초안과 미완료 PDF 전송을 확인하는 중…');
      const protectedIds=await o.outbox.protectedTaskIds();protectedIds.push(o.current());const response=await o.cloudGet({action:'get',taskId:task.id});o.checkAccount();
      if(!response?.success||response.task?.taskId!==task.id)throw new Error('클라우드 원본을 확인하지 못했습니다.');const remote=response.task,data=typeof remote.data==='string'?JSON.parse(remote.data):remote.data;
      if(!confirm('클라우드에서 확인한 완료 초안을 이 기기에서 정리할까요? 클라우드·Drive·Handover 기록은 유지됩니다.'))return;
      await o.repository.release(task.id,{data,updatedAt:new Date(remote.updatedAt).getTime()},protectedIds);await o.repository.collectGarbage();o.onChange();await refresh();say('기기의 완료 초안을 정리했습니다. 작업 목록에서 클라우드 원본을 다시 불러올 수 있습니다.');
     });row.append(release);
    }
    q('[data-tasks]').append(row);
   }
  }
  q('[data-current]').onclick=wrap(async()=>{download(await o.repository.backupCurrent(o.snapshot()),'점검초안-현재화면.json');say('현재 화면을 사진·서명과 함께 백업했습니다.');});
  q('[data-gc]').onclick=wrap(async()=>{if(!ready)throw new Error('초안 이전을 먼저 완료하세요.');await o.repository.collectGarbage();await refresh();say('어떤 초안에서도 사용하지 않는 사진 파일만 정리했습니다. 초안과 미완료 PDF는 유지됩니다.');});
  q('[data-cache]').onclick=wrap(async()=>{const result=root.BazBrowserStorage.cleanup();await refresh();say('조회 캐시 '+result.count+'개 · '+size(result.bytes)+' 정리했습니다.');});
  q('[data-backup]').onclick=wrap(async()=>{if(!ready)throw new Error('이전 저장 원본 백업을 먼저 사용하세요.');if(!await o.save())throw new Error('현재 화면을 저장하지 못했습니다. 기존 초안의 작업별 백업과 PDF 파일 공유를 이용하세요.');download(await o.repository.backup(),'점검초안-백업-'+new Date().toISOString().slice(0,10)+'.json');say('전체 초안 백업 파일을 만들었습니다.');});
  q('[data-import]').onclick=()=>{if(!busy&&ready)q('[data-file]').click();};q('[data-file]').onchange=wrap(async()=>{const file=q('[data-file]').files[0];if(!file)return;if(file.size>150*1024*1024)throw new Error('백업 파일이 너무 큽니다.');const count=await o.repository.restore(await file.text());await refresh();o.onChange();say(count+'개 초안을 검증해 이전 작업으로 보관했습니다. 작업 목록에서 선택해 현재 계정으로 가져올 수 있습니다.');});
  q('[data-persist]').onclick=wrap(async()=>{if(!navigator.storage?.persist)throw new Error('이 브라우저는 보관 권한 요청을 지원하지 않습니다. 백업 파일도 보관하세요.');say(await navigator.storage.persist()?'기기 보관 권한이 허용되었습니다. 백업 파일도 보관하세요.':'브라우저가 보관 권한을 허용하지 않았습니다. 백업 파일도 보관하세요.');});
  const oldKeys=['inspection_tasks_v1','baz_inspection_draft_v1','inspection_sync_queue_v1','inspection_sync_delete_v1'];
  q('[data-raw]').onclick=()=>{const values={};for(const key of oldKeys){const v=localStorage.getItem(key);if(v!==null)values[key]=v;}download(JSON.stringify({format:'baz-inspection-legacy-source',version:1,values}),'점검초안-이전원본.json');say('이전 저장 원본을 백업했습니다.');};q('[data-raw]').hidden=!oldKeys.some(key=>localStorage.getItem(key));
  try{await o.ready;ready=true;}catch(e){say(e.message);}await refresh();navigator.storage?.estimate?.().then(e=>{q('[data-estimate]').textContent='사이트 전체 사용 추정 '+size(e.usage||0)+' / '+size(e.quota||0)+' (파일·캐시 포함)';}).catch(()=>{});
 }
 root.BazInspectionStorageUI={open};
})(window);
