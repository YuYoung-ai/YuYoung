// Low-volume temporary PDFs use the existing Workers Paid + D1 allowance.
// An optional private R2 FILES binding can replace this adapter without changing the API.
const CHUNK=256*1024;
export function fileStore(db){
  const sql=(query,...args)=>db.prepare(query).bind(...args);
  return {
    async put(key,input){
      const bytes=typeof input==='string'?new TextEncoder().encode(input):new Uint8Array(input),version=crypto.randomUUID(),parts=Math.ceil(bytes.length/CHUNK)||1;
      const previous=await sql('SELECT version FROM qr_file_heads WHERE object_key=?',key).first();
      try{
        // Keep each bound BLOB comfortably below D1's per-value/row limit.
        for(let i=0;i<parts;i++)await sql('INSERT INTO qr_file_parts(object_key,version,part,bytes,created_at) VALUES(?,?,?,?,?)',key,version,i,bytes.slice(i*CHUNK,(i+1)*CHUNK).buffer,Date.now()).run();
        await sql('INSERT INTO qr_file_heads(object_key,version,parts,size) VALUES(?,?,?,?) ON CONFLICT(object_key) DO UPDATE SET version=excluded.version,parts=excluded.parts,size=excluded.size',key,version,parts,bytes.length).run();
      }catch(e){await sql('DELETE FROM qr_file_parts WHERE object_key=? AND version=?',key,version).run();throw e;}
      if(previous)await sql('DELETE FROM qr_file_parts WHERE object_key=? AND version=?',key,previous.version).run();
    },
    async get(key){
      // A single join sees one published version, never a partially uploaded file.
      const found=await sql('SELECT p.bytes,h.size,h.parts FROM qr_file_heads h JOIN qr_file_parts p ON p.object_key=h.object_key AND p.version=h.version WHERE h.object_key=? ORDER BY p.part',key).all(),rows=found.results||[];
      if(!rows.length)return null;
      if(rows.length!==rows[0].parts)throw new Error('Incomplete temporary file');
      const data=new Uint8Array(rows[0].size);let at=0;
      for(const row of rows){const bytes=row.bytes instanceof ArrayBuffer?new Uint8Array(row.bytes):new Uint8Array(row.bytes);data.set(bytes,at);at+=bytes.length;}
      if(at!==data.length)throw new Error('Temporary file size mismatch');
      return {body:data,arrayBuffer:async()=>data.buffer};
    },
    async delete(keys){for(const key of(Array.isArray(keys)?keys:[keys])){await sql('DELETE FROM qr_file_heads WHERE object_key=?',key).run();await sql('DELETE FROM qr_file_parts WHERE object_key=?',key).run();}}
  };
}
