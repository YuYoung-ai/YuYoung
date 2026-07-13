# Roadmap Spec — 구현 Sprint 계획 (기술 관점)

> **문서 상태**: 📋 설계만 (v2.5 Technical Specification · 미구현) — **승인 후에만 실행**
> **관련 문서**: [../ui/IMPLEMENTATION_PLAN.md](../ui/IMPLEMENTATION_PLAN.md)(UI 관점 Sprint) · [MODULE_SPEC.md](MODULE_SPEC.md) · [TEST_SPEC.md](TEST_SPEC.md) · [../ROADMAP.md](../ROADMAP.md)
> **한 줄 목적**: 기술 스택(모듈·엔진·저장) 관점의 구현 Sprint를 목표·완료조건·리스크·예상기간으로 정의한다 — UI Sprint와 짝을 이룬다.

---

## 목차

1. [목적](#1-목적) · 2. [책임 — Sprint 계획](#2-책임--sprint-계획) · 3. [인터페이스](#3-인터페이스) · 4. [입력](#4-입력) · 5. [출력](#5-출력) · 6. [데이터 흐름](#6-데이터-흐름) · 7. [의존성](#7-의존성) · 8. [확장성](#8-확장성) · 9. [장점](#9-장점) · 10. [단점](#10-단점)

---

## 1. 목적

[../ui/IMPLEMENTATION_PLAN.md](../ui/IMPLEMENTATION_PLAN.md)이 화면 관점 Sprint라면, 본 문서는 **기술 계층(Infra→Core→상위) 관점**의 같은 여정을 정의한다. 두 문서는 동일 Sprint 번호를 공유하며 상호 보완한다.

## 2. 책임 — Sprint 계획

| Sprint | 기술 목표 | 산출물(모듈) | 완료조건 | 난이도 | 기간 | 리스크 |
|---|---|---|---|---|---|---|
| **S1** 기반 | Infra 계층 + 토큰 | bus·store·workspace-context·auth 래퍼·router·logger·flags(상수) · tokens.css | 이벤트 왕복·Store get/put·가드 동작 · v1 무영향 | 중 | 2주 | 추상화 과설계 → "화면 필요분만" |
| **S2** 데이터·폼 | 계약 검증 + 폼 생성 | JSON validate·form-engine·validator·component 기초 · GAS v2 bootstrap/template.* | Template 3종 폼 자동 생성 · Draft 저장·복원 · schema 검증 | 중 | 2주 | v1 inputs 해석 편차 → v1 대조 선행 |
| **S3** 생성 | 문서 엔진 완결 | document-model(x2)·layout 재사용·renderer 연결·preview-engine · Export·history | **F1 완주** · Preview=생성물 구조 일치(3종) · assemble 순수성 | **상** | 3주 | Preview↔렌더 불일치 → I4 검증 우선 |
| **S4** 입력·편집 | 입력 14종 + 편집 | 나머지 입력 컴포넌트·editor(패치·Undo/Redo)·memory 제안 | 조건부·편집 왕복·제안 채택 | 상 | 3주 | 편집↔폼 동기 → 단일 모델 패치 |
| **S5** 학습 | Import + 학습 파이프라인 | prompt-engine·import-gate·learning·confidence·approval·dna·kb · GAS import/learning/kb | 회사 문서 5개 Import→Golden→승인 완주 · E1~E3 · I2(승인 없이 미변경) | 상 | 3주 | 외부 AI 편차 → E1~E3 시나리오 세트 |
| **S6** 품질·오프라인 | PWA + 동기 + 품질 | sw·cache·sync-queue·audit(수집)·settings 백업/복원 · 반응형·접근성 마감 | 오프라인 F1·동기 멱등·백업 복원·WCAG 체크 · Replay 재현 해시 | 상 | 3주 | 충돌 병합 난도 → "최신 우선" 기본안 |
| **S7** 파일럿 | 실증·보정 | 파일럿 운영·지표·보정 | F1 실측 ≤3분·치명 결함 0 | 중 | 2주 | 피드백 폭주 → 백로그·범위 방어 |

총 추정 **18주**(1인 가정 — S1·S2 실측 후 재산정).

## 3. 인터페이스

| 개념 | 규칙 |
|---|---|
| Sprint 게이트 | 완료조건 시연 + Regression(불변식·v1) 통과 ([TEST_SPEC.md](TEST_SPEC.md)) |
| 결함 발견 | 설계 결함 시 spec 문서 개정 먼저, 구현 후행 (I: 문서가 기준) |
| 이월 | 미달 항목 명시 후 진행 — 조용한 이월 금지 |

## 4. 입력

모듈 카탈로그([MODULE_SPEC.md](MODULE_SPEC.md)) · MVP 범위([../ui/MVP_SCOPE.md](../ui/MVP_SCOPE.md)) · 테스트 게이트 · UI Sprint(짝).

## 5. 출력

동작하는 모듈 계층 · Sprint별 검증 리포트 · 배포([DEPLOYMENT_SPEC.md](DEPLOYMENT_SPEC.md)) · 보정 백로그.

## 6. 데이터 흐름

```
S1 Infra → S2 데이터·폼 → S3 생성(F1 🎯) → S4 편집 → S5 학습(F3·F4 🎯) → S6 품질 → S7 파일럿 🎯
  각 Sprint: spec 기준 구현 → 테스트 게이트 → (통과) 다음 / (결함) spec 개정 먼저
```

```mermaid
graph LR
    S1[S1 Infra] --> S2[S2 데이터·폼] --> S3[S3 생성 F1🎯]
    S3 --> S4[S4 편집] --> S5[S5 학습 F3·F4🎯]
    S5 --> S6[S6 품질·오프라인] --> S7[S7 파일럿🎯]
```

## 7. 의존성

기술 Sprint ↔ UI Sprint(동일 번호 — [../ui/IMPLEMENTATION_PLAN.md](../ui/IMPLEMENTATION_PLAN.md)) 짝. 순서 의존: S1→S2→S3 고정, S3→S5 고정. Architecture 로드맵([../ROADMAP.md](../ROADMAP.md))의 S0(설계 승인) 이후 트랙.

## 8. 확장성

- MVP 이후(Workflow·Graph·Plugin·Audit 화면)는 본 계획의 후속이 아니라 [../ROADMAP.md](../ROADMAP.md) 단계별 별도 계획.
- 팀 증원 시 완료조건·순서 의존 유지하며 병렬화(S4 입력 6종은 S3와 병행 가능).

## 9. 장점

1. **기술·UI Sprint 짝** — 같은 여정을 두 관점에서 검증, 누락 방지.
2. **불변식 게이트** — 매 Sprint I1~I7·v1 회귀로 구조 붕괴 조기 차단.
3. **세 완결점** — S3·S5·S7에서 중간 판단.

## 10. 단점

1. **추정 불확실** — 18주는 가정(±40%). (→ S1·S2 실측 후 재산정)
2. **직렬 의존** — S3 지연 파급. (→ S4 일부 병행 분리)
3. **1인 가정** — 팀 구성에 민감. (→ 순서·게이트 유지 시 병렬화 가능하도록 설계)
