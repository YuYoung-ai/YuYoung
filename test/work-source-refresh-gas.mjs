import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx={Date,JSON};vm.createContext(ctx);
for(const file of ['handover_gas.gs','hospital_work_gas.gs','hospital_work_kv_gas.gs'])vm.runInContext(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),ctx);
const headers=['처리일','병원명','점검/AS','기록 ID'],rows=[
 ['2026-10-15','정정된 병원','A/S','linked-complete'],
 ['2026-10-14','진행 병원','점검','new-active'],
 ['2026-10-14','삭제 병원','A/S','deleted'],
 ['2026-10-14','무관 병원','A/S','unlinked-complete']
];
const reads=[],sh={getLastRow:()=>rows.length+2,getLastColumn:()=>4,getRange:(r,c,n,w)=>({getDisplayValues:()=>{reads.push({r,c,n,w});return rows.slice(r-3,r-3+n).map(row=>row.slice(c-1,c-1+w));}})};
ctx.hwSS_=()=>({getSheetByName:()=>sh});ctx.findHeader_=()=>({row:2,headers});ctx.colBy_=(h,names)=>{const i=h.headers.findIndex(x=>names.includes(x));return i<0?0:i+1;};
ctx.hwSource_=raw=>({date:raw['처리일'],hospitalName:raw['병원명'],gubun:raw['점검/AS'],recordId:raw['기록 ID'],version:'v1'});ctx.hwKvStableSource_=hit=>{hit.source.observedAt='now';};
const reqs=[{id:'complete',status:'완료',hospitalName:'이전 병원명',visitAt:'2026-10-14T12:00'},{id:'active',status:'방문예정',hospitalName:'진행 병원',visitAt:'2026-10-14T12:00'},{id:'trash',deletedAt:'now',status:'완료',hospitalName:'삭제 병원',visitAt:'2026-10-14T12:00'}];
const history=[{requestId:'complete',kind:'result',source:{recordId:'linked-complete'}},{requestId:'trash',kind:'result',source:{recordId:'deleted'}},{requestId:'complete',kind:'result',source:{recordId:'flow-old',origin:'flow'}}];
ctx.hwRows_=name=>name===ctx.HW.REQUESTS?reqs.map(r=>[r.id,JSON.stringify(r)]):history.map((h,i)=>['h'+i,h.requestId,JSON.stringify(h)]);
const result=ctx.hwKvRefreshSources_();assert.deepEqual(Array.from(result,s=>s.recordId),['linked-complete','new-active']);assert.equal(result[0].hospitalName,'정정된 병원');assert.equal(result[0].date,'2026-10-15');
assert.deepEqual(Array.from(ctx.hwKvRefreshSources_({hospitalName:'이전 병원명',visitDate:'2026-10-14',recordIds:['linked-complete']}),s=>s.recordId),['linked-complete'],'notification scope follows stable source IDs without pulling other visits');
assert.deepEqual(Array.from(ctx.hwKvRefreshSources_({hospitalName:'진행 병원',visitDate:'2026-10-14',recordIds:[]}),s=>s.recordId),['new-active'],'new receipt candidates do not require the lagging Sheet mirror');
assert.equal(ctx.hwKvRefreshSources_({hospitalName:'진행 병원',visitDate:'',recordIds:[]}).length,0);
assert.throws(()=>ctx.hwKvRefreshSources_({hospitalName:'진행 병원',visitDate:'2026-10-14',recordIds:['missing']}),/찾지 못/,'missing linked source is never represented as freshly checked');
assert.ok(reads.every(x=>x.w<4||x.n<=2),'full source rows are restricted to the selected matches');
rows.push([...rows[0]]);assert.throws(()=>ctx.hwKvRefreshSources_(),/중복/);rows.pop();rows[0][2]='잘못된 구분';assert.throws(()=>ctx.hwKvRefreshSources_(),/처리일·구분/);rows[0][2]='A/S';
// Previously sent content reverted to an older version must be queued again.
const events=[['a','record','v1','{}','sent','2026-10-14T01:00:00Z'],['b','record','v2','{}','sent','2026-10-14T02:00:00Z']];
const queue={getLastRow:()=>events.length+1,getRange:()=>({getValues:()=>events})};
assert.equal(ctx.hwKvQueueReverted_(queue,{recordId:'record',version:'v1'}),true);assert.equal(ctx.hwKvQueueReverted_(queue,{recordId:'record',version:'v2'}),false);
events[0][5]='2026-10-14T03:00:00Z';assert.equal(ctx.hwKvQueueReverted_(queue,{recordId:'record',version:'v1'}),false);
console.log('work-source-refresh-gas: completed stable-ID lookup across hospital/date edits, active candidates, trash/Flow exclusion, bounded row reads, duplicate/invalid source refusal and previously-sent content reversion passed.');
