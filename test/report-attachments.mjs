import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const ctx=vm.createContext({Uint8Array,DataView,TextEncoder});
vm.runInContext(fs.readFileSync(new URL('../js/baz-report-files.js',import.meta.url),'utf8'),ctx);
// Parse CFB independently of the writer and recover the standard Ole10Native payload.
function recover(bytes){
 const b=Buffer.from(bytes),u=p=>b.readUInt32LE(p),sectorSize=1<<b.readUInt16LE(30);
 assert.equal(b.subarray(0,8).toString('hex'),'d0cf11e0a1b11ae1');
 const fat=[];for(let i=0;i<u(44);i++){const start=(u(76+i*4)+1)*sectorSize;for(let p=start;p<start+sectorSize;p+=4)fat.push(u(p));}
 function chain(start){let n=start,parts=[],seen=new Set();while(n!==0xfffffffe){assert(!seen.has(n),'no FAT cycle');seen.add(n);assert(n<fat.length);parts.push(b.subarray((n+1)*sectorSize,(n+2)*sectorSize));n=fat[n];}return Buffer.concat(parts);}
 const dir=chain(u(48));let native;
 for(let p=0;p<dir.length;p+=128){if(dir[p+66]!==2)continue;const name=dir.subarray(p,p+dir.readUInt16LE(p+64)-2).toString('utf16le');if(name==='\x01Ole10Native')native=chain(dir.readUInt32LE(p+116));}
 assert(native);const bodySize=native.readUInt32LE(0);assert(bodySize+4<=native.length);let p=6;
 function cstring(){const end=native.indexOf(0,p);assert(end>=p);const s=native.subarray(p,end).toString();p=end+1;return s;}
 const name=cstring();cstring();p+=4;const pathLength=native.readUInt32LE(p);p+=4+pathLength;const size=native.readUInt32LE(p);p+=4;return {name,data:native.subarray(p,p+size)};
}
for(const n of [20,4096,65536,5*1024*1024]){
 const bytes=Buffer.alloc(n,65);bytes.write('%PDF-1.7');const result=recover(ctx.BazReportFiles.packageFile(bytes,'report.pdf'));
 assert.equal(result.name,'report.pdf');assert.deepEqual(result.data,bytes);
}
assert.throws(()=>ctx.BazReportFiles.packageFile(new Uint8Array(5*1024*1024+1),'too-big.pdf'));
console.log('PASS PDF payload round trips through CFB/Ole10Native, including FAT and size boundaries');
