/************************************************************
 * 비밀번호 해시 생성기 — CREDENTIALS 의 pwsha 값을 만든다.
 *   사용:  deno run deno-auth/hash.ts '평문비밀번호' ['이름' [레벨]]
 *   출력:  {"pwsha":"...","level":1,"name":"..."}  ← CREDENTIALS 배열에 넣을 한 줄
 *
 * pwsha = base64url( SHA-256( UTF-8(평문) ) )  — main.ts 의 sha256B64u 와 동일.
 ************************************************************/
function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const [pw, name = "", levelArg] = Deno.args;
if (!pw) {
  console.error("사용법: deno run deno-auth/hash.ts '비밀번호' ['이름' [레벨]]");
  Deno.exit(1);
}
const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw));
const pwsha = b64url(new Uint8Array(d));
const level = Number(levelArg) || 1;
console.log(JSON.stringify({ pwsha, level, name }));
