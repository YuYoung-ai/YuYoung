import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../inspection.html',import.meta.url),'utf8');
for(const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
const fn=source.slice(source.indexOf('function inspectionPdfFilename('),source.indexOf('// generatePDF(false|true)'));
const fields={hospital:'오가나셀피부과_동대문',inspectDate:'2026-10-13',receiveDate:'2026-10-01',csName:'담당자 이름'};
const state={types:new Set(['A/S'])};
const context=vm.createContext({state,v:id=>fields[id]||'',today:'2026-10-14'});
vm.runInContext(fn,context);
assert.equal(context.inspectionPdfFilename(),'AS_오가나셀피부과_동대문_2026-10-13.pdf');
for(const [type,prefix] of [['장비 점검','장비점검'],['장비 교체','장비교체'],['장비 업그레이드','장비업그레이드']]){
  state.types=new Set([type]);
  assert.equal(context.inspectionPdfFilename(),prefix+'_오가나셀피부과_동대문_2026-10-13.pdf');
}
state.types=new Set(['장비 점검','A/S']);
assert.equal(context.inspectionPdfFilename(),'AS+장비점검_오가나셀피부과_동대문_2026-10-13.pdf');
state.types=new Set();
assert.equal(context.inspectionPdfFilename(),'점검_오가나셀피부과_동대문_2026-10-13.pdf');
state.types=new Set(['A/S']);
fields.hospital='병원/이름:*?<>|"\\';fields.inspectDate='';
assert.equal(context.inspectionPdfFilename(),'AS_병원이름_2026-10-14.pdf');
assert.ok(!context.inspectionPdfFilename().includes(fields.csName));
assert.match(source,/filename=inspectionPdfFilename\(\)/);
assert.match(source,/_lastFname=filename;/);
console.log('PASS: requested filename, inspection date, all types, multiple types, empty type/date and safe hospital name');
