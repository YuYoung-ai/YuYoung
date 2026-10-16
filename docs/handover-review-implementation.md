# Handover 검수 구현 및 운영 전환

2026-10-16. 기존 인계서의 구현 범위 전체를 대상으로 한다. 사용자가 후속 지시에서 main 병합과 운영 배포까지 승인했다.

## 저장 경계와 실제 소비 경로

- `work-handover-review.ts`: 인증 UID와 관리자 등급을 모두 확인한다. `HANDOVER_REVIEW_ADMIN_UID` 미설정/불일치는 저장을 거절한다. 실제 UID와 토큰은 저장소에 기록하지 않는다.
- 본문 16필드는 `work-source-review.ts`의 `sourceFields`를 따른다. 원본/이전 유효 연동본, 공개 검수본, 버전별 전후 감사 이력, 동일 작업 영수증을 분리한다. 과거 최초값을 추정하지 않는다.
- 본문 확정은 Deno KV 원자적 commit이다. 본문 버전 CAS를 검사하며 최신 접수 객체를 다시 읽어 댓글·담당자 등 변경을 보존한다. 같은 operationId는 같은 제출 내용으로 재시도한다. 검수본·원본 아카이브·감사·접수/이력·변경분·GAS outbox·영수증을 함께 확정한다.
- 초안과 ✓ 적용은 브라우저에 남는다. 제출 중에는 입력을 고정하며 실패·충돌에도 입력을 유지한다. 기존 수정모드의 접수 상세와 전체 Handover 목록에서 미연결 기록도 편집한다. 편집 잠금은 사용하지 않는다.
- PDF는 생성 당시 sourceBasis와 파일 해시를 보존한다. 문서 레지스트리/문서 버전/첨부 재시도는 본문과 분리한다. 본문을 나중에 검수해도 기존 PDF를 재생성하거나 차이 경고로 막지 않는다.
- GAS `hwReviewApply_`는 원본 시트를 수정하지 않고 검수 전용 시트에 단조 증가 버전을 반영한다. `hwReviewRows_`는 all/recent/today/병원 이력/주간 보고/A/S 집계/사진 보고 소비에 검수본을 투영한다. 원본 수신 파서는 원본을 계속 읽어 순환 반영을 피한다. 적용 ack는 Deno의 적용 버전을 낮추지 않는다.
- 현장 저장은 기록 ID와 저장 내용 지문으로 중복/응답 유실을 구분한다. 저장 전 저널과 commit 후 캡처한 원본 스냅샷으로 저장 훅 중단을 복구한다. 전송 시에는 기록 존재를 다시 확인하되 현재 본문으로 저장 이벤트를 바꾸지 않는다.

## 자동 검증

32개 Node 검사 통과: work API/proxy/cache/KV/queue/bridge/indexes/matching/flow/ACL/notifications/document/review/GAS/report/PDF integrity, gas-sync P0/P1/P2 등 변경 범위 회귀 검사.

실제 Deno KV로 `deno task check`, `deno task test:review`, `deno task test:matching`, `deno task test:work-kv` 통과. 검수 검사는 UID 거절, 전환 장벽, 기존 정정본 보존, 동시 댓글, 두 창 충돌, 동일 작업 재시도와 다른 payload 거절, 무변경 저장, 원본 재전송 격리, 14KB 상한, 마스터/식별 필드 검증, PDF 독립화, 미연결 기록 및 늦은 GAS ack를 검사한다. 기존 setInterval fixture 누락은 1단계에서 보완했다.

## 활성화 순서

1. 현재 GAS 네 파일과 배포 버전을 백업한다. Script Properties, 기존 웹앱 URL과 접근 설정은 보존한다.
2. Deno/UI를 배포한다. 검수 정책은 기본 비활성이므로 관리자 UID가 없어도 기존 조회는 계속된다.
3. 기존 GAS 프로젝트의 `Code.gs`, `hospital_work_gas.gs`, `hospital_work_kv_gas.gs`, `handover_inspection_pdf_gas.gs`를 교체한다. 기존 웹앱 배포에 새 버전을 지정해 URL을 유지한다. `syncHospitalWorkKv` 주기 트리거를 확인하고 한 번 실행해 기존 대기열을 처리한다.
4. 관리자 화면이 표시하는 **인증된 계정 ID**를 Deno 운영 환경의 `HANDOVER_REVIEW_ADMIN_UID`로 설정하고 배포한다. 임의 이름·이메일을 UID로 추정하지 않는다.
5. schema 2, 10분 이내 상태, 원본 대기 0건/이벤트 0건/오류 없음/기존 병원별 수동 이력 편집 0건을 서버가 확인한 뒤 지정 관리자 화면에서 활성화한다. 기존 병원별 수동 편집이 있으면 원본을 보존한 채 활성화를 거절한다. 기록 ID별 명시적 매핑 없이 해당 데이터를 변환하거나 폐기하지 않는다.
6. 운영 정적 파일 버전, Deno ping, GAS ping(reviewSchema 2/documentRegistry 1), 관리자 설정/읽기, 동기화 상태와 실제 소비 화면을 확인한다. 실데이터를 임의로 수정해 테스트하지 않는다.

## 복구

검수 저장 장애 시 초안과 operationId를 유지하고 영수증을 조회한다. GAS 장애 시 Deno의 공개본은 유지되고 outbox를 재시도한다. 보고서 반영 실패를 앱 저장 실패로 바꾸지 않는다. 원본과 검수 시트, 문서 대기열을 지우지 않는다.

운영 문제 시 우선 지정 UID 설정을 제거해 새 검수 쓰기를 중단하고 원인을 확인한다. 이미 확정된 KV 데이터를 덮어쓰는 구버전 서버로 무조건 되돌리지 않는다. GAS는 백업된 기존 배포 버전을 선택할 수 있지만 검수 결과를 읽지 못하므로 보고서 표시가 이전 기준으로 돌아감을 함께 고려한다. 원본 재전송 보호와 문서 호환을 유지하는 수정 배포를 우선한다.

운영 배포 결과는 후속 배포 기록에 남긴다.
