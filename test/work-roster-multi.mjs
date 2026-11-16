import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../js/baz-work-manager.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../hospital-work.html',import.meta.url),'utf8');
const fieldSource=fs.readFileSync(new URL('../js/baz-work-fields.js',import.meta.url),'utf8');
function fixture(seed=[]){
  const elements=new Map(),storage=new Map(seed),months=new Map(),calls=[],replies=[];
  const element=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:false,disabled:false,checked:false,innerHTML:'',textContent:'',attributes:{},dataset:{},classList:{toggle(){},add(){}},addEventListener(){},querySelectorAll:()=>[],setAttribute(k,v){this.attributes[k]=v;},focus(){},showModal(){this.open=true;},close(){this.open=false;}});return elements.get(id);};
  for(const match of html.matchAll(/id="([^"]+)"/g))element(match[1]);
  class Clock extends Date{constructor(...args){super(...(args.length?args:['2026-11-16T02:00:00Z']));}static now(){return new Clock().getTime();}}
  const fields=vm.runInNewContext(fieldSource+';module.exports;',{module:{exports:{}}});
  let operation=0,failMonth='';
  const api={id:()=> 'fixture-operation-'+(++operation),get:async(action,p)=>{calls.push({action,...p});if(p.rosterMonth===failMonth)throw Error('month read failed');return {success:true,rosterMonth:p.rosterMonth,roster:structuredClone(months.get(p.rosterMonth)||[])};},post:async(action,p)=>{
    calls.push({action,...structuredClone(p)});const reply=replies.shift();if(reply instanceof Error)throw reply;if(reply)return reply;
    const month=p.date.slice(0,7),rows=months.get(month)||[],old=rows.find(r=>r.date===p.date&&r.person===p.person);
    if((old?.revision||0)!==p.baseRevision)return {success:false,conflict:true,error:'revision conflict',current:old};
    const schedule={id:p.date+'-'+p.person,date:p.date,person:p.person,type:p.type,revision:(old?.revision||0)+1,updatedAt:'2026-11-16T03:00:00Z',deletedAt:''};
    if(old)rows.splice(rows.indexOf(old),1,schedule);else rows.push(schedule);months.set(month,rows);return {success:true,schedule:structuredClone(schedule)};
  }};
  const context=vm.createContext({Date:Clock,Intl,URL,Map,Set,document:{getElementById:id=>{assert.ok(elements.has(id),'DOM id exists: '+id);return element(id);},querySelectorAll:()=>[]},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},window:{location:{search:''},BazAuth:{name:()=> '테스트 근무자',cachedLevel:()=>3},BazWorkFields:fields,BazWorkCache:{savePending:async()=>{}},BazWorkAPI:api}});
  const prefix=source.slice(0,source.indexOf("  $('account').textContent=account;"));
  const persistSnapshot=source.match(/^  async function persistSnapshot.*$/m)[0];
  vm.runInContext(prefix+persistSnapshot+`window.test={state,setRosterMode,toggleRosterDate,addRosterRange,saveRosterBatch,sendPending,renderRosterCalendar,resetRosterForm,captureRosterBatch,multiple:()=>rosterMultiple,dates:()=>Array.from(rosterDates).sort(),pending:()=>pending,locked:()=>bulkWorking,message:()=>rosterBatchMessage,valid:rosterDateValid};})();`,context);
  const t=context.window.test;t.state.loaded=true;t.state.rosterLoaded=true;t.state.rosterMonth='2026-11';t.resetRosterForm();if(!t.multiple())t.setRosterMode(true);if(!seed.length){element('roster-person').value='테스트 근무자';element('roster-type').value='휴무';}
  return {t,element,months,calls,replies,storage,failRead:month=>{failMonth=month;},select:(...dates)=>dates.forEach(t.toggleRosterDate),writes:()=>calls.filter(c=>c.action==='work_roster_save')};
}
const old=(date,type='당직',revision=4)=>({id:date+'-테스트 근무자',date,person:'테스트 근무자',type,revision,deletedAt:''});

// A new session restores arbitrary selected dates, person and duty type.
{
  const f=fixture();f.select('2026-11-20','2026-12-01');f.element('roster-person').value='복원 근무자';f.element('roster-type').value='당직';f.t.captureRosterBatch();
  const g=fixture([...f.storage]);assert.equal(g.t.dates().join(),'2026-11-20,2026-12-01');assert.equal(g.element('roster-person').value,'복원 근무자');assert.equal(g.element('roster-type').value,'당직');
  await g.t.saveRosterBatch();assert.equal(g.writes().length,2);assert.ok(g.writes().every(r=>r.type==='당직'));
}

// Sparse dates can span months. All snapshots must load before the first write.
{
  const f=fixture();f.select('2026-11-20','2026-11-23','2026-12-04');await f.t.saveRosterBatch();
  assert.equal(f.writes().length,3);assert.deepEqual(f.calls.slice(0,2).map(c=>c.action),['work_roster','work_roster']);
  assert.equal(f.t.dates().length,0);assert.match(f.t.message(),/3일 저장 완료/);
  assert.equal(f.element('roster-person').value,'테스트 근무자','batch writes retain the form identity');
  assert.equal(f.t.locked(),false);
}
// Saving today while browsing another month also refreshes today's notice.
{
  const f=fixture();f.t.state.rosterMonth='2026-12';f.select('2026-11-16');await f.t.saveRosterBatch();
  assert.equal(f.t.state.rosterMonth,'2026-12');assert.match(f.element('roster-today-people').textContent,/테스트 근무자/,'saving today from another month refreshes the off-duty notice');
}
// Same assignments are skipped; different existing schedules remain selected by default.
{
  const f=fixture();f.months.set('2026-11',[old('2026-11-20','휴무'),old('2026-11-21')]);f.select('2026-11-20','2026-11-21','2026-11-22');await f.t.saveRosterBatch();
  assert.equal(f.writes().length,1);assert.equal(f.t.dates().join(),'2026-11-21');
  assert.equal(f.months.get('2026-11')[1].type,'당직');assert.match(f.t.message(),/같은 일정 1일.*기존 일정 유지 1일/);
  f.element('roster-replace').checked=true;await f.t.saveRosterBatch();
  assert.equal(f.writes().at(-1).baseRevision,4);assert.equal(f.months.get('2026-11')[1].type,'휴무');assert.equal(f.t.dates().length,0);
}
// Restoring a deleted date/person keeps its revision; a failed month read makes no writes.
{
  const f=fixture();f.months.set('2026-11',[{...old('2026-11-20'),deletedAt:'2026-11-01'}]);f.select('2026-11-20');await f.t.saveRosterBatch();assert.equal(f.writes()[0].baseRevision,4);
  const g=fixture();g.select('2026-11-20','2026-12-01');g.failRead('2026-12');await g.t.saveRosterBatch();assert.equal(g.writes().length,0);assert.equal(g.t.dates().length,2);assert.match(g.element('roster-error').textContent,/month read failed/);
}
// Conflicts stay selected while the rest of the batch continues.
{
  const f=fixture();f.select('2026-11-20','2026-11-21');f.replies.push({success:false,conflict:true,error:'revision conflict'});await f.t.saveRosterBatch();
  assert.equal(f.writes().length,2);assert.equal(f.t.dates().join(),'2026-11-20');assert.match(f.t.message(),/1일 저장 완료.*확인 필요 1일/);
}
// Unknown outcomes halt the queue and expose a retry inside the dialog, using the same ID.
{
  const f=fixture();f.select('2026-11-20','2026-11-21');f.replies.push(new Error('timeout'));await f.t.saveRosterBatch();
  assert.equal(f.writes().length,1);assert.equal(f.t.dates().length,2);assert.ok(f.t.pending());assert.equal(f.element('roster-retry').hidden,false);
  const operation=f.writes()[0].operationId;await f.t.sendPending();assert.equal(f.writes()[1].operationId,operation);assert.equal(f.t.dates().join(),'2026-11-21');
  await f.t.saveRosterBatch();assert.equal(f.t.dates().length,0);assert.equal(f.writes().length,3);
}
// Calendar toggling, inclusive/leap-day ranges, duplicate dates, and limits.
{
  const f=fixture();f.select('2026-11-20');f.select('2026-11-20');assert.equal(f.t.dates().length,0);
  f.element('roster-range-start').value='2028-02-28';f.element('roster-range-end').value='2028-03-01';f.t.addRosterRange();assert.equal(f.t.dates().join(),'2028-02-28,2028-02-29,2028-03-01');f.t.addRosterRange();assert.equal(f.t.dates().length,3);
  f.element('roster-range-start').value='2026-01-01';f.element('roster-range-end').value='2027-01-02';f.t.addRosterRange();assert.equal(f.t.dates().length,3,'oversized range is rejected without partial selection');
  assert.equal(f.t.valid('2026-02-29'),false);assert.equal(f.t.valid('1999-12-31'),false);assert.equal(f.t.valid('2028-02-29'),true);
  const saved=JSON.parse([...f.storage.entries()].find(([k])=>k.endsWith('_roster_batch'))[1]);assert.equal(saved.dates.length,3);
}
console.log('Multi-date roster: cross-month save, existing schedules, revisions, conflicts, safe retries, ranges and persistence passed.');
