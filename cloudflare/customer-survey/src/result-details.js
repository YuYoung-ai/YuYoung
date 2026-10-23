const sql=(env,q,...v)=>env.DB.prepare(q).bind(...v);
const all=async s=>(await s.all()).results||[];
export async function countComments(env,definition,f){
 const ids=definition.questions.filter(q=>q.type==='text').map(q=>q.id);if(!ids.length)return 0;
 return (await sql(env,`SELECT COUNT(*) n FROM survey_responses r,json_each(r.answers) j WHERE ${f.where} AND j.key IN (${ids.map(()=>'?').join(',')}) AND j.type='text' AND trim(j.value)<>''`,...f.values,...ids).first()).n;
}
export async function resultDetails(env,p,c,{filters,fail}){
 const kind=p.kind,allowed=['sent','responded','rate','comments','history'];if(!allowed.includes(kind))fail(400,'상세 목록 종류를 확인해 주세요.');
 const f=filters(p),page=p.page??0,pageSize=p.pageSize??(kind==='comments'?4:50);
 if(!Number.isSafeInteger(page)||page<0||page>100000||![4,20,50].includes(pageSize))fail(400,'목록 페이지를 확인해 주세요.');
 if(p.search!=null&&(typeof p.search!=='string'||p.search.length>100))fail(400,'검색어는 100자 이내로 입력해 주세요.');
 const search=(p.search||'').trim(),offset=page*pageSize;let rows,total;
 if(kind==='comments'){
  const questions=JSON.parse(c.definition).questions.filter(q=>q.type==='text'),ids=questions.map(q=>q.id),titles=new Map(questions.map(q=>[q.id,q.title]));
  if(p.sort!=null&&!['latest','oldest'].includes(p.sort))fail(400,'정렬 방식을 확인해 주세요.');
  if(!ids.length)return {success:true,kind,rows:[],total:0,page,pageSize,hasMore:false};
  const where=`${f.where} AND j.key IN (${ids.map(()=>'?').join(',')}) AND j.type='text' AND trim(j.value)<>''`+(search?' AND (instr(lower(j.value),lower(?))>0 OR instr(lower(h.name),lower(?))>0)':''),values=[...f.values,...ids,...(search?[search,search]:[])];
  const from=`FROM survey_responses r JOIN survey_hospitals h ON h.id=r.hospital_id,json_each(r.answers) j WHERE ${where}`;
  total=(await sql(env,'SELECT COUNT(*) n '+from,...values).first()).n;
  const direction=p.sort==='oldest'?'ASC':'DESC';rows=(await all(sql(env,`SELECT r.id,r.hospital_id hospitalId,h.name,r.submitted_at submittedAt,j.key questionId,j.value comment ${from} ORDER BY r.submitted_at ${direction},r.id ${direction},j.key LIMIT ? OFFSET ?`,...values,pageSize,offset))).map(r=>({...r,id:r.id+':'+r.questionId,questionTitle:titles.get(r.questionId)}));
 }else if(kind==='history'){
  if(typeof p.hospitalId!=='string'||!p.hospitalId||p.hospitalId.length>100)fail(400,'병원을 선택해 주세요.');
  const where='e.campaign_id=? AND e.hospital_id=?',values=[c.id,p.hospitalId];
  total=(await sql(env,'SELECT COUNT(*) n FROM survey_delivery_events e WHERE '+where,...values).first()).n;
  rows=await all(sql(env,'SELECT e.id,e.channel,e.delivered_at deliveredAt FROM survey_delivery_events e WHERE '+where+' ORDER BY e.delivered_at DESC,e.id DESC LIMIT ? OFFSET ?',...values,pageSize,offset));
 }else{
  const sent=kind!=='responded',values=sent?[c.id,...(p.hospitalId?[String(p.hospitalId)]:[])]:[...f.values];
  let where=sent?'d.campaign_id=?'+(p.hospitalId?' AND d.hospital_id=?':''):f.where;
  if(search){where+=' AND instr(lower(h.name),lower(?))>0';values.push(search);}
  const from=sent?'FROM survey_deliveries d JOIN survey_hospitals h ON h.id=d.hospital_id LEFT JOIN survey_responses r ON r.campaign_id=d.campaign_id AND r.hospital_id=d.hospital_id':'FROM survey_responses r JOIN survey_hospitals h ON h.id=r.hospital_id LEFT JOIN survey_deliveries d ON d.campaign_id=r.campaign_id AND d.hospital_id=r.hospital_id';
  total=(await sql(env,'SELECT COUNT(*) n '+from+' WHERE '+where,...values).first()).n;
  const order=sent?'d.delivered_at DESC,h.id':'r.submitted_at DESC,r.id';
  rows=await all(sql(env,`SELECT h.id hospitalId,h.name,d.channel,d.delivered_at deliveredAt,r.submitted_at submittedAt,(SELECT COUNT(*) FROM survey_delivery_events e WHERE e.campaign_id=? AND e.hospital_id=h.id) deliveryCount ${from} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,c.id,...values,pageSize,offset));
  rows=rows.map(r=>({...r,responseInPeriod:r.submittedAt!=null&&(p.from==null||r.submittedAt>=p.from)&&(p.until==null||r.submittedAt<p.until)}));
 }
 return {success:true,kind,rows,total,page,pageSize,hasMore:offset+rows.length<total};
}
