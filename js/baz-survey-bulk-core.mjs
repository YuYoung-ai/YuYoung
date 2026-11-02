// Shared, DOM-free rules for bulk issuing and print manifests.
export const STICKER = Object.freeze({width:32,height:25,qrX:7.75,qrY:3.05,qrSize:16.5,margin:4});
export const nameKey = value => String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export function directoryNames(values){
 const names=new Map();
 for(const value of values||[]){if(typeof value!=='string')continue;const name=value.normalize('NFKC').trim().replace(/\s+/g,' ');if(name&&name.length<=100&&!names.has(nameKey(name)))names.set(nameKey(name),name);}
 return [...names.values()].sort((a,b)=>a.localeCompare(b,'ko'));
}
export function matchingNames(names,query,selected,onlySelected=false){const key=nameKey(query);return names.filter(name=>(!onlySelected||selected.has(name))&&nameKey(name).includes(key));}
export function issuedHospital(hospital,name){
 if(!hospital||nameKey(hospital.name)!==nameKey(name)||!hospital.id)throw Error('병원 정보가 일치하지 않습니다. 다시 생성해 주세요.');
 if(!hospital.active)throw Error('중지된 병원 링크입니다. 기존 QR 메뉴에서 상태를 확인해 주세요.');
 let url;try{url=new URL(hospital.surveyUrl);}catch{throw Error('병원 참여 주소를 확인할 수 없습니다.');}
 if(url.protocol!=='https:'||url.username||url.password)throw Error('병원 참여 주소를 확인할 수 없습니다.');
 return {id:hospital.id,name:hospital.name,surveyUrl:url.href};
}
export function fileStem(index,name){return String(index+1).padStart(4,'0')+'_'+name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/,'').slice(0,70);}
export function manifestCsv(records){
 const cell=v=>{let s=String(v??'');if(/^[\s\u0000-\u001f]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 const rows=[['PDF 페이지','병원명','인쇄 병원명','병원 관리번호','제작 수량','참여 주소','QR 파일명']];
 records.forEach((r,i)=>rows.push([i+1,r.name,r.printName||r.name,r.id,r.quantity,r.surveyUrl,fileStem(i,r.name)]));
 return '\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
export function qrRuns(modules){
 const result=[];
 for(let row=0;row<modules.size;row++){let start=-1;for(let col=0;col<=modules.size;col++){const dark=col<modules.size&&modules.data[row*modules.size+col];if(dark&&start<0)start=col;if(!dark&&start>=0){result.push([start,row,col-start]);start=-1;}}}
 return result;
}
export function qrSvg(modules){
 const n=modules.size+STICKER.margin*2,path=qrRuns(modules).map(([x,y,w])=>`M${x+4} ${y+4}h${w}v1h-${w}z`).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="white"/><path d="${path}" fill="black"/></svg>`;
}
export async function runBatch(names,{issue,onResult=()=>{},onProgress=()=>{},shouldStop=()=>false,concurrency=3}){
 let next=0,completed=0,authError=null;const results=new Map();
 async function worker(){while(next<names.length&&!authError&&!shouldStop()){
  const name=names[next++];let result;
  try{result={ok:true,hospital:issuedHospital(await issue(name),name)};}
  catch(e){result={ok:false,error:e.message||'생성하지 못했습니다.'};if(e.status===401||e.status===403)authError=e;}
  results.set(name,result);onResult(name,result);onProgress(++completed,names.length);
 }}
 await Promise.all(Array.from({length:Math.min(Math.max(1,concurrency),names.length)},worker));
 return {results,completed,total:names.length,authError,stopped:completed<names.length};
}
