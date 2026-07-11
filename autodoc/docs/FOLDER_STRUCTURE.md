# FOLDER_STRUCTURE — 폴더 구조와 역할

> 관련: [ARCHITECTURE.md](ARCHITECTURE.md) · [DESIGN.md](DESIGN.md)

## 1. 현재 구조 (as-built ✅)

```
/                              ← 기존 BAZ CS (무수정)
├── auth.js                    ← 유일한 공유 자산 (로그인·토큰·권한)
├── autodoc_gas.gs             ← AutoDoc 전용 GAS (신규 · Apps Script에 붙여넣는 원본)
└── autodoc/                   ← AutoDoc 전체 (여기 바깥은 건드리지 않는다)
    ├── index.html             허브: 로그인(BazAuth) + 문서 카탈로그 + 관리자 링크
    ├── editor.html            핵심 화면 1개로 모든 문서: 폼 자동생성 → 실시간 미리보기 → 생성
    ├── admin.html             관리자: 템플릿 CRUD·폼 빌더·이력/롤백·승인함·AI 템플릿 빌더
    ├── manifest.json          AutoDoc 전용 PWA (scope: ./)
    ├── sw.js                  AutoDoc 전용 서비스워커 (CACHE_VERSION 배포마다 +1)
    ├── css/
    │   ├── base.css           디자인 토큰·리셋·공통 (기존 스타일 토큰 이관)
    │   └── app.css            화면별 + 컴포넌트 미리보기(c-*) 스타일
    ├── js/
    │   ├── core/
    │   │   ├── config.js      GAS_URL·ENGINE_VERSION·STATIC_TEMPLATES + 공통 유틸(esc/hex/date)
    │   │   ├── store.js       localStorage 래퍼 — 모든 키 `ad_` 접두어
    │   │   ├── bus.js         경량 이벤트 버스
    │   │   └── services.js    TemplateService(GAS↔캐시↔정적 폴백)·HistoryService·DraftService
    │   ├── engine/
    │   │   ├── document-model.js   렌더러 중립 모델 조립 + 바인딩 해석 (핵심)
    │   │   ├── layout-engine.js    Grid area → 절대좌표(inch) 변환
    │   │   ├── theme-engine.js     테마 로드·토큰 해석·CSS 변수 주입
    │   │   └── components/         1파일 1컴포넌트
    │   │       ├── registry.js     register/get/types
    │   │       └── text.js header.js table.js card.js chart.js footer.js
    │   ├── renderers/
    │   │   ├── renderer-base.js    렌더러 레지스트리 + AD.loadLib(CDN 폴백) + AD.download
    │   │   ├── ppt-renderer.js     PptxGenJS · excel-renderer.js  ExcelJS
    │   │   └── word-renderer.js    docx      · pdf-renderer.js    html2pdf(+인쇄 폴백)
    │   ├── providers/
    │   │   ├── provider-base.js    레지스트리 · gas-provider.js · local-provider.js · manual-provider.js
    │   ├── form/
    │   │   ├── form-generator.js   inputs 스키마 → DOM 폼 (+초안 자동저장, AI 버튼 부착)
    │   │   └── validator.js        required + rules 평가
    │   ├── ai/
    │   │   ├── ai-service.js       초안/요약/교정/번역 — GAS 프록시 호출
    │   │   └── template-builder.js 양식 추출(JSZip·pdf.js)→AI 분석→normalize
    │   ├── admin/
    │   │   └── admin.js            관리자 화면 전체 로직
    │   └── ui/
    │       ├── preview.js          DocumentModel → HTML 미리보기 (CSS Grid)
    │       └── toast.js            알림
    ├── templates/             시드 템플릿 JSON (운영 원본은 시트 — 여긴 정적 폴백)
    ├── themes/                company-default.json
    └── docs/                  설계 문서 (본 스위트)
```

**배치 원칙**: 새 문서 종류 추가 시 코드 폴더는 불변 — `templates/`(정적 운영) 또는 시트 '템플릿' 탭(GAS 운영)에만 추가한다.

## 2. 요청 구조 대비 매핑

요청서의 폴더 항목과 실제 위치의 대응표. "폴더가 없어도 역할은 존재"하는 항목이 있다.

| 요청서 항목 | 현재 위치 | 상태 |
|---|---|---|
| `engine/` `renderers/` `providers/` `components/` | `js/engine/` `js/renderers/` `js/providers/` `js/engine/components/` | ✅ |
| `templates/` `themes/` `css/` `docs/` `assets/` | 동일 (assets: 아이콘은 상위 `../icon-*.png` 재사용) | ✅ |
| `config/` | `js/core/config.js` (단일 파일) — 항목 증가 시 `js/config/` 폴더 승격 | ✅/📋 |
| `storage/` | `js/core/store.js`(local) + `services.js`(sheet) — `AD.Storage` 통합 인터페이스로 승격 예정 | 📋 [ARCHITECTURE §6](ARCHITECTURE.md) |
| `plugins/` | 미생성 — 인터페이스 확정 후 생성 | 📋 [PLUGIN_SPEC.md](PLUGIN_SPEC.md) |
| `preview.html` | **별도 페이지 대신 editor.html 내장 실시간 미리보기로 통합** (설계 결정) | ✅ 대체 |

### preview.html 을 별도 페이지로 두지 않은 이유 (설계 결정 기록)

1. 입력 ↔ 미리보기 **250ms 실시간 동기화**가 UX 핵심 — 페이지 분리 시 상태 전달 계층이 추가로 필요
2. 미리보기 엔진은 이미 독립 모듈(`js/ui/preview.js`) — admin·PDF 렌더러도 같은 모듈을 재사용하므로 "별도 모듈" 요구는 충족
3. 필요해지면(공유용 읽기 전용 링크 등) `preview.html?t=id` 를 `preview.js` 호출 20줄로 추가 가능 📋

## 3. 파일 추가 시 위치 규칙

| 추가하려는 것 | 위치 | 함께 할 일 |
|---|---|---|
| 새 컴포넌트 | `js/engine/components/<name>.js` | `registry.register()` 1줄 · 각 화면 script 태그 · sw.js ASSETS |
| 새 렌더러 | `js/renderers/<fmt>-renderer.js` | `AD.Renderers.register()` · editor script 태그 · sw.js |
| 새 프로바이더 | `js/providers/<name>-provider.js` | `AD.Providers.register()` |
| 새 시드 템플릿 | `templates/<id>.json` | `config.js` STATIC_TEMPLATES 에 id · sw.js (GAS 운영이면 시트 행 추가만) |
| 새 테마 | `themes/<id>.json` | 템플릿의 `theme` 필드에서 참조 |
| 플러그인 📋 | `plugins/<id>/plugin.js` | `AD.Plugins.register()` — [PLUGIN_SPEC.md](PLUGIN_SPEC.md) |

공통: **파일을 추가·수정해 배포할 때마다 `autodoc/sw.js` 의 `CACHE_VERSION` 을 반드시 올린다** (기존 BAZ CS 와 동일한 규칙).
