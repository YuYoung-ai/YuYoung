import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const scope={crypto,TextEncoder,Uint8Array,URLSearchParams,atob};vm.runInNewContext(fs.readFileSync(new URL('../js/baz-inspection-session.js',import.meta.url),'utf8'),scope);const S=scope.BazInspectionSession;
const map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)},auth={name:()=> 'synthetic-owner',token:()=> 'synthetic'};
const payload=n=>({source:'handover',form:{basic:{hospital:n,inspectDate:'2026-11-19'},handover:{recordId:'record_'+n}}});
const b=S.write(storage,auth,payload('B_hospital')),c=S.write(storage,auth,payload('C_hospital'));
assert.notEqual(b,c);assert.equal(b.includes('hospital'),false,'URL contains only an opaque entry nonce');
assert.equal(S.read(storage,auth,S.intent(b.split('?')[1])).form.basic.hospital,'B_hospital');assert.equal(S.read(storage,auth,S.intent(c.split('?')[1])).form.basic.hospital,'C_hospital');
assert.throws(()=>S.read(storage,{...auth,name:()=> 'other'},S.intent(b.split('?')[1])),/계정/);
const target=S.intent(b.split('?')[1]),key='insp_entry_v2:'+target.entry,old=JSON.parse(storage.getItem(key));storage.setItem(key,JSON.stringify({...old,createdAt:Date.now()-11*60*1000}));assert.throws(()=>S.read(storage,auth,target),/유효 시간/);storage.setItem(key,JSON.stringify(old));
const entry=S.read(storage,auth,target);storage.setItem(key,'a newer payload');entry.ack();assert.equal(storage.getItem(key),'a newer payload','ack never deletes a replacement');
storage.setItem('insp_prefill_v1',JSON.stringify({...payload('legacy_B'),v:1,createdAt:Date.now()}));assert.equal(S.read(storage,auth,S.intent('?prefill=1')).form.basic.hospital,'legacy_B');assert.throws(()=>S.read(storage,auth,S.intent('?entry=broken')),/주소/);
const view=S.view(),epoch=view.capture();view.bump();assert.equal(view.matches(epoch),false);const frozen=S.freeze({basic:{hospital:'B'},photos:[{data:'bytes'}]});assert.throws(()=>frozen.basic.hospital='A',TypeError);
// Independently execute the existing server's basis algorithm. No API or writes.
const server={Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,value)=>Array.from(createHash('sha256').update(value).digest())}};vm.runInNewContext(fs.readFileSync(new URL('../handover_inspection_pdf_gas.gs',import.meta.url),'utf8'),server);
const source={recordId:'record_B123',hospitalName:'Synthetic B',date:'2026-11-19',sn:'SN_B',engineer:'synthetic',gubun:'점검',detail:'before\r\nafter',cost:0};
for(const format of ['standard','simplified']){const actual=await S.basis(source,format),expected=server.inspectionPdfBasis_(source,format);assert.equal(actual.fingerprint,expected.fingerprint);assert.deepEqual(JSON.parse(JSON.stringify(actual.fields)),JSON.parse(JSON.stringify(expected.fields)));}
console.log('PASS: isolated entry nonces, owner/TTL/legacy guards, safe ack, immutable snapshot, view epoch, exact server-compatible source fingerprints');
