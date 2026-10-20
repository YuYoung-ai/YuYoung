const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const groups=require('../js/baz-work-hospital-groups.js'),fields=require('../js/baz-work-fields.js');
const row=(id,name='가 의원',region='서울',sn='A')=>({id,hospitalName:name,region,sn,status:'완료',symptom:'점검 <확인>',visitAt:'2026-10-20T10:00',updatedAt:'2026-10-20',revision:1,cs:'CS',createdBy:'tester'});
const rows=[row('1'),row('2','가_의원','서울','B'),row('3','가 의원','부산'),row('4','가 의원 강남','서울')];
assert.deepEqual(groups.group(rows,r=>r).map(g=>g.rows.length),[2,1,1],'multiple devices group together but region and branch remain distinct');
assert.equal(groups.group([row('a','',''),row('b','','')],r=>r).length,2,'unknown hospitals never merge');
const ui=groups.create(),options={display:r=>r,sales:()=> '영업',time:v=>v,page:1};
let result=ui.render(rows,options);assert.equal(result.count,3);assert.equal(result.shown.length,2);assert.match(result.html,/점검 &lt;확인&gt;/);assert.doesNotMatch(result.html,/>유·무상</);assert.equal((result.html.match(/data-work-payment=/g)||[]).length,2);
ui.select(1);result=ui.render(rows,options);assert.equal(result.shown[0].id,'3');
result=ui.render([rows[0]],options);assert.equal(result.shown[0].id,'1','filtered-away selection falls back safely');
const many=Array.from({length:121},(_,i)=>row('r'+i));result=ui.render(many,{...options,page:1});assert.equal(result.pages,3);assert.equal(result.shown.length,50);result=ui.render(many,{...options,page:3});assert.equal(result.shown.length,21);
assert.equal(ui.render([],options).shown.length,0);

// Exercise the actual manager branch: one hospital's page is hydrated, other histories are not.
const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,{value:'',dataset:{},hidden:false,innerHTML:'',textContent:'',classList:{toggle(){}},querySelectorAll:()=>[],setAttribute(){},addEventListener(){}});return elements.get(id);};
el('sort').value='visit';el('sort-direction').value='desc';let hydrated=[];
const context={Intl,URL,Map,Set,console,clearTimeout,document:{getElementById:el,querySelectorAll:()=>[]},localStorage:{getItem:()=>null},window:{location:{search:''},BazAuth:{name:()=> 'tester',cachedLevel:()=>3},BazWorkFields:fields,BazWorkHospitalGroups:groups,BazWorkCache:{},BazWorkAPI:{},BazWorkInspections:{create:()=>({hydrate:(host,rows)=>{hydrated=rows;}})}}};
vm.createContext(context);const manager=fs.readFileSync(__dirname+'/../js/baz-work-manager.js','utf8');
vm.runInContext(manager.slice(0,manager.indexOf("  $('account').textContent=account;"))+`window.test={state,renderList,choose:()=>{workspaceView='hospital';state.filter='all';}};})();`,context);
const t=context.window.test;t.state.loaded=true;t.state.requests=rows;t.choose();t.renderList();assert.match(el('list').innerHTML,/hospital-timeline/);assert.equal(hydrated.length,2);assert.match(el('list-count').textContent,/3개 병원 · 4건/);
el('search').value='부산';t.renderList();assert.equal(hydrated.length,0); // Existing search covers hospital, symptoms and people, not region.
el('search').value='강남';t.renderList();assert.equal(hydrated[0].id,'4');
console.log('work-hospital-groups: identity, branches, unknowns, escaping, selection/filter changes, pagination and manager integration passed.');
