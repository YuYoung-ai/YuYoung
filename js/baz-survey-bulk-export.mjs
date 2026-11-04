import {STICKER,qrRuns,qrSvg,fileStem,manifestCsv,purposeSettings} from './baz-survey-bulk-core.mjs?v=292';
const PX=24,scriptLoads=new Map();
async function loadScript(path,ready){
 if(ready())return;
 if(!scriptLoads.has(path))scriptLoads.set(path,new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=new URL(path,import.meta.url).href;s.onload=()=>ready()?resolve():reject(Error('출력 도구를 불러오지 못했습니다.'));s.onerror=()=>{s.remove();reject(Error('출력 도구를 불러오지 못했습니다. 다시 시도해 주세요.'));};document.head.append(s);}).catch(e=>{scriptLoads.delete(path);throw e;}));
 await scriptLoads.get(path);
}
export async function printFont(){if(document.fonts){await document.fonts.load('700 16px "Survey Print"');await document.fonts.ready;}}
export async function printStickers(items,onProgress=()=>{}){
 const total=items.reduce((n,r)=>n+Number(r.quantity||1),0);if(total>500)throw Error('한 번에 500장까지 인쇄할 수 있습니다. 병원이나 제작 수량을 나누어 주세요.');
 const popup=window.open('','_blank');if(!popup)throw Error('인쇄 창을 열 수 없습니다. 팝업을 허용하거나 PDF를 내려받아 주세요.');popup.opener=null;
 try{
  const doc=popup.document;doc.open();doc.write('<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>병원 QR 스티커 인쇄</title><style>body{margin:0;background:#eef2f6;color:#243447;font-family:system-ui,sans-serif}header{padding:16px;position:sticky;top:0;background:white;border-bottom:1px solid #ccd6df}button{padding:10px 20px;border:0;border-radius:8px;background:#23638f;color:white;cursor:pointer}main{display:flex;flex-wrap:wrap;gap:16px;padding:20px}.label{margin:0;width:320px;height:250px;background:#fff}.label img{display:block;width:100%;height:100%}@media print{@page{size:32mm 25mm;margin:0}html,body{margin:0;background:white}header{display:none}main{display:block;margin:0;padding:0}.label{width:32mm;height:25mm;break-inside:avoid;break-after:page}.label:last-child{break-after:auto}}</style></head><body><header><button type="button" id="print-now">인쇄</button><span id="print-info"></span></header><main></main></body></html>');doc.close();
  doc.getElementById('print-info').textContent=' '+items.length+'개 병원 · '+total+'장 · 원본 크기 100%';doc.getElementById('print-now').onclick=()=>popup.print();
  await printFont();const images=[];
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
function textBlock(text,width,height,{size=1.7,min=size,weight=600,align='left'}={}){
 const c=canvas(width,height),ctx=c.getContext('2d');let lines,chosen=size;
 for(;chosen>=min-.001;chosen-=.05){ctx.font=`${weight} ${chosen*PX}px "Survey Print","Malgun Gothic",sans-serif`;lines=wrap(ctx,text,width*PX);if(lines.length*chosen*1.32<=height)break;}
 if(chosen<min-.001)throw Error('병원명이 스티커 영역보다 깁니다. 미리보기에서 인쇄 병원명을 줄여 주세요.');
 ctx.fillStyle='#000';ctx.textBaseline='top';ctx.textAlign=align;lines.forEach((line,i)=>ctx.fillText(line,align==='center'?width*PX/2:0,(i*chosen*1.32+.1)*PX));return c;
}
function blocks(record){return [
 {x:1,y:.4,w:30,h:2.4,c:textBlock(purposeSettings([record]).title,30,2.4,{size:1.8,weight:700,align:'center'})},
 {x:1,y:2.8,w:30,h:1.6,c:textBlock(purposeSettings([record]).caption,30,1.6,{size:1.15,weight:500,align:'center'})},
 {x:1,y:20,w:30,h:2.2,c:textBlock(record.printName||record.name,30,2.2,{size:1.6,min:1.15,weight:700,align:'center'})}
 ];}
export function modulesFor(record){return window.BazQrEncoder.create((record.qrUrl||record.surveyUrl),{errorCorrectionLevel:'M'}).modules;}
export function stickerCanvas(record){
 const c=canvas(STICKER.width,STICKER.height),ctx=c.getContext('2d'),modules=modulesFor(record),unit=STICKER.qrSize/(modules.size+8);
 ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#000';
 qrRuns(modules).forEach(([x,y,w])=>ctx.fillRect((STICKER.qrX+(x+4)*unit)*PX,(STICKER.qrY+(y+4)*unit)*PX,w*unit*PX,unit*PX));
 blocks(record).forEach(b=>ctx.drawImage(b.c,b.x*PX,b.y*PX,b.w*PX,b.h*PX));
 ctx.font=`700 ${1.95*PX}px Arial,sans-serif`;ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.fillText('Curejet',STICKER.width*PX/2,24*PX);return c;
}
export async function stickerPdf(records,onProgress=()=>{}){
 const purpose=purposeSettings(records);await loadScript('./vendor/jspdf-2.5.1.umd.min.js',()=>!!window.jspdf?.jsPDF);await printFont();
 const pdf=new window.jspdf.jsPDF({orientation:'landscape',unit:'mm',format:[32,25],compress:true,precision:6});
 pdf.setProperties({title:'Curejet '+purpose.title+' stickers 32x25mm',subject:'One hospital per page. Quantities are in the accompanying manifest.'});
 for(let i=0;i<records.length;i++){
  const r=records[i];if(i)pdf.addPage([32,25],'landscape');const m=modulesFor(r),unit=STICKER.qrSize/(m.size+8);
  pdf.setFillColor(0);qrRuns(m).forEach(([x,y,w])=>pdf.rect(STICKER.qrX+(x+4)*unit,STICKER.qrY+(y+4)*unit,w*unit,unit,'F'));
  try{blocks(r).forEach(b=>pdf.addImage(b.c.toDataURL('image/png'),'PNG',b.x,b.y,b.w,b.h));}catch(e){throw Error(r.name+': '+e.message);}
  pdf.setTextColor(0);pdf.setFont('helvetica','bold');pdf.setFontSize(1.95*72/25.4);pdf.text('Curejet',16,24,{align:'center'});
  onProgress(i+1,records.length);if(i%10===0)await new Promise(resolve=>setTimeout(resolve,0));
 }
 return pdf.output('blob');
}
export const printInstructions=records=>`Curejet ${purposeSettings(records).title} 스티커 제작 요청\n\n재단 크기: 가로 32mm × 세로 25mm\nPDF: 병원당 1페이지, 원본 크기(100%)로 출력\n병원 수: ${records.length}곳 / 총 수량: ${records.reduce((n,r)=>n+r.quantity,0)}장\n병원별 출력 수량: 제작수량표.csv 참조\nQR과 병원명은 완성 배치되어 있습니다. QR 내용을 변경하지 마세요.\nQR은 벡터, 한글은 약 600dpi 이미지이며 Curejet은 PDF 글꼴로 출력됩니다.\n흰 바탕의 완성 크기 PDF입니다. 도련·재단선 및 색상 규격은 인쇄 전 업체와 확인해 주세요.\n무광 방수 소재 및 병원별 분류 포장 희망\n본 인쇄 전 실제 크기 샘플의 QR 인식·병원명·재단 위치를 확인해 주세요.\n`;
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
