// Decode, resize and JPEG encode one image at a time away from the UI thread.
self.onmessage=async event=>{
 const {id,blob,maxDimension,quality}=event.data;let bitmap,canvas;
 try{
  bitmap=await createImageBitmap(blob,{imageOrientation:'from-image'});
  const scale=Math.min(1,maxDimension/Math.max(bitmap.width,bitmap.height)),width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
  canvas=new OffscreenCanvas(width,height);const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas unavailable');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(bitmap,0,0,width,height);
  const result=await canvas.convertToBlob({type:'image/jpeg',quality});
  self.postMessage({id,blob:result,width,height,worker:true});
 }catch(e){self.postMessage({id,error:'image_processing_failed'});}
 finally{if(bitmap)bitmap.close();if(canvas)canvas.width=canvas.height=0;}
};
