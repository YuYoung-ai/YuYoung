// In-memory expiry/CAS model; cursors are anchored to keys as in Deno KV.
export class Kv {
 data=new Map();seq=0;clock=Date.now();
 id(k){return JSON.stringify(k);}
 clean(){for(const [k,e]of this.data)if(e.expires&&e.expires<=this.clock)this.data.delete(k);}
 async get(k){this.clean();const e=this.data.get(this.id(k));return {key:k,value:e?structuredClone(e.value):null,versionstamp:e?.version||null};}
 async set(k,v,o={}){this.data.set(this.id(k),{key:k,value:structuredClone(v),version:String(++this.seq),expires:o.expireIn?this.clock+o.expireIn:0});}
 async delete(k){this.data.delete(this.id(k));}
 atomic(){const checks=[],ops=[],kv=this;const tx={check(...e){checks.push(...e);return tx;},set(k,v,o){ops.push(['set',k,v,o]);return tx;},delete(k){ops.push(['delete',k]);return tx;},async commit(){kv.clean();for(const e of checks)if((kv.data.get(kv.id(e.key))?.version||null)!==e.versionstamp)return {ok:false};for(const [kind,k,v,o]of ops){if(kind==='delete')kv.data.delete(kv.id(k));else kv.data.set(kv.id(k),{key:k,value:structuredClone(v),version:String(++kv.seq),expires:o?.expireIn?kv.clock+o.expireIn:0});}return {ok:true};}};return tx;}
 list(s,o={}){
  this.clean();const cmp=(a,b)=>{for(let i=0;i<Math.min(a.length,b.length);i++){if(a[i]===b[i])continue;return a[i]<b[i]?-1:1;}return a.length-b.length;};
  let rows=[...this.data.values()].filter(x=>s.prefix?s.prefix.every((p,i)=>x.key[i]===p):cmp(x.key,s.start)>=0&&cmp(x.key,s.end)<0).sort((a,b)=>cmp(a.key,b.key));
  if(o.reverse)rows.reverse();if(o.cursor){const anchor=JSON.parse(o.cursor);rows=rows.filter(x=>(o.reverse?-1:1)*cmp(x.key,anchor)>0);}
  rows=rows.slice(0,o.limit||Infinity);
  return {cursor:rows.length?JSON.stringify(rows.at(-1).key):o.cursor||'',async *[Symbol.asyncIterator](){for(const e of rows)yield {key:e.key,value:structuredClone(e.value),versionstamp:e.version};}};
 }
 close(){}
}
