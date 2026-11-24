import assert from 'node:assert/strict';
import { createWorkStore } from '../deno-auth/work-store.ts';

const kv = await Deno.openKv(':memory:');
try {
  const store = createWorkStore(kv);
  const alice = {uid:'cs-a', name:'CS 담당자', level:1};
  const bob = {uid:'cs-b', name:'CS 담당자', level:1};
  const admin = {uid:'manager', name:'CS 책임자', level:3};
  const hospitals = [
    {id:'h1', key:'hospital-a-device-1', name:'가온의원', region:'서울'},
    {id:'h2', key:'hospital-a-device-2', name:'가온 의원', region:'서울'},
    {id:'h3', key:'hospital-b', name:'나래의원', region:'서울'},
  ];
  await store.bridge('seed',{hospitals,references:{minimumLevel:1}});
  await store.bridge('activate',{manifest:await store.manifest()});
  await kv.set(['hospitalwork-v2','request','r1'],{id:'r1',hospitalId:'h1',hospitalName:'가온의원',region:'서울'});
  await kv.set(['hospitalwork-v2','request','deleted'],{id:'deleted',hospitalId:'h1',hospitalName:'가온의원',deletedAt:'2026-12-01'});

  const create = (overrides={}) => ({
    action:'work_memo_save', id:crypto.randomUUID(), operationId:crypto.randomUUID(), requestId:'r1',
    body:'당일 방문 요청에 응해 이전 일정을 변경함.', occurredAt:'2026-11-30T23:59',
    source:'sales', impacts:['schedule','extra_visit'], ...overrides,
  });
  const november = {from:'2026-11-01', to:'2026-11-30'};
  const run = (p:Record<string, unknown>, who=alice) => store.handle(p,who);
  const read = (action:string, params={}) => run({action,...november,...params});
  const linked = create();
  const duplicate = await Promise.all([run(linked),run(linked)]);
  assert.deepEqual(duplicate[0], duplicate[1]);
  assert.equal(duplicate[0].memo.hospitalId,'h1');
  assert.equal('authorUid' in duplicate[0].memo,false);
  assert.equal((await run({...linked,body:'다른 본문'})).success,false);
  assert.equal((await run(linked,bob)).success,false);
  assert.equal((await run(create({requestId:'deleted'}))).success,false);
  assert.equal((await run(create({occurredAt:'2026-11-31T01:30'}))).success,false);
  assert.equal((await run(create(),{uid:'',name:alice.name,level:3})).success,false);
  assert.equal((await run(create(),{...alice,level:0})).success,false);
  assert.equal((await run(create({requestId:'',hospitalKey:hospitals[1].key,impacts:[]}))).success,true);
  assert.equal((await run(create({requestId:'',hospitalKey:hospitals[2].key,occurredAt:'2026-12-01T00:00'}))).success,true);

  const summary = await read('work_memo_summary',{source:'sales'});
  assert.equal(summary.total,2);
  assert.equal(summary.groups.length,1,'multiple devices at the same hospital belong to one row');
  assert.deepEqual(summary.groups[0].impacts,{extra_visit:1,schedule:1,none:1});
  assert.equal('body' in summary.groups[0],false);
  const group = summary.groups[0].group;
  const details = await read('work_memo_list',{groups:[group],source:'sales',impact:'schedule'});
  assert.deepEqual(details.memos.map((memo:{id:string})=>memo.id),[linked.id]);
  assert.equal((await read('work_memo_summary',{revision:summary.revision})).nochange,true);
  assert.equal((await read('work_memo_counts',{ids:['r1','other']})).counts.r1,1);
  assert.equal((await read('work_memo_list',{requestId:'r1'})).memos.length,1);

  const edit = {...linked, baseRevision:1, operationId:crypto.randomUUID(), body:'조치 추가', occurredAt:'2026-12-01T01:00'};
  assert.equal((await run(edit,bob)).success,false,'the UID, not the display name, owns the memo');
  assert.equal((await run(edit,admin)).memo.revision,2);
  assert.equal((await run({...edit,operationId:crypto.randomUUID()})).conflict,true);
  assert.equal((await run(linked)).memo.revision,2,'a replay must not overwrite an edit');
  assert.equal((await read('work_memo_summary',{revision:summary.revision})).total,1);
  assert.equal((await read('work_memo_counts',{ids:['r1']})).counts.r1,1);
  const archive = {action:'work_memo_archive',id:linked.id,baseRevision:2,operationId:crypto.randomUUID()};
  assert.equal((await run(archive)).success,true);
  assert.equal((await run(archive)).success,true);
  assert.equal((await read('work_memo_counts',{ids:['r1']})).counts.r1,0);
  assert.equal((await read('work_memo_list',{requestId:'r1'})).memos.length,0);
  assert.equal((await kv.get(['hospitalwork-v2','fieldMemo','history',linked.id,2])).value !== null,true);

  for (let index=0; index<26; index++) assert.equal((await run(create())).success,true);
  const first = await read('work_memo_list',{requestId:'r1'});
  const second = await read('work_memo_list',{requestId:'r1',cursor:first.cursor});
  assert.equal(first.memos.length,25);
  assert.equal(second.memos.length,1);
  assert.equal(second.cursor,'');
  assert.equal(new Set([...first.memos,...second.memos].map(memo=>memo.id)).size,26);
  console.log('field memos: Deno KV ACL, idempotency, Korea date boundaries, hospital grouping, filters, revisions, archive and pagination passed.');
} finally {
  kv.close();
}
