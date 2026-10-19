const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../js/baz-notifications.js'),'utf8');
function fixture(ready=true){
 let now=Date.parse('2026-10-19T14:50:00Z'),timerId=0,dialog;
 const timers=new Map(),nodes=new Map(),requests=[];
 let items=[{id:'unread_123',requestId:'request_123',hospitalName:'안 읽은 병원',kind:'status',status:'접수',createdAt:new Date(now).toISOString(),readAt:''},{id:'read_1234',requestId:'request_123',hospitalName:'읽은 병원',kind:'status',status:'접수',createdAt:new Date(now).toISOString(),readAt:new Date(now).toISOString()}];
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{textContent:'',innerHTML:'',hidden:false,disabled:false,checked:false,dataset:{}});return nodes.get(selector);};
 const doc={readyState:'loading',hidden:false,addEventListener(){},querySelectorAll:()=>[],body:{appendChild(){}},createElement:tag=>{
  if(tag!=='dialog')return {className:'',append(){}};
  dialog={open:false,handlers:{},innerHTML:'',setAttribute(){},prepend(){},querySelector:node,querySelectorAll:()=>[],addEventListener(type,fn){this.handlers[type]=fn;},showModal(){this.open=true;},close(){this.open=false;this.handlers.close?.();}};return dialog;
 }};
 const root={BazAuth:{token:()=> 'test-token'},BazNotificationRoute:{url:()=> 'hospital-work.html',valid:()=>false},location:{pathname:'/hospital-work.html'},addEventListener(){}};
 const expiry=readAt=>(Math.floor((Date.parse(readAt)+9*3600000)/86400000)+1)*86400000-9*3600000;
 const fetch=async(url,options)=>{
  const p=JSON.parse(options.body);requests.push(p);
  if(p.action==='notification_list'){items=items.filter(n=>!n.readAt||expiry(n.readAt)>now);return {json:async()=>({success:true,items:structuredClone(items),unread:items.filter(n=>!n.readAt).length,cursor:'',readThrough:new Date(now).toISOString(),readRetention:ready?'next-day-kst':undefined})};}
  if(p.action==='notification_delete'){const deletedIds=items.filter(n=>n.readAt&&p.ids.includes(n.id)).map(n=>n.id);items=items.filter(n=>!deletedIds.includes(n.id));return {json:async()=>({success:true,deletedIds,failedIds:[],skippedIds:[]})};}
  if(p.action==='notification_mark_read'){const readIds=items.filter(n=>!n.readAt&&p.ids.includes(n.id)).map(n=>n.id);for(const n of items)if(readIds.includes(n.id))n.readAt=new Date(now).toISOString();return {json:async()=>({success:true,readIds,changed:readIds.length,failedIds:[]})};}
  throw new Error('Unexpected request '+p.action);
 };
 vm.runInNewContext(source,{window:root,document:doc,Date:Clock,navigator:{},fetch,AbortController,URLSearchParams,Map,Set,Promise,console,setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId;},clearTimeout:id=>timers.delete(id)});
 const selectAll=()=>{const c={checked:true,matches:selector=>selector==='[data-inbox-select-page]'};dialog.handlers.change({target:c});};
 return {api:root.BazNotifications,node,requests,timers,selectAll,dialog:()=>dialog,advance:async()=>{now=Date.parse('2026-10-19T15:00:01Z');const t=[...timers.entries()].find(([,t])=>t.delay>60000);timers.delete(t[0]);await t[1].fn();for(let i=0;i<20;i++)await Promise.resolve();}};
}
(async()=>{
 {
  const f=fixture();await f.api.showInbox();assert.match(f.node('[data-inbox-status]').textContent,/다음날 0시/);assert.equal(f.node('[data-inbox-delete]').disabled,true);
  f.selectAll();assert.equal(f.node('[data-inbox-delete]').disabled,false);assert.equal(f.node('[data-inbox-selected]').disabled,false);
  await f.node('[data-inbox-delete]').onclick();assert.deepEqual(f.requests.find(p=>p.action==='notification_delete').ids,['read_1234']);assert.match(f.node('[data-inbox-list]').innerHTML,/안 읽은 병원/);assert.ok(!f.node('[data-inbox-list]').innerHTML.includes('<strong>읽은 병원</strong>'));assert.match(f.node('[data-inbox-status]').textContent,/1건/);
  f.dialog().close();assert.equal(f.timers.size,0);
 }
 {
  const f=fixture();await f.api.showInbox();f.selectAll();await f.node('[data-inbox-selected]').onclick();assert.deepEqual(f.requests.find(p=>p.action==='notification_mark_read').ids,['unread_123']);assert.equal(f.node('[data-inbox-selected]').disabled,true);assert.match(f.node('[data-inbox-list]').innerHTML,/다음날 자동 삭제/);
 }
 {
  const f=fixture();await f.api.showInbox();await f.advance();assert.match(f.node('[data-inbox-list]').innerHTML,/안 읽은 병원/);assert.ok(!f.node('[data-inbox-list]').innerHTML.includes('<strong>읽은 병원</strong>'));assert.equal(f.requests.filter(p=>p.action==='notification_list').length,2,'open inbox refreshes automatically at KST midnight');
 }
 {
  const f=fixture(false);await f.api.showInbox();f.selectAll();assert.equal(f.node('[data-inbox-delete]').disabled,true);await f.node('[data-inbox-delete]').onclick();assert.equal(f.requests.some(p=>p.action==='notification_delete'),false,'unsupported backend never receives destructive calls');
 }
 console.log('Inbox UI: read/unread selection boundaries, safe read-only deletion, read controls, empty state, midnight refresh, close cleanup and backend capability gating passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
