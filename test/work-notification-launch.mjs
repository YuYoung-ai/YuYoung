import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import route from '../js/baz-notification-route.js';
const source=fs.readFileSync(new URL('../js/baz-work-manager.js',import.meta.url),'utf8');
const actual=source.slice(source.indexOf('  function notificationBusy('),source.indexOf('  async function selectHospital('));
function fixture(options={}){
 const nodes=new Map(),calls=[],target={requestId:'request_123',notificationId:'notice_123'};
 const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,value:'',dataset:{state:'done'},textContent:'',scrollIntoView(){}});return nodes.get(id);};
 node('comment-body').value=options.comment||'';
 const context={window:{BazNotificationRoute:route,BazNotifications:{call:async(a,p)=>{calls.push({a,p});if(options.readFailure)throw new Error('리비전 변경');},refresh(){}}},document:{querySelectorAll:()=>options.dialog?[{}]:[]},$:node,state:{loaded:true,detail:null},busy:false,syncing:false,bulkWorking:false,pending:null,rosterLoading:false,notificationOpening:false,notificationTarget:null,detailError:'',Array,matchMedia:()=>({matches:false}),time:x=>x};
 context.api={get:async(a,p)=>{calls.push({a,p});if(options.sourceFailure)return {success:false,error:'원본 조회 실패'};if(options.midDraft)node('comment-body').value='확인 중 새 댓글';return {success:true,sourceCheckedAt:'2026-10-14T00:00:00Z'};}};
 context.sync=async()=>{calls.push({a:'sync'});if(options.syncFailure)node('sync-state').dataset.state='error';};
 context.openDetail=async(id,force)=>{calls.push({a:'detail',id,force});context.state.detail={request:{id,hospitalName:'검증 병원',revision:2},history:[]};};
 vm.createContext(context);vm.runInContext(actual,context);
 return {context,nodes,calls,target,open:()=>context.queueNotification(target)};
}
const good=fixture();await good.open();assert.deepEqual(good.calls.map(x=>x.a),['work_handover_refresh','sync','detail','notification_read']);assert.equal(good.calls[0].p.requestId,'request_123');assert.equal(good.calls[2].force,true);assert.equal(good.calls[3].p.revision,2);assert.equal(good.context.notificationTarget,null);
for(const options of [{dialog:true},{comment:'작성 중 댓글'}]){const f=fixture(options);await f.open();assert.equal(f.calls.length,0);assert.equal(f.context.notificationTarget.requestId,f.target.requestId);assert.match(f.nodes.get('notification-launch-message').textContent,/유지/);}
for(const options of [{sourceFailure:true},{syncFailure:true},{midDraft:true}]){const f=fixture(options);await f.open();assert.ok(!f.calls.some(x=>x.a==='notification_read'));assert.ok(!f.calls.some(x=>x.a==='detail'));assert.ok(f.context.notificationTarget);assert.match(f.nodes.get('notification-launch-message').textContent,/실패/);}
const race=fixture({readFailure:true});await race.open();assert.ok(race.context.notificationTarget,'revision race keeps the retry target');assert.match(race.nodes.get('notification-launch-message').textContent,/리비전 변경/);
console.log('work-notification-launch: target-only Handover refresh, forced latest detail/read order, draft preservation, offline/source/sync failures and revision-race retry passed.');
