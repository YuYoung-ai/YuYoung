// Reference-locked print art: retain the supplied board pixels, without redrawing.
let boardTask;const backgrounds=new Map();
export async function referenceBoard(){if(!boardTask)boardTask=(async()=>{const img=new Image();img.src=new URL('../assets/qr-stickers/reference-board.png',import.meta.url).href;await img.decode();return img;})().catch(()=>{boardTask=null;throw Error('원본 디자인 이미지를 불러오지 못했습니다. 다시 시도해 주세요.');});return boardTask;}
export async function artCanvas(design,px){
 const key=design.id+':'+design.source.crop.join(',')+':'+px;if(backgrounds.has(key))return backgrounds.get(key);
 const board=await referenceBoard(),c=document.createElement('canvas');c.width=Math.ceil(design.width*px);c.height=Math.ceil(design.height*px);const ctx=c.getContext('2d'),s=design.source,[cx,cy,cw,ch]=s.crop,sx=c.width/cw,sy=c.height/ch;
 ctx.drawImage(board,cx,cy,cw,ch,0,0,c.width,c.height);
 // Replace only the hospital text; retain the adjacent ring, separator and gradient.
 const [nx,ny,nw,nh]=s.name,probe=document.createElement('canvas');probe.width=nw+2;probe.height=nh;const pc=probe.getContext('2d');pc.drawImage(board,nx-1,ny,nw+2,nh,0,0,nw+2,nh);const edges=pc.getImageData(0,0,nw+2,nh),mask=document.createElement('canvas');mask.width=nw;mask.height=nh;const mc=mask.getContext('2d'),pixels=mc.createImageData(nw,nh);
 for(let y=0;y<nh;y++)for(let x=0;x<nw;x++){const a=y*(nw+2)*4,b=(y*(nw+2)+nw+1)*4,t=(x+1)/(nw+1),i=(y*nw+x)*4;for(let k=0;k<3;k++)pixels.data[i+k]=Math.round(edges.data[a+k]*(1-t)+edges.data[b+k]*t);pixels.data[i+3]=255;}
 mc.putImageData(pixels,0,0);ctx.drawImage(mask,(nx-cx)*sx,(ny-cy)*sy,nw*sx,nh*sy);
 const [qx,qy,qw,qh]=s.clear;ctx.fillStyle=design.inverted?'#111619':'#fff';ctx.fillRect((qx-cx)*sx,(qy-cy)*sy,qw*sx,qh*sy);
 backgrounds.set(key,c);return c;
}
export function designText(record,design){
 const [x,y,w,h]=design.source.name,[cx,cy,cw,ch]=design.source.crop;
 return [{x:(x-cx)*design.width/cw,y:(y-cy)*design.height/ch,w:w*design.width/cw,h:h*design.height/ch,text:record.printName||record.name,cfg:{size:2.9,min:1.45,weight:800,align:'center',valign:'middle',color:design.id==='b'?'#080B0D':'#fff'}}];
}
