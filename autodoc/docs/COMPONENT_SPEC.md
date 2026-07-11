# COMPONENT_SPEC — 컴포넌트 계약과 상세 스펙

> 소스: `autodoc/js/engine/components/` · 관련: [RENDERER_SPEC.md](RENDERER_SPEC.md) · [LAYOUT_ENGINE.md](LAYOUT_ENGINE.md) · [THEME_ENGINE.md](THEME_ENGINE.md)

## 1. 계약 ✅

컴포넌트 = "템플릿에서 쓸 수 있는 블록 타입". `AD.Registry.register(type, spec)` 로 등록하며,
스펙은 **포맷별 렌더 메서드의 집합**이다:

```js
AD.Registry.register('text', {
  html (props, theme)              → 미리보기 innerHTML 문자열 (em 단위 — 페이지 폰트 배율 승계)
  ppt  (slide, props, rect, theme) → PptxGenJS 슬라이드에 그림. rect = Layout.resolve() 결과 inch
  excel(ctx, props) → 사용 행 수    // ctx = { ws, row, c1, c2, put, merge, box, theme }
  word (ctx, props)                 // ctx = { d(docx lib), theme, children[] } — children 에 push
});
```

**핵심 성질**
- 렌더러는 registry 를 순회할 뿐이므로 **컴포넌트를 추가해도 렌더러는 수정하지 않는다**
- 특정 포맷 메서드가 없으면 그 포맷에서 해당 블록은 조용히 생략된다 (부분 구현 허용)
- 컴포넌트는 서로를 참조하지 않는다 (chart 가 내부 `_series` 헬퍼를 갖듯 자급자족)

## 2. 구현된 컴포넌트 6종 ✅

### text — 텍스트 블록
| prop | 설명 |
|---|---|
| `title` | 소제목 밴드 (밑줄 스타일) — 생략 가능 |
| `content` | 본문 (개행 유지, 보통 `@textarea키` 바인딩) |
| `level` | `'title'` 이면 큰 제목 스타일 |
| `align`, `color` | 정렬 / `$토큰` 색 |

### header — 문서 상단 밴드
`title` `subtitle` `writer` `date` — primary 배경 밴드에 제목(좌) + 메타(우 `·` 연결).
Excel 은 2행 병합 밴드 + 메타 1행, Word 는 음영 문단.

### table — 표
| prop | 설명 |
|---|---|
| `title` | 표 위 소제목 |
| `columns` | `[{key, label, width(비율 0~1)}]` |
| `rows` | 행 객체 배열 — 보통 `"@표입력키"` 통째 바인딩 |
| zebra | 자동 (짝수행 음영) |

헤더행 primary 배경/흰 글자. Excel 은 width 비율로 시트 열 분배(마지막 컬럼이 잔여 흡수), 행 높이는 내용 줄 수 반영.

### card — 라벨+값 요약 카드
`title`(라벨) `value`(값) `accent`(`$color.*` — 상단 포인트/값 색). 짧은 필드 2~3개를 한 행에 요약할 때.

### chart — 차트 (Phase 2)
| prop | 설명 |
|---|---|
| `type` | `bar`(기본, `dir:'col'`=세로) · `line` · `pie`(범례 표시) |
| `source` + `labelKey`/`valueKey` | 표 입력 바인딩에서 시리즈 추출 (`"@rows"` 등) |
| `labels` + `values` | 직접 지정 (source 대신) |
| `title` | 차트 제목 |

PPT=네이티브 addChart(테마 5색), HTML=가로 막대, Excel/Word=데이터 표/목록 폴백.

### footer — 하단 문구
`text` — 중앙 정렬 소형 회색 (회사명·기밀 표시·생성일).

## 3. 미리보기 스타일 규약

- 각 컴포넌트의 html() 결과에는 `c-<이름>` 클래스 — 스타일은 `css/app.css` 의 "컴포넌트 미리보기" 섹션
- 크기는 **em 단위** 사용: 페이지 엘리먼트가 `폭/(13.333×72)` 비율로 body pt 를 px 환산해 font-size 를 걸므로, em 을 쓰면 실물 문서와 같은 비율로 스케일된다
- 색은 `var(--ad-primary, #기본색)` — Theme.cssVars 가 주입한 변수 사용

## 4. 새 컴포넌트 추가 절차 ✅

1. `js/engine/components/<name>.js` 생성 — 위 계약대로 4개 메서드 구현 (일부만도 가능)
2. `editor.html` / `admin.html` 에 `<script>` 태그 추가 (registry.js 이후, document-model.js 이전)
3. `css/app.css` 에 `c-<name>` 미리보기 스타일
4. `sw.js` ASSETS 추가 + CACHE_VERSION 증가
5. 렌더러·엔진·폼 수정 **없음** — 템플릿 blocks 에서 즉시 사용 가능

## 5. 계획된 컴포넌트 📋

| 컴포넌트 | props(안) | 포맷 매핑(안) | 비고 |
|---|---|---|---|
| **image** | `src`(dataURL 또는 경로 — `@image입력키` 바인딩), `fit`('contain'/'cover') | PPT addImage / Excel addImage / Word ImageRun / HTML `<img>` | image 입력 타입(📋)과 세트 |
| **section** | `title`, `children[]`(하위 블록) — 시각적 묶음·구분선 | 제목 밴드 + 자식 위임 렌더 | 레이아웃 그룹핑 |
| **repeat** | `of`("@배열키"), `item`(블록 템플릿) — 데이터 개수만큼 블록 반복 | 항목별 렌더 반복 (Excel/Word 는 순차, PPT 는 영역 등분) | 명세만 스키마에 예약됨 |

추가 시에도 본 문서의 계약(§1)과 절차(§4)만 따르면 렌더러 무수정 원칙이 유지된다.
