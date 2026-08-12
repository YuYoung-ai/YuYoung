# BAZ 로그인 서버 — Deno Deploy 판 (GAS auth 대체)

로그인 발급기를 **콜드스타트가 없는 Deno Deploy**로 옮겨 "첫 로그인 30~50초" 문제를 없앤다.
토큰은 기존 `baz_token_lib.gs`와 **100% 동일한 HMAC-SHA256 서명 형식**으로 발급하므로,
**데이터 GAS 8개는 바꿀 필요가 없다.** 비밀번호 로그인과 선택적 Google 로그인이 모두 같은 토큰을 발급한다.

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
   | `TOKEN_TTL_HOURS` | `6` |
   | `CREDENTIALS` | (3단계 JSON 배열) |
   | `ALLOWED_ORIGINS` | `https://yuyoung-ai.github.io` (여러 개면 쉼표 구분) |
   | `DEVICE_AUTH_ENABLED` | `true` (서버 기기 로그인 사용 여부) |
   | `LOGIN_RATE_MAX` | `5` |
   | `LOGIN_RATE_WINDOW_SEC` | `300` |
   | `LOGIN_RATE_BLOCK_SEC` | `300` |
   | `LOGIN_FAILURE_DELAY_MS` | `350` |
   | `AUDIT_RETENTION_DAYS` | `180` (7~730일) |
   | `GOOGLE_CLIENT_ID` | Google 웹 OAuth 클라이언트 ID(선택) |
   | `GOOGLE_AUTH_ENABLED` | `true` (client ID가 있을 때만 활성) |
   | `GOOGLE_USERS` | 최초 허용 사용자 JSON 배열(선택, 아래 12절) |
4. 저장 후 재배포. 프로젝트 URL을 확인한다 — 예: `https://baz-auth.deno.dev`.

> GitHub 연동 배포를 원하면: New Project → 이 리포 선택 → Entry point `deno-auth/main.ts`.
> 이후 push 마다 자동 배포. 환경변수는 동일하게 설정.

---

## 5. 배포 확인 (auth.js 바꾸기 전에)

브라우저나 curl로:
```
https://<프로젝트>.deno.dev/?action=ping
→ {"ok":true,"ver":"deno-1.2.0-security","mode":"signed","fp":"UMwCPhSl","creds":6,"kv":true,"deviceAuth":true,"googleAuth":true,"originPolicy":"allowlist",...}
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
- **기기 로그인 긴급 중지**: `DEVICE_AUTH_ENABLED=false` 로 저장·재배포한다. `auth.js`의
  `DEVICE_REMEMBER`는 화면 노출 스위치일 뿐 서버 보안 스위치가 아니다.
- **Origin 추가**: 새 정적 호스트나 로컬 개발 주소를 쓸 때만 `ALLOWED_ORIGINS`에 정확한 Origin을
  쉼표로 추가한다. 경로는 넣지 않는다(예: `http://localhost:8080`).

---

## 10. 보안 메모

- 비밀번호는 현재 `pwsha`(SHA-256)만 운영 입력으로 사용하고 평문 `pw`는 신규 등록하지 않는다.
  사용자 ID·Google 로그인 전환 단계에서 사용자별 salt가 있는 느린 해시로 교체한다.
- 브라우저 CORS는 `ALLOWED_ORIGINS`의 정확한 Origin만 허용한다. Origin 없는 GAS 서버 호출과
  명령줄 점검은 유지된다. CORS는 비브라우저 공격 방어가 아니므로 로그인 제한과 함께 쓴다.
- 로그인 실패는 Deno KV에 원 IP가 아닌 비밀 기반 해시 키로 집계한다. 기본값은 같은 IP에서
  5회 실패하면 5분 잠금이며 실패 응답은 최소 350ms 지연된다. KV 장애 시에는 일반 로그인을
  막지 않고 제한 기능만 일시적으로 건너뛴다.
- 내부 오류 상세는 Deno 로그에만 남기고 클라이언트에는 `server_error`만 반환한다.
- 로그인 성공·실패, 사용자 변경, 기기 로그인·해지는 Deno KV 감사 기록에 남는다. 원 IP와
  비밀번호는 저장하지 않고, 기기 구분용 비가역 해시만 보관하며 기본 180일 뒤 자동 삭제된다.

---

## 11. 기기 자동 로그인 (현재 사용 중)

휴대폰으로 **한 번만 로그인하면 그 기기를 기억**해, 다음부터는 비밀번호 없이 자동 로그인한다.
기기 토큰은 Deno KV 에 등록되며 **30일 슬라이딩**(사용할 때마다 갱신), 분실 기기는 개별 해지 가능.

> **현재 상태: 켜져 있다.** `auth.js`의 `DEVICE_REMEMBER=true`가 체크박스와 자동 시도를 켜고,
> Deno의 `DEVICE_AUTH_ENABLED=true`가 서버 엔드포인트를 허용한다. 긴급 중지에는 반드시
> 서버 환경변수를 `false`로 바꾼다. 프런트 플래그만 꺼도 이미 발급된 기기 토큰은 서버에서 유효하다.

### 동작 방식
- 로그인 화면의 **'이 기기 기억하기'** 체크(개인폰만 권장) → 서버가 기기 토큰 발급 → `localStorage` 저장.
- 다음 접속 시 세션이 없으면 기기 토큰으로 **자동 로그인**(비밀번호 불필요). 도구엔 기존과 동일한
  세션 토큰을 넘기므로 **데이터 GAS 무수정**.
- Google 로그인으로 기억한 기기는 허용 사용자와 연결된다. 관리자가 사용자를 중지하거나 레벨을
  바꾸면 다음 자동 로그인부터 즉시 차단하거나 최신 레벨을 반영한다.
- **로그아웃**을 누르면 그 기기 기억도 함께 해제된다.

### 켜기·확인 절차
1. **Deno 에 KV 사용 설정** — Deploy 콘솔에서 이 앱에 KV(Databases)를 활성화한다.
   (앱 코드는 `Deno.openKv()` 를 쓴다. KV 가 없으면 기기 기능만 조용히 비활성되고 일반 로그인은 정상.)
2. **`main.ts` 재배포** (이 저장소 main 에 이미 반영 — Production 이 자동 재배포). 확인:
   `AUTH_URL/?action=ping` 응답에 **`"kv":true`** 가 보이면 준비 완료(`false` 면 1번 KV 설정 필요).
3. **서버 스위치 ON** — Deno 환경변수 `DEVICE_AUTH_ENABLED=true`를 설정한다.
4. **프런트 스위치 ON** — `auth.js` 에서 `var DEVICE_REMEMBER = true;` 로 바꾸고 push.
   `sw.js` 의 `CACHE_VERSION` 도 한 단계 올려 새 `auth.js` 를 확실히 반영.
5. 휴대폰에서 '이 기기 기억하기' 체크 후 1회 로그인 → 다음 접속부터 자동 로그인 확인.

### 기기 관리(분실·해지) — 관리자(Lv.3) 토큰 필요
- 목록: `POST {action:'devices', token:<Lv.3 토큰>}` → `{devices:[{did,name,email,level,created,seen,ua}]}`
- 해지: `POST {action:'device_revoke', token:<Lv.3 토큰>, did:<목록의 did>}`
- 전원 해지: `TOKEN_EPOCH` bump(9번) — 기억된 기기도 함께 무효화된다(다음 자동로그인 거부).

### 보안 메모
- 기기 토큰은 `localStorage`(JS 접근형)라 XSS 에 노출될 수 있다(현재 세션 토큰과 동일 수준).
- **공용 PC 에서는 체크하지 말 것.** 관리자(Lv.3) 계정은 자동로그인을 지양하거나 짧게 운영 권장.
- 유효기간은 Deno 환경변수 `DEVICE_TTL_DAYS`(기본 30) 로 조정.

---

## 12. 개인 Google 계정 로그인과 허용 사용자

Google은 계정 소유자를 인증하고, 실제 서비스 접근 허용·레벨은 Deno KV가 결정한다. Google 로그인에
성공했더라도 KV 허용 명단에 없으면 `access_denied`로 거부한다. 이메일은 최초 연결용이고 이후에는
Google의 불변 식별자 `sub`를 사용자에게 묶는다.

### 초기 설정

1. Google Cloud의 웹 OAuth 클라이언트에서 서비스 Origin을 승인한다.
2. Deno `GOOGLE_CLIENT_ID`에 같은 웹 클라이언트 ID를 넣는다.
3. `GOOGLE_AUTH_ENABLED=true`로 둔다.
4. 최초 허용 사용자를 `GOOGLE_USERS`에 넣는다.

```json
[
  {"email":"member1@gmail.com","level":1,"name":"홍길동"},
  {"email":"manager@gmail.com","level":3,"name":"김관리"}
]
```

`GOOGLE_USERS`는 KV가 비어 있을 때 **한 번만** seed된다. `google_users_seed_v1` 마커가 생긴 뒤에는
환경변수를 다시 읽어 사용자를 복구하지 않으므로 관리자가 중지한 사용자가 재배포로 부활하지 않는다.
이후 추가·권한 변경·사용 중지, 기억된 기기 해지, 최근 감사 기록 확인은 허브의
**보안 관리(Lv.3)** 화면에서 처리한다.

### 서버 검증

- Google 공개키(JWKS)로 RS256 서명을 검증하고 `kid` 교체 시 공개키를 한 번 갱신한다.
- `iss`, `aud`, `exp`, `iat`, `email_verified`, `sub`를 모두 검사한다.
- `aud`는 반드시 Deno의 `GOOGLE_CLIENT_ID`와 일치해야 한다.
- 프런트가 보낸 이메일이나 레벨은 신뢰하지 않는다. 검증된 ID 토큰과 KV 사용자만 사용한다.

### 단계적 전환

Google 로그인과 기존 비밀번호 로그인은 함께 동작한다. 전 사용자가 노트북·휴대폰에서 각각 한 번씩
Google 로그인을 완료한 뒤 비밀번호 일반 계정을 제거한다. Google 장애에 대비한 비상 Lv.3 계정 하나는
자동 로그인 없이 별도로 보관한다.
