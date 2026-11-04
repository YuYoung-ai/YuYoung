import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const draws=[],surfaces=[],frames=[];
const document={createElement(){return {width:1,height:1,getContext(){return {measureText:t=>({width:t.length*10}),drawImage(){},scale(){},fillRect(){},fillText(){}};},toDataURL:()=> 'data:image/png;base64,label'};}};
class Pdf{
 constructor(){this.images=[];this.pages=1;}
 addPage(){this.pages++;}
 addImage(...args){this.images.push(args);}
 setDrawColor(){}setLineWidth(){}
 roundedRect(...args){frames.push(args);}
 output(){return {size:1024};}
}
let active=0,maxActive=0;
const window={jspdf:{jsPDF:Pdf},BazInspectionMedia:{async fromData(data,opts){
 active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;
 assert.equal(opts.maxDimension,800);assert.equal(opts.quality,.8);
 return {data:data.replace('original','small'),width:data.includes('portrait')?450:800,height:data.includes('portrait')?800:450};
}}};
vm.runInNewContext(read('js/baz-inspection-pdf.js'),{window,document,setTimeout,clearTimeout});
const api=window.BazInspectionPdf;
const height=3000,width=794,scale=2,step=Math.floor(281/194*width*scale);
const pages=await api.capturePages(async viewport=>{
 assert.ok(surfaces.every(c=>c.width===0&&c.height===0),'previous surface is freed before the next capture');
 draws.push(viewport);const c={width:width*scale,height:Math.round(viewport.height*scale)};surfaces.push(c);return c;
},height,width,scale);
assert.equal(pages.length,Math.ceil(height*scale/step));
assert.equal(draws.reduce((sum,p)=>sum+p.height,0),height,'all source rows are covered exactly once');
for(let i=0;i<draws.length;i++)assert.equal(draws[i].y,i*step/scale);
assert.ok(surfaces.every(c=>c.width===0&&c.height===0));
await assert.rejects(api.capturePages(()=>assert.fail('must reject before allocating'),100000,width,scale),/20페이지/);
const photos=Array.from({length:5},(_,slot)=>({slot,data:'data:image/jpeg;base64,original_'+slot,memo:slot===0?'S/N 확인':'',width:1600,height:900}));
const result=await api.assemble([{data:'body',height:100}],photos.toReversed(),{footers(){}});
assert.equal(maxActive,1,'PDF copies are resized sequentially');
assert.equal(result.pdf.pages,2,'all five photos fit one photo sheet');
const images=result.pdf.images.filter(a=>String(a[0]).includes('small_'));
assert.deepEqual(images.map(a=>Number(a[0].split('_').at(-1))),[0,1,2,3,4]);
assert.equal(frames.length,5);
assert.equal(frames[0][1],frames[1][1]-0,'first pair has the same baseline when caption lengths match');
for(const [x,y,w,h]of frames){assert.ok(w<=194/2);assert.ok(h>0);assert.ok(x>=8&&x+w<=202);assert.ok(y>=26&&y+h<=289);}
assert.ok(frames[0][0]<frames[1][0]);assert.equal(frames[2][0],frames[0][0]);assert.equal(frames[4][0],frames[0][0]);
assert.ok(frames[0][1]<frames[2][1]&&frames[2][1]<frames[4][1]);
assert.ok(photos.every(p=>p.data.includes('original')),'saved source photos are unchanged');
assert.equal(api.photoGroups([{slot:0,id:'sn'},{slot:4,id:'overview'}])[0][1],null,'missing categories retain their positions');
assert.equal(api.normalizePhotos([{slot:2},{slot:2},{}])[1].slot,null,'duplicate or legacy categories stay unassigned');
assert.throws(()=>api.photoGroups(Array.from({length:6},()=>({}))),/최대 5장/,'unexpected old data is never silently dropped');

// A stalled capture exits, and its eventual canvas is still released.
let deadline,finishLate;
const slowWindow={};vm.runInNewContext(read('js/baz-inspection-pdf.js'),{window:slowWindow,document,setTimeout(fn,ms){if(ms===45000){deadline=fn;return 1;}return setTimeout(fn,ms);},clearTimeout(){}});
const stalled=slowWindow.BazInspectionPdf.capturePages(()=>new Promise(resolve=>{finishLate=resolve;}),100,794,2);
for(let i=0;i<10;i++)await Promise.resolve();
deadline();await assert.rejects(stalled,/생성이 지연/);
const late={width:1588,height:200};finishLate(late);for(let i=0;i<10;i++)await Promise.resolve();
assert.equal(late.width,0);assert.equal(late.height,0);

// Exercise actual entry-screen slot handlers without touching any live service.
const html=read('inspection.html'),section=html.slice(html.indexOf('// ===== 현장 사진 ====='),html.indexOf('// ===== 회사 로고 로드'));
const node=()=>({listeners:{},dataset:{},addEventListener(t,f){this.listeners[t]=f;},click(){}});
const els={photoList:node(),photoCount:node(),photoCameraInput:node(),photoGalleryInput:node()};
const state={photos:[]},ctx={window:{BazInspectionPdf:api,BazPerf:{start:()=>()=>{}},BazInspectionMedia:{process:async file=>({data:'data:'+file.name,worker:false})}},state,els,MAX_PHOTOS:5,_pdfBusy:false,pdfPublisher:{isBusy:()=>false},showToast(){},showLoading(){},hideLoading(){},saveDraft(){},autoSave(){},esc:s=>String(s||''),document:{getElementById:node}};
vm.runInNewContext(section+'\nthis.add=addPhotos;this.render=renderPhotos;',ctx);
await ctx.add([{name:'sn',type:'image/jpeg'},{name:'before',type:'image/jpeg'},{name:'after',type:'image/jpeg'},{name:'water',type:'image/jpeg'},{name:'all',type:'image/jpeg'}]);
assert.deepEqual(state.photos.map(p=>p.slot),[0,1,2,3,4]);
const del={dataset:{i:'1'},hasAttribute:()=>false,classList:{contains:s=>s==='photo-del'}};
els.photoList.listeners.click({target:{closest:()=>del}});
assert.deepEqual(state.photos.map(p=>p.slot),[0,2,3,4],'deleting before does not relabel after/water/overview');
await ctx.add([{name:'before-replaced',type:'image/jpeg'}],1);
await ctx.add([{name:'sn-replaced',type:'image/jpeg'}],0);
assert.equal(state.photos.length,5);assert.equal(state.photos.find(p=>p.slot===0).data,'data:sn-replaced');
const select={dataset:{i:String(state.photos.findIndex(p=>p.slot===0))},value:'4'};
els.photoList.listeners.change({target:{closest:()=>select}});
assert.equal(state.photos.find(p=>p.slot===4).data,'data:sn-replaced','assigning an occupied slot swaps photos without loss');
assert.equal(new Set(state.photos.map(p=>p.slot)).size,5);
assert.ok(html.includes('slot:p.slot'),'draft serialization preserves category');
console.log('PASS: bounded sequential page captures, one-sheet five-photo grid, 800px PDF copies, original preservation, stable missing slots, replacement, swap and legacy compatibility');
