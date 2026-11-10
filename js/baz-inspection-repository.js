(function(root){
  'use strict';
  // Drafts use binary assets. The small in-memory index never contains photo bytes.
  // The owner is the existing opaque authenticated account ID, never a token.
  const DB='baz-inspection-drafts-v2', LEGACY='legacy-unassigned';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const error=message=>new Error(message);
  async function digest(bytes){return Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
  async function archive(tasks){const body={format:'baz-inspection-backup',version:1,createdAt:new Date().toISOString(),tasks};return JSON.stringify({...body,sha256:await digest(new TextEncoder().encode(JSON.stringify(body)))});}
  function create(options){
    const idb=options.indexedDB,ls=options.storage,owner=options.owner;
    let db,index=[],queue=[],opening,chain=Promise.resolve(),currentId=null;
    const tabId=Math.random().toString(36).slice(2)+Date.now().toString(36);
    const key=id=>owner+'|'+id;
    function serial(fn){const result=chain.catch(()=>{}).then(fn);chain=result;return result;}
    function transaction(stores,mode,run){return new Promise((resolve,reject)=>{
      const tx=db.transaction(stores,mode);let value,problem,settled=false;
      const timer=setTimeout(()=>{problem=error('초안 저장소의 응답이 지연됩니다. 현재 화면을 유지하고 다시 시도하세요.');try{tx.abort();}catch{}finish(problem);},15000);
      function finish(e){if(settled)return;settled=true;clearTimeout(timer);e?reject(e):resolve(value);}
      tx.oncomplete=()=>finish();tx.onerror=()=>{};tx.onabort=()=>finish(problem||tx.error||error('초안을 저장하지 못했습니다.'));
      try{run(tx,v=>{value=v;},e=>{problem=e;tx.abort();});}catch(e){problem=e;try{tx.abort();}catch{}finish(e);}
    });}
    async function reload(){
      const all=await transaction(['tasks','queue'],'readonly',(tx,set)=>{
        const tasks=tx.objectStore('tasks').getAll();tasks.onsuccess=()=>{const q=tx.objectStore('queue').getAll();q.onsuccess=()=>set({tasks:tasks.result,queue:q.result});};
      });
      index=all.tasks.filter(t=>t.owner===owner||t.owner===LEGACY);queue=all.queue.filter(q=>q.owner===owner);
    }
    function changed(){options.onChange?.();}
    const channel=root.BroadcastChannel?new root.BroadcastChannel(DB):null;
    channel?.addEventListener('message',()=>{options.onExternalChange?.();});
    async function encode(task,scope){
      const result=clone(task),assets=new Map();
      async function asset(value){
        if(!value)return value;
        if(typeof value==='object'){
          if(typeof value.asset!=='string'||!value.asset.startsWith(scope+'|'))throw error('다른 계정의 사진 참조는 저장할 수 없습니다.');
          return value;
        }
        if(typeof value!=='string'||!/^data:image\//i.test(value))throw error('사진 또는 서명 형식이 올바르지 않습니다.');
        const blob=await (await fetch(value)).blob(),bytes=await blob.arrayBuffer(),hash=await digest(bytes),id=scope+'|'+hash;
        assets.set(id,{key:id,owner:scope,hash,type:blob.type,bytes,size:bytes.byteLength});
        return {asset:id};
      }
      for(const photo of result.data?.photos||[])photo.data=await asset(photo.data);
      if(result.data?.signatures)for(const k of Object.keys(result.data.signatures))result.data.signatures[k]=await asset(result.data.signatures[k]);
      result.owner=scope;result.key=scope+'|'+result.id;
      return {task:result,assets:[...assets.values()]};
    }
    function refs(task){return [...(task.data?.photos||[]).map(p=>p.data),...Object.values(task.data?.signatures||{})].filter(v=>v?.asset).map(v=>v.asset);}
    async function raw(scope,id){return transaction(['tasks'],'readonly',(tx,set)=>{const r=tx.objectStore('tasks').get(scope+'|'+id);r.onsuccess=()=>set(r.result||null);});}
    async function hydrate(task){
      if(!task)return null;const result=clone(task),cache=new Map();
      for(const id of new Set(refs(result))){
        const a=await transaction(['assets'],'readonly',(tx,set)=>{const r=tx.objectStore('assets').get(id);r.onsuccess=()=>set(r.result);});
        if(!a||await digest(a.bytes)!==a.hash)throw error('보관된 사진을 확인하지 못했습니다. 백업 또는 클라우드 원본을 확인하세요.');
        cache.set(id,await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(new Blob([a.bytes],{type:a.type}));}));
      }
      for(const photo of result.data?.photos||[])if(photo.data?.asset)photo.data=cache.get(photo.data.asset);
      for(const k of Object.keys(result.data?.signatures||{}))if(result.data.signatures[k]?.asset)result.data.signatures[k]=cache.get(result.data.signatures[k].asset);
      return result;
    }
    async function commit(task,expected,scope=owner,enqueue=true){
      const prepared=await encode(task,scope);
      async function write(){await transaction(['tasks','assets','queue'],'readwrite',(tx,set,fail)=>{
        const tasks=tx.objectStore('tasks'),r=tasks.get(prepared.task.key);
        r.onsuccess=()=>{
          try{
          if((r.result?.revision||0)!==expected){fail(error('다른 창에서 이 작업을 변경했습니다. 현재 내용을 백업한 뒤 작업을 다시 불러오세요.'));return;}
          prepared.task.revision=expected+1;
          for(const a of prepared.assets)tx.objectStore('assets').put(a);
          function store(){tasks.put(prepared.task);if(enqueue&&scope===owner)tx.objectStore('queue').put({key:key(task.id),owner,id:task.id,kind:'upsert',revision:prepared.task.revision});}
          const ids=[...new Set(refs(prepared.task))];let remaining=ids.length;
          if(!remaining)store();
          for(const id of ids){const a=tx.objectStore('assets').get(id);a.onsuccess=()=>{if(!a.result){fail(error('사진 참조를 확인하지 못했습니다. 현재 화면을 백업한 뒤 다시 불러오세요.'));return;}if(!--remaining)store();};}
          }catch(e){fail(e);}
        };
      });}
      try{await write();}catch(e){if(e.name!=='QuotaExceededError')throw e;options.cleanupCache?.();await write();}
      await reload();channel?.postMessage({owner,id:task.id});changed();return clone(prepared.task);
    }
    async function migrate(){
      // Only verified, unchanged sources are removed. Never infer ownership of old drafts.
      for(const source of ['inspection_tasks_v1','baz_inspection_draft_v1']){
        const text=ls.getItem(source);if(!text)continue;
        let tasks;try{const data=JSON.parse(text);tasks=source==='inspection_tasks_v1'?data:[{id:'old-single-draft',createdAt:data.savedAt||Date.now(),updatedAt:data.savedAt||Date.now(),status:'draft',data}];if(!Array.isArray(tasks))throw error('invalid');}catch{throw error('이전 초안 형식을 읽지 못했습니다. 원본은 보존했습니다. 저장 공간 메뉴에서 원본을 백업하세요.');}
        const sourceHash=await digest(new TextEncoder().encode(text));
        let completed=0;options.onMigrationProgress?.({completed,total:tasks.length});
        for(const task of tasks){
          if(!task?.id||!task.data)throw error('이전 초안에 손상된 항목이 있습니다. 원본은 보존했습니다.');
          let old=await raw(LEGACY,task.id);
          if(old?.migrationHash!==sourceHash){
            // Retain a changed source as a second copy, rather than overwrite a verified draft.
            const id=old?task.id+'-recovered-'+sourceHash.slice(0,10):task.id;
            old=await raw(LEGACY,id);
            if(!old)await commit({...task,id,migrationHash:sourceHash},0,LEGACY,false);
            else if(old.migrationHash!==sourceHash)throw error('이전 초안 충돌입니다. 원본은 보존했습니다.');
            const verified=await hydrate(await raw(LEGACY,id));
            if(JSON.stringify(verified.data)!==JSON.stringify(task.data))throw error('이전 초안 검증에 실패했습니다. 원본은 보존했습니다.');
          }else await hydrate(old);
          options.onMigrationProgress?.({completed:++completed,total:tasks.length});
        }
        await transaction(['meta'],'readwrite',(tx)=>tx.objectStore('meta').put({key:source,hash:sourceHash,count:tasks.length,verifiedAt:Date.now()}));
        if(ls.getItem(source)===text)ls.removeItem(source);
      }
      // Old delete intentions are not assigned to whichever account logs in next.
      // Preserve both old queues as evidence; importing a task creates a new owner-scoped queue.
    }
    async function ready(){
      if(opening)return opening;
      opening=(async()=>{
        if(!idb||!owner)throw error('로그인과 기기의 초안 저장소 사용 권한을 확인하세요.');
        db=await new Promise((resolve,reject)=>{
          const request=idb.open(DB,1),timer=setTimeout(()=>reject(error('초안 저장소를 열지 못했습니다. 다른 창을 닫고 다시 시도하세요.')),10000);
          request.onupgradeneeded=()=>{for(const s of ['tasks','assets','queue','meta'])request.result.createObjectStore(s,{keyPath:'key'});};
          request.onerror=()=>{clearTimeout(timer);reject(request.error);};request.onblocked=()=>{clearTimeout(timer);reject(error('다른 창의 초안 저장소를 닫고 다시 시도하세요.'));};
          request.onsuccess=()=>{clearTimeout(timer);resolve(request.result);};
        });
        db.onversionchange=()=>{db.close();options.onExternalChange?.();};
        await reload();await migrate();await reload();return api;
      })();return opening;
    }
    const api={ready,owner,legacyOwner:LEGACY,
      list:()=>[...index.filter(t=>t.owner===owner),...index.filter(t=>t.owner===LEGACY)].map(clone),
      get:async id=>{const t=await raw(owner,id)||await raw(LEGACY,id);return t?.localReleased?null:hydrate(t);},
      save:(task)=>serial(()=>{if(task.owner===LEGACY)throw error('이전 작업을 현재 계정으로 가져온 뒤 저장하세요.');return commit(task,task.revision||0);}),
      current:()=>transaction(['meta'],'readonly',(tx,set)=>{const r=tx.objectStore('meta').get('current|'+owner);r.onsuccess=()=>set(r.result?.id||null);}),
      setCurrent:id=>serial(async()=>{await transaction(['meta'],'readwrite',tx=>{const s=tx.objectStore('meta');s.put({key:'current|'+owner,id});s.put({key:'lease|'+owner+'|'+tabId,owner,id,updatedAt:Date.now(),lease:true});});currentId=id;}),
      claim:task=>serial(async()=>{const full=await hydrate(task),existing=await raw(owner,full.id);if(existing)return existing;full.owner=owner;full.revision=0;delete full.migrationHash;return commit(full,0);}),
      remove:(task)=>serial(async()=>{
        if(task.owner!==owner)throw error('이전 작업은 원본 보존을 위해 삭제할 수 없습니다.');
        await transaction(['tasks','queue'],'readwrite',(tx,set,fail)=>{const s=tx.objectStore('tasks'),r=s.get(key(task.id));r.onsuccess=()=>{if(r.result?.revision!==task.revision){fail(error('다른 창에서 변경된 작업입니다. 다시 불러오세요.'));return;}s.delete(key(task.id));tx.objectStore('queue').put({key:key(task.id),owner,id:task.id,kind:'remove'});};});
        await reload();changed();channel?.postMessage({owner,id:task.id});
      }),
      queue:kind=>queue.filter(q=>q.kind===kind).map(q=>q.id),
      acknowledge:(id,kind,revision)=>serial(async()=>{await transaction(['queue'],'readwrite',tx=>{const s=tx.objectStore('queue'),r=s.get(key(id));r.onsuccess=()=>{if(r.result?.kind===kind&&(revision==null||r.result.revision===revision))s.delete(key(id));};});await reload();}),
      enqueue:(id,kind)=>serial(async()=>{await transaction(['queue'],'readwrite',tx=>{const s=tx.objectStore('queue'),r=s.get(key(id));r.onsuccess=()=>{if(r.result?.kind==='remove'&&kind==='upsert')return;s.put({key:key(id),owner,id,kind,revision:index.find(t=>t.owner===owner&&t.id===id)?.revision});};});await reload();}),
      async usage(){
        const assets=await transaction(['assets'],'readonly',(tx,set)=>{const rows=[],r=tx.objectStore('assets').openCursor();r.onsuccess=()=>{const c=r.result;if(!c){set(rows);return;}const {key,owner,size}=c.value;rows.push({key,owner,size});c.continue();};});
        const bytes=new Map(assets.map(a=>[a.key,a.size]));
        return {tasks:index.filter(t=>!t.localReleased).length,legacy:index.filter(t=>t.owner===LEGACY).length,bytes:assets.filter(a=>a.owner===owner||a.owner===LEGACY).reduce((s,a)=>s+a.size,0),items:index.filter(t=>!t.localReleased).map(t=>({id:t.id,owner:t.owner,hospital:t.hospital||t.data?.basic?.hospital||'무제목',status:t.status,bytes:[...new Set(refs(t))].reduce((s,id)=>s+(bytes.get(id)||0),0)}))};
      },
      async backup(ids,scope){
        const tasks=[];for(const task of index.filter(t=>!t.localReleased&&(!ids||ids.includes(t.id))&&(!ids&&!scope||t.owner===(scope||owner))))tasks.push(await hydrate(task));
        return archive(tasks);
      },
      backupCurrent:task=>archive([clone(task)]),
      restore:text=>serial(async()=>{
        if(text.length>150*1024*1024)throw error('백업 파일이 너무 큽니다. 작업별 백업을 사용하세요.');
        const parsed=JSON.parse(text),{sha256,...body}=parsed;
        if(body.format!=='baz-inspection-backup'||body.version!==1||!Array.isArray(body.tasks)||body.tasks.length>1000||sha256!==await digest(new TextEncoder().encode(JSON.stringify(body))))throw error('백업 형식 또는 검증값이 올바르지 않습니다.');
        // Stage in the unassigned partition. Restores never upload or overwrite existing tasks.
        for(let i=0;i<body.tasks.length;i++){
          const t=body.tasks[i];if(!t.data||!Array.isArray(t.data.photos)||!t.data.basic)throw error('백업의 작업 형식이 올바르지 않습니다.');
          const id='restored-'+sha256.slice(0,12)+'-'+i;
          if(!await raw(LEGACY,id))await commit({...t,id},0,LEGACY,false);
          await hydrate(await raw(LEGACY,id));
        }
        return body.tasks.length;
      }),
      // Local release requires a full editable cloud round-trip, not just a PDF receipt.
      release:(id,verifiedTask,protectedIds)=>serial(async()=>{
        const task=index.find(t=>t.owner===owner&&t.id===id);
        if(!task||task.status!=='completed'||queue.some(q=>q.id===id)||protectedIds.includes(id))throw error('현재·미전송·동기화 대기 작업은 정리할 수 없습니다.');
        const full=await hydrate(task);
        if(JSON.stringify(full.data)!==JSON.stringify(verifiedTask.data)||Number(full.updatedAt)!==Number(verifiedTask.updatedAt))throw error('클라우드에서 사진·서명을 포함한 동일한 초안을 확인하지 못했습니다.');
        await transaction(['tasks','queue','meta'],'readwrite',(tx,set,fail)=>{
          const s=tx.objectStore('tasks'),r=s.get(key(id));r.onsuccess=()=>{
            if(r.result?.revision!==task.revision){fail(error('작업이 변경되어 정리를 중단했습니다.'));return;}
            const q=tx.objectStore('queue').get(key(id));q.onsuccess=()=>{
              if(q.result){fail(error('동기화 대기 중인 작업은 정리할 수 없습니다.'));return;}
              const m=tx.objectStore('meta').getAll();m.onsuccess=()=>{
                if(m.result.some(v=>v.lease&&v.owner===owner&&v.id===id&&Date.now()-v.updatedAt<120000)){fail(error('다른 창에서 열려 있는 작업은 정리할 수 없습니다.'));return;}
                s.put({...task,revision:task.revision+1,localReleased:true,data:{basic:task.data.basic,handover:task.data.handover,pdfDocument:task.data.pdfDocument}});
              };
            };
          };
        });
        await reload();changed();channel?.postMessage({owner,id});
      }),
      collectGarbage:()=>serial(async()=>{
        // Assets are independent of pending PDF blobs, which remain in their original DB.
        await transaction(['tasks','assets'],'readwrite',tx=>{const r=tx.objectStore('tasks').getAll();r.onsuccess=()=>{const used=new Set(r.result.flatMap(refs)),a=tx.objectStore('assets').openCursor();a.onsuccess=()=>{const c=a.result;if(!c)return;if(!used.has(c.key))c.delete();c.continue();};};});
      }),
      reload:()=>serial(reload)
    };
    root.setInterval?.(()=>{if(db&&currentId)transaction(['meta'],'readwrite',tx=>tx.objectStore('meta').put({key:'lease|'+owner+'|'+tabId,owner,id:currentId,updatedAt:Date.now(),lease:true})).catch(()=>{});},30000);
    return api;
  }
  root.BazInspectionRepository={create,DB};
})(typeof window==='object'?window:globalThis);
