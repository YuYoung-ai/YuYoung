import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const moduleSource=fs.readFileSync(new URL('../js/baz-inspection-hospitals.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../inspection.html',import.meta.url),'utf8');
for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
function fixture(cached){
  let pending,fetches=0,changed=0,status='',busy=false,saved=cached||null;
  const urls=[],rows=[];
  const context=vm.createContext({window:{BazAuth:{withToken:u=>u+'&token=test-token'}},
    localStorage:{getItem:()=>saved,setItem:(k,v)=>{saved=v;}},
    fetch:(url,opts)=>{fetches++;urls.push(url);assert.equal(opts.cache,'no-store');return new Promise((resolve,reject)=>{pending={resolve,reject};});},
    AbortController,setTimeout,clearTimeout,Date,Set,console});
  vm.runInContext(moduleSource,context);
  const api=context.window.BazInspectionHospitals.create({rows,url:'https://example.invalid/exec',
    changed:()=>changed++,status:m=>status=m,busy:b=>busy=b});
  return {api,rows,urls,get fetches(){return fetches;},get saved(){return saved;},get status(){return status;},get busy(){return busy;},
    reply:body=>pending.resolve({ok:true,json:async()=>body}),fail:()=>pending.reject(new TypeError('Failed to fetch'))};
}
const f=fixture();
assert.equal(f.rows.length,0,'first load must not use an embedded hospital snapshot');
const first=f.api.load(false),same=f.api.load(false);
assert.equal(f.fetches,1,'concurrent callers share the same request');
assert.equal(f.busy,true);
assert.match(f.urls[0],/action=hospdbrich&token=test-token/);
const live=[{name:'새 병원',sn:'BW4015,BV5015',sales:'영업 담당자',ncare:'Premium'},
  {name:'같은 병원',sn:'FIRST'},{name:'같은 병원',sn:'SECOND'}];
f.reply({success:true,data:live});
assert.equal(await first,true);await same;
assert.equal(f.rows.length,3,'distinct equipment rows with the same name must be retained');
assert.equal(f.rows[0].s,'BW4015,BV5015');assert.equal(f.rows[0].sa,'영업 담당자');
assert.equal(f.busy,false);assert.match(f.status,/병원정보DB · 3건/);
assert.ok(!f.saved.includes('test-token'),'cache must never store credentials');

const force=f.api.load(true);assert.match(f.urls[1],/force=1/);
f.reply({success:true,data:[{name:'새 병원',sn:'',sales:'',ncare:''}]});await force;
assert.equal(f.rows.length,1,'deleted Sheet rows must disappear');
assert.equal(f.rows[0].s,'');assert.equal(f.rows[0].sa,'');assert.equal(f.rows[0].c,'');
const offline=fixture(f.saved);assert.equal(offline.rows.length,1);
const failed=offline.api.load(false);offline.fail();assert.equal(await failed,false);
assert.match(offline.status,/저장된 병원정보DB/);assert.equal(offline.rows.length,1);
const unauth=offline.api.load(false);offline.reply({success:false,error:'unauthorized'});await unauth;
assert.match(offline.status,/로그인 상태/);
const empty=f.api.load(true);f.reply({success:true,data:[]});await empty;
assert.equal(f.rows.length,0,'an empty authoritative Sheet clears the old list');
const cold=fixture();const invalid=cold.api.load(false);cold.reply({success:true,data:[{}]});
assert.equal(await invalid,false);assert.equal(cold.rows.length,0);

// Selecting a different hospital clears the former hospital's missing fields.
const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'old',textContent:'',addEventListener(){}});return nodes.get(id);};
let config;
const picker=vm.createContext({HOSPITAL_DB:[],HANDOVER_URL:'https://example.invalid/exec',
  document:{getElementById:node},window:{BazInspectionHospitals:{create:()=>({load(){}})}},
  setupAutocomplete:cfg=>{config=cfg;return {refresh(){}};},esc:x=>x,loadRecentHistory(){},autoSave(){},setTimeout(){}});
const pickSource=html.slice(html.indexOf('// 병원명 자동완성'),html.indexOf('// ===== 부품 단가표'));
vm.runInContext(pickSource,picker);
config.onPick({n:'빈 정보 병원',s:'',c:'',sa:''});
assert.equal(node('hospital').value,'빈 정보 병원');
for(const id of ['serialNo','subscription','receiver'])assert.equal(node(id).value,'');
assert.match(html,/const HOSPITAL_DB = \[\];/);
assert.match(html,/hospitalDb.load\(false\)/);
console.log('PASS: authenticated Sheet source, refresh deduplication, same-name equipment, deleted/cleared rows, offline cache, auth errors and selection fields');
