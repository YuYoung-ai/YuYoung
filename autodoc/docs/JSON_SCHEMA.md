# JSON_SCHEMA — Template · Theme 스키마 레퍼런스

> 소스: `autodoc/templates/*.json` · `autodoc/themes/*.json` · 검증: `js/ai/template-builder.js normalize()`
> 관련: [DOCUMENT_MODEL.md](DOCUMENT_MODEL.md) · [VALIDATION_SPEC.md](VALIDATION_SPEC.md) · [COMPONENT_SPEC.md](COMPONENT_SPEC.md)

## 1. Template 스키마 v1 ✅

```jsonc
{
  "id": "weekly-report",          // 필수 · 영문 소문자-하이픈 · 시트 키/파일명
  "name": "주간업무보고",          // 필수 · 카탈로그·문서 파일명에 사용
  "desc": "한 줄 설명",            // 카탈로그 카드 부제
  "category": "보고서",            // 카탈로그 뱃지 (보고서/회의/품질/점검/…)
  "version": "1.1.0",             // semver — 관리자 저장 시 patch 자동 +1
  "minLevel": 1,                  // 최소 권한 레벨 1~3 (📋 4=관리자 전용)
  "formats": ["pptx","xlsx","docx","pdf"],  // 생성 버튼 노출 포맷
  "theme": "company-default",     // themes/<id>.json 참조
  "minEngine": "0.1.0",           // 📋 엔진 호환성 검사용 (아래 §5)
  "inputs": [ Input, ... ],       // §2 입력폼 스키마
  "rules":  [ Rule, ... ],        // VALIDATION_SPEC.md 참조
  "layout": {
    "grid": { "cols": 12, "rows": 8, "gap": 0.1 },   // rows 4~20 (normalize 클램프)
    "pages": [ { "blocks": [ Block, ... ] } ]         // §3
  }
}
```

## 2. Input 스키마 (FormGenerator 가 소비)

```jsonc
{
  "key": "writer",            // 필수 · \w 문자만 · 바인딩 이름(@key)
  "label": "작성자",           // 필수 · 폼 라벨
  "type": "text",             // 아래 표
  "required": true,           // Validator 필수 검사
  "default": "@fn.today",     // 초기값 (@fn.* 지원)
  "placeholder": "…", "rows": 4,          // UI 힌트
  "options": ["점검","VOC"],               // select 용
  "columns": [ Column, ... ],              // table 용
  "ai": ["draft","proofread"],             // Phase3 AI 버튼 자동 부착
  "prefill": { "provider":"gas", "action":"…", "params":{} }   // 📋 자동 채움 예약
}
```

### 입력 타입

| type | 렌더 | 상태 |
|---|---|---|
| `text` / `number` / `date` | input | ✅ |
| `week` | 최근 8주 선택 (값=라벨 문자열, 토~금 표기) | ✅ |
| `select` | options 드롭다운 | ✅ |
| `textarea` | 여러 줄 + AI 버튼 부착 지점 | ✅ |
| `table` | 행 카드 UI(추가/삭제) — 값은 객체 배열 | ✅ |
| `checkbox` | boolean 또는 다중 선택(options 지정 시 배열) | 📋 |
| `radio` | options 중 단일 선택 (select 의 시각 대안) | 📋 |
| `image` | 파일 선택 → dataURL 저장, image 컴포넌트에 바인딩 | 📋 |
| `repeat` | 하위 inputs 그룹 반복 (table 의 일반화 — 자유 필드 구성) | 📋 |

`Column` = `{ key, label, type?('text'|'select'|'date'|'textarea'), options? }`

### AI 작업 (`ai` 배열)

`draft`(✨ 초안) · `summarize`(📝 요약) · `proofread`(🩺 교정) · `translate`(🌐 영문 번역).
GAS + API 키 설정 시에만 버튼이 표시된다 — [API_SPEC.md](API_SPEC.md) §AI.

## 3. Block 스키마 (layout.pages[].blocks[])

```jsonc
{
  "component": "table",            // ComponentRegistry 등록 타입 (COMPONENT_SPEC.md)
  "area": "2 / 1 / 8 / 9",         // 행시작/열시작/행끝/열끝 · 끝 미포함 · 열 1~cols+1
  "abs": { "x":1.0,"y":2.0,"w":5.0,"h":3.0 },  // (선택) inch 절대좌표 — area 무시
  "props": { ... }                 // 컴포넌트별 — @바인딩·$토큰 사용 가능
}
```

바인딩 문법 전체는 [DOCUMENT_MODEL.md](DOCUMENT_MODEL.md) §3.

## 4. Theme 스키마 ✅

```jsonc
{
  "id": "company-default",
  "name": "회사 기본 테마",
  "version": "1.0.0",
  "color":   { "primary":"#1B2F5E", "accent":"#2E7D9E", "success":"#1E7E4E",
               "danger":"#C0392B", "warning":"#B8860B", "muted":"#6B7A99",
               "text":"#1A1A2E", "bg":"#F5F7FA", "line":"#DDE3EE", "primaryLight":"#2A4080", "accentSoft":"#EAF4F8" },
  "font":    { "family":"맑은 고딕", "title":20, "body":10.5 },   // pt
  "spacing": { "pageMargin":0.3, "blockGap":0.1 },                // inch
  "border":  { "color":"#CED6E4", "width":"thin" },
  "logo":    "assets/logo.png"
}
```

템플릿·컴포넌트는 색을 직접 쓰지 않고 `$color.primary` 처럼 **토큰만 참조**한다 → 테마 교체 = 전 문서 리브랜딩. 상세는 [THEME_ENGINE.md](THEME_ENGINE.md).

## 5. 버전·호환성 📋

- `minEngine`: 템플릿이 요구하는 최소 엔진 버전. TemplateService.load 시
  `semverGte(ENGINE_VERSION, minEngine)` 검사 → 미달이면 카탈로그에 ⚠ 표시 + 생성 차단 경고
- 마이그레이션: 스키마 v2 도입 시 `schemaVersion` 필드 추가 + 로드 시 v1→v2 변환기 적용

## 6. Import / Export

| 기능 | 상태 | 방식 |
|---|---|---|
| Template Export | ✅ (부분) | 관리자 [저장] 시 GAS 미설정이면 `<id>.json` 다운로드 — 이것이 Export 경로 |
| Template Export (명시 버튼) | 📋 | 편집기에 [⬇ JSON 내보내기] — buildTpl() 결과 다운로드 |
| Template Import | 📋 | [⬆ JSON 가져오기] → `TemplateBuilder.normalize()` 통과 후 편집기 로드 (AI 빌더와 같은 안전망 재사용) |
| Theme Import/Export | 📋 | 동일 패턴 — normalize 에 테마 검증 분기 추가 |

## 7. 검증기 (normalize) — AI·Import 공용 안전망 ✅

`AD.TemplateBuilder.normalize(raw, fallbackName)` 는 외부에서 온 템플릿 JSON(AI 생성·Import)을 스키마에 맞게 보정한다:

- id 슬러그화 / name·category 기본값 / version `1.0.0` 초기화 / minLevel 1~3 클램프
- inputs: 키 `\w` 정리+중복 자동 회피, 타입 화이트리스트(위 표의 ✅ 타입), textarea 에 `ai` 자동 부여, table 컬럼 보정
- rules: `{if, warn|error}` 형태만 통과
- blocks: 미등록 컴포넌트·`r/c/r/c` 형식이 아닌 area·props 누락 블록 제거 — **전부 무효면 `layout=null`** → 관리자 편집기의 자동 배치가 대신 생성
- grid.rows 4~20 클램프

## 8. 시드 템플릿 (실전 예시)

| 파일 | 보여주는 패턴 |
|---|---|
| `templates/weekly-report.json` | week 타입·table 입력·좌우 분할 레이아웃·rules(warn) |
| `templates/meeting-minutes.json` | 4분할 텍스트 레이아웃·table(후속 조치)·date default |
| `templates/trip-report.json` | card 3연속(요약 밴드)·전폭 텍스트 스택·$color 토큰 3종 |
