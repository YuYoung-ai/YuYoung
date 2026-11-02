import {STICKER,qrRuns,qrSvg,fileStem,manifestCsv} from './baz-survey-bulk-core.mjs?v=20261102-centered';
const PX=24,scriptLoads=new Map();
async function loadScript(path,ready){
 if(ready())return;
 if(!scriptLoads.has(path))scriptLoads.set(path,new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=new URL(path,import.meta.url).href;s.onload=()=>ready()?resolve():reject(Error('출력 도구를 불러오지 못했습니다.'));s.onerror=()=>{s.remove();reject(Error('출력 도구를 불러오지 못했습니다. 다시 시도해 주세요.'));};document.head.append(s);}).catch(e=>{scriptLoads.delete(path);throw e;}));
 await scriptLoads.get(path);
}
export async function printFont(){if(document.fonts){await document.fonts.load('700 16px "Survey Print"');await document.fonts.ready;}}
function canvas(w,h){const c=document.createElement('canvas');c.width=Math.ceil(w*PX);c.height=Math.ceil(h*PX);return c;}
function wrap(ctx,text,width){const lines=[];let line='';for(const char of Array.from(text)){if(char==='\n'){lines.push(line);line='';continue;}if(line&&ctx.measureText(line+char).width>width){lines.push(line);line=char;}else line+=char;}if(line)lines.push(line);return lines;}
function textBlock(text,width,height,{size=1.7,min=size,weight=600,align='left'}={}){
 const c=canvas(width,height),ctx=c.getContext('2d');let lines,chosen=size;
 for(;chosen>=min-.001;chosen-=.05){ctx.font=`${weight} ${chosen*PX}px "Survey Print","Malgun Gothic",sans-serif`;lines=wrap(ctx,text,width*PX);if(lines.length*chosen*1.32<=height)break;}
 if(chosen<min-.001)throw Error('병원명이 스티커 영역보다 깁니다. 미리보기에서 인쇄 병원명을 줄여 주세요.');
 ctx.fillStyle='#000';ctx.textBaseline='top';ctx.textAlign=align;lines.forEach((line,i)=>ctx.fillText(line,align==='center'?width*PX/2:0,(i*chosen*1.32+.1)*PX));return c;
}
function blocks(record){return [
 {x:1,y:.65,w:30,h:2.4,c:textBlock('고객만족도조사',30,2.4,{size:1.8,weight:700,align:'center'})},
 {x:1,y:19.65,w:30,h:2.5,c:textBlock(record.printName||record.name,30,2.5,{size:1.7,min:1.15,weight:700,align:'center'})}
 ];}
export function modulesFor(record){return window.BazQrEncoder.create(record.surveyUrl,{errorCorrectionLevel:'M'}).modules;}
export function stickerCanvas(record){
 const c=canvas(STICKER.width,STICKER.height),ctx=c.getContext('2d'),modules=modulesFor(record),unit=STICKER.qrSize/(modules.size+8);
 ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#000';
 qrRuns(modules).forEach(([x,y,w])=>ctx.fillRect((STICKER.qrX+(x+4)*unit)*PX,(STICKER.qrY+(y+4)*unit)*PX,w*unit*PX,unit*PX));
 blocks(record).forEach(b=>ctx.drawImage(b.c,b.x*PX,b.y*PX,b.w*PX,b.h*PX));
 ctx.font=`700 ${1.95*PX}px Arial,sans-serif`;ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.fillText('Curejet',STICKER.width*PX/2,24*PX);return c;
}
export async function stickerPdf(records,onProgress=()=>{}){
 await loadScript('./vendor/jspdf-2.5.1.umd.min.js',()=>!!window.jspdf?.jsPDF);await printFont();
 const pdf=new window.jspdf.jsPDF({orientation:'landscape',unit:'mm',format:[32,25],compress:true,precision:6});
 pdf.setProperties({title:'Curejet hospital survey stickers 32x25mm',subject:'One hospital per page. Quantities are in the accompanying manifest.'});
 for(let i=0;i<records.length;i++){
  const r=records[i];if(i)pdf.addPage([32,25],'landscape');const m=modulesFor(r),unit=STICKER.qrSize/(m.size+8);
  pdf.setFillColor(0);qrRuns(m).forEach(([x,y,w])=>pdf.rect(STICKER.qrX+(x+4)*unit,STICKER.qrY+(y+4)*unit,w*unit,unit,'F'));
  try{blocks(r).forEach(b=>pdf.addImage(b.c.toDataURL('image/png'),'PNG',b.x,b.y,b.w,b.h));}catch(e){throw Error(r.name+': '+e.message);}
  pdf.setTextColor(0);pdf.setFont('helvetica','bold');pdf.setFontSize(1.95*72/25.4);pdf.text('Curejet',16,24,{align:'center'});
  onProgress(i+1,records.length);if(i%10===0)await new Promise(resolve=>setTimeout(resolve,0));
 }
 return pdf.output('blob');
}
export const printInstructions=records=>`Curejet 고객만족도 조사 스티커 제작 요청\n\n재단 크기: 가로 32mm × 세로 25mm\nPDF: 병원당 1페이지, 원본 크기(100%)로 출력\n병원 수: ${records.length}곳 / 총 수량: ${records.reduce((n,r)=>n+r.quantity,0)}장\n병원별 출력 수량: 제작수량표.csv 참조\nQR과 병원명은 완성 배치되어 있습니다. QR 내용을 변경하지 마세요.\nQR은 벡터, 한글은 약 600dpi 이미지이며 Curejet은 PDF 글꼴로 출력됩니다.\n흰 바탕의 완성 크기 PDF입니다. 도련·재단선 및 색상 규격은 인쇄 전 업체와 확인해 주세요.\n무광 방수 소재 및 병원별 분류 포장 희망\n본 인쇄 전 실제 크기 샘플의 QR 인식·병원명·재단 위치를 확인해 주세요.\n`;
export async function qrArchive(records,onProgress=()=>{}){
 await loadScript('./vendor/jszip-3.10.1.min.js',()=>!!window.JSZip);const zip=new window.JSZip();
 for(let i=0;i<records.length;i++){
  const r=records[i],stem=fileStem(i,r.name),m=modulesFor(r);zip.file('QR/'+stem+'.svg',qrSvg(m));
  const c=document.createElement('canvas');await window.BazQrEncoder.toCanvas(c,r.surveyUrl,{width:1024,margin:4,errorCorrectionLevel:'M'});
  const blob=await new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error(r.name+': QR 이미지 생성 실패')),'image/png'));
  zip.file('QR/'+stem+'.png',await blob.arrayBuffer());onProgress(i+1,records.length);if(i%10===0)await new Promise(resolve=>setTimeout(resolve,0));
 }
 zip.file('제작수량표.csv',manifestCsv(records));zip.file('인쇄요청사항.txt',printInstructions(records));
 return zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:3}});
}
export function saveBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
