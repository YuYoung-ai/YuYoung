import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../inspection.html',import.meta.url),'utf8');
const render=source.slice(source.indexOf('async function renderSheetCanvas('),source.indexOf('// 캔버스를 A4'));
const photoHTML=source.slice(source.indexOf('function buildPhotoSheetHTML('),source.indexOf('// 모든 페이지 하단'));
const parent={clientWidth:732,clientHeight:298};
let images=[],captured=false;
const target={querySelectorAll:()=>images};
const sheet={innerHTML:'',firstElementChild:target};
const context=vm.createContext({els:{pdfSheet:sheet},PDF_SCALE:2,SHEET_WIDTH:794,
  html2canvas:async()=>{captured=true;return {canvas:true};},
  logoHeaderHTML:()=>'',esc:x=>x,console});
vm.runInContext(render+'\n'+photoHTML,context);

for(const [width,height] of [[900,1600],[1600,900],[1000,1000],[1600,100],[100,1600]]){
  const image={naturalWidth:width,naturalHeight:height,complete:true,parentElement:parent,style:{}};
  images=[image];
  await context.renderSheetCanvas('fixture');
  const renderedWidth=parseFloat(image.style.width),renderedHeight=parseFloat(image.style.height);
  assert.ok(Math.abs(renderedWidth/renderedHeight-width/height)<1e-8,'photo aspect ratio must match the source');
  assert.ok(renderedWidth<=parent.clientWidth && renderedHeight<=parent.clientHeight,'whole photo must fit the frame');
  assert.equal(sheet.innerHTML,'','rendered sheet must be released');
}

// A slow-loading portrait must finish before PDF capture starts.
captured=false;
const slow={naturalWidth:0,naturalHeight:0,complete:false,parentElement:parent,style:{}};
images=[slow];
const pending=context.renderSheetCanvas('fixture');
await Promise.resolve();
assert.equal(captured,false);
slow.naturalWidth=900;slow.naturalHeight=1600;slow.onload();
await pending;
assert.equal(captured,true);

captured=false;
images=[{naturalWidth:0,complete:true}];
await assert.rejects(context.renderSheetCanvas('broken'),/사진을 불러오지 못했습니다/);
assert.equal(captured,false,'failed photos must not silently produce a broken PDF');

const html=context.buildPhotoSheetHTML([{data:'data:image/png;base64,fixture',memo:'현장 <메모>'}],2);
assert.match(html,/data-pdf-photo/);
assert.doesNotMatch(html,/object-fit/);
assert.match(html,/사진 3/);
console.log('PASS: portrait, landscape, square and extreme ratios, slow image loading and broken-image rejection');
