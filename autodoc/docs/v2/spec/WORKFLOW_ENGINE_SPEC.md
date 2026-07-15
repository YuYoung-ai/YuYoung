# Workflow Engine Spec — 결재 흐름 엔진

> **문서 상태**: 📋 설계만 (v2.5 Technical Specification · 미구현 · MVP 제외)
> **관련 문서**: [../WORKFLOW_ENGINE.md](../WORKFLOW_ENGINE.md)(개념) · [AUDIT_SPEC.md](AUDIT_SPEC.md) · [../ui/ADMIN_UX.md](../ui/ADMIN_UX.md)
> **한 줄 목적**: 문서 생성 이후 결재 흐름(작성→검토→승인→발송→보관)을 선언적 Workflow 정의로 실행하는 엔진 계약을 정의한다.

---

## 목차

1. [목적](#1-목적) · 2. [책임](#2-책임) · 3. [인터페이스](#3-인터페이스) · 4. [입력](#4-입력) · 5. [출력](#5-출력) · 6. [데이터 흐름](#6-데이터-흐름) · 7. [의존성](#7-의존성) · 8. [확장성](#8-확장성) · 9. [장점](#9-장점) · 10. [단점](#10-단점)

---

## 1. 목적

Workflow 정의(steps[])를 인스턴스로 실행하는 상태 머신 엔진. 사람 단계는 사람이, 시스템 단계는 이벤트로 위임한다. Template별로 다른 Workflow를 연결한다. **MVP 제외** — 생성까지가 MVP.

## 2. 책임

| 책임 | 규칙 |
|---|---|
| 인스턴스 실행 | 문서 1건마다 Workflow 인스턴스 · 단계 진행·상태 추적 |
| 단계 타입 | human(사람)/system(이벤트 위임)/gateway(전자결재 Plugin)/condition(Rule 평가) |
| 전이 | complete/reject → next/rejectTo 단계 이동 · 사유 기록 |
| 시스템 단계 | generate-pdf/send-mail/archive → 이벤트 발행(발송은 Mail Plugin) |
| 기한·에스컬레이션 | 단계 기한 초과 시 알림(Plugin) |

## 3. 인터페이스

| 연산(개념) | 서명 |
|---|---|
| 시작 | `start(workflowId, documentRef) → instanceId` |
| 진행 | `complete(instanceId, stepId, decision, comment?)` |
| 상태 | `status(instanceId) → { currentStep, history[] }` |
| 정의 등록 | `register(workflow)` (Human Approval + Audit) |

## 4. 입력

Workflow 정의(`workflow.v1` — [JSON_SCHEMA.md](JSON_SCHEMA.md)) · 문서 참조 · 단계 결정(사람) · 역할→사용자 매핑.

## 5. 출력

단계 전이 · `workflow.step.completed`/`workflow.completed` 이벤트 · Audit 레코드 · 시스템 단계 위임 이벤트.

## 6. 데이터 흐름

```
document.generated → Workflow 조회 → start(인스턴스)
  → human 단계: 승인/반려(사유) → step.completed + Audit
  → system 단계: 이벤트 위임(PDF/메일/보관)
  → condition 단계: Rule 평가 → 분기
  → 최종 → workflow.completed → Replay 봉인
```

```mermaid
stateDiagram-v2
    [*] --> 작성
    작성 --> 검토
    검토 --> 팀장승인: 통과
    검토 --> 작성: 반려
    팀장승인 --> PDF생성: 승인
    PDF생성 --> 메일발송 --> 보관 --> [*]
```

## 7. 의존성

workflow(Enterprise) → bus(단계 이벤트) · store(정의·인스턴스) · rule-engine(condition 단계) · plugin-host(gateway·notify). Human Approval의 다단계 승인이 본 엔진 체인 재사용([../HUMAN_APPROVAL.md](../HUMAN_APPROVAL.md) §5).

## 8. 확장성

- 단계 타입 추가(parallel 병렬 합의 📋) = 타입 카탈로그 + 실행 규칙.
- gateway로 전환 시 사내 전자결재 위임 — 정의만 수정, 엔진 무수정.
- condition이 Rule Engine 재사용 — 금액 임계 등 분기.

## 9. 장점

1. **선언적 결재** — Template마다 다른 경로를 코드 없이 구성.
2. **추적성** — 문서 위치·소요 시간 가시화.
3. **자동/수동 구분** — 타입으로 자동화 범위 명시.

## 10. 단점

1. **조직 변경 취약** — role→사람 매핑 정비 필요. (→ role 바인딩·매핑 테이블 분리)
2. **BPM 범위 침범 위험** — 복잡 분기. (→ 최소 타입만, 그 이상은 전자결재 Plugin — KISS)
3. **정체 문서** — 방치. (→ 기한 + 에스컬레이션 알림)
