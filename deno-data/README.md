# BAZ 데이터 앞단 계층 — Deno Deploy 판 (handover Core GAS 감싸기)

로그인은 이미 Deno Deploy(`deno-auth`)로 옮겨 콜드스타트를 없앴다. 그런데 **hospital-pc 의
데이터 경로**(`hospdbrich`·`issuehist`·`progress`)는 아직 handover Core GAS 를 직접 호출해,
그 GAS 의 콜드스타트(30~50초)를 프런트가 방어 코드로 견디고 있었다.

이 서비스는 로그인 때와 같은 철학으로 **항상 켜진 Deno 계층이 기존 handover GAS 를 감싼다.**
데이터 GAS 는 그대로 유지(시트가 소스오브트루스)하고, 프런트는 로그인 때처럼 **데이터 URL 만**
이 서비스로 바꾼다(`hospital-pc.html` 의 `HANDOVER_URL` 한 곳).

```
[브라우저] ─조회(hospdbrich/issuehist)─▶ [Deno]  엣지 캐시(SWR)·즉시 응답, 콜드스타트 HTML 흡수
[브라우저] ─progress 폴링/쓰기·기타───▶ [Deno]  투명 프록시 → [handover GAS] (GAS 가 토큰 최종검증)
                                          [Deno]  Deno.cron 으로 GAS 1분마다 예열(keep-warm)
```

---

## 1. 왜 이걸로 안정성이 오르나

- **조회(hospdbrich·issuehist)**: 느리게 바뀌는 읽기 데이터다. Deno 가 모듈 메모리에 캐시해 즉시
  응답하고, 캐시가 만료돼 GAS 를 다시 부를 때 GAS 가 콜드스타트로 HTML·타임아웃을 주면 **직전 캐시를
  대신 돌려준다(SWR)**. → 프런트로 콜드스타트 HTML 이 새지 않아 '만료 배너 오탐'·빈 화면이 사라진다.
- **progress(실시간 협업 큐)**: 캐시 없이 투명 프록시. 항상 켜진 Deno 가 폴링을 계속 GAS 로 흘려보내
  GAS 인스턴스가 자연히 데워지고, `Deno.cron` 이 1분마다 예열해 콜드스타트 자체가 줄어든다.
  업스트림 실패는 'HTML 유사 502' 로 릴레이 → 프런트의 기존 재전송(fallback)·백오프 로직이 그대로
  판단한다(**쓰기 유실 없음**).
- **응답 형식이 GAS 와 동일**하므로 `hospital-pc.html` 의 파싱·캐시·폴링 코드는 무수정이다.

> Deno KV 는 값 하나가 64KiB 로 제한돼 큰 조회 응답에 부적합하다. 그래서 캐시는 **크기 제한이 없는
> 모듈 메모리**를 쓴다(항상 켜진 엣지라 가능). 지역·아이솔레이트별로 독립 캐시라 느린 읽기 데이터엔
> 문제없고, keep-warm·폴링 트래픽이 아이솔레이트를 데워 캐시 적중률을 높인다.

---

## 2. 사전 준비 — 감쌀 GAS 주소와 secret

1. **HANDOVER_URL** — 현재 `hospital-pc.html` 이 쓰던 handover Core GAS 의 `/exec` 주소를 확보한다
   (이 서비스가 감싸는 실제 백엔드). 파일 안 롤백 주석에도 남아 있다.
2. **TOKEN_SECRET / TOKEN_EPOCH** — 조회 캐시를 '엣지에서 토큰 검증 후' 서빙하려면 auth 와 **같은
   secret** 이 필요하다. 보안시트 `Config` 탭의 값을 복사(대개 EPOCH=1). `deno-auth` 에 넣은 값과 동일.
   - (선택) secret 없이 배포해도 된다 → 그때는 캐시가 꺼지고 **전부 투명 프록시**로만 동작한다
     (GAS 가 인증을 강제하므로 우회 없음, 락아웃도 없음). 캐시 이점을 보려면 secret 을 넣는다.

---

## 3. Deno Deploy 에 배포

`deno-auth` 와 **분리된 새 프로젝트**로 올린다(인증 서비스와 격리, 자격증명 불필요).

1. https://dash.deno.com → **New Project** → **Playground**(또는 이 리포 GitHub 연동).
   - GitHub 연동 시 **Entry point = `deno-data/main.ts`**.
   - Playground 면 `deno-data/main.ts` 내용을 통째로 붙여넣고 **Save & Deploy**.
2. **Settings → Environment Variables**:
   | 이름 | 값 |
   |---|---|
   | `HANDOVER_URL` | 감쌀 handover Core GAS `/exec` 주소 (필수) |
   | `TOKEN_SECRET` | auth·보안시트 Config 와 동일 값 (조회 캐시용, 권장) |
   | `TOKEN_EPOCH` | Config 값(대개 `1`) |
   | `CACHE_TTL_SEC` | 조회 캐시 신선도 초 (기본 `300`) |
   | `UPSTREAM_TIMEOUT_MS` | 업스트림 GAS 타임아웃 (기본 `25000`) |
3. 저장 후 재배포. 프로젝트 URL 확인 — 예: `https://yuyoung-data.yuyoung-ai.deno.net`.
   - `hospital-pc.html` 의 `HANDOVER_URL` 이 **이 주소와 같아야** 한다(4단계).

> KV 설정은 **불필요**하다(캐시는 메모리). `Deno.cron` 은 Deploy 에서 자동 동작한다.

---

## 4. 전환 — `hospital-pc.html` 의 URL 한 곳

`hospital-pc.html` 상단:
```js
const HANDOVER_URL='https://<프로젝트>.<조직>.deno.net';   // ← Deno 데이터 서비스 주소
// 롤백용 GAS: '.../macros/s/AKfyc.../exec'
```
`HANDOVER_CORE` 는 `HANDOVER_URL` 을 그대로 참조하므로 이 한 줄만 맞추면 된다.
커밋·push → GitHub Pages 반영 → **강력 새로고침(Ctrl+Shift+R)**.
handover GAS·`baz_token_lib.gs` 는 아무것도 안 바꾼다.

---

## 5. 배포 확인 (curl / 브라우저)

```
# 자체 진단(업스트림 안 감)
https://<프로젝트>.deno.net/?action=ping&self=1
→ {"ok":true,"ver":"deno-data-1.0.0","upstream":true,"cache":"on","fp":"UMwCPhSl","cached":0}
```
- `upstream:true` = HANDOVER_URL 설정됨. `cache:"on"` = secret 있어 조회 캐시 활성.
- **`fp` 가 auth ping 의 `fp` 와 같아야** secret 정합(조회 토큰 검증이 auth 토큰과 맞물림).

```
# 토큰 게이트 (secret 있을 때)
https://<프로젝트>.deno.net/?action=hospdbrich                 → {"success":false,"error":"unauthorized …"}
https://<프로젝트>.deno.net/?action=hospdbrich&token=<유효토큰> → {"success":true,"data":…}  (2번째부턴 캐시 즉시)

# progress 프록시 (그대로 GAS 로)
https://<프로젝트>.deno.net/?action=progress&rev=0&token=<유효토큰> → {"success":true,…} 또는 {"nochange":true,"rev":N}
```

---

## 6. 롤백 (문제 시 즉시)

`hospital-pc.html` 의 `HANDOVER_URL` 을 **롤백 주석의 GAS `/exec` 주소로 되돌리고** push.
응답·토큰 형식이 동일하므로 무중단. 이미 열린 세션도 그대로 유효하다.

---

## 7. 운영

- **캐시 신선도**: `CACHE_TTL_SEC`(기본 300초). 병원DB·이슈이력은 자주 안 바뀌므로 이 정도가 무난.
  즉시 반영이 필요하면 값을 줄이거나, 배포를 재시작해 메모리 캐시를 비운다.
- **전원 로그아웃(epoch bump)**: auth·보안시트와 함께 이 서비스의 `TOKEN_EPOCH` 도 같은 값으로 올린다
  (안 올리면 이전 epoch 토큰이 이 서비스의 조회 캐시 게이트를 계속 통과한다).
- **다른 모듈 확장**: weekly·handover·inspection·dashboard-pc 도 같은 방식으로 이 서비스를 앞에 둘 수
  있다. 새 조회를 캐시 대상에 넣으려면 `main.ts` 의 `CACHEABLE` 에 action 을 추가한다(실시간·쓰기성
  action 은 넣지 말 것 — 프록시로만).

---

## 8. 보안 메모

- 조회 캐시는 사용자 공통 데이터라 공유 캐시가 맞지만, **캐시를 서빙하기 전 반드시 엣지에서 토큰을
  로컬 HMAC 검증**한다(secret 필요). secret 이 없으면 캐시를 끄고 전부 프록시 → GAS 가 매번 인증한다.
- progress·POST 는 캐시하지 않으므로 GAS 가 항상 최종 인증한다.
- 응답은 CORS 허용(`*`, 쿠키 미사용). 이 서비스는 토큰을 저장하지 않는다(무상태 검증만).
