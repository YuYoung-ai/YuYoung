const sources = ['sales', 'hospital', 'cs', 'other', 'unclassified'];
const impacts = ['schedule', 'extra_visit', 'after_hours', 'cost'];
const dayMs = 86_400_000;
const pageSize = 25;
const key = (...parts: Deno.KvKeyPart[]): Deno.KvKey => ['hospitalwork-v2', 'fieldMemo', ...parts];
const memoActions = new Set(['work_memo_counts', 'work_memo_summary', 'work_memo_list', 'work_memo_save', 'work_memo_archive']);

export function isWorkMemoAction(action: string) {
  return memoActions.has(action);
}

type Actor = { uid?: string; name: string; level: number };
type Input = Record<string, unknown>;
type Hospital = { hospitalId: string; hospitalName: string; region: string; group: string };
type Summary = Hospital & { id: string; occurredAt: number; source: string; impacts: string[] | null };
type Memo = Summary & {
  requestId: string;
  body: string;
  author: string;
  authorUid: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string;
};

function value(input: unknown, limit: number) {
  if (input == null) return '';
  if (typeof input !== 'string' || input.length > limit) throw new Error('입력값을 확인하세요.');
  return input.trim();
}

function hospitalGroup(name: string, region: string) {
  return JSON.stringify([name, region].map(s => s.normalize('NFKC').replace(/[\s_]+/g, '').toLowerCase()));
}

function localDate(input: unknown, clock = false) {
  const s = value(input, 16);
  const format = clock ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/;
  const ts = Date.parse(s + (clock ? ':00+09:00' : 'T00:00:00+09:00'));
  if (!format.test(s) || !Number.isFinite(ts) ||
    new Date(ts + 9 * 3_600_000).toISOString().slice(0, clock ? 16 : 10) !== s) {
    throw new Error('날짜와 시간을 확인하세요.');
  }
  return ts;
}

function filters(p: Input) {
  const source = value(p.source, 20), impact = value(p.impact, 20);
  if (source && !sources.includes(source)) throw new Error('요청 출처를 확인하세요.');
  if (impact && ![...impacts, 'none', 'unset'].includes(impact)) throw new Error('업무 영향을 확인하세요.');
  if (p.groups != null && (!Array.isArray(p.groups) || p.groups.length > 100)) throw new Error('병원 선택을 확인하세요.');
  const groups = new Set(((p.groups || []) as unknown[]).map(group => value(group, 800)));
  return (row: Summary) => (!groups.size || groups.has(row.group)) &&
    (!source || row.source === source) &&
    (!impact || (impact === 'none' ? row.impacts?.length === 0 : impact === 'unset' ? row.impacts === null : row.impacts?.includes(impact)));
}

function dateKey(row: Summary) {
  return key('date', row.occurredAt, row.id);
}

function requestKey(row: Memo) {
  return key('request', row.requestId, row.occurredAt, row.id);
}

export function createWorkMemos(kv: Deno.Kv) {
  async function resolveHospital(requestId: string, hospitalKey: string) {
    const entry = requestId
      ? await kv.get<Record<string, string>>(['hospitalwork-v2', 'request', requestId])
      : await kv.get<Record<string, string>>(['hospitalwork-v2', 'hospitalRef', hospitalKey]);
    const row = entry.value;
    if (!row || row.deletedAt || row.purgedAt || (!requestId && row.origin === 'flow')) {
      throw new Error('접수 또는 병원정보를 다시 선택하세요.');
    }
    const hospitalId = requestId ? row.hospitalId : row.id;
    const hospitalName = requestId ? row.hospitalName : row.name;
    const region = row.region || '';
    if (!hospitalId || !hospitalName) throw new Error('접수의 병원정보를 확인할 수 없습니다.');
    return { entry, hospital: { hospitalId, hospitalName, region, group: hospitalGroup(hospitalName, region) } };
  }

  const canEdit = (row: Memo, who: Actor) => row.authorUid === who.uid || who.level >= 3;
  function publicMemo(row: Memo, who: Actor) {
    const { authorUid, ...record } = row;
    return { ...record, canEdit: canEdit(row, who) };
  }

  async function write(p: Input, who: Actor) {
    const id = value(p.id, 36), operationId = value(p.operationId, 36);
    const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
    if (!uuid.test(id) || !uuid.test(operationId)) throw new Error('저장 식별자를 확인하세요.');
    const archive = p.action === 'work_memo_archive';
    const baseRevision = p.baseRevision ?? 0;
    if (!Number.isSafeInteger(baseRevision) || Number(baseRevision) < 0) throw new Error('기록 버전을 확인하세요.');
    const requestId = value(p.requestId, 180), hospitalKey = value(p.hospitalKey, 500);
    const body = archive ? '' : value(p.body, 2_000);
    const source = archive ? 'unclassified' : value(p.source, 20) || 'unclassified';
    if ((!body && !archive) || !sources.includes(source)) throw new Error('메모 내용과 요청 출처를 확인하세요.');
    if (!archive && p.impacts != null && (!Array.isArray(p.impacts) || p.impacts.some(x => !impacts.includes(x)))) {
      throw new Error('업무 영향을 확인하세요.');
    }
    const selected = archive || p.impacts == null ? null : [...new Set(p.impacts as string[])].sort();
    const occurredAt = archive ? 0 : localDate(p.occurredAt, true);
    const payload = JSON.stringify([archive, baseRevision, requestId, hospitalKey, body, source, selected, occurredAt]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
    const signature = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
    const operationKey = key('operation', id, operationId);

    for (let attempt = 0; attempt < 3; attempt++) {
      const [previous, entry] = await Promise.all([
        kv.get<{ uid: string; signature: string }>(operationKey),
        kv.get<Memo>(key('record', id)),
      ]);
      const old = entry.value;
      if (previous.value) {
        if (previous.value.uid !== who.uid || previous.value.signature !== signature) throw new Error('이미 사용된 저장 식별자입니다.');
        return { success: true, memo: old && publicMemo(old, who) };
      }
      if (old && !canEdit(old, who)) throw new Error('이 메모를 수정할 권한이 없습니다.');
      if (old ? old.revision !== baseRevision || old.archivedAt : archive || baseRevision !== 0) {
        return { success: false, conflict: true, current: old && publicMemo(old, who), error: '최신 메모를 확인한 뒤 다시 수정하세요.' };
      }

      const resolved = old ? null : await resolveHospital(requestId, hospitalKey);
      const now = new Date().toISOString();
      const memo: Memo = {
        ...(old ?? { ...resolved!.hospital, id, requestId, author: who.name, authorUid: who.uid!, createdAt: now, body, source, impacts: selected, occurredAt }),
        ...(archive ? {} : { body, source, impacts: selected, occurredAt }),
        revision: Number(baseRevision) + 1, updatedAt: now, archivedAt: archive ? now : '',
      };
      const tx = kv.atomic().check(entry, previous);
      if (resolved) tx.check(resolved.entry);
      if (memo.requestId && (!old || archive)) {
        const count = await kv.get<number>(key('count', memo.requestId));
        const nextCount = Math.max(0, (count.value || 0) + (archive ? -1 : 1));
        tx.check(count).set(count.key, nextCount);
      }
      if (old) {
        tx.set(key('history', id, old.revision), { old, changedBy: who.name, changedUid: who.uid, changedAt: now });
        if (archive || old.occurredAt !== memo.occurredAt) {
          tx.delete(dateKey(old));
          if (old.requestId) tx.delete(requestKey(old));
        }
      }
      if (!archive) {
        const { hospitalId, hospitalName, region, group } = memo;
        const summary: Summary = { id, hospitalId, hospitalName, region, group, occurredAt, source, impacts: selected };
        tx.set(dateKey(memo), summary);
        if (memo.requestId) tx.set(requestKey(memo), id);
      }
      const result = await tx.set(key('record', id), memo)
        .set(operationKey, { uid: who.uid, signature })
        .set(key('revision'), crypto.randomUUID()).commit();
      if (result.ok) return { success: true, memo: publicMemo(memo, who) };
    }
    return { success: false, retrySameOperation: true, error: '저장 결과를 다시 확인하세요.' };
  }

  async function counts(input: unknown) {
    if (!Array.isArray(input) || input.length > 50) throw new Error('접수 목록을 확인하세요.');
    const ids = [...new Set(input.map(x => value(x, 180)))];
    const result: [string, number][] = [];
    for (let i = 0; i < ids.length; i += 10) {
      const batch = await kv.getMany<number[]>(ids.slice(i, i + 10).map(id => key('count', id)));
      for (const { key, value } of batch) result.push([String(key[3]), value || 0]);
    }
    return { success: true, counts: Object.fromEntries(result) };
  }

  async function read(p: Input, who: Actor) {
    const revision = (await kv.get<string>(key('revision'))).value || '0';
    const updatedAt = new Date().toISOString();
    const summaryOnly = p.action === 'work_memo_summary';
    if (summaryOnly && p.revision === revision) return { success: true, revision, updatedAt, nochange: true };
    const requestId = summaryOnly ? '' : value(p.requestId, 180);
    const cursor = value(p.cursor, 1500);
    const matches = filters(p);
    let from = -Infinity, until = Infinity;
    let selector: Deno.KvListSelector;
    if (requestId) {
      selector = { prefix: key('request', requestId) };
    } else {
      from = localDate(p.from);
      until = localDate(p.to) + dayMs;
      if (from >= until) throw new Error('조회 기간을 확인하세요.');
      selector = { start: key('date', from), end: key('date', until) };
    }
    const iterator = kv.list<string | Summary>(selector, { reverse: true, ...(cursor && !summaryOnly ? { cursor } : {}) });
    const groups = new Map<string, { group: string; hospitalName: string; region: string; total: number; impacts: Record<string, number> }>();
    const ids: string[] = [];
    let pageCursor = '', nextCursor = '', total = 0;
    for await (const { value: row } of iterator) {
      if (typeof row !== 'string' && !matches(row)) continue;
      if (!summaryOnly) {
        if (ids.length === pageSize) {
          nextCursor = pageCursor;
          break;
        }
        ids.push(typeof row === 'string' ? row : row.id);
        if (ids.length === pageSize) pageCursor = iterator.cursor;
        continue;
      }
      if (typeof row === 'string') continue;
      let group = groups.get(row.group);
      if (!group) {
        group = { group: row.group, hospitalName: row.hospitalName, region: row.region, total: 0, impacts: {} };
        groups.set(row.group, group);
      }
      group.total++;
      total++;
      for (const impact of row.impacts === null ? ['unset'] : row.impacts.length ? row.impacts : ['none']) {
        group.impacts[impact] = (group.impacts[impact] || 0) + 1;
      }
    }
    if (summaryOnly) return { success: true, revision, updatedAt, total, groups: [...groups.values()] };
    const rows = await Promise.all(ids.map(id => kv.get<Memo>(key('record', id))));
    return { success: true, revision, updatedAt, cursor: nextCursor, memos: rows.flatMap(({ value: row }) =>
      row && !row.archivedAt && (requestId || (from <= row.occurredAt && row.occurredAt < until && matches(row))) ? [publicMemo(row, who)] : []) };
  }

  return async function handle(p: Input, who: Actor) {
    if (!who.uid) throw new Error('업무 계정으로 다시 로그인하세요.');
    switch (p.action) {
      case 'work_memo_save':
      case 'work_memo_archive': return await write(p, who);
      case 'work_memo_counts': return await counts(p.ids);
      case 'work_memo_summary':
      case 'work_memo_list': return await read(p, who);
      default: throw new Error('지원하지 않는 현장 기록 요청입니다.');
    }
  };
}
