(function(root){
 'use strict';
 function valid(v){return /^[A-Za-z0-9_-]{8,90}$/.test(String(v||''));}
 function route(search){var p=new URLSearchParams(search||'');return valid(p.get('request'))?{requestId:p.get('request'),recordId:valid(p.get('record'))?p.get('record'):''}:null;}
 function url(page,requestId,recordId){if(!['handover.html','inspection.html','hospital-work.html'].includes(page)||!valid(requestId))throw new Error('접수 연결 주소를 확인하세요.');var p=new URLSearchParams({request:requestId});if(recordId){if(!valid(recordId))throw new Error('원본 기록 주소를 확인하세요.');p.set('record',recordId);}return page+'?'+p;}
 function serials(value){return [...new Set(String(value||'').normalize('NFKC').toUpperCase().split(/[,;\s/|、，]+/).filter(Boolean))];}
 function inspectionIdentity(basic){basic=basic||{};return {hospital:String(basic.hospital||basic.sourceHospitalName||basic.hospitalName||'').normalize('NFKC').replace(/[\s_]+/g,'').toLowerCase(),date:String(basic.inspectDate||basic.date||'').slice(0,10),sn:serials(basic.serialNo||basic.sn).sort().join(',')};}
 function sameInspectionIdentity(a,b){return JSON.stringify(inspectionIdentity(a))===JSON.stringify(inspectionIdentity(b));}
 function reportForm(request){return {date:String(request.visitAt||'').slice(0,10),hosp:request.hospitalName,fse:request.engineer||'',gubun:request.gubun==='점검'?'점검':'A/S',sn:serials(request.sn).length===1?serials(request.sn)[0]:'',detail:'',remark:''};}
 function inspectionData(source,request){
  var n=String(source.cost||'').replace(/[,\s원]/g,''),cost=/^\d+(\.\d+)?$/.test(n)?Number(n):0,sn=source.sn||'';
  return {handover:{recordId:source.recordId,requestId:request.id},basic:{hospital:source.sourceHospitalName||source.hospitalName,serialNo:sn,receiveDate:String(request.registeredAt||'').slice(0,10),inspectDate:source.date,receiver:request.sales||'',csName:source.engineer||'',replacedPart:source.part==='없음'?'':source.part||'',cost:cost?cost.toLocaleString('ko-KR'):'',actionDetail:source.detail||[source.cat,source.type,source.result].filter(Boolean).join(' / '),recommend:String(source.remark||'').toUpperCase()==='N/A'?'':source.remark||'',product:/^NV/i.test(sn)?'NOVOJET':/^B[VWXY]/i.test(sn)?'CUREJET':''},pay:cost>0?'유상':'무상',types:[source.gubun==='점검'?'장비 점검':'A/S'],results:{},memos:{},photos:[],signatures:{cs:null,hs:null}};
 }
 function documentSteps(state){return [['pdf','PDF 생성'],['drive','Drive 저장'],['handover','Handover 연결'],['comment','댓글 첨부']].map(function(item){return {key:item[0],label:item[1],state:state[item[0]]||'waiting'};});}
 var api={valid:valid,route:route,url:url,serials:serials,inspectionIdentity:inspectionIdentity,sameInspectionIdentity:sameInspectionIdentity,reportForm:reportForm,inspectionData:inspectionData,documentSteps:documentSteps};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.BazWorkFlow=api;
})(typeof window==='object'?window:this);
