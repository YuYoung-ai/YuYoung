// Local, in-memory QA only. No production accounts, records or services are used.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { deflateSync } from 'node:zlib';
import worker from '../src/worker.js';
const root=fileURLToPath(new URL('../../../',import.meta.url)),origin='http://127.0.0.1:8765',db=new DatabaseSync(':memory:');
for(const file of ['0001_sessions.sql','0002_temporary_files.sql'])db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
const env={AUTH_URL:'https://auth.preview.invalid',ALLOWED_ORIGINS:origin,CUSTOMER_PAGE:origin+'/customer-sign.html',RETENTION_DAYS:'30',DB:{prepare(query){return{bind(...input){const args=input.map(x=>x instanceof ArrayBuffer?new Uint8Array(x):x);return{async first(){return db.prepare(query).get(...args)||null;},async all(){return{results:db.prepare(query).all(...args)};},async run(){return db.prepare(query).run(...args);}};}};}}};
const realFetch=globalThis.fetch;globalThis.fetch=async(url,opts)=>url===env.AUTH_URL?Response.json({ok:JSON.parse(opts.body).token==='preview-only',level:1,name:'테스트 엔지니어'}):realFetch(url,opts);
function crc(b){let v=0xffffffff;for(const x of b){v^=x;for(let i=0;i<8;i++)v=(v>>>1)^((v&1)?0xedb88320:0);}return(v^0xffffffff)>>>0;}
const width=900,height=600,header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
const raw=Buffer.alloc((width*3+1)*height,255);for(let y=0;y<height;y++){raw[y*(width*3+1)]=0;for(let x=0;x<width;x++)if(y>150&&y<450&&Math.abs(y-280-Math.sin(x/45)*70)<4){const at=y*(width*3+1)+1+x*3;raw[at]=raw[at+1]=raw[at+2]=0;}}
function chunk(name,data){const t=Buffer.from(name),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);t.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([t,data])),data.length+8);return out;}
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]),signature='data:image/png;base64,'+png.toString('base64');
const task={id:'preview-task',createdAt:Date.now(),updatedAt:Date.now(),status:'draft',documentNo:'',hospital:'테스트 병원',engineer:'테스트 엔지니어',data:{basic:{hospital:'테스트 병원',serialNo:'QA-001',product:'BAZ 장비',receiveDate:'2026-10-22',inspectDate:'2026-10-22',csName:'테스트 엔지니어',actionDetail:'정기 점검을 완료했습니다. 케이블 연결 및 작동 상태 정상입니다.',recommend:'사용 후 세척 및 정기 점검을 권장합니다.',cost:'0'},pdfFormat:'standard',handover:null,pdfDocument:null,customerQr:null,pay:'무상',types:['장비 점검'],results:{1:'정상',2:'정상',3:'정상'},memos:{},photos:[],signatures:{cs:signature,hs:null},savedAt:Date.now()}};
const seed='<script>if(!localStorage.getItem("qa-qr-seed")){localStorage.setItem("inspection_tasks_v1",'+JSON.stringify(JSON.stringify([task]))+');localStorage.setItem("inspection_current_task_v1","preview-task");localStorage.setItem("qa-qr-seed","yes");}const qaFetch=window.fetch.bind(window);window.fetch=(url,opts)=>String(url).startsWith("http://127.0.0.1:8765")||!String(url).startsWith("http")?qaFetch(url,opts):Promise.resolve(new Response(JSON.stringify({success:true,data:[],hospitals:[],engineers:[],references:{},request:null}),{headers:{"Content-Type":"application/json"}}));</script>';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,origin);
  if(url.pathname.startsWith('/qr/')){const chunks=[];for await(const c of req)chunks.push(c);const response=await worker.fetch(new Request(origin+url.pathname.slice(3),{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}),env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;}
  if(url.pathname==='/auth.js'){res.setHeader('Content-Type','text/javascript');res.end('window.BazAuth={token:()=>"preview-only",name:()=>"테스트 엔지니어",level:()=>1,require:()=>true};');return;}
  if(url.pathname==='/js/baz-inspection-qr-config.js'){res.setHeader('Content-Type','text/javascript');res.end('window.BazInspectionQrConfig={api:"'+origin+'/qr",defaultMinutes:30};');return;}
  if(url.pathname==='/sw.js'){res.setHeader('Content-Type','text/javascript');res.end('self.addEventListener("install",()=>self.skipWaiting());');return;}
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/inspection.html':url.pathname));if(!file.startsWith(root))throw Error('path');let data=readFileSync(file);if(url.pathname==='/inspection.html')data=Buffer.from(data.toString().replace('<head>','<head>'+seed));res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(data);
}catch(e){res.writeHead(500,{'Content-Type':'text/plain'});res.end(e.message);}}).listen(8765,'127.0.0.1',()=>console.log('In-memory QR QA: '+origin+'/inspection.html'));
