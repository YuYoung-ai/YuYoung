# RENDERER_SPEC — 렌더러 계약과 4종 상세

> 소스: `autodoc/js/renderers/` · 관련: [DOCUMENT_MODEL.md](DOCUMENT_MODEL.md) · [COMPONENT_SPEC.md](COMPONENT_SPEC.md) · [LAYOUT_ENGINE.md](LAYOUT_ENGINE.md)

## 1. 계약 ✅

```js
AD.Renderers.register({
  id:    'pptx',            // formats 배열의 값과 매칭
  label: 'PPT 생성',        // 버튼 라벨
  ext:   '.pptx',
  icon:  '📊',
  print: true,              // (선택) Blob 대신 인쇄 다이얼로그를 여는 렌더러 표시
  render(documentModel) → Promise<Blob | null>   // null = 인쇄형 (다운로드 생략)
});
```

**불변 원칙**
- 입력은 **DocumentModel 하나뿐** (+ 전역 `AD.Theme.get()`). 템플릿·폼·DOM 을 직접 보지 않는다
- **렌더러끼리 절대 상호 의존하지 않는다** — 공유물은 renderer-base 의 유틸과 컴포넌트 스펙뿐
- 블록 렌더는 `AD.Registry.get(component)` 의 포맷별 메서드에 위임 — 렌더러는 순회·좌표·문서 골격만 담당
- 계약만 지키면 등록 즉시 에디터 버튼·[전체 생성]에 자동 포함

## 2. 공통 인프라 (renderer-base.js) ✅

| 유틸 | 역할 |
|---|---|
| `AD.loadLib(globalName, urls[])` | **다중 CDN 폴백 지연 로더** (기존 weekly/dashboard 패턴 이관) — 첫 사용 시에만 로드, 전역 존재 확인 후 resolve |
| `AD.download(blob, filename)` | Blob 다운로드 (ObjectURL 정리 포함) |
| `AD.Renderers.register/get/all` | 렌더러 레지스트리 |

라이브러리는 전부 CDN 지연 로드 — 초기 페이지 로드에 포함되지 않는다.

## 3. PPT — ppt-renderer.js ✅ (PptxGenJS 3.12)

- `pptx.layout = 'LAYOUT_WIDE'` (13.33×7.5in) — `AD.Layout.PAGE` 와 동일 규격
- 페이지 → 슬라이드, 블록마다 `Layout.resolve()` → `{x,y,w,h}` inch 를 컴포넌트 `ppt()` 에 전달
- 색: `AD.hex()` (# 제거), 폰트: 테마 `font.family/title/body` pt 그대로
- 산출: `pptx.write('blob')`

## 4. Excel — excel-renderer.js ✅ (ExcelJS 4.4)

- 페이지 → 워크시트(문서명, 다중 페이지 시 `_n`), grid 열 수 = 시트 열(폭 11), 눈금선 숨김
- **밴드 배치 알고리즘**: 블록을 `area` 의 r1 로 그룹핑 → r1 오름차순 순회, 같은 밴드는 c1 오름차순으로
  동일 시트 행에서 시작, `cursor += max(각 블록 사용 행수) + 1`(밴드 간 여백)
- 컴포넌트 `excel(ctx)` 의 ctx: `put(r,c,v,{size,bold,color(ARGB),fill,align,valign,wrap,border})` ·
  `merge` · `box`(영역 테두리) · `theme` — weekly.html `genExcel()` 서식 코드의 일반화
- 페이지 설정: 가로·fitToWidth 1 · 산출: `wb.xlsx.writeBuffer()` → Blob

## 5. Word — word-renderer.js ✅ (docx 8.5 UMD, 전역 `docx`)

- 흐름(flow) 문서 — Excel 과 동일한 밴드 **순서**로 컴포넌트 `word(ctx)` 가 `ctx.children` 에
  Paragraph/Table 을 push, 밴드 사이 빈 문단
- 섹션: A4 가로(`PageOrientation.LANDSCAPE`), 문서 기본 run = 테마 폰트
- **half-point 주의**: docx 의 size 단위는 pt×2 (`10.5pt → 21`)
- 산출: `Packer.toBlob(doc)`

## 6. PDF — pdf-renderer.js ✅ (html2pdf.js 0.10.1 → 실패 시 인쇄 폴백)

미리보기 HTML(같은 DocumentModel)을 화면 뒤 레이어에 렌더 → A4 가로 캡처.

### 이 렌더러의 함정과 해결 (실측 — 재발 방지용 기록)

| 함정 | 증상 | 해결 (현재 코드) |
|---|---|---|
| html2pdf 는 `.from()` 대상을 자체 컨테이너에 복제해 높이를 재는데, 대상이 `position:absolute` 면 컨테이너 높이가 0 | 내용 없는 3KB PDF | 호스트(absolute, z-index:-9999)는 가림 방지용으로만 쓰고, **캡처 대상은 반드시 정적(static) 내부 래퍼** |
| 클론 과정에서 CSS `aspect-ratio` 유실 | 페이지 높이 0 | 캡처 직전 `.ad-page` 높이를 `clientWidth × H/W` **픽셀로 고정** |
| 화면 밖(left:-9999px) 배치 | 빈 캔버스 캡처 가능성 | 화면 안 뒤쪽 레이어(absolute + z-index:-9999 + pointer-events:none) 사용 |

- 옵션: margin 6mm · jpeg 0.95 · html2canvas scale 2 · jsPDF A4 landscape · 다중 페이지는 `.ad-page` 별 page-break
- CDN 로드 실패 시: 새 창에 미리보기 렌더 + `window.print()` 폴백 (`null` 반환 — 다운로드 생략)

## 7. 새 렌더러 추가 절차

1. `js/renderers/<fmt>-renderer.js` — §1 계약 구현. 좌표형 포맷이면 PPT 패턴(resolve), 흐름형이면 Excel/Word 밴드 패턴을 따른다
2. 필요 컴포넌트에 해당 포맷 메서드 추가 (없으면 그 블록만 생략됨 — 점진 구현 가능)
3. `editor.html` script 태그 · `sw.js` ASSETS/CACHE_VERSION · 템플릿 `formats` 에 id 추가
4. 다른 렌더러는 **절대 수정하지 않는다**

## 8. 전체 생성 (Phase 3) ✅

editor 의 [📦 전체 생성] 은 `template.formats` 를 순회하며 각 렌더러의 `render(model)` 를 **순차** 실행
(같은 모델 재사용, 검증 1회) — 한 번 입력으로 PPT+Excel+Word+PDF 동시 산출.
