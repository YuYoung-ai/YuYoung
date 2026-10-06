import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../js/baz-work-manager.js',import.meta.url),'utf8');
function fixture(saved,options={}){
 const nodes=new Map(),calls=[],writes=[],detailWrites=[],posts=[],local=new Map(),filters=['active','all','trash'].map(filter=>({dataset:{filter},setAttribute(){}}));
 function node(id){if(!nodes.has(id))nodes.set(id,{id,value:id==='sort'?'visitAt':'',hidden:false,disabled:false,dataset:{},checked:false,open:false,classList:{toggle(){}},setAttribute(){},querySelector:selector=>node(selector),querySelectorAll:()=>[],add(){},addEventListener(){},showModal(){this.open=true;},close(){this.open=false;},focus(){},scrollIntoView(){}});return nodes.get(id);}
 const cache={snapshot:async()=>saved,pending:async()=>null,detail:async()=>options.detail||null,savePending:async()=>{},saveDetail:async(account,id,value)=>detailWrites.push(value),save:async(account,value)=>writes.push({account,value})};
 const api={id:()=>String(posts.length+1),get:async(action,p)=>{calls.push({action,p});return {success:true,storage:'kv',requests:[],hospitals:[],engineers:[],revision:'7',updatedAt:'2026-10-06T01:00:00Z'};},post:async(action,p)=>{posts.push({action,p});if(options.post)return options.post(action,p);const old=saved.requests.find(r=>r.id===p.requestId);return {success:true,request:{...old,revision:old.revision+1,deletedAt:action==='work_delete'?'2026-10-06T01:00:00Z':''}};}};
 vm.runInNewContext(source,{window:{BazWorkCache:cache,BazWorkAPI:api,BazAuth:{name:()=> '사용자 A',cachedLevel:()=>options.level||1}},document:{getElementById:node,querySelectorAll:selector=>selector.includes('data-filter')?filters:[],documentElement:{dataset:{}}},localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v),removeItem:k=>local.delete(k)},matchMedia:()=>({matches:false}),Option:function(){},Map,Set,Date,Intl,JSON,Array,Number,Promise,console});
 return {nodes,calls,writes,detailWrites,posts,filters,local};
}
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const saved={storage:'kv',requests:[],hospitals:[],engineers:[],revision:'6',updatedAt:'2026-10-06T00:00:00Z'};
const cached=fixture(saved);await flush();assert.equal(cached.calls.length,0,'opening cached PC does not query server');assert.equal(cached.nodes.get('sync-state').textContent,'이 PC의 보관 데이터');
cached.nodes.get('sync').onclick();await flush();assert.equal(cached.calls[0].action,'work_sync');assert.equal(cached.calls[0].p.revision,'6');assert.equal(cached.writes[0].value.revision,'7');
const first=fixture(null);await flush();assert.equal(first.calls.length,1);assert.equal(first.calls[0].action,'work_bootstrap','first PC loads one initial snapshot');assert.equal(first.writes[0].account,'사용자 A');
console.log('work-ui-cache: cached startup sends no request; user sync fetches deltas; first PC bootstraps and persists account snapshot.');
const makeRequest=(id,createdBy='사용자 A')=>({id,hospitalId:'h-'+id,hospitalName:'병원 '+id,createdBy,visitAt:'',deadline:'',symptom:'증상 '+id,status:'접수',cs:createdBy,engineer:'',sales:'',revision:4,updatedAt:'2026-10-06T00:00:00Z'});
const withRows=rows=>({...saved,requests:rows});
function selectRow(f,id,checked=true){const input={dataset:{selectRequest:id},checked};f.nodes.get('list').onchange({target:{closest:()=>input}});}
function selectPage(f){if(f.nodes.get('selection-bar').hidden)f.nodes.get('selection-mode').onclick();f.nodes.get('select-page').checked=true;f.nodes.get('select-page').onchange();}
const deletable=fixture(withRows([makeRequest('one'),makeRequest('other','사용자 B')]));await flush();
assert.equal(deletable.nodes.get('selection-bar').hidden,true,'selection controls are hidden by default');assert.equal(deletable.nodes.get('selection-mode').textContent,'삭제');
selectRow(deletable,'one');assert.equal(deletable.nodes.get('selection-count').textContent,'선택 0건','hidden mode cannot select a row');
assert.equal(deletable.nodes.get('delete-selected').disabled,true);selectPage(deletable);assert.equal(deletable.nodes.get('selection-count').textContent,'선택 1건','non-admin cannot select another owner');
deletable.nodes.get('selection-mode').onclick();assert.equal(deletable.nodes.get('selection-bar').hidden,true);assert.equal(deletable.nodes.get('selection-count').textContent,'선택 0건','closing delete mode clears selection');selectPage(deletable);
deletable.nodes.get('delete-selected').onclick();assert.equal(deletable.posts.length,0,'confirmation does not delete');assert.ok(deletable.nodes.get('lifecycle-list').innerHTML.includes('병원 one'));assert.ok(!deletable.nodes.get('lifecycle-list').innerHTML.includes('병원 other'));
deletable.nodes.get('cancel-lifecycle').onclick();assert.equal(deletable.posts.length,0,'cancel preserves records');
deletable.nodes.get('delete-selected').onclick();await deletable.nodes.get('lifecycle-form').onsubmit({preventDefault(){}});
assert.equal(deletable.posts.length,1);assert.equal(deletable.posts[0].p.baseRevision,4);assert.equal(deletable.posts[0].action,'work_delete');assert.ok(deletable.writes.at(-1).value.requests.find(r=>r.id==='one').deletedAt);assert.equal(deletable.nodes.get('selection-count').textContent,'선택 0건');
assert.equal(deletable.detailWrites.at(-1).preview,true,'unqueried histories are not cached as empty complete detail');
deletable.filters.find(f=>f.dataset.filter==='trash').onclick();assert.equal(deletable.nodes.get('selection-bar').hidden,true,'changing filters closes selection mode');assert.equal(deletable.nodes.get('selection-mode').textContent,'복원');assert.equal(deletable.nodes.get('delete-selected').hidden,true);assert.equal(deletable.nodes.get('restore-selected').hidden,false);selectPage(deletable);deletable.nodes.get('restore-selected').onclick();await deletable.nodes.get('lifecycle-form').onsubmit({preventDefault(){}});assert.equal(deletable.posts[1].action,'work_restore');assert.equal(deletable.posts[1].p.baseRevision,5,'restore uses current displayed revision');
const paged=fixture(withRows(Array.from({length:51},(_,i)=>makeRequest(String(i)))));await flush();selectPage(paged);assert.equal(paged.nodes.get('selection-count').textContent,'선택 50건','select all applies only to current page');paged.nodes.get('next').onclick();assert.equal(paged.nodes.get('selection-count').textContent,'선택 0건','page change clears hidden selections');selectPage(paged);paged.nodes.get('search').value='missing';paged.nodes.get('search').oninput();assert.equal(paged.nodes.get('selection-count').textContent,'선택 0건','search cannot leave hidden selections');
const partial=fixture(withRows([makeRequest('one'),makeRequest('two')]),{post:async(action,p)=>p.requestId==='one'?{success:true,request:{...makeRequest('one'),deletedAt:'now',revision:5}}:{success:false,error:'다른 PC에서 수정되었습니다.',conflict:true}});await flush();selectPage(partial);partial.nodes.get('delete-selected').onclick();await partial.nodes.get('lifecycle-form').onsubmit({preventDefault(){}});assert.equal(partial.posts.length,2);assert.equal(partial.nodes.get('selection-count').textContent,'선택 1건','failed row remains selected');assert.ok(partial.nodes.get('notice').textContent.includes('다른 PC'));
const unknown=fixture(withRows([makeRequest('one'),makeRequest('two')]),{post:async()=>({success:false,error:'응답 확인 필요',retrySameOperation:true})});await flush();selectPage(unknown);unknown.nodes.get('delete-selected').onclick();await unknown.nodes.get('lifecycle-form').onsubmit({preventDefault(){}});assert.equal(unknown.posts.length,1,'unknown result stops next row');assert.equal(unknown.nodes.get('selection-count').textContent,'선택 2건');assert.equal(unknown.nodes.get('pending').hidden,false);assert.equal(unknown.nodes.get('delete-selected').disabled,true);assert.ok([...unknown.local.keys()].some(k=>k.endsWith('_pending')),'same-operation retry is durable');
const admin=fixture(withRows([makeRequest('one','사용자 B')]),{level:3});await flush();selectPage(admin);assert.equal(admin.nodes.get('selection-count').textContent,'선택 1건','admin can select other owner');
console.log('work-list selection: owner/admin permissions, page scope, cancel, revisioned delete/restore, partial failures and uncertain-result stop passed.');
for(const revision of [4,3]){
 const detail={success:true,request:{...makeRequest('one'),revision},history:[{id:'comment',body:'기존 댓글'}],logs:[],requests:[]};
 const f=fixture(withRows([makeRequest('one')]),{detail});await flush();selectPage(f);f.nodes.get('delete-selected').onclick();await f.nodes.get('lifecycle-form').onsubmit({preventDefault(){}});
 assert.equal(f.detailWrites.at(-1).history[0].body,'기존 댓글');assert.equal(f.detailWrites.at(-1).preview,revision!==4,'only complete history from the saved base revision remains current');
}
console.log('work-list mode: hidden startup, explicit activation, closing/filter reset and complete/stale history cache preservation passed.');
const timeCode=source.split('\n').find(line=>line.trim().startsWith('function normalizeTime('));
const normalizeTime=vm.runInNewContext(timeCode+';normalizeTime;');
for(const [input,expected] of [['10:00','10:00'],['1000','10:00'],['930','09:30'],['9:05','09:05'],['0000','00:00'],['2359','23:59'],['2400',''],['1260',''],['9:5',''],['','']])assert.equal(normalizeTime(input),expected,'manual time: '+input);
console.log('manual time: colon/numeric entry, zero padding and invalid 24-hour times passed.');
const trashRow=id=>({...makeRequest(id),deletedAt:'2026-10-06T01:00:00Z'});
const purgeResponse=id=>({success:true,request:{id,hospitalId:'h-'+id,revision:5,deletedAt:'2026-10-06T01:00:00Z',purgedAt:'2026-10-06T02:00:00Z',updatedAt:'2026-10-06T02:00:00Z'}});
const purgeUi=fixture(withRows([trashRow('one'),trashRow('two'),makeRequest('live')]),{level:3,post:async(action,p)=>purgeResponse(p.requestId)});await flush();
assert.equal(purgeUi.nodes.get('empty-trash').hidden,true,'empty trash is hidden outside trash view');
purgeUi.filters.find(f=>f.dataset.filter==='trash').onclick();assert.equal(purgeUi.nodes.get('empty-trash').hidden,false);
purgeUi.nodes.get('search').value='one';purgeUi.nodes.get('search').oninput();await purgeUi.nodes.get('empty-trash').onclick();
assert.equal(purgeUi.calls.at(-1).action,'work_sync','purge confirmation uses a freshly synced trash list');
assert.equal(purgeUi.nodes.get('lifecycle-title').textContent,'휴지통 2건 비우기');assert.ok(purgeUi.nodes.get('lifecycle-list').innerHTML.includes('병원 two'),'all trash is explicitly listed despite search filter');assert.ok(!purgeUi.nodes.get('lifecycle-list').innerHTML.includes('병원 live'));
assert.equal(purgeUi.nodes.get('confirm-lifecycle').disabled,true);assert.equal(purgeUi.nodes.get('purge-confirm-label').hidden,false);
await purgeUi.nodes.get('lifecycle-form').onsubmit({preventDefault(){}});assert.equal(purgeUi.posts.length,0,'unchecked acknowledgement cannot submit');
purgeUi.nodes.get('cancel-lifecycle').onclick();assert.equal(purgeUi.posts.length,0,'cancel never purges');
await purgeUi.nodes.get('empty-trash').onclick();purgeUi.nodes.get('purge-confirm').checked=true;purgeUi.nodes.get('purge-confirm').onchange();assert.equal(purgeUi.nodes.get('confirm-lifecycle').disabled,false);
await purgeUi.nodes.get('lifecycle-form').onsubmit({preventDefault(){}});
assert.equal(purgeUi.posts.length,2);assert.ok(purgeUi.posts.every(x=>x.action==='work_purge'&&x.p.confirmPermanentDelete===true&&x.p.baseRevision===4));
assert.ok(purgeUi.detailWrites.every(x=>x===null),'purged detail cache is discarded rather than retained');
assert.equal(purgeUi.writes.at(-1).value.requests.filter(r=>r.purgedAt).length,2,'local tombstones persist for subsequent sync');assert.ok(!purgeUi.nodes.get('list').innerHTML.includes('data-id="one"'));assert.equal(purgeUi.nodes.get('empty-trash').disabled,true);
const noAdmin=fixture(withRows([trashRow('one')]));await flush();noAdmin.filters.find(f=>f.dataset.filter==='trash').onclick();assert.equal(noAdmin.nodes.get('empty-trash').hidden,true);await noAdmin.nodes.get('empty-trash').onclick();assert.equal(noAdmin.calls.length,0,'forged button invocation still checks admin access');
const purgePartial=fixture(withRows([trashRow('one'),trashRow('two')]),{level:3,post:async(action,p)=>p.requestId==='one'?purgeResponse('one'):{success:false,conflict:true,error:'다른 PC에서 복원되었습니다.'}});await flush();purgePartial.filters.find(f=>f.dataset.filter==='trash').onclick();await purgePartial.nodes.get('empty-trash').onclick();purgePartial.nodes.get('purge-confirm').checked=true;await purgePartial.nodes.get('lifecycle-form').onsubmit({preventDefault(){}});
assert.equal(purgePartial.posts.length,2);assert.equal(purgePartial.writes.at(-1).value.requests.find(r=>r.id==='two').purgedAt,undefined);assert.ok(purgePartial.nodes.get('notice').textContent.includes('1건 영구 삭제 완료'));assert.ok(purgePartial.nodes.get('notice').textContent.includes('복원되었습니다'));
console.log('empty-trash UI: admin-only trash view, fresh sync, full target preview, explicit acknowledgement, cancel, revisioned deletion, cache removal and partial-conflict retention passed.');
const statusRequest={...makeRequest('status'),status:'결과확인'},otherRequest=makeRequest('other');
const statusSelect={value:'결과확인',disabled:false,dataset:{statusRequest:'status'}},statusCalls=[],statusNotices=[];
const statusEnv={state:{requests:[statusRequest,otherRequest],detail:{request:statusRequest}},busy:false,syncing:false,bulkWorking:false,pending:null,detailLoading:false,detailError:'',document:{querySelectorAll:()=>[statusSelect]},write:async(action,p,context)=>{statusCalls.push({action,p,context});return {success:false,conflict:true,error:'다른 PC에서 수정했습니다.'};},notify:m=>statusNotices.push(m)};
const statusCode=source.slice(source.indexOf('  function updateStatusControl(){'),source.indexOf('  async function saveComment('));
const statusUi=vm.runInNewContext(statusCode+';({updateStatusControl,saveStatus,statusChanged})',statusEnv);
const statusEvent={target:{closest:selector=>selector==='[data-status-request]'?statusSelect:null}};
statusUi.updateStatusControl();assert.equal(statusSelect.disabled,false);statusUi.statusChanged(statusEvent);await flush();assert.equal(statusCalls.length,0,'same selection does not write');
statusSelect.value='완료';statusUi.statusChanged(statusEvent);await flush();assert.equal(statusCalls[0].action,'work_status');assert.equal(statusCalls[0].context,'status');assert.equal(statusCalls[0].p.baseRevision,4);assert.equal(statusCalls[0].p.status,'완료');assert.equal(Object.keys(statusCalls[0].p).length,3,'status action never resubmits unrelated fields');assert.equal(statusSelect.value,'결과확인','known conflict restores current status');assert.ok(statusNotices[0].includes('최신 내용 확인'));
for(const key of ['busy','syncing','bulkWorking','pending','detailLoading','detailError']){statusEnv[key]=true;statusUi.updateStatusControl();assert.equal(statusSelect.disabled,true,key+' locks status');await statusUi.saveStatus(statusRequest,'완료');assert.equal(statusCalls.length,1);statusEnv[key]=false;}
statusEnv.state.detail.preview=true;statusUi.updateStatusControl();assert.equal(statusSelect.disabled,true);await statusUi.saveStatus(statusRequest,'완료');assert.equal(statusCalls.length,1);statusEnv.state.detail.preview=false;
statusRequest.deletedAt='now';statusUi.updateStatusControl();assert.equal(statusSelect.disabled,true);await statusUi.saveStatus(statusRequest,'완료');assert.equal(statusCalls.length,1);delete statusRequest.deletedAt;
await statusUi.saveStatus(otherRequest,'처리중');assert.equal(statusCalls.at(-1).context,'bulk-status','list change does not open another detail');
const mobileCard=admin.nodes.get('list').innerHTML.match(/<div class="mobile-card [\s\S]*?<\/button><\/div>/)?.[0];assert.ok(mobileCard);assert.ok(mobileCard.includes('data-status-request'));assert.ok(!mobileCard.match(/<button[\s\S]*<select/),'mobile dropdown is outside the open-detail button');
console.log('inline status UI: selection immediately writes, unchanged/loading/pending/trash locks, minimal payload, conflict reset and separate list/mobile controls passed.');
