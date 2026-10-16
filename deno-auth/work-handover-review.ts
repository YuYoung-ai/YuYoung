// Official Handover bodies. Drafts never enter KV; documents have their own keys.
import {sourceFields,sourceChanges} from './work-source-review.ts';
import {createWorkIndexes,updateRequestIndexes} from './work-indexes.ts';
type Obj=Record<string,any>;
const key=(...p:any[])=>['hospitalwork-v2',...p],clone=(v:any)=>JSON.parse(JSON.stringify(v));
export async function bodyHash(v:Obj){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(sourceFields.map(f=>[f,String(v[f]??'').replace(/\r\n?/g,'\n').trim()])))))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export function reviewBody(v:Obj){const b:Obj={};for(const f of sourceFields)b[f]=String(v[f]??'').replace(/\r\n?/g,'\n').trim();return b;}
function bounded(v:any){if(new TextEncoder().encode(JSON.stringify(v)).length>48000)throw new Error('기록 크기 상한을 초과했습니다. 내용을 줄여주세요.');return v;}
function validBody(v:Obj,current:Obj){
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(f=>!sourceFields.includes(f)))throw new Error('지원하지 않는 본문 필드입니다.');
 const b=reviewBody(v),limits:Obj={hospitalName:300,date:10,sn:300,engineer:80,gubun:10,cat:200,type:300,part:1000,cost:100,detail:8000,result:2000,remark:4000,nozzleReuse:10,nsFill:80,nsAmt:80,jet:300};
 for(const f of sourceFields)if(b[f].length>limits[f])throw new Error(f+' 입력이 너무 깁니다.');
 if(!b.hospitalName||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||new Date(b.date+'T00:00:00Z').toISOString().slice(0,10)!==b.date||!['A/S','점검'].includes(b.gubun))throw new Error('병원·처리일·A/S 구분을 확인하세요.');
 if(b.cost!==current.cost&&b.cost&&!/^(?:[₩\s]*[0-9,]+(?:\.[0-9]{1,2})?\s*원?|무상|유상|없음|N\/A)$/.test(b.cost))throw new Error('교체비용 형식을 확인하세요.');
 if(b.nozzleReuse!==current.nozzleReuse&&!['','O','X'].includes(b.nozzleReuse))throw new Error('노즐 재사용은 O 또는 X로 입력하세요.');
 if(new TextEncoder().encode(JSON.stringify(b)).length>14000)throw new Error('본문은 UTF-8 14,000바이트 이하로 저장하세요. 입력은 유지됩니다.');return b;
}
export function createHandoverReview(kv:any,options:Obj={}){
 const indexes=createWorkIndexes(kv);
 async function config(who:Obj){const policy=(await kv.get(key('reviewPolicy'))).value;return {success:true,enabled:!!policy?.active,canReview:!!options.reviewAdminUid&&who.level>=3&&who.uid===options.reviewAdminUid,configured:!!options.reviewAdminUid,identityUid:who.level>=3?who.uid||'':'',activatedAt:policy?.activatedAt||''};}
 function admin(who:Obj){if(!options.reviewAdminUid)throw Object.assign(new Error('검수 관리자 계정 설정이 필요합니다.'),{code:'ADMIN_NOT_CONFIGURED'});if(!who.uid)throw Object.assign(new Error('계정 식별자가 없습니다. 다시 로그인하세요.'),{code:'AUTH_REQUIRED'});if(who.level<3||who.uid!==options.reviewAdminUid)throw Object.assign(new Error('지정된 검수 관리자만 저장할 수 있습니다.'),{code:'FORBIDDEN'});}
 async function context(id:string,requestId?:string){
 if(!/^[A-Za-z0-9_-]{1,150}$/.test(id))throw new Error('기록 ID를 확인하세요.');
 const [record,index,link]=await Promise.all([kv.get(key('reviewRecord',id)),kv.get(key('sourceIndex',id)),kv.get(key('link',id))]);
 const linked=link.value?await kv.get(key('history',link.value.requestId,link.value.historyId)):null;
 const src=await kv.get(key('source',index.value?.hospitalName||linked?.value?.source?.hospitalName||'',id));
 if(!src.value||src.value.origin==='flow')throw new Error('확인된 Handover 원본이 없습니다.');
 const request=link.value?await kv.get(key('request',link.value.requestId)):null;
 if(requestId&&link.value?.requestId!==requestId)throw new Error('해당 기록의 접수 연결이 변경되었습니다.');
 if(request&&(request.value?.deletedAt||request.value?.purgedAt||!request.value))throw Object.assign(new Error('삭제된 접수의 기록은 수정할 수 없습니다.'),{code:'SOURCE_DELETED'});
 const baseline=reviewBody(linked?.value?.source||src.value);
 const value=record.value||{recordId:id,original:baseline,published:baseline,bodyVersion:await bodyHash(baseline),originalVersion:await bodyHash(baseline),reviewVersion:0,provenance:'이전 연동본',originalMetadata:{author:src.value.originalAuthor||'',createdAt:src.value.createdAt||'',legacyVersion:src.value.version||''}};
 return {record,index,link,linked,src,request,value};
 }
 async function read(p:Obj,who:Obj){const c=await context(String(p.recordId||''),p.requestId);const gas=(await kv.get(key('reviewApplied',c.value.recordId))).value;return {success:true,...c.value,requestId:c.link.value?.requestId||'',canReview:(await config(who)).canReview,mirrorPending:c.value.reviewVersion>Number(gas?.version||0),appliedVersion:Number(gas?.version||0)};}
 async function save(p:Obj,who:Obj){
 admin(who);if(!(await config(who)).enabled)throw new Error('기존 대기열 전환과 검수 활성화를 먼저 완료하세요.');
 const op=String(p.operationId||'');if(!/^[A-Za-z0-9_-]{8,90}$/.test(op))throw new Error('저장 식별자가 없습니다.');
 const payload={recordId:String(p.recordId||''),requestId:String(p.requestId||''),baseReviewVersion:p.baseReviewVersion,baseBodyVersion:p.baseBodyVersion,body:p.body,confirmIdentity:!!p.confirmIdentity};
 const fingerprint=await bodyHash({detail:JSON.stringify({uid:who.uid,payload})});
 for(let attempt=0;attempt<12;attempt++){
 const receipt=await kv.get(key('reviewOperation',op));
 if(receipt.value){if(receipt.value.uid!==who.uid||receipt.value.fingerprint!==fingerprint)throw new Error('같은 저장 ID의 내용이 변경되었습니다.');await context(payload.recordId,payload.requestId||undefined);return clone(receipt.value.response);}
 const c=await context(payload.recordId,payload.requestId||undefined),old=c.value,body=validBody(p.body,old.published),meta=await kv.get(key('meta')),reference=await kv.get(key('refs')),refs=reference.value;
 const taxonomy=refs?.reviewCatalog?.taxonomy;
 if((body.cat!==old.published.cat||body.type!==old.published.type)&&(body.cat||body.type)&&(!taxonomy||!taxonomy[body.cat]||body.type&&!taxonomy[body.cat].some((t:any)=>String(t[1])===body.type)))throw new Error('분류·유형 마스터에 없는 조합입니다.');
 if(body.part!==old.published.part&&body.part&&!refs?.reviewCatalog?.parts?.includes(body.part))throw new Error('교체품 마스터에 없는 값입니다.');
 for(const [f,allowed] of Object.entries({nsFill:['','O','X'],nsAmt:['','정상','부족','과다'],jet:['','가능','교육 필요']}))if(body[f]!==old.published[f]&&!allowed.includes(body[f]))throw new Error('사용자 숙련도 평가 값을 확인하세요.');
 if(body.engineer!==old.published.engineer&&body.engineer&&!refs?.engineers?.includes(body.engineer))throw new Error('처리자는 현재 담당자 목록에서 확인하세요.');
 if(['hospitalName','date','sn','engineer'].some(f=>body[f]!==old.published[f])&&!p.confirmIdentity)throw new Error('병원·처리일·장비·처리자 변경을 확인하세요. 접수 연결은 유지됩니다.');
 if(old.reviewVersion!==p.baseReviewVersion||old.bodyVersion!==p.baseBodyVersion)return {success:false,conflict:true,code:'REVIEW_CONFLICT',current:await read(p,who),error:'다른 창에서 본문을 저장했습니다. 입력과 최신 저장본을 비교하세요.'};
 const noChange=old.reviewVersion>0&&!sourceChanges(old.published,body).length,now=new Date().toISOString(),version=old.reviewVersion+(noChange?0:1),seq=Number(meta.value.seq||0)+1;
 const next={...old,published:body,bodyVersion:await bodyHash(body),reviewVersion:version,reviewedAt:noChange?old.reviewedAt:now,reviewedBy:noChange?old.reviewedBy:who.name,reviewedUid:noChange?old.reviewedUid:who.uid};
 const r=c.request?.value?{...clone(c.request.value),revision:c.request.value.revision+1,updatedAt:now,updatedBy:who.name,latest:body.result||body.detail.slice(0,120),gubun:body.gubun}:null;
 const source={...c.src.value,...body,recordId:payload.recordId,version:next.bodyVersion,bodyVersion:next.bodyVersion,schemaVersion:2,reviewVersion:version,reviewedAt:next.reviewedAt,reviewedBy:next.reviewedBy};
 const h=c.linked?.value?{...clone(c.linked.value),source,body:body.detail,revision:c.linked.value.revision+1,updatedAt:now,updatedBy:who.name,sourceReview:{pending:false,changes:[],reviewedAt:now,reviewedBy:who.name}}:null;
 if(r&&c.linked?.value?.sourceReview?.pending)r.handoverReviewCount=Math.max(0,Number(r.handoverReviewCount||0)-1);
 const response={success:true,operationId:op,recordId:payload.recordId,reviewVersion:version,bodyVersion:next.bodyVersion,reviewedAt:next.reviewedAt,reviewedBy:next.reviewedBy,mirrorPending:true,noChange,...(r&&!noChange?{request:r}:{})};
 let tx=kv.atomic().check(receipt,c.record,c.index,c.link,c.src,reference,...(c.linked?[c.linked]:[]),...(c.request?[c.request]:[])).set(receipt.key,bounded({uid:who.uid,fingerprint,response}));
 if(noChange){if((await tx.commit()).ok)return response;continue;}
 const projection={recordId:payload.recordId,version,source:body,reviewedAt:now,reviewedBy:who.name,originalVersion:next.originalVersion};
 const ev=bounded({id:op,seq,kind:'handover_review',actor:who.name,at:now,projection,...(r?{request:r,history:h}:{})});
 if(!c.record.value)tx=tx.set(key('sourceArchive',payload.recordId,next.originalVersion),bounded(c.linked?.value?.source||c.src.value));
 tx=tx.check(meta).set(key('meta'),{...meta.value,seq}).set(c.record.key,bounded(next)).set(c.src.key,bounded(source))
 .set(key('reviewAudit',payload.recordId,version),bounded({operationId:op,uid:who.uid,actor:who.name,at:now,before:old.published,after:body,changes:sourceChanges(old.published,body).map(c=>c.field),baseReviewVersion:old.reviewVersion,originalVersion:old.originalVersion}))
 .set(key('outbox',seq),ev).set(key('change',seq),{seq,request:r});
 if(r){tx=tx.set(key('request',r.id),bounded(r)).set(key('hospital',r.hospitalId,r.id),bounded(r)).set(c.linked!.key,bounded(h)).set(key('audit',r.id,seq),ev);tx=updateRequestIndexes(tx,c.request!.value,r);const state=await indexes.writeState(Number(meta.value.seq||0),seq);tx=tx.check(state.entry).set(state.entry.key,state.value);}
 else{const state=await indexes.writeState(Number(meta.value.seq||0),seq);tx=tx.check(state.entry).set(state.entry.key,state.value);}
 if((await tx.commit()).ok)return response;
 }
 throw Object.assign(new Error('다른 저장과 겹쳤습니다. 동일 작업으로 결과를 확인하세요.'),{retrySameOperation:true});
 }
 async function activate(who:Obj){admin(who);const entry=await kv.get(key('reviewPolicy'));if(entry.value?.active)return {success:true};const status=(await kv.get(key('bridgeStatus'))).value;if(!status||status.pendingCount||status.pendingEvents||status.error||status.legacyHistoryEdits||status.reviewSchema!==2||Date.now()-Date.parse(status.checkedAt)>600000)throw new Error('새 GAS 배포와 기존 전송 대기 0건을 먼저 확인하세요.');if(!(await kv.atomic().check(entry).set(entry.key,{active:true,schemaVersion:2,activatedAt:new Date().toISOString(),uid:who.uid}).commit()).ok)throw new Error('전환 상태가 변경되었습니다. 다시 확인하세요.');return {success:true};}
 async function receipt(p:Obj,who:Obj){admin(who);const e=(await kv.get(key('reviewOperation',String(p.operationId||'')))).value;if(e&&e.uid!==who.uid)throw new Error('다른 계정의 저장 결과입니다.');if(e)await context(e.response.recordId);return {success:true,found:!!e,result:e?.response};}
 async function inbox(p:Obj,who:Obj){admin(who);const it=kv.list({prefix:key('sourceIndex')},{limit:50,cursor:p.pageCursor||undefined}),items=[];let scanned=0;for await(const e of it){scanned++;try{const c=await context(String(e.key.at(-1)));items.push({recordId:c.value.recordId,hospitalName:c.value.published.hospitalName,date:c.value.published.date,sn:c.value.published.sn,reviewVersion:c.value.reviewVersion,requestId:c.link.value?.requestId||''});}catch{}}return {success:true,items,pageCursor:scanned===50?it.cursor:null};}
 async function history(p:Obj,who:Obj){const c=await context(String(p.recordId||''),p.requestId);const it=kv.list({prefix:key('reviewAudit',c.value.recordId)},{limit:10,reverse:true,cursor:p.pageCursor||undefined}),items=[];for await(const e of it)items.push({version:e.key.at(-1),...e.value});return {success:true,items,pageCursor:items.length===10?it.cursor:null};}
 return {config,read,save,activate,receipt,inbox,history};
}
