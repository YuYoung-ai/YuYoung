const assert=require('node:assert/strict'),fields=require('../js/baz-work-fields.js');
const advanced={status:[],engineer:[],year:[],month:[],quarter:[]};
const q={filter:'week',today:'2026-10-14',month:'2026-10',status:'',advanced,search:''};
const rows=[
 {id:'1',hospitalName:'병원 A',status:'완료',visitAt:'2026-10-14T12:00',engineer:'A'},
 {id:'2',hospitalName:'병원 A',status:'취소',visitAt:'2026-10-14T12:00',engineer:'A'},
 {id:'3',hospitalName:'병원 B',status:'접수',visitAt:'2026-10-12T12:00',engineer:'B'},
 {id:'4',hospitalName:'병원 B',status:'결과확인',visitAt:'2026-10-01T12:00',engineer:'B'},
 {id:'5',hospitalName:'병원 C',status:'완료',visitAt:'2026-10-01T12:00',engineer:'C'},
 {id:'6',hospitalName:'병원 A',status:'완료',visitAt:'2026-10-14T12:00',deletedAt:'now'},
 {id:'7',hospitalName:'병원 A',status:'결과확인',visitAt:'2026-10-14T12:00',purgedAt:'now'}
];
assert.deepEqual(fields.counts(rows,q,[]),{week:3,today:2,review:1,completed:1});
assert.equal(rows.filter(r=>fields.query(r,{...q,filter:'today'},[])).length,2,'today includes cancelled visits among all states');
assert.equal(fields.counts(rows,{...q,filter:'all'},[]).completed,2);
assert.equal(fields.counts(rows,{...q,filter:'all',search:'병원 A'},[]).completed,1);
assert.equal(fields.counts(rows,{...q,filter:'all',advanced:{...advanced,engineer:['B']}},[]).completed,0);
assert.equal(fields.counts(rows,{...q,status:'접수',advanced:{...advanced,status:['취소']}},[]).completed,1,'completed metric replaces status selection while retaining date scope');
assert.equal(fields.counts(rows,{...q,filter:'trash'},[]).completed,1,'trash count and click remain in the same scope');
assert.equal(fields.counts(rows,{...q,filter:'all',search:'병원 C'},[]).review,1,'review always uses all live records');
assert.deepEqual(rows.filter(r=>fields.query(r,{...q,status:'완료'},[])).map(r=>r.id),['1']);
console.log('work-metric-filters: this week all states, today all states, global review, context-sensitive completion, status replacement, period/search/assignee/trash and deletion fences passed.');
