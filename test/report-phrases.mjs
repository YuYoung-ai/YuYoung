import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const src=fs.readFileSync(new URL('../handover_gas.gs',import.meta.url),'utf8');
const db={};let level=3,locked=false;
const ctx=vm.createContext({Date,JSON,Object,String,Number,verifyLevel_:()=>level,
 Utilities:{DigestAlgorithm:{SHA_256:0},Charset:{UTF_8:0},computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()]},
 PropertiesService:{getScriptProperties:()=>({getProperties:()=>({...db}),getProperty:k=>db[k],setProperty:(k,v)=>{db[k]=v;}})},
 LockService:{getScriptLock:()=>({tryLock:()=>!locked,releaseLock:()=>{}})}
});
vm.runInContext(src.slice(src.indexOf('function reportPhraseKey_')),ctx);
const save=p=>ctx.reportPhraseSave_({token:'test',name:'노즐 체결 약함',text:'사용 중 노즐이 느슨해지는 현상',revision:0,...p});
assert.equal(save().success,true);
assert.equal(ctx.reportPhrasesGet_({token:'test'}).items.length,1);
assert.equal(save().success,false,'stale revision is rejected');
assert.equal(save({name:'노즐체결약함',revision:1,text:'수정된 설명'}).item.revision,2,'normalized aliases share one record');
assert.equal(save({name:'새 증상',text:'x'.repeat(91)}).success,false);
assert.equal(save({name:'새 증상',text:'a\nb'}).success,false);
level=2;assert.equal(save({name:'새 증상'}).success,false);assert.equal(ctx.reportPhrasesGet_({token:'test'}).success,false);
level=3;locked=true;assert.equal(save({name:'새 증상'}).success,false);
assert(src.includes("if(actName==='report_phrase_save') return json_(reportPhraseSave_(payload));"));
console.log('PASS reusable description persistence, normalized keys, auth, conflicts, input validation and locking');
