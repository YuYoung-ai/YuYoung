const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const fields = require('../js/baz-work-fields.js');
const hospitals = Array.from({length: 2500}, (_, i) => ({key: 'h'+i, name: '병원 '+i, region: '서울', sn: 'SN'+i}));
hospitals.push({...hospitals[0], key: 'duplicate', sn: 'OTHER'}, {...hospitals[1], origin: 'flow'});
const requests = Array.from({length: 1500}, (_, i) => ({id: String(i), hospitalKey: 'h'+i, hospitalName: '병원 '+i, region: '서울', sn: 'SN'+i, status: '접수', visitAt: '2026-10-19T10:00', symptom: '점검'}));
const lookup = fields.hospitalLookup(hospitals);
const cases = requests.concat([
 {hospitalKey: 'missing', hospitalName: '병원 0', region: '서울', sn: 'OTHER'},
 {hospitalKey: 'missing', hospitalName: '병원 0', region: '서울', sn: 'UNKNOWN'},
 {hospitalKey: 'missing', sn: 'SN2'}, {hospitalKey: 'missing', sn: ''},
 {hospitalKey: '병원 2\u001fOLD\u001f서울'},
 {hospitalName: '병원 2', region: '부산', sn: 'SN2'}
]);
for (const r of cases) assert.equal(fields.hospital(r, lookup), fields.hospital(r, hospitals));
const query = {filter: 'all', view: 'all', advanced: {status: [], asType: [], sales: []}, search: '병원', today: '2026-10-19', month: '2026-10'};
const start = performance.now();
const before = fields.counts(requests, query, hospitals);
const originalMs = performance.now()-start;
const indexedStart = performance.now();
const after = fields.counts(requests, query, lookup);
const indexedMs = performance.now()-indexedStart;
assert.deepEqual(after, before);
console.log(JSON.stringify({requests: requests.length, hospitals: hospitals.length, originalMs, indexedMs}));
// Exercise the actual input handlers with deterministic timers and Korean IME events.
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/baz-work-manager.js'), 'utf8');
const begin = source.indexOf('  function scheduleListSearch('), end = source.indexOf("$('sort').onchange", begin);
assert.ok(begin>0 && end>begin);
const handlers = {}, input = {addEventListener(name, fn){handlers[name]=fn;}}, timers = new Map();
let sequence=0, renders=0;
const state = {page: 4}, selected = new Set(['one']);
const context = {state, checkedRequests: selected, $: () => input, clearTimeout: id => timers.delete(id), setTimeout: fn => {timers.set(++sequence, fn);return sequence;}, renderList: searchOnly => {assert.equal(searchOnly,true);renders++;}};
vm.runInNewContext('var listSearchTimer=null,listSearchComposing=false;\n'+source.slice(begin,end),context);
handlers.compositionstart();input.oninput({isComposing:true});assert.equal(timers.size,0);
handlers.compositionend();input.oninput({isComposing:false});input.oninput({isComposing:false});
assert.equal(timers.size,1);assert.equal(renders,0);
const pending = [...timers.values()][0];timers.clear();pending();
assert.equal(renders,1);assert.equal(state.page,1);assert.equal(selected.size,0);
input.oninput({isComposing:false});handlers.compositionstart();assert.equal(timers.size,0);
console.log('Indexed matching parity, counts, input coalescing, IME suppression and selection/page reset passed.');
