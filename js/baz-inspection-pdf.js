(function(root){
 'use strict';
 let loading=null,cachedBody=null;const labels=new Map(),scripts=new Map();
 const MAX_BYTES=7*1024*1024,W=210,H=297,M=8,CW=W-2*M,CH=H-2*M;
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
 function photoGroups(photos){const groups=[];for(let i=0;i<photos.length;){const portrait=photos[i].height>photos[i].width*1.1;const pair=!portrait&&photos[i+1]&&photos[i+1].height<=photos[i+1].width*1.1;groups.push(photos.slice(i,i+(pair?2:1)));i+=pair?2:1;}return groups;}
 function bodyPages(canvas){
  const step=Math.floor(CH/CW*canvas.width),count=Math.ceil(canvas.height/step);if(count>20)throw new Error('본문이 20페이지를 초과했습니다. 내용을 확인해 주세요.');
  const pages=[];
  for(let y=0;y<canvas.height;y+=step){const part=document.createElement('canvas');part.width=canvas.width;part.height=Math.min(step,canvas.height-y);part.getContext('2d').drawImage(canvas,0,y,canvas.width,part.height,0,0,canvas.width,part.height);pages.push({data:part.toDataURL('image/jpeg',.92),height:CW*part.height/part.width});part.width=part.height=0;}
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
   const firstY=26,slot=(CH-(firstY-M)-5-(group.length-1)*8)/group.length;
   group.forEach((p,i)=>{const y=firstY+i*(slot+8),caption=label(pdf,'사진 '+(++offset)+(p.memo?' — '+p.memo:''),M,y,CW,12),top=y+caption+2,height=slot-caption-2;
    pdf.setDrawColor(210);pdf.setLineWidth(.2);pdf.roundedRect(M,top,CW,height,1.5,1.5);
    const sized=fit(p.width,p.height,CW-2,height-2);pdf.addImage(p.data,/^data:image\/png/.test(p.data)?'PNG':/^data:image\/webp/.test(p.data)?'WEBP':'JPEG',M+(CW-sized.width)/2,top+(height-sized.height)/2,sized.width,sized.height);
   });
  }
 }
 function make(body,photos,opts,logo){const pdf=new root.jspdf.jsPDF({orientation:'p',unit:'mm',format:'a4',compress:true});body.forEach((p,i)=>{if(i)pdf.addPage();pdf.addImage(p.data,'JPEG',M,M,CW,p.height);});addPhotos(pdf,photos,logo);opts.footers(pdf,opts.docNo,opts.genAt);return pdf;}
 async function assemble(canvas,photoList,opts){
  const body=Array.isArray(canvas)?canvas:bodyPages(canvas),photos=[];let logo=null;
  if(opts.logo){const img=await image(opts.logo);logo={data:opts.logo,width:img.naturalWidth,height:img.naturalHeight};}
  for(let i=0;i<photoList.length;i++){opts.progress?.('사진 페이지 준비 '+(i+1)+'/'+photoList.length);const p=photoList[i],img=await image(p.data);photos.push({...p,width:img.naturalWidth,height:img.naturalHeight});}
  let pdf=make(body,photos,opts,logo),blob=pdf.output('blob'),pass=0;
  // Keep every photo and the body. Recompress only when the actual PDF exceeds the limit.
  for(const quality of [.8,.72]){
   if(blob.size<=MAX_BYTES||!photos.length)break;
   pass++;for(let i=0;i<photos.length;i++){opts.progress?.('파일 크기 조정 '+i+'/'+photos.length);const r=await root.BazInspectionMedia.fromData(photoList[i].data,{quality,maxDimension:1600});photos[i]={...photos[i],data:r.data,width:r.width,height:r.height};}
   pdf=make(body,photos,opts,logo);blob=pdf.output('blob');
  }
  return {pdf,blob,passes:pass,overLimit:blob.size>MAX_BYTES};
 }
 async function body(html,render){
  if(cachedBody?.html===html)return cachedBody.pages;
  const c=await render(html);try{const pages=bodyPages(c);cachedBody={html,pages};return pages;}finally{c.width=c.height=0;}
 }
 root.BazInspectionPdf={libraries,assemble,body,waitImages,fit,photoGroups,bodyPages,reset(){cachedBody=null;labels.clear();},MAX_BYTES};
})(window);
