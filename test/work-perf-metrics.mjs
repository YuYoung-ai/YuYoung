import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
let clock=0;const window={};
vm.runInNewContext(fs.readFileSync(new URL('../js/baz-perf.js',import.meta.url),'utf8'),{window,performance:{now:()=>clock,getEntriesByType:()=>[{domContentLoadedEventEnd:37}]},document:{readyState:'complete'},setTimeout:fn=>fn(),Number,Set});
assert.equal(window.BazPerf.samples()[0].ms,37);
for(let i=0;i<220;i++){const done=window.BazPerf.start('work_sync');clock++;done({count:3,googleMs:12,body:'private clinical text',token:'secret',hospitalName:'private'});}
const rows=window.BazPerf.samples();assert.equal(rows.length,200);assert.deepEqual(Object.keys(rows[0]),['name','ms','count','googleMs']);
rows[0].ms=123456;assert.equal(window.BazPerf.samples()[0].ms,1,'callers cannot alter stored measurements');
window.BazPerf.start('private patient name')({count:4});assert.equal(window.BazPerf.samples().length,200);
const summary=window.BazPerf.report()[0];assert.equal(summary.mean,1);assert.equal(summary.p95,1);
console.log('work-perf-metrics: bounded local numeric samples, private-field exclusion, immutable copies and summary passed.');
