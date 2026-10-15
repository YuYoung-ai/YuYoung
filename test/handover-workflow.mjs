import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import core from '../js/baz-handover-core.js';
import flow from '../js/baz-work-flow.js';
const code=fs.readFileSync(new URL('../js/baz-handover-workflow.js',import.meta.url),'utf8');
const entries=new Map(),key='baz_handover_workflow_v1_CS_request_123',posts=[];
let storageFull=false;
const storage={getItem:k=>entries.get(k)||null,setItem:(k,v)=>{if(storageFull)throw new Error('quota');entries.set(k,v);}};
const request={id:'request_123',hospitalName:'검증 병원',sn:'SN1',engineer:'FSE',symptom:'접수 증상',revision:3};
let fail=true;
const element=()=>({hidden:true,textContent:'',disabled:true,options:[{value:''}],value:'',replaceChildren(){},appendChild(){},prepend(){},addEventListener(){},querySelector:()=>element()});
function boot(){
 const nodes={},window={BazWorkFlow:flow,handoverBoot:Promise.resolve()};
 window.BazWorkAPI={id:()=> 'operation_123',get:async(action)=>action==='work_handover_detail'?{success:true,source:{version:'v1'},workDetail:{request,history:[]}}:action==='work_document_status'?{success:true,request,sourceLinked:false}:{success:false},post:async(action,payload)=>{posts.push({action,payload:structuredClone(payload)});if(fail)throw new Error('응답 불명');return {success:true};}};
 const c={window,BazAuth:{name:()=> 'CS',token:()=> 'current-token'},BazHandover:core,localStorage:storage,document:{readyState:'complete',getElementById:id=>nodes[id]||(nodes[id]=element()),addEventListener(){},createElement:element},location:{search:'?request=request_123'},readForm:()=>c.form||{},restoreDraft:d=>c.form=d.form,setVal(){},render(){},contToInspection(){},enableCopy(){},startNewRecord(){},recheckSave(){},confirm:()=>true,RECORD_ID:'',SAVED_RECORD_ID:'',SAVED_SNAPSHOT:null,LAST_SAVE_PAYLOAD:null,LAST_REQ_ID:'',LAST_SENT_SNAPSHOT:null,setSaveState:s=>c.state=s,console};
 vm.runInNewContext(code,c);return c;
}
async function flush(){for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));}
let c=boot();await flush();
c.SAVED_RECORD_ID='report_123';c.SAVED_SNAPSHOT=core.snapshot({hosp:request.hospitalName,sn:'SN1',detail:'실제 수리'});c.form=c.SAVED_SNAPSHOT;
c.window.BazHandoverFlow.onSaved('report_123',c.form);await flush();
assert.equal(posts.length,1);assert.equal(posts[0].action,'work_field_result_link');
let saved=JSON.parse(entries.get(key));assert.equal(saved.pendingLink.operationId,'operation_123');assert.equal(saved.pendingLink.recordId,'report_123');assert.equal(c.window.BazHandoverFlow.canContinue(),false);
fail=false;c=boot();await flush();assert.deepEqual(posts[1],posts[0],'reload retries the same operation and source, never creates another field report');assert.equal(c.window.BazHandoverFlow.canContinue(),true);
c.LAST_SAVE_PAYLOAD={reqId:'report_456',token:'must-not-persist',hosp:'검증 병원'};c.LAST_SENT_SNAPSHOT=core.snapshot({hosp:'검증 병원',detail:'보관할 처리 내용'});c.window.BazHandoverFlow.pendingState('unknown');
saved=JSON.parse(entries.get(key));assert.equal(saved.pendingSave.payload.token,undefined);
const previousPosts=posts.length;c=boot();await flush();assert.equal(c.LAST_REQ_ID,'report_456');assert.equal(c.LAST_SAVE_PAYLOAD.token,'current-token');assert.equal(c.state,core.SAVE.UNKNOWN);assert.equal(posts.length,previousPosts,'unknown sheet save must first be checked with its original ID');
storageFull=true;assert.equal(c.window.BazHandoverFlow.pendingState('saving'),false,'sheet transmission is blocked when durable retry state cannot be preserved');
console.log('handover-workflow: confirmed source ID, durable exact-operation retry after reload, continuation gate, token-free pending draft and unknown-save recovery passed.');
