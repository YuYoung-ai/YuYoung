/************************************************************
 * BAZ 로그인 서버 — Deno Deploy 판 (GAS auth 대체)
 * ----------------------------------------------------------
 * 왜 만들었나:
 *   보안 재설계로 각 데이터 GAS 가 토큰을 '로컬 HMAC 검증'하게 되면서,
 *   auth 를 깨워 두던 검증 왕복 트래픽이 사라졌다. 그 결과 auth GAS 는
 *   로그인 때만 호출돼 자주 잠들고, 첫 로그인이 콜드스타트(30~50초)가 됐다.
 *   → 로그인 발급기만 '콜드스타트가 없는' Deno Deploy 로 옮긴다. 토큰은 기존
 *     baz_token_lib.gs 와 100% 동일한 HMAC-SHA256 서명 형식이라 데이터 GAS·프런트 무수정.
 *
 * 토큰 형식(기존과 동일):
 *   token   = base64url(payload) + "." + base64url(HMAC_SHA256(secret, base64url(payload)))
 *   payload = {"n":이름,"l":레벨,"e":만료(초),"ep":에폭}
 *
 * API 계약:
 *   POST {action:'login',  password, remember?} → {ok, token, level, name, expires, device?}
 *   POST {action:'verify', token}               → {ok, level, name}
 *   POST {action:'logout', token}               → {ok:true}
 *   GET  ?action=verify&token=…                 → {ok, level, name}   (데이터 GAS용)
 *   GET  ?action=ping                           → {ok, ver, mode, fp, creds, kv}
 *   ── 기기 자동 로그인(선택 기능, Deno KV 필요) ──
 *   POST {action:'device_login',  device}       → {ok, token, level, name, expires, device}
 *   POST {action:'device_logout', device}       → {ok:true}
 *   POST {action:'devices',       token}        → {ok, devices:[…]}   (Lv.3 토큰 필요)
 *   POST {action:'device_revoke', token, did}   → {ok, revoked}       (Lv.3 토큰 필요)
 *
 * 환경변수(Deno Deploy → 각 timeline → Environment Variables):
 *   TOKEN_SECRET     : 보안시트 Config 의 TOKEN_SECRET 과 '동일'(필수)
 *   TOKEN_EPOCH      : 보안시트와 동일(기본 "1"). 전원 로그아웃 시 양쪽 다 올린다
 *   TOKEN_TTL_HOURS  : 세션 토큰 유효시간(기본 "6")
 *   CREDENTIALS      : 계정 목록 JSON 배열
 *       [{"pwsha":"<sha256(base64url)>","level":2,"name":"홍길동"}, ...]  (해시 권장)
 *       또는 [{"pw":"평문","level":1,"name":"홍길동"}, ...]              (편의용)
 *   DEVICE_TTL_DAYS  : 기억된 기기 유효기간(기본 "30", 사용 시마다 슬라이딩 갱신)
 *   DEVICE_AUTH_ENABLED: 기기 로그인 서버 스위치(기본 "true"). false면 device_* 전부 거부
 *   ALLOWED_ORIGINS  : 브라우저 호출 허용 Origin(쉼표 구분, 기본 GitHub Pages Origin)
 *   LOGIN_RATE_MAX   : IP별 로그인 실패 허용 횟수(기본 "5")
 *   LOGIN_RATE_WINDOW_SEC: 실패 집계 구간(기본 "300")
 *   LOGIN_RATE_BLOCK_SEC : 한도 초과 잠금 시간(기본 "300")
 *   LOGIN_FAILURE_DELAY_MS: 실패 응답 최소 지연(기본 "350")
 *   AUDIT_RETENTION_DAYS: 감사 기록 보존 기간(기본 "180")
 *   GOOGLE_CLIENT_ID : Google 웹 OAuth 클라이언트 ID. 비어 있으면 Google 로그인 비활성
 *   GOOGLE_AUTH_ENABLED: Google 로그인 서버 스위치(기본 true, client id가 있어야 활성)
 *   GOOGLE_USERS     : 최초 1회 KV seed용 허용 사용자 JSON
 *       [{"email":"user@gmail.com","level":1,"name":"홍길동"}, ...]
 *
 * ※ 기기 기능은 Deno KV 가 있어야 동작한다(Deploy 의 Databases 에서 KV 사용 설정).
 *   KV 가 없으면 device_* 는 kv_unavailable 을 반환할 뿐, 일반 로그인은 정상 동작한다.
 ************************************************************/

const VER = "deno-1.2.0-security";

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
  return new TextDecoder().decode(b64urlDecode(s));
}
/* 반환 타입에 <ArrayBuffer> 를 붙여 둔다.
   TypeScript 5.7 부터 Uint8Array 가 버퍼 종류로 제네릭해져서, 그냥 Uint8Array 라고 쓰면
   SharedArrayBuffer 까지 포함하는 Uint8Array<ArrayBufferLike> 가 된다. 그러면 WebCrypto 의
   BufferSource(= ArrayBufferView<ArrayBuffer> | ArrayBuffer)에 넘길 수 없어 타입 검사가 깨진다.
   여기서 만드는 배열은 new Uint8Array(길이) 라 언제나 일반 ArrayBuffer 위에 있으므로
   좁혀 적는 것이 실제 값과도 맞다. 런타임 동작은 그대로다. */
function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = t.length % 4;
  if (pad) t += "=".repeat(4 - pad);
  const bin = atob(t);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
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
const TTL_HOURS = Number(Deno.env.get("TOKEN_TTL_HOURS") || "6") || 6;
const DEVICE_TTL_MS = (Number(Deno.env.get("DEVICE_TTL_DAYS") || "30") || 30) * 24 * 3600 * 1000;
const DEVICE_AUTH_ENABLED = !/^(0|false|off|no)$/i.test(Deno.env.get("DEVICE_AUTH_ENABLED") || "true");

function envInt(name: string, fallback: number, min: number, max: number): number {
  const n = Number(Deno.env.get(name) || "");
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

const LOGIN_RATE_MAX = envInt("LOGIN_RATE_MAX", 5, 1, 100);
const LOGIN_RATE_WINDOW_MS = envInt("LOGIN_RATE_WINDOW_SEC", 300, 10, 86400) * 1000;
const LOGIN_RATE_BLOCK_MS = envInt("LOGIN_RATE_BLOCK_SEC", 300, 10, 86400) * 1000;
const LOGIN_FAILURE_DELAY_MS = envInt("LOGIN_FAILURE_DELAY_MS", 350, 0, 5000);
const AUDIT_TTL_MS = envInt("AUDIT_RETENTION_DAYS", 180, 7, 730) * 24 * 3600 * 1000;

const DEFAULT_ALLOWED_ORIGINS = "https://yuyoung-ai.github.io";
const ALLOWED_ORIGINS = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") || DEFAULT_ALLOWED_ORIGINS)
    .split(",")
    .map((v) => v.trim().replace(/\/$/, ""))
    .filter(Boolean),
);

const GOOGLE_CLIENT_ID = (Deno.env.get("GOOGLE_CLIENT_ID") || "").trim();
const GOOGLE_AUTH_ENABLED = !!GOOGLE_CLIENT_ID &&
  !/^(0|false|off|no)$/i.test(Deno.env.get("GOOGLE_AUTH_ENABLED") || "true");

type GoogleSeed = { email: string; level: number; name: string };
let GOOGLE_SEEDS: GoogleSeed[] = [];
try {
  const parsed = JSON.parse(Deno.env.get("GOOGLE_USERS") || "[]");
  if (Array.isArray(parsed)) {
    GOOGLE_SEEDS = parsed
      .map((u) => ({
        email: String(u.email || "").trim().toLowerCase(),
        level: Math.min(3, Math.max(1, Number(u.level) || 1)),
        name: String(u.name || "").trim(),
      }))
      .filter((u) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email));
  }
} catch (_e) {
  console.error("GOOGLE_USERS 환경변수 JSON 파싱 실패 — Google 로그인 허용 명단 seed를 만들 수 없습니다");
}

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

/* ── Deno KV (지연 오픈 — 없으면 null, 기기 기능만 비활성) ── */
let _kv: Deno.Kv | null | undefined = undefined;
async function getKv(): Promise<Deno.Kv | null> {
  if (_kv !== undefined) return _kv;
  try {
    _kv = await Deno.openKv();
  } catch (e) {
    console.error("Deno KV 사용 불가 — 기기 자동로그인 비활성:", e);
    _kv = null;
  }
  return _kv;
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
  const expSec = Math.floor(Date.now() / 1000) + (hours > 0 ? hours : 6) * 3600;
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

/* ── Google OpenID Connect ID 토큰 검증 ── */
type GoogleClaims = {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  exp?: number;
  iat?: number;
};
type GoogleJwk = JsonWebKey & { kid?: string; alg?: string };
let googleJwksCache: { keys: GoogleJwk[]; expiresAt: number } | null = null;

function cacheMaxAgeMs(value: string | null): number {
  const m = String(value || "").match(/(?:^|,)\s*max-age=(\d+)/i);
  return m ? Math.max(60000, Math.min(24 * 3600 * 1000, Number(m[1]) * 1000)) : 3600 * 1000;
}
async function googleJwks(): Promise<GoogleJwk[]> {
  if (googleJwksCache && googleJwksCache.expiresAt > Date.now()) return googleJwksCache.keys;
  const res = await fetch("https://www.googleapis.com/oauth2/v3/certs", { cache: "no-store" });
  if (!res.ok) throw new Error("google_jwks_http_" + res.status);
  const body = await res.json();
  if (!body || !Array.isArray(body.keys)) throw new Error("google_jwks_invalid");
  googleJwksCache = { keys: body.keys, expiresAt: Date.now() + cacheMaxAgeMs(res.headers.get("cache-control")) };
  return googleJwksCache.keys;
}
async function verifyGoogleIdToken(idToken: string): Promise<GoogleClaims> {
  if (!GOOGLE_AUTH_ENABLED) throw new Error("google_auth_disabled");
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new Error("google_bad_format");
  let header: { alg?: string; kid?: string };
  let claims: GoogleClaims;
  try {
    header = JSON.parse(b64urlDecodeToStr(parts[0]));
    claims = JSON.parse(b64urlDecodeToStr(parts[1]));
  } catch (_e) {
    throw new Error("google_bad_payload");
  }
  if (header.alg !== "RS256" || !header.kid) throw new Error("google_bad_header");
  const jwk = (await googleJwks()).find((k) => k.kid === header.kid && (!k.alg || k.alg === "RS256"));
  if (!jwk) {
    googleJwksCache = null; // Google 키 교체 직후라면 한 번 새로 받는다.
    const retry = (await googleJwks()).find((k) => k.kid === header.kid && (!k.alg || k.alg === "RS256"));
    if (!retry) throw new Error("google_unknown_key");
    return verifyGoogleIdTokenWithKey(parts, claims, retry);
  }
  return verifyGoogleIdTokenWithKey(parts, claims, jwk);
}
async function verifyGoogleIdTokenWithKey(
  parts: string[],
  claims: GoogleClaims,
  jwk: GoogleJwk,
): Promise<GoogleClaims> {
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlDecode(parts[2]),
    enc.encode(parts[0] + "." + parts[1]),
  );
  if (!valid) throw new Error("google_bad_signature");
  const now = Math.floor(Date.now() / 1000);
  const issuerOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud || ""];
  if (!issuerOk || !audiences.includes(GOOGLE_CLIENT_ID)) throw new Error("google_bad_issuer_or_audience");
  if (!claims.exp || claims.exp < now - 30) throw new Error("google_expired");
  if (claims.iat && claims.iat > now + 300) throw new Error("google_bad_iat");
  if (!claims.sub || !claims.email || claims.email_verified !== true) throw new Error("google_identity_incomplete");
  return claims;
}

/* ── Google 사용자 허용 명단(KV) ── */
type UserRec = {
  email: string;
  sub?: string;
  name: string;
  level: number;
  status: "active" | "disabled";
  created: number;
  updated: number;
  lastLogin?: number;
};
const GOOGLE_SEED_MARKER: Deno.KvKey = ["meta", "google_users_seed_v1"];

async function ensureGoogleUserSeed(kv: Deno.Kv): Promise<void> {
  const marker = await kv.get(GOOGLE_SEED_MARKER);
  if (marker.value) return;
  if (!GOOGLE_SEEDS.length) return; // 빈 설정으로 마커를 만들면 나중의 정상 seed가 영구히 막힌다.
  const now = Date.now();
  for (const seed of GOOGLE_SEEDS) {
    const key: Deno.KvKey = ["user_email", seed.email];
    const old = await kv.get<UserRec>(key);
    if (!old.value) {
      await kv.set(key, {
        email: seed.email,
        name: seed.name,
        level: seed.level,
        status: "active",
        created: now,
        updated: now,
      } satisfies UserRec);
    }
  }
  /* 이 마커 뒤에는 GOOGLE_USERS를 다시 seed하지 않는다. 삭제한 사용자의 부활을 막는다. */
  await kv.set(GOOGLE_SEED_MARKER, { seededAt: now, count: GOOGLE_SEEDS.length });
}

async function findAndBindGoogleUser(kv: Deno.Kv, claims: GoogleClaims): Promise<UserRec | null> {
  await ensureGoogleUserSeed(kv);
  const sub = String(claims.sub);
  const email = String(claims.email).trim().toLowerCase();
  const subMap = await kv.get<{ email: string }>(["user_sub", sub]);
  const lookupEmail = subMap.value ? subMap.value.email : email;
  const entry = await kv.get<UserRec>(["user_email", lookupEmail]);
  const user = entry.value;
  if (!user || user.status !== "active") return null;
  if (user.sub && user.sub !== sub) return null;
  const next: UserRec = {
    ...user,
    sub,
    name: user.name || String(claims.name || ""),
    updated: Date.now(),
    lastLogin: Date.now(),
  };
  await kv.set(["user_email", user.email], next);
  await kv.set(["user_sub", sub], { email: user.email });
  return next;
}

/* ── 로그인 시도 제한(IP 기준, 사용자 ID 도입 전 1차 방어) ── */
type LoginRateRec = { failures: number; windowStarted: number; blockedUntil: number };

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function rateKeyForIp(ip: string): Promise<Deno.KvKey> {
  /* KV에 원 IP를 남기지 않는다. TOKEN_SECRET을 섞어 외부에서 키를 역산하기 어렵게 한다. */
  return ["login_rate", (await sha256B64u(SECRET + "\u0000" + (ip || "unknown"))).slice(0, 24)];
}

async function loginRateStatus(ip: string): Promise<{ blocked: boolean; retryAfterMs: number }> {
  try {
    const kv = await getKv();
    if (!kv) return { blocked: false, retryAfterMs: 0 }; // KV 장애가 일반 로그인을 막지는 않는다.
    const now = Date.now();
    const r = await kv.get<LoginRateRec>(await rateKeyForIp(ip));
    const v = r.value;
    if (!v) return { blocked: false, retryAfterMs: 0 };
    if (v.blockedUntil > now) return { blocked: true, retryAfterMs: v.blockedUntil - now };
    if (now - v.windowStarted >= LOGIN_RATE_WINDOW_MS) await kv.delete(r.key);
  } catch (e) {
    console.error("로그인 제한 상태 조회 실패 — 이번 요청은 제한 없이 처리합니다:", e);
  }
  return { blocked: false, retryAfterMs: 0 };
}

async function recordLoginFailure(ip: string): Promise<void> {
  try {
    const kv = await getKv();
    if (!kv) return;
    const key = await rateKeyForIp(ip);
    for (let attempt = 0; attempt < 4; attempt++) {
      const now = Date.now();
      const old = await kv.get<LoginRateRec>(key);
      const prev = old.value;
      const freshWindow = !prev || now - prev.windowStarted >= LOGIN_RATE_WINDOW_MS;
      const failures = freshWindow ? 1 : prev.failures + 1;
      const next: LoginRateRec = {
        failures,
        windowStarted: freshWindow ? now : prev.windowStarted,
        blockedUntil: failures >= LOGIN_RATE_MAX ? now + LOGIN_RATE_BLOCK_MS : 0,
      };
      const committed = await kv.atomic()
        .check(old)
        .set(key, next, { expireIn: Math.max(LOGIN_RATE_WINDOW_MS, LOGIN_RATE_BLOCK_MS) + 60000 })
        .commit();
      if (committed.ok) return;
    }
    console.warn("로그인 실패 카운터 갱신 충돌 — 다음 요청에서 재시도됩니다");
  } catch (e) {
    console.error("로그인 실패 카운터 기록 실패 — 일반 로그인은 계속 처리합니다:", e);
  }
}

async function clearLoginFailures(ip: string): Promise<void> {
  try {
    const kv = await getKv();
    if (kv) await kv.delete(await rateKeyForIp(ip));
  } catch (e) {
    console.error("로그인 실패 카운터 초기화 실패 — 로그인 성공 처리는 계속합니다:", e);
  }
}

/* ── 감사 기록(민감정보·원 IP 제외, 자동 만료) ── */
type AuditRec = {
  at: number;
  event: string;
  actor: string;
  target: string;
  result: string;
  client: string;
  meta?: Record<string, unknown>;
};

async function writeAudit(
  event: string,
  actor: string,
  target: string,
  result: string,
  clientIp: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    const kv = await getKv();
    if (!kv) return;
    const at = Date.now();
    const client = (await sha256B64u(SECRET + "\u0000audit\u0000" + (clientIp || "unknown"))).slice(0, 12);
    const rec: AuditRec = {
      at,
      event,
      actor: String(actor || "unknown").slice(0, 160),
      target: String(target || "").slice(0, 160),
      result,
      client,
      ...(meta ? { meta } : {}),
    };
    await kv.set(["audit", at, crypto.randomUUID()], rec, { expireIn: AUDIT_TTL_MS });
  } catch (e) {
    console.error("감사 기록 저장 실패 — 본 요청은 계속 처리합니다:", e);
  }
}

/* ── 기기 토큰 ── */
type DevRec = { n: string; l: number; ep: number; created: number; seen: number; ua: string; uid?: string };
function newDeviceToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b64url(b);
}
async function requireAdmin(p: Record<string, unknown>) {
  const r = await verifyToken(String(p.token ?? ""));
  if (!r.ok) return { ok: false as const, error: "unauthorized" };
  if ((r.level || 0) < 3) return { ok: false as const, error: "forbidden" };
  return { ok: true as const, name: r.name || "Lv.3", level: r.level || 3 };
}

/* ── HTTP ── */
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function requestOrigin(req: Request): string {
  return (req.headers.get("origin") || "").trim().replace(/\/$/, "");
}
function originAllowed(req: Request): boolean {
  const origin = requestOrigin(req);
  return !origin || ALLOWED_ORIGINS.has(origin); // GAS·curl 등 비브라우저 호출에는 Origin이 없다.
}
function withCors(res: Response, req: Request): Response {
  const headers = new Headers(res.headers);
  const origin = requestOrigin(req);
  if (origin && ALLOWED_ORIGINS.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function handleAction(
  action: string,
  p: Record<string, unknown>,
  clientIp: string,
): Promise<Response> {
  if (action === "config") {
    return json({
      ok: true,
      googleAuth: GOOGLE_AUTH_ENABLED,
      googleClientId: GOOGLE_AUTH_ENABLED ? GOOGLE_CLIENT_ID : "",
      deviceAuth: DEVICE_AUTH_ENABLED,
    });
  }

  if (action === "google_login") {
    if (!GOOGLE_AUTH_ENABLED) return json({ ok: false, error: "google_auth_disabled" }, 403);
    try {
      const claims = await verifyGoogleIdToken(String(p.idToken ?? ""));
      const kv = await getKv();
      if (!kv) return json({ ok: false, error: "kv_unavailable" });
      const user = await findAndBindGoogleUser(kv, claims);
      if (!user) {
        await writeAudit("google_login", String(claims.email || "unknown"), "", "denied", clientIp);
        return json({ ok: false, error: "access_denied" }, 403);
      }
      const iss = await issueToken(user.name || user.email, user.level, TTL_HOURS);
      let device = "";
      if (p.remember && DEVICE_AUTH_ENABLED) {
        device = newDeviceToken();
        const now = Date.now();
        const rec: DevRec = {
          n: user.name || user.email,
          l: user.level,
          ep: EPOCH,
          created: now,
          seen: now,
          ua: String(p.__ua || ""),
          uid: user.email,
        };
        await kv.set(["dev", device], rec, { expireIn: DEVICE_TTL_MS });
      }
      await writeAudit("google_login", user.email, "", "ok", clientIp, { level: user.level });
      return json({
        ok: true,
        token: iss.token,
        level: user.level,
        name: user.name || user.email,
        email: user.email,
        expires: iss.expires,
        device,
      });
    } catch (e) {
      console.warn("Google ID 토큰 검증 실패:", e instanceof Error ? e.message : String(e));
      await writeAudit("google_login", "unknown", "", "invalid_token", clientIp);
      return json({ ok: false, error: "google_auth_failed" }, 401);
    }
  }

  if (action === "login") {
    const started = Date.now();
    if (!SECRET) return json({ ok: false, error: "server_misconfigured" });
    if (!CREDS.length) return json({ ok: false, error: "no_credentials" });
    const rate = await loginRateStatus(clientIp);
    if (rate.blocked) {
      await sleep(Math.max(0, LOGIN_FAILURE_DELAY_MS - (Date.now() - started)));
      return json({ ok: false, error: "rate_limited", retryAfter: Math.ceil(rate.retryAfterMs / 1000) }, 429);
    }
    const hit = await matchCred(String(p.password ?? ""));
    if (!hit) {
      await recordLoginFailure(clientIp);
      await writeAudit("password_login", "unknown", "", "denied", clientIp);
      await sleep(Math.max(0, LOGIN_FAILURE_DELAY_MS - (Date.now() - started)));
      return json({ ok: false, error: "invalid_password" });
    }
    await clearLoginFailures(clientIp);
    const iss = await issueToken(hit.name, hit.level, TTL_HOURS);
    let device = "";
    if (p.remember && DEVICE_AUTH_ENABLED) {
      const kv = await getKv();
      if (kv) {
        device = newDeviceToken();
        const now = Date.now();
        const rec: DevRec = { n: hit.name, l: hit.level, ep: EPOCH, created: now, seen: now, ua: String(p.__ua || "") };
        await kv.set(["dev", device], rec, { expireIn: DEVICE_TTL_MS });
      }
    }
    await writeAudit("password_login", hit.name, "", "ok", clientIp, { level: hit.level });
    return json({ ok: true, token: iss.token, level: hit.level, name: hit.name, expires: iss.expires, device });
  }

  if (action === "verify") {
    const r = await verifyToken(String(p.token ?? ""));
    return json(r.ok ? { ok: true, level: r.level, name: r.name } : { ok: false, error: r.error });
  }

  if (action === "logout") {
    return json({ ok: true });   /* 서명 토큰은 무상태 — 클라이언트가 세션을 지운다 */
  }

  if (action === "device_login") {
    if (!DEVICE_AUTH_ENABLED) return json({ ok: false, error: "device_auth_disabled" }, 403);
    const kv = await getKv();
    if (!kv) return json({ ok: false, error: "kv_unavailable" });
    const dev = String(p.device ?? "");
    if (!dev) return json({ ok: false, error: "no_device" });
    const r = await kv.get<DevRec>(["dev", dev]);
    const v = r.value;
    if (!v) return json({ ok: false, error: "device_not_found" });
    if (Number(v.ep || 0) < EPOCH) { await kv.delete(["dev", dev]); return json({ ok: false, error: "revoked" }); }
    let name = v.n;
    let level = v.l;
    if (v.uid) {
      const user = (await kv.get<UserRec>(["user_email", v.uid])).value;
      if (!user || user.status !== "active") {
        await kv.delete(["dev", dev]);
        await writeAudit("device_login", v.uid, "", "revoked", clientIp);
        return json({ ok: false, error: "revoked" }, 403);
      }
      name = user.name || user.email;
      level = user.level; // 관리 화면에서 바꾼 최신 권한을 즉시 반영한다.
    }
    const iss = await issueToken(name, level, TTL_HOURS);
    await kv.set(["dev", dev], { ...v, n: name, l: level, seen: Date.now() }, { expireIn: DEVICE_TTL_MS });
    await writeAudit("device_login", v.uid || name, "", "ok", clientIp, { level });
    return json({ ok: true, token: iss.token, level, name, expires: iss.expires, device: dev });
  }

  if (action === "device_logout") {
    if (!DEVICE_AUTH_ENABLED) return json({ ok: false, error: "device_auth_disabled" }, 403);
    const kv = await getKv();
    if (kv) { const dev = String(p.device ?? ""); if (dev) await kv.delete(["dev", dev]); }
    return json({ ok: true });
  }

  if (action === "devices") {
    if (!DEVICE_AUTH_ENABLED) return json({ ok: false, error: "device_auth_disabled" }, 403);
    const gate = await requireAdmin(p);
    if (!gate.ok) return json(gate);
    const kv = await getKv();
    if (!kv) return json({ ok: false, error: "kv_unavailable" });
    const out: Array<Record<string, unknown>> = [];
    for await (const e of kv.list<DevRec>({ prefix: ["dev"] })) {
      const tok = String(e.key[1]);
      const did = (await sha256B64u(tok)).slice(0, 10);
      const v = e.value;
      out.push({ did, name: v.n, email: v.uid || "", level: v.l, created: v.created, seen: v.seen, ua: v.ua });
    }
    out.sort((a, b) => Number(b.seen || 0) - Number(a.seen || 0));
    return json({ ok: true, devices: out });
  }

  if (action === "users") {
    const gate = await requireAdmin(p);
    if (!gate.ok) return json(gate, gate.error === "forbidden" ? 403 : 401);
    const kv = await getKv();
    if (!kv) return json({ ok: false, error: "kv_unavailable" });
    await ensureGoogleUserSeed(kv);
    const users: Array<Record<string, unknown>> = [];
    for await (const e of kv.list<UserRec>({ prefix: ["user_email"] })) {
      const u = e.value;
      users.push({
        email: u.email,
        name: u.name,
        level: u.level,
        status: u.status,
        linked: !!u.sub,
        created: u.created,
        updated: u.updated,
        lastLogin: u.lastLogin || 0,
      });
    }
    users.sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email), "ko"));
    return json({ ok: true, users });
  }

  if (action === "audits") {
    const gate = await requireAdmin(p);
    if (!gate.ok) return json(gate, gate.error === "forbidden" ? 403 : 401);
    const kv = await getKv();
    if (!kv) return json({ ok: false, error: "kv_unavailable" });
    const audits: AuditRec[] = [];
    for await (const e of kv.list<AuditRec>({ prefix: ["audit"] }, { reverse: true, limit: 100 })) {
      audits.push(e.value);
    }
    audits.sort((a, b) => b.at - a.at);
    return json({ ok: true, audits: audits.slice(0, 100) });
  }

  if (action === "user_save") {
    const gate = await requireAdmin(p);
    if (!gate.ok) return json(gate, gate.error === "forbidden" ? 403 : 401);
    const kv = await getKv();
    if (!kv) return json({ ok: false, error: "kv_unavailable" });
    await ensureGoogleUserSeed(kv);
    const email = String(p.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: "invalid_email" }, 400);
    const level = Number(p.level);
    if (![1, 2, 3].includes(level)) return json({ ok: false, error: "invalid_level" }, 400);
    const status = p.status === "disabled" ? "disabled" : "active";
    const key: Deno.KvKey = ["user_email", email];
    const old = await kv.get<UserRec>(key);
    const now = Date.now();
    const user: UserRec = {
      email,
      sub: old.value?.sub,
      name: String(p.name || old.value?.name || "").trim(),
      level,
      status,
      created: old.value?.created || now,
      updated: now,
      lastLogin: old.value?.lastLogin,
    };
    await kv.set(key, user);
    await writeAudit("user_save", gate.name, email, "ok", clientIp, { level, status });
    return json({ ok: true, user: { email, name: user.name, level, status, linked: !!user.sub } });
  }

  if (action === "device_revoke") {
    if (!DEVICE_AUTH_ENABLED) return json({ ok: false, error: "device_auth_disabled" }, 403);
    const gate = await requireAdmin(p);
    if (!gate.ok) return json(gate);
    const kv = await getKv();
    if (!kv) return json({ ok: false, error: "kv_unavailable" });
    const did = String(p.did ?? "");
    let n = 0;
    for await (const e of kv.list<DevRec>({ prefix: ["dev"] })) {
      const tok = String(e.key[1]);
      if ((await sha256B64u(tok)).slice(0, 10) === did) { await kv.delete(e.key); n++; }
    }
    await writeAudit("device_revoke", gate.name, did, n ? "ok" : "not_found", clientIp, { revoked: n });
    return json({ ok: true, revoked: n });
  }

  if (action === "ping") {
    const fp = SECRET ? (await sha256B64u(SECRET)).slice(0, 8) : "";
    const kv = await getKv();
    return json({
      ok: true,
      ver: VER,
      mode: SECRET ? "signed" : "no_secret",
      fp,
      creds: CREDS.length,
      kv: kv !== null,
      deviceAuth: DEVICE_AUTH_ENABLED,
      googleAuth: GOOGLE_AUTH_ENABLED,
      originPolicy: ALLOWED_ORIGINS.size > 0 ? "allowlist" : "deny_browser",
      pong: new Date().toISOString(),
    });
  }

  return json({ ok: false, error: "unknown_action" });
}

Deno.serve(async (req: Request, info: Deno.ServeHandlerInfo) => {
  if (!originAllowed(req)) return withCors(json({ ok: false, error: "origin_not_allowed" }, 403), req);
  if (req.method === "OPTIONS") return withCors(new Response(null, { status: 204 }), req);

  try {
    const remote = info.remoteAddr as Deno.NetAddr;
    const clientIp = remote && typeof remote.hostname === "string" ? remote.hostname : "unknown";
    if (req.method === "POST") {
      let p: Record<string, unknown> = {};
      try { p = JSON.parse((await req.text()) || "{}"); } catch (_e) { p = {}; }
      p.__ua = req.headers.get("user-agent") || "";
      return withCors(await handleAction(String(p.action || ""), p, clientIp), req);
    }
    if (req.method === "GET") {
      const u = new URL(req.url);
      const action = u.searchParams.get("action") || "ping";
      const p: Record<string, unknown> = {};
      u.searchParams.forEach((v, k) => (p[k] = v));
      p.__ua = req.headers.get("user-agent") || "";
      return withCors(await handleAction(action, p, clientIp), req);
    }
    return withCors(json({ ok: false, error: "method_not_allowed" }, 405), req);
  } catch (err) {
    console.error("인증 요청 처리 오류:", err);
    return withCors(json({ ok: false, error: "server_error" }), req);
  }
});
