import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { PDFDocument, PDFName } from 'pdf-lib';
import worker, { cleanup, digest, placements, stampPdf } from '../src/worker.js';
import { fileStore } from '../src/file-store.js';

const realFetch=globalThis.fetch,realNow=Date.now;let clock=1800000000000;
before(()=>{Date.now=()=>clock;globalThis.fetch=async(url,opts)=>{assert.equal(url,'https://auth.example');const p=JSON.parse(opts.body);assert.equal(p.action,'verify');return Response.json(p.token==='alice'?{ok:true,level:1,name:'직원 A'}:p.token==='bob'?{ok:true,level:1,name:'직원 B'}:{ok:false});};});
after(()=>{globalThis.fetch=realFetch;Date.now=realNow;});
function crc(buffer){let value=0xffffffff;for(const byte of buffer){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return(value^0xffffffff)>>>0;}
function png(blank=false){
  const w=900,h=600,header=Buffer.alloc(13);header.writeUInt32BE(w,0);header.writeUInt32BE(h,4);header[8]=8;header[9]=2;
  const raw=Buffer.alloc((w*3+1)*h,255);for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;for(let x=0;x<w;x++)if(!blank&&y>100&&y<480&&Math.abs(y-200-Math.sin(x/50)*70)<4){const p=y*(w*3+1)+1+x*3;raw[p]=raw[p+1]=raw[p+2]=0;}}
  const chunk=(name,data)=>{const t=Buffer.from(name),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);t.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([t,data])),data.length+8);return out;};
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const signature=png(),signatureUrl='data:image/png;base64,'+signature.toString('base64'),slot={page:0,x:140,y:210,width:50,height:30};
async function fixture(){
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0001_sessions.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../migrations/0002_temporary_files.sql',import.meta.url),'utf8'));
  const objects=new Map(),env={AUTH_URL:'https://auth.example',ALLOWED_ORIGINS:'https://site.example',CUSTOMER_PAGE:'https://site.example/customer-sign.html',RETENTION_DAYS:'30',DB:{prepare(sql){return{bind(...input){const args=input.map(x=>x instanceof ArrayBuffer?new Uint8Array(x):x);return{async first(){return db.prepare(sql).get(...args)||null;},async all(){return{results:db.prepare(sql).all(...args)};},async run(){return db.prepare(sql).run(...args);}};}};}},FILES:{async put(key,value){if(env.failPut&&key.endsWith(env.failPut)){env.failPut=null;throw new Error('injected storage failure');}objects.set(key,typeof value==='string'?Buffer.from(value):Buffer.from(value));},async get(key){const x=objects.get(key);return x?{body:x,arrayBuffer:async()=>x.buffer.slice(x.byteOffset,x.byteOffset+x.byteLength)}:null;},async delete(keys){for(const k of(Array.isArray(keys)?keys:[keys]))objects.delete(k);}}};
  const pdf=await PDFDocument.create();pdf.addPage([210*72/25.4,297*72/25.4]);const base=await pdf.save();
  async function request(path,token='alice',data={},origin='https://site.example'){
    return worker.fetch(new Request('https://qr.example'+path,{method:'POST',headers:{Authorization:'Bearer '+token,Origin:origin,...(data instanceof FormData?{}:{'Content-Type':'application/json'})},body:data instanceof FormData?data:JSON.stringify(data)}),env);
  }
  async function create(ttl=30){const form=new FormData();form.append('metadata',JSON.stringify({ttlMinutes:ttl,filename:'점검_테스트.pdf',documentNo:'BAZ-TEST-1',placements:[slot],review:{hospital:'테스트 병원',serial:'SN-1',pages:['data:image/jpeg;base64,YQ=='],photos:[]}}));form.append('pdf',new Blob([base],{type:'application/pdf'}),'test.pdf');const response=await request('/staff/sessions','alice',form);return{response,...await response.json()};}
  const guestPath=(entry,action)=>'/guest/sessions/'+entry.id+'/'+action;
  const guestToken=entry=>new URLSearchParams(new URL(entry.url).hash.slice(1)).get('token');
  const sign=(entry,patch={})=>request(guestPath(entry,'sign'),guestToken(entry),{name:'병원 담당자',confirmed:true,signature:signatureUrl,submissionId:'11111111-1111-4111-8111-111111111111',...patch});
  return{env,db,objects,base,request,create,guestPath,guestToken,sign};
}
test('authenticated create freezes document; anonymous/other employee/origin cannot access',async()=>{
  const f=await fixture(),entry=await f.create();assert.equal(entry.response.status,201);assert.match(entry.url,/#id=/);assert.equal(new URL(entry.url).search,'');
  const row=f.db.prepare('SELECT * FROM qr_sessions').get();assert.notEqual(row.token_hash,f.guestToken(entry));assert.equal(row.document_hash,await digest(f.base));
  assert.equal((await f.request('/staff/sessions/'+entry.id+'/status','bob')).status,404);
  assert.equal((await f.request('/staff/sessions/'+entry.id+'/status','bad')).status,401);
  assert.equal((await f.request(f.guestPath(entry,'status'),'0'.repeat(64))).status,404);
  assert.equal((await f.request(f.guestPath(entry,'status'),f.guestToken(entry),{},'https://evil.example')).status,403);
  const review=await f.request(f.guestPath(entry,'review'),f.guestToken(entry));assert.equal(review.status,200);assert.equal(review.headers.get('Cache-Control'),'private, no-store');assert.equal((await review.json()).hospital,'테스트 병원');
  assert.equal((await f.request(f.guestPath(entry,'download'),f.guestToken(entry))).status,409);
});
test('confirmation required; blank/invalid image rejected; one signature with idempotent retry',async()=>{
  const f=await fixture(),entry=await f.create();for(const patch of [{confirmed:false},{name:''},{signature:'data:image/svg+xml;base64,YQ=='},{signature:'data:image/png;base64,'+png(true).toString('base64')}])assert.equal((await f.sign(entry,patch)).status,400);
  const done=await f.sign(entry);assert.equal(done.status,200);assert.equal((await done.json()).state,'signed');
  assert.equal((await f.sign(entry)).status,200);assert.equal((await f.sign(entry,{name:'다른 사람'})).status,409);
  const final=await f.request(f.guestPath(entry,'download'),f.guestToken(entry));assert.equal(final.status,200);assert.match(final.headers.get('Content-Disposition'),/filename\*=UTF-8/);
  const parsed=await PDFDocument.load(await final.arrayBuffer());assert.equal(parsed.getPageCount(),1);assert.ok(parsed.catalog.get(PDFName.of('Names')),'server audit attached');assert.ok(parsed.getPage(0).node.Resources().get(PDFName.of('XObject')),'signature image embedded');
});
test('signature accepted just before expiry grants 10 minute download window; server enforces expiry',async()=>{
  const f=await fixture(),entry=await f.create(10),start=clock;clock=entry.expiresAt-1;
  const done=await(await f.sign(entry)).json();assert.equal(done.downloadUntil,clock+600000);clock=entry.expiresAt+1000;
  assert.equal((await f.request(f.guestPath(entry,'download'),f.guestToken(entry))).status,200);
  clock=done.downloadUntil;assert.equal((await f.request(f.guestPath(entry,'download'),f.guestToken(entry))).status,410);
  assert.equal((await f.request('/staff/sessions/'+entry.id+'/download')).status,200,'staff can archive after guest expiry');clock=start;
});
test('pending expiry and revoked tokens cannot sign; fresh QR never reuses old token',async()=>{
  const f=await fixture(),a=await f.create(),b=await f.create();assert.notEqual(f.guestToken(a),f.guestToken(b));
  assert.equal((await f.request(f.guestPath(b,'status'),f.guestToken(a))).status,404);
  await f.request('/staff/sessions/'+a.id+'/revoke');assert.equal((await f.sign(a)).status,410);
  const start=clock;clock=b.expiresAt;assert.equal((await f.sign(b)).status,410);clock=start;
});
test('concurrent submissions have a single winner',async()=>{
  const f=await fixture(),entry=await f.create(),results=await Promise.all([f.sign(entry),f.sign(entry,{name:'다른 고객',submissionId:'22222222-2222-4222-8222-222222222222'})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(f.db.prepare('SELECT signer FROM qr_sessions').get().signer,'병원 담당자');
});
test('failed PDF write preserves accepted signature and status resumes after customer reload',async()=>{
  const f=await fixture(),entry=await f.create();f.env.failPut='final.pdf';assert.equal((await f.sign(entry)).status,503);
  assert.equal(f.db.prepare('SELECT state FROM qr_sessions').get().state,'signing');
  assert.equal((await f.sign(entry,{name:'바꾼 고객'})).status,409);
  const recovered=await f.request(f.guestPath(entry,'status'),f.guestToken(entry));assert.equal(recovered.status,200);assert.equal((await recovered.json()).state,'signed');
});
test('original pages survive stamping a slot that crosses a page boundary',async()=>{
  const pdf=await PDFDocument.create();pdf.addPage([210*72/25.4,297*72/25.4]);pdf.addPage([210*72/25.4,297*72/25.4]);
  const data=await stampPdf(await pdf.save(),signature,[{...slot,y:280},{...slot,page:1,y:-1}],{sessionId:'test',signedAt:new Date(clock).toISOString()});const out=await PDFDocument.load(data);assert.equal(out.getPageCount(),2);
  assert.throws(()=>placements([{...slot,x:200}]),/서명 위치/);
});
test('retention cleanup removes only expired session objects',async()=>{
  const f=await fixture(),entry=await f.create(),start=clock;clock+=31*86400000;await cleanup(f.env);assert.equal(f.objects.size,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM qr_sessions').get().n,0);clock=start;
});
test('D1-only storage supports a full signing flow and exact multi-chunk bytes without R2',async()=>{
  const f=await fixture();delete f.env.FILES;
  const files=fileStore(f.env.DB),payload=crypto.getRandomValues(new Uint8Array(60000)),large=new Uint8Array(800000);for(let at=0;at<large.length;at+=payload.length)large.set(payload.subarray(0,Math.min(payload.length,large.length-at)),at);
  await files.put('qa-file',large);assert.deepEqual(new Uint8Array(await(await files.get('qa-file')).arrayBuffer()),large);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM qr_file_parts').get().n,4);
  await files.put('qa-file','replacement');assert.equal(new TextDecoder().decode(await(await files.get('qa-file')).arrayBuffer()),'replacement');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM qr_file_parts').get().n,1);await files.delete('qa-file');
  const entry=await f.create();assert.equal(entry.response.status,201);assert.equal((await f.sign(entry)).status,200);const final=await f.request(f.guestPath(entry,'download'),f.guestToken(entry));assert.equal(final.status,200);assert.equal((await PDFDocument.load(await final.arrayBuffer())).getPageCount(),1);
  const start=clock;clock+=31*86400000;await cleanup(f.env);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM qr_file_parts').get().n,0);clock=start;
});
