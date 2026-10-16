const assert=require('node:assert/strict');
const {create}=require('../js/baz-autocomplete.js');
function fixture(pointer=true){
  const handlers={},timers=new Map(),picked=[],edited=[];let id=0;
  class Element{
    constructor(name){this.name=name;this.value='';this.style={display:'none'};this.attrs={};this.handlers={};this.children=[];}
    setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}
    addEventListener(t,fn){(this.handlers[t]||=[]).push(fn);}
    getAttribute(k){return this.attrs[k];}
    closest(s){return s==='.ac-opt'&&this.option?this:null;}
    contains(el){return el===this||this.children.includes(el);}
    querySelectorAll(){return this.children;}
    scrollIntoView(){}
    blur(){doc.activeElement=null;fire(this,'blur');}
    set innerHTML(v){this.markup=v;this.children=[...v.matchAll(/id="([^"]+)" data-i="(\d+)"/g)].map(m=>{const o=new Element('option');o.option=true;o.id=m[1];o.attrs['data-i']=m[2];return o;});}
  }
  const input=new Element('input'),dropdown=new Element('dropdown');
  const win={PointerEvent:pointer?function(){}:null,setTimeout(fn){timers.set(++id,fn);return id;},clearTimeout(id){timers.delete(id);}};
  const doc={activeElement:input,defaultView:win,getElementById:id=>id==='input'?input:dropdown,addEventListener(t,fn){(handlers[t]||=[]).push(fn);}};
  const rows=[{n:'샘플피부과 강남점',sn:'A'},{n:'샘플피부과 강남점',sn:'B'},{n:'다른 병원',sn:'C'}];
  const api=create({document:doc,inputId:'input',dropdownId:'list',db:rows,itemText:r=>r.n,renderItem:r=>r.n+' '+r.sn,onInput:()=>edited.push(input.value),onPick:r=>{picked.push(r);input.value=r.n+' '+r.sn;}});
  function event(target,extra){return {target,type:'',preventDefault(){this.prevented=true;},...extra};}
  function fire(target,type,extra={}){const e=event(target,{type,...extra});for(const fn of target.handlers[type]||[])fn(e);return e;}
  function outside(){for(const fn of handlers[pointer?'pointerdown':'mousedown']||[])fn(event(new Element('outside'),{}));}
  function type(value){input.value=value;fire(input,'input');}
  function tick(){for(const [id,fn]of [...timers]){timers.delete(id);fn();}}
  function focus(){doc.activeElement=input;fire(input,'focus');}
  return {api,input,dropdown,rows,timers,picked,edited,fire,type,tick,focus,outside};
}
{
  const f=fixture();f.type('샘플');f.tick();assert.equal(f.dropdown.children.length,2);
  f.type('샘플피');const option=f.dropdown.children[1];
  f.fire(f.dropdown,'pointerdown',{target:option,pointerType:'touch',clientX:20,clientY:30});
  f.fire(f.dropdown,'click',{target:option});f.tick();
  assert.equal(f.picked.length,1);assert.equal(f.picked[0].sn,'B');assert.equal(f.dropdown.style.display,'none','a queued search cannot reopen a completed pick');
  f.fire(f.dropdown,'click',{target:option});assert.equal(f.picked.length,1,'compatibility clicks do not apply twice');
  f.type('다른');f.api.refresh();assert.equal(f.dropdown.children.length,1,'editing without leaving the focused input begins a new search');
}
for(const cancel of ['move','pointercancel','scroll']){
  const f=fixture();f.type('샘플');f.tick();const option=f.dropdown.children[0];
  f.fire(f.dropdown,'pointerdown',{target:option,pointerType:'touch',clientX:10,clientY:10});
  if(cancel==='move')f.fire(f.dropdown,'pointermove',{target:option,clientX:10,clientY:40});
  else f.fire(f.dropdown,cancel,{target:option});
  f.fire(f.dropdown,'click',{target:option});assert.equal(f.picked.length,0,cancel+' is not a tap selection');
  f.focus();f.type('다른');f.tick();assert.equal(f.dropdown.children.length,1,'search remains usable after a canceled gesture');
}
{
  const f=fixture();f.type('샘플');f.tick();const option=f.dropdown.children[1];
  f.fire(f.input,'compositionstart');f.fire(f.dropdown,'pointerdown',{target:option,pointerType:'touch'});
  f.input.value='다른';f.fire(f.input,'input',{isComposing:true});f.tick();
  f.fire(f.dropdown,'click',{target:option});assert.equal(f.picked[0].sn,'B','the pressed equipment row survives an IME update');
  f.input.value='늦은 한글 조합';f.fire(f.input,'compositionend');f.fire(f.input,'input');f.tick();
  assert.equal(f.input.value,'샘플피부과 강남점 B');assert.equal(f.dropdown.style.display,'none');
  f.focus();f.type('다른');f.tick();assert.equal(f.dropdown.children.length,1,'a new focus permits ordinary editing after a pick');
}
{
  const f=fixture();f.type('샘플');f.tick();
  f.fire(f.input,'compositionstart');const enter=f.fire(f.input,'keydown',{key:'Enter',isComposing:true,keyCode:229});
  assert.ok(!enter.prevented);assert.equal(f.picked.length,0);
  f.fire(f.input,'compositionend');f.fire(f.input,'keydown',{key:'ArrowDown'});f.fire(f.input,'keydown',{key:'ArrowDown'});
  f.fire(f.input,'keydown',{key:'Enter'});assert.equal(f.picked[0].sn,'B');
}
{
  const f=fixture();f.type('샘플');f.tick();const option=f.dropdown.children[0];
  f.fire(f.dropdown,'pointerdown',{target:option,pointerType:'mouse'});f.rows.splice(0,1);f.api.refresh();
  f.fire(f.dropdown,'click',{target:option});assert.equal(f.picked.length,0,'a removed DB row cannot be applied from an old gesture');
}
for(const dismiss of ['outside','blur','reset']){
  const f=fixture();f.type('샘플');
  if(dismiss==='outside')f.outside();else if(dismiss==='blur')f.input.blur();else f.api.reset();
  f.tick();assert.equal(f.dropdown.style.display,'none',dismiss+' cancels pending work');
}
{
  const f=fixture(false);f.type('샘플');f.tick();const option=f.dropdown.children[0];
  f.fire(f.dropdown,'mousedown',{target:option});f.fire(f.dropdown,'click',{target:option});assert.equal(f.picked.length,1,'legacy mouse selection still works');
}
{
  const f=fixture(false);f.type('샘플');f.tick();const option=f.dropdown.children[0];
  f.fire(f.dropdown,'touchstart',{target:option,touches:[{clientX:10,clientY:10}]});
  f.fire(f.dropdown,'touchmove',{target:option,touches:[{clientX:10,clientY:40}]});
  f.fire(f.dropdown,'mousedown',{target:option});f.fire(f.dropdown,'click',{target:option});assert.equal(f.picked.length,0,'a legacy touch scroll cannot be converted into a mouse selection');
}
{
  const f=fixture(false);f.type('샘플');f.tick();const option=f.dropdown.children[1];
  f.fire(f.dropdown,'touchstart',{target:option,touches:[{clientX:10,clientY:10}]});
  f.fire(f.dropdown,'mousedown',{target:option});f.fire(f.dropdown,'click',{target:option});
  assert.equal(f.picked.length,1);assert.equal(f.picked[0].sn,'B','a legacy tap works once despite a synthetic mouse event');
}
console.log('autocomplete: queued searches, exact equipment selection, single click, touch scrolling/cancel, IME commit, keyboard, DB refresh, dismissal and legacy mouse/touch passed.');
