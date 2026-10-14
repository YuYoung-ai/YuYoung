const assert=require('node:assert/strict'),fields=require('../js/baz-work-fields.js');
const advanced={status:[],engineer:[],year:[],month:[],quarter:[]};
const q={filter:'week',today:'2026-10-14',month:'2026-10',statusScope:'all',advanced,search:''};
const rows=[
 {id:'1',hospitalName:'병원 A',status:'완료',visitAt:'2026-10-14T12:00',engineer:'A'},
 {id:'2',hospitalName:'병원 A',status:'취소',visitAt:'2026-10-14T12:00',engineer:'A'},
 {id:'3',hospitalName:'병원 B',status:'접수',visitAt:'2026-10-12T12:00',engineer:'B'},
 {id:'4',hospitalName:'병원 B',status:'결과확인',visitAt:'2026-10-01T12:00',engineer:'B'},
 {id:'5',hospitalName:'병원 C',status:'완료',visitAt:'2026-10-01T12:00',engineer:'C'},
 {id:'6',hospitalName:'병원 A',status:'완료',visitAt:'2026-10-14T12:00',deletedAt:'now'},
 {id:'7',hospitalName:'병원 A',status:'결과확인',visitAt:'2026-10-14T12:00',purgedAt:'now'},
 {id:'8',hospitalName:'병원 B',status:'보류',visitAt:'2026-10-12T12:00',engineer:'B'},
 {id:'9',hospitalName:'병원 C',status:'방문예정',visitAt:'2026-10-14T15:00',engineer:'C'},
 {id:'10',hospitalName:'병원 C',status:'처리중',visitAt:'2026-10-14T16:00',engineer:'C'}
];
assert.deepEqual(fields.counts(rows,q,[]),{total:6,active:3,review:0,completed:1,globalReview:1});
assert.deepEqual(fields.counts(rows,{...q,filter:'today'},[]),{total:4,active:2,review:0,completed:1,globalReview:1});
assert.deepEqual(fields.counts(rows,{...q,filter:'all'},[]),{total:8,active:3,review:1,completed:2,globalReview:1});
assert.deepEqual(fields.counts(rows,{...q,filter:'all',search:'병원 A'},[]),{total:2,active:0,review:0,completed:1,globalReview:1});
assert.deepEqual(fields.counts(rows,{...q,advanced:{...advanced,engineer:['B']}},[]),{total:2,active:1,review:0,completed:0,globalReview:1});
const list=query=>rows.filter(r=>fields.query(r,query,[])).map(r=>r.id);
assert.deepEqual(list({...q,statusScope:'active'}),['3','9','10'],'in progress excludes review, hold, cancellation and completion');
assert.deepEqual(list({...q,statusScope:'review'}),[]);
assert.deepEqual(list({...q,statusScope:'completed'}),['1']);
assert.deepEqual(list({...q,filter:'all',statusScope:'review'}),['4']);
for(const statusScope of ['all','active','review','completed'])assert.deepEqual(fields.counts(rows,{...q,statusScope},[]),fields.counts(rows,q,[]),'card selection changes the list, not the shared card scope');
assert.deepEqual(fields.counts(rows,{...q,advanced:{...advanced,status:['보류','취소']}},[]),fields.counts(rows,q,[]),'custom statuses are another list-only selection');
assert.deepEqual(list({...q,advanced:{...advanced,status:['보류','취소']}}),['2','8']);
assert.deepEqual(fields.counts(rows,{...q,filter:'trash'},[]),{total:1,active:0,review:0,completed:1,globalReview:1});
const renamed=[{key:'new',id:'new',name:'정정 병원',sn:'SN1'}],old={...rows[0],hospitalKey:'new',hospitalName:'이전 병원'};
assert.equal(fields.counts([old],{...q,search:'정정 병원'},renamed).completed,1,'DB display names and metrics use the same search');
const yearRows=[{status:'완료',visitAt:'2026-12-31T12:00'},{status:'접수',visitAt:'2027-01-03T12:00'},{status:'접수',visitAt:'2027-01-04T12:00'}];
assert.equal(fields.counts(yearRows,{...q,today:'2027-01-01',month:'2027-01'},[]).total,2,'Monday-Sunday week crosses a year boundary');
console.log('work-metric-filters: shared period/search/assignee scope, independent list-only status cards, exact in-progress states, custom hold/cancel, global review alert, trash, DB-name search and cross-year week passed.');
