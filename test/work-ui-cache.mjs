import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const fieldApi=vm.runInNewContext(fs.readFileSync(new URL('../js/baz-work-fields.js',import.meta.url),'utf8')+';module.exports;', {module:{exports:{}}});
const source=fs.readFileSync(new URL('../js/baz-work-manager.js',import.meta.url),'utf8');
function fixture(saved,options={}){
 const intervals=new Map(),timeouts=new Map(),listeners=new Map(),nodeEvents=new Map(),rosterCalls=[],htmlWrites=new Map();let timerId=0;
 const runTimers=()=>{for(const [id,timer] of [...timeouts]){timeouts.delete(id);timer.fn();}};
 const workspaceAll={dataset:{workspace:'all'},setAttribute(){}};
 let searchOptions;const hospitalSearch={create:config=>{searchOptions=config;return {refresh(){}};}};
 const nodes=new Map(),calls=[],writes=[],detailWrites=[],posts=[],localWrites=[],local=new Map(),filters=['all','active','today','week','lastweek','month','trash'].map(filter=>({dataset:{filter},setAttribute(){}}));
 function node(id){if(!nodes.has(id))nodes.set(id,{id,value:id==='sort'?'visitAt':'',hidden:false,disabled:false,dataset:{},checked:false,open:false,classList:{toggle(){},add(){}},setAttribute(){},querySelector:selector=>node(selector),querySelectorAll:()=>[],add(){},after(){},append(){},prepend(){},addEventListener(type,fn){const key=this.id+':'+type,previous=nodeEvents.get(key);nodeEvents.set(key,event=>{previous?.(event);fn(event);});},showModal(){this.open=true;},close(){this.open=false;},focus(){},scrollIntoView(){}});return nodes.get(id);}
 const cache={snapshot:async()=>saved,pending:async()=>null,detail:async()=>options.detail||null,savePending:async()=>{},saveDetail:async(account,id,value)=>detailWrites.push(value),save:async(account,value)=>writes.push({account,value})};
 const api={id:()=>String(posts.length+1),get:async(action,p)=>{if(action==='work_roster'&&p.rosterMonth===new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).format(new (options.Date||Date)())){rosterCalls.push({action,p});return options.rosterGet?options.rosterGet(p):{success:true,roster:[],rosterMonth:p.rosterMonth};}calls.push({action,p});if(options.get)return options.get(action,p);return {success:true,storage:'kv',requests:[],hospitals:[],engineers:[],revision:'7',roster:[],rosterMonth:p.rosterMonth||'2026-10',updatedAt:'2026-10-06T01:00:00Z'};},post:async(action,p)=>{posts.push({action,p});if(options.post)return options.post(action,p);const old=saved.requests.find(r=>r.id===p.requestId);return {success:true,request:{...old,revision:old.revision+1,deletedAt:action==='work_delete'?'2026-10-06T01:00:00Z':''}};}};
 const document={hidden:false,addEventListener:(type,fn)=>{const previous=listeners.get(type);listeners.set(type,()=>{previous?.();fn();});},getElementById:node,createElement:tag=>node('created-'+tag),querySelectorAll:selector=>selector.includes('data-workspace')?[workspaceAll]:selector.includes('data-filter')?filters:[],documentElement:{dataset:{}}};
 vm.runInNewContext(source,{window:{location:{search:''},addEventListener:(type,fn)=>listeners.set('window:'+type,fn),BazWorkHospitalSearch:hospitalSearch,BazWorkFields:fieldApi,BazWorkCache:cache,BazWorkAPI:api,BazAuth:{name:()=>options.account?options.account():'사용자 A',cachedLevel:()=>options.level||1}},document,setTimeout:(fn,ms)=>{timeouts.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timeouts.delete(id),setInterval:(fn,ms)=>{intervals.set(++timerId,{fn,ms});return timerId;},clearInterval:id=>intervals.delete(id),localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>{localWrites.push({key:k,value:v});local.set(k,v);},removeItem:k=>local.delete(k)},matchMedia:()=>({matches:false}),Option:function(){},URL,URLSearchParams,Map,Set,Date:options.Date||Date,Intl,JSON,Array,Number,Promise,console});
 // These cache/edit tests exercise the full list; role-specific views have their own suite.
 workspaceAll.onclick();filters.find(f=>f.dataset.filter==='all').onclick();
 return {nodes,calls,rosterCalls,writes,detailWrites,posts,filters,local,localWrites,searchOptions,document,intervals,timeouts,runTimers,listeners,nodeEvents,htmlWrites,tick:()=>{for(const timer of intervals.values())timer.fn();},visibility:hidden=>{document.hidden=hidden;listeners.get('visibilitychange')?.();},dispose:()=>intervals.clear()};
}
{
 const escapeCode=source.split('\n').find(line=>line.trim().startsWith('function esc('));
 const linkCode=source.slice(source.indexOf('  function commentMarkup('),source.indexOf('  function store('));
 const links=vm.runInNewContext(escapeCode+'\n'+linkCode+'\ncommentMarkup;', {URL});
 const body='확인 <script>alert(1)</script>\nhttps://example.com/a?q=1&b=2. 다음 (https://example.com/a_(b)) http://example.org/한글\nhttps://example.com/" onclick="bad';
 const html=links(body);
 assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
 assert.ok(html.includes('href="https://example.com/a?q=1&amp;b=2"'));
 assert.ok(html.includes('>https://example.com/a?q=1&amp;b=2</a>.'));
 assert.ok(html.includes('href="https://example.com/a_(b)"'));
 assert.ok(html.includes('href="http://example.org/한글"'));
 assert.ok(html.includes('target="_blank" rel="noopener noreferrer"'));
 assert.ok(!html.includes(' onclick="bad'));
 for(const unsafe of ['javascript:alert(1)','data:text/html,<script>alert(1)</script>','https://user:pass@example.com/','https://'])assert.ok(!links(unsafe).includes('<a '));
 assert.equal(links('첫 줄\n둘째 줄'),'첫 줄\n둘째 줄');
 assert.ok(source.includes('commentMarkup(h.body)'), 'comment timeline uses link formatting');
 console.log('comment URL: HTTP/HTTPS, multiple URLs, query escaping, Unicode, punctuation/brackets, new-tab isolation and unsafe markup/protocol/credentials rejection passed.');
}
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const saved={storage:'kv',requests:[],hospitals:[],engineers:[],revision:'6',updatedAt:'2026-10-06T00:00:00Z'};
const cached=fixture(saved);await flush();assert.equal(cached.calls.length,0,'opening cached PC does not query server');assert.equal(cached.nodes.get('sync-state').textContent,'이 PC의 보관 데이터');
assert.equal(cached.nodes.get('handover-pending').textContent,'Handover 대기 미확인','missing queue status must not invent zero');
const queue={pendingCount:2,pendingEvents:3,failedCount:1,checkedAt:new Date().toISOString(),error:'원본 확인 필요'};
const pendingView=fixture({...saved,bridgeStatus:queue},{get:async()=>({success:true,storage:'kv',requests:[],hospitals:[],engineers:[],revision:'6',updatedAt:new Date().toISOString(),bridgeStatus:{...queue,pendingCount:0,pendingEvents:0,failedCount:0,error:''}})});await flush();
assert.equal(pendingView.calls.length,0);assert.ok(pendingView.nodes.get('handover-pending').textContent.includes('2건'));assert.equal(pendingView.nodes.get('handover-pending').dataset.state,'error');
await pendingView.nodes.get('sync').onclick();await flush();assert.equal(pendingView.nodes.get('handover-pending').textContent,'Handover 대기 0건');assert.equal(pendingView.writes.at(-1).value.bridgeStatus.pendingCount,0);
const staleQueue=fixture({...saved,bridgeStatus:{...queue,error:'',checkedAt:'2026-01-01T00:00:00Z'}});await flush();assert.ok(staleQueue.nodes.get('handover-pending').textContent.includes('이전 집계'));
cached.nodes.get('sync').onclick();await flush();assert.equal(cached.calls[0].action,'work_sync');assert.equal(cached.calls[0].p.revision,'6');assert.equal(cached.writes[0].value.revision,'7');
const first=fixture(null);await flush();assert.equal(first.calls.length,1);assert.equal(first.calls[0].action,'work_bootstrap','first PC loads one initial snapshot');assert.equal(first.writes[0].account,'사용자 A');
console.log('work-ui-cache: cached startup sends no request; user sync fetches deltas; first PC bootstraps and persists account snapshot.');
const masterOnly=fixture({...saved,hospitals:[{id:'master',key:'master',name:'병원정보DB 병원',sn:'BW3007'},{id:'flow',key:'flow',name:'엑셀 이력 병원',sn:'과거 번호',origin:'flow'}]});await flush();
assert.equal(masterOnly.searchOptions.getRows()[0].name,'병원정보DB 병원');
assert.equal(masterOnly.searchOptions.getRows().length,1,'historical names do not pollute new-request autocomplete, including cached PCs');
assert.equal(masterOnly.searchOptions.formatValue(masterOnly.searchOptions.getRows()[0]),'병원정보DB 병원 · BW3007 · 지역 미기록');
const makeRequest=(id,createdBy='사용자 A')=>({id,hospitalId:'h-'+id,hospitalName:'병원 '+id,createdBy,visitAt:'',deadline:'',symptom:'증상 '+id,status:'접수',cs:createdBy,engineer:'',sales:'',revision:4,updatedAt:'2026-10-06T00:00:00Z'});
const withRows=rows=>({...saved,requests:rows});
{
 const f=fixture(withRows([makeRequest('double')]));await flush();f.nodes.get('edit-mode').onclick();
 const button={dataset:{editField:'cs',editRequest:'double'},disabled:false,closest:()=>null},event={target:{closest:selector=>['button','[data-edit-field]'].includes(selector)?button:null},preventDefault(){}};
 assert.ok(!f.nodes.get('list').innerHTML.includes('edit-pencil'));
 f.nodes.get('list').onclick(event);assert.ok(!f.nodes.get('list').innerHTML.includes('data-inline-field="cs"'),'single click keeps the clean text');
 f.nodes.get('list').ondblclick(event);assert.ok(f.nodes.get('list').innerHTML.includes('data-inline-field="cs"'),'double click edits in the existing table');
 f.nodes.get('edit-mode').onclick();f.nodes.get('list').ondblclick(event);assert.ok(!f.nodes.get('list').innerHTML.includes('data-inline-field="cs"'),'read mode cannot edit');
 f.nodes.get('edit-mode').onclick();f.nodes.get('list').onkeydown({...event,key:'Enter'});assert.ok(f.nodes.get('list').innerHTML.includes('data-inline-field="cs"'),'keyboard Enter opens the same field');
 console.log('clean editing: no pencils, single-click read, double-click editing, keyboard Enter and read-mode guard passed.');
}
{
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const row=(id,status,visitAt,engineer='',cs='사용자 A')=>({...makeRequest(id),status,visitAt,engineer,cs,deadline:visitAt,updatedAt:visitAt?visitAt+':00Z':'2026-01-01T00:00:00Z'});
 const rows=[row('earlier','완료',today+'T09:00'),row('later','방문예정',today+'T13:00','사용자 A'),row('missing','완료',''),{...row('trash','완료',today+'T08:00'),deletedAt:'deleted'},row('cancelled','취소',today+'T10:00')];
 const f=fixture(withRows(rows));await flush();
 const choose=filter=>f.filters.find(x=>x.dataset.filter===filter).onclick();
 const ids=()=>Array.from(f.nodes.get('list').innerHTML.matchAll(/class="row-open" data-open="([^"]+)"/g),x=>x[1]).filter(id=>id!=='cancelled');
 choose('today');assert.deepEqual(ids(),['earlier','later']);assert.equal(f.nodes.get('count-total').textContent,3,'today metric includes completed visits but excludes trash/cancellation');
 choose('all');assert.ok(ids().includes('missing'));
 choose('all');
 choose('active');assert.deepEqual(ids(),['later'],'active filter still excludes completion');
 choose('all');f.nodes.get('advanced-groups').onclick({target:{closest:()=>({dataset:{advanced:'status',value:'완료'}})}});assert.deepEqual(ids(),['earlier','missing'],'status intersection is preserved');f.nodes.get('advanced-groups').onclick({target:{closest:()=>({dataset:{advanced:'status',value:''}})}});
 for(const sort of ['visit','updated','deadline']){
  f.nodes.get('sort').value=sort;f.nodes.get('sort-direction').value='asc';f.nodes.get('sort-direction').onchange();assert.deepEqual(ids(),sort==='updated'?['missing','earlier','later']:['earlier','later','missing']);
  f.nodes.get('sort-direction').value='desc';f.nodes.get('sort-direction').onchange();assert.deepEqual(ids(),['later','earlier','missing'],'descending dates with unset dates kept last');
 }
 assert.equal(f.calls.length,0,'changing filters and direction works entirely on cached data');
 console.log('list filters/sort: completed today/all records, matching today count, status intersection, both directions for every date criterion and missing-date placement passed.');
}
{
 const h={id:'h1',key:'key1',name:'기준 병원',sn:'BW3007'},r={...makeRequest('inline'),hospitalId:h.id,hospitalKey:h.key,hospitalName:h.name,registeredAt:'2026-10-06T09:00',visitAt:'2026-10-06T10:00',gubun:'점검'},r2={...r,id:'inline2'};
 const f=fixture({...saved,requests:[r,r2],hospitals:[h],engineers:['기사']},{post:async(action,p)=>{
  const request={...r,...p.form,id:p.id,revision:r.revision+2,gubun:'점검'},event={id:'inline-edit',kind:'request_update'};
  return {success:true,request,event,workDetail:{success:true,request,history:[{id:'retained',kind:'comment',body:'기존 댓글'},{id:'auto-linked',kind:'result',source:{gubun:'점검',sn:'BV5015'}}],logs:[event],requests:[]}};
 }});await flush();
 assert.equal(f.nodes.get('edit-mode').textContent,'수정');f.nodes.get('edit-mode').onclick();assert.equal(f.nodes.get('edit-mode').textContent,'수정 모드 닫기');assert.ok(f.nodes.get('list').innerHTML.includes('data-inline-form="inline"'));assert.ok(f.nodes.get('list').innerHTML.includes('data-edit-field="hospitalInput"'));assert.ok(f.nodes.get('list').innerHTML.includes('<table>'));assert.ok(!f.nodes.get('list').innerHTML.includes('inline-request-list'));
 const fields={hospitalInput:h.name,gubun:'A/S',status:'완료',cs:'수정 CS',engineer:'기사',sales:'영업',registeredDate:'2026-10-06',registeredTime:'900',visitDate:'2026-10-06',visitTime:'1030',symptom:'직접 수정 내용'};
 function form(id,values){return {dataset:{inlineForm:id},querySelectorAll:()=>Object.entries(values).map(([key,value])=>({dataset:{inlineField:key},type:'text',value})),querySelector:()=>({hidden:false}),classList:{add(){}}};}
 const other=form('inline2',{...fields,symptom:'다른 접수 초안'});f.nodes.get('list').oninput({target:{dataset:{inlineField:'symptom'},closest:()=>other}});
 const one=form('inline',fields);f.nodes.get('list').oninput({target:{dataset:{inlineField:'symptom'},closest:()=>one}});f.nodes.get('sort').onchange();assert.ok(f.nodes.get('list').innerHTML.includes('직접 수정 내용'),'rerender retains row draft');
 await f.nodes.get('list').onsubmit({target:{closest:()=>one},preventDefault(){}});assert.equal(f.posts[0].action,'work_request_edit');assert.equal(f.posts[0].p.baseRevision,r.revision);assert.equal(f.posts[0].p.form.registeredAt,'2026-10-06T09:00');assert.equal(f.posts[0].p.form.visitAt,'2026-10-06T10:30');assert.equal(f.posts[0].p.form.gubun,'A/S');assert.ok(f.nodes.get('list').innerHTML.includes('다른 접수 초안'),'saving one row does not discard other row drafts');
 assert.equal(f.detailWrites.at(-1).history.length,2,'save-and-reconcile response retains the comment and new result in the local cache');
 assert.equal(f.detailWrites.at(-1).request.gubun,'점검');assert.equal(f.detailWrites.at(-1).preview,false);assert.equal(f.detailWrites.at(-1).logs.length,1,'response audit is not duplicated');assert.equal(f.calls.length,0,'no second detail/Handover request after saving');
 f.nodes.get('selection-mode').onclick();assert.equal(f.nodes.get('edit-mode').textContent,'수정','delete mode closes edit mode');
 console.log('inline request editor: unchanged table, click-to-edit fields, row draft retention across render, independent save, manual time normalization and exclusive delete mode passed.');
}
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
const paged=fixture(withRows(Array.from({length:51},(_,i)=>makeRequest(String(i)))));await flush();selectPage(paged);assert.equal(paged.nodes.get('selection-count').textContent,'선택 50건','select all applies only to current page');paged.nodes.get('next').onclick();assert.equal(paged.nodes.get('selection-count').textContent,'선택 0건','page change clears hidden selections');selectPage(paged);paged.nodes.get('search').value='missing';paged.nodes.get('search').oninput();paged.runTimers();assert.equal(paged.nodes.get('selection-count').textContent,'선택 0건','search cannot leave hidden selections');
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
purgeUi.nodes.get('search').value='one';purgeUi.nodes.get('search').oninput();purgeUi.runTimers();await purgeUi.nodes.get('empty-trash').onclick();
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

const off={id:'off',date:'2026-08-17',person:'양승주',type:'휴무',revision:1,deletedAt:''},duty={...off,id:'duty',date:'2026-08-19',type:'당직'};
const rosterSaved={...saved,rosterMonth:'2026-08',rosterLoaded:true,roster:[duty,off]};let rosterUnknown=false;
{
 const f=fixture({...rosterSaved,roster:[duty,off,{...off,id:'removed',date:'2026-08-18',deletedAt:'deleted'}]});await flush();
 const days=f.nodes.get('roster-calendar-days').innerHTML;assert.equal((days.match(/data-calendar-date=/g)||[]).length,31);assert.equal((days.split('data-calendar-date="2026-08-01"')[0].match(/calendar-blank/g)||[]).length,6,'August 2026 begins on Saturday');
 assert.ok(days.includes('양승주 휴무'));assert.ok(days.includes('양승주 당직'));assert.ok(!days.includes('8월 18일 · 양승주'),'deleted schedules do not create calendar marks');
 f.nodes.get('roster-calendar-days').onclick({target:{closest:()=>({dataset:{calendarDate:'2026-08-17'},disabled:false})}});assert.ok(f.nodes.get('roster-calendar-selection').innerHTML.includes('양승주 휴무'));assert.equal(f.calls.length,0,'selecting a date is local');
 await f.nodes.get('roster-open').onclick();await f.nodes.get('roster-calendar-edit').onclick();assert.equal(f.nodes.get('roster-date').value,'2026-08-17');assert.equal(f.nodes.get('roster-dialog').open,true);f.nodes.get('roster-close').onclick();
 await f.nodes.get('roster-calendar-next').onclick();assert.equal(f.calls[0].action,'work_roster');assert.equal(f.calls[0].p.rosterMonth,'2026-09');assert.equal(f.nodes.get('roster-month').value,'2026-09');assert.ok(!f.nodes.get('roster-calendar-days').innerHTML.includes('양승주'));
 const leap=fixture({...saved,rosterMonth:'2024-02',rosterLoaded:true,roster:[]});await flush();assert.ok(leap.nodes.get('roster-calendar-days').innerHTML.includes('2024-02-29'));assert.ok(!leap.nodes.get('roster-calendar-days').innerHTML.includes('2024-02-30'));
 const year=fixture({...saved,rosterMonth:'2026-12',rosterLoaded:true,roster:[]});await flush();await year.nodes.get('roster-calendar-next').onclick();assert.equal(year.calls[0].p.rosterMonth,'2027-01');
 const failed=fixture(rosterSaved,{get:async()=>({success:false,error:'일정 조회 실패'})});await flush();await failed.nodes.get('roster-calendar-next').onclick();assert.equal(failed.nodes.get('roster-month').value,'2026-08');assert.equal(failed.nodes.get('roster-error').hidden,false);assert.equal(failed.nodes.get('roster-error').textContent,'일정 조회 실패');
 console.log('roster calendar: weekday alignment, leap day/year rollover, date-local details, cached startup, deleted-entry exclusion, prefilled schedule management and explicit month load/failure preservation passed.');
}
const rosterFixture=fixture(rosterSaved,{post:async(action,p)=>rosterUnknown?{success:false,retrySameOperation:true,error:'응답 확인 필요'}:{success:true,schedule:{id:p.date==='2026-08-17'?'off':'added',date:p.date,person:p.person,type:p.type||'휴무',revision:p.baseRevision+1,updatedAt:'2026-10-06T02:00:00Z',deletedAt:action==='work_roster_delete'?'now':''}}});await flush();
assert.equal(rosterFixture.calls.length,0,'cached roster opens without polling');
const rosterHeader=rosterFixture.nodes.get('roster-rows').innerHTML;assert.ok(rosterHeader.indexOf('8/17 양승주 휴무')<rosterHeader.indexOf('8/19 양승주 당직'),'header is sorted by date');
await rosterFixture.nodes.get('roster-open').onclick();assert.equal(rosterFixture.nodes.get('roster-dialog').open,true);assert.equal(rosterFixture.nodes.get('roster-month').value,'2026-08');assert.equal(rosterFixture.calls.length,0);
const fillRoster=(f,date,person,type)=>{f.nodes.get('roster-date').value=date;f.nodes.get('roster-person').value=person;f.nodes.get('roster-type').value=type;};
fillRoster(rosterFixture,'2026-08-17','양승주','당직');await rosterFixture.nodes.get('roster-form').onsubmit({preventDefault(){}});assert.equal(rosterFixture.posts.length,0,'duplicate must use explicit edit');assert.ok(rosterFixture.nodes.get('roster-error').textContent.includes('이미 등록'));
rosterFixture.nodes.get('roster-rows').onclick({target:{closest:()=>({dataset:{rosterEdit:'off'}})}});assert.equal(rosterFixture.nodes.get('roster-date').disabled,true);assert.equal(rosterFixture.nodes.get('roster-person').disabled,true);
rosterFixture.nodes.get('roster-type').value='당직';await rosterFixture.nodes.get('roster-form').onsubmit({preventDefault(){}});assert.equal(rosterFixture.posts[0].action,'work_roster_save');assert.equal(rosterFixture.posts[0].p.baseRevision,1);assert.ok(rosterFixture.nodes.get('roster-rows').innerHTML.includes('양승주 당직'));assert.equal(rosterFixture.writes.at(-1).value.requests.length,0,'schedule response never becomes a service row');assert.equal(rosterFixture.writes.at(-1).value.roster.find(r=>r.id==='off').revision,2);
fillRoster(rosterFixture,'2026-09-01','양승주','휴무');await rosterFixture.nodes.get('roster-form').onsubmit({preventDefault(){}});assert.equal(rosterFixture.posts.length,1,'form cannot save to an unseen month');
rosterFixture.nodes.get('roster-rows').onclick({target:{closest:()=>({dataset:{rosterDelete:'off'}})}});assert.equal(rosterFixture.nodes.get('roster-delete-confirm').hidden,false);assert.equal(rosterFixture.posts.length,1);rosterFixture.nodes.get('roster-delete-cancel').onclick();assert.equal(rosterFixture.posts.length,1,'cancel preserves schedule');
rosterFixture.nodes.get('roster-rows').onclick({target:{closest:()=>({dataset:{rosterDelete:'off'}})}});await rosterFixture.nodes.get('roster-delete-submit').onclick();assert.equal(rosterFixture.posts[1].action,'work_roster_delete');assert.equal(rosterFixture.posts[1].p.baseRevision,2);assert.ok(!rosterFixture.nodes.get('roster-rows').innerHTML.includes('8/17 양승주'));
rosterUnknown=true;fillRoster(rosterFixture,'2026-08-21','양승주','휴무');await rosterFixture.nodes.get('roster-form').onsubmit({preventDefault(){}});assert.equal(rosterFixture.nodes.get('pending').hidden,false);assert.equal(rosterFixture.nodes.get('roster-save').disabled,true);assert.equal(rosterFixture.nodes.get('roster-month').disabled,true);assert.equal(rosterFixture.writes.at(-1).value.roster.filter(r=>r.date==='2026-08-21').length,0,'uncertain response does not fabricate a saved entry');
const firstOperation=rosterFixture.posts.at(-1).p.operationId;rosterUnknown=false;await rosterFixture.nodes.get('retry').onclick();assert.equal(rosterFixture.posts.at(-1).p.operationId,firstOperation,'same operation retry');assert.ok(rosterFixture.nodes.get('roster-rows').innerHTML.includes('8/21 양승주 휴무'));
rosterFixture.nodes.get('roster-month').value='2026-09';await rosterFixture.nodes.get('roster-month').onchange.call(rosterFixture.nodes.get('roster-month'));assert.equal(rosterFixture.calls.at(-1).action,'work_roster');assert.equal(rosterFixture.calls.at(-1).p.rosterMonth,'2026-09');assert.equal(rosterFixture.nodes.get('roster-month').value,'2026-09');assert.ok(!rosterFixture.nodes.get('roster-rows').innerHTML.includes('양승주'));
const html=fs.readFileSync(new URL('../hospital-work.html',import.meta.url),'utf8');assert.ok(html.indexOf('id="sync"')<html.indexOf('id="roster-open"'));assert.ok(html.indexOf('id="roster-open"')<html.indexOf('메인으로'));
console.log('work-roster UI: cached startup, header date ordering, adjacent button, duplicate guard, explicit edit/delete, snapshot persistence, month switch and durable unknown-save retry passed.');

// A candidate read may have linked another device on the server. The next save
// must build its local detail from that response, retaining the linked history.
const linkRequest={...makeRequest('linked'),status:'결과확인'};
const fieldSource={recordId:'source-new',version:'v1',date:'2026-10-07',engineer:'사용자 A',sn:'SN2',gubun:'점검',detail:'점검 완료',result:'정상'};
const autoHistory={id:'auto-history',kind:'result',requestId:linkRequest.id,source:{...fieldSource,recordId:'source-auto',sn:'SN1'},memo:'',revision:1,createdAt:'2026-10-07T01:00:00Z'};
const linkedDetail={success:true,request:{...linkRequest,revision:5},history:[autoHistory],logs:[],requests:[],updatedAt:'2026-10-07T01:00:00Z'};
const manualHistory={...autoHistory,id:'manual-history',source:fieldSource};
const resultUi=fixture(withRows([linkRequest]),{
 detail:{success:true,request:linkRequest,history:[],logs:[],requests:[]},
 get:async action=>action==='work_handover_candidates'?{success:true,data:[fieldSource],workDetail:linkedDetail}:action==='work_handover_detail'?{success:true,source:fieldSource,workDetail:linkedDetail}:{success:true,...linkedDetail},
 post:async()=>({success:true,request:{...linkRequest,revision:6},history:manualHistory})
});
await flush();resultUi.nodes.get('list').onclick({target:{closest:()=>({dataset:{open:linkRequest.id}})}});await flush();
resultUi.nodes.get('detail').onclick({target:{closest:()=>({dataset:{action:'import'}})}});await flush();
assert.equal(resultUi.detailWrites.at(-1).request.revision,5);
resultUi.nodes.get('source-list').onclick({target:{closest:()=>({dataset:{source:'0'}})}});await flush();
resultUi.nodes.get('result-form').onsubmit({preventDefault(){}});await flush();
assert.equal(resultUi.posts.at(-1).p.baseRevision,5);
assert.deepEqual(Array.from(resultUi.detailWrites.at(-1).history,h=>h.id).sort(),['auto-history','manual-history']);
assert.equal(resultUi.detailWrites.at(-1).preview,false,'latest source response keeps a complete current local history after save');
console.log('Handover read-triggered linking: latest detail persists before the next write and retains all device histories.');

// Delta pages are staged until the whole bounded snapshot succeeds.
{
 const row=makeRequest('page'),initial=withRows([row]);let failing=true;
 const f=fixture(initial,{get:async(action,p)=>{
  assert.equal(action,'work_sync','GAS outage cannot become a list dependency');
  if(p.revision==='6')return {success:true,storage:'kv',requests:[{...row,revision:5}],revision:'7',snapshotSeq:'8',more:true};
  assert.equal(p.snapshotSeq,'8');if(failing)throw new Error('중간 페이지 통신 실패');
  return {success:true,storage:'kv',requests:[],revision:'8',snapshotSeq:'8',more:false};
 }});await flush();await f.nodes.get('sync').onclick();
 assert.equal(f.writes.length,0,'partial snapshot never commits records or revision');
 assert.equal(f.nodes.get('sync-state').dataset.state,'error');
 failing=false;await f.nodes.get('sync').onclick();
 assert.equal(f.calls[2].p.revision,'6','retry resumes from the last fully saved revision');
 assert.equal(f.writes.at(-1).value.revision,'8');assert.equal(f.writes.at(-1).value.requests[0].revision,5);
}
for(const mode of ['invalid','auth','network','stalled']){
 const f=fixture(saved,{get:async(action,p)=>{
  if(action==='work_bootstrap')return {success:true,storage:'kv',requests:[],revision:'3',hospitals:[],engineers:[]};
  if(mode==='invalid')return {success:false,code:'REVISION_INVALID',error:'잘못된 기준'};
  if(mode==='auth')return {success:false,code:'AUTH_REQUIRED',error:'로그인 필요'};
  if(mode==='network')throw new Error('오프라인');
  return {success:true,storage:'kv',requests:[],revision:p.revision,snapshotSeq:'9',more:true};
 }});await flush();await f.nodes.get('sync').onclick();
 assert.equal(f.calls.filter(c=>c.action==='work_bootstrap').length,mode==='invalid'?1:0);
 assert.equal(f.writes.length,mode==='invalid'?1:0,'only structured invalid revisions trigger a full reload');
 assert.equal(f.calls.filter(c=>c.action==='work_sync').length,1,'stalled cursor cannot loop');
}
{
 let resolve,account='사용자 A';const f=fixture(saved,{account:()=>account,get:()=>new Promise(r=>resolve=r)});await flush();
 const sync=f.nodes.get('sync').onclick();await flush();account='사용자 B';resolve({success:true,storage:'kv',requests:[],revision:'7'});await sync;
 assert.equal(f.writes.length,0,'previous-account response cannot update cache');
}
{
 let now=Date.parse('2026-10-16T01:00:00Z');
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const f=fixture(saved,{Date:Clock});await flush();assert.equal(f.intervals.size,1);assert.equal([...f.intervals.values()][0].ms,60000);
 const before=f.rosterCalls.length;f.tick();await flush();assert.equal(f.rosterCalls.length,before,'same-day timer does not poll work or roster');
 now+=86400000;f.visibility(true);f.tick();await flush();assert.equal(f.rosterCalls.length,before,'hidden document defers day rollover');
 f.visibility(false);await flush();assert.equal(f.rosterCalls.length,before+1,'visibility resumes the deferred roster refresh');
 assert.equal(f.calls.length,0,'roster timer never synchronizes work records');
 f.dispose();assert.equal(f.intervals.size,0);f.tick();assert.equal(f.rosterCalls.length,before+1);
}
console.log('sync isolation: staged pages, fixed snapshot range, failed-page retry, one invalid-revision reload, auth/network preservation, stalled cursors, account changes and modeled roster timer/visibility/cleanup passed.');

function countMarkupWrites(node){let value=node.innerHTML,writes=0;Object.defineProperty(node,'innerHTML',{get:()=>value,set:next=>{value=next;writes++;}});return ()=>writes;}
function rowNode(id){const classes=new Map();return {dataset:{inlineForm:id},classes,querySelector:()=>null,classList:{toggle:(name,value)=>classes.set(name,value)}};}
{
 const r=makeRequest('responsive-detail');let changed=false;
 const f=fixture(withRows([r]),{get:async()=>({success:true,request:changed?{...r,status:'완료',revision:r.revision+1}:r,history:[],logs:[],requests:[],updatedAt:r.updatedAt})});await flush();
 const desktop=rowNode(r.id),mobile=rowNode(r.id),list=f.nodes.get('list');
 list.querySelectorAll=selector=>selector==='tr[data-inline-form],.mobile-card'?[desktop,mobile]:[];
 const writes=countMarkupWrites(list),filterWrites=countMarkupWrites(f.nodes.get('advanced-groups'));
 const open={dataset:{open:r.id}};list.onclick({target:{closest:()=>open}});await flush();
 assert.equal(writes(),0,'unchanged preview and full detail never rebuild the list');assert.equal(filterWrites(),0);
 assert.equal(desktop.classes.get('selected'),true);assert.equal(mobile.classes.get('selected'),true);
 const close={dataset:{action:'close-detail'}};f.nodes.get('detail').onclick({target:{closest:()=>close}});
 assert.equal(writes(),0,'closing detail updates selection only');assert.equal(desktop.classes.get('selected'),false);
 list.onclick({target:{closest:()=>open}});await flush();
 f.nodes.get('edit-mode').onclick();assert.equal(writes(),1,'editing with a detail open renders the list only once');
 changed=true;const refresh={dataset:{action:'refresh-detail'}};f.nodes.get('detail').onclick({target:{closest:()=>refresh}});await flush();
 assert.equal(writes(),2,'a changed server request still updates list membership, values and counts');assert.equal(f.nodes.get('count-active').textContent,0);
}
{
 const a=makeRequest('selected-a'),b=makeRequest('selected-b','다른 사용자');
 const f=fixture(withRows([a,b]));await flush();
 const desktop=rowNode(a.id),mobile=rowNode(a.id),foreign=rowNode(b.id);
 const checkbox=(id,row)=>({dataset:{selectRequest:id},checked:false,disabled:false,closest:selector=>selector==='[data-select-request]'?inputs.find(x=>x.dataset.selectRequest===id):selector==='tr,.mobile-card'||selector==='[data-inline-form]'?row:null});
 const inputs=[checkbox(a.id,desktop),checkbox(a.id,mobile),checkbox(b.id,foreign)];
 const originalQuery=f.document.querySelectorAll;f.document.querySelectorAll=selector=>selector==='[data-select-request]'?inputs:originalQuery(selector);
 f.nodes.get('selection-mode').onclick();const writes=countMarkupWrites(f.nodes.get('list'));
 f.nodes.get('list').oninput({target:inputs[0]});assert.equal(f.timeouts.size,0);assert.equal(f.localWrites.length,0,'checkbox input never creates edit drafts');
 f.nodes.get('list').oninput({target:{dataset:{statusRequest:a.id},closest:()=>desktop}});assert.equal(f.timeouts.size,0);assert.equal(f.localWrites.length,0,'status picker input never creates edit drafts');
 inputs[0].checked=true;f.nodes.get('list').onchange({target:inputs[0]});
 assert.equal(writes(),0);assert.equal(inputs[1].checked,true);assert.equal(desktop.classes.get('checked-row'),true);assert.equal(mobile.classes.get('checked-row'),true);assert.equal(inputs[2].disabled,true);
 f.nodes.get('clear-selection').onclick();assert.equal(writes(),0);assert.equal(inputs[0].checked,false);assert.equal(mobile.classes.get('checked-row'),false);
 f.nodes.get('select-page').checked=true;f.nodes.get('select-page').onchange();assert.equal(writes(),0);assert.equal(f.nodes.get('selection-count').textContent,'선택 1건');
}
{
 let scans=0;const h={id:'draft-h',key:'draft-key',get name(){scans++;return '초안 병원';},region:'서울',sn:'SN1',sales:'영업 A'};
 const h2={id:'draft-h2',key:'draft-key2',name:'다른 병원',region:'부산',sn:'SN2',sales:'영업 B'};
 const r={...makeRequest('draft-responsive'),hospitalId:h.id,hospitalKey:h.key,hospitalName:'초안 병원',region:h.region,registeredAt:'2026-10-19T09:00',serviceOverrides:{asType:'유상',ncare:'가입'}};
 const f=fixture({...withRows([r]),hospitals:[h,h2]},{post:async()=>({success:false,error:'검증용 저장 거절'})});await flush();
 const value={dataset:{inlineField:'symptom'},type:'text',value:'첫 입력'};
 const form={dataset:{inlineForm:r.id},querySelectorAll:()=>[value],querySelector:()=>null,classList:{add(){}}};value.closest=()=>form;
 const key='baz_work_v1_'+encodeURIComponent('사용자 A')+'_inline_edits',draftWrites=()=>f.localWrites.filter(x=>x.key===key);
 // Warm the initial draft once; following symptom keystrokes must do no hospital lookup.
 f.nodes.get('list').oninput({target:value});scans=0;
 value.value='마지막 입력';f.nodes.get('list').oninput({target:value});
 assert.equal(scans,0,'ordinary keystrokes never scan hospital labels');assert.equal(draftWrites().length,0);assert.equal(f.timeouts.size,1);
 f.runTimers();assert.equal(draftWrites().length,1);
 let saved=JSON.parse(f.local.get(key))[r.id];assert.equal(saved.form.symptom,'마지막 입력');assert.equal(saved.form.hospitalKey,h.key);assert.equal(saved.form.asType,'유상');
 value.value='포커스 이동 직전';f.nodes.get('list').oninput({target:value});f.nodeEvents.get('list:focusout')();assert.equal(f.timeouts.size,0);assert.equal(JSON.parse(f.local.get(key))[r.id].form.symptom,'포커스 이동 직전');
 value.value='페이지 닫기 직전';f.nodes.get('list').oninput({target:value});f.listeners.get('window:pagehide')();
 assert.equal(f.timeouts.size,0);assert.equal(JSON.parse(f.local.get(key))[r.id].form.symptom,'페이지 닫기 직전');
 value.value='숨기기 직전';f.nodes.get('list').oninput({target:value});f.visibility(true);assert.equal(JSON.parse(f.local.get(key))[r.id].form.symptom,'숨기기 직전');f.visibility(false);
 value.value='저장 버튼 직전';f.nodes.get('list').oninput({target:value});await f.nodes.get('list').onsubmit({target:{closest:()=>form},preventDefault(){}});assert.equal(f.timeouts.size,0);assert.equal(JSON.parse(f.local.get(key))[r.id].form.symptom,'저장 버튼 직전','even a rejected save preserves the final input');
 value.dataset.inlineField='hospitalInput';value.value='다른 병원';f.nodes.get('list').oninput({target:value});f.runTimers();saved=JSON.parse(f.local.get(key))[r.id];
 assert.equal(saved.form.hospitalKey,h2.key);assert.equal(saved.form.sales,'영업 B');assert.equal(saved.form.asType,'');assert.equal(saved.form.ncare,'');
 value.dataset.inlineField='symptom';value.value='되돌릴 입력';f.nodes.get('list').oninput({target:value});
 const reset={dataset:{inlineReset:r.id}};f.nodes.get('list').onclick({target:{closest:()=>reset}});f.runTimers();assert.equal(JSON.parse(f.local.get(key))[r.id],undefined,'reset cancels pending persistence and never resurrects the draft');
}
console.log('Responsive interactions: unchanged detail/close and checkbox changes preserve list DOM; server changes refresh counts; edit render is single; drafts coalesce and flush on lifecycle boundaries without hospital rescans or reset resurrection; non-edit controls never create drafts.');
