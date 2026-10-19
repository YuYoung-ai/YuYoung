import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../js/baz-inspection-workflow.js',import.meta.url),'utf8');
async function restored(receiver,requestSales){
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,textContent:'',replaceChildren(){},appendChild(){},addEventListener(){}});return nodes.get(id);};
 const existing={id:'task',updatedAt:1,data:{handover:{recordId:'report',requestId:'req'},basic:{receiver},photos:['photo'],signatures:{cs:'signature'}}};let saved='';
 const c={location:{search:'?request=req&record=report'},BazAuth:{name:()=> 'tester'},_currentTaskId:null,handoverReference:null,uploadedPdfDocument:null,loadTasks:()=>[existing],
  openTask:()=>{node('receiver').value=receiver||'DB 담당';return true;},fillInspectionSales:sales=>{if(!node('receiver').value)node('receiver').value=sales||'DB 담당';},saveCurrentTask:()=>{saved=node('receiver').value;return true;},
  document:{readyState:'complete',getElementById:node,querySelector:()=>node('wrap'),createElement:()=>({})},
  window:{BazWorkFlow:{route:()=>({requestId:'req',recordId:'report'}),url:()=> 'hospital-work.html'},BazWorkAPI:{get:async()=>({success:true,request:{id:'req',sales:requestSales},source:{recordId:'report'}})}}};
 vm.createContext(c);vm.runInContext(source,c);for(let i=0;i<10;i++)await Promise.resolve();
 assert.deepEqual(existing.data.photos,['photo']);assert.deepEqual(existing.data.signatures,{cs:'signature'});return saved;
}
assert.equal(await restored('','접수 담당'),'접수 담당','blank restored task prefers receipt over DB autofill');
assert.equal(await restored('수동 담당','접수 담당'),'수동 담당','existing explicit value is preserved');
assert.equal(await restored('',''),'DB 담당','DB fallback survives when receipt has no salesperson');
console.log('inspection-sales-workflow: receipt/DB backfill on restored task and manual/photo/signature preservation passed.');
