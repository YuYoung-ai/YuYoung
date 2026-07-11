# THEME_ENGINE — 테마 토큰 시스템

> 소스: `autodoc/js/engine/theme-engine.js` · `autodoc/themes/company-default.json`
> 관련: [JSON_SCHEMA.md](JSON_SCHEMA.md) §4 · [COMPONENT_SPEC.md](COMPONENT_SPEC.md)

## 1. 원칙

**템플릿은 색을 직접 가지지 않는다.** 색·폰트·여백·테두리는 전부 Theme JSON 의 토큰이며,
템플릿·컴포넌트는 `$color.primary` 같은 **토큰 참조**만 쓴다.
→ 테마 파일 교체 한 번으로 전 문서(전 포맷)가 일괄 리브랜딩된다.

## 2. API ✅

| 메서드 | 동작 |
|---|---|
| `AD.Theme.load(id)` | `themes/<id>.json` fetch → 성공 시 localStorage 캐시(`ad_theme_<id>`) 갱신, 실패 시 캐시 폴백 (오프라인 대응) |
| `AD.Theme.token('color.primary')` | 경로 탐색 → `#1B2F5E` |
| `AD.Theme.resolve(v)` | `'$'` 로 시작하는 문자열이면 token(), 아니면 그대로 — props 값 해석용 |
| `AD.Theme.get()` | 현재 테마 객체 (렌더러가 폰트·여백 직접 참조) |
| `AD.Theme.cssVars(el)` | 미리보기용 — `color.*` → `--ad-<key>`, `font.family` → `--ad-font` CSS 변수 주입 |

## 3. 토큰 → 포맷별 매핑

| 토큰 | HTML 미리보기 | PPT | Excel | Word |
|---|---|---|---|---|
| `color.*` `#RRGGBB` | CSS 변수 `--ad-*` | `AD.hex()` → `RRGGBB` | `AD.hexA()` → `FFRRGGBB` (ARGB) | `RRGGBB` |
| `font.family` | `--ad-font` | `fontFace` | `font.name` | 문서 기본 run font |
| `font.title/body` (pt) | 페이지 폭 비례 px 환산 | `fontSize` pt | `size` pt | half-point (pt×2) |
| `spacing.pageMargin` (inch) | 페이지 padding % | Layout.resolve 의 m | (여백 개념 없음 — 밴드 간 1행) | 섹션 기본 여백 |
| `border.color/width` | `--ad-line` | 표 border | thin border ARGB | 문단/셀 border |

색 변환 유틸은 `js/core/config.js` 의 `AD.hex / AD.hexA`.

## 4. 해석 시점 (중요)

`$` 토큰은 DocumentModel 조립 때 치환하지 **않고** 렌더 시점에 컴포넌트가 해석한다.
같은 모델을 다른 테마로 재렌더 가능하게 하기 위한 의도적 설계 — [DOCUMENT_MODEL.md](DOCUMENT_MODEL.md) §2.

```js
// card 컴포넌트 예 (실제 코드)
var accent = AD.Theme.resolve(p.accent || '$color.primary') || '#1B2F5E';
```

## 5. 새 테마 추가 절차

1. `themes/company-default.json` 복사 → `themes/<새id>.json`, `id`·색·폰트 수정
2. 템플릿의 `"theme": "<새id>"` 지정 (템플릿별 테마 가능)
3. `sw.js` ASSETS 에 추가 + CACHE_VERSION 증가
4. GAS 운영 📋: 시트 '테마' 탭 저장·로드는 설계만 존재 ([API_SPEC.md](API_SPEC.md) — 현재 테마는 정적 파일 운영)

## 6. 향후 📋

| 항목 | 내용 |
|---|---|
| Theme Builder | 관리자 화면에서 색상 피커·폰트 선택으로 테마 JSON 생성 — [ADMIN_SPEC.md](ADMIN_SPEC.md) §7 |
| 테마 이력 | 템플릿과 동일한 시트 스냅샷·롤백 패턴 적용 |
| 다크/인쇄 변형 | 하나의 테마에 `variants` 필드로 파생 팔레트 |
| 토큰 확장 | `color.chart[]`(차트 시리즈 팔레트 — 현재 chart 컴포넌트는 primary 계열 5색 하드코딩) |
