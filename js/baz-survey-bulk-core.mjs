// Shared, DOM-free rules for bulk issuing and print manifests.
export const STICKER = Object.freeze({width:32,height:25,qrX:8.2,qrY:4.4,qrSize:15.6,margin:4});
export const DESIGNS=Object.freeze({classic:{id:'classic',name:'기본형',description:'간결한 기본 스티커',...STICKER},b:{id:'b',name:'B · 캐릭터 포인트',description:'원본 B안 그대로',width:45,height:71.2,qrX:10,qrY:36,qrSize:25,margin:4},c:{id:'c',name:'C · 프리미엄 테크',description:'원본 C안 그대로',width:45,height:65.8,qrX:10,qrY:36,qrSize:25,margin:4},f:{id:'f',name:'F · 감성·소통',description:'원본 F안 그대로',width:45,height:65.8,qrX:10,qrY:36,qrSize:25,margin:4}});
// Original board coordinates. Only operational QR and hospital-name fields vary.
export const REFERENCES={b:{as:{crop:[824,56,280,443],clear:[890,292,154,154],qr:[890,292,154],name:[892,450,204,28]},survey:{crop:[1128,56,280,443],clear:[1194,292,154,154],qr:[1194,292,154],name:[1196,450,204,28]}},c:{as:{crop:[140,579,284,415],clear:[208,781,153,134],qr:[218,782,132],name:[207,939,207,31]},survey:{crop:[442,579,284,415],clear:[511,781,153,134],qr:[521,782,132],name:[510,939,207,31]}},f:{as:{crop:[821,579,284,415],clear:[895,778,144,140],qr:[897,778,140],name:[885,941,208,32]},survey:{crop:[1126,579,284,415],clear:[1198,778,144,140],qr:[1200,778,140],name:[1192,941,206,32]}}};
export function designSettings(records){const id=records[0]?.design||'classic';if(!DESIGNS[id]||records.some(r=>(r.design||'classic')!==id))throw Error('인쇄 디자인을 하나만 선택하세요.');if(id==='classic')return DESIGNS[id];purposeSettings(records);const source=REFERENCES[id][records[0]?.purpose||'survey'],[x,y,w,h]=source.crop,scale=45/w;return {...DESIGNS[id],height:Math.round(h*scale*10)/10,qrX:(source.qr[0]-x)*scale,qrY:(source.qr[1]-y)*45/w,qrSize:source.qr[2]*scale,inverted:id==='c',source};}
export const PURPOSES=Object.freeze({survey:{title:'고객만족도조사',caption:'QR 스캔 참여하기',prefix:'고객만족도조사'},as:{title:'AS 접수',caption:'QR 스캔으로 접수·진행 확인',prefix:'AS접수'}});
export function purposeSettings(records){const purpose=records[0]?.purpose||'survey';if(!PURPOSES[purpose]||records.some(r=>(r.purpose||'survey')!==purpose))throw Error('서로 다른 목적의 QR을 함께 저장할 수 없습니다.');return PURPOSES[purpose];}
export function issuedAsHospital(hospital,expected){
 if(!hospital||hospital.purpose!=='as'||hospital.id!==expected.id||nameKey(hospital.name)!==nameKey(expected.name))throw Error('병원 관리번호 연결이 일치하지 않습니다.');
 let url;try{url=new URL(hospital.qrUrl);}catch{throw Error('AS 접수 주소를 확인할 수 없습니다.');}
 if(url.protocol!=='https:'||url.username||url.password)throw Error('AS 접수 주소를 확인할 수 없습니다.');
 return {id:hospital.id,name:hospital.name,purpose:'as',qrUrl:url.href,intakeConfigured:!!hospital.intakeConfigured};
}
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
 const purpose=purposeSettings(records),design=designSettings(records),rows=[['PDF 페이지','QR 목적','병원명','인쇄 병원명','병원 관리번호','제작 수량','QR 주소','QR 파일명','스티커 디자인','재단 규격(mm)']];
 records.forEach((r,i)=>rows.push([i+1,purpose.title,r.name,r.printName||r.name,r.id,r.quantity,r.qrUrl||r.surveyUrl,fileStem(i,r.name),design.name,`${design.width}x${design.height}`]));
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
export async function runBatch(names,{issue,validate=issuedHospital,onResult=()=>{},onProgress=()=>{},shouldStop=()=>false,concurrency=3}){
 let next=0,completed=0,authError=null;const results=new Map();
 async function worker(){while(next<names.length&&!authError&&!shouldStop()){
  const name=names[next++];let result;
  try{result={ok:true,hospital:validate(await issue(name),name)};}
  catch(e){result={ok:false,error:e.message||'생성하지 못했습니다.'};if(e.status===401||e.status===403)authError=e;}
  results.set(name,result);onResult(name,result);onProgress(++completed,names.length);
 }}
 await Promise.all(Array.from({length:Math.min(Math.max(1,concurrency),names.length)},worker));
 return {results,completed,total:names.length,authError,stopped:completed<names.length};
}
