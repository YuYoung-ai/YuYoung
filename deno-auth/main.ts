/************************************************************
 * BAZ 로그인 서버 — Deno Deploy 판 (GAS auth 대체)
 * ----------------------------------------------------------
 * 왜 만들었나:
 *   보안 재설계로 각 데이터 GAS 가 토큰을 '로컬 HMAC 검증'하게 되면서,
 *   auth 를 깨워 두던 검증 왕복 트래픽이 사라졌다. 그 결과 auth GAS 는
 *   로그인 때만 호출돼 자주 잠들고, 첫 로그인이 콜드스타트(30~50초)가 됐다.
 *   keepWarm/prewarm 은 임시방편이고 GAS 트리거 한도에 걸린다.
 *
 *   → 로그인 발급기만 '콜드스타트가 없는' Deno Deploy 로 옮긴다.
 *     토큰은 기존 baz_token_lib.gs 와 100% 동일한 형식(HMAC-SHA256 서명)으로
 *     발급하므로, 데이터 GAS·프런트는 한 줄도 바꿀 필요가 없다.
 *     (auth.js 의 AUTH_URL 만 이 서버 주소로 교체)
 *
 * 토큰 형식(기존과 동일):
 *   token   = base64url(payload) + "." + base64url(HMAC_SHA256(secret, base64url(payload)))
 *   payload = {"n":이름,"l":레벨,"e":만료(초),"ep":에폭}
 *
 * API 계약(기존 auth_gas.gs 와 동일):
 *   POST {action:'login',  password}  → {ok, token, level, name, expires}
 *   POST {action:'verify', token}     → {ok, level, name}
 *   POST {action:'logout', token}     → {ok:true}            (서명 토큰은 무상태 — 클라이언트 세션만 정리)
 *   GET  ?action=verify&token=…       → {ok, level, name}    (데이터 GAS용)
 *   GET  ?action=ping                 → {ok, ver, mode, fp}  (배포 확인·health)
 *
 * 필요한 환경변수(Deno Deploy → Settings → Environment Variables):
 *   TOKEN_SECRET     : 기존 보안시트 Config 의 TOKEN_SECRET 과 '동일한 값'(필수)
 *   TOKEN_EPOCH      : 기존 TOKEN_EPOCH 와 동일(기본 "1"). 전원 로그아웃(bump) 시 양쪽 다 올린다
 *   TOKEN_TTL_HOURS  : 토큰 유효시간(기본 "12")
 *   CREDENTIALS      : 계정 목록 JSON 배열(아래 형식). 비밀번호는 해시 저장 권장.
 *       [{"pwsha":"<sha256(base64url)>","level":2,"name":"홍길동"}, ...]
 *     또는 마이그레이션 편의용 평문(권장하지 않음):
 *       [{"pw":"평문비밀번호","level":1,"name":"홍길동"}, ...]
 *     pwsha 생성:  deno run --allow-read deno-auth/hash.ts '평문비밀번호'
 ************************************************************/

const VER = "deno-1.0.1";

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlStr(str: string): string {
  return b64url(enc.encode(str));
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

/* 상수 시간 문자열 비교(타이밍 노출 완화) */
function safeEq(a: string, b: string): boolean {
  const n = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/* ── 설정(환경변수) ── */
const SECRET = Deno.env.get("TOKEN_SECRET") || "";
const EPOCH = Number(Deno.env.get("TOKEN_EPOCH") || "1") || 0;
const TTL_HOURS = Number(Deno.env.get("TOKEN_TTL_HOURS") || "12") || 12;

type Cred = { pw?: string; pwsha?: string; level: number; name: string };
let CREDS: Cred[] = [];
try {
  const raw = Deno.env.get("CREDENTIALS") || "[]";
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    CREDS = parsed.map((c) => ({
      pw: typeof c.pw === "string" ? c.pw : undefined,
      pwsha: typeof c.pwsha === "string" ? c.pwsha : undefined,
      level: Number(c.level) || 1,
      name: String(c.name || ""),
    }));
  }
} catch (_e) {
  console.error("CREDENTIALS 환경변수 JSON 파싱 실패 — 로그인 전부 거부됩니다");
}

/* ── HMAC 키(1회 import 후 재사용) ── */
let hmacKeyPromise: Promise<CryptoKey> | null = null;
function hmacKey(): Promise<CryptoKey> {
  if (!hmacKeyPromise) {
    hmacKeyPromise = crypto.subtle.importKey(
      "raw",
      enc.encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
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

/* ── 토큰 발급/검증 (baz_token_lib.gs 와 동일 규칙) ── */
async function issueToken(name: string, level: number, hours: number) {
  const expSec = Math.floor(Date.now() / 1000) + (hours > 0 ? hours : 12) * 3600;
  const payload = JSON.stringify({ n: String(name || ""), l: Number(level) || 0, e: expSec, ep: EPOCH });
  const p = b64urlStr(payload);
  const sig = await hmacB64u(p);
  return { token: p + "." + sig, expires: new Date(expSec * 1000).toISOString() };
}

async function verifyToken(token: string) {
  const t = String(token || "");
  const i = t.lastIndexOf(".");
  if (i <= 0 || i === t.length - 1) return { ok: false, error: "bad_format" };
  const p = t.slice(0, i), sig = t.slice(i + 1);
  let calc: string;
  try { calc = await hmacB64u(p); } catch (_e) { return { ok: false, error: "hmac_error" }; }
  if (!safeEq(calc, sig)) return { ok: false, error: "bad_signature" };
  let o: { n?: string; l?: number; e?: number; ep?: number };
  try { o = JSON.parse(b64urlDecodeToStr(p)); } catch (_e) { return { ok: false, error: "bad_payload" }; }
  if (!o || typeof o.e === "undefined") return { ok: false, error: "bad_payload" };
  if (Math.floor(Date.now() / 1000) > Number(o.e)) return { ok: false, error: "expired" };
  if (Number(o.ep || 0) < EPOCH) return { ok: false, error: "revoked" };
  return { ok: true, level: Number(o.l) || 0, name: String(o.n || "") };
}

/* ── 비밀번호 대조 ── */
async function matchCred(password: string): Promise<Cred | null> {
  const pw = String(password == null ? "" : password).trim();
  if (!pw) return null;
  const inHash = await sha256B64u(pw);
  let hit: Cred | null = null;
  /* 조기 반환 없이 전체 순회 — 계정 수에 따른 타이밍 노출 완화 */
  for (const c of CREDS) {
    if (c.pwsha && safeEq(c.pwsha, inHash)) hit = hit || c;
    else if (c.pw && safeEq(c.pw, pw)) hit = hit || c;
  }
  return hit;
}

/* ── HTTP ── */
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

async function handleAction(action: string, p: Record<string, unknown>): Promise<Response> {
  if (action === "login") {
    if (!SECRET) return json({ ok: false, error: "server_misconfigured" });
    if (!CREDS.length) return json({ ok: false, error: "no_credentials" });
    const hit = await matchCred(String(p.password ?? ""));
    if (!hit) return json({ ok: false, error: "invalid_password" });
    const iss = await issueToken(hit.name, hit.level, TTL_HOURS);
    return json({ ok: true, token: iss.token, level: hit.level, name: hit.name, expires: iss.expires });
  }
  if (action === "verify") {
    const r = await verifyToken(String(p.token ?? ""));
    return json(r.ok ? { ok: true, level: r.level, name: r.name } : { ok: false, error: r.error });
  }
  if (action === "logout") {
    /* 서명 토큰은 무상태 — 개별 폐기 불가(전원 폐기는 TOKEN_EPOCH bump). 클라이언트가 세션을 지운다. */
    return json({ ok: true });
  }
  if (action === "ping") {
    const fp = SECRET ? (await sha256B64u(SECRET)).slice(0, 8) : "";
    return json({ ok: true, ver: VER, mode: SECRET ? "signed" : "no_secret", fp, creds: CREDS.length, pong: new Date().toISOString() });
  }
  return json({ ok: false, error: "unknown_action" });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  try {
    if (req.method === "POST") {
      let p: Record<string, unknown> = {};
      try { p = JSON.parse((await req.text()) || "{}"); } catch (_e) { p = {}; }
      return await handleAction(String(p.action || ""), p);
    }
    if (req.method === "GET") {
      const u = new URL(req.url);
      const action = u.searchParams.get("action") || "ping";
      const p: Record<string, unknown> = {};
      u.searchParams.forEach((v, k) => (p[k] = v));
      return await handleAction(action, p);
    }
    return json({ ok: false, error: "method_not_allowed" }, 405);
  } catch (err) {
    return json({ ok: false, error: "server_error", detail: String(err) });
  }
});
