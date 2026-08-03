# GAS 배포 안내 — Core 통합 + 서명 토큰 하이브리드

이 문서는 Apps Script(.gs) 백엔드를 라이브에 반영하는 순서다.
**저장소의 `.gs` 는 사본**이고, Apps Script 편집기에 붙여넣고 **새 버전으로 배포**해야 실제로 반영된다.

## 실사용 백엔드 (통합 후 5개)

| 백엔드 | 역할 | 바인딩/소스 |
|---|---|---|
| **auth_gas** (+ baz_token_lib) | 로그인/검증 | 보안시트(Credentials·Tokens·LoginLog·**Config**) |
| **handover_gas** (Core) | 현장기록 + 병원정보DB(rich) + 이슈이력 + 메뉴·재고·ncare·주간·라벨 | 업무 스프레드시트 + openById(rich 병원정보DB·재고·NCARE·주간) |
| **ncare_dashboard_gas** | N-Care 대시보드 | 대시보드 스프레드시트 |
| **inspection_gas** | 점검접수 태스크 | inspection_tasks |
| **autodoc_gas / v2** | 문서 자동화(별도 도구) | 별도 |

**은퇴(배포 폐기):** `hospital_gas`(→handover hospdbrich), `hospital_issue_gas`(→handover issuehist), `visit_log_gas`, `chatbot_gas`.
데이터 GAS는 전부 `baz_token_lib.gs` 를 함께 넣는다(서명 검증·자가 프로비저닝·조각캐시 공통).

## 최초 1회 설정

1. **보안시트 ID 확보** — 보안시트(Credentials 등이 있는 스프레드시트)의 ID.
   `baz_token_lib.gs` 의 `BAZ_SECURITY_SHEET_ID` 에 넣거나, 각 데이터 GAS 스크립트 속성 `BAZ_SECURITY_SHEET_ID` 로 지정.
   (auth 프로젝트는 그 시트에 바인딩돼 있어 비워둬도 됨.)
2. **rich 병원정보DB ID 확보** — `hospital_gas` 편집기에서 `getActiveSpreadsheet().getId()` 실행 → 나온 ID를
   handover 의 `RICH_HOSPDB_SS_ID`(또는 handover 스크립트 속성 `RICH_HOSPDB_SS_ID`)에 넣는다.
3. **비밀 생성** — auth 프로젝트에서 **`bazEnsureSecret_()` 1회 실행** → 보안시트에 `Config` 탭이 생기고
   `TOKEN_SECRET`/`TOKEN_EPOCH` 가 기록된다. 데이터 GAS들은 여기서 **자동으로** 비밀을 읽어간다(수동 8곳 복붙 없음).
   ※ 각 데이터 GAS는 최초 1회 보안시트 접근 OAuth 승인이 필요(편집기에서 아무 함수나 실행 → 권한 허용).

## 배포 순서 (무중단 — 폴백이 순서 독립 보장)

1. **baz_token_lib.gs + 데이터 GAS(handover·ncare·inspection)** 먼저 배포
   → 서명 토큰을 로컬 검증할 준비. 아직 auth가 불투명이어도 폴백으로 정상 동작.
   → handover 에 `RICH_HOSPDB_SS_ID` 설정 필수(hospital-pc 지도·상태·S/N 소스).
2. **auth 프로젝트**: `bazEnsureSecret_()` 실행 → `auth_gas.gs`(+lib) 배포
   → 이때부터 **서명 토큰 발급**. `?action=ping` 이 `mode:'signed'` + `fp`(지문) 반환.
3. **정적 파일**(`auth.js`·`sw.js`·HTML) push → GitHub Pages 반영.
4. (선택) auth·handover 에 5분 keep-warm 시간트리거로 콜드스타트 완화.

## 배포 확인 (밖에서 curl)

- `인증GAS/exec?action=ping` → `{"mode":"signed","fp":"abcd1234",...}` — mode가 signed면 서명 발급 중.
- `handoverGAS/exec?action=ping` → `ver:"3.0.0"` (Core 확장 반영 확인).
- 각 데이터 GAS 편집기에서 `bazTokenSelfTest_()` 실행 시 로그의 **비밀 지문 앞 8자**가 auth의 `fp` 와
  **모두 같아야** 왕복 0(전부 로컬 검증). 다르면 그 프로젝트만 왕복(감속, 장애 아님).
- auth 편집기 `authSelfTime()` → 로그인/검증 단계별 실측 ms(목표 로그인 ≤2000ms).

## 무장애 안전장치 (설계 보장)

- auth에 비밀이 없어도 **불투명 토큰으로 로그인은 살아 있다**(로그인 불사).
- 데이터 GAS의 비밀이 어긋나도 **로컬 검증 실패 → 인증 왕복 폴백**으로 작동(락아웃 아님, 감속만).
- 일괄 로그아웃은 auth에서 `bazBumpTokenEpoch_()` 1회(보안시트 Config 한 곳 → 전 프로젝트 자동 반영).

## 프론트(GitHub Pages) 변경 요지

- `hospital-pc`·`weekly`·`handover` 의 병원정보DB/이슈이력 호출이 **handover(Core) 단일 백엔드**로 일원화.
- `hospital.html`·`dashboard.html`·`user_guide.html`·`chatbot.html` 제거(허브 타일은 -pc로 통합/비활성).
- `guide`·`survey` 는 로그인 없이 열람(페이지 가드 skip). 그 외 페이지는 세션 내 재진입 시 verify 왕복 0(5분 TTL).
