/* BAZ report attachments. Local files stay in memory and are embedded, never uploaded. */
(function(root){
  'use strict';
  var MAX=5*1024*1024;
  function xml(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c];});}
  function concat(parts){var n=parts.reduce(function(n,p){return n+p.length;},0),b=new Uint8Array(n),i=0;parts.forEach(function(p){b.set(p,i);i+=p.length;});return b;}
  function u32(n){var b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n,true);return b;}
  function str(s){return new TextEncoder().encode(s+'\0');}
  /* Windows Package OLE native stream. ASCII extraction name avoids system codepage ambiguity. */
  function nativeFile(bytes,name){
    var n=str(name),body=concat([new Uint8Array([2,0]),n,n,u32(0),u32(n.length),n,u32(bytes.length),bytes]);
    return concat([u32(body.length),body]);
  }
  function packageFile(bytes,name){
    if(bytes.length>MAX)throw new Error('첨부 파일은 각각 5MB 이하로 선택하세요.');
    var clsid=new Uint8Array([12,0,3,0,0,0,0,0,192,0,0,0,0,0,0,70]);
    var cp=concat([new Uint8Array([1,0,254,255,3,10,0,0,255,255,255,255]),clsid,u32(8),str('Package'),u32(0),u32(8),str('Package'),u32(0x71b239f4),u32(0),u32(0),u32(0)]);
    var streams=[{name:'\x01Ole',bytes:new Uint8Array([1,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0])},{name:'\x01CompObj',bytes:cp},{name:'\x01Ole10Native',bytes:nativeFile(bytes,name)}];
    var sectors=1;
    streams.forEach(function(s){s.start=sectors;s.size=Math.max(4096,s.bytes.length);s.count=Math.ceil(s.size/512);sectors+=s.count;});
    var fatCount=1;while(Math.ceil((sectors+fatCount)/128)>fatCount)fatCount++;
    if(fatCount>109)throw new Error('첨부 파일이 너무 큽니다.');
    var out=new Uint8Array((1+sectors+fatCount)*512),v=new DataView(out.buffer),fat=[];
    out.set([208,207,17,224,161,177,26,225]);v.setUint16(24,0x3e,true);v.setUint16(26,3,true);v.setUint16(28,0xfffe,true);v.setUint16(30,9,true);v.setUint16(32,6,true);
    v.setUint32(44,fatCount,true);v.setUint32(48,0,true);v.setUint32(56,4096,true);v.setUint32(60,0xfffffffe,true);v.setUint32(68,0xfffffffe,true);
    for(var i=0;i<109;i++)v.setUint32(76+i*4,i<fatCount?sectors+i:0xffffffff,true);
    function entry(id,name,type,start,size,left,right,child){var p=512+id*128;for(var j=0;j<name.length;j++)v.setUint16(p+j*2,name.charCodeAt(j),true);v.setUint16(p+64,(name.length+1)*2,true);out[p+66]=type;out[p+67]=1;v.setUint32(p+68,left==null?0xffffffff:left,true);v.setUint32(p+72,right==null?0xffffffff:right,true);v.setUint32(p+76,child==null?0xffffffff:child,true);if(type===5)out.set(clsid,p+80);v.setUint32(p+116,start,true);v.setUint32(p+120,size,true);}
    entry(0,'Root Entry',5,0xfffffffe,0,null,null,2);entry(1,streams[0].name,2,streams[0].start,streams[0].size);entry(2,streams[1].name,2,streams[1].start,streams[1].size,1,3);entry(3,streams[2].name,2,streams[2].start,streams[2].size);
    fat[0]=0xfffffffe;streams.forEach(function(s){out.set(s.bytes,(s.start+1)*512);for(var j=0;j<s.count;j++)fat[s.start+j]=j===s.count-1?0xfffffffe:s.start+j+1;});
    for(i=0;i<fatCount;i++)fat[sectors+i]=0xfffffffd;
    for(i=0;i<fatCount*128;i++)v.setUint32((sectors+1)*512+i*4,fat[i]==null?0xffffffff:fat[i],true);
    return out;
  }
  function icon(kind){
    var c=document.createElement('canvas');c.width=120;c.height=144;var x=c.getContext('2d'),color=kind==='pdf'?'#C0392B':'#217346';
    x.fillStyle='#fff';x.fillRect(0,0,120,144);x.strokeStyle=color;x.lineWidth=5;x.strokeRect(24,8,72,96);x.fillStyle=color;x.fillRect(9,44,88,45);x.fillStyle='#fff';x.font='bold 26px Arial';x.textAlign='center';x.fillText(kind==='pdf'?'PDF':'XLSX',53,75);x.fillStyle=color;x.font='18px Malgun Gothic';x.fillText(kind==='pdf'?'내역서':'엑셀',60,133);return c.toDataURL('image/png');
  }
  function frame(id,rid,img,box,name,prog){
    var e=function(n){return Math.round(n*914400);},w=e(box.w),h=e(box.h);
    return '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="'+id+'" name="'+xml(name)+'"><a:hlinkClick r:id="" action="ppaction://ole"/></p:cNvPr><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="'+e(box.x)+'" y="'+e(box.y)+'"/><a:ext cx="'+w+'" cy="'+h+'"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole"><p:oleObj name="'+xml(name)+'" showAsIcon="1" r:id="'+rid+'" imgW="'+w+'" imgH="'+h+'" progId="'+prog+'"><p:embed/><p:pic><p:nvPicPr><p:cNvPr id="'+(id+1)+'" name="'+xml(name)+' icon"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="'+img+'"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="'+e(box.x)+'" y="'+e(box.y)+'"/><a:ext cx="'+w+'" cy="'+h+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:oleObj></a:graphicData></a:graphic></p:graphicFrame>';
  }
  async function embed(pptxData,attachments){
    var zip=await root.JSZip.loadAsync(pptxData),sp='ppt/slides/slide1.xml',rp='ppt/slides/_rels/slide1.xml.rels',sx=await zip.file(sp).async('string'),rx=await zip.file(rp).async('string'),ct=await zip.file('[Content_Types].xml').async('string');
    // Some generator versions emit notesMasterIdLst after sldIdLst and repeat pPr
    // between rich-text runs. Office requires schema order and one pPr per paragraph.
    var pres=await zip.file('ppt/presentation.xml').async('string');
    var pd=new DOMParser().parseFromString(pres,'application/xml'),pn='http://schemas.openxmlformats.org/presentationml/2006/main';
    var nm=pd.getElementsByTagNameNS(pn,'notesMasterIdLst')[0],si=pd.getElementsByTagNameNS(pn,'sldIdLst')[0];
    if(nm&&si)si.parentNode.insertBefore(nm,si);
    zip.file('ppt/presentation.xml',new XMLSerializer().serializeToString(pd));
    var sd=new DOMParser().parseFromString(sx,'application/xml'),an='http://schemas.openxmlformats.org/drawingml/2006/main';
    Array.from(sd.getElementsByTagNameNS(an,'p')).forEach(function(p){var props=Array.from(p.children).filter(function(c){return c.namespaceURI===an&&c.localName==='pPr';});props.slice(1).forEach(function(c){c.remove();});if(props[0])p.insertBefore(props[0],p.firstChild);});
    sx=new XMLSerializer().serializeToString(sd);
    var id=Math.max.apply(null,Array.from(sx.matchAll(/\bid="(\d+)"/g),function(m){return Number(m[1]);}).concat([1]))+1;
    for(var i=0;i<attachments.length;i++){
      var a=attachments[i],b=new Uint8Array(a.bytes);if(b.length>MAX)throw new Error('첨부 파일은 각각 5MB 이하로 선택하세요.');
      var key='bazAttach'+i,rid=key+'File',img=key+'Icon',isX=a.kind==='xlsx',ext=isX?'xlsx':'bin',target='attachment'+(i+1)+'.'+ext;
      zip.file('ppt/embeddings/'+target,isX?b:packageFile(b,'report-'+(i+1)+'.pdf'));
      zip.file('ppt/media/'+key+'.png',a.icon.split(',')[1],{base64:true});
      var rel='<Relationship Id="'+rid+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'+(isX?'package':'oleObject')+'" Target="../embeddings/'+target+'"/><Relationship Id="'+img+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/'+key+'.png"/>';
      rx=rx.replace('</Relationships>',rel+'</Relationships>');sx=sx.replace('</p:spTree>',frame(id,rid,img,a,a.name,isX?'Excel.Sheet.12':'Package')+'</p:spTree>');id+=2;
      var type=isX?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/vnd.openxmlformats-officedocument.oleObject';ct=ct.replace('</Types>','<Override PartName="/ppt/embeddings/'+target+'" ContentType="'+type+'"/></Types>');
    }
    zip.file(sp,sx);zip.file(rp,rx);zip.file('[Content_Types].xml',ct);return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
  }
  function download(bytes,name,type){var u=URL.createObjectURL(new Blob([bytes],{type:type})),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();setTimeout(function(){a.remove();URL.revokeObjectURL(u);},1500);}
  root.BazReportFiles={embed:embed,icon:icon,packageFile:packageFile,download:download,maxBytes:MAX};
})(typeof window!=='undefined'?window:globalThis);
