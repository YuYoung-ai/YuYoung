import { PDFDocument, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } from 'pdf-lib';
import { fileStore } from './file-store.js';
import { PNG } from 'pdf-lib/cjs/utils/png.js';

const MB = 1024 * 1024, PT = 72 / 25.4;
const TYPES = { 'base.pdf': 'application/pdf', 'final.pdf': 'application/pdf', 'review.json': 'application/json', 'signature.png': 'image/png' };
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
export const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes)), x => x.toString(16).padStart(2, '0')).join('');
const bearer = req => (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
const objectKey = (id, file) => `inspection-qr/${id}/${file}`;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const stmt = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const session = (env, id) => stmt(env, 'SELECT * FROM qr_sessions WHERE id=?', id).first();

async function bytes(req, max) {
  if (Number(req.headers.get('Content-Length') || 0) > max) fail(413, '파일 크기가 너무 큽니다.');
  const reader = req.body?.getReader(); if (!reader) fail(400, '요청 내용이 없습니다.');
  const chunks = []; let length = 0;
  while (true) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > max) { await reader.cancel(); fail(413, '파일 크기가 너무 큽니다.'); } chunks.push(part.value); }
  const out = new Uint8Array(length); let at = 0; for (const c of chunks) { out.set(c, at); at += c.length; } return out;
}
async function body(req, max = 512 * 1024) {
  try { return JSON.parse(new TextDecoder().decode(await bytes(req, max))); } catch (e) { if (e instanceof HttpError) throw e; fail(400, '요청 형식을 확인하세요.'); }
}
function png(data) {
  if (typeof data !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data) || data.length > 400000) fail(400, '서명 이미지를 확인하세요.');
  let out; try { out = Uint8Array.from(atob(data.split(',')[1]), x => x.charCodeAt(0)); } catch { fail(400, '서명 이미지를 확인하세요.'); }
  const head = [137, 80, 78, 71, 13, 10, 26, 10]; if (!head.every((x, i) => out[i] === x) || out.length < 40) fail(400, 'PNG 서명이 필요합니다.');
  const view = new DataView(out.buffer), w = view.getUint32(16), h = view.getUint32(20); if (w < 100 || h < 50 || w > 1600 || h > 1000) fail(400, '서명 이미지 크기를 확인하세요.');
  let decoded;try{decoded=PNG.load(out);}catch{fail(400,'서명 이미지를 읽을 수 없습니다. 다시 서명해 주세요.');}
  let dark=0,minX=w,maxX=0,minY=h,maxY=0;
  for(let y=Math.floor(h*.2);y<h;y++)for(let x=0;x<w;x++){
    const at=y*w+x,rgb=at*3;
    if((!decoded.alphaChannel||decoded.alphaChannel[at]>100)&&Math.min(decoded.rgbChannel[rgb],decoded.rgbChannel[rgb+1],decoded.rgbChannel[rgb+2])<180){dark++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  }
  if(dark<50||maxX-minX<10||maxY-minY<3)fail(400,'빈 서명입니다. 서명 칸에 다시 서명해 주세요.');
  return out;
}
export function placements(value) {
  if (!Array.isArray(value) || !value.length || value.length > 2) fail(400, '문서의 서명 위치를 확인하세요.');
  return value.map(p => {
    if (!p || !Number.isInteger(p.page) || p.page < 0 || p.page > 19 || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(p[k])) || p.x < 8 || p.width < 10 || p.x + p.width > 202.1 || p.height < 5 || p.height > 100 || p.y < -100 || p.y > 289) fail(400, '문서의 서명 위치를 확인하세요.');
    return { page: p.page, x: p.x, y: p.y, width: p.width, height: p.height };
  });
}
function review(value) {
  if (!value || !Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 20 || !Array.isArray(value.photos) || value.photos.length > 20) fail(400, '고객 확인 문서를 확인하세요.');
  const image = s => { if (typeof s !== 'string' || s.length > 5 * MB || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s)) fail(400, '확인용 이미지를 확인하세요.'); return s; };
  return { hospital: String(value.hospital || '').slice(0, 100), serial: String(value.serial || '').slice(0, 100), pages: value.pages.map(image), photos: value.photos.map(p => ({ data: image(p.data), memo: String(p.memo || '').slice(0, 500) })) };
}
async function staff(req, env) {
  const token = bearer(req); if (!token || token.length > 4096) fail(401, '직원 로그인이 필요합니다.');
  let answer;
  try {
    const response = await fetch(env.AUTH_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'verify', token }), signal: AbortSignal.timeout(10000) });
    if(response.status===401||response.status===403)fail(401,'로그인이 만료되었습니다. 다시 로그인하세요.');
    if (!response.ok) fail(503, '로그인 서버 연결을 확인하세요.'); answer = await response.json();
  } catch (e) { if (e instanceof HttpError) throw e; fail(503, '로그인 확인이 지연되고 있습니다.'); }
  if (!answer.ok || !(answer.level >= 1) || !answer.name) fail(401, '로그인이 만료되었습니다. 다시 로그인하세요.');
  let identity = `name:${answer.name}`;
  try { const payload = JSON.parse(atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))); if (payload.u) identity = String(payload.u); } catch { /* Legacy verified token. */ }
  return digest(identity);
}
async function owned(req, env, id) {
  const owner = await staff(req, env), row = await session(env, id); if (!row || row.owner !== owner) fail(404, '점검서를 찾을 수 없습니다.');
  if (row.retain_until <= Date.now()) fail(410, '임시 보관 기간이 지났습니다.'); return row;
}
async function guest(req, env, id) {
  const token = bearer(req); if (!/^[a-f0-9]{64}$/.test(token)) fail(404, '유효한 문서 링크가 아닙니다.');
  const row = await session(env, id); if (!row || row.token_hash !== await digest(token)) fail(404, '유효한 문서 링크가 아닙니다.');
  if (row.state === 'revoked') fail(410, '취소된 문서입니다. 새 QR을 요청하세요.');
  const until = row.state === 'signed' ? row.download_until : row.state === 'signing' ? row.signed_at + 600000 : row.expires_at;
  if (Date.now() >= until) fail(410, '유효시간이 지났습니다. 담당 직원에게 새 QR을 요청하세요.');
  return row;
}
const publicState = row => ({ id: row.id, state: row.state, expiresAt: row.expires_at, downloadUntil: row.download_until, signedAt: row.signed_at, signer: row.signer || '', documentNo: row.document_no, serverNow: Date.now() });

async function create(req, env) {
  const owner = await staff(req, env);
  const raw = await bytes(req, 18 * MB); let form; try { form = await new Response(raw, { headers: { 'Content-Type': req.headers.get('Content-Type') || '' } }).formData(); } catch { fail(400, '문서 업로드 형식을 확인하세요.'); }
  let meta; try { meta = JSON.parse(String(form.get('metadata'))); } catch { fail(400, '문서 정보를 확인하세요.'); }
  const ttl = Number(meta.ttlMinutes); if (![10, 30, 60].includes(ttl)) fail(400, '유효시간은 10분, 30분, 60분 중 선택하세요.');
  const file = form.get('pdf'); if (!file || typeof file.arrayBuffer !== 'function' || file.size > 6.5 * MB || file.size < 10) fail(400, '서명 반영 여유를 위해 6.5MB 이하의 PDF가 필요합니다.');
  const pdf = new Uint8Array(await file.arrayBuffer()); if (new TextDecoder().decode(pdf.subarray(0, 5)) !== '%PDF-') fail(400, 'PDF 파일을 확인하세요.');
  const slots = placements(meta.placements), visible = review(meta.review);
  const documentNo = String(meta.documentNo || ''); if (!/^[A-Za-z0-9_-]{1,100}$/.test(documentNo)) fail(400, '문서번호를 확인하세요.');
  const id = crypto.randomUUID(), token = Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
  const now = Date.now(), expiresAt = now + ttl * 60000, retention = Math.max(1, Math.min(90, Number(env.RETENTION_DAYS) || 30));
  const filename = String(meta.filename || 'inspection.pdf').replace(/[<>:/\\|?*"\x00-\x1f\x7f]/g, '').slice(0, 180) || 'inspection.pdf';
  const hash = await digest(pdf);
  try {
    await env.FILES.put(objectKey(id, 'base.pdf'), pdf, { httpMetadata: { contentType: TYPES['base.pdf'] } });
    await env.FILES.put(objectKey(id, 'review.json'), JSON.stringify(visible), { httpMetadata: { contentType: TYPES['review.json'] } });
    await stmt(env, 'INSERT INTO qr_sessions(id,token_hash,owner,filename,document_no,document_hash,placements,created_at,expires_at,retain_until) VALUES(?,?,?,?,?,?,?,?,?,?)', id, await digest(token), owner, filename, documentNo, hash, JSON.stringify(slots), now, expiresAt, now + retention * 86400000).run();
  } catch (e) { await env.FILES.delete([objectKey(id, 'base.pdf'), objectKey(id, 'review.json')]); throw e; }
  const url = new URL(env.CUSTOMER_PAGE); url.hash = new URLSearchParams({ id, token }).toString();
  return json({ success: true, id, url: url.href, expiresAt }, 201);
}

export async function stampPdf(original, signature, slots, audit) {
  const pdf = await PDFDocument.load(original), image = await pdf.embedPng(signature);
  for (const slot of slots) {
    if (slot.page >= pdf.getPageCount()) fail(400, '서명 페이지를 확인하세요.');
    const page = pdf.getPage(slot.page), { width, height } = page.getSize();
    if (Math.abs(width / PT - 210) > 2 || Math.abs(height / PT - 297) > 2) fail(400, 'A4 점검서가 필요합니다.');
    page.pushOperators(pushGraphicsState(), rectangle(8 * PT, 8 * PT, 194 * PT, 281 * PT), clip(), endPath());
    page.drawImage(image, { x: slot.x * PT, y: height - (slot.y + slot.height) * PT, width: slot.width * PT, height: slot.height * PT });
    page.pushOperators(popGraphicsState());
  }
  // Server-side evidence refers to the immutable document reviewed by the customer.
  await pdf.attach(new TextEncoder().encode(JSON.stringify(audit, null, 2)), 'customer-confirmation.json', { mimeType: 'application/json', description: 'Customer confirmation of the immutable inspection document' });
  pdf.setSubject(`Customer confirmation ${audit.sessionId}; ${audit.signedAt}`);
  return pdf.save();
}
async function sign(req, env, row) {
  const p = await body(req), name = String(p.name || '').trim();
  if (!name || name.length > 30 || /[\x00-\x1f\x7f]/.test(name) || p.confirmed !== true || !/^[a-f0-9-]{36}$/.test(p.submissionId || '')) fail(400, '이름과 내용 확인, 서명을 입력하세요.');
  const signature = png(p.signature), hash = await digest(name + '\n' + await digest(signature));
  if (row.state === 'signed') { if (row.sign_id === p.submissionId && row.sign_hash === hash) return json({ success: true, ...publicState(row) }); fail(409, '이미 서명이 완료된 문서입니다.'); }
  const now = Date.now();
  let locked;
  if (row.state === 'pending') locked = await stmt(env, "UPDATE qr_sessions SET state='signing',sign_id=?,sign_hash=?,signer=?,signed_at=?,lease_until=? WHERE id=? AND state='pending' AND expires_at>? RETURNING *", p.submissionId, hash, name, now, now + 90000, row.id, now).first();
  else if (row.state === 'signing' && row.sign_id === p.submissionId && row.sign_hash === hash && row.lease_until <= now) locked = await stmt(env, "UPDATE qr_sessions SET lease_until=? WHERE id=? AND state='signing' AND sign_id=? AND sign_hash=? AND lease_until<=? RETURNING *", now + 90000, row.id, p.submissionId, hash, now).first();
  if (!locked) {
    const current = await session(env, row.id);
    if (current.state === 'signed' && current.sign_id === p.submissionId && current.sign_hash === hash) return json({ success: true, ...publicState(current) });
    if (current.state === 'signing' && current.sign_id === p.submissionId && current.sign_hash === hash) return json({ success: true, ...publicState(current) }, 202);
    fail(409, '다른 서명 요청이 처리 중이거나 문서가 만료되었습니다.');
  }
  try {
    await env.FILES.put(objectKey(row.id, 'signature.png'), signature, { httpMetadata: { contentType: 'image/png' } });
    return await finish(env,locked,signature);
  } catch (e) {
    await stmt(env, "UPDATE qr_sessions SET lease_until=0 WHERE id=? AND state='signing' AND sign_id=? AND lease_until=?", row.id, p.submissionId, locked.lease_until).run();
    if (e instanceof HttpError) throw e; fail(503, 'PDF 준비가 지연되고 있습니다. 같은 서명으로 다시 시도하세요.');
  }
}
async function finish(env,locked,signature) {
    const row=locked;
    const original = await env.FILES.get(objectKey(row.id, 'base.pdf')); if (!original) fail(503, '원본 문서를 불러오지 못했습니다.');
    const audit = { sessionId: row.id, documentNo: row.document_no, originalSha256: row.document_hash, signer: row.signer, signedAt: new Date(locked.signed_at).toISOString(), statement: '위 점검 내역과 조치 내용을 확인했습니다.', signatureSha256: await digest(signature) };
    const final = await stampPdf(await original.arrayBuffer(), signature, JSON.parse(row.placements), audit);
    await env.FILES.put(objectKey(row.id, 'final.pdf'), final, { httpMetadata: { contentType: 'application/pdf' } });
    const doneAt = Date.now(), saved = await stmt(env, "UPDATE qr_sessions SET state='signed',download_until=?,lease_until=NULL WHERE id=? AND state='signing' AND sign_id=? AND sign_hash=? AND lease_until=? RETURNING *", Math.max(row.expires_at, doneAt + 600000), row.id, row.sign_id, row.sign_hash, locked.lease_until).first();
    if (!saved) fail(409, '문서 상태가 변경되었습니다. 새로 확인하세요.');
    return json({ success: true, ...publicState(saved) });
}
async function recover(env,row) {
  if(row.state!=='signing'||row.lease_until>Date.now()||row.signed_at+600000<=Date.now())return null;
  const signature=await env.FILES.get(objectKey(row.id,'signature.png'));if(!signature)return null;
  const locked=await stmt(env,"UPDATE qr_sessions SET lease_until=? WHERE id=? AND state='signing' AND lease_until<=? RETURNING *",Date.now()+90000,row.id,Date.now()).first();
  if(!locked)return null;
  try{return await finish(env,locked,new Uint8Array(await signature.arrayBuffer()));}
  catch(e){await stmt(env,"UPDATE qr_sessions SET lease_until=0 WHERE id=? AND state='signing' AND lease_until=?",row.id,locked.lease_until).run();throw e;}
}
async function download(env, row, file, attachment = false) {
  const obj = await env.FILES.get(objectKey(row.id, file)); if (!obj) fail(503, '파일 준비가 지연되고 있습니다. 다시 시도하세요.');
  return new Response(obj.body, { headers: { 'Content-Type': TYPES[file], ...(attachment ? { 'Content-Disposition': `attachment; filename="inspection.pdf"; filename*=UTF-8''${encodeURIComponent(row.filename)}` } : {}) } });
}
async function route(req, env) {
  const path = new URL(req.url).pathname;
  if (req.method === 'GET' && path === '/health') { await stmt(env, 'SELECT id FROM qr_sessions LIMIT 1').first(); return json({ success: true, service: 'inspection-qr', version: 1 }); }
  if (req.method !== 'POST') fail(405, '지원하지 않는 요청입니다.');
  if (path === '/staff/sessions') return create(req, env);
  const match = path.match(/^\/(staff|guest)\/sessions\/([a-f0-9-]{36})\/(status|review|sign|download|signature|revoke)$/);
  if (!match) fail(404, '요청 경로를 확인하세요.');
  const [, role, id, action] = match, row = role === 'staff' ? await owned(req, env, id) : await guest(req, env, id);
  if (action === 'status') return (await recover(env,row))||json({ success: true, ...publicState(row) });
  if (role === 'guest' && action === 'review') return download(env, row, 'review.json');
  if (role === 'guest' && action === 'sign') return sign(req, env, row);
  if (action === 'download' && row.state === 'signed') return download(env, row, 'final.pdf', true);
  if (role === 'staff' && action === 'signature' && row.state === 'signed') return download(env, row, 'signature.png');
  if (role === 'staff' && action === 'revoke') {
    if (row.state === 'signing') fail(409, '고객 서명을 처리 중입니다. 완료 후 다시 확인하세요.');
    const revoked=await stmt(env, "UPDATE qr_sessions SET state='revoked' WHERE id=? AND state!='signing' RETURNING id", id).first();
    if(!revoked)fail(409,'고객 서명을 처리 중입니다. 완료 후 다시 확인하세요.');
    return json({ success: true });
  }
  fail(409, '현재 문서 상태에서 사용할 수 없는 기능입니다.');
}
export async function cleanup(env) {
  env={...env,FILES:env.FILES||fileStore(env.DB)};
  const rows = await stmt(env, 'SELECT id FROM qr_sessions WHERE retain_until<? LIMIT 100', Date.now()).all();
  for (const row of rows.results || []) { await env.FILES.delete(Object.keys(TYPES).map(f => objectKey(row.id, f))); await stmt(env, 'DELETE FROM qr_sessions WHERE id=? AND retain_until<?', row.id, Date.now()).run(); }
  await stmt(env,'DELETE FROM qr_file_parts WHERE created_at<? AND NOT EXISTS (SELECT 1 FROM qr_file_heads h WHERE h.object_key=qr_file_parts.object_key AND h.version=qr_file_parts.version)',Date.now()-86400000).run();
}
export default {
  async fetch(req, env) {
    env={AUTH_URL:'https://yuyoung-production.coaptation.workers.dev',ALLOWED_ORIGINS:'https://yuyoung-ai.github.io',CUSTOMER_PAGE:'https://yuyoung-ai.github.io/YuYoung/customer-sign.html',RETENTION_DAYS:'30',...env};
    const origin = req.headers.get('Origin'), allowed = new Set(String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()));
    let response;
    try {
      if (origin && !allowed.has(origin)) fail(403, '허용되지 않은 접근입니다.');
      if (req.method === 'OPTIONS') response = new Response(null, { status: 204 });
      else { if (!env.DB) fail(503, 'QR 서명 서비스 설정이 필요합니다.'); response = await route(req, {...env,FILES:env.FILES||fileStore(env.DB)}); }
    } catch (e) { response = json({ success: false, error: e instanceof HttpError ? e.message : 'QR 서비스를 사용할 수 없습니다. 잠시 후 다시 시도하세요.' }, e instanceof HttpError ? e.status : 503); }
    response.headers.set('Cache-Control', 'private, no-store'); response.headers.set('X-Content-Type-Options', 'nosniff'); response.headers.set('Referrer-Policy', 'no-referrer');
    if (origin && allowed.has(origin)) { response.headers.set('Access-Control-Allow-Origin', origin); response.headers.set('Vary', 'Origin'); response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type'); response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); }
    return response;
  },
  scheduled(event, env, ctx) { ctx.waitUntil(cleanup(env)); }
};
