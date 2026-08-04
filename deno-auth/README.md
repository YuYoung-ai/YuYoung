# BAZ 로그인 서버 — Deno Deploy 판 (GAS auth 대체)

로그인 발급기를 **콜드스타트가 없는 Deno Deploy**로 옮겨 "첫 로그인 30~50초" 문제를 없앤다.
토큰은 기존 `baz_token_lib.gs`와 **100% 동일한 HMAC-SHA256 서명 형식**으로 발급하므로,
**데이터 GAS 8개와 프런트는 한 줄도 바꿀 필요가 없다.** 바꾸는 것은 `auth.js`의 `AUTH_URL` 한 곳뿐.

```
[브라우저] ──login/verify──▶ [Deno Deploy]  (콜드스타트 없음, 즉시 토큰 발급)
[브라우저] ──데이터 요청──▶ [데이터 GAS]   (토큰을 로컬 HMAC 검증 — auth 안 부름 · 무수정)
```

---

## 1. 왜 이걸로 고쳐지나

재설계로 데이터 GAS가 토큰을 **스스로(로컬) 검증**하게 되면서, auth를 깨워 두던 검증 왕복이
사라졌다 → auth는 로그인 때만 호출돼 잠들고 → 첫 로그인이 콜드스타트. keepWarm/prewarm은
임시방편이고 GAS 트리거 시간 한도(일반 계정 90분/일)에 걸린다. Deno Deploy는 엣지에서 상시
실행돼 **콜드스타트 자체가 없다.**

---

## 2. 사전 준비 — 기존 secret 값 확보

Deno가 발급하는 토큰을 데이터 GAS가 검증하려면 **같은 TOKEN_SECRET**을 써야 한다.

1. **보안 스프레드시트**(Credentials·Tokens가 있는 시트) → **`Config` 탭** 열기.
2. `TOKEN_SECRET`, `TOKEN_EPOCH` 값을 복사(대개 EPOCH=1).
3. (확인용) 지금 auth의 `?action=ping` 응답의 `fp` 값을 적어 둔다 — 나중에 Deno ping의 `fp`와
   **같아야** secret이 올바르게 복사된 것.

---

## 3. 계정 목록(CREDENTIALS) 만들기

기존 `Credentials` 시트의 (비밀번호·레벨·이름)을 JSON 배열로 옮긴다. **비밀번호는 해시 저장을 권장.**

각 계정에 대해 (Deno가 설치돼 있으면):
```bash
deno run deno-auth/hash.ts '실제비밀번호' '홍길동' 2
# → {"pwsha":"...","level":2,"name":"홍길동"}
```
이 줄들을 배열로 모은다:
```json
[
  {"pwsha":"...","level":1,"name":"일반담당자"},
  {"pwsha":"...","level":2,"name":"관리자"}
]
```
> 급하면 평문도 가능(권장하지 않음): `[{"pw":"평문","level":1,"name":"..."}]`.
> Deno Deploy 환경변수는 암호화 저장되지만, 해시가 더 안전하다.

---

## 4. Deno Deploy 에 배포

가장 간단한 경로(대시보드 Playground):

1. https://dash.deno.com → **New Project** → **Playground**(빈 프로젝트).
2. `deno-auth/main.ts` 내용을 통째로 붙여넣고 **Save & Deploy**.
3. **Settings → Environment Variables** 에 추가:
   | 이름 | 값 |
   |---|---|
   | `TOKEN_SECRET` | (2단계에서 복사한 값 — 반드시 동일) |
   | `TOKEN_EPOCH` | (Config의 값, 대개 `1`) |
   | `TOKEN_TTL_HOURS` | `12` |
   | `CREDENTIALS` | (3단계 JSON 배열) |
4. 저장 후 재배포. 프로젝트 URL을 확인한다 — 예: `https://baz-auth.deno.dev`.

> GitHub 연동 배포를 원하면: New Project → 이 리포 선택 → Entry point `deno-auth/main.ts`.
> 이후 push 마다 자동 배포. 환경변수는 동일하게 설정.

---

## 5. 배포 확인 (auth.js 바꾸기 전에)

브라우저나 curl로:
```
https://<프로젝트>.deno.dev/?action=ping
→ {"ok":true,"ver":"deno-1.0.0","mode":"signed","fp":"UMwCPhSl","creds":6,...}
```
- **`fp` 가 기존 auth ping의 `fp`와 같아야 한다** → secret 정합 확인(가장 중요).
- `mode:"signed"`, `creds` 가 계정 수와 일치.

로그인도 테스트:
```
POST https://<프로젝트>.deno.dev/   body: {"action":"login","password":"실제비밀번호"}
→ {"ok":true,"token":"...","level":2,"name":"...","expires":"..."}
```

---

## 6. 전환 — `auth.js` 의 AUTH_URL 한 줄

`auth.js` 상단:
```js
var AUTH_URL = 'https://<프로젝트>.deno.dev';   // ← Deno Deploy 주소로 교체
```
> 끝에 `/exec` 안 붙인다(그건 GAS 형식). Deno는 루트 경로가 곧 엔드포인트다.

커밋·push → GitHub Pages 반영 → **강력 새로고침(Ctrl+Shift+R)**.
데이터 GAS·`baz_token_lib.gs`는 **아무것도 안 바꾼다.**

---

## 7. 확인

- 로그인 화면 F12 Console: `[로그인 소요]` 가 **수백 ms~1초 내**, 콜드스타트 재시도 없음.
- 로그인 후 각 도구(handover·inspection 등)가 정상 열림 = 데이터 GAS가 Deno 토큰을 검증 중.

---

## 8. 롤백 (문제 시 즉시)

`auth.js` 의 `AUTH_URL` 을 **기존 GAS `/exec` 주소로 되돌리고** push.
토큰 형식이 동일하므로 이미 로그인한 세션도 그대로 유효하다. 무중단 롤백.

---

## 9. 운영

- **전원 강제 로그아웃**: 보안시트 Config 의 `TOKEN_EPOCH` 를 +1 하고(= 데이터 GAS 반영),
  **Deno 의 `TOKEN_EPOCH` 환경변수도 같은 값으로** 올린다(= 새 로그인이 새 epoch로 발급).
  둘 중 하나만 올리면 로그인이 즉시 무효화되니 **둘 다** 맞춘다.
- **비밀번호 변경/추가**: Deno 의 `CREDENTIALS` 환경변수를 수정(재배포). (기존 GAS Credentials
  시트는 롤백용으로 남겨 둬도 무방하나, 실사용 경로는 Deno가 된다.)
- **비밀 교체**: 새 secret 을 데이터 GAS(Config)와 Deno(`TOKEN_SECRET`) 양쪽에 동일 반영.

---

## 10. 보안 메모

- 비밀번호는 `pwsha`(SHA-256) 저장 권장. 평문 `pw` 는 마이그레이션 편의용.
- 응답은 항상 JSON, CORS 허용(쿠키 미사용이라 `*`). 토큰은 서명식이라 서버 상태 0.
- 무차별 대입 방어가 필요하면 Deno KV 기반 레이트리밋을 추가할 수 있다(현재 미포함 — 강한
  비밀번호로 대응). GAS 판도 레이트리밋은 없었으므로 보안 수준은 최소한 동등하다.

---

## 11. 기기 자동 로그인 (선택 기능, 기본 OFF)

휴대폰으로 **한 번만 로그인하면 그 기기를 기억**해, 다음부터는 비밀번호 없이 자동 로그인한다.
기기 토큰은 Deno KV 에 등록되며 **30일 슬라이딩**(사용할 때마다 갱신), 분실 기기는 개별 해지 가능.

> **현재 상태: 코드만 들어가 있고 꺼져 있다.** `auth.js` 의 `var DEVICE_REMEMBER = false;` 라
> 지금 동작은 예전과 100% 동일하다(매 세션 로그인). 아래 절차로 **준비 → 스위치 ON** 하면 적용된다.

### 동작 방식
- 로그인 화면의 **'이 기기 기억하기'** 체크(개인폰만 권장) → 서버가 기기 토큰 발급 → `localStorage` 저장.
- 다음 접속 시 세션이 없으면 기기 토큰으로 **자동 로그인**(비밀번호 불필요). 도구엔 기존과 동일한
  세션 토큰을 넘기므로 **데이터 GAS 무수정**.
- **로그아웃**을 누르면 그 기기 기억도 함께 해제된다.

### 켜는 절차
1. **Deno 에 KV 사용 설정** — Deploy 콘솔에서 이 앱에 KV(Databases)를 활성화한다.
   (앱 코드는 `Deno.openKv()` 를 쓴다. KV 가 없으면 기기 기능만 조용히 비활성되고 일반 로그인은 정상.)
2. **`main.ts` 재배포** (이 저장소 main 에 이미 반영 — Production 이 자동 재배포). 확인:
   `AUTH_URL/?action=ping` 응답에 **`"kv":true`** 가 보이면 준비 완료(`false` 면 1번 KV 설정 필요).
3. **스위치 ON** — `auth.js` 에서 `var DEVICE_REMEMBER = true;` 로 바꾸고 push.
   `sw.js` 의 `CACHE_VERSION` 도 한 단계 올려 새 `auth.js` 를 확실히 반영.
4. 휴대폰에서 '이 기기 기억하기' 체크 후 1회 로그인 → 다음 접속부터 자동 로그인 확인.

### 기기 관리(분실·해지) — 관리자(Lv.3) 토큰 필요
- 목록: `POST {action:'devices', token:<Lv.3 토큰>}` → `{devices:[{did,name,level,created,seen,ua}]}`
- 해지: `POST {action:'device_revoke', token:<Lv.3 토큰>, did:<목록의 did>}`
- 전원 해지: `TOKEN_EPOCH` bump(9번) — 기억된 기기도 함께 무효화된다(다음 자동로그인 거부).

### 보안 메모
- 기기 토큰은 `localStorage`(JS 접근형)라 XSS 에 노출될 수 있다(현재 세션 토큰과 동일 수준).
- **공용 PC 에서는 체크하지 말 것.** 관리자(Lv.3) 계정은 자동로그인을 지양하거나 짧게 운영 권장.
- 유효기간은 Deno 환경변수 `DEVICE_TTL_DAYS`(기본 30) 로 조정.
