import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../js/baz-work-manager.js',import.meta.url),'utf8');
function fixture(saved){
 const nodes=new Map(),calls=[],writes=[];
 function node(id){if(!nodes.has(id))nodes.set(id,{id,value:id==='sort'?'visitAt':'',hidden:false,disabled:false,dataset:{},classList:{toggle(){}},setAttribute(){},querySelectorAll:()=>[],add(){},addEventListener(){},focus(){},scrollIntoView(){}});return nodes.get(id);}
 const cache={snapshot:async()=>saved,pending:async()=>null,save:async(account,value)=>writes.push({account,value})};
 const api={get:async(action,p)=>{calls.push({action,p});return {success:true,storage:'kv',requests:[],hospitals:[],engineers:[],revision:'7',updatedAt:'2026-10-06T01:00:00Z'};}};
 vm.runInNewContext(source,{window:{BazWorkCache:cache,BazWorkAPI:api,BazAuth:{name:()=> '사용자 A'}},document:{getElementById:node,querySelectorAll:()=>[],documentElement:{dataset:{}}},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},matchMedia:()=>({matches:false}),Option:function(){},Map,Set,Date,Intl,JSON,Array,Number,Promise,console});
 return {nodes,calls,writes};
}
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const saved={storage:'kv',requests:[],hospitals:[],engineers:[],revision:'6',updatedAt:'2026-10-06T00:00:00Z'};
const cached=fixture(saved);await flush();assert.equal(cached.calls.length,0,'opening cached PC does not query server');assert.equal(cached.nodes.get('sync-state').textContent,'이 PC의 보관 데이터');
cached.nodes.get('sync').onclick();await flush();assert.equal(cached.calls[0].action,'work_sync');assert.equal(cached.calls[0].p.revision,'6');assert.equal(cached.writes[0].value.revision,'7');
const first=fixture(null);await flush();assert.equal(first.calls.length,1);assert.equal(first.calls[0].action,'work_bootstrap','first PC loads one initial snapshot');assert.equal(first.writes[0].account,'사용자 A');
console.log('work-ui-cache: cached startup sends no request; user sync fetches deltas; first PC bootstraps and persists account snapshot.');
