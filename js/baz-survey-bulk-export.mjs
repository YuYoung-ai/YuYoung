import {STICKER,qrRuns,qrSvg,fileStem,manifestCsv,purposeSettings,designSettings} from './baz-survey-bulk-core.mjs?v=319';
import {artCanvas,designText} from './baz-qr-sticker-art.mjs?v=319';
const PX=24,scriptLoads=new Map(),art=new Map();
const artKey=d=>d.id+':'+d.source.crop.join(',');
export async function prepareSticker(record){await printFont();const d=designSettings([record]);if(d.id!=='classic')art.set(artKey(d),await artCanvas(d,PX));}
async function loadScript(path,ready){
 if(ready())return;
 if(!scriptLoads.has(path))scriptLoads.set(path,new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=new URL(path,import.meta.url).href;s.onload=()=>ready()?resolve():reject(Error('출력 도구를 불러오지 못했습니다.'));s.onerror=()=>{s.remove();reject(Error('출력 도구를 불러오지 못했습니다. 다시 시도해 주세요.'));};document.head.append(s);}).catch(e=>{scriptLoads.delete(path);throw e;}));
 await scriptLoads.get(path);
}
export async function printFont(){if(document.fonts){await document.fonts.load('700 16px "Survey Print"');await document.fonts.ready;}}
export async function printStickers(items,onProgress=()=>{}){
 const design=designSettings(items);
 const total=items.reduce((n,r)=>n+Number(r.quantity||1),0);if(total>500)throw Error('한 번에 500장까지 인쇄할 수 있습니다. 병원이나 제작 수량을 나누어 주세요.');
 const popup=window.open('','_blank');if(!popup)throw Error('인쇄 창을 열 수 없습니다. 팝업을 허용하거나 PDF를 내려받아 주세요.');popup.opener=null;
 try{
  const doc=popup.document;doc.open();doc.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>병원 QR 스티커 인쇄</title><style>body{margin:0;background:#eef2f6;color:#243447;font-family:system-ui,sans-serif}header{padding:16px;position:sticky;top:0;background:white;border-bottom:1px solid #ccd6df}button{padding:10px 20px;border:0;border-radius:8px;background:#23638f;color:white;cursor:pointer}main{display:flex;flex-wrap:wrap;gap:16px;padding:20px}.label{margin:0;width:${design.width*8}px;height:${design.height*8}px;background:#fff}.label img{display:block;width:100%;height:100%}@media print{@page{size:${design.width}mm ${design.height}mm;margin:0}html,body{margin:0;background:white}header{display:none}main{display:block;margin:0;padding:0}.label{width:${design.width}mm;height:${design.height}mm;break-inside:avoid;break-after:page}.label:last-child{break-after:auto}}</style></head><body><header><button type="button" id="print-now">인쇄</button><span id="print-info"></span></header><main></main></body></html>`);doc.close();
  doc.getElementById('print-info').textContent=' '+items.length+'개 병원 · '+total+'장 · 원본 크기 100%';doc.getElementById('print-now').onclick=()=>popup.print();
  await prepareSticker(items[0]);const images=[];
  for(let i=0;i<items.length;i++){
   const item=items[i],src=stickerCanvas(item).toDataURL('image/png');
   for(let n=0;n<Number(item.quantity||1);n++){const figure=doc.createElement('figure'),img=doc.createElement('img');figure.className='label';img.src=src;img.alt=item.name+' '+purposeSettings([item]).title+' QR';figure.append(img);doc.querySelector('main').append(figure);images.push(img);}
   onProgress(i+1,items.length);
  }
  await Promise.all(images.map(img=>img.decode()));if(popup.closed)throw Error('인쇄 창이 닫혔습니다.');popup.focus();popup.print();
 }catch(e){if(!popup.closed)popup.close();throw e;}
}
function canvas(w,h){const c=document.createElement('canvas');c.width=Math.ceil(w*PX);c.height=Math.ceil(h*PX);return c;}
function wrap(ctx,text,width){const lines=[];let line='';for(const char of Array.from(text)){if(char==='\n'){lines.push(line);line='';continue;}if(line&&ctx.measureText(line+char).width>width){lines.push(line);line=char;}else line+=char;}if(line)lines.push(line);return lines;}
function textBlock(text,width,height,{size=1.7,min=size,weight=600,align='left',color='#000',valign='top'}={}){
 const c=canvas(width,height),ctx=c.getContext('2d');let lines,chosen=size;
 for(;chosen>=min-.001;chosen-=.05){ctx.font=`${weight} ${chosen*PX}px "Survey Print","Malgun Gothic",sans-serif`;lines=wrap(ctx,text,width*PX);if(lines.length*chosen*1.32<=height)break;}
 if(chosen<min-.001)throw Error('병원명이 스티커 영역보다 깁니다. 미리보기에서 인쇄 병원명을 줄여 주세요.');
 const offset=valign==='middle'?Math.max(0,(height-lines.length*chosen*1.32)/2):0;ctx.fillStyle=color;ctx.textBaseline='top';ctx.textAlign=align;lines.forEach((line,i)=>ctx.fillText(line,align==='center'?width*PX/2:0,(offset+i*chosen*1.32+.1)*PX));return c;
}
function blocks(record){if((record.design||'classic')!=='classic')return designText(record,designSettings([record])).map(b=>({...b,c:textBlock(b.text,b.w,b.h,b.cfg)}));return [
 {x:1,y:.4,w:30,h:2.4,c:textBlock(purposeSettings([record]).title,30,2.4,{size:1.8,weight:700,align:'center'})},
 {x:1,y:2.8,w:30,h:1.6,c:textBlock(purposeSettings([record]).caption,30,1.6,{size:1.15,weight:500,align:'center'})},
 {x:1,y:20,w:30,h:2.2,c:textBlock(record.printName||record.name,30,2.2,{size:1.6,min:1.15,weight:700,align:'center'})}
 ];}
export function modulesFor(record){return window.BazQrEncoder.create((record.qrUrl||record.surveyUrl),{errorCorrectionLevel:'M'}).modules;}
export function stickerCanvas(record){
 const d=designSettings([record]),c=canvas(d.width,d.height),ctx=c.getContext('2d'),modules=modulesFor(record),unit=d.qrSize/(modules.size+8);
 ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
 if(d.id!=='classic'){if(!art.has(artKey(d)))throw Error('스티커 디자인을 먼저 준비해 주세요.');ctx.drawImage(art.get(artKey(d)),0,0);}
 blocks(record).forEach(b=>ctx.drawImage(b.c,b.x*PX,b.y*PX,b.w*PX,b.h*PX));
 ctx.fillStyle=d.inverted?'#111619':'#fff';ctx.fillRect(d.qrX*PX,d.qrY*PX,d.qrSize*PX,d.qrSize*PX);ctx.fillStyle=d.inverted?'#fff':'#000';
 qrRuns(modules).forEach(([x,y,w])=>{const x1=Math.round((d.qrX+(x+4)*unit)*PX),x2=Math.round((d.qrX+(x+4+w)*unit)*PX),y1=Math.round((d.qrY+(y+4)*unit)*PX),y2=Math.round((d.qrY+(y+5)*unit)*PX);ctx.fillRect(x1,y1,x2-x1,y2-y1);});
 if(d.id==='classic'){ctx.font=`700 ${1.95*PX}px Arial,sans-serif`;ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.fillText('Curejet',d.width*PX/2,24*PX);}return c;
}
// Editable production artwork; preserve source art and square QR geometry.
export function productionLayers(record,p){
 const d=designSettings([record]),sx=p.width/d.width,sy=p.height/d.height,scale=Math.min(sx,sy),base=d.id==='classic'?{x:1,y:20,w:30,h:2.2,cfg:{size:1.6,color:'#000'}}:designText(record,d)[0];
 const q={x:d.qrX*sx+(d.qrSize*sx-d.qrSize*scale)/2,y:d.qrY*sy+(d.qrSize*sy-d.qrSize*scale)/2,size:d.qrSize*scale};
 const x=p.nameX==null?base.x*sx:p.nameX*p.width/100,y=p.nameY==null?(base.y+base.h/2)*sy:p.nameY*p.height/100,w=p.nameWidth==null?base.w*sx:p.nameWidth*p.width/100;
 let pt=record.namePt??p.namePt??base.cfg.size*scale*72/25.4,min=p.nameAuto?Math.min(p.nameMinPt,pt):pt;
 const name=String(record.printName||record.name),probe=document.createElement('canvas').getContext('2d');
 for(;pt>=min-.001;pt-=.1){probe.font=`800 ${pt*25.4/72*PX}px "Survey Print","Malgun Gothic",sans-serif`;if(probe.measureText(name).width<=w*PX)break;}
 if(pt<min-.001)throw Error(record.name+': 병원명이 한 줄에 들어가지 않습니다. 인쇄 이름이나 글자 크기를 조정하세요.');
 const height=pt*25.4/72*1.35,top=y-height/2;
 const inkWidth=probe.measureText(name).width/PX,inkX=x+(p.nameAlign==='center'?(w-inkWidth)/2:p.nameAlign==='right'?w-inkWidth:0);
 if(x<0||top<0||x+w>p.width+.01||top+height>p.height+.01)throw Error(record.name+': 병원명이 스티커 밖에 있습니다.');
 if(inkX<q.x+q.size&&inkX+inkWidth>q.x&&top<q.y+q.size&&top+height>q.y)throw Error(record.name+': 병원명과 QR이 겹칩니다.');
 if(d.id!=='classic'&&top+height>(base.y-1)*sy&&inkX<base.x*sx-1)throw Error(record.name+': 병원명이 하단 로고·구분선과 겹칩니다.');
 const block={x,y:top,w,h:height,c:textBlock(name,w,height,{size:pt*25.4/72,weight:800,align:p.nameAlign,color:base.cfg.color||'#000',valign:'middle'})};
 const others=d.id==='classic'?blocks(record).slice(0,2).map(b=>({...b,x:b.x*sx,y:b.y*sy,w:b.w*sx,h:b.h*sy})):[];
 return {d,q,background:d.id==='classic'?null:art.get(artKey(d)),blocks:[...others,block],actualNamePt:Math.round(pt*10)/10,nameBox:{x,y:top,w,h:height}};
}
export async function stickerPdf(records,onProgress=()=>{}){
 const purpose=purposeSettings(records),d=designSettings(records);await loadScript('./vendor/jspdf-2.5.1.umd.min.js',()=>!!window.jspdf?.jsPDF);await prepareSticker(records[0]);
 const orientation=d.width>d.height?'landscape':'portrait',pdf=new window.jspdf.jsPDF({orientation,unit:'mm',format:[d.width,d.height],compress:true,precision:6});
 pdf.setProperties({title:'Curejet '+purpose.title+' '+d.name+' '+d.width+'x'+d.height+'mm',subject:'One hospital per page. Quantities are in the accompanying manifest.'});
 const background=d.id==='classic'?null:art.get(artKey(d)).toDataURL('image/png');
 for(let i=0;i<records.length;i++){
  const r=records[i];if(i)pdf.addPage([d.width,d.height],orientation);const m=modulesFor(r),unit=d.qrSize/(m.size+8);
  try{if(d.id!=='classic')pdf.addImage(background,'PNG',0,0,d.width,d.height,'sticker-bg-'+artKey(d));blocks(r).forEach(b=>pdf.addImage(b.c.toDataURL('image/png'),'PNG',b.x,b.y,b.w,b.h));}catch(e){throw Error(r.name+': '+e.message);}
  pdf.setFillColor(d.inverted?17:255,d.inverted?22:255,d.inverted?25:255);pdf.rect(d.qrX,d.qrY,d.qrSize,d.qrSize,'F');pdf.setFillColor(d.inverted?255:0);qrRuns(m).forEach(([x,y,w])=>pdf.rect(d.qrX+(x+4)*unit,d.qrY+(y+4)*unit,w*unit,unit,'F'));
  if(d.id==='classic'){pdf.setTextColor(0);pdf.setFont('helvetica','bold');pdf.setFontSize(1.95*72/25.4);pdf.text('Curejet',16,24,{align:'center'});}
  onProgress(i+1,records.length);if(i%10===0)await new Promise(resolve=>setTimeout(resolve,0));
 }
 return pdf.output('blob');
}
export const printInstructions=records=>{const d=designSettings(records);return `Curejet ${purposeSettings(records).title} 스티커 제작 요청

디자인: ${d.name}
재단 크기: 가로 ${d.width}mm × 세로 ${d.height}mm
PDF: 병원당 1페이지, 원본 크기(100%)로 출력
병원 수: ${records.length}곳 / 총 수량: ${records.reduce((n,r)=>n+r.quantity,0)}장
병원별 출력 수량: 제작수량표.csv 참조
QR과 병원명은 완성 배치되어 있습니다. QR 내용을 변경하지 마세요.
PDF의 QR은 벡터입니다. B·C·F 디자인은 제공된 원본 이미지 해상도를 유지하며 병원명은 약 600dpi로 렌더링합니다.
완성 크기 PDF이며 도련·재단선이 포함되지 않습니다. 재단·색상 규격은 인쇄 업체와 확인해 주세요.
무광 방수 소재 및 병원별 분류 포장 희망
본 인쇄 전 실제 크기 샘플의 QR 인식·병원명·재단 위치를 확인해 주세요.
`;};
export async function stickerArchive(records,onProgress=()=>{}){
 const p=purposeSettings(records),d=designSettings(records);await loadScript('./vendor/jszip-3.10.1.min.js',()=>!!window.JSZip);await prepareSticker(records[0]);const zip=new window.JSZip();
 for(let i=0;i<records.length;i++){const r=records[i],c=stickerCanvas(r),blob=await new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('스티커 이미지 생성 실패')),'image/png'));zip.file('스티커/'+p.prefix+'_'+d.id+'_'+fileStem(i,r.name)+'.png',await blob.arrayBuffer());onProgress(i+1,records.length);if(i%10===0)await new Promise(resolve=>setTimeout(resolve,0));}
 zip.file('제작수량표.csv',manifestCsv(records));zip.file('인쇄요청사항.txt',printInstructions(records));return zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:3}});
}
export async function qrArchive(records,onProgress=()=>{}){
 const purpose=purposeSettings(records);await loadScript('./vendor/jszip-3.10.1.min.js',()=>!!window.JSZip);const zip=new window.JSZip();
 for(let i=0;i<records.length;i++){
  const r=records[i],stem=purpose.prefix+'_'+fileStem(i,r.name),m=modulesFor(r);zip.file('QR/'+stem+'.svg',qrSvg(m));
  const c=document.createElement('canvas');await window.BazQrEncoder.toCanvas(c,r.qrUrl||r.surveyUrl,{width:1024,margin:4,errorCorrectionLevel:'M'});
  const blob=await new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error(r.name+': QR 이미지 생성 실패')),'image/png'));
  zip.file('QR/'+stem+'.png',await blob.arrayBuffer());onProgress(i+1,records.length);if(i%10===0)await new Promise(resolve=>setTimeout(resolve,0));
 }
 zip.file('제작수량표.csv',manifestCsv(records));zip.file('인쇄요청사항.txt',printInstructions(records));
 return zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:3}});
}
export function saveBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
