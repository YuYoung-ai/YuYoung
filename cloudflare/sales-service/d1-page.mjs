// The packed D1 record is [type, [[field, packedValue], ...]]. Work dates
// use local YYYY-MM-DDTHH:mm. Blank and provisional appointments sort last.
const requestPrefix = ['hospitalwork-v2', 'request'];
const pageSize = 192;

export async function salesRangeVersion(kv, parts, {keyHex, prefixEnd}) {
  if (!kv.db) return null;
  const prefix = keyHex(parts);
  const row = await kv.db.prepare('SELECT count(*) AS count,max(version) AS latest FROM kv_entries WHERE k>? AND k<?')
    .bind(prefix,prefixEnd(prefix)).first();
  return `${row.count}:${row.latest || ''}`;
}

export async function salesRequestPage(kv, cursor, {keyHex, prefixEnd, unpack}, dateRange) {
  if (cursor && !/^\d{1,8}$/.test(cursor)) throw Error('cursor_reset_required');
  const offset = Number(cursor) || 0;
  let rows;
  if (kv.db) {
    const field = (column, name) => `(SELECT json_extract(f.value, '$[1][1]') FROM json_each(${column}) AS f WHERE json_extract(f.value, '$[0]')='${name}')`;
    const object = "json_extract(r.value, '$[1]')";
    const date = field(object, 'visitAt');
    const qr = field(object, 'qrIntake');
    const needsConfirmation = field(qr, 'confirmationRequired');
    const confirmed = field(qr, 'appointmentConfirmed');
    const visit = `CASE WHEN ${needsConfirmation}=1 AND COALESCE(${confirmed},0)!=1 THEN '' ELSE COALESCE(${date},'') END`;
    const query = `WITH scheduled AS (
      SELECT r.k,r.value,${visit} AS visit,COALESCE(${field(object, 'updatedAt')},'') AS changed
      FROM kv_entries AS r WHERE r.k>? AND r.k<? AND (r.expires IS NULL OR r.expires>?)
    ) SELECT value FROM scheduled ${dateRange ? 'WHERE substr(visit,1,10) BETWEEN ? AND ?' : ''}
      ORDER BY visit DESC, changed DESC, k ASC LIMIT ? OFFSET ?`;
    const prefix = keyHex(requestPrefix);
    const result = await kv.db.prepare(query).bind(prefix, prefixEnd(prefix), kv.now(), ...(dateRange || []), pageSize + 1, offset).all();
    rows = result.results.map(row => unpack(row.value));
  } else {
    rows = [];
    for await (const entry of kv.list({prefix:requestPrefix})) rows.push(entry.value);
    const visit = row => row.qrIntake?.confirmationRequired && !row.qrIntake.appointmentConfirmed ? '' : row.visitAt || '';
    if (dateRange) rows = rows.filter(row=>{ const day=visit(row).slice(0,10); return day>=dateRange[0] && day<=dateRange[1]; });
    rows.sort((a,b) => visit(b).localeCompare(visit(a)) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || a.id.localeCompare(b.id));
    rows = rows.slice(offset, offset + pageSize + 1);
  }
  return {rows: rows.slice(0, pageSize), cursor: rows.length > pageSize ? String(offset + pageSize) : ''};
}
