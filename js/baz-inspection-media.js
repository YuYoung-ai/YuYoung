(function(root){
 'use strict';
 let worker=null,disabled=false,next=0,tail=Promise.resolve();
 const pending=new Map();
 function dataUrl(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('사진 파일을 읽지 못했습니다.'));r.readAsDataURL(blob);});}
 function stop(){disabled=true;if(worker)worker.terminate();worker=null;for(const p of pending.values())p.reject(new Error('Worker unavailable'));pending.clear();}
 function getWorker(){
  if(disabled||!root.Worker||!root.createImageBitmap||!root.OffscreenCanvas)return null;
  if(!worker){worker=new Worker('js/baz-inspection-media-worker.js?v=245');worker.onmessage=e=>{const p=pending.get(e.data.id);if(!p)return;pending.delete(e.data.id);e.data.error?p.reject(new Error(e.data.error)):p.resolve(e.data);};worker.onerror=stop;}
  return worker;
 }
 async function fallback(blob,opts){
  const url=URL.createObjectURL(blob),image=new Image();let canvas;
  try{
   await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('이 사진 형식을 읽지 못했습니다. JPEG 또는 PNG 사진으로 다시 선택하세요.'));image.src=url;});
   const scale=Math.min(1,opts.maxDimension/Math.max(image.naturalWidth,image.naturalHeight)),width=Math.max(1,Math.round(image.naturalWidth*scale)),height=Math.max(1,Math.round(image.naturalHeight*scale));
   canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(image,0,0,width,height);
   const result=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('사진 압축에 실패했습니다.')),'image/jpeg',opts.quality));
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
