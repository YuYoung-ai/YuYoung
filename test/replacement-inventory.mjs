import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const root=new URL('../',import.meta.url), read=p=>fs.readFileSync(new URL(p,root),'utf8');
class Range{
 constructor(sh,r,c,n=1,w=1){Object.assign(this,{sh,r,c,n,w});}
 getValues(){return Array.from({length:this.n},(_,i)=>Array.from({length:this.w},(_,j)=>this.sh.data[this.r+i-1]?.[this.c+j-1]??''));}
 getDisplayValues(){return this.getValues().map(r=>r.map(v=>v==null?'':String(v)));}
 getValue(){return this.getValues()[0][0];}
 getFormulas(){return this.getValues().map(r=>r.map(v=>typeof v==='string'&&v.startsWith('=')?v:''));}
 getRow(){return this.r;}
 setValue(v){return this.setValues([[v]]);}
 setValues(vals){
  if(this.sh.failBefore){this.sh.failBefore=false;throw new Error('before write');}
  vals.forEach((r,i)=>{this.sh.data[this.r+i-1]??=[];r.forEach((v,j)=>this.sh.data[this.r+i-1][this.c+j-1]=v);});
  if(this.sh.failAfter){this.sh.failAfter=false;throw new Error('response lost after write');}
  return this;
 }
 createTextFinder(s){let exact=false;return {matchEntireCell(v){exact=v;return this;},findNext:()=>{const vals=this.getDisplayValues();for(let i=0;i<vals.length;i++)if(vals[i].some(v=>exact?v===s:v.includes(s)))return new Range(this.sh,this.r+i,this.c);return null;}};}
}
class Sheet{
 constructor(name){this.name=name;this.data=[];this.maxCols=26;this.maxRows=1000;}
 getRange(...args){return new Range(this,...args);}
 getName(){return this.name;}
 getLastRow(){return this.data.length;}
 getLastColumn(){return Math.max(0,...Array.from(this.data,r=>r?r.length:0));}
 getMaxColumns(){return this.maxCols;}
 getMaxRows(){return this.maxRows;}
 insertColumnsAfter(_,n){this.maxCols+=n;}
 insertRowAfter(){this.maxRows++;}
 setFrozenRows(){}
}
function book(){const sheets=new Map();return {sheets,getSheetByName:n=>sheets.get(n)||null,getSheets:()=>[...sheets.values()],insertSheet:n=>{assert(!sheets.has(n),'never duplicate a tab');const s=new Sheet(n);sheets.set(n,s);return s;}};}
const source=book(),inventory=book(),triggers=[];let locked=false, offline=false;
const ctx=vm.createContext({console,Date,JSON,Math,SpreadsheetApp:{getActiveSpreadsheet:()=>source,openById:()=>{if(offline)throw new Error('permission denied');return inventory;}},
 Utilities:{formatDate:()=> '2026-10-16'},
 LockService:{getScriptLock:()=>({tryLock(){if(locked)return false;locked=true;return true;},waitLock(){assert(!locked);locked=true;},releaseLock(){locked=false;}})},
 ScriptApp:{getProjectTriggers:()=>triggers.map(n=>({getHandlerFunction:()=>n})),newTrigger:n=>({timeBased(){return this;},everyMinutes(v){assert.equal(v,5);return this;},create(){triggers.push(n);}})}});
vm.runInContext(read('handover_gas.gs'),ctx);vm.runInContext(read('handover_inventory_gas.gs'),ctx);
const copy=o=>JSON.parse(JSON.stringify(o)), cfg=p=>copy(ctx.invPartConfig_(p));
const base={reqId:'one',date:'2026-10-16',hosp:'테스트 병원',fse:'담당자',part:'Power Cable',hpIn:'',cost:'무상'};
function stock(part,over={}){
 const c=cfg(part), target=ctx.invEnsurePartSheet_(inventory,c),s=target.sheet,m=target.map;
 const vals=Array(24).fill(''),h=target.headers;
 const entries={'품명':c.names[c.names.length-1],'불출처':'SCM','입고일':'2026-10-01','입고처':'CS','입고수량':1,'출고일':'2026-10-02','출고처':'담당자','출고수량':1,...over};
 Object.entries(entries).forEach(([k,v])=>vals[h.indexOf(k)]=v);
 const row=Math.max(s.getLastRow()+1,m.row+1);s.getRange(row,1,1,24).setValues([vals]);return {s,row,c,h};
}
function save(p){return copy(ctx.invRecordUsage_({...base,...p}));}
function queue(id){const s=source.getSheetByName(ctx.INV_REPLACEMENT.QUEUE);if(!s)return null;return s.data.find(r=>r[0]===id);}
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
test('all stock options map to product tabs, non-stock options are excluded',()=>{
 const htmlParts=JSON.parse(read('handover.html').match(/var PARTS=(\[[^;]+\]);/)[1]);
 for(const p of htmlParts){assert(ctx.invExcluded_(p)||ctx.invPartConfig_(p));}
 for(const p of ['없음','재체결','내부 세척','대체장비입고']){assert(save({part:p,hpIn:'ANY'}).excluded);assert.equal(cfg(p),null);}
 assert.equal(cfg('Foot-SW Connector(장비)').sheet,'CS 재고 수량(Foot Switch Connector(F))');
 assert.notEqual(cfg("Foot-SW Ass'y (Repair)").sheet,cfg("Foot-SW Ass'y").sheet);
});
test('exact product routing and idempotent use; formulas and ERP preserved',()=>{
 const cable=stock('Power Cable',{'ERP회수처리':true}),foot=stock("Foot-SW Ass'y");
 cable.s.data[cable.row-1][16]='=1+1';
 const r=save({reqId:'cable'});assert(r.done);assert.equal(r.row,cable.row);assert.equal(cable.s.data[cable.row-1][13],1);
 assert.equal(cable.s.data[cable.row-1][15],true);assert.equal(cable.s.data[cable.row-1][16],'=1+1');
 assert.equal(foot.s.data[foot.row-1][10],'');assert(save({reqId:'cable'}).done);assert.equal(queue('cable')[8],'완료');
});
test('missing required upstream fields stay pending with no usage',()=>{
 for(const field of ['불출처','입고처','입고일','입고수량','출고일','출고수량']){
  const p='part '+field,id='missing_'+count+'_'+['불출처','입고처','입고일','입고수량','출고일','출고수량'].indexOf(field),s=stock(p,{[field]:''}),r=save({part:p,reqId:id});
  assert(r.pending,field);assert.equal(s.s.data[s.row-1][10],'');assert.equal(s.s.data[s.row-1][18],'');
  assert.equal(queue(id)[8],'대기');
 }
});
test('late completion retries once without saving Handover again',()=>{
 const s=stock('Main Board',{'불출처':''}),r=save({part:'Main Board',reqId:'late'});assert(r.pending);
 s.s.data[s.row-1][1]='SCM';const out=ctx.syncReplacementInventory();assert(out.done>=1);assert.equal(queue('late')[8],'완료');
 const before=JSON.stringify(s.s.data);ctx.syncReplacementInventory();assert.equal(JSON.stringify(s.s.data),before);
});
test('Foot cable, connector, Repair and cradle never consume regular foot stock',()=>{
 const foot=inventory.getSheetByName(cfg("Foot-SW Ass'y").sheet),before=JSON.stringify(foot.data);
 for(const part of ['Foot-SW cable','Foot-SW Connector(장비)',"Foot-SW Ass'y (Repair)",'Cradle (거치대)']){
  const s=stock(part),r=save({part,reqId:'route_'+count+'_'+part.replace(/[^A-Za-z]/g,'')});
  assert(r.done,part);assert.equal(s.s.data[s.row-1][18].startsWith('route_'),true);
 }assert.equal(JSON.stringify(foot.data),before);
});
test('missing outgoing owner and non-unit issues cannot be consumed',()=>{
 for(const [part,over] of [['No owner',{'출고처':''}],['Bulk',{'출고수량':5}]]){
  const s=stock(part,over);assert(save({part,reqId:part.replace(/ /g,'_')}).pending);assert.equal(s.s.data[s.row-1][10],'');
 }
});
test('existing partial use cells are never overwritten',()=>{
 const s=stock('Used partial',{'사용처':'기존 병원'});assert(save({part:'Used partial',reqId:'partial'}).pending);assert.equal(s.s.data[s.row-1][12],'기존 병원');
});
test('valid non-HP part ignores an accidentally supplied HP SN',()=>{
 const s=stock('Water Pump');assert(save({part:'Water Pump',hpIn:'HP1',reqId:'with_hp'}).done);assert.equal(s.s.data[s.row-1][18],'with_hp');
});
test('same request ID cannot change its body or consume another row',()=>{
 const s=stock('Power Cable');const r=save({reqId:'cable',hosp:'다른 병원'});assert(!r.done);assert.match(r.msg,/동일 기록 ID/);assert.equal(s.s.data[s.row-1][10],'');
});
test('write failure stays pending; a retry consumes the same row only once',()=>{
 const s=stock('Fail first');s.s.failBefore=true;assert(save({part:'Fail first',reqId:'fail_before'}).pending);assert.equal(s.s.data[s.row-1][10],'');
 ctx.syncReplacementInventory();assert.equal(queue('fail_before')[8],'완료');
});
test('uncertain applied range write is recovered through record ID',()=>{
 const s=stock('Fail after');s.s.failAfter=true;const r=save({part:'Fail after',reqId:'fail_after'});assert(r.done);assert.equal(queue('fail_after')[8],'완료');
});
test('target permission outage retains a durable source-book retry',()=>{
 const s=stock('Permission');offline=true;assert(save({part:'Permission',reqId:'permission'}).pending);
 assert.equal(queue('permission')[8],'대기');offline=false;ctx.syncReplacementInventory();assert.equal(queue('permission')[8],'완료');assert.equal(s.s.data[s.row-1][18],'permission');
});
test('a changed applied ledger requires review and never consumes another row',()=>{
 const c=inventory.getSheetByName(cfg('Power Cable').sheet),row=queue('cable')[10];c.data[row-1][12]='수동 변경';
 assert(save({reqId:'cable'}).review);assert.equal(queue('cable')[8],'확인필요');
});
test('setup is idempotent, excludes non-parts, preserves HP and installs one trigger',()=>{
 const hp=inventory.insertSheet('CS 재고 수량(Repair)');hp.data=[['preserve']];
 const out=ctx.setupReplacementInventory(),before=JSON.stringify(hp.data),size=inventory.sheets.size;
 assert(out.success);ctx.setupReplacementInventory();assert.equal(inventory.sheets.size,size);assert.equal(JSON.stringify(hp.data),before);assert.equal(triggers.length,1);
 for(const p of ['재체결','내부 세척','대체장비입고'])assert(!inventory.getSheetByName('CS 재고 수량('+p+')'));
});
test('ordinary HP cost/SN matching keeps the original implementation',()=>{
 const s=inventory.getSheetByName('CS 재고 수량(Repair)');s.data=[Array.from(ctx.INV_REPLACEMENT.HEADERS),Array(24).fill('')];
 s.data[1][0]='HP';s.data[1][9]='HP1';
 const r=save({part:"Handpiece Ass'y",hpIn:'hp1',hpOut:'old',reqId:'hp'});
 assert(r.done);assert.equal(s.data[1][14],'OLD');assert.equal(s.data[1][13],1);
});
test('pending warning survives saved result and savecheck classification',()=>{
 const H=createRequire(import.meta.url)('../js/baz-handover-core.js');
 const data={success:true,row:1,inv:{done:false,pending:true,msg:'입고처 누락'},warnings:[]};
 const r=H.classifySaveResult('json',data);assert.equal(r.state,H.SAVE.SUCCESS);assert(r.warnings.includes('입고처 누락'));
 assert(H.classifySaveCheck({success:true,found:true,result:data}).result.warnings.includes('입고처 누락'));
});
test('malformed queue JSON is isolated without replacing another request',()=>{
 const q=source.getSheetByName(ctx.INV_REPLACEMENT.QUEUE);save({part:'Broken JSON',reqId:'broken_json'});
 const r=queue('broken_json');r[13]='{broken';r[12]='2000-01-01T00:00:00.000Z';ctx.syncReplacementInventory();
 assert.equal(r[0],'broken_json');assert.equal(r[8],'확인필요');assert.equal(r[13],'{broken');
});
test('retry queue processes oldest checked requests instead of starving later rows',()=>{
 const q=source.getSheetByName(ctx.INV_REPLACEMENT.QUEUE),id='fair_last',s=stock('Fair last');
 for(let i=0;i<25;i++){const part='Unfilled '+i;save({part,reqId:'fair_'+i});queue('fair_'+i)[12]='2099-01-01T00:00:00.000Z';}
 save({part:'Fair last',reqId:id}); // already applied; reset the fixture to emulate a delayed prerequisite
 const entry=queue(id);entry[8]='대기';entry[12]='2000-01-01T00:00:00.000Z';
 ctx.syncReplacementInventory();assert.equal(entry[8],'완료');assert.equal(s.s.data[s.row-1][18],id);
});
const sheets=[...new Set(Array.from(ctx.INV_REPLACEMENT.PARTS).map(p=>cfg(p)).filter(c=>c&&c.kind==='part').map(c=>c.sheet))];
console.log(JSON.stringify({passed:count,nonSerialSheets:sheets.length,expectedExisting:5,newSheets:sheets.length-5}));

