const assert=require('node:assert/strict');
const {create,search}=require('../js/baz-work-hospital-search.js');
const rows=[
  {name:'샘플피부과_강남점',region:'서울',sn:'BW4015',key:'a'},
  {name:'샘플의원 분당점',region:'경기',sn:'BV5015',key:'b'},
  {name:'샘플의원 분당점',region:'경기',sn:'BV6015',key:'c'},
  {name:'엑셀 과거 병원',region:'서울',sn:'OLD',origin:'flow'}
];
assert.deepEqual(search(rows,'강 남').map(h=>h.key),['a']);
assert.deepEqual(search(rows,'샘플피부과 강남').map(h=>h.key),['a']);
assert.deepEqual(search(rows,'bv5015').map(h=>h.key),['b']);
assert.deepEqual(search(rows,'분당').map(h=>h.key),['b','c'],'same-name equipment records remain distinguishable');
assert.equal(search(rows,'엑셀').length,0);
assert.equal(search(rows,'아무병원').length,0);

class Element {
  constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.dataset={};this.style={};this.handlers={};this.hidden=false;this.isConnected=true;this.value='';}
  setAttribute(k,v){this.attrs[k]=v;} removeAttribute(k){delete this.attrs[k];}
  append(...nodes){nodes.forEach(n=>{n.parentNode=this;this.children.push(n);});}
  replaceChildren(){this.children=[];}
  addEventListener(type,fn){(this.handlers[type]||=[]).push(fn);}
  matches(selector){return selector===':popover-open'?!!this.popoverOpen:selector==='input'?this.tag==='input':false;}
  closest(selector){return selector==='dialog'?this.dialog||null:selector==='[data-hospital-index]'?this.dataset.hospitalIndex!=null?this:this.parentNode?.closest(selector):null;}
  contains(target){return this===target||this.children.some(x=>x.contains(target));}
  getBoundingClientRect(){return this.tag==='input'?{top:120,bottom:160,left:20,width:400}:{height:140};}
  showPopover(){this.popoverOpen=true;} hidePopover(){this.popoverOpen=false;}
  scrollIntoView(){}
  dispatchEvent(e){if(e.type==='input')selected.push(this.value);send(e.type,this,e);}
}
const selected=[],handlers={},body=new Element('body'),doc={body,activeElement:null,
 createElement:tag=>new Element(tag),addEventListener(type,fn){(handlers[type]||=[]).push(fn);}};
doc.defaultView={innerWidth:800,innerHeight:700,addEventListener(){},Event:class{constructor(type,init){this.type=type;Object.assign(this,init);}}};
function send(type,target,extra={}){const e={target,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra};(handlers[type]||[]).forEach(fn=>fn(e));return e;}
function panelEvent(type,target){const e={target,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};(panel.handlers[type]||[]).forEach(fn=>fn(e));return e;}
let data=rows;const picker=create({document:doc,selector:'input',getRows:()=>data,formatValue:h=>h.name+' · '+h.sn});
const input=new Element('input'),dialog=new Element('dialog');input.dialog=dialog;doc.activeElement=input;
send('focusin',input);const panel=dialog.children[0],list=panel.children[1],status=panel.children[0];
assert.equal(list.children.length,3);assert.equal(input.attrs['aria-expanded'],'true');
input.value='피부';send('input',input);assert.equal(list.children.length,1);assert.equal(list.children[0].children[0].textContent,rows[0].name);
input.value='분당';send('input',input);assert.equal(list.children.length,2,'typing filters without blur or another click');
send('compositionstart',input);input.value='분';send('input',input,{isComposing:true});assert.equal(list.children.length,2,'Korean composition updates the list');
const imeEnter=send('keydown',input,{key:'Enter',keyCode:229,isComposing:true});assert.ok(!imeEnter.prevented);assert.equal(selected.length,0,'IME confirmation must not select or submit');
send('compositionend',input);assert.equal(list.children.length,2);
send('keydown',input,{key:'ArrowDown'});send('keydown',input,{key:'ArrowDown'});
assert.equal(input.attrs['aria-activedescendant'],list.children[1].id);
const enter=send('keydown',input,{key:'Enter'});assert.ok(enter.prevented&&enter.stopped);
assert.deepEqual(selected,[rows[2].name+' · '+rows[2].sn]);assert.equal(panel.hidden,true);assert.equal(input.attrs['aria-expanded'],'false');
input.value='샘플';send('input',input);assert.equal(panel.hidden,false);
const pointer=panelEvent('pointerdown',list.children[0].children[0]);assert.ok(pointer.prevented,'mouse selection retains input focus');
panelEvent('click',list.children[0].children[0]);assert.equal(selected.length,2);assert.equal(panel.hidden,true);
input.value='없음';send('input',input);assert.equal(list.children.length,0);assert.equal(status.textContent,'일치하는 병원이 없습니다.');
assert.ok(send('keydown',input,{key:'Enter'}).prevented,'no selected result must not accidentally submit a receipt');
const escape=send('keydown',input,{key:'Escape'});assert.ok(escape.prevented&&escape.stopped);assert.equal(panel.hidden,true,'Escape closes suggestions before the modal');
input.value='신규';send('input',input);data=[{name:'신규병원',region:'서울',sn:'NEW'}];picker.refresh();assert.equal(list.children.length,1);assert.equal(input.value,'신규','DB refresh keeps the text being typed');
send('focusout',input);assert.equal(panel.hidden,true);doc.activeElement=null;picker.refresh();assert.equal(panel.hidden,true);
const inline=new Element('input');inline.value='NEW';doc.activeElement=inline;send('focusin',inline);
assert.equal(panel.parentNode,body,'inline popup lives outside the clipped table container');assert.equal(list.children.length,1);
send('keydown',inline,{key:'ArrowUp'});send('keydown',inline,{key:'Enter'});assert.equal(inline.value,'신규병원 · NEW');
inline.isConnected=false;picker.refresh();assert.equal(panel.hidden,true);
console.log('work-hospital-search: live input, Korean IME, distinct SNs, DB-only filtering, keyboard/mouse choice, no accidental submit, refresh and modal/inline lifecycle passed.');
