const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const fields=require('../js/baz-work-fields.js');
function run(path){
 const source=fs.readFileSync(path,'utf8'),elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{value:'',dataset:{},hidden:false,innerHTML:'',textContent:'',classList:{toggle(){}},querySelectorAll:()=>[],setAttribute(){},addEventListener(){}});return elements.get(id);};
 element('sort').value='visit';element('sort-direction').value='desc';
 let formatterCount=0;
 const context={Intl:{DateTimeFormat:function(...args){formatterCount++;return new Intl.DateTimeFormat(...args);}},console,URL,Map,Set,clearTimeout,document:{getElementById:element,querySelectorAll:()=>[]},localStorage:{getItem:()=>null},window:{location:{search:''},BazAuth:{name:()=> 'tester',cachedLevel:()=>3},BazWorkFields:fields,BazWorkCache:{},BazWorkAPI:{}}};
 vm.createContext(context);
 vm.runInContext(source.slice(0,source.indexOf("  $('account').textContent=account;"))+`window.test={state,renderList,time,localNow,statusGroup,salesName};})();`,context);
 const t=context.window.test;
 for(const value of ['', 'invalid', '2026-10-19T10:00', '2026-10-19T01:00:00Z']){
   const expected=!value?'미정':/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)?value.replace('T',' '):Number.isNaN(new Date(value).getTime())?value:new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
   assert.equal(t.time(value),expected);
 }
 assert.match(t.localNow(),/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
 t.state.hospitals=Array.from({length:2500},(_,i)=>({key:'h'+i,name:'병원 '+i,region:'서울',sn:'SN'+i}));
 t.state.requests=Array.from({length:1500},(_,i)=>({id:String(i),hospitalKey:'h'+i,hospitalName:'병원 '+i,region:'서울',sn:'SN'+i,status:'접수',visitAt:'2026-10-19T10:00',deadline:'2026-10-20T10:00',symptom:'점검',cs:'tester',engineer:'',createdBy:'tester'}));
 formatterCount=0;const start=performance.now();t.renderList();const ms=performance.now()-start;
 const output=element('list').innerHTML;
 assert.match(output,/<th class="person-column">CS 접수<\/th><th class="person-column">영업 담당자<\/th>/);
 assert.match(output,/data-inspection-request="0"/);
 for(const status of ['접수','방문예정','처리중','결과확인','완료','보류','취소'])assert.ok(t.statusGroup({...t.state.requests[0],status}).includes('data-work-status="'+status+'"'));
 t.state.hospitals[0].asType='유상';t.state.hospitals[0].sales='DB 영업';
 assert.match(t.statusGroup(t.state.requests[0]),/data-service-type="유상"/);
 assert.match(t.statusGroup({...t.state.requests[0],serviceOverrides:{asType:'무상'}}),/data-service-type="무상"/);
 assert.equal(t.salesName(t.state.requests[0]),'DB 영업');assert.equal(t.salesName({...t.state.requests[0],sales:'접수 영업'}),'접수 영업');
 assert.equal((output.match(/<tr data-inline-form=/g)||[]).length,50);
 assert.equal((output.match(/<div class="mobile-card /g)||[]).length,50);
 // A DB snapshot replacement must rebuild the index and update both representations.
 t.state.hospitals=t.state.hospitals.map((h,i)=>i===0?{...h,name:'이름 수정'}:h);
 element('search').value='이름 수정';t.renderList();assert.match(element('list').innerHTML,/이름 수정/);
 assert.equal(formatterCount,0,'list renders reuse date/time formatters');
 return {ms,formatterCount,outputLength:output.length};
}
console.log('List rendering: '+JSON.stringify(run(require('node:path').join(__dirname,'../js/baz-work-manager.js'))));
