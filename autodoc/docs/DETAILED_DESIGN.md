# AutoDoc 상세 설계 (MVP 구현 명세)

> 상위 문서: [DESIGN.md](DESIGN.md) — 전체 아키텍처·로드맵
> 본 문서는 MVP로 구현된 코드의 계약(스키마·API·컬럼)을 확정합니다.

---

## 1. 배포·설정 절차

1. **정적 파일**: `autodoc/` 폴더가 GitHub Pages 로 함께 배포됨 (기존 파이프라인, 추가 설정 없음)
2. **GAS 백엔드** (선택 — 없어도 정적 템플릿으로 동작):
   1. Apps Script 새 프로젝트에 저장소 루트의 `autodoc_gas.gs` 붙여넣기
   2. `setup()` 1회 실행 → "AutoDoc DB" 스프레드시트 자동 생성 (탭: 템플릿/템플릿이력/생성이력)
   3. 웹 앱 배포(액세스: 모든 사용자) → `/exec` URL 복사
   4. `autodoc/js/core/config.js` 의 `GAS_URL` 에 입력
3. **인증**: 기존 `auth.js`(루트) 재사용. AutoDoc 허브(index.html)가 로그인 화면을 겸함.
   `editor.html` 은 auth.js 가드의 기본 규칙(레벨 1)으로 보호됨.
4. **서비스워커**: `autodoc/sw.js` 는 `/autodoc/` 스코프 전용 — 기존 루트 `sw.js` 와 충돌 없음.
   AutoDoc 파일 수정 배포 시 `autodoc/sw.js` 의 `CACHE_VERSION` 을 올릴 것.

## 2. GAS API 명세 (`autodoc_gas.gs`)

통신 규약은 기존 BAZ CS 와 동일: GET 은 `?action=`, POST 는 `text/plain` JSON(preflight 회피).

| 메서드 | 요청 | 응답 |
|---|---|---|
| GET | `?action=ping` | `{success:true, ts}` |
| GET | `?action=templates` | `{success, data:[{id,name,category,desc,version,minLevel,formats[]}]}` — 상태=활성만 |
| GET | `?action=template&id=<id>` | `{success, data:<템플릿 JSON 전문>}` |
| POST | `{action:'log', user, template, version, format}` | `{success}` — 생성이력 추가 |
| POST | `{action:'templateSave', template:<JSON>, user, status?}` | `{success, updated\|created}` — 기존본은 템플릿이력 탭에 자동 스냅샷 |

오류는 항상 `{success:false, error:'...'}` 형태.

## 3. Google Sheets 컬럼 정의 (AutoDoc DB)

**템플릿** 탭
| 열 | id | 이름 | 분류 | 설명 | 버전 | 최소레벨 | 상태 | formats | json | 수정자 | 수정일 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 예 | weekly-report | 주간업무보고 | 보고서 | … | 1.0.0 | 1 | 활성 | pptx,xlsx,pdf | `{...전문}` | 홍길동 | 2026-07-10 |

**템플릿이력** 탭: 일시 · id · 버전 · json(이전본 전문) · 수정자
**생성이력** 탭: 일시 · 사용자 · 템플릿 · 버전 · 포맷

## 4. 템플릿 JSON 스키마 v1 (확정)

```
{
  id: string            // 고유 id (파일명/시트 키)
  name: string          // 표시 이름
  desc: string          // 카탈로그 설명 (선택)
  category: string      // 분류 (카탈로그 뱃지)
  version: string       // semver
  minLevel: number      // 최소 권한 레벨 (1~4)
  formats: string[]     // 'pptx' | 'xlsx' | 'pdf' | 'docx'(Phase 3)
  theme: string         // themes/<id>.json
  inputs: Input[]       // 입력폼 스키마 (§5)
  rules: Rule[]         // 검증 규칙 (§6)
  layout: {
    grid: { cols, rows, gap }        // 기본 12 × 8, gap inch
    pages: [ { blocks: Block[] } ]   // 페이지 배열 = PPT 슬라이드/시트
  }
}

Block = {
  component: 'text'|'header'|'table'|'card'|'footer'|...(Registry 등록 타입)
  area: 'r1 / c1 / r2 / c2'   // CSS grid-area 문법, end exclusive
  abs?: {x,y,w,h}             // (선택) inch 절대좌표 — grid 대신 정밀 배치
  props: { ... }              // 컴포넌트별 속성 + 바인딩
}
```

### 바인딩 문법 (document-model.js)

| 표기 | 의미 |
|---|---|
| `"@key"` (문자열 전체) | 입력값 통째 바인딩 — 배열 유지 (표 rows 등) |
| `"@key.sub"` | 중첩 경로 |
| `"@fn.today"` / `"@fn.now"` / `"@fn.currentWeek"` | 내장 함수 |
| `"제목 @writer 님"` | 문자열 내 보간 (객체/배열은 빈 문자열) |
| `"$color.primary"` | 테마 토큰 (Theme Engine 이 해석) |

## 5. inputs 스키마 (Form Generator)

```
Input = {
  key: string           // values 의 키 = 바인딩 이름
  label: string
  type: 'text'|'number'|'date'|'week'|'select'|'textarea'|'table'
  required?: boolean    // Validator 필수 검사
  default?: any         // '@fn.*' 지원
  placeholder?, rows?   // UI 힌트
  options?: string[]    // select 용
  columns?: Column[]    // table 용: {key,label,type?('text'|'select'|'date'|'textarea'),options?}
  ai?: string[]         // (Phase 3 예약) 'draft'|'proofread'|...
  prefill?: object      // (Phase 2 예약) {provider:'gas', action, params} 자동 채움
}
```

- `week` 타입: 최근 8주 라벨 선택(값 = 라벨 문자열, weekly.html 로직 이관)
- 모든 입력은 `draft_<템플릿id>` 키로 localStorage 자동 임시저장

## 6. rules 스키마 (Validator)

```
Rule = { if: '<cond>', warn?: string, error?: string }
cond  = '<path>[.length] <op> <숫자|문자열>'   op: == != >= <= > <
```
- `error` → 생성 차단, `warn` → confirm 후 진행
- `required` 입력은 rules 없이도 자동 검사

## 7. 컴포넌트 계약 (Registry)

```
AD.Registry.register(type, {
  html (props, theme)              → 미리보기 innerHTML (em 단위 — 페이지 폰트 배율 승계)
  ppt  (slide, props, rect, theme) → rect = {x,y,w,h} inch (LayoutEngine 변환 결과)
  excel(ctx, props) → 사용한 행 수  // ctx = {ws,row,c1,c2,put,merge,box,theme}
})
```

Excel 배치 규칙: 같은 grid 행(r1)에서 시작하는 블록은 같은 시트 행에서 시작(밴드),
밴드 높이 = 블록들이 반환한 행 수의 최댓값, 밴드 사이 여백 1행.

## 8. 렌더러/프로바이더 계약

```
Renderer = { id, label, ext, icon?, print?, render(model) → Promise<Blob|null> }
Provider = { id, fetch(query) → Promise<rows|object> }
```
- 등록: `AD.Renderers.register(...)` / `AD.Providers.register(...)`
- PDF 렌더러는 Blob 대신 인쇄 다이얼로그를 열고 `null` 반환 (`print:true`)
- 라이브러리는 `AD.loadLib(globalName, cdnUrls[])` 다중 CDN 폴백 지연 로드

## 9. MVP 파일 목록

| 경로 | 역할 |
|---|---|
| `autodoc/index.html` | 허브: 로그인(BazAuth) + 문서 카탈로그 |
| `autodoc/editor.html` | 입력폼 자동생성 → 실시간 미리보기 → 생성/다운로드 |
| `autodoc/js/core/*` | config(GAS_URL·유틸) · store · bus · services(Template/History) |
| `autodoc/js/engine/*` | document-model · layout-engine · theme-engine · components/5종 |
| `autodoc/js/renderers/*` | base(로더·다운로드) · ppt · excel · pdf |
| `autodoc/js/providers/*` | base · gas · local · manual |
| `autodoc/js/form/*` | form-generator · validator |
| `autodoc/js/ui/*` | preview · toast |
| `autodoc/templates/*.json` | 시드 3종: 주간업무보고 · 회의록 · 출장보고 |
| `autodoc/themes/company-default.json` | 회사 기본 테마 |
| `autodoc/manifest.json`, `autodoc/sw.js` | AutoDoc 전용 PWA |
| `autodoc_gas.gs` (저장소 루트) | GAS 백엔드 (시트 DB) |

## 10. 새 문서 추가 방법 (운영 가이드)

1. `templates/` 의 기존 JSON 하나를 복사해 `id`/`name`/`inputs`/`layout` 수정
2. **GAS 사용 시**: 시트 '템플릿' 탭에 행 추가(json 셀에 전문 붙여넣기, 상태=활성) → 즉시 반영
3. **정적 배포 시**: `templates/<id>.json` 추가 + `config.js` 의 `STATIC_TEMPLATES` 에 id 추가 + `sw.js` ASSETS/CACHE_VERSION 갱신
4. 코드(엔진·렌더러) 수정 없음 — 이것이 플랫폼의 핵심 검증 포인트

## 11. 남은 작업 (Phase 2 진입 전 결정 사항)

- 인증 GAS 에 레벨 4(관리자) 추가 여부 — 현재 레벨 3(dashboard)까지 존재
- admin.html 폼빌더 UX (셀 선택 vs 드래그)
- 초안 시트 저장 + 승인 워크플로의 시트 스키마
