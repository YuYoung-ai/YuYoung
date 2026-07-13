/************************************************************
 * regression.mjs — v2 회귀 테스트 (TEST_SPEC)
 * 실행: node autodoc/v2/test/regression.mjs
 * ----------------------------------------------------------
 * 무빌드 헤드리스. DOM/idb/AD(v1 엔진) 목을 주입해 핵심 로직·
 * 불변식(I2·I4)·S1~S6 대표 케이스를 한 번에 검증한다.
 ************************************************************/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE = path.join(HERE, '..', 'js', 'core');
const INFRA = path.join(HERE, '..', 'js', 'infra');
const TPL = path.join(HERE, '..', 'templates');

let pass = 0, total = 0, fails = [];
const ck = (n, c, d) => { total++; if (c) { pass++; } else { fails.push(n + (d ? ' — ' + d : '')); } console.log((c ? '✅' : '❌'), n, d || ''); };

// ── 최소 DOM 셰임 ─────────────────────────────────────────
class El {
  constructor(t){ this.tagName=(t||'').toUpperCase(); this.children=[]; this._attrs={}; this._handlers={};
    this.className=''; this._text=''; this.style={setProperty(){},removeProperty(){}}; this.value=undefined;
    this.checked=false; this.selected=false; this.hidden=false; this.width=0; this.height=0;
    this.classList={_s:new Set(),add:c=>this.classList._s.add(c),remove:c=>this.classList._s.delete(c),contains:c=>this.classList._s.has(c),toggle:(c,f)=>{f?this.classList._s.add(c):this.classList._s.delete(c);}}; }
  set textContent(v){this._text=v;this.children=[];} get textContent(){return this._text;}
  set innerHTML(v){ if(v==='')this.children=[]; else this._html=v; } get innerHTML(){return this._html||'';}
  setAttribute(k,v){this._attrs[k]=v;} getAttribute(k){return this._attrs[k];}
  addEventListener(t,fn){(this._handlers[t]=this._handlers[t]||[]).push(fn);}
  fire(t,ev){(this._handlers[t]||[]).forEach(fn=>fn(ev||{preventDefault(){},target:this}));}
  appendChild(c){this.children.push(c);c.parent=this;return c;} removeChild(c){const i=this.children.indexOf(c);if(i>=0)this.children.splice(i,1);return c;}
  get firstChild(){return this.children[0];} querySelector(){return null;} scrollIntoView(){} remove(){if(this.parent)this.parent.removeChild(this);} getContext(){return null;}
}
globalThis.document = { createElement:t=>new El(t), createTextNode:t=>({_text:t}), documentElement:new El('html'), body:new El('body') };

// ── idb 인메모리 목 ───────────────────────────────────────
const mem = { queue:new Map(), kv:new Map(), drafts:new Map(), cache:new Map(), jobs:new Map() };
const { idb } = await import(path.join(INFRA, 'idb.js'));
idb.get=async(s,k)=>mem[s].has(k)?mem[s].get(k):undefined; idb.put=async(s,k,v)=>{mem[s].set(k,v);};
idb.del=async(s,k)=>{mem[s].delete(k);}; idb.all=async(s)=>[...mem[s].values()]; idb.keys=async(s)=>[...mem[s].keys()];

// ── v1 엔진(AD) 목 ────────────────────────────────────────
globalThis.window = { AD: {
  Model:{ assemble:(tpl,v)=>({meta:{id:tpl.id,name:tpl.name,version:tpl.version},grid:{cols:12,rows:8},pages:[{blocks:[{component:'header',props:{t:v.writer||tpl.name}}]}]}) },
  Preview:{ render:(m,c)=>{ c.__model=m; } },
  Renderers:{ _l:[{id:'pptx',label:'PPT',ext:'.pptx',icon:'📊',render:async m=>({__blob:true,m})},{id:'pdf',label:'PDF',ext:'.pdf',render:async m=>({__blob:true,m})}], all(){return this._l.slice();}, get(id){return this._l.find(r=>r.id===id);} },
  Theme:{ load:async()=>({}) }, download:(b,f)=>{ globalThis.__dl=f; },
}, addEventListener(){}, removeEventListener(){} };

const tpls = ['weekly-report','meeting-minutes','trip-report'].map(id=>JSON.parse(fs.readFileSync(path.join(TPL,id+'.json'),'utf8')));

// ── S1: Event Bus + Flags ─────────────────────────────────
const { bus } = await import(path.join(INFRA,'bus.js'));
const { flags } = await import(path.join(INFRA,'flags.js'));
{
  let got=null,child=null; const o1=bus.subscribe('t.ping',e=>{got=e;bus.publish('t.pong',{});}); const o2=bus.subscribe('t.pong',e=>{child=e.causationId;});
  const id=bus.publish('t.ping',{n:1}); o1();o2();
  ck('S1 event round-trip + causation', got&&got.payload.n===1&&child===id);
  ck('S1 flag dependency off', flags.isOn('learning.autoApply98')===false);
}

// ── S2: JSON schema + validator ───────────────────────────
const { jsonSchema } = await import(path.join(CORE,'json-schema.js'));
const { validator } = await import(path.join(CORE,'validator.js'));
{
  ck('S2 schema valid (3 templates)', tpls.every(t=>jsonSchema.validate('template.v1',t).ok));
  ck('S2 schema rejects bad', !jsonSchema.validate('template.v1',{name:'x',inputs:[{}]}).ok);
  const wk=tpls[0]; const req=(wk.inputs||[]).filter(f=>f.required).map(f=>f.key); const filled={}; req.forEach(k=>filled[k]='x');
  ck('S2 required empty fails / filled ok', !validator.validate({},wk).ok && validator.validate(filled,wk).ok && validator.progress(filled,wk)===100);
}

// ── S2/S4: form-engine (render + conditional + repeat + undo) ─
const { createForm } = await import(path.join(CORE,'form-engine.js'));
const { createUndo } = await import(path.join(CORE,'undo.js'));
{
  const cls=e=>String(e.className||'').split(/\s+/);
  const scan=(e,a={n:0})=>{ if(!e||!e.children)return a; if(cls(e).includes('field'))a.n++; for(const c of e.children)if(c.tagName)scan(c,a); return a; };
  ck('S2 form builds all fields (3 templates)', tpls.every(t=>scan(createForm(t,{}).el).n===t.inputs.length));
  const f=createForm({inputs:[{key:'trip',type:'select',options:['예','아니오'],required:true},{key:'dest',type:'text',showIf:"trip == '예'"},{key:'v',type:'repeat',fields:[{key:'n',type:'text'}]}]},{});
  const find=(r,p)=>{let x=null;(function w(e){if(!e)return;if(!x&&p(e))x=e;for(const c of (e.children||[]))if(c.tagName)w(c);})(r);return x;};
  const sel=find(f.el,e=>e.tagName==='SELECT'); ck('S4 conditional hidden initially', f.isVisible('dest')===false);
  sel.fire('change',{target:{value:'예'}}); ck('S4 conditional shows', f.isVisible('dest')===true);
  const addBtn=find(f.el,e=>e.tagName==='BUTTON'&&(e.children[0]&&e.children[0]._text||'').includes('추가')); addBtn.fire('click'); addBtn.fire('click');
  ck('S4 repeat add x2', (f.getValues().v||[]).length===2);
  const u=createUndo(); u.init({a:1}); u.record({a:2}); ck('S4 undo/redo', JSON.stringify(u.undo())==='{"a":1}' && JSON.stringify(u.redo())==='{"a":2}');
}

// ── I5/I2: workspace + store write permission ─────────────
const { workspaceContext } = await import(path.join(INFRA,'workspace-context.js'));
const { store } = await import(path.join(INFRA,'store.js'));
{
  workspaceContext.setActive('default');
  let denied=false; try{ await store.put('dna',{id:'x',version:1},{by:'admin'}); }catch(e){ denied=e.code==='E-PERM-WRITE'; }
  ck('I2 store write permission (admin→dna denied)', denied);
  await store.put('kv',{id:'k1',version:1,value:'v'},{by:'settings'}).catch(()=>{});
  const back=await store.get('kv','k1'); ck('I5 store put/get (kv)', back && back.value==='v');
}

// ── S3: document-engine orchestration (AD mock) ───────────
const { documentEngine } = await import(path.join(CORE,'document-engine.js'));
const { previewEngine } = await import(path.join(CORE,'preview-engine.js'));
{
  const tpl={id:'weekly-report',name:'주간보고',version:'1',theme:'company-default',formats:['pptx','xlsx','docx','pdf']};
  const model=documentEngine.assemble(tpl,{writer:'김'});
  ck('S3 assemble + provenance', model.x2 && model.x2.provenance.templateRef==='weekly-report@1' && model.pages.length===1);
  await documentEngine.ensure(tpl);
  ck('S3 availableFormats intersect (drops docx)', JSON.stringify(documentEngine.availableFormats(tpl).map(f=>f.id))===JSON.stringify(['pptx','pdf']));
  const c={}; previewEngine.render(tpl,{writer:'박'},c);
  ck('I4 preview consumes same model shape', c.__model && c.__model.pages && c.__model.x2);
  const res=await documentEngine.generate(tpl,{writer:'이'},'pptx');
  ck('S3 generate → download + filename', res.filename==='주간보고.pptx' && globalThis.__dl==='주간보고.pptx');
}

// ── S5: prompt / import-gate / confidence / proposals ─────
const { promptEngine, CONTRACT } = await import(path.join(CORE,'prompt-engine.js'));
const { importGate } = await import(path.join(CORE,'import-gate.js'));
const { confidence } = await import(path.join(CORE,'confidence.js'));
const { learning } = await import(path.join(CORE,'learning.js'));
{
  ck('S5 prompt has JSON contract', promptEngine.issue({docType:'pptx'}).body.includes(CONTRACT));
  ck('S5 E1 non-json', importGate.validate('설명 {대충}').error.code==='E-IMPORT-E1');
  const good={contract:CONTRACT,analyzer:'ppt-analyzer',promptVersion:'v1',confidence:0.92,payload:{writingStyle:{tone:'개조식'},terms:[{canonical:'Handpiece',synonyms:['핸드피스']}]}};
  const g=importGate.validate('```json\n'+JSON.stringify(good)+'\n```'); ck('S5 fence strip + valid', g.ok===true);
  ck('S5 confidence grades', confidence.grade(0.99)==='auto'&&confidence.grade(0.92)==='recommend'&&confidence.grade(0.7)==='question');
  const props=learning.proposalsFromEnvelope(good);
  ck('S5 proposals dna+kb', props.filter(p=>p.kind==='dna').length===1 && props.filter(p=>p.kind==='kb').length===1 && props[0].analysis.target.store==='DNA');
}

// ── S6: offline sync-queue ────────────────────────────────
const { syncQueue } = await import(path.join(INFRA,'sync-queue.js'));
{
  mem.queue.clear();
  await syncQueue.enqueue({action:'a',payload:{v:1},requestId:'r1',dedupeKey:'d'});
  await syncQueue.enqueue({action:'a',payload:{v:2},requestId:'r2',dedupeKey:'d'});
  ck('S6 dedupe keeps latest', (await syncQueue.pending())===1 && [...mem.queue.values()][0].requestId==='r2');
  await syncQueue.enqueue({action:'b',payload:{},requestId:'r3'});
  syncQueue.setSender(async()=>({ok:true})); await syncQueue.drain();
  ck('S6 drain empties on success', (await syncQueue.pending())===0);
  await syncQueue.enqueue({action:'c',payload:{},requestId:'r4'});
  syncQueue.setSender(async()=>({ok:false,error:{code:'E-SCHEMA'}})); await syncQueue.drain();
  ck('S6 permanent failure dropped', (await syncQueue.pending())===0);
}

console.log(`\n===== 회귀 결과: ${pass}/${total} 통과 =====`);
if (fails.length) { console.log('실패:'); fails.forEach(f=>console.log('  -', f)); }
process.exit(pass===total ? 0 : 1);
