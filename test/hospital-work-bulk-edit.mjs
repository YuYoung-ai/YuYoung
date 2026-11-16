import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Exercise the production save queue with a fake transport; never touch live requests.
const source=fs.readFileSync(new URL('../js/baz-work-manager.js',import.meta.url),'utf8');
function productionFunction(name){
  const start=source.search(new RegExp('^  (?:async )?function '+name+'\\(', 'm'));
  assert.notEqual(start,-1,name+' exists');
  const rest=source.slice(start+1),next=rest.search(/^  (?:async )?function /m);
  return source.slice(start,next<0?source.length:start+1+next);
}
const functions=['normalizeTime','captureInline','updateInlineBulkControls','inlineFailure','saveInlineDraft','saveAllInline','write','sendPending'].map(productionFunction).join('\n');
function fixture(){
  const context=vm.createContext({setTimeout,clearTimeout});
  vm.runInContext(`
    var elements=new Map(),saved=new Map(),calls=[],messages=[],responses=[],operation=0,renders=0;
    var busy=false,pending=null,syncing=false,bulkWorking=false,referenceRefreshing=false,inlineBulkWorking=false,inlineBulkMessage='';
    var editMode=true,activeField=null,inlineDrafts={},pendingKey='pending',account='fixture',lifecyclePlan=null;
    var state={loaded:true,filter:'all',requests:[],hospitals:[{key:'h',name:'샘플병원'}],detail:null};
    var detailCache=new Map(),detailLoading=false,detailError='',embedded=false,commentEdit=null;
    var $=id=>{if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,textContent:'',attributes:{},setAttribute(k,v){this.attributes[k]=v;},querySelectorAll(){return [];}});return elements.get(id);};
    var document={querySelectorAll(){return [];}};
    var cache={savePending:async()=>{},detail:async()=>null,saveDetail:async()=>{}};
    var api={id:()=>String(++operation),post:async(action,payload)=>{calls.push(JSON.parse(JSON.stringify({action,payload})));var next=responses.shift();if(next instanceof Error)throw next;if(next)return next;var r=state.requests.find(x=>x.id===payload.id);return {success:true,request:Object.assign({},r,payload.form,{revision:r.revision+1,updatedAt:'now'})};}};
    function store(k,v){saved.set(k,JSON.parse(JSON.stringify(v)));return true;}
    function flushInlineDrafts(){store('drafts',inlineDrafts);}
    function scheduleInlineDrafts(){flushInlineDrafts();}
    function label(h){return h.name;}
    function hospitalChanged(){return false;}
    function inlineValues(r){return r;}
    function upsert(r){var i=state.requests.findIndex(x=>x.id===r.id);state.requests[i]=r;}
    function renderList(){renders++;updateInlineBulkControls();}
    function renderDetail(){renders++;}
    function renderEdits(){renderList();}
    function updatePending(){updateInlineBulkControls();}
    async function persistSnapshot(){}
    function notify(message){messages.push(message);}
    function time(value){return value||'';}
    function add(id,changes={}){var r={id,hospitalId:'h',hospitalName:'샘플병원 '+id,hospitalKey:'h',revision:1,status:'접수',symptom:'수정 전'};state.requests.push(r);inlineDrafts[id]={baseRevision:1,form:Object.assign({hospitalInput:'샘플병원',hospitalKey:'h',gubun:'A/S',status:'접수',symptom:'수정 후 '+id,cs:'CS',engineer:'',sales:'',registeredDate:'2026-11-16',registeredTime:'1000',visitDate:'',visitTime:'',deadlineDate:'',deadlineTime:'',asType:'',ncare:''},changes)};}
    ${functions}
  `,context);
  return {context,run:code=>vm.runInContext(code,context)};
}

// All drafts are saved, including ones outside the current page/filter.
{
  const f=fixture();f.run("add('a');add('b');add('off-page');");
  await f.run('saveAllInline()');
  assert.equal(f.context.calls.length,3);
  assert.equal(f.context.calls[0].action,'work_request_edit');
  assert.equal(f.context.calls[0].payload.form.registeredAt,'2026-11-16T10:00');
  assert.equal(f.context.calls[0].payload.baseRevision,1);
  assert.equal(f.run('Object.keys(inlineDrafts).length'),0);
  assert.equal(f.run("$('inline-save-all').disabled"),true);
  assert.equal(f.context.inlineBulkMessage,'3건 저장 완료');
}
// Validation errors and revision conflicts retain drafts; other valid rows still save.
{
  const f=fixture();f.run("add('invalid',{registeredTime:'99:99'});add('conflict');add('ok');responses.push({success:false,conflict:true,error:'다른 사용자의 변경',current:{id:'conflict',hospitalName:'샘플병원',revision:2}});");
  await f.run('saveAllInline()');
  assert.equal(f.context.calls.length,2,'invalid input never reaches the transport');
  assert.equal(f.run('Object.keys(inlineDrafts).sort().join()'),'conflict,invalid');
  assert.equal(f.run('inlineDrafts.conflict.baseRevision'),1,'never overwrite a newer revision automatically');
  assert.equal(f.run('inlineDrafts.conflict.current.revision'),2);
  assert.match(f.run('inlineDrafts.invalid.error'),/등록 날짜/);
  assert.match(f.context.inlineBulkMessage,/1건 저장 완료.*확인 필요 2건.*미저장 2건/);
}
// Unknown outcome stops the queue. Retry uses exactly the original operation ID.
{
  const f=fixture();f.run("add('a');add('b');responses.push(new Error('timeout'));");
  await f.run('saveAllInline()');
  assert.equal(f.context.calls.length,1);
  assert.equal(f.run('Object.keys(inlineDrafts).length'),2);
  assert.ok(f.context.pending);
  assert.equal(f.run("$('inline-save-all').disabled"),true);
  const id=f.context.calls[0].payload.operationId;
  await f.run('sendPending()');
  assert.equal(f.context.calls[1].payload.operationId,id);
  assert.equal(f.run('Object.keys(inlineDrafts).join()'),'b');
  await f.run('saveAllInline()');
  assert.equal(f.run('Object.keys(inlineDrafts).length'),0);
  assert.equal(f.context.calls.length,3);
}
// A definite rejection on retry also restores the per-row conflict UI.
{
  const f=fixture();f.run("add('a');responses.push(new Error('timeout'));");await f.run('saveAllInline()');
  f.run("responses.push({success:false,duplicate:true,error:'중복 일정',candidates:[]});");await f.run('sendPending()');
  assert.equal(f.run('inlineDrafts.a.duplicate'),true);
  assert.match(f.run('inlineDrafts.a.error'),/중복 일정/);
  assert.equal(f.context.pending,null);
}
// On mobile, the hidden desktop editor must not overwrite the visible active input.
{
  const f=fixture();f.run(`add('a');
    var hidden={dataset:{inlineForm:'a'},getClientRects:()=>[]};
    var visible={dataset:{inlineForm:'a'},getClientRects:()=>[{}],classList:{add(){}},querySelector:()=>null,querySelectorAll:()=>[{dataset:{inlineField:'symptom'},type:'textarea',value:'현재 입력 중인 내용'}]};
    $('list').querySelectorAll=()=>[hidden,visible];activeField={id:'a',host:'list',field:'symptom'};
  `);
  await f.run('saveAllInline()');
  assert.equal(f.context.calls[0].payload.form.symptom,'현재 입력 중인 내용');
}
// No batch starts without edit mode or while another save is pending/in progress.
for(const guard of ['editMode=false','pending={}','bulkWorking=true','syncing=true','referenceRefreshing=true',"state.filter='trash'"]){
  const f=fixture();f.run("add('a');"+guard);await f.run('saveAllInline()');assert.equal(f.context.calls.length,0,guard);
}
console.log('Bulk edit queue: success, validation, conflict, retry identity, mobile capture and guards passed.');
