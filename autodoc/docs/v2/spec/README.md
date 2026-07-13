# AutoDoc v2.5 Technical Specification & Implementation Blueprint — 문서 지도

> AutoDoc v2.5의 **설계와 코드 사이의 기준 문서** 스위트입니다. 누가 개발하더라도 동일한 구조로 구현되도록 기술 명세를 정의합니다.
> **전 문서 📋 설계만 — 실행 코드(HTML/CSS/JS/Apps Script) 없음.** JSON 계약 예시·인터페이스 표·다이어그램으로 구현 가능 수준을 기술하며 Pseudo Code는 최소화합니다.
> 상위: Architecture([../README.md](../README.md)) · UI/UX([../ui/README.md](../ui/README.md)) · v1 as-built([../../README.md](../../README.md)) — 모두 **무수정 참조**.

## 절대 원칙

1. **기존 문서·코드(v1·v2 Architecture·UI·HTML·JS·GAS) 무수정** — 본 스위트는 `autodoc/docs/v2/spec/`에만 존재.
2. **전역 불변식 I1~I7** ([TECH_SPEC.md](TECH_SPEC.md) §2): AI 무지 · 승인 없는 지식 변경 금지 · 이벤트 경유 · 단일 DocumentModel · Store 격리 · v1 무수정 · schemaVersion.
3. **문서가 기준** — 구현 중 결함 발견 시 spec 문서 개정 먼저, 구현 후행.
4. **v1 재사용** — 인증·레이아웃·렌더러·컴포넌트는 v1 무수정 import.

## 문서 관계도

```mermaid
graph TD
    README[README.md<br/>지도]
    subgraph 총괄
        TECH[TECH_SPEC<br/>총괄·불변식·이벤트] --> SYS[SYSTEM_DESIGN<br/>4상자 구성]
        SYS --> MOD[MODULE_SPEC<br/>모듈·이벤트 소유]
        MOD --> FILE[FILE_STRUCTURE]
    end
    subgraph 프론트
        ROUTE[ROUTING_SPEC] · AUTHS[AUTH_SPEC] · COMP[COMPONENT_SPEC] · THEME[THEME_ENGINE_SPEC]
    end
    subgraph 데이터
        DATA[DATA_MODEL] --> JSCH[JSON_SCHEMA]
        STOR[STORAGE_SPEC] --> LOC[LOCAL_STORAGE_SPEC] & CACHE[CACHE_SPEC]
    end
    subgraph 백엔드
        API[API_SPEC] --> GAS[GOOGLE_APPS_SCRIPT_SPEC] --> SHEET[GOOGLE_SHEETS_SPEC]
    end
    subgraph PWA·보안
        PWA[PWA_SPEC] --> SYNC[OFFLINE_SYNC_SPEC]
        SEC[SECURITY_SPEC]
    end
    subgraph 엔진
        DOC[DOCUMENT_ENGINE_SPEC] --> LAY[LAYOUT_ENGINE_SPEC] & REND[RENDERER_SPEC] & PREV[PREVIEW_ENGINE_SPEC] & FORMS[FORM_ENGINE_SPEC]
        RULE[RULE_ENGINE_SPEC] · WF[WORKFLOW_ENGINE_SPEC] · LEARN[LEARNING_ENGINE_SPEC]
    end
    subgraph 확장·운영
        PLUG[PLUGIN_SPEC] --> AIP[AI_PLUGIN_SPEC]
        AUD[AUDIT_SPEC] · LOG[LOGGING_SPEC] · ERR[ERROR_SPEC] · TEST[TEST_SPEC] · DEP[DEPLOYMENT_SPEC] · RM[ROADMAP_SPEC]
    end
    README --> TECH
    MOD --> DATA & API & DOC & SEC
    DATA --> STOR
    DOC --> RM
```

## 읽는 순서 가이드

| 목적 | 순서 |
|---|---|
| **처음 파악** | TECH_SPEC → SYSTEM_DESIGN → MODULE_SPEC → FILE_STRUCTURE |
| **데이터·계약 구현** | DATA_MODEL → JSON_SCHEMA → STORAGE_SPEC → GOOGLE_SHEETS_SPEC |
| **백엔드 구현** | API_SPEC → GOOGLE_APPS_SCRIPT_SPEC → SECURITY_SPEC |
| **문서 엔진 구현** | DOCUMENT_ENGINE → FORM_ENGINE → PREVIEW_ENGINE → RENDERER → LAYOUT_ENGINE → THEME_ENGINE |
| **학습 구현** | LEARNING_ENGINE → RULE_ENGINE(+ Architecture 학습 문서) |
| **PWA·오프라인** | PWA_SPEC → CACHE_SPEC → LOCAL_STORAGE_SPEC → OFFLINE_SYNC_SPEC |
| **확장(차기)** | PLUGIN_SPEC → AI_PLUGIN_SPEC → WORKFLOW_ENGINE_SPEC |
| **운영·품질** | ERROR_SPEC → LOGGING_SPEC → AUDIT_SPEC → TEST_SPEC → DEPLOYMENT_SPEC → ROADMAP_SPEC |

## 문서 목록 (36종)

| 문서 | 한 줄 요약 |
|---|---|
| [TECH_SPEC.md](TECH_SPEC.md) | 총괄 — 기술 스택·불변식 I1~I7·이벤트 카탈로그·전역 규약 |
| [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) | 4상자 구성(Pages·브라우저·GAS·외부 AI)과 통신 경로 |
| [MODULE_SPEC.md](MODULE_SPEC.md) | 전 모듈 정의·이벤트 소유표·의존 규칙 |
| [FILE_STRUCTURE.md](FILE_STRUCTURE.md) | 최종 폴더 구조 — v1 동결·v2 신규 트리 |
| [ROUTING_SPEC.md](ROUTING_SPEC.md) | 단일 셸 + 해시 라우팅·가드 |
| [AUTH_SPEC.md](AUTH_SPEC.md) | v1 auth.js 계승 래퍼·역할 모델 |
| [DATA_MODEL.md](DATA_MODEL.md) | 엔티티·관계·버전 규칙(불변/append-only) |
| [JSON_SCHEMA.md](JSON_SCHEMA.md) | 12 JSON 계약·검증·migrate |
| [API_SPEC.md](API_SPEC.md) | 전 API·봉투·Error·권한·Timeout·Retry·멱등·Version |
| [GOOGLE_APPS_SCRIPT_SPEC.md](GOOGLE_APPS_SCRIPT_SPEC.md) | v2 GAS 라우팅·프리앰블·Repo·잠금 |
| [GOOGLE_SHEETS_SPEC.md](GOOGLE_SHEETS_SPEC.md) | 탭 스키마·json 1행·용량 정책 |
| [STORAGE_SPEC.md](STORAGE_SPEC.md) | Store 추상화·Workspace 격리·local-first |
| [LOCAL_STORAGE_SPEC.md](LOCAL_STORAGE_SPEC.md) | 로컬 키·Draft 보호·용량 정리 |
| [CACHE_SPEC.md](CACHE_SPEC.md) | 캐시 정책·무효화·오프라인 보장 prime |
| [PWA_SPEC.md](PWA_SPEC.md) | SW 스코프·매니페스트·작성 보호 업데이트 |
| [OFFLINE_SYNC_SPEC.md](OFFLINE_SYNC_SPEC.md) | 동기 큐·멱등 재전송·충돌 해소 |
| [SECURITY_SPEC.md](SECURITY_SPEC.md) | 7축 보안·집행 3지점·위협 대응 |
| [PLUGIN_SPEC.md](PLUGIN_SPEC.md) | Plugin 수명주기·Host·ctx 주입 |
| [AI_PLUGIN_SPEC.md](AI_PLUGIN_SPEC.md) | analyzer-transport 계약·검증 우회 불가 |
| [DOCUMENT_ENGINE_SPEC.md](DOCUMENT_ENGINE_SPEC.md) | Template→Form→Validation→Preview→Renderer→Export |
| [LAYOUT_ENGINE_SPEC.md](LAYOUT_ENGINE_SPEC.md) | Grid→절대좌표(v1 재사용)·편집 스냅 |
| [RENDERER_SPEC.md](RENDERER_SPEC.md) | PPT/Excel/PDF/Word 공통 인터페이스 |
| [PREVIEW_ENGINE_SPEC.md](PREVIEW_ENGINE_SPEC.md) | HTML Preview=결과 동일 구조·부분 갱신·오버레이 |
| [FORM_ENGINE_SPEC.md](FORM_ENGINE_SPEC.md) | 스키마→폼·14종·조건부·검증 |
| [COMPONENT_SPEC.md](COMPONENT_SPEC.md) | 앱/문서 컴포넌트 계약(Vanilla JS) |
| [THEME_ENGINE_SPEC.md](THEME_ENGINE_SPEC.md) | 앱/문서 토큰·DNA→Theme 사영 |
| [RULE_ENGINE_SPEC.md](RULE_ENGINE_SPEC.md) | 조건→효과 평가·충돌 해소 |
| [WORKFLOW_ENGINE_SPEC.md](WORKFLOW_ENGINE_SPEC.md) | 결재 흐름 상태 머신(차기) |
| [LEARNING_ENGINE_SPEC.md](LEARNING_ENGINE_SPEC.md) | 신호→제안→신뢰도→승인→반영 |
| [AUDIT_SPEC.md](AUDIT_SPEC.md) | 변경성 전수 구독·해시 체인 |
| [LOGGING_SPEC.md](LOGGING_SPEC.md) | 로그 레벨·마스킹·Audit 구분 |
| [ERROR_SPEC.md](ERROR_SPEC.md) | 전체 Error Code·등급·재시도·표면 매핑 |
| [TEST_SPEC.md](TEST_SPEC.md) | Unit·Integration·UI·Acceptance·Regression |
| [DEPLOYMENT_SPEC.md](DEPLOYMENT_SPEC.md) | Pages·GAS 배포·버전·롤백 |
| [ROADMAP_SPEC.md](ROADMAP_SPEC.md) | 기술 Sprint(UI Sprint와 짝) |
| README.md | 본 문서 — 지도·원칙·읽기 순서 |

## 공통 문서 형식

모든 문서는 다음 10개 섹션을 포함합니다: **1. 목적 · 2. 책임 · 3. 인터페이스 · 4. 입력 · 5. 출력 · 6. 데이터 흐름 · 7. 의존성 · 8. 확장성 · 9. 장점 · 10. 단점** — 그리고 Markdown 표, Mermaid Diagram, ASCII Diagram, 상호 참조를 갖춥니다.
