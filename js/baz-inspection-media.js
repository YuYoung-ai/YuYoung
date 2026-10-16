(function(root){
 'use strict';
 let worker=null,disabled=false,next=0,tail=Promise.resolve();
 const pending=new Map();
 function bounded(start,message){return new Promise((resolve,reject)=>{
  let settled=false,cleanup;
  const timer=setTimeout(()=>finish(new Error(message)),30000);
  function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);if(cleanup)cleanup();error?reject(error):resolve(value);}
  try{cleanup=start(value=>finish(null,value),error=>finish(error));if(settled&&cleanup)cleanup();}catch(e){finish(e);}
 });}
 function dataUrl(blob){return bounded((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('사진 파일을 읽지 못했습니다.'));r.readAsDataURL(blob);return ()=>{r.onload=r.onerror=null;if(r.readyState===1)r.abort();};},'사진 파일 읽기가 지연되고 있습니다. 사진을 다시 선택해 주세요.');}
 function stop(){disabled=true;if(worker)worker.terminate();worker=null;for(const p of pending.values())p.reject(new Error('Worker unavailable'));pending.clear();}
 function getWorker(){
  if(disabled||!root.Worker||!root.createImageBitmap||!root.OffscreenCanvas)return null;
  if(!worker){worker=new Worker('js/baz-inspection-media-worker.js?v=245');worker.onmessage=e=>{const p=pending.get(e.data.id);if(!p)return;pending.delete(e.data.id);e.data.error?p.reject(new Error(e.data.error)):p.resolve(e.data);};worker.onerror=stop;}
  return worker;
 }
 async function fallback(blob,opts){
  const url=URL.createObjectURL(blob),image=new Image();let canvas;
  try{
   await bounded((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('이 사진 형식을 읽지 못했습니다. JPEG 또는 PNG 사진으로 다시 선택하세요.'));image.src=url;return ()=>{image.onload=image.onerror=null;};},'사진을 여는 데 시간이 오래 걸립니다. 사진을 다시 선택해 주세요.');
   if(!image.naturalWidth||!image.naturalHeight)throw new Error('사진 크기를 확인하지 못했습니다. 사진을 다시 선택해 주세요.');
   const scale=Math.min(1,opts.maxDimension/Math.max(image.naturalWidth,image.naturalHeight)),width=Math.max(1,Math.round(image.naturalWidth*scale)),height=Math.max(1,Math.round(image.naturalHeight*scale));
   canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('사진 처리 메모리가 부족합니다. 다른 앱을 닫고 다시 선택해 주세요.');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(image,0,0,width,height);
   const result=await bounded((resolve,reject)=>{canvas.toBlob(b=>b?resolve(b):reject(new Error('사진 압축에 실패했습니다.')),'image/jpeg',opts.quality);},'사진 압축이 지연되고 있습니다. 사진을 다시 선택해 주세요.');
   return {blob:result,width,height,worker:false};
  }finally{URL.revokeObjectURL(url);if(canvas)canvas.width=canvas.height=0;}
 }
 async function process(blob,opts){
  opts={maxDimension:1600,quality:.8,...opts};let result;
  let w;try{w=getWorker();}catch(e){stop();}
  if(w){const id=++next;try{result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);stop();reject(new Error('Worker timeout'));},30000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});w.postMessage({id,blob,...opts});});}catch(e){stop();}}
  if(!result)result=await fallback(blob,opts);
  return {...result,data:await dataUrl(result.blob)};
 }
 function enqueue(blob,opts){const job=tail.catch(()=>{}).then(()=>process(blob,opts));tail=job.catch(()=>{});return job;}
 async function fromData(data,opts){const blob=await (await fetch(data)).blob();return enqueue(blob,opts);}
 root.BazInspectionMedia={process:enqueue,fromData};
})(window);
