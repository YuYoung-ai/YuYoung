/************************************************************
 * BAZ 데이터 앞단 계층 — Deno Deploy 판 (handover Core GAS 감싸기)
 * ----------------------------------------------------------
 * 왜 만들었나:
 *   로그인은 Deno Deploy(deno-auth)로 옮겨 콜드스타트를 없앴지만, hospital-pc 의
 *   데이터 경로(hospdbrich·issuehist·progress)는 아직 handover Core GAS 를 직접 호출한다.
 *   그 GAS 는 여전히 콜드스타트(30~50초)라, 첫 요청이 느리거나 데이터 대신 로그인/권한 HTML 을
 *   돌려줘 프런트가 견디는 방어 코드를 잔뜩 이고 있다.
 *   → 로그인 때와 같은 철학으로 '항상 켜진' Deno 계층이 기존 GAS 를 감싼다. 데이터 GAS 는 유지
 *     (시트가 소스오브트루스). 프런트는 로그인 때처럼 데이터 URL 만 이 서비스로 바꾼다.
 *
 * 무엇을 하나:
 *   1) 조회(hospdbrich·issuehist) — 토큰을 엣지에서 로컬 HMAC 검증(baz_token_lib.gs 와 동일 규칙)한
 *      뒤, 모듈 메모리에 캐시해 즉시 응답한다. 캐시가 만료되면 GAS 에서 새로 받아 갱신하되(SWR),
 *      GAS 가 HTML(콜드스타트)·타임아웃·오류면 직전 캐시를 대신 돌려준다 → 프런트로 HTML 이 새지 않는다.
 *      (Deno KV 는 값 64KiB 제한이 있어 큰 조회 응답에 부적합 → 크기 제한 없는 모듈 메모리 캐시 사용.)
 *   2) 그 외(progress GET, 진행큐 POST, ping, 기타 action) — 투명 리버스 프록시. GAS 응답을 그대로
 *      전달하고, GAS 가 verify_ 로 인증을 강제한다. 업스트림 실패는 'HTML 유사 502' 로 릴레이해
 *      프런트의 기존 재전송(fallback)·백오프 로직이 그대로 판단하게 둔다(쓰기 유실 방지).
 *   3) keep-warm — Deno.cron 으로 1분마다 handover 를 ?action=ping&warm=1 로 예열(GAS 시간트리거의
 *      quota 제약 없이 엣지에서 상시 예열). progress 폴링이 프록시를 계속 통과해도 자연히 데워진다.
 *
 * 보안(무장애 원칙):
 *   - TOKEN_SECRET 이 설정돼 있어야만 조회를 '엣지 검증 후 캐시 서빙'한다. 없으면 캐시를 끄고
 *     전부 투명 프록시로만 동작 → GAS 가 인증을 강제하므로 인증 우회가 생기지 않는다(락아웃도 없음).
 *   - progress·POST 는 캐시하지 않으므로 항상 GAS 가 최종 인증한다(엣지 검증 불필요).
 *
 * 환경변수(Deno Deploy → 프로젝트 → Environment Variables):
 *   HANDOVER_URL  : 감쌀 handover Core GAS 의 /exec URL (필수)
 *   TOKEN_SECRET  : 보안시트 Config 의 TOKEN_SECRET 과 '동일'. 있으면 조회 캐시 활성(권장)
 *   TOKEN_EPOCH   : 보안시트와 동일(기본 "1"). 전원 로그아웃 시 auth 와 함께 올린다
 *   CACHE_TTL_SEC : 조회 캐시 신선도(초, 기본 "300" = 5분, issuehist 클라 캐시와 동일)
 *   UPSTREAM_TIMEOUT_MS : 업스트림 GAS 타임아웃(기본 "25000")
 ************************************************************/

const VER = "deno-data-1.0.0";

const enc = new TextEncoder();

/* ── base64url / 상수시간 비교 (deno-auth/main.ts 와 동일) ── */
function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecodeToStr(s: string): string {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = t.length % 4;
  if (pad) t += "=".repeat(4 - pad);
  const bin = atob(t);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function safeEq(a: string, b: string): boolean {
  const n = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/* ── 설정 ── */
const HANDOVER_URL = (Deno.env.get("HANDOVER_URL") || "").trim();
const SECRET = Deno.env.get("TOKEN_SECRET") || "";
const EPOCH = Number(Deno.env.get("TOKEN_EPOCH") || "1") || 0;
const CACHE_TTL_MS = (Number(Deno.env.get("CACHE_TTL_SEC") || "300") || 300) * 1000;
const UPSTREAM_TIMEOUT_MS = Number(Deno.env.get("UPSTREAM_TIMEOUT_MS") || "25000") || 25000;

/* 캐시 대상 조회 action (느리게 바뀌는 읽기 전용 데이터) */
const CACHEABLE = new Set(["hospdbrich", "issuehist"]);

/* GAS 미인증 응답 문구 — 프런트 bazGet 의 /unauthorized|토큰|로그인/ 매칭과 동일하게 */
const UNAUTH_MSG = "unauthorized — 로그인이 필요합니다(토큰 없음/만료). 다시 로그인 후 시도하세요.";

/* ── HMAC 토큰 로컬 검증 (baz_token_lib.gs · deno-auth 와 동일 규칙) ── */
let hmacKeyPromise: Promise<CryptoKey> | null = null;
function hmacKey(): Promise<CryptoKey> {
  if (!hmacKeyPromise) {
    hmacKeyPromise = crypto.subtle.importKey(
      "raw", enc.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
  }
  return hmacKeyPromise;
}
async function hmacB64u(message: string): Promise<string> {
  const key = await hmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return b64url(new Uint8Array(sig));
}
async function sha256B64u(str: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(str));
  return b64url(new Uint8Array(d));
}
async function verifyToken(token: string): Promise<{ ok: boolean; level?: number }> {
  const t = String(token || "");
  const i = t.lastIndexOf(".");
  if (i <= 0 || i === t.length - 1) return { ok: false };
  const p = t.slice(0, i), sig = t.slice(i + 1);
  let calc: string;
  try { calc = await hmacB64u(p); } catch (_e) { return { ok: false }; }
  if (!safeEq(calc, sig)) return { ok: false };
  let o: { l?: number; e?: number; ep?: number };
  try { o = JSON.parse(b64urlDecodeToStr(p)); } catch (_e) { return { ok: false }; }
  if (!o || typeof o.e === "undefined") return { ok: false };
  if (Math.floor(Date.now() / 1000) > Number(o.e)) return { ok: false };
  if (Number(o.ep || 0) < EPOCH) return { ok: false };
  return { ok: true, level: Number(o.l) || 0 };
}

/* ── HTTP 헬퍼 ── */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS },
  });
}
/* 업스트림 장애를 프런트가 '일시적(콜드스타트 HTML)'으로 다루게 하는 릴레이.
   프런트 bazGet 은 첫 글자가 '<' 이면 kind:'html' 로 보고 만료 배너를 띄우지 않고 재시도한다.
   progress POST 도 html 이면 재전송(fallback)한다 → 쓰기 유실 없이 안전하게 재시도된다. */
function transientHtml(detail: string): Response {
  return new Response("<html><!-- upstream unavailable: " + detail + " --></html>", {
    status: 502,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...CORS },
  });
}

/* ── 업스트림(GAS) 호출 ── */
async function fetchUpstream(method: "GET" | "POST", search: string, body?: string): Promise<Response> {
  const url = HANDOVER_URL + (search || "");
  const ctl = new AbortController();
  const timer = setTimeout(() => { try { ctl.abort(); } catch (_e) { /* noop */ } }, UPSTREAM_TIMEOUT_MS);
  try {
    const init: RequestInit = { method, signal: ctl.signal };
    if (method === "POST") {
      init.headers = { "Content-Type": "text/plain;charset=utf-8" };
      init.body = body ?? "";
    }
    return await fetch(url, init);
  } finally {
    clearTimeout(timer);
  }
}

/* ── 모듈 메모리 캐시 (조회 전용, KV 64KiB 제한 회피) ── */
type CacheEntry = { body: string; ts: number };
const memCache = new Map<string, CacheEntry>();
/* action 별 재검증 중복 방지(동시 여러 요청이 같은 GAS 를 때리지 않게) */
const inflight = new Map<string, Promise<string | null>>();

/* GAS 에서 조회 응답을 받아 캐시에 저장. 성공(JSON·success!==false)일 때만 캐시.
   실패/HTML 이면 null 반환(호출부가 직전 캐시로 폴백). */
async function revalidate(action: string, search: string): Promise<string | null> {
  const existing = inflight.get(action);
  if (existing) return existing;
  const p = (async () => {
    try {
      const res = await fetchUpstream("GET", search);
      const txt = await res.text();
      if (/^\s*</.test(txt)) return null;                 // 콜드스타트/리다이렉트 HTML
      let d: { success?: boolean } | null = null;
      try { d = JSON.parse(txt); } catch (_e) { return null; }  // 파싱 불가
      if (d && d.success === false) return null;           // 서버가 명시적 오류(인증 등) → 캐시하지 않음
      memCache.set(action, { body: txt, ts: Date.now() });
      return txt;
    } catch (_e) {
      return null;                                         // 타임아웃/네트워크
    } finally {
      inflight.delete(action);
    }
  })();
  inflight.set(action, p);
  return p;
}

/* 캐시 가능한 조회 처리: 엣지 토큰검증 → 캐시 신선하면 즉시 / 아니면 GAS 재검증 → 실패 시 stale 폴백 */
async function handleCacheable(action: string, u: URL): Promise<Response> {
  const token = u.searchParams.get("token") || "";
  const v = await verifyToken(token);
  if (!v.ok) return json({ success: false, error: UNAUTH_MSG });

  const hit = memCache.get(action);
  const fresh = hit && (Date.now() - hit.ts) < CACHE_TTL_MS;
  if (fresh) return jsonRaw(hit!.body);                    // 신선 → 즉시

  let got = await revalidate(action, u.search);           // 만료/미스 → GAS 재검증
  if (got != null) return jsonRaw(got);
  if (hit) return jsonRaw(hit.body);                       // GAS 실패 + stale 있음 → stale (프런트 무중단)
  /* 캐시가 아예 없는 첫 콜드스타트 미스 — 한 번 더 예열 대기 후 재시도(1.5s 백오프) */
  await new Promise((r) => setTimeout(r, 1500));
  got = await revalidate(action, u.search);
  if (got != null) return jsonRaw(got);
  return transientHtml("no cache, upstream " + action);   // 그래도 없음 → 일시적 신호(warmup)
}
function jsonRaw(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS },
  });
}

/* ── 투명 프록시 (progress GET·POST·ping·기타 action) ── */
async function passthrough(req: Request, u: URL): Promise<Response> {
  const method = req.method === "POST" ? "POST" : "GET";
  const body = method === "POST" ? await req.text() : undefined;
  try {
    const res = await fetchUpstream(method, u.search, body);
    const txt = await res.text();
    const ct = res.headers.get("Content-Type") || "application/json; charset=utf-8";
    return new Response(txt, { status: res.status, headers: { "Content-Type": ct, "Cache-Control": "no-store", ...CORS } });
  } catch (_e) {
    return transientHtml("proxy " + method);              // 업스트림 실패 → 프런트가 재전송/백오프
  }
}

/* ── 라우팅 ── */
async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const u = new URL(req.url);

  /* 자체 진단(업스트림 안 감) */
  const selfAction = u.searchParams.get("action") || "";
  if (selfAction === "ping" && u.searchParams.get("self") === "1") {
    const fp = SECRET ? (await sha256B64u(SECRET)).slice(0, 8) : "";
    return json({ ok: true, ver: VER, upstream: !!HANDOVER_URL, cache: SECRET ? "on" : "off (no secret)", fp, cached: memCache.size });
  }

  if (!HANDOVER_URL) return json({ success: false, error: "server_misconfigured — HANDOVER_URL 미설정" });

  /* GET 조회 중 캐시 대상 + 시크릿 있으면 엣지 캐시. 그 외는 전부 투명 프록시. */
  if (req.method === "GET" && SECRET && CACHEABLE.has(selfAction)) {
    return await handleCacheable(selfAction, u);
  }
  return await passthrough(req, u);
}

/* ── keep-warm: 1분마다 handover 예열 (Deno Deploy 에서만 등록) ── */
try {
  // deno-lint-ignore no-explicit-any
  const cron = (Deno as any).cron;
  if (typeof cron === "function" && HANDOVER_URL) {
    cron("keep-warm-handover", "* * * * *", async () => {
      try { await fetchUpstream("GET", "?action=ping&warm=1"); } catch (_e) { /* noop */ }
    });
  }
} catch (_e) { /* cron 미지원 환경(로컬 등) — 무시 */ }

Deno.serve(async (req: Request) => {
  try {
    return await handle(req);
  } catch (err) {
    return json({ success: false, error: "server_error", detail: String(err) });
  }
});
