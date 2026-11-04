(function(root){
 'use strict';
 let loading=null,cachedBody=null;const labels=new Map(),scripts=new Map();
 const MAX_BYTES=7*1024*1024,W=210,H=297,M=8,CW=W-2*M,CH=H-2*M;
 const PHOTO_LABELS=['장비 S/N','증상 전','증상 후','증류수','전체샷'];
 function normalizePhotos(photos){const used=new Set();return photos.map(p=>{const slot=Number.isInteger(p.slot)&&p.slot>=0&&p.slot<5&&!used.has(p.slot)?p.slot:null;if(slot!==null)used.add(slot);return {...p,slot};});}
 function bounded(promise,ms,message){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]).finally(()=>clearTimeout(timer));}
 function load(src,ready){
  if(ready())return Promise.resolve();if(scripts.has(src))return scripts.get(src);
  const job=new Promise((resolve,reject)=>{
   const s=document.createElement('script');let timer;
   function finish(error){clearTimeout(timer);s.onload=s.onerror=null;if(error){s.remove();reject(error);}else resolve();}
   s.src=src;s.onload=()=>finish(ready()?null:new Error('PDF 도구를 불러오지 못했습니다.'));s.onerror=()=>finish(new Error('PDF 도구를 내려받지 못했습니다. 연결을 확인하고 다시 생성하세요.'));
   timer=setTimeout(()=>finish(new Error('PDF 도구 다운로드가 지연되고 있습니다. 연결을 확인하고 다시 생성하세요.')),30000);document.head.appendChild(s);
  }).finally(()=>scripts.delete(src));scripts.set(src,job);return job;
 }
 async function libraries(){
  if(!loading)loading=Promise.all([load('js/vendor/html2canvas-1.4.1.min.js',()=>!!root.html2canvas),load('js/vendor/jspdf-2.5.1.umd.min.js',()=>!!root.jspdf?.jsPDF)]).catch(e=>{loading=null;throw e;});
  await loading;if(document.fonts)await bounded(document.fonts.ready,15000,'글꼴 준비가 지연되고 있습니다. 연결을 확인하고 다시 생성하세요.');
 }
 function waitImage(img,src){return new Promise((resolve,reject)=>{
  let timer;
  function finish(error){clearTimeout(timer);img.onload=img.onerror=null;error?reject(error):resolve(img);}
  function ready(){finish(img.naturalWidth&&img.naturalHeight?null:new Error('PDF 사진 크기를 확인하지 못했습니다. 사진을 다시 선택해 주세요.'));}
  img.onload=ready;img.onerror=()=>finish(new Error('PDF 사진을 불러오지 못했습니다. 사진을 다시 선택해 주세요.'));
  timer=setTimeout(()=>finish(new Error('PDF 사진 준비가 지연되고 있습니다. 사진을 확인한 뒤 다시 생성하세요.')),30000);
  if(src!==undefined)img.src=src;else if(img.complete)ready();
 });}
 function image(data){return waitImage(new Image(),data);}
 function waitImages(images){return Promise.all(Array.from(images,img=>waitImage(img)));}
 function fit(width,height,maxWidth,maxHeight){const ratio=Math.min(maxWidth/width,maxHeight/height);return {width:width*ratio,height:height*ratio};}
 function photoGroups(photos){
  if(!photos.length)return [];
  if(photos.length>5)throw new Error('현장 사진은 최대 5장입니다. 사진을 확인해 주세요.');
  const slots=Array(5).fill(null),legacy=[];
  for(const p of normalizePhotos(photos)){if(p.slot===null)legacy.push(p);else slots[p.slot]=p;}
  // Older drafts have no category. Keep their captions generic until assigned.
  for(const p of legacy)slots[slots.indexOf(null)]={...p,legacy:true};
  return [slots];
 }
 function bodyPages(canvas){
  const step=Math.floor(CH/CW*canvas.width),count=Math.ceil(canvas.height/step);if(count>20)throw new Error('본문이 20페이지를 초과했습니다. 내용을 확인해 주세요.');
  const pages=[];
  for(let y=0;y<canvas.height;y+=step){const part=document.createElement('canvas');part.width=canvas.width;part.height=Math.min(step,canvas.height-y);part.getContext('2d').drawImage(canvas,0,y,canvas.width,part.height,0,0,canvas.width,part.height);pages.push({data:part.toDataURL('image/jpeg',.92),height:CW*part.height/part.width});part.width=part.height=0;}
  return pages;
 }
 // Capture and release one A4-sized surface at a time. A tall 2x canvas can
 // terminate WebKit before JavaScript has a chance to report an error.
 async function capturePages(render,height,width,scale){
  const step=Math.floor(CH/CW*width*scale),total=Math.ceil(height*scale);
  if(!Number.isFinite(total)||total<1||Math.ceil(total/step)>20)throw new Error('본문이 20페이지를 초과했거나 크기를 확인할 수 없습니다. 내용을 확인해 주세요.');
  const pages=[];
  for(let y=0;y<total;y+=step){
   let canvas,expired=false;
   const pending=Promise.resolve().then(()=>render({y:y/scale,height:Math.min(step,total-y)/scale}));
   pending.then(c=>{if(expired)c.width=c.height=0;},()=>{});
   try{
    canvas=await bounded(pending,45000,'본문 페이지 생성이 지연되고 있습니다. 화면을 유지하고 다시 생성해 주세요.');
    pages.push(...bodyPages(canvas));
   }finally{expired=true;if(canvas)canvas.width=canvas.height=0;}
   await new Promise(resolve=>setTimeout(resolve,0));
  }
  return pages;
 }
 function label(pdf,text,x,y,width,size,align){
  const cacheKey=JSON.stringify([text,width,size,align]);
  if(labels.has(cacheKey)){const hit=labels.get(cacheKey);pdf.addImage(hit.data,'PNG',x,y,width,hit.height,undefined,'FAST');return hit.height;}
  const pxWidth=734*width/CW,scale=2,c=document.createElement('canvas'),ctx=c.getContext('2d');
  const font='600 '+size+'px "Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif';ctx.font=font;
  const lines=[];let line='';for(const ch of Array.from(text)){if(ctx.measureText(line+ch).width>pxWidth-4&&line){lines.push(line);line='';}line+=ch;}lines.push(line);
  c.width=Math.ceil(pxWidth*scale);c.height=Math.ceil(lines.length*(size+7)*scale);const draw=c.getContext('2d');draw.scale(scale,scale);draw.fillStyle='#fff';draw.fillRect(0,0,pxWidth,c.height/scale);draw.fillStyle='#1b2f5e';draw.font=font;draw.textBaseline='top';draw.textAlign=align||'left';lines.forEach((l,i)=>draw.fillText(l,align==='center'?pxWidth/2:2,i*(size+7)+1));
  const height=c.height/c.width*width,data=c.toDataURL('image/png');pdf.addImage(data,'PNG',x,y,width,height,undefined,'FAST');c.width=c.height=0;labels.set(cacheKey,{data,height});if(labels.size>24)labels.delete(labels.keys().next().value);return height;
 }
 function addPhotos(pdf,photos,logo){
  let offset=0;
  for(const group of photoGroups(photos)){
   pdf.addPage();
   if(logo)pdf.addImage(logo.data,'PNG',M,M,10.6*logo.width/logo.height,10.6,undefined,'FAST');else label(pdf,'BAZ BIOMEDIC',M,M,40,18);
   label(pdf,'현장 사진',70,M,70,18,'center');
   const firstY=26,gap=8,width=(CW-gap)/2,slot=(CH-(firstY-M)-5-gap*2)/3;
   group.forEach((p,i)=>{const title=p?.legacy?'기존 사진 '+(++offset):PHOTO_LABELS[i],x=M+(i%2)*(width+gap),y=firstY+Math.floor(i/2)*(slot+gap),caption=label(pdf,title+(p?.memo?' — '+p.memo:'')+(!p?' (미첨부)':''),x,y,width,12),top=y+caption+2,height=slot-caption-2;
    pdf.setDrawColor(210);pdf.setLineWidth(.2);pdf.roundedRect(x,top,width,height,1.5,1.5);
    if(!p)return;
    const sized=fit(p.width,p.height,width-2,height-2);pdf.addImage(p.data,'JPEG',x+(width-sized.width)/2,top+(height-sized.height)/2,sized.width,sized.height);
   });
  }
 }
 function make(body,photos,opts,logo){const pdf=new root.jspdf.jsPDF({orientation:'p',unit:'mm',format:'a4',compress:true});body.forEach((p,i)=>{if(i)pdf.addPage();pdf.addImage(p.data,'JPEG',M,M,CW,p.height);});addPhotos(pdf,photos,logo);opts.footers(pdf,opts.docNo,opts.genAt);return pdf;}
 async function assemble(canvas,photoList,opts){
  const body=Array.isArray(canvas)?canvas:bodyPages(canvas),photos=[];let logo=null;
  if(opts.logo){const img=await image(opts.logo);logo={data:opts.logo,width:img.naturalWidth,height:img.naturalHeight};}
  for(let i=0;i<photoList.length;i++){
   opts.progress?.('사진 크기 축소 '+(i+1)+'/'+photoList.length);
   const p=photoList[i],r=await root.BazInspectionMedia.fromData(p.data,{maxDimension:800,quality:.8});
   photos.push({data:r.data,memo:p.memo,slot:p.slot,width:r.width,height:r.height});
   await new Promise(resolve=>setTimeout(resolve,0));
  }
  let pdf=make(body,photos,opts,logo),blob=pdf.output('blob'),pass=0;
  // Keep every photo and the body. Recompress only when the actual PDF exceeds the limit.
  for(const quality of [.72,.64]){
   if(blob.size<=MAX_BYTES||!photos.length)break;
   pass++;for(let i=0;i<photos.length;i++){opts.progress?.('파일 크기 조정 '+i+'/'+photos.length);const r=await root.BazInspectionMedia.fromData(photos[i].data,{quality,maxDimension:800});photos[i]={...photos[i],data:r.data,width:r.width,height:r.height};}
   pdf=make(body,photos,opts,logo);blob=pdf.output('blob');
  }
  return {pdf,blob,passes:pass,overLimit:blob.size>MAX_BYTES};
 }
 async function body(html,render){
  if(cachedBody?.html===html)return cachedBody.pages;
  const c=await render(html,undefined,true);try{const pages=Array.isArray(c)?c:bodyPages(c);cachedBody={html,pages};return pages;}finally{if(!Array.isArray(c))c.width=c.height=0;}
 }
 root.BazInspectionPdf={libraries,assemble,body,waitImages,fit,photoGroups,normalizePhotos,PHOTO_LABELS,bodyPages,capturePages,reset(){cachedBody=null;labels.clear();},MAX_BYTES};
})(window);
