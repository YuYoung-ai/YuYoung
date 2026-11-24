import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

const [baseline, candidate] = process.argv.slice(2);
if (!baseline || !candidate || resolve(baseline) === resolve(candidate)) {
  throw new Error('Usage: node cloudflare/work-memos/assemble-worker.mjs BASELINE.mjs CANDIDATE.mjs');
}
const [worker, memoModule] = await Promise.all([
  readFile(baseline, 'utf8'),
  readFile(new URL('../../deno-auth/work-memos.ts', import.meta.url), 'utf8'),
]);
let source = worker.replaceAll('\r\n', '\n');
if (source.includes('function createWorkMemos(')) throw new Error('Use a Worker baseline without the field memo extension.');

function insert(anchor, transform) {
  if (source.split(anchor).length !== 2) throw new Error('Expected exactly one Worker anchor: ' + anchor);
  source = source.replace(anchor, transform);
}

const module = stripTypeScriptTypes(memoModule.replace(/^export /gm, ''));
insert('function createWorkStore(kv, options = {}) {', anchor =>
  'const {createWorkMemos,isWorkMemoAction} = (() => {\n' + module +
  '\nreturn {createWorkMemos,isWorkMemoAction};\n})();\n' + anchor + '\n  const memos = createWorkMemos(kv);');
insert('        case "work_review_config":', anchor =>
  '        case "work_memo_save":\n        case "work_memo_archive":\n        case "work_memo_counts":\n' +
  '        case "work_memo_summary":\n        case "work_memo_list":\n          return await memos(p, who);\n' + anchor);
insert('    if (!WORK_READS.has(action) && !WORK_WRITES.has(action)', anchor =>
  anchor.replace('if (', 'if (!isWorkMemoAction(action) && '));
insert('        const body = await store.handle({ ...p, action }, { uid: verified.uid || "", name: verified.name || "", level: verified.level || 0, engineer });',
  anchor => anchor + '\n        if (body.success && (action === "work_bootstrap" || action === "work_sync")) body.fieldMemos = true;');
insert('    const write = WORK_WRITES.has(action), force = String(p.force || "") === "1";', anchor =>
  '    if (isWorkMemoAction(action)) return fail("현장 기록 서버를 사용할 수 없습니다. 잠시 후 다시 시도하세요.", 503);\n' + anchor);

await writeFile(candidate, source, { flag: 'wx' });
