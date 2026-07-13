# Component Library — UI 부품 카탈로그

> **문서 상태**: 📋 설계만 (v2.5 UI/UX Edition · 미구현)
> **관련 문서**: [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) · [FORM_GUIDE.md](FORM_GUIDE.md) · [ACCESSIBILITY.md](ACCESSIBILITY.md) · v1: [../../COMPONENT_SPEC.md](../../COMPONENT_SPEC.md)(문서 컴포넌트 — 별개)
> **한 줄 목적**: 앱 UI를 조립하는 재사용 부품의 단일 카탈로그 — 이름·용도·상태·접근성 계약을 확정한다.

---

## 목차

1. [목적](#1-목적)
2. [책임 — 부품 카탈로그](#2-책임--부품-카탈로그)
3. [UX 원칙](#3-ux-원칙)
4. [사용자 흐름](#4-사용자-흐름)
5. [화면 구성](#5-화면-구성)
6. [확장성](#6-확장성)
7. [장점](#7-장점)
8. [단점](#8-단점)

---

## 1. 목적

화면은 부품의 조립이다. 부품이 카탈로그에 있으면 새 화면은 "조립 설계"만 하면 된다.
**주의**: v1의 문서 컴포넌트([../../COMPONENT_SPEC.md](../../COMPONENT_SPEC.md) — 문서 안의 표·차트)와 본 문서의 **앱 UI 부품**은 서로 다른 체계다.

## 2. 책임 — 부품 카탈로그

| 분류 | 부품 | 핵심 용도 |
|---|---|---|
| 행동 | Button(1차/2차/위험/텍스트) · IconButton · SplitButton(생성 형식 선택) | CTA·행동 |
| 입력 | TextField · NumberField · DateField · TextArea · Select · Radio · Checkbox · FileDrop · SignaturePad · TableInput · RepeatBlock | [FORM_GUIDE.md](FORM_GUIDE.md)의 14종 입력 렌더 대상 |
| 컨테이너 | Card(Template/문서/통계) · Panel · Modal · Drawer · Tabs · Accordion | 구획 |
| 표시 | Badge(🏆Golden·권한·상태) · Tag · ProgressBar · Meter(학습 %) · EmptyState · Skeleton | 상태 가시화 |
| 피드백 | Toast · InlineError · Banner(오프라인·공지) · ConfirmDialog | [ERROR_HANDLING.md](ERROR_HANDLING.md) 표면 |
| 탐색 | SideNav · TabBar(모바일) · Breadcrumb · SearchBox · Pagination | [NAVIGATION.md](NAVIGATION.md) |
| 데이터 | DataTable(정렬·필터) · List · DiffView(승인 전후 비교) · JsonPasteBox(AI Import 전용) | Admin·Import |

각 부품의 계약 = ① 변형(variants) ② 상태(기본/hover/active/focus/disabled/error) ③ 접근성(role·라벨·키보드) ④ 반응형 규칙.

## 3. UX 원칙

| 원칙 | 반영 |
|---|---|
| 하나의 일 | 한 부품 = 한 책임. "옵션 많은 만능 부품" 금지 (KISS) |
| 상태 완전성 | 6상태 정의 없는 부품은 카탈로그에 못 들어온다 |
| 접근성 내장 | 키보드·ARIA는 부품 계약에 포함 — 화면에서 후처리 금지 ([ACCESSIBILITY.md](ACCESSIBILITY.md) §2) |
| 빈 상태도 설계 | 목록형 부품은 EmptyState 슬롯 필수 — "없음"이 흰 공백이 되지 않게 |

## 4. 사용자 흐름

부품이 흐름에 등장하는 대표 지점:

```
Catalog:  Card(Template) + Badge(🏆/🔒/vN) + SearchBox
Editor:   입력 부품 14종 ⇄ Preview Panel + Toast("저장됨")
Import:   FileDrop → CopyField(Prompt) → JsonPasteBox → DiffView(결과 확인)
승인함:   DataTable + DiffView + ConfirmDialog(반려 사유)
```

```mermaid
graph LR
    subgraph 조립 예 — 승인함 화면
        DT[DataTable<br/>대기열] --> DV[DiffView<br/>전후 비교]
        DV --> B1[Button 승인]
        DV --> B2[Button 수정 후 승인]
        DV --> CD[ConfirmDialog<br/>반려 사유]
    end
    TOK[(디자인 토큰)] --> DT & DV & B1 & B2 & CD
```

## 5. 화면 구성

대표 부품 상세 (전 부품 동일 형식으로 구현 단계에서 개별 명세):

### Card(Template)

```
┌───────────────┐   변형: default / golden(🏆) / locked(🔒)
│ [썸네일]       │   상태: 기본/hover(elev-2)/focus(focus-ring)
│ 🏆 주간보고     │   키보드: Enter=선택, ★=즐겨찾기 토글
│ v7 · ★128     │   ARIA: role=button, 라벨="주간보고, Golden, 버전 7"
│ PPT·PDF  [★]  │   반응형: 그리드 4→2→1열
└───────────────┘
```

### JsonPasteBox (AI Import 전용)

| 항목 | 계약 |
|---|---|
| 구성 | 대형 붙여넣기 영역 + 검증 상태 표시(대기/검사 중/성공/오류) + 오류 상세 접이식 |
| 오류 표시 | E1~E3 등급별 메시지 ([ERROR_HANDLING.md](ERROR_HANDLING.md) §5) + "재요청 Prompt 복사" 버튼 |
| 접근성 | 검증 결과는 aria-live로 낭독 |

### DiffView (승인·결과 확인 공용)

| 항목 | 계약 |
|---|---|
| 구성 | 좌 before / 우 after (모바일: 상하) + 변경 하이라이트 |
| 용도 | 학습 승인 전후·Golden 후보 비교·수정 후 승인 편집 |

## 6. 확장성

- **새 부품 추가** = 4계약(변형·상태·접근성·반응형) 작성 + 카탈로그 등록. 기존 부품 무수정.
- 부품은 토큰만 참조하므로 테마 추가에 자동 대응 ([DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) §6).
- MVP 제외 화면(Workflow 보드 등)용 부품(KanbanColumn 등)은 필요 시점에 추가 — 선반입 금지.

## 7. 장점

1. **조립 속도** — 화면 설계가 부품 나열로 축소된다 ([IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)의 Sprint 산정 근거).
2. **품질 하한 보장** — 접근성·상태 완전성이 부품 단위에서 한 번만 검증되면 전 화면이 상속.
3. **v1 문서 컴포넌트와 분리** — 문서 렌더링 체계를 오염시키지 않는다.

## 8. 단점

1. **선행 투자** — 첫 화면이 나오기 전에 부품부터 만들어야 한다. (→ Sprint 1에 "화면에 필요한 최소 부품만" 원칙)
2. **카탈로그 관리 비용** — 부품 중복·방치 변형이 생기기 쉽다. (→ 신규 부품은 기존 부품 불가 사유 명기)
3. **과도한 일반화 유혹** — 재사용 강박이 만능 부품을 낳는다. (→ §3 "하나의 일" 원칙으로 방어)
