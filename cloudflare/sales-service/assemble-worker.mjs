import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';

const [baselinePath, outputPath] = process.argv.slice(2);
if (!baselinePath || !outputPath) throw Error('Usage: node assemble-worker.mjs BASELINE.mjs CANDIDATE.mjs');

const [baseline, fields, service] = await Promise.all([
  readFile(baselinePath, 'utf8'),
  readFile(new URL('../../js/baz-work-fields.js', import.meta.url), 'utf8'),
  readFile(new URL('./service.mjs', import.meta.url), 'utf8'),
]);
let source = baseline.replaceAll('\r\n', '\n');
function insert(anchor, replacement) {
  if (source.split(anchor).length !== 2) throw Error('Production Worker anchor must occur once: ' + anchor.slice(0, 120));
  source = source.replace(anchor, () => replacement);
}

const body = service.replace(/^import[^\n]+\n/, '').replace(/^export /gm, '');
source = `const {createSalesService, prepareSalesTransition, enqueueSalesNotice, updateSalesAccess} = (() => {
  const workFields = (() => {
    const module = {exports: {}};
    ${fields}
    return module.exports;
  })();
  ${body}
  return {createSalesService, prepareSalesTransition, enqueueSalesNotice, updateSalesAccess};
})();
${source}`;

const routing = '  async function handleAction(action, p, clientIp, origin = "") {';
insert(routing, `  function salesService(kv) {
    return createSalesService(kv, {
      hash: sha256B64u,
      sender: createPushSender(kv),
      validateSubscription,
      verifyGoogle: async idToken => {
        try { return await verifyGoogleIdToken(String(idToken || "")); }
        catch { throw Object.assign(new Error("Google 계정을 확인해 주세요."), {status: 401, code: "LOGIN_REQUIRED"}); }
      },
      requestPage: async cursor => {
        const limit = 128, rows = [];
        const scan = kv.list({prefix: ["hospitalwork-v2", "request"]}, {limit, cursor: cursor || undefined, reverse: true});
        for await (const entry of scan) rows.push(entry.value);
        return {rows, cursor: rows.length === limit ? scan.cursor : ""};
      }
    });
  }
  async function salesForward(action, p, clientIp) {
    if (!GOOGLE_AUTH_ENABLED) return json({success: false, error: "Google 로그인을 연결할 수 없습니다."}, 503);
    if (action === "sales_config") return json({success: true, googleClientId: GOOGLE_CLIENT_ID});
    const kv = await getKv();
    if (!kv) return json({success: false, error: "영업 앱 저장소를 연결할 수 없습니다."}, 503);
    if (action === "sales_admin_access") {
      const admin = await verifyToken(String(p.token || ""));
      if (!admin.ok || admin.level < 3 || !(await notificationAccounts(kv)).some(account => account.uid === admin.uid && account.level >= 3)) {
        return json({success: false, error: "관리자 권한이 필요합니다."}, 403);
      }
      try { return json(await updateSalesAccess(kv, p.policy)); }
      catch (error) { return json({success: false, error: error.status ? error.message : "영업 계정 설정을 저장하지 못했습니다."}, error.status || 503); }
    }
    const login = action === "sales_google_login";
    const started = Date.now();
    const rateIp = "sales-service:" + clientIp;
    if (login && (await loginRateStatus(rateIp)).blocked) return json({success: false, error: "잠시 후 Google 로그인을 다시 시도해 주세요."}, 429);
    try {
      const result = await salesService(kv).handle({...p, action});
      if (login) await clearLoginFailures(rateIp);
      const reply = json(result);
      if (result.queued && action === "sales_notice_send") reply.headers.set("X-YuYoung-Sales-Notice", "1");
      return reply;
    } catch (error) {
      if (login && [401, 403].includes(error.status)) {
        await recordLoginFailure(rateIp);
        await sleep(Math.max(0, LOGIN_FAILURE_DELAY_MS - (Date.now() - started)));
      }
      const invalidCursor = error.message === "cursor_reset_required";
      return json({success: false, code: error.code || "", error: error.status ? error.message : invalidCursor ? "동기화로 목록을 다시 불러와 주세요." : "잠시 후 다시 시도해 주세요."}, error.status || (invalidCursor ? 400 : 503));
    }
  }
${routing}
    if (action.startsWith("sales_")) return salesForward(action, p, clientIp);`);

const guard = 'if (action.startsWith("work_") || action.startsWith("notification_") || action.startsWith("qr_")) return withCors';
insert(guard, 'if (action.startsWith("sales_") || action.startsWith("work_") || action.startsWith("notification_") || action.startsWith("qr_")) return withCors');

const notificationCheck = '        tx = appendNotification(tx, alert);\n      }\n      let committed;';
insert(notificationCheck, `        tx = appendNotification(tx, alert);
      }
      const salesNotice = await prepareSalesTransition(kv, previousRequest.value, ev.request, ev.kind);
      if (salesNotice) tx = enqueueSalesNotice(tx, salesNotice);
      let committed;`);
const background = '  }, async background(phase) {\n    await activateNotifications();';
insert(background, `  }, async background(phase) {
    if (phase === "salesDelivery") {
      const kv = await getKv();
      return kv && await salesService(kv).deliver();
    }
    await activateNotifications();`);
insert('"roster", "fanout", "delivery", "readRetention"];', '"roster", "fanout", "delivery", "readRetention", "salesDelivery"];');
insert('        await a.background(phase);\n        let more = false;', '        const processed = await a.background(phase);\n        let more = phase === "salesDelivery" && processed === true;');
insert('const limit = phase === "fanout" || phase === "delivery" ? 10 : 1;', 'const limit = phase === "fanout" || phase === "delivery" ? 10 : phase === "salesDelivery" ? 3 : 1;');
insert('(env.D1_RETENTION_ENABLED === "true" ? 29 : 28) + (env.QR_AS_ENABLED === "true" ? 1 : 0)', '(env.D1_RETENTION_ENABLED === "true" ? 32 : 31) + (env.QR_AS_ENABLED === "true" ? 1 : 0)');
const pushRead = '      const customerPush = result.headers.get(customerPushHeader);';
insert(pushRead, `      if (result.ok && ctx?.waitUntil && (result.headers.get("X-YuYoung-Notify") === "1" || result.headers.get("X-YuYoung-Sales-Notice") === "1")) {
        ctx.waitUntil(app(env).background("salesDelivery").catch(error => console.warn("sales_push_after_commit_failed", error?.name || "Error")));
      }
${pushRead}`);
insert('      h.delete(customerPushHeader);', '      h.delete(customerPushHeader);\n      h.delete("X-YuYoung-Sales-Notice");');

const marker = source.match(/(var release = [^\n]*\? ")[0-9a-f]{64}(" : "development")/);
if (!marker) throw Error('Production release marker unavailable');
const release = createHash('sha256').update(source).digest('hex');
insert(marker[0], marker[1] + release + marker[2]);
await writeFile(outputPath, source);
console.log('Prepared sales service Worker candidate ' + release);
