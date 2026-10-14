type Obj = Record<string, any>;
export const sourceFields = ['hospitalName','date','sn','engineer','gubun','cat','type','part','cost','detail','result','remark','nozzleReuse','nsFill','nsAmt','jet'];
const value = (s:Obj, field:string) => String((field==='hospitalName'?s?.sourceHospitalName||s?.hospitalName:s?.[field]) ?? '').replace(/\r\n?/g,'\n').trim();
export function sourceChanges(before:Obj, after:Obj){
 return sourceFields.filter(field=>value(before,field)!==value(after,field)).map(field=>({field,before:value(before,field),after:value(after,field)}));
}
const digest=async(text:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
export async function sourceReview(previous:Obj, source:Obj, completed:boolean, now:string){
 const immediate=sourceChanges(previous.source,source);
 if(!immediate.length)return previous.sourceReview;
 const changes=(await Promise.all(sourceFields.map(async field=>{
  const prior=previous.sourceReview?.pending?(previous.sourceReview.changes||[]).find((c:Obj)=>c.field===field):null;
  const before=prior?prior.before:value(previous.source,field),after=value(source,field);
  const beforeHash=prior?.beforeHash||await digest(before),afterHash=await digest(after);
  if(beforeHash===afterHash)return null;
  return {field,before:before.slice(0,300),after:after.slice(0,300),beforeHash,afterHash,beforeTruncated:!!prior?.beforeTruncated||before.length>300,afterTruncated:after.length>300};
 }))).filter(Boolean);
 return {pending:changes.length>0,changes,changedAt:now,afterCompletion:!!(completed||previous.sourceReview?.pending&&previous.sourceReview.afterCompletion),sourceVersion:source.version};
}
export function pdfBasis(value:Obj){
 if(!value||value.v!==1||!['standard','simplified'].includes(value.format)||value.template!==1||!/^[a-f0-9]{64}$/.test(value.fingerprint||''))return undefined;
 if(typeof value.recordId!=='string'||value.recordId.length>120||!Number.isFinite(Date.parse(value.capturedAt)))return undefined;
 const fields:Obj={};for(const field of sourceFields){if(!/^[a-f0-9]{64}$/.test(value.fields?.[field]||''))return undefined;fields[field]=value.fields[field];}
 return {v:1,recordId:value.recordId,fingerprint:value.fingerprint,fields,capturedAt:value.capturedAt,format:value.format,template:1};
}
