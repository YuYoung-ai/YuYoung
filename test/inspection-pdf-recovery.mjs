import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function clock(){
 let next=0;const timers=new Map();
 return {timers,setTimeout(fn,ms){const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},fire(ms){for(const [id,t] of [...timers])if(t.ms===ms){timers.delete(id);t.fn();}}};
}

// A stalled tool download is bounded, removed and can be retried. Successful
// concurrent downloads stay deduplicated when only one script has failed.
const time=clock(),scripts=[],window={};let autoLoad=false;
const document={head:{appendChild(s){scripts.push(s);if(autoLoad)queueMicrotask(()=>{if(s.src.includes('html2canvas'))window.html2canvas=()=>{};else window.jspdf={jsPDF:class{}};s.onload?.();});}},createElement(){return {remove(){this.removed=true;}};}};
vm.runInNewContext(read('js/baz-inspection-pdf.js'),{window,document,Image:class{},setTimeout:time.setTimeout,clearTimeout:time.clearTimeout});
const api=window.BazInspectionPdf;
const stalled=assert.rejects(api.libraries(),/다운로드가 지연/);time.fire(30000);await stalled;
assert.ok(scripts.every(s=>s.removed&&!s.onload&&!s.onerror));assert.equal(time.timers.size,0);
autoLoad=true;await api.libraries();assert.equal(scripts.length,4);assert.equal(time.timers.size,0);
document.fonts={ready:new Promise(()=>{})};const fontWait=assert.rejects(api.libraries(),/글꼴 준비가 지연/);await flush();time.fire(15000);await fontWait;
document.fonts.ready=Promise.resolve();await api.libraries();assert.equal(scripts.length,4,'font retry does not reload successful tools');
const image={complete:false,naturalWidth:0,naturalHeight:0};
const imageWait=assert.rejects(api.waitImages([image]),/사진 준비가 지연/);time.fire(30000);await imageWait;
assert.equal(image.onload,null);assert.equal(image.onerror,null);assert.equal(time.timers.size,0);
await assert.rejects(api.waitImages([{complete:true,naturalWidth:10,naturalHeight:0}]),/사진 크기/);
await api.waitImages([{complete:true,naturalWidth:900,naturalHeight:1600}]);assert.equal(time.timers.size,0);

// Exercise the actual offscreen-sheet helper on failure; retry must not leave
// hidden images/HTML occupying memory after a failed capture.
const html=read('inspection.html'),renderCode=html.slice(html.indexOf('async function renderSheetCanvas('),html.indexOf('// 모든 페이지 하단'));
const sheet={innerHTML:'',firstElementChild:{querySelectorAll:()=>[]}};
const renderer={els:{pdfSheet:sheet},window:{BazInspectionPdf:{waitImages:async()=>{throw new Error('photo stalled');}}}};
vm.runInNewContext(renderCode+'\nthis.render=renderSheetCanvas;',renderer);
await assert.rejects(renderer.render('<div>fixture</div>'),/photo stalled/);assert.equal(sheet.innerHTML,'');

// Native fallback failures must release the photo queue, URLs and canvases.
// No arbitrary delay is added to a successful image, encoding or read event.
for(const failingStage of ['image','encode','reader']){
 const tick=clock(),urls=[],canvases=[],images=[],readers=[];let fail=true;
 class Img{constructor(){images.push(this);this.naturalWidth=3200;this.naturalHeight=1800;}set src(value){if(!(fail&&failingStage==='image'))queueMicrotask(()=>this.onload?.());}}
 class Reader{constructor(){readers.push(this);this.readyState=0;}readAsDataURL(){this.readyState=1;if(!(fail&&failingStage==='reader'))queueMicrotask(()=>{this.readyState=2;this.result='data:image/jpeg;base64,encoded';this.onload?.();});}abort(){this.aborted=true;this.readyState=2;}}
 const doc={createElement(){const c={getContext:()=>({fillRect(){},drawImage(){}}),toBlob(fn){if(!(fail&&failingStage==='encode'))queueMicrotask(()=>fn(new Blob(['photo'])));}};canvases.push(c);return c;}};
 const w={};vm.runInNewContext(read('js/baz-inspection-media.js'),{window:w,Image:Img,FileReader:Reader,document:doc,URL:{createObjectURL:()=> 'blob:photo',revokeObjectURL:url=>urls.push(url)},setTimeout:tick.setTimeout,clearTimeout:tick.clearTimeout});
 const failed=assert.rejects(w.BazInspectionMedia.process(new Blob(['photo'])),/시간|지연/);
 await flush();assert.equal(tick.timers.size,1,'only the current fallback stage owns a timer');tick.fire(30000);await failed;
 assert.equal(urls.length,1);assert.ok(canvases.every(c=>c.width===0&&c.height===0));assert.ok(images.every(i=>i.onload===null&&i.onerror===null));
 if(failingStage==='reader')assert.equal(readers[0].aborted,true);
 fail=false;const recovered=await w.BazInspectionMedia.process(new Blob(['retry']));
 assert.equal(recovered.worker,false);assert.equal(recovered.width,1600);assert.equal(recovered.height,900);assert.equal(tick.timers.size,0);assert.equal(urls.length,2);
}

// The successful Worker path still uses the same settings and never falls back
// to the main thread just because bounded fallback handling was introduced.
const workerClock=clock();let posted,createdCanvases=0;
class Worker{postMessage(p){posted=p;queueMicrotask(()=>this.onmessage({data:{id:p.id,blob:new Blob(['worker']),width:1600,height:900,worker:true}}));}terminate(){throw new Error('successful worker must stay active');}}
class WorkerReader{readAsDataURL(){this.result='data:image/jpeg;base64,worker';queueMicrotask(()=>this.onload?.());}}
const workerWindow={Worker,createImageBitmap(){},OffscreenCanvas:class{}};
vm.runInNewContext(read('js/baz-inspection-media.js'),{window:workerWindow,Worker,FileReader:WorkerReader,document:{createElement(){createdCanvases++;throw new Error('fallback not expected');}},setTimeout:workerClock.setTimeout,clearTimeout:workerClock.clearTimeout});
const processed=await workerWindow.BazInspectionMedia.process(new Blob(['android']));assert.equal(processed.worker,true);assert.equal(posted.maxDimension,1600);assert.equal(posted.quality,.8);assert.equal(createdCanvases,0);assert.equal(workerClock.timers.size,0);

// Preflight has a shorter read deadline; writes keep their existing deadline.
// A timeout is recoverable, while changing account during JSON decoding is not.
const uploadTime=clock(),nodes=Object.fromEntries(['pdfUploadStatus','pdfUploadRetry','pdfOpenLink','doneNew'].map(id=>[id,{addEventListener(type,fn){this[type]=fn;}}]));
let encodingStall=false,lastReader;
const uploadWindow={};vm.runInNewContext(read('js/baz-inspection-upload.js'),{window:uploadWindow,document:{getElementById:id=>nodes[id]},URL,AbortController,setTimeout:uploadTime.setTimeout,clearTimeout:uploadTime.clearTimeout,crypto,Uint8Array,FileReader:class{readAsDataURL(){lastReader=this;this.readyState=1;if(encodingStall)return;this.readyState=2;this.result='data:application/pdf;base64,JVBERi0=';queueMicrotask(()=>this.onload?.());}abort(){this.aborted=true;this.readyState=2;}}});
let stalledFetch=true,uploads=0;
const uploader=uploadWindow.BazInspectionUpload.create({url:'https://script.google.com/macros/s/fixture/exec',token:()=> 'token-A',onSaved(){},fetch:async(url,o)=>{
 const p=JSON.parse(o.body);if(p.action==='inspection_pdf_upload'){uploads++;assert.equal([...uploadTime.timers.values()][0].ms,120000);return {json:async()=>({success:true,pdf:{url:'https://drive.google.com/file/d/fixture/view'}})};}
 if(stalledFetch)return new Promise((_,reject)=>o.signal.addEventListener('abort',()=>{const e=new Error('aborted');e.name='AbortError';reject(e);}));
 return {json:async()=>({success:true,recordId:'fixed',pdf:null})};
}});
const preparing=uploader.prepare({recordId:'fixed',hospital:'가상 병원',date:'2026-10-16'});await flush();assert.equal([...uploadTime.timers.values()][0].ms,30000);uploadTime.fire(30000);const prepared=await preparing;assert.match(prepared.sourcePreparationError,/대기 시간/);
stalledFetch=false;await uploader.publish(new Blob(['%PDF-fixture']), 'fixture.pdf',prepared);assert.equal(uploads,1);assert.equal(uploadTime.timers.size,0);
encodingStall=true;
const encoding=uploader.publish(new Blob(['%PDF-fixture']), 'reader.pdf',prepared);await new Promise(resolve=>setTimeout(resolve,0));await flush();
assert.equal(uploadTime.timers.size,1);uploadTime.fire(30000);await encoding;
assert.equal(lastReader.aborted,true);assert.equal(nodes.pdfUploadRetry.hidden,false);assert.equal(uploads,1,'no incomplete base64 is uploaded');
encodingStall=false;await nodes.pdfUploadRetry.click();assert.equal(uploads,2,'same-file retry reads missing base64 even when its hash is already known');assert.equal(uploadTime.timers.size,0);
let token='A',finishJson;
const jsonSwitch=uploadWindow.BazInspectionUpload.create({url:'https://script.google.com/macros/s/fixture/exec',token:()=>token,onSaved(){throw new Error('must not save');},fetch:async()=>({json:()=>new Promise(resolve=>{finishJson=resolve;})})});
const beforeJson=jsonSwitch.prepare({recordId:'fixed',hospital:'가상 병원',date:'2026-10-16'});await flush();token='B';finishJson({success:true,recordId:'fixed',pdf:null});const switched=await beforeJson;
await jsonSwitch.publish(new Blob(['%PDF-fixture']), 'fixture.pdf',switched);assert.match(nodes.pdfUploadStatus.textContent,/계정이 변경/);assert.equal(nodes.pdfUploadRetry.hidden,true);
console.log('inspection-pdf-recovery: stalled tools/fonts/images/photo stages, cleanup and queue recovery, original Worker success path, read/write deadlines and account change during JSON decoding passed.');
