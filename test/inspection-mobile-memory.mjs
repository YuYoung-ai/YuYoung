import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const draws=[],surfaces=[],frames=[],clips=[],captions=[];
const document={createElement(){return {width:1,height:1,getContext(){return {measureText:t=>({width:t.length*10}),drawImage(){},scale(){},fillRect(){},fillText(t){captions.push(t);}};},toDataURL:()=> 'data:image/png;base64,label'};}};
class Pdf{
 constructor(){this.images=[];this.pages=1;this.currentClip=null;}
 addPage(){this.pages++;}
 addImage(...args){this.images.push(args);}
 setDrawColor(){}setLineWidth(){}
 roundedRect(...args){if(args[6]===null)this.path=args;else frames.push(args);}
 saveGraphicsState(){this.previousClip=this.currentClip;}
 clip(){assert.ok(this.path);this.currentClip=this.path;clips.push(this.path);}
 discardPath(){this.path=null;}
 restoreGraphicsState(){this.currentClip=this.previousClip;}
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
const photos=Array.from(api.PHOTO_ORDER,slot=>({slot,data:'data:image/jpeg;base64,original_'+(slot===4?'portrait_':'')+slot,memo:slot===0?'S/N 확인':'',width:1600,height:900}));
const result=await api.assemble([{data:'body',height:100}],photos.toReversed(),{footers(){}});
assert.equal(maxActive,1,'PDF copies are resized sequentially');
assert.equal(result.pdf.pages,2,'all six photos fit one photo sheet');
const images=result.pdf.images.filter(a=>String(a[0]).includes('small_'));
assert.deepEqual(images.map(a=>Number(a[0].split('_').at(-1))),[0,4,1,2,5,6],'S/N + overview, before + after, recovered HP + replacement HP');
assert.deepEqual(Array.from(api.PHOTO_ORDER,n=>api.PHOTO_LABELS[n]),['장비 S/N','전체샷','조치 전 증상','조치 후 상태','HP 회수품 S/N','HP 교체품 S/N']);
assert.equal(frames.length,6);
assert.equal(clips.length,6);
assert.equal(result.pdf.currentClip,null,'photo clipping never affects later labels or footers');
images.forEach((image,i)=>{
 const [x,y,w,h]=clips[i],ix=image[2],iy=image[3],iw=image[4],ih=image[5];
 assert.ok(ix<=x+.000001&&iy<=y+.000001&&ix+iw>=x+w-.000001&&iy+ih>=y+h-.000001,'each image covers the entire card');
 assert.ok(Math.abs(ix+iw/2-x-w/2)<.000001&&Math.abs(iy+ih/2-y-h/2)<.000001,'cropping is centered');
 const ratio=String(image[0]).includes('portrait')?450/800:800/450;
 assert.ok(Math.abs(iw/ih-ratio)<.000001,'portrait and landscape photos are not stretched');
 assert.deepEqual(clips[i].slice(0,4),frames[i].slice(0,4),'clip matches its card');
});
assert.equal(frames[0][1],frames[1][1]-0,'first pair has the same baseline when caption lengths match');
for(const [x,y,w,h]of frames){assert.ok(w<=194/2);assert.ok(h>0);assert.ok(x>=8&&x+w<=202);assert.ok(y>=26&&y+h<=289);}
assert.ok(frames[0][0]<frames[1][0]);assert.equal(frames[2][0],frames[0][0]);assert.equal(frames[4][0],frames[0][0]);
assert.ok(frames[0][1]<frames[2][1]&&frames[2][1]<frames[4][1]);
assert.ok(photos.every(p=>p.data.includes('original')),'saved source photos are unchanged');
assert.deepEqual(Array.from(api.photoGroups([{slot:2,id:'after'},{slot:0,id:'sn'},{slot:3,id:'water'},{slot:6,id:'hp-new'}])[0],p=>p.id),['sn','after','hp-new'],'missing and retired categories leave no empty entries');
assert.equal(api.normalizePhotos([{slot:2},{slot:2},{}])[1].slot,null,'duplicate or legacy categories stay unassigned');
assert.throws(()=>api.photoGroups(Array.from({length:7},()=>({}))),/최대 6장/,'unexpected old data is never silently dropped');
frames.length=clips.length=captions.length=0;api.reset();
const compact=await api.assemble([{data:'body',height:100}],[photos[0],photos[3],photos[5],{slot:3,data:'corrupt retired water'}],{footers(){}});
assert.equal(frames.length,3,'only attached active photos receive frames');
assert.equal(frames[0][1],frames[1][1],'surviving photos compact into the first row');
assert.ok(frames[2][1]>frames[0][1]);
assert.equal(compact.pdf.images.filter(a=>String(a[0]).includes('small_')).length,3);
assert.ok(captions.includes('조치 후 상태')&&captions.includes('HP 교체품 S/N'));
assert.ok(!captions.some(t=>t.includes('미첨부')||t.includes('증류수')||t.includes('조치 전 증상')),'no empty or removed captions are rendered');
const empty=await api.assemble([{data:'body',height:100}],[{slot:3,data:'corrupt retired water'}],{footers(){}});
assert.equal(empty.pdf.pages,1,'retired-only drafts have no empty photo page');

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
const state={photos:[{slot:3,data:'old-water',memo:'preserved'}]},ctx={window:{BazInspectionPdf:api,BazPerf:{start:()=>()=>{}},BazInspectionMedia:{process:async file=>({data:'data:'+file.name,worker:false})}},state,els,MAX_PHOTOS:6,_pdfBusy:false,_pdfStarting:false,pdfPublisher:{isBusy:()=>false},showToast(){},showLoading(){},hideLoading(){},saveDraft(){},autoSave(){},esc:s=>String(s||''),document:{getElementById:node}};
vm.runInNewContext(section+'\nthis.add=addPhotos;this.render=renderPhotos;',ctx);
await ctx.add(['sn','all','before','after','hp-return','hp-new'].map(name=>({name,type:'image/jpeg'})));
assert.deepEqual(state.photos.map(p=>p.slot),[3,0,4,1,2,5,6]);
assert.equal(els.photoCount.textContent,'6/6','retired photos do not consume current capacity');
assert.ok(els.photoList.innerHTML.includes('이전 증류수 사진 · PDF 제외'));
assert.ok(!els.photoList.innerHTML.includes('data-slot="3"'),'removed category cannot accept new photos');
assert.equal(state.photos[0].data,'old-water','old draft data remains recoverable, never relabeled as HP');
const del={dataset:{i:String(state.photos.findIndex(p=>p.slot===1))},hasAttribute:()=>false,classList:{contains:s=>s==='photo-del'}};
els.photoList.listeners.click({target:{closest:()=>del}});
assert.deepEqual(state.photos.map(p=>p.slot),[3,0,4,2,5,6],'deleting before does not relabel other categories');
await ctx.add([{name:'before-replaced',type:'image/jpeg'}],1);
await ctx.add([{name:'sn-replaced',type:'image/jpeg'}],0);
assert.equal(state.photos.length,7);assert.equal(state.photos.find(p=>p.slot===0).data,'data:sn-replaced');
const select={dataset:{i:String(state.photos.findIndex(p=>p.slot===0))},value:'4'};
els.photoList.listeners.change({target:{closest:()=>select}});
assert.equal(state.photos.find(p=>p.slot===4).data,'data:sn-replaced','assigning an occupied slot swaps photos without loss');
assert.equal(new Set(state.photos.map(p=>p.slot)).size,7);
assert.ok(html.includes('slot:p.slot'),'draft serialization preserves category');
console.log('PASS: bounded sequential captures, six active photo categories, compact attached-only PDF, retired-water exclusion/preservation, 800px copies, replacement, swap and legacy compatibility');
