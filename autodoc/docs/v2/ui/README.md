# AutoDoc v2.5 UI/UX 설계 문서 지도

> AutoDoc v2.5 Enterprise Architecture([../README.md](../README.md) — 무수정)를 **비개발자 직원이 매일 쓰는 Enterprise SaaS 제품**으로 만드는 UI/UX·MVP 설계 스위트입니다.
> **전 문서 📋 설계만 — HTML/CSS/JS 등 구현 산출물 없음.** 구현은 사용자 승인 후 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)의 Sprint로 시작합니다.

## 절대 원칙

1. **Architecture·Core·기존 v2 문서·기존 HTML/JS 무수정** — 본 스위트는 `autodoc/docs/v2/ui/`에만 존재한다.
2. **UX 7원칙** ([UI_SPEC.md](UI_SPEC.md) §3): 3분 첫 문서 · 빈칸만 채우면 · 항상 보이는 결과 · AI는 조용한 조수 · 되돌릴 수 있다 · 끊기지 않는다 · 모두가 쓴다.
3. **MVP 범위는 [MVP_SCOPE.md](MVP_SCOPE.md) 표가 유일 기준** — 구두 합의 금지.
4. **품질 하한(접근성·오류 문법·반응형 3단)은 기능이 아니라 하한** — MVP에서도 컷하지 않는다.

## 문서 관계도

```mermaid
graph TD
    README[README.md<br/>문서 지도]

    subgraph 총괄
        SPEC[UI_SPEC.md<br/>총괄·7원칙]
        FLOW[USER_FLOW.md<br/>여정 F1~F5]
        SCR[SCREEN_STRUCTURE.md<br/>화면 인벤토리·Dashboard·Catalog]
        NAV[NAVIGATION.md<br/>IA·이동]
    end

    subgraph 시각 기반
        DS[DESIGN_SYSTEM.md<br/>토큰] --> CL[COMPONENT_LIBRARY.md<br/>부품]
    end

    subgraph 작성 경험
        FORM[FORM_GUIDE.md<br/>입력 14종] --> PV[PREVIEW_SYSTEM.md<br/>실시간 Preview]
        PV --> ED[EDITOR_SYSTEM.md<br/>직접 수정]
    end

    subgraph 학습·관리 경험
        IMP[AI_IMPORT_UX.md<br/>마법사 7단계]
        GT[GOLDEN_TEMPLATE_UX.md]
        LM[LEARNING_MODE_UX.md]
        ADM[ADMIN_UX.md] --> SET[SETTINGS_UX.md]
    end

    subgraph 품질 하한
        ERR[ERROR_HANDLING.md]
        OFF[OFFLINE_MODE.md]
        RES[RESPONSIVE_GUIDE.md]
        ACC[ACCESSIBILITY.md]
    end

    subgraph 범위·계획
        MVP[MVP_SCOPE.md] --> PLAN[IMPLEMENTATION_PLAN.md<br/>Sprint 1~7]
    end

    README --> SPEC --> FLOW --> SCR --> NAV
    SPEC --> DS
    CL --> FORM
    SCR --> FORM
    FLOW --> IMP
    IMP --> LM
    GT --> SCR
    ADM --> LM & IMP
    ERR & OFF & RES & ACC -.전 화면 공통.- SPEC
    SPEC --> MVP
```

## 읽는 순서 가이드

| 목적 | 순서 |
|---|---|
| **처음 파악** | UI_SPEC → USER_FLOW → SCREEN_STRUCTURE → MVP_SCOPE |
| **화면 만들기 전** | DESIGN_SYSTEM → COMPONENT_LIBRARY → 해당 화면 문서 → RESPONSIVE·ACCESSIBILITY |
| **작성 경험 구현** | FORM_GUIDE → PREVIEW_SYSTEM → EDITOR_SYSTEM |
| **관리자 경험 구현** | ADMIN_UX → AI_IMPORT_UX → LEARNING_MODE_UX → GOLDEN_TEMPLATE_UX → SETTINGS_UX |
| **품질 점검** | ERROR_HANDLING → OFFLINE_MODE → RESPONSIVE_GUIDE → ACCESSIBILITY |
| **일정·범위 협의** | MVP_SCOPE → IMPLEMENTATION_PLAN |

## 문서 목록 (21종)

| 문서 | 한 줄 요약 |
|---|---|
| [UI_SPEC.md](UI_SPEC.md) | 제품 UI 총괄 — 대상 사용자·UX 7원칙·앱 프레임 |
| [USER_FLOW.md](USER_FLOW.md) | 여정 F1~F5 — 단계·분기·이탈 방어·성공 판정 수치 |
| [SCREEN_STRUCTURE.md](SCREEN_STRUCTURE.md) | 화면 인벤토리(S1~S9) + Dashboard·Template Catalog 상세 |
| [NAVIGATION.md](NAVIGATION.md) | IA(1차 메뉴 5개·깊이 3단) · 기기별 내비 형태 |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | 앱 UI 토큰(색·타이포·간격·상태) — 문서 스타일(DNA)과 분리 |
| [COMPONENT_LIBRARY.md](COMPONENT_LIBRARY.md) | UI 부품 카탈로그 — 변형·상태·접근성·반응형 4계약 |
| [FORM_GUIDE.md](FORM_GUIDE.md) | Form Generator — 입력 14종·조건부·검증·제안 칩 |
| [PREVIEW_SYSTEM.md](PREVIEW_SYSTEM.md) | 실시간 HTML Preview — 구조 100% 일치·오버레이·양방향 연결 |
| [EDITOR_SYSTEM.md](EDITOR_SYSTEM.md) | Preview 직접 수정 — Drag·Resize·Edit·Duplicate·Delete·Undo·Redo |
| [AI_IMPORT_UX.md](AI_IMPORT_UX.md) | 외부 AI 왕복 마법사 7단계 + 배치 모드 + 오류 회복 |
| [GOLDEN_TEMPLATE_UX.md](GOLDEN_TEMPLATE_UX.md) | Golden 항상 첫 번째 — 배지·근거 팝오버·Evolution 관리 표면 |
| [LEARNING_MODE_UX.md](LEARNING_MODE_UX.md) | 학습 상태 시각화(DNA%·KB·Queue·승인) + 설치 캠페인 진행판 |
| [ADMIN_UX.md](ADMIN_UX.md) | 관리 영역 10종 — 할 일 중심 홈·승인함 연속 처리 |
| [SETTINGS_UX.md](SETTINGS_UX.md) | 내 설정/회사 설정 분리 — Theme·Language·권한·백업·복원·입출력 |
| [ERROR_HANDLING.md](ERROR_HANDLING.md) | 오류 3요소 문법(무슨 일+데이터 안전+다음 행동)·표면 4종 |
| [OFFLINE_MODE.md](OFFLINE_MODE.md) | PWA 오프라인 — 작성·Preview·Template·Golden 가능 매트릭스 |
| [RESPONSIVE_GUIDE.md](RESPONSIVE_GUIDE.md) | Desktop·Tablet·Mobile 3단 별도 설계 — 화면별 변형표 |
| [ACCESSIBILITY.md](ACCESSIBILITY.md) | WCAG 2.1 AA 상당 — 키보드·스크린리더·대비·Font Scale·ARIA |
| [MVP_SCOPE.md](MVP_SCOPE.md) | MVP 포함/제외 확정표 + 완결 루프 |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Sprint 1~7 — 목표·산출물·완료 조건·난이도·기간·리스크 |
| README.md | 본 문서 — 지도·원칙·읽기 순서 |

## 공통 문서 형식

모든 문서는 다음 8개 섹션을 포함합니다: **1. 목적 · 2. 책임 · 3. UX 원칙 · 4. 사용자 흐름 · 5. 화면 구성 · 6. 확장성 · 7. 장점 · 8. 단점** — 그리고 Markdown 표, ASCII Diagram, Mermaid Diagram, 상호 참조를 갖춥니다.
