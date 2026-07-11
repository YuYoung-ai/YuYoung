# AutoDoc — 회사 문서 자동화 플랫폼 설계 문서

> **문서 상태**: 설계 확정본 (v1.0 · 2026-07) → **전 단계(MVP·Phase 2~4) 구현·검증 완료** ✅
> **문서 스위트**: 상세 명세는 [README.md(문서 지도)](README.md) 에서 시작 — 아키텍처·스키마·컴포넌트·렌더러·API·관리자·플러그인 등 15종
> **현황·차기 계획**: [ROADMAP.md](ROADMAP.md) · 단계별 검증 기록: [PHASE_PLAN.md](PHASE_PLAN.md)
> **최종 목표**: **"회사 샘플 양식을 넣으면, 사용자는 글만 적으면 문서가 완성되는 시스템"** — Phase 4 로 달성

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [전체 아키텍처](#2-전체-아키텍처)
3. [폴더 구조](#3-폴더-구조)
4. [데이터 흐름](#4-데이터-흐름)
5. [클래스 구조](#5-클래스-구조)
6. [컴포넌트 구조](#6-컴포넌트-구조)
7. [Template 구조](#7-template-구조)
8. [Renderer / Layout / Theme 구조](#8-renderer--layout--theme-구조)
9. [관리자 구조](#9-관리자-구조)
10. [향후 확장성 (권한·버전·Provider·AI)](#10-향후-확장성)
11. [장단점](#11-장단점)
12. [개발 단계 Roadmap (MVP → Phase 4)](#12-개발-단계-roadmap)

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|---|---|
| 프로젝트명 | **AutoDoc — 회사 문서 자동화 플랫폼** |
| 목적 | 사용자는 **양식 선택 + 폼 입력**만 하면, 엔진이 회사 양식에 맞는 문서(PPT/Excel/Word/PDF)를 자동 생성 |
| 핵심 원칙 | 문서 = **Template(JSON 데이터)** × **Renderer(엔진 코드)** 의 완전 분리 |
| 위치 | 기존 저장소 내 `autodoc/` 하위 폴더 — **기존 dashboard.html 등 운영 파일 무수정**, GitHub Pages 동일 배포 파이프라인 재사용 |
| 백엔드 | Google Apps Script(신규 `autodoc_gas.gs`) + Google Sheets(신규 스프레드시트) |
| 기술 제약 | HTML + CSS + Vanilla JS + GAS + Sheets + PWA + PptxGenJS 유지. **프레임워크(React/Vue/Node.js) 도입 금지.** 필요 라이브러리만 CDN 추가 |

### 핵심 사상

> **"새 문서 추가 = 코드 작성이 아니라 JSON 템플릿 등록"**

엔진(Renderer / Layout / Theme / Form Generator)은 한 번만 만들고, 이후 모든 문서 종류는 **데이터(템플릿 JSON)로만** 추가한다.
이 사상이 끝까지 유지되면 최종 단계(Phase 4)에서 "회사 샘플 양식 업로드 → AI가 템플릿 JSON 자동 생성 → 사용자는 글만 입력"이 **엔진 수정 없이** 가능해진다. AI가 만들어내는 것도 결국 같은 템플릿 JSON이기 때문이다.

### 기존 시스템과의 관계

현재 운영 중인 CS Dashboard(BAZ CS PWA)는 페이지마다 PptxGenJS·ExcelJS 호출을 하드코딩하고 있어(예: `weekly.html`의 `genExcel()`), 새 양식마다 페이지를 새로 코딩해야 한다. AutoDoc은 **별도 신규 프로젝트**로 이 문제를 구조적으로 해결하되, 다음 검증된 자산은 재사용한다.

| 재사용 자산 | 출처 | 용도 |
|---|---|---|
| 토큰 인증 + 페이지 가드 + 레벨 권한 | `auth.js` | 로그인/권한 (레벨 4까지 확장) |
| ExcelJS 다중 CDN 폴백 지연 로더 | `weekly.html` `loadXlsxLib()` | 라이브러리 로딩 공통 패턴 |
| PptxGenJS 지연 로드 | `dashboard.html` `PPTX_CDNS` | 〃 |
| GAS `text/plain` POST(preflight 회피) + `?action=` 라우팅 | 전 페이지 공통 | 백엔드 통신 규약 |
| 시트 탭 = 관리자 설정 저장소 | `index.html` '메뉴설정' | 템플릿/권한 저장 방식 |
| 캐시 버전 관리 | `sw.js` | AutoDoc 전용 SW |

---

## 2. 전체 아키텍처

### 사용자 흐름

```
사용자
  ↓ 로그인 (auth.js 재사용 — 토큰 + 권한 레벨)
문서 카탈로그 (권한별로 허용된 양식 목록 표시)
  ↓ 양식 선택
Template Loader (GAS → 템플릿 JSON 로드, localStorage 캐시)
  ↓
Form Generator (템플릿의 inputs 스키마 → 입력폼 자동 생성)
  ↓ 사용자 입력 + Data Provider 자동 채움(시트 데이터 등)
Validation (템플릿의 rules 기반 검증)
  ↓
Document Model 조립 (입력값 + 템플릿 layout + theme → 렌더러 중립 모델)
  ↓
Preview (HTML 미리보기)
  ↓ 생성 버튼
Renderer (PPT | Excel | Word | PDF — 포맷별 엔진, 공통 인터페이스)
  ↓
다운로드 (.pptx / .xlsx / .docx / .pdf) + 생성 이력 시트 기록
```

### 계층 구조 (위 계층이 아래 계층에만 의존)

```
[Pages]      index(허브) / editor(입력·생성) / admin(관리)
[Services]   AuthService · TemplateService · FormGenerator · Validator · HistoryService
[Engine]     DocumentModel · LayoutEngine · ThemeEngine · ComponentRegistry
[Renderers]  PptRenderer · ExcelRenderer · WordRenderer · PdfRenderer   ← 공통 인터페이스
[Providers]  GasProvider · LocalJsonProvider · ManualProvider · RestProvider(확장)
[Backend]    autodoc_gas.gs  ←→  Google Sheets (템플릿·테마·권한·이력 저장소)
```

**의존 규칙**: `engine/`은 포맷(pptx/xlsx)을 모르고, `renderers/`는 문서의 의미(주간보고/회의록)를 모르고, `providers/`는 화면(DOM)을 모른다. 이 규칙이 확장성의 근거다.

---

## 3. 폴더 구조

```
autodoc/
├── index.html              # 로그인 + 문서 카탈로그 진입 (허브)
├── editor.html             # 양식 입력 → 미리보기 → 생성 (핵심 화면 1개로 모든 문서 처리)
├── admin.html              # 관리자: 템플릿 등록/수정/버전/권한 (Phase 2), AI 빌더 (Phase 4)
├── manifest.json           # AutoDoc 전용 PWA 매니페스트 (scope: /autodoc/)
├── sw.js                   # AutoDoc 전용 서비스워커 (기존 sw.js와 스코프 분리)
├── assets/                 # 아이콘, 로고, 회사 CI 이미지
├── css/
│   ├── base.css            # 리셋 + 공통 (기존 페이지 스타일 토큰 이관)
│   └── app.css             # 화면별 스타일
├── js/
│   ├── core/
│   │   ├── auth.js         # 기존 auth.js 참조 또는 복사 + 레벨 확장(1~4)
│   │   ├── config.js       # GAS URL, ENGINE_VERSION, 기능 플래그
│   │   ├── store.js        # localStorage 캐시 유틸 (템플릿/테마/초안)
│   │   └── bus.js          # 경량 이벤트 버스 (화면 컴포넌트 간 통신)
│   ├── engine/
│   │   ├── document-model.js   # 렌더러 중립 문서 모델 (핵심)
│   │   ├── layout-engine.js    # Grid → 절대좌표 변환
│   │   ├── theme-engine.js     # 테마 토큰 해석 (색/폰트/여백)
│   │   └── components/         # 컴포넌트 1파일 1개
│   │       ├── registry.js     # 컴포넌트 등록/조회
│   │       ├── text.js  table.js  card.js  chart.js
│   │       └── image.js  header.js  footer.js
│   ├── renderers/
│   │   ├── renderer-base.js    # 공통 인터페이스 정의
│   │   ├── ppt-renderer.js     # PptxGenJS (MVP)
│   │   ├── excel-renderer.js   # ExcelJS (MVP — weekly.html 로직 이관·일반화)
│   │   ├── word-renderer.js    # docx 라이브러리 (Phase 3)
│   │   └── pdf-renderer.js     # 미리보기 HTML → 인쇄 (MVP), Phase 3 고도화
│   ├── providers/
│   │   ├── provider-base.js    # fetch(query) 공통 인터페이스
│   │   ├── gas-provider.js     # Apps Script ?action= 호출 (기존 패턴)
│   │   ├── local-provider.js   # 정적 JSON / localStorage 초안
│   │   └── manual-provider.js  # 사용자 직접 입력 (폼)
│   ├── form/
│   │   ├── form-generator.js   # 템플릿 inputs → DOM 폼 자동 생성
│   │   └── validator.js        # rules 기반 검증
│   ├── ai/                     # (Phase 3~4) AI 계층 — 인터페이스만 먼저 확보
│   │   ├── ai-service.js       # summarize/draft/translate/proofread (GAS 프록시 호출)
│   │   └── template-builder.js # (Phase 4) 양식 파일 분석 → 템플릿 JSON 초안 생성
│   └── ui/
│       ├── preview.js          # DocumentModel → HTML 미리보기 렌더
│       └── toast.js            # 알림 (기존 toast 패턴)
├── templates/              # 시드 템플릿 JSON (배포 시 정적 제공, 운영 원본은 시트)
│   ├── weekly-report.json
│   ├── meeting-minutes.json
│   └── trip-report.json
├── themes/
│   └── company-default.json    # 회사 기본 테마 (기존 navy/teal 토큰 이관)
└── docs/
    └── DESIGN.md               # 본 설계 문서
```

**폴더 역할 원칙**: 새 문서 종류 추가 시 코드 폴더는 건드리지 않는다. `templates/`(또는 시트 '템플릿' 탭)만 추가하면 끝.

---

## 4. 데이터 흐름

```
① 템플릿 로드    GAS(시트 '템플릿' 탭) → TemplateService → localStorage 캐시(오프라인 대응)
② 폼 생성        template.inputs → FormGenerator → <form> DOM
③ 데이터 채움    template의 @providers 바인딩 → Provider들 병렬 fetch → 폼 프리필
                 (예: 주간보고 = GasProvider('handover?action=all') 자동 채움 — 기존 weekly와 동일)
④ 검증          입력값 → Validator(template.rules) → 오류 표시 or 통과
⑤ 모델 조립      입력값 + template.layout + theme → DocumentModel(렌더러 중립 JSON)
⑥ 미리보기       DocumentModel → preview.js → HTML (CSS Grid로 좌표 비율 그대로 시각화)
⑦ 렌더링        DocumentModel → Renderer.render() → Blob → 다운로드
⑧ 이력 기록      GAS POST {action:'log', user, template, version, ts} → 시트 '생성이력' 탭
⑨ 초안 저장      입력값 → localStorage 자동 저장, Phase 2에서 시트 저장(기기 간 공유·승인)
```

### Google Sheets 구성 (AutoDoc DB — 신규 스프레드시트)

| 탭 | 역할 |
|---|---|
| 템플릿 | id, 이름, 분류, 버전, 최소권한레벨, 상태(활성/보관), JSON 본문(셀), 수정자, 수정일 |
| 템플릿이력 | 템플릿 저장 시마다 이전 JSON 스냅샷 행 추가 (버전 관리·롤백) |
| 테마 | 테마 id, JSON 본문, 버전 |
| 생성이력 | 누가·언제·어떤 템플릿·어떤 버전으로 생성했는지 감사 로그 |
| 권한설정 | 역할(레벨)별 템플릿 접근 매트릭스 (index.html '메뉴설정' 패턴 재사용) |
| 초안 | (Phase 2) 사용자 초안 저장 + 팀장/부서장 승인 워크플로 |

---

## 5. 클래스 구조

Vanilla JS — IIFE/모듈 패턴 (기존 `BazAuth` 스타일 유지, 빌드 도구 없음).

```
TemplateService     load(id) / list(userLevel) / saveDraft() — 시트↔캐시 동기화
FormGenerator       build(inputsSchema, container) → FormInstance
FormInstance        getValues() / setValues() / onChange()
Validator           validate(values, rules) → {ok, errors[]}
DocumentModel       { meta, pages[ { size, blocks[ {component, area, props, style} ] } ] }
LayoutEngine        resolve(block, pageSize, grid) → {x, y, w, h} (inch)
ThemeEngine         token(path) — 'color.primary' → '#1B2F5E' / 폰트·여백 해석
ComponentRegistry   register(type, spec) / get(type)
RendererBase        supports() / render(model, theme) → Promise<Blob>   ← 모든 렌더러의 계약
  PptRenderer       블록별 → pptx.addText / addTable / addImage / addChart
  ExcelRenderer     블록별 → ExcelJS 셀 병합·서식 (weekly.html genExcel 일반화)
  PdfRenderer       preview HTML → window.print() (MVP) → Phase 3 고도화
  WordRenderer      (Phase 3) docx 라이브러리
ProviderBase        fetch(query) → Promise<rows|object>                 ← 모든 프로바이더의 계약
AuthService         기존 BazAuth 확장 (레벨 1~4)
HistoryService      log(event) → GAS POST
AIService           (Phase 3) summarize / draft / translate / proofread ← GAS 프록시
TemplateBuilder     (Phase 4) analyze(file) → 템플릿 JSON 초안
```

### 핵심 계약 — 렌더러 인터페이스

```
Renderer = { id, label, ext, render(documentModel, theme) → Promise<Blob> }
```

이 계약만 지키면 어떤 포맷도 본체 수정 없이 추가할 수 있다. (Word·한글(HWP)·이미지 내보내기 등)

---

## 6. 컴포넌트 구조

컴포넌트 = "템플릿에서 쓸 수 있는 블록 타입". 각 컴포넌트는 **①props 스키마 ②HTML 미리보기 렌더 ③포맷별 렌더 힌트** 3가지를 정의한다.

| 컴포넌트 | props (요약) | PPT 매핑 | Excel 매핑 |
|---|---|---|---|
| text | content, level(title/body), align | addText | 셀 + 폰트 |
| table | columns[], rows(binding), zebra, widths | addTable | 셀 그리드 + 테두리 |
| card | title, value, accentColor | 도형 + 텍스트 | 병합 셀 + 배경색 |
| chart | type(bar/line/pie), series(binding) | addChart | (Phase 2) 이미지 삽입 |
| image | src, fit | addImage | addImage |
| header | title, logo, date, writer | 상단 밴드 | 1~3행 병합 밴드 |
| footer | pageNo, confidential | 하단 텍스트 | 하단 행 |
| repeat | of(binding), item(하위 블록) | 반복 블록 | 반복 행 |

새 컴포넌트 추가 = `components/`에 파일 1개 + `registry.register()` 1줄. 렌더러는 registry를 순회하므로 수정 불필요.

---

## 7. Template 구조

### 저장 포맷: **JSON 채택** (YAML 비교 결과)

| 기준 | JSON | YAML |
|---|---|---|
| 브라우저 파싱 | `JSON.parse` 내장 ✅ | js-yaml 라이브러리 필요 ❌ |
| GAS/Sheets 저장 | 셀에 문자열 저장·파싱 자연스러움 ✅ | 동일하나 파서 추가 필요 |
| 관리자 UI·AI가 기계 생성 | 표준, LLM 출력 안정적 ✅ | 들여쓰기 오류 위험 ❌ |
| 사람이 손으로 편집 | 다소 불편 | 편함 ✅ |

→ 손 편집은 Phase 2 관리자 폼빌더와 Phase 4 AI 빌더가 대체하므로 **JSON 단독**이 최적 (추가 라이브러리 0개).

### 템플릿 JSON 스키마 (핵심)

```json
{
  "id": "weekly-report",
  "name": "주간업무보고",
  "category": "보고서",
  "version": "1.2.0",
  "minLevel": 1,
  "formats": ["pptx", "xlsx", "pdf"],
  "theme": "company-default",
  "inputs": [
    { "key": "writer", "label": "작성자", "type": "select", "options": "@providers.staff", "required": true },
    { "key": "week",   "label": "보고 주차", "type": "week", "default": "@fn.currentWeek" },
    { "key": "rows",   "label": "처리 내역", "type": "table",
      "columns": [ {"key":"hosp","label":"병원"}, {"key":"kind","label":"구분","type":"select","options":["점검","VOC"]} ],
      "prefill": "@providers.handover.byWeek(week, writer)" },
    { "key": "special","label": "특이사항", "type": "textarea", "maxLines": 10,
      "ai": ["draft", "proofread"] }
  ],
  "rules": [ { "if": "rows.length == 0", "warn": "처리 내역이 없습니다" } ],
  "layout": {
    "grid": { "cols": 12, "rows": 8, "gap": 0.1 },
    "pages": [
      { "blocks": [
        { "component": "header", "area": "1 / 1 / 2 / 13", "props": { "title": "주간업무보고", "writer": "@writer" } },
        { "component": "table",  "area": "2 / 1 / 8 / 9",  "props": { "rows": "@rows" } },
        { "component": "text",   "area": "2 / 9 / 8 / 13", "props": { "content": "@special" } }
      ]}
    ]
  }
}
```

**바인딩 규약**
- `@key` — 사용자 입력값 바인딩
- `@providers.*` — 데이터 프로바이더 바인딩 (시트/API 자동 채움)
- `@fn.*` — 내장 함수 (현재 주차, 오늘 날짜 등)
- `"ai": [...]` — (Phase 3) 해당 입력란에 AI 버튼 자동 부착 선언

**문서 종류 확장** — 주간업무보고 · 월간업무보고 · 출장보고 · 회의록 · 교육보고 · 개선보고 · 품질보고 · CAPA · ISO · 점검보고 · AS 보고서 등은 전부 **이 스키마의 인스턴스 추가일 뿐**이며 엔진 수정이 없다.

---

## 8. Renderer / Layout / Theme 구조

### 8.1 Layout Engine — **혼합 방식 채택** (Grid 저작 + 좌표 출력)

| 방식 | 장점 | 단점 |
|---|---|---|
| 좌표 기반 | PptxGenJS와 1:1 대응 | 저작 어려움, 페이지 크기 변경에 취약 |
| Grid 기반 | 저작 쉬움, HTML 미리보기 = CSS Grid 그대로 | PPT/Excel은 최종적으로 좌표 필요 |
| **혼합 (채택)** | 템플릿은 Grid(`area: "r1 / c1 / r2 / c2"`)로 저작 → LayoutEngine이 페이지 크기 기준 **절대좌표(inch)로 변환** | 변환 계층 1개 추가 |

- HTML 미리보기 = CSS Grid 직접 매핑 → 변환 없이 동일 소스 사용, **미리보기와 산출물 일치 보장**
- PPT = `(col/12) × 페이지폭` 식 좌표 변환 / Excel = grid row·col → 셀 병합 범위 변환
- 정밀 배치가 필요한 예외 블록만 `abs: {x, y, w, h}` 직접 지정 허용 (Phase 4 AI 분석 결과 수용에도 필요)

### 8.2 Theme Engine

```json
{ "id": "company-default", "version": "1.0.0",
  "color":   { "primary": "#1B2F5E", "accent": "#2E7D9E", "danger": "#C0392B" },
  "font":    { "family": "맑은 고딕", "title": 20, "body": 10.5 },
  "spacing": { "pageMargin": 0.3, "blockGap": 0.1 },
  "border":  { "color": "#CED6E4", "width": "thin" },
  "logo":    "assets/logo.png" }
```

- 템플릿은 색을 직접 쓰지 않고 토큰(`$color.primary`)만 참조 → **테마 교체 = 전 문서 일괄 리브랜딩**
- 기존 `weekly.html`의 `XC` 색상표·`--navy` CSS 변수를 초기 테마로 이관
- HTML 미리보기용으로 테마 → CSS 변수 자동 주입

### 8.3 Renderer 우선순위

| Renderer | 라이브러리 | 시기 | 근거 |
|---|---|---|---|
| PptRenderer | PptxGenJS 3.12 (기존) | MVP | dashboard.html에서 검증됨 |
| ExcelRenderer | ExcelJS 4.4 (기존) | MVP | weekly.html에서 검증됨 |
| PdfRenderer | 미리보기 HTML + `window.print()` | MVP(간이) → Phase 3(html2pdf 계열) | 라이브러리 0개로 시작 |
| WordRenderer | docx (CDN) | Phase 3 | 수요 확인 후 |

모든 라이브러리는 기존 다중 CDN 폴백 지연 로드 패턴으로 필요 시에만 로드한다.

---

## 9. 관리자 구조

관리자가 **코딩 없이** 새 문서를 등록하는 경로를 단계적으로 넓힌다.

| 단계 | 등록 방법 | 필요 역량 |
|---|---|---|
| MVP | 템플릿 JSON을 시트 '템플릿' 탭에 붙여넣기 → 즉시 배포 (코드·Pages 재배포 불필요) | JSON 이해 |
| Phase 2 | admin.html 폼빌더 + 그리드 레이아웃 편집기로 화면에서 생성 | 마우스 조작 |
| Phase 4 | **회사 양식 파일 업로드 → AI가 템플릿 자동 생성 → 검토·게시** | 검토만 |

### admin.html (Phase 2) 기능

- 템플릿 목록 / 활성·보관 토글 / 권한 레벨 지정
- **폼 빌더**: 입력 필드 추가(라벨·타입·필수·기본값) → `inputs` 스키마 자동 생성
- **레이아웃 편집**: 12-컬럼 그리드 위 블록 배치(셀 선택/드래그) → `layout` 자동 생성
- 실시간 미리보기 (엔진의 `preview.js` 그대로 재사용)
- 저장 시 버전 자동 증가 + 이전본 '템플릿이력' 탭 스냅샷
- 접근 가드: auth 레벨 4 — 기존 `BAZ_PAGE_MIN_LEVEL` 패턴

---

## 10. 향후 확장성

### 10.1 권한 구조 (기존 auth.js 레벨 체계 확장)

| 레벨 | 역할 | 권한 |
|---|---|---|
| 1 | 일반사용자 | 허용된 템플릿으로 문서 생성 |
| 2 | 팀장 | + 팀 템플릿 접근, (Phase 2) 초안 승인 |
| 3 | 부서장 | + 부서 전체 템플릿·생성 이력 조회 |
| 4 | 관리자 | + 템플릿/테마/권한 관리 (admin.html), AI 빌더 |

- 템플릿별 `minLevel` + 시트 '권한설정' 탭 매트릭스로 이중 제어
- 인증 서버는 기존 인증 GAS 확장(레벨 4 추가) 또는 AutoDoc 전용 GAS 신설 — 상세 설계에서 결정

### 10.2 버전 관리

| 대상 | 방식 |
|---|---|
| Template | semver(`major.minor.patch`) + 저장 시마다 '템플릿이력' 탭 스냅샷, 롤백 = 이전 행 복원 |
| Theme | 동일 (테마 + 이력) |
| Renderer/엔진 | 코드이므로 git + `config.js`의 `ENGINE_VERSION`, 템플릿의 `minEngine` 필드로 호환성 검사 |
| 생성 문서 | '생성이력' 탭에 사용 템플릿 버전 기록 → "이 문서가 어떤 버전으로 만들어졌나" 추적 |

### 10.3 Data Provider 확장

`ProviderBase.fetch(query)` 계약만 지키면 다음을 순차 추가할 수 있다.

| Provider | 시기 | 비고 |
|---|---|---|
| GasProvider (Google Sheets) | MVP | 기존 handover 등 시트 데이터 자동 채움 |
| ManualProvider (폼 직접 입력) | MVP | |
| LocalJsonProvider | MVP | 정적 옵션 목록, 초안 |
| RestProvider | 확장 | 외부 API — 인터페이스 동일 |
| DbProvider | 확장 | 시트 한계 도달 시 백엔드 교체 (화면·엔진 무수정) |

### 10.4 AI 확장 (Phase 3)

```
AIService (인터페이스): summarize(text) / draft(templateId, context) / translate(text, lang) / proofread(text)
구현: GAS 프록시 → 외부 LLM API (API 키는 GAS Script Properties 보관 — 클라이언트에 비노출)
접점: 템플릿 inputs에 "ai": ["draft","proofread"] 선언 시 FormGenerator가 해당 입력란에 AI 버튼 자동 부착
```

프로바이더·컴포넌트와 동일한 "인터페이스 먼저" 원칙이므로 본체 수정 없이 부착된다.

### 10.5 AI Template Builder (Phase 4) — 최종 목표

> **"회사 샘플 양식을 넣으면, 사용자는 글만 적으면 완성되는 시스템"**

#### 흐름

```
관리자: 회사 양식 파일 업로드 (PPT / Word / Excel / PDF)
  ↓ ① 추출 (Extractor)
  PPTX·DOCX·XLSX = ZIP+XML(OOXML) → JSZip으로 구조·텍스트·좌표·서식 추출
  PDF → pdf.js로 텍스트·위치 추출 + 페이지 렌더 이미지 캡처
  ↓ ② 분석 (GAS 프록시 → 멀티모달 LLM)
  구조 데이터 + 페이지 이미지 전달 → 레이아웃 블록(헤더/표/텍스트영역)과
  "사용자가 채워야 할 칸"(입력 필드 후보: 라벨·타입·반복 여부) 추론
  ↓ ③ 생성 (TemplateBuilder)
  분석 결과 → §7의 템플릿 JSON 초안 자동 생성
  (layout 블록 + inputs 스키마 + 서식은 theme 토큰으로 정규화, 정밀 위치는 abs 좌표 활용)
  ↓ ④ 검토·수정 (admin.html)
  Phase 2 폼빌더·레이아웃 편집기·미리보기에서 관리자가 원본 양식과 비교하며 보정
  ↓ ⑤ 게시
  버전 1.0.0으로 시트 '템플릿' 탭 등록 → 카탈로그에 즉시 노출
  ↓
사용자: 카탈로그에서 선택 → 자동 생성된 입력폼에 글만 입력 → 원본과 동일한 형식의 문서 생성
```

#### 왜 이 아키텍처에서 Phase 4가 가능한가

- AI의 산출물이 **새로운 무언가가 아니라 §7의 템플릿 JSON**이다. 엔진·렌더러·폼 생성기는 그 JSON을 이미 처리할 수 있으므로 **본체 수정 0**.
- 검토 화면도 Phase 2의 admin 폼빌더를 **그대로 재사용** — AI는 폼빌더의 "초안 작성자" 역할일 뿐이다.
- AI가 틀려도 관리자 검토·수정 단계가 있어 품질이 보장된다 (AI = 초안, 사람 = 게시 승인).

#### Phase 4 기술 요소

| 요소 | 기술 | 비고 |
|---|---|---|
| OOXML 파싱 | JSZip (CDN) | pptx/docx/xlsx는 zip이므로 브라우저에서 해체 가능 |
| PDF 파싱 | pdf.js (CDN) | 텍스트 좌표 + 캔버스 렌더 이미지 |
| AI 분석 | GAS 프록시 → 멀티모달 LLM | 키 서버 보관, 이미지+구조 동시 전달 |
| 초안 → 게시 | Phase 2 admin 인프라 | 신규 UI 최소화 |

---

## 11. 장단점

### 장점

- **새 문서 = JSON 추가만.** 코드·배포와 무관 (시트 저장 → 즉시 반영)
- 미리보기와 산출물이 같은 DocumentModel에서 나오므로 결과 예측 가능
- 기존 검증 자산(auth / GAS 통신 / CDN 로더 / ExcelJS·PptxGenJS 코드) 재사용으로 구현 리스크 낮음
- 프레임워크 없음 → 기존 팀 유지보수 역량 그대로
- 렌더러·프로바이더·컴포넌트·AI 전부 인터페이스 기반 → Word/PDF/AI/DB 확장 시 본체 무수정
- Phase 4(AI 빌더)까지 같은 템플릿 스키마 하나로 수렴 → 단계별 투자에 낭비가 없음

### 단점 / 리스크와 완화

| 리스크 | 완화 |
|---|---|
| Grid→좌표 변환의 정밀도 한계 | 예외 블록 `abs` 좌표 직접 지정 허용 |
| GAS 콜드스타트 지연(1~3초) | localStorage 템플릿 캐시 + PWA 오프라인 |
| 시트 = DB의 동시성·용량 한계 | 수백 종 규모까지 충분, 초과 시 Provider 계약 유지한 채 백엔드 교체 |
| Vanilla JS 폼빌더 구현 난이도 | Phase 2로 분리, MVP는 JSON 직접 등록 |
| AI 분석 정확도(복잡한 양식) | Phase 4에 관리자 검토·수정 단계 필수 포함 (AI=초안, 사람=승인) |
| 브라우저 생성 방식의 대용량 한계 | 사내 보고서(수~수십 페이지) 용도로는 비해당 |

---

## 12. 개발 단계 Roadmap

### MVP (2~4주) — 현재 기술만으로

- 폴더 골격 + `editor.html` 단일 흐름: 카탈로그 → 폼 자동생성 → 검증 → HTML 미리보기 → PPT/Excel 생성 → 다운로드
- 엔진: DocumentModel, LayoutEngine(Grid→좌표), ThemeEngine(테마 1개), 컴포넌트 5종(text/table/header/footer/card)
- Renderer: PPT(PptxGenJS) + Excel(ExcelJS) + PDF(print 간이)
- Provider: GAS + Manual + LocalJSON
- 템플릿 3종 시드: 주간업무보고(기존 weekly 로직 이관 — 엔진 검증용), 회의록, 출장보고
- 인증: 기존 auth.js 연동, 생성이력 시트 기록

> 평가 — 개발 난이도: **중** (엔진 계층이 핵심, 나머지는 기존 코드 이관) · 유지보수: **상** (파일 분리로 기존 flat 구조보다 개선) · 확장성: **상** (인터페이스 확정이 MVP의 본질)

### Phase 2 — 관리자 · 버전 · 승인

- `admin.html`: 템플릿 CRUD + 폼 빌더 + 그리드 레이아웃 편집 + 실시간 미리보기
- 템플릿/테마 버전 관리(이력 탭 + 롤백), 권한 매트릭스 UI
- 초안 시트 저장 + 팀장/부서장 승인 워크플로, chart 컴포넌트

> 평가 — 개발 난이도: **상** (폼빌더·레이아웃 편집 UI) · 유지보수: **상** · 확장성: **상** (비개발자가 문서 추가 가능)

### Phase 3 — AI 작성 지원 + 전 포맷 통합

- AIService(GAS 프록시): 자동 요약 · 초안 작성 · 번역 · 교정 버튼 (템플릿 `"ai"` 선언 기반)
- WordRenderer(docx), PdfRenderer 고도화(서식 완전 대응)
- 한 번 입력 → PPT + Word + PDF + Excel 동시 생성

> 평가 — 개발 난이도: **상** (외부 API · 포맷별 서식 정합) · 유지보수: **중** (외부 의존성 추가) · 확장성: **최상**

### Phase 4 — AI Template Builder (최종 목표)

- 회사의 PPT/Word/Excel/PDF **양식 파일 업로드**
- AI가 레이아웃과 입력 항목을 분석 (JSZip/pdf.js 추출 + 멀티모달 LLM)
- **Template(JSON)과 입력폼을 자동 생성**
- 관리자는 admin.html에서 결과를 **검토·수정 후 게시**
- 이후 사용자는 **글만 입력하면** 원본과 동일한 형식의 문서가 생성됨

> 평가 — 개발 난이도: **최상** (양식 파싱 + AI 추론 정합) · 유지보수: **중** (핵심 로직은 프롬프트·추출기에 집중) · 확장성: **최상** (사실상 모든 회사 양식이 등록 대상이 됨)
> 전제 조건: Phase 2의 admin 폼빌더(검토 화면)와 Phase 3의 AI 프록시 인프라가 선행되어야 함

---

### 다음 단계

본 설계 승인 후 **상세 설계**(템플릿 JSON 스키마 확정, GAS API 명세, 시트 컬럼 정의) → **MVP 구현** 순으로 진행한다.
