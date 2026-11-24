import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

const [baselinePath, outputPath] = process.argv.slice(2);
if (!baselinePath || !outputPath) throw new Error('Usage: node assemble-user-access-worker.mjs BASELINE.mjs CANDIDATE.mjs');
const [baseline, auth, access] = await Promise.all([
  readFile(baselinePath, 'utf8'),
  readFile(new URL('./main.ts', import.meta.url), 'utf8'),
  readFile(new URL('./user-access.mjs', import.meta.url), 'utf8'),
]);
const lf = value => value.replaceAll('\r\n','\n');
let worker = lf(baseline);
const typescript = lf(auth);

function replace(anchor, content) {
  if (worker.split(anchor).length !== 2) throw new Error('Worker anchor must occur once: ' + anchor.slice(0,100));
  worker = worker.replace(anchor, () => content);
}

function segment(source, from, to) {
  if (source.split(from).length !== 2) throw new Error('Missing or ambiguous start: ' + from);
  const start = source.indexOf(from), end = source.indexOf(to,start+from.length);
  if (end < 0) throw new Error('Missing end: ' + to);
  return source.slice(start+1,end);
}

const moduleBoundary = '\nvar __defProp = Object.defineProperty;';
replace(moduleBoundary, moduleBoundary + '\n' + lf(access).replace(/^export /gm,''));
for (const [name, end] of [
  ['issueToken','\nasync function verifyToken('],
  ['verifyToken','\n/* ── Google OpenID Connect'],
  ['ensureGoogleUserSeed','\nasync function findAndBindGoogleUser('],
  ['findAndBindGoogleUser','\n/* ── 로그인 시도 제한'],
  ['requireAdmin','\n/* ── HTTP'],
  ['notificationAccounts','\nlet notificationInstance'],
]) {
  const source = segment(typescript, '\nasync function ' + name + '(',end);
  const compiled = segment(worker, '\n  async function ' + name + '(', '\n  __name(' + name + ',');
  const body = stripTypeScriptTypes(source.trimEnd()).split('\n').map(line => '  ' + line).join('\n');
  replace('\n'+compiled, '\n'+body);
}

for (const [from,to] of [
  ['google_login','login'],
  ['device_login','device_logout'],
  ['devices','audits'],
  ['user_save','device_revoke'],
]) {
  const action = (indent,name) => '\n' + ' '.repeat(indent) + 'if (action === "' + name + '")';
  const source = segment(typescript,action(2,from),action(2,to));
  const compiled = segment(worker,action(4,from),action(4,to));
  const wrapper = 'async function scope() {\n';
  const stripped = stripTypeScriptTypes(wrapper + source.trimEnd() + '\n}').slice(wrapper.length,-2);
  const body = stripped.split('\n').map(line => line ? '  ' + line : '').join('\n');
  replace('\n'+compiled, '\n'+body);
}

const actor = '    const a = matches[0];\n    await options.store.checkAccess(';
replace(actor, actor.replace('\n    await', "\n    if ((a.accessVersion || '') !== (who.accessVersion || '')) throw new Error('알림 설정을 위해 다시 로그인해 주세요.');\n    await"));
const subscription = '      const old = await get("subscription", id2), quota = await get("deviceRevision", a.uid), devices = await rows(["device", a.uid], 11);';
replace(subscription, "      const access = await kv.get(accountVersionKey(a.uid));\n      if ((access.value || '') !== (a.accessVersion || '')) throw new Error('알림 설정을 위해 다시 로그인해 주세요.');\n" + subscription);
const checkDevice = 'kv.atomic().check(old, quota).set(quota.key, Number(quota.value || 0) + 1)';
replace(checkDevice, checkDevice.replace('check(old, quota)','check(old, quota, access)'));

const getAction = '        const action = u.searchParams.get("action") || "ping";';
replace(getAction, getAction + '\n        if (action === "user_delete") return withCors(json({ok:false,error:"post_required"},405),req);');
const releaseMarker = worker.match(/(var release = [^\n]*\? ")[0-9a-f]{64}(" : "development")/);
if (!releaseMarker) throw new Error('Production release marker missing');
const release = createHash('sha256').update(worker).digest('hex');
replace(releaseMarker[0],releaseMarker[1]+release+releaseMarker[2]);
await writeFile(outputPath,worker);
console.log('Prepared BAZ CS security Worker candidate ' + release);
