type Obj=Record<string,any>;
export const flowName=(v:any)=>String(v||'').normalize('NFKC').replace(/\s+/g,'').replace(/의원/g,'').toLowerCase();
export function parseFlowRow(row:Obj){
 const hospitalName=String(row.hospitalName||'').trim(),raw=String(row.content||'').replace(/\u00a0/g,' ').trim(),visitAt=String(row.visitAt||'').slice(0,16),cs=String(row.cs||'').trim(),engineer=String(row.engineer||'').trim();
 if(!hospitalName||hospitalName.length>200||raw.length>12000||!cs||cs.length>60||engineer.length>60)throw new Error('Flow 원본 병원명·내용·담당자를 확인하세요.');
 if(!/^2026-\d{2}-\d{2}T\d{2}:\d{2}$/.test(visitAt)||!Number.isFinite(+new Date(visitAt+':00+09:00'))||new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(visitAt+':00+09:00')).replace(' ','T')!==visitAt)throw new Error('방문일이 2026년인 유효한 접수만 이전할 수 있습니다.');
 if(!['요청','완료'].includes(String(row.status)))throw new Error('Flow 원본 상태를 확인하세요.');
 const first=raw.split(/2차\s*A\s*\/\s*S/i)[0],second=raw.slice(first.length)||raw;
 const requestMatch=/요청사항[ \t]*[:：]?[ \t]*(?:[（(]([^）)]+)[）)]|([^\n]*))/i.exec(first),request=(requestMatch?.[1]||requestMatch?.[2]||'').trim();
 const gubun=/점검/.test(request)?'점검':/^A\s*\/?\s*S/i.test(request)||/업그레(?:이드|드)|업데이트/.test(request)||(request==='UI'&&/A\s*\/\s*S\s*항목\s*[:：]/i.test(second))?'A/S':request||(/A\s*\/\s*S\s*항목\s*[:：]/i.test(second)?'A/S':'');
 const description=(/상세\s*내용\s*[:：]([\s\S]*?)(?=특이\s*사항\s*[:：]|$)/.exec(first)?.[1]||/접수사항\s*[:：]([^\n]*)/.exec(first)?.[1]||'').trim();
 const symptom=description||'접수 상세내용 미기록 · Flow 원문 참조';
 const field=(pattern:RegExp)=>pattern.exec(second)?.[1]?.trim()||'';
 const rawSn=field(/S\s*\/\s*N\s*\(장비\)\s*[:：]([^\n]*)/i),sn=/^(N\/A|미기록|없음|-)$/i.test(rawSn)?'':rawSn;
 const result=field(/A\s*\/\s*S\s*결과\s*[:：]([^\n]*)/i);
 const detail=field(/A\s*\/\s*S\s*내용\s*상세\s*[:：]([\s\S]*?)(?=A\s*\/\s*S\s*결과\s*[:：]|\[사용자|$)/i);
 const source={origin:'flow',hospitalName,date:visitAt.slice(0,10),engineer,sn,gubun,cat:'',type:field(/A\s*\/\s*S\s*항목\s*[:：]([^\n]*)/i),detail,result,part:'',cost:'',remark:field(/비고\s*\/\s*특이사항\s*[:：]([\s\S]*)/i)};
 return {hospitalName,raw,visitAt,registeredAt:visitAt,cs,engineer,gubun,symptom: symptom.slice(0,4000),source,status:row.status==='완료'?'완료':engineer?'방문예정':'접수'};
}
export function matchFlowHospital(row:Obj,hospitals:Obj[]){
 const n=flowName(row.hospitalName),sn=row.source.sn;
 const exact=hospitals.filter(h=>h.origin!=='flow'&&flowName(h.name)===n);
 const serial=sn?hospitals.filter(h=>h.origin!=='flow'&&h.sn===sn&&(n.includes(flowName(h.name))||flowName(h.name).includes(n))):[];
 if(serial.length===1&&(exact.length===0||exact.some(h=>h.id===serial[0].id)))return {hospital:serial[0],match:'장비 S/N·병원명'};
 if(exact.length===1&&(!sn||!exact[0].sn||sn===exact[0].sn))return {hospital:exact[0],match:'병원명'};
 return {hospital:null,match:exact.length||serial.length?'병원 기준 확인 필요':'원본 병원명 유지'};
}
