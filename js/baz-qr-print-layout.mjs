// Shared browser/server print geometry. All physical coordinates are millimetres.
export const PRINT_BASE={classic:[32,25],b:[45,71.2],c:[45,65.8],f:[45,65.8]};
export const PRINT_LIMIT=2000;
export function stablePrintJson(value){return JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);}
// Geometric A4 divisions, not manufacturer product templates.
export const LABEL_DIVISIONS={quarter:{name:'A4 4분할 · 2열×2행',labelWidth:105,labelHeight:148.5,labelCols:2,labelRows:2},eighth:{name:'A4 8분할 · 2열×4행',labelWidth:105,labelHeight:74.25,labelCols:2,labelRows:4},sixteenth:{name:'A4 16분할 · 4열×4행',labelWidth:52.5,labelHeight:74.25,labelCols:4,labelRows:4}};
const number=(v,min,max,label)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error(label+' 값을 확인하세요.');return Math.round(v*10000)/10000;};
export function printDefaults(design='f',purpose='as'){
 const [w,h]=PRINT_BASE[design]||PRINT_BASE.f,scale=design==='classic'?1:2;
 return {schema:1,design,purpose,width:w*scale,height:h*scale,ratio:true,mode:'sheet',orientation:'auto',layout:'auto',cols:2,rows:2,marginTop:10,marginRight:10,marginBottom:10,marginLeft:10,gapX:6,gapY:6,cut:true,cutOffset:.6,cutWidth:.1,guides:false,labelWidth:99.1,labelHeight:139,labelCols:2,labelRows:2,labelLeft:4.65,labelTop:9.5,labelGapX:2.5,labelGapY:0,offsetX:0,offsetY:0,printer:'',template:'직접 입력',manufacturer:'',product:'',nameX:null,nameY:null,nameWidth:null,namePt:null,nameMinPt:4,nameAlign:'center',nameAuto:true,pageByHospital:false,startSlot:1,skip:[]};
}
export function normalizePrint(raw){
 if(!raw||!PRINT_BASE[raw.design]||!['as','survey'].includes(raw.purpose))throw Error('QR 목적과 디자인을 확인하세요.');
 const p=printDefaults(raw.design,raw.purpose);
 p.labelInset=number(raw.labelInset??2,0,10,'라벨 안쪽 안전 여백');
 for(const k of ['width','height','labelWidth','labelHeight'])p[k]=number(raw[k]??p[k],5,297,k);
 for(const k of ['marginTop','marginRight','marginBottom','marginLeft','gapX','gapY','labelGapX','labelGapY','labelLeft','labelTop'])p[k]=number(raw[k]??p[k],0,100,k);
 for(const k of ['offsetX','offsetY'])p[k]=number(raw[k]??0,-20,20,k);
 for(const k of ['cols','rows','labelCols','labelRows']){p[k]=number(raw[k]??p[k],1,50,k);if(!Number.isInteger(p[k]))throw Error('행·열은 정수로 입력하세요.');}
 p.cutOffset=number(raw.cutOffset??p.cutOffset,0,10,'컷팅 여유');p.cutWidth=number(raw.cutWidth??p.cutWidth,.05,.5,'선 두께');
 p.nameMinPt=number(raw.nameMinPt??p.nameMinPt,1,60,'최소 글자 크기');
 for(const k of ['nameX','nameY','nameWidth'])p[k]=raw[k]==null?null:number(raw[k],0,100,k);
 p.namePt=raw.namePt==null?null:number(raw.namePt,1,100,'글자 크기');
 for(const k of ['ratio','cut','guides','nameAuto','pageByHospital']){if(raw[k]!==undefined&&typeof raw[k]!=='boolean')throw Error(k+' 설정을 확인하세요.');p[k]=raw[k]??p[k];}
 for(const [k,values] of Object.entries({mode:['sheet','labels'],orientation:['auto','portrait','landscape'],layout:['auto','manual'],nameAlign:['left','center','right']})){p[k]=raw[k]??p[k];if(!values.includes(p[k]))throw Error(k+' 설정을 확인하세요.');}
 for(const k of ['printer','template','manufacturer','product']){p[k]=String(raw[k]??p[k]).trim();if(p[k].length>80)throw Error('설정 이름은 80자 이내로 입력하세요.');}
 p.startSlot=number(raw.startSlot??1,1,2500,'시작 칸');if(!Number.isInteger(p.startSlot))throw Error('시작 칸을 확인하세요.');
 if(!Array.isArray(raw.skip??[])||(raw.skip??[]).length>2500)throw Error('제외 칸을 확인하세요.');p.skip=[...new Set(raw.skip??[])].sort((a,b)=>a-b);if(p.skip.some(n=>!Number.isInteger(n)||n<1||n>2500))throw Error('제외 칸을 확인하세요.');
 if(p.ratio&&Math.abs(p.width/p.height-PRINT_BASE[p.design][0]/PRINT_BASE[p.design][1])>.002)throw Error('비율 고정 상태의 너비·높이를 확인하세요.');
 return p;
}
function grid(p,width,height,rotation){
 const w=rotation?p.height:p.width,h=rotation?p.width:p.height,pad=p.cut?p.cutOffset+p.cutWidth/2:0;
 let cols,rows,left,top;
 if(p.mode==='labels'){if(width!==210||rotation)return null;cols=p.labelCols;rows=p.labelRows;left=p.labelLeft;top=p.labelTop;if(p.labelWidth*cols+p.labelGapX*(cols-1)+left>width+.0001||p.labelHeight*rows+p.labelGapY*(rows-1)+top>height+.0001)return null;if(w>p.labelWidth-2*p.labelInset+.001||h>p.labelHeight-2*p.labelInset+.001)throw Error('그림이 라벨 안전 영역보다 큽니다. 라벨에 맞춤을 눌러 주세요.');}
 else{cols=p.layout==='manual'?p.cols:Math.floor((width-p.marginLeft-p.marginRight-2*pad+p.gapX)/(w+p.gapX));rows=p.layout==='manual'?p.rows:Math.floor((height-p.marginTop-p.marginBottom-2*pad+p.gapY)/(h+p.gapY));if(cols<1||rows<1||cols*w+(cols-1)*p.gapX+2*pad>width-p.marginLeft-p.marginRight+.0001||rows*h+(rows-1)*p.gapY+2*pad>height-p.marginTop-p.marginBottom+.0001)return null;left=p.marginLeft+(width-p.marginLeft-p.marginRight-cols*w-(cols-1)*p.gapX)/2;top=p.marginTop+(height-p.marginTop-p.marginBottom-rows*h-(rows-1)*p.gapY)/2;if(cols>1&&p.gapX<2*pad+.2||rows>1&&p.gapY<2*pad+.2)throw Error('컷팅선 사이의 간격을 늘려 주세요.');}
 if(cols*rows>500)throw Error('한 장에 500칸까지 배치할 수 있습니다.');
 const cells=Array.from({length:cols*rows},(_,i)=>{const col=i%cols,row=Math.floor(i/cols),lx=left+col*((p.mode==='labels'?p.labelWidth:w)+(p.mode==='labels'?p.labelGapX:p.gapX)),ly=top+row*((p.mode==='labels'?p.labelHeight:h)+(p.mode==='labels'?p.labelGapY:p.gapY)),x=lx+(p.mode==='labels'?(p.labelWidth-w)/2:0)+p.offsetX,y=ly+(p.mode==='labels'?(p.labelHeight-h)/2:0)+p.offsetY;return {slot:i+1,row:row+1,col:col+1,x,y,w,h,lx,ly,lw:p.mode==='labels'?p.labelWidth:w,lh:p.mode==='labels'?p.labelHeight:h};});
 // Calibration offsets compensate physical feeding error; validate the uncorrected label fit.
 if(p.mode==='labels'&&cells.some(c=>c.x-p.offsetX<c.lx-.001||c.y-p.offsetY<c.ly-.001||c.x-p.offsetX+c.w>c.lx+c.lw+.001||c.y-p.offsetY+c.h>c.ly+c.lh+.001))throw Error('그림이 라벨 칸을 벗어납니다. 라벨에 맞춤을 눌러 주세요.');
 if(cells.some(c=>c.x-pad<0||c.y-pad<0||c.x+c.w+pad>width||c.y+c.h+pad>height))return null;
 return {width,height,rotation,cols,rows,capacity:cols*rows,cells};
}
export function printPlan(raw,records=[]){
 const p=normalizePrint(raw),options=[];
 for(const [w,h] of p.mode==='labels'||p.orientation==='portrait'?[[210,297]]:p.orientation==='landscape'?[[297,210]]:[[210,297],[297,210]])for(const rotation of p.mode==='labels'?[false]:[false,true]){const g=grid(p,w,h,rotation);if(g)options.push(g);}
 const best=options.sort((a,b)=>b.capacity-a.capacity||Number(a.rotation)-Number(b.rotation))[0];if(!best)throw Error('현재 크기·여백·행열로 A4에 배치할 수 없습니다.');
 if(p.startSlot>best.capacity||p.skip.some(n=>n>best.capacity))throw Error('시작·제외 칸이 A4 칸 수를 초과합니다.');
 const first=best.cells.filter(c=>c.slot>=p.startSlot&&!p.skip.includes(c.slot));if(!first.length)throw Error('첫 용지에 출력할 칸을 하나 이상 선택하세요.');
 let total=0;const pages=[];let page=null,used=0;
 for(const [index,r] of records.entries()){
  if(r.purpose&&r.purpose!==p.purpose||r.design&&r.design!==p.design)throw Error('다른 목적·디자인을 함께 제작할 수 없습니다.');
  const quantity=Number(r.quantity??1);if(!Number.isInteger(quantity)||quantity<1||quantity>9999)throw Error('제작 수량을 확인하세요.');total+=quantity;if(total>PRINT_LIMIT)throw Error('한 번에 2,000장까지 제작할 수 있습니다. 수량을 나눠 주세요.');
  if(p.pageByHospital&&page?.length){page=null;used=0;}
  for(let n=0;n<quantity;n++){if(!page||used>=(pages.length===1?first:best.cells).length){page=[];pages.push(page);used=0;}const list=pages.length===1?first:best.cells;page.push({...list[used++],index,copy:n+1});}
 }
 return {...best,settings:p,total,pages};
}
export function fitPrint(p,kind='grid'){
 p=normalizePrint(p);const [bw,bh]=PRINT_BASE[p.design];let w,h;
 if(kind==='labels'){w=p.labelWidth-2*p.labelInset;h=p.labelHeight-2*p.labelInset;}
 else{const paper=p.orientation==='landscape'?[297,210]:[210,297],pad=p.cut?p.cutOffset+p.cutWidth/2:0;w=(paper[0]-p.marginLeft-p.marginRight-(p.cols-1)*p.gapX-2*pad)/p.cols;h=(paper[1]-p.marginTop-p.marginBottom-(p.rows-1)*p.gapY-2*pad)/p.rows;}
 const scale=Math.min(w/bw,h/bh);if(scale<=0)throw Error('여백·간격을 줄여 주세요.');return {...p,width:Math.floor(bw*scale*100)/100,height:Math.floor(bh*scale*100)/100,ratio:true,...(kind==='grid'?{layout:'manual'}:{})};
}
export function productionCsv(records,plan,version='초안'){
 const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"',rows=[['병원명','인쇄 이름','수량','A4 위치(페이지:행-열)','QR 목적','디자인','그림 규격(mm)','설정 버전']];
 records.forEach((r,index)=>{const positions=[];plan.pages.forEach((page,i)=>page.filter(s=>s.index===index).forEach(s=>positions.push(`${i+1}:${s.row}-${s.col}`)));rows.push([r.name,r.printName||r.name,r.quantity,positions.join(' / '),plan.settings.purpose,plan.settings.design,`${plan.settings.width}x${plan.settings.height}`,version]);});
 return '\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n');
}
