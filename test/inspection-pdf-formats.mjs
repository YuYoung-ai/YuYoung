import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../inspection.html',import.meta.url),'utf8');
for(const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
const build=source.slice(source.indexOf('function buildSheetHTML('),source.indexOf('// ===== PDF 생성 헬퍼'));
const validation=source.slice(source.indexOf('function validate(opts)'),source.indexOf('// ===== 폼 데이터 직렬화'));
const collect=source.slice(source.indexOf('function collectFormData('),source.indexOf('function applyFormData('));
const basic={receiveDate:'2026-10-13',serialNo:'TEST-0001',hospital:'검증 병원',
  receiver:'영업 테스트',inspectDate:'2026-10-13',nextDate:'2026-11-15',
  csName:'CS 테스트',hospitalName:'병원 테스트',actionDetail:'조치 내역',recommend:'권고 내역',replacedPart:'교환 부품',cost:'1000'};
let signatureReads=0,emptySignature=false;
const context=vm.createContext({
  INSP_ITEMS:[{n:1,name:'점검 항목',desc:'점검 상세'}],
  BASIC_IDS:Object.keys(basic),state:{pay:'무상',types:new Set(['A/S']),results:{1:'정상'},memos:{1:'정상 확인'},photos:[]},
  sigStore:{cs:'cs-signature',hs:'hs-signature'},
  handoverReference:null,uploadedPdfDocument:null,
  v:id=>basic[id]||'',esc:x=>String(x).replace(/</g,'&lt;'),fmtDate:x=>x,
  asItemText:()=>'',asItemCode:()=>'',logoHeaderHTML:()=>'',pdfFormat:()=> 'simplified',
  csSig:{dataURL:()=>{signatureReads++;return 'data:cs-signature';},isEmpty:()=>emptySignature},
  hsSig:{dataURL:()=>{signatureReads++;return 'data:hs-signature';}},
  clearAllInvalid(){},showToast(){},markInvalid(){},revealField(){},
  document:{getElementById:()=>({classList:{add(){}},scrollIntoView(){}})}
});
vm.runInContext(build+'\n'+validation+'\n'+collect,context);

const standard=context.buildSheetHTML({docNo:'TEST-DOC'});
assert.match(standard,/영업 담당자:/);
assert.doesNotMatch(standard,/접수처:/);
for(const value of ['희망 점검','CS 담당자','병원 담당자',basic.nextDate,basic.csName,basic.hospitalName,'data:cs-signature','data:hs-signature'])assert.ok(standard.includes(value));
assert.equal(signatureReads,2);

signatureReads=0;
const simplified=context.buildSheetHTML({simplified:true,docNo:'TEST-DOC'});
for(const value of ['희망 점검','CS 담당자','병원 담당자',basic.nextDate,basic.csName,basic.hospitalName,'data:cs-signature','data:hs-signature'])assert.ok(!simplified.includes(value),value+' must be excluded');
for(const value of ['TEST-DOC','영업 담당자:',basic.receiver,basic.hospital,basic.actionDetail,basic.recommend,basic.inspectDate,basic.replacedPart,'1000원'])assert.ok(simplified.includes(value),value+' must be retained');
assert.equal(signatureReads,0,'simplified PDF must not read signature images');
const blank=context.buildSheetHTML({blank:true,simplified:true});
assert.ok(blank.includes('수기 작성용'));
assert.ok(!blank.includes('희망 점검') && !blank.includes(basic.hospital));

basic.csName='';emptySignature=true;
assert.equal(context.validate({simplified:true}),true);
assert.equal(context.validate({simplified:false}),false);
basic.csName='CS 테스트';
assert.equal(context.validate({simplified:false}),false);
emptySignature=false;
assert.equal(context.validate({simplified:false}),true);
basic.hospital='';
assert.equal(context.validate({simplified:true}),false,'simplified PDF still requires the hospital');
assert.equal(context.collectFormData().pdfFormat,'simplified','saved tasks retain the selected PDF format');
console.log('PASS: script syntax, both PDF formats, omitted personal fields/signatures, retained work details, blank form, validation and saved format');
