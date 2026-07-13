# AutoDoc v2.5 설계 문서 지도 (Enterprise Edition)

> AutoDoc을 **"Company Learning 기반 Enterprise Document Operating System"** 으로 발전시키는 v2.5 설계 문서 스위트입니다.
> **전 문서 📋 설계만 — 구현 산출물 없음.** 구현은 [ROADMAP.md](ROADMAP.md)의 S0 승인 게이트 통과 후 단계별로 시작합니다.
> v1 문서([../README.md](../README.md))는 as-built 기록으로 **무수정 보존**됩니다.

## 절대 원칙 (모든 문서 공통)

1. **AutoDoc Core는 AI를 모른다** — 모든 AI(OpenAI·Claude·Gemini·Copilot·DeepSeek·Qwen…)는 Plugin. 기본 동작은 API 없는 **AI Import Mode**.
2. **AI는 절대 자동 변경하지 않는다** — 회사 지식의 모든 변경은 관리자 승인([HUMAN_APPROVAL.md](HUMAN_APPROVAL.md)).
3. **AutoDoc은 AI가 아니라 회사를 학습한다** — 학습 결과는 Company DNA·KB·Memory·Rule로 축적.
4. **Plugin은 Core를 수정하지 않는다.**
5. **모든 모듈은 직접 호출하지 않는다** — Event 기반 연결([EVENT_BUS.md](EVENT_BUS.md)).
6. **기존 프로젝트(v1 코드·문서, dashboard/weekly/index/handover.html) 무수정.**

## 문서 관계도

```mermaid
graph TD
    README[README.md<br/>문서 지도]

    subgraph 개요
        DESIGN[DESIGN.md<br/>마스터 설계]
        ARCH[ARCHITECTURE.md<br/>계층·Multi Workspace]
        AIA[AI_ARCHITECTURE.md<br/>Import Mode·JSON Contract]
    end

    subgraph Prompt 계층
        PE[PROMPT_ENGINE.md] --> PLIB[PROMPT_LIBRARY.md<br/>Analyzer 14종]
        PE --> PMKT[PROMPT_MARKETPLACE.md]
        PMKT --> PLAB[PROMPT_LAB.md<br/>A/B/C → Golden]
    end

    subgraph 학습·통제
        LE[LEARNING_ENGINE.md] --> CE[CONFIDENCE_ENGINE.md]
        CE --> HA[HUMAN_APPROVAL.md]
    end

    subgraph 회사 기억
        DNA[COMPANY_DNA.md]
        MEM[COMPANY_MEMORY.md]
        ONT[COMPANY_ONTOLOGY.md] --> KB[KNOWLEDGE_BASE.md] --> KG[KNOWLEDGE_GRAPH.md]
        RULE[RULE_ENGINE.md]
        GT[GOLDEN_TEMPLATE.md<br/>+ Golden Prompt·Score]
    end

    subgraph Enterprise
        WF[WORKFLOW_ENGINE.md]
        RP[DOCUMENT_REPLAY_ENGINE.md]
        AU[AUDIT_ENGINE.md]
    end

    subgraph 기반·확장
        BUS[EVENT_BUS.md]
        FLAG[FEATURE_FLAG.md]
        DM[DOCUMENT_MODEL.md<br/>v1 확장]
        PLUG[PLUGIN_ARCHITECTURE.md]
    end

    README --> DESIGN --> ARCH
    DESIGN --> AIA --> PE
    AIA --> LE
    HA --> DNA
    DNA --> GT & MEM & KB & RULE
    DNA --> DM --> RP
    WF --> RP
    BUS -.모든 모듈 연결.- AU
    ARCH --> BUS & FLAG & PLUG
    DESIGN --> ROADMAP[ROADMAP.md<br/>S0~S7 승인 게이트]
```

## 읽는 순서 가이드

| 목적 | 순서 |
|---|---|
| **처음 파악** | DESIGN → ARCHITECTURE → AI_ARCHITECTURE → ROADMAP |
| **AI 경계 이해** | AI_ARCHITECTURE → PROMPT_ENGINE → PROMPT_LIBRARY |
| **학습 파이프라인** | LEARNING_ENGINE → CONFIDENCE_ENGINE → HUMAN_APPROVAL → COMPANY_DNA |
| **회사 지식 모델** | COMPANY_DNA → KNOWLEDGE_BASE → COMPANY_ONTOLOGY → KNOWLEDGE_GRAPH → COMPANY_MEMORY |
| **품질·기준** | GOLDEN_TEMPLATE → DOCUMENT_MODEL → RULE_ENGINE |
| **감사·ISO 대응** | AUDIT_ENGINE → DOCUMENT_REPLAY_ENGINE → WORKFLOW_ENGINE |
| **확장·운영 기반** | EVENT_BUS → FEATURE_FLAG → PLUGIN_ARCHITECTURE |
| **Prompt 운영자** | PROMPT_MARKETPLACE → PROMPT_LAB → GOLDEN_TEMPLATE §4 |

## 문서 목록 (26종)

| 문서 | 한 줄 요약 | 상태 |
|---|---|---|
| [DESIGN.md](DESIGN.md) | v2.5 마스터 설계 — Company Learning 기반 Document OS 비전·책임 분할·v1 관계 | 📋 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 계층·의존 규칙·Multi Workspace·저장 전략·설계 원칙 적용표 | 📋 |
| [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) | AI 독립·AI Import Mode·JSON Contract·v1 AI Builder 이행 경로 | 📋 |
| [PROMPT_ENGINE.md](PROMPT_ENGINE.md) | 6축(문서×AI×목적×형식×난이도×언어) Prompt 자동 생성·버전 관리 | 📋 |
| [PROMPT_LIBRARY.md](PROMPT_LIBRARY.md) | 문서별 Analyzer 14종 카탈로그와 학습 매핑 | 📋 |
| [PROMPT_MARKETPLACE.md](PROMPT_MARKETPLACE.md) | Prompt 자산화 — 등록·공유·버전·복사·백업 + 정확도·성공률 메타데이터 | 📋 |
| [PROMPT_LAB.md](PROMPT_LAB.md) | Prompt A/B/C 비교 실험 → Golden Prompt 승격 절차 | 📋 |
| [LEARNING_ENGINE.md](LEARNING_ENGINE.md) | 회사를 학습 — 신호 수집·Learning Proposal·Learning Timeline | 📋 |
| [CONFIDENCE_ENGINE.md](CONFIDENCE_ENGINE.md) | 신뢰도 산정과 4등급(98 자동/90 추천/80 확인/60 질문) | 📋 |
| [HUMAN_APPROVAL.md](HUMAN_APPROVAL.md) | 자동 변경 금지 — 승인 상태 머신·수정 후 승인·롤백 | 📋 |
| [COMPANY_DNA.md](COMPANY_DNA.md) | 회사 운영 방식의 단일 저장소 — 스키마·버전·복원 | 📋 |
| [COMPANY_MEMORY.md](COMPANY_MEMORY.md) | 반복 문장·레이아웃·표·그래프·보고 방식의 기억 | 📋 |
| [COMPANY_ONTOLOGY.md](COMPANY_ONTOLOGY.md) | 제품→부품→증상→조치→SOP→CAPA 개념 체계 | 📋 |
| [KNOWLEDGE_BASE.md](KNOWLEDGE_BASE.md) | 회사 용어 저장소 — 표준 표기·동의어·용어집 발급 | 📋 |
| [KNOWLEDGE_GRAPH.md](KNOWLEDGE_GRAPH.md) | Node·Edge·Relation·Hierarchy — 관계 저장·탐색 | 📋 |
| [RULE_ENGINE.md](RULE_ENGINE.md) | 업무 규칙의 데이터화 (VOC>20 경고 등) — 학습 발굴 규칙은 승인 필수 | 📋 |
| [GOLDEN_TEMPLATE.md](GOLDEN_TEMPLATE.md) | 회사 기준 문서·Golden Prompt 연결·Golden Score·Evolution(추천만) | 📋 |
| [DOCUMENT_MODEL.md](DOCUMENT_MODEL.md) | v1 DocumentModel 확장 — DNA 주입·provenance·x2 네임스페이스 | 📋 |
| [WORKFLOW_ENGINE.md](WORKFLOW_ENGINE.md) | 생성 이후 흐름(검토→승인→발송→보관) — Template별 결재 | 📋 |
| [DOCUMENT_REPLAY_ENGINE.md](DOCUMENT_REPLAY_ENGINE.md) | 문서 생성 과정 완전 재현 — Audit·ISO 대응 | 📋 |
| [AUDIT_ENGINE.md](AUDIT_ENGINE.md) | 누가·언제·무엇을·왜 — append-only 변경 연대기 | 📋 |
| [EVENT_BUS.md](EVENT_BUS.md) | 직접 호출 금지 — 이벤트 카탈로그·명명 규약·인과 사슬 | 📋 |
| [FEATURE_FLAG.md](FEATURE_FLAG.md) | Workspace별 기능 토글 — 정의 전역·값 Workspace | 📋 |
| [PLUGIN_ARCHITECTURE.md](PLUGIN_ARCHITECTURE.md) | AI·OCR·ERP·MES·SAP·메일·Slack·Teams·전자결재·Barcode·QR·DB Plugin 계약 | 📋 |
| [ROADMAP.md](ROADMAP.md) | S0(설계 승인)~S7(Plugin) 단계·산출물·게이트 기준 | 📋 |
| README.md | 본 문서 — 지도·원칙·읽기 순서 | — |

## 공통 문서 형식

모든 문서는 다음 7개 섹션을 포함합니다: **1. 목적 · 2. 책임 · 3. 데이터 흐름 · 4. 인터페이스 · 5. 확장성 · 6. 장점 · 7. 단점** — 그리고 Markdown 표, ASCII Diagram, Mermaid Diagram, 상호 참조를 갖춥니다.
