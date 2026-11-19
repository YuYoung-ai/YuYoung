import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const handlers = {};
const notices = [];
const seen = new Map();
const self = {
  addEventListener: (name, handler) => { handlers[name] = handler; },
  registration: {
    scope: 'https://example.test/as-app/',
    showNotification: async (title, options) => notices.push({ title, ...options })
  }
};
const caches = {
  open: async () => ({
    match: async key => seen.get(key),
    put: async (key, value) => seen.set(key, value),
    keys: async () => [...seen.keys()]
  })
};
vm.runInNewContext(fs.readFileSync(new URL('../as-app/sw.js', import.meta.url), 'utf8'), {self, caches, URL, Response});

async function push(eventId, updates = {}) {
  let work;
  handlers.push({
    data: { json: () => ({ requestId: 'request_123', eventId, kind: 'scheduled', policy: 2, ...updates }) },
    waitUntil: task => { work = task; }
  });
  await work;
}

const visitAt = '2026-11-05T11:00';
await push('scheduled_123', { visitAt });
assert.equal(notices.at(-1).body, '2026-11-05 11:00 방문 예정입니다.');
assert.equal(notices.at(-1).data.requestId, 'request_123');
await push('scheduled_123', { visitAt });
assert.equal(notices.length, 1);

await push('legacy_123');
assert.equal(notices.at(-1).body, '방문 일정이 확정되었습니다.');
await push('invalid_123', { visitAt: '2026-11-05T29:00' });
assert.equal(notices.at(-1).body, '방문 일정이 확정되었습니다.');

await push('rescheduled_123', { kind: 'rescheduled', visitAt });
assert.equal(notices.at(-1).body, '방문 일정이 변경되었습니다.');
