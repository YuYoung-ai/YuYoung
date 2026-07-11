# AutoDoc 설계 문서 지도

> AutoDoc — 회사 문서 자동화 플랫폼의 설계 문서 스위트입니다.
> 모든 문서는 **as-built(실제 구현) 코드를 근거**로 작성되었으며, 아직 구현되지 않은
> 설계 항목은 📋 라벨로 표시합니다. (✅ 구현됨 / 📋 설계만)

## 문서 관계도

```mermaid
graph TD
    README[README.md<br/>문서 지도]

    subgraph 개요
        DESIGN[DESIGN.md<br/>전체 설계·비전]
        ARCH[ARCHITECTURE.md<br/>아키텍처·의존성]
        FOLDER[FOLDER_STRUCTURE.md<br/>폴더 구조]
    end

    subgraph 핵심 명세
        DM[DOCUMENT_MODEL.md<br/>문서 모델·바인딩]
        SCHEMA[JSON_SCHEMA.md<br/>Template·Theme 스키마]
        LAYOUT[LAYOUT_ENGINE.md]
        THEME[THEME_ENGINE.md]
        COMP[COMPONENT_SPEC.md]
        REND[RENDERER_SPEC.md]
        VALID[VALIDATION_SPEC.md]
    end

    subgraph 시스템 명세
        API[API_SPEC.md<br/>GAS API·시트 스키마]
        ADMIN[ADMIN_SPEC.md<br/>관리자·빌더]
        PLUGIN[PLUGIN_SPEC.md<br/>플러그인 인터페이스 📋]
    end

    subgraph 계획·이력
        ROADMAP[ROADMAP.md<br/>현황·리뷰·차기 계획]
        PHASE[PHASE_PLAN.md<br/>단계별 기록·검증]
        DETAIL[DETAILED_DESIGN.md]
        P2[PHASE2.md] --- P3[PHASE3.md] --- P4[PHASE4.md]
    end

    README --> DESIGN
    DESIGN --> ARCH --> FOLDER
    ARCH --> DM
    DM --> SCHEMA
    DM --> LAYOUT & THEME & COMP & VALID
    COMP --> REND
    LAYOUT --> REND
    THEME --> REND
    SCHEMA --> ADMIN
    API --> ADMIN
    ARCH --> API
    ARCH --> PLUGIN
    DESIGN --> ROADMAP --> PHASE
    PHASE --> DETAIL
    PHASE --> P2
```

## 읽는 순서 가이드

| 목적 | 순서 |
|---|---|
| **처음 파악** | DESIGN → ARCHITECTURE → FOLDER_STRUCTURE → ROADMAP |
| **새 문서(템플릿) 추가** | JSON_SCHEMA → VALIDATION_SPEC → (ADMIN_SPEC의 등록 절차) |
| **새 컴포넌트 개발** | COMPONENT_SPEC → LAYOUT_ENGINE → THEME_ENGINE → RENDERER_SPEC |
| **새 렌더러(포맷) 개발** | DOCUMENT_MODEL → RENDERER_SPEC → LAYOUT_ENGINE |
| **백엔드/운영** | API_SPEC → ADMIN_SPEC |
| **외부 연동(AI·메일·ERP…)** | PLUGIN_SPEC → ARCHITECTURE(확장점) |
| **이력·검증 확인** | PHASE_PLAN → PHASE2/3/4 → DETAILED_DESIGN |

## 문서 목록

| 문서 | 한 줄 요약 | 상태 |
|---|---|---|
| [DESIGN.md](DESIGN.md) | 최초 설계 확정본 — 비전·12개 설계 영역·로드맵 | ✅ 전 단계 구현 완료 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 계층·모듈 의존성·데이터 흐름·기존 시스템과의 경계 | ✅ |
| [FOLDER_STRUCTURE.md](FOLDER_STRUCTURE.md) | 폴더/파일별 역할 + 향후 승격 경로 | ✅ / 일부 📋 |
| [DOCUMENT_MODEL.md](DOCUMENT_MODEL.md) | 렌더러 중립 문서 모델과 바인딩 해석 | ✅ |
| [JSON_SCHEMA.md](JSON_SCHEMA.md) | Template·Theme JSON 스키마 v1 전체 레퍼런스 | ✅ / 확장 📋 |
| [LAYOUT_ENGINE.md](LAYOUT_ENGINE.md) | Grid 저작 → 절대좌표 변환 (혼합 방식) | ✅ |
| [THEME_ENGINE.md](THEME_ENGINE.md) | 색·폰트·여백 토큰 시스템 | ✅ / Builder 📋 |
| [COMPONENT_SPEC.md](COMPONENT_SPEC.md) | 컴포넌트 계약과 6종 상세 스펙 | ✅ / 3종 📋 |
| [RENDERER_SPEC.md](RENDERER_SPEC.md) | 렌더러 계약과 4종(PPT/Excel/Word/PDF) 상세 | ✅ |
| [VALIDATION_SPEC.md](VALIDATION_SPEC.md) | 입력 검증 규칙 문법 | ✅ / 확장 📋 |
| [API_SPEC.md](API_SPEC.md) | GAS API 14액션·AutoDoc DB 시트 스키마·배포 절차 | ✅ |
| [ADMIN_SPEC.md](ADMIN_SPEC.md) | 관리자 화면·폼 빌더·AI 템플릿 빌더 | ✅ / 일부 📋 |
| [PLUGIN_SPEC.md](PLUGIN_SPEC.md) | 플러그인 아키텍처 — 인터페이스 정의 | 📋 (인터페이스만) |
| [ROADMAP.md](ROADMAP.md) | 완료 현황·설계 리뷰·차기 로드맵 | — |
| [PHASE_PLAN.md](PHASE_PLAN.md) | 단계별 범위·검증 결과·차기 단계 실행 계획 | — |
| [DETAILED_DESIGN.md](DETAILED_DESIGN.md) · [PHASE2.md](PHASE2.md) · [PHASE3.md](PHASE3.md) · [PHASE4.md](PHASE4.md) | 단계별 구현 명세 (이력) | ✅ |

## 절대 원칙 (모든 문서 공통)

1. **기존 BAZ CS PWA 무수정** — AutoDoc은 `autodoc/` 폴더(+ 루트 `autodoc_gas.gs`)에만 존재. 공유는 `auth.js`(로그인·토큰·권한)뿐.
2. **새 문서 = JSON 추가** — 문서 종류를 늘릴 때 JavaScript를 수정하지 않는다.
3. **Interface First** — 렌더러·프로바이더·컴포넌트·플러그인은 계약(인터페이스)으로만 결합한다. 렌더러끼리는 절대 서로 의존하지 않는다.
4. **DocumentModel 단일 진실** — 모든 렌더러와 미리보기는 같은 DocumentModel만 입력받는다.
