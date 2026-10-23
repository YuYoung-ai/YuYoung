(function(root){
 'use strict';
 // PDF bytes and small checkpoints only. Never persist a session token/base64.
 function create(indexedDB,identityMatches){
  let opening,blobSupported=true;
  function open(){
   if(!indexedDB)return Promise.reject(new Error('이 기기에서 전송 파일을 보관할 수 없습니다.'));
   if(!opening)opening=new Promise((resolve,reject)=>{
    const request=indexedDB.open('baz-inspection-transfers-v1',1);let settled=false;
    const timer=setTimeout(()=>finish(new Error('기기 전송 보관함 응답이 지연됩니다.')),5000);
    function finish(error,db){if(settled){if(db)db.close();return;}settled=true;clearTimeout(timer);error?reject(error):resolve(db);}
    request.onupgradeneeded=()=>request.result.createObjectStore('jobs',{keyPath:'key'}).createIndex('byOwnerUpdated',['owner','updatedAt']);
    request.onerror=()=>finish(request.error);request.onblocked=()=>finish(new Error('다른 창의 전송 보관함을 닫고 다시 시도하세요.'));
    request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();opening=null;};finish(null,db);};
   }).catch(e=>{opening=null;throw e;});return opening;
  }
  async function transaction(mode,run,handle){
   const db=await open();return new Promise((resolve,reject)=>{
    let result,settled=false;const tx=db.transaction('jobs',mode),store=tx.objectStore('jobs');
    const timer=setTimeout(()=>{try{tx.abort();}catch{}finish(new Error('기기 전송 보관이 지연됩니다.'));},5000);
    function finish(error){if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result);}
    tx.oncomplete=()=>finish();tx.onerror=event=>finish(event.target?.error||tx.error||new Error('전송 파일 보관에 실패했습니다.'));tx.onabort=()=>finish(tx.error||new Error('전송 파일 보관에 실패했습니다.'));
    try{const request=run(store);request.onsuccess=()=>{if(handle)handle(request,value=>{result=value;});else result=request.result;};}catch(e){try{tx.abort();}catch{}finish(e);}
   });
  }
  async function put(job){
   async function binary(){const {blob,...rest}=job,bytes=await blob.arrayBuffer();return transaction('readwrite',store=>store.put({...rest,bytes,blobType:blob.type}));}
   if(job.blob&&!blobSupported)return binary();
   try{return await transaction('readwrite',store=>store.put(job));}
   catch(e){
    // Some WebKit/private-storage configurations reject IDB Blob preparation
    // while ArrayBuffer transactions work. Keep binary bytes, never base64/LS.
    if(!job.blob||!['UnknownError','DataCloneError','DataError'].includes(e.name))throw e;
    blobSupported=false;return binary();
   }
  }
  return {
   put,
   remove:key=>transaction('readwrite',store=>store.delete(key)),
   find:(owner,context)=>transaction('readonly',store=>store.index('byOwnerUpdated').openCursor(root.IDBKeyRange.bound([owner,0],[owner,Number.MAX_SAFE_INTEGER]),'prev'),(request,set)=>{const cursor=request.result;if(!cursor){set(null);return;}const r=cursor.value,c=r.context||{};if(((context.taskId&&c.taskId===context.taskId)||(context.recordId&&c.recordId===context.recordId))&&(!context.recordId||c.recordId===context.recordId)&&(!context.requestId||!c.requestId||context.requestId===c.requestId)&&(!identityMatches||!context.hospital||identityMatches(context,c))){const {bytes,blobType,...rest}=r;set(bytes?{...rest,blob:new Blob([bytes],{type:blobType||'application/pdf'})}:rest);}else cursor.continue();})
  };
 }
 root.BazInspectionOutbox={create};
})(typeof window==='object'?window:this);
