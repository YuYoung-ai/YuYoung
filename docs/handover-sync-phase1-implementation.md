# Handover 구현 현황 — 1단계 공통 안정화

검증일: 2026-10-16 (한국시간)

브랜치: `codex/handover-review-plan-20261016`

시작 기준: 당시 최신 main과 인계 기준이 모두 `f4429af2b143ed0ab83f10c790d731bb02ddd5f8`. 시작 시 로컬 변경 없음. 저장소와 상위 작업 폴더에 적용되는 AGENTS.md 없음. 최종 저장 전 main의 PR #247 (`f9272ec2fab84df18bd0c2350f3d523f4a177b23`)을 확인해 인계 브랜치에 통합했다.

이 문서는 [구현 인계서](codex-handover-implementation-handoff.md)의 단계별 PR 중 첫 구현 범위를 기록한다. **관리자 본문 검수·PDF 독립화·보고서 검수본 적용은 아직 구현하지 않았다. main 병합·운영 배포·GAS 트리거 변경도 수행하지 않았다.**

## 구현한 범위

- 일반 동기화 버튼에서 `work_handover_refresh` 선행 호출을 제거했다. KV `work_sync`는 자동 연결이나 원본 수신을 실행하지 않는다.
- 변경분의 첫 seq 상한을 후속 페이지에도 전달한다. 모든 페이지가 성공해야 목록과 revision을 확정하며, 중간 실패 시 기존 revision을 유지한다. 커서 정지는 중단하고 구조화된 `REVISION_INVALID`만 전체 조회로 1회 복구한다. 계정 변경 뒤 도착한 목록 응답은 적용하지 않는다.
- 접수 생성·수정·상태 변경·삭제·복원의 방문 범위와 원본 수신 범위를 KV 트랜잭션 안에서 자동 연결 작업으로 저장한다. 이전/새 병원·방문일 모두 예약해 조건 이동과 삭제 뒤 후보 변화를 다시 확인한다.
- `work-matching.ts`가 방문 인덱스로 해당 범위만 처리한다. 작업별 token/CAS로 오래된 완료가 새로운 대기 작업을 지우지 못하게 하고, 실패는 지연을 늘려 최대 5분 간격으로 재시도한다. 한 실행은 최대 20개 방문 작업을 처리하고 오래된 due 포인터 정리는 최대 60개까지 진행한다.
- 기존 Deno 분 단위 cron에 실제 처리기를 연결했다. 원본 수신·기존 접수 수정·복원 후에도 즉시 처리를 시도한다. 새 접수는 저장과 작업 예약을 함께 확정하고 cron이 후속 처리하므로 저장 응답이 자동 연결 완료를 뜻하지 않는다.
- 기존 데이터의 누락 연결은 **cron에서만** 접수 16개씩 커서를 저장하며 한 번 보완한다. 일반 목록과 원본별 수신은 이 전환 스캔을 실행하지 않는다. 기존 sourcePending/PDF 처리도 유지하며 대기열을 삭제하지 않는다.
- GAS 저장 훅은 잠금 안에서 원본 이벤트까지만 저장한다. 상태 게시 HTTP는 `doPost`의 잠금 해제 뒤 실행하고, 실패하면 주기 작업에 맡긴다. 이미 직렬화한 성공 응답과 멱등 영수증은 변경하지 않는다.
- GAS 원본 대기열은 배치 시작 때 인덱스를 한 번 구성한다. 전송은 현재 행의 내용으로 바꾸지 않고 저장된 JSON/버전을 그대로 보낸다. 현재 원본의 존재·중복 ID·삭제는 재확인하며, 전송 중 변경/복원된 행은 이전 응답으로 완료 처리하지 않는다. 배치 상한 20은 전달하는 스냅샷 수에 적용한다.
- Deno 실제 KV에서 기존 `work-indexes.write()`의 Promise 변환 실패를 재현했다. 최종 저장 전 확인한 main PR #247이 같은 문제를 해결하므로 해당 `writeState()` 구현과 강화된 테스트 모형을 통합했다. 별도 중복 수정은 남기지 않는다.
- 프런트 변경에 맞춰 SW 캐시 버전을 v247로 올렸다.

## 기준선과 검사 결과

환경: Node v24.19.0, 공식 Deno v2.9.7 (프로젝트 밖 `work/` 도구 폴더에만 다운로드). 실제 운영 KV/Sheets/Drive에 연결하지 않았다.

시작 시 기존 7개 중 6개 통과, `work-ui-cache`는 인계서에 적힌 `setInterval` 누락으로 실패했다. 타이머·visibility·종료 fixture와 오늘 근무 조회를 모델링했다. 이후 드러난 예전 화면 요소 기대값도 현재 상태 지표·상세 필터·근무 캘린더 구조로 수정했다. 기능 코드를 삭제해 통과시키지 않았다.

`deno-work-proxy`의 간헐 응답 불일치도 재현했다. 테스트가 첫 요청의 fetch 진입만 기다리고 gate를 풀어, 두 번째 요청의 실제 인증/해시 계산 완료 전에 첫 요청이 끝날 수 있었다. VM 안에서 합류 지점을 관찰해 두 요청이 모두 도착한 뒤 gate를 풀었다. 응답 전체 일치·coalesced 표시·다른 계정 분리 assertion은 유지했고 보완 후 **5회 연속 통과**했다. 운영 코드의 응답 보관 시간을 늘리는 변경은 하지 않았다.

다음 **Node 스크립트 24개가 모두 통과**했다. 각 항목은 `node test/<이름>.mjs`로 실행한다.

| 검사 범위 | 스크립트 |
|---|---|
| 인계 기준선 7개 | `work-api-transport`, `work-source-refresh-gas`, `work-ui-cache`, `deno-work-proxy`, `work-kv`, `work-pdf-attachments`, `work-source-updates` |
| GAS 대기열/저장 경계 | `work-queue`, `work-queue-save`, `work-queue-source-deleted` |
| 중계/인덱스/이전 | `work-bridge`, `work-indexes`, `work-flow-import`, `work-flow-relink` |
| 기존 원본 확인/문서/알림/근무 | `work-source-review`, `work-document-flow`, `work-notifications`, `work-notification-auth`, `work-notification-launch`, `work-roster-ui`, `workspace-roles` |
| 현장 저장 무결성 | `handover-integrity` (196/196), `handover-workflow` |
| 신규 자동 연결 | `work-matching` |

추가 통과:

```text
deno task check
deno task test:matching
deno task test:work-kv
git diff --check
```

`test:matching`은 실제 Deno 메모리 KV에서 접수/작업 원자적 저장, 동시 처리기, 중복 없는 연결과 변경 없는 조회를 확인한다. Node 신규 검사는 원본 선도착→접수 생성, 조건 수정, 휴지통 복원, 보류 해제, 프로세스 재생성, 지연 재시도, 늦은 완료, 기존 기록의 커서 전환을 실행한다. 접수 100/1,000/10,000건의 변경 없는 조회에서 전체 접수·원본·자동 연결 스캔과 쓰기가 없는 것도 확인했다. UI 검사는 다중 페이지 중간 실패, 고정 상한, revision 복구, 인증/네트워크 오류, 커서 정지, 계정 변경을 포함한다.

GAS 검사는 실제 저장 훅과 `finally` 코드에서 잠금 보유 중 HTTP가 없고, 해제 실패 시 게시가 연기되며 게시 실패가 원본 성공을 되돌리지 않는지 확인한다. 스냅샷/버전, 삭제와 빈 행 뒤 ID, 복원 경합, 중복 ID, 읽기 실패와 전송 중 대기열 변경도 검증한다.

## 다음 단계용 필드와 소비 경로 조사

| 원본 | 현재 Deno source 필드 |
|---|---|
| 처리일 / 병원명 / CS 담당자 / 장비SN | `date` / `hospitalName` / `engineer` / `sn` |
| 점검/AS / 대분류 / 유형 | `gubun` / `cat` / `type` |
| 교체품 / 교체비용 / 내용 | `part` / `cost` / `detail` |
| 처리 결과 / 특이사항 | `result` / `remark` (현재 `HANDOVER_FIELD_COLS` 별칭 사용) |
| 노즐 재사용 / NS 평가 | `nozzleReuse` / `nsFill` / `nsAmt` / `jet` |
| 기록 ID / 지문 / PDF | `recordId` / `version` / `pdf` |

현재 `hwSource_()`는 PDF까지 포함해 version을 계산한다. 이번 단계에서 이 본문/문서 스키마를 바꾸지 않았다. `verifyToken().uid`는 존재하지만 Work Actor 전달과 지정 관리자 정책 역시 다음 단계다.

| 소비자 | 현재 경로와 후속 요구 |
|---|---|
| 접수 상세 | KV `history.source`; 현재 본문 편집은 없고 `work_result_save`는 연결/보완 메모 저장이다. |
| 접수 미연결 기록 | 원본 후보 선택 경로는 있으나 기존 수정모드의 본문 편집 진입점은 없다. 임의 접수를 생성하지 않았다. |
| 대시보드·주간 | `dashboard-pc.html` / `weekly.html` → `action=all` → `getAll_()` → `readAllMemo_().rows.map(slim_)`. 검수본 우선 조회가 필요하다. |
| A/S 보고 | `asreport.html` → `action=asreport` → `asReport_()`의 `readAll_(true).rows` 직접 소비. 공통 검수 조회에 별도로 연결해야 한다. |
| 병원 이슈 이력 | `getIssueHist_()` → `histDerivedRaw_()`와 별도 이슈 편집본 병합. 새 검수본과 중복 집계되지 않게 후속 검증이 필요하다. |

## 아직 남은 범위와 운영 확인

1. 단계 2: 인증 uid 전달·지정 관리자 설정, 원본/검수본 경계와 구버전 우회 차단, 본문 CAS, 검수 감사·반영 이벤트·저장 영수증, 크기 상한, 기존 유효한 정정본/미처리 이벤트의 전환 세대.
2. 단계 3: 기존 수정모드의 기록별 본문 입력, 로컬 초안·충돌 비교·저장 응답 유실 복구. 미연결 기록 접근 문제의 해결도 필요하다.
3. 단계 4: 본문과 PDF 버전 분리, PDF 최신 원본 비교 제거, 독립 문서 등록/연결과 생성 당시 파일 보존.
4. 단계 5: GAS 검수 저장소·버전별 적용·소비자 공통 조회, 순서 역전과 반영 실패 재개. 현재 기존 원본 갱신 동작은 유지되므로 검수본 보호 완료라고 해석하면 안 된다.
5. 브라우저 실기, 실제 운영 잠금/지연 로그, GAS 배포 코드·5분 트리거·Deno cron 실행, 관리자 uid는 확인하지 않았다. 실제 운영 성능 수치나 활성화 완료를 주장하지 않는다.

## 활성화 순서와 롤백

이 PR은 운영 활성화를 실행하지 않는다. 적용 시에는 Deno 저장/인덱스·작업 처리 코드를 먼저 배포하고 `deno-1.8.2-work-sync-jobs`, 분 단위 작업과 전환 커서 진행을 확인한다. GAS 파일 3개를 같은 프로젝트에 함께 반영하고 기존 `HOSPITAL_WORK_KV_STAGE=active`, `syncHospitalWorkKv` 트리거가 실제 새 코드를 실행하는지 확인한다. 기존 설정 이름과 서명 비밀값은 바꾸지 않는다. 마지막으로 프런트/SW를 적용하고 일반 계정에서 GAS 장애 중 목록, 신규 접수·복원·원본 선도착, 실제 PDF/댓글 회귀를 확인한다.

전환 중 기존 클라이언트는 여전히 GAS 선행 호출을 할 수 있으므로 SW 갱신을 확인한다. 검수 기능은 단계 2~5와 운영 확인이 끝나기 전에 활성화하지 않는다. 필요 시 프런트/SW를 먼저 이전 버전으로 되돌리고 호환 Deno 처리기를 유지한다. `matchPending`, `matchDue`, `matchBackfill`, 기존 원본·영수증·미처리 대기열을 삭제하거나 마이그레이션을 다시 seed하지 않는다. 이전 서버로 되돌려야 하면 미처리 작업은 보존하고 새 처리기를 복원했을 때 재개한다.
