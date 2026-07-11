# LAYOUT_ENGINE — Grid 저작 → 절대좌표 변환

> 소스: `autodoc/js/engine/layout-engine.js` · 관련: [DOCUMENT_MODEL.md](DOCUMENT_MODEL.md) · [RENDERER_SPEC.md](RENDERER_SPEC.md)

## 1. 설계 결정: 혼합 방식 ✅

| 방식 | 문제 |
|---|---|
| 좌표만 | 저작이 어렵고 페이지 크기 변경에 취약 |
| Grid만 | PPT/Excel 은 결국 절대 위치·셀 범위가 필요 |
| **혼합 (채택)** | 템플릿은 CSS Grid 문법으로 **저작**하고, 좌표가 필요한 렌더러를 위해 출력 직전에 **절대좌표(inch)로 변환** |

HTML 미리보기는 area 를 CSS `grid-area` 로 **변환 없이 그대로** 사용한다 — 미리보기와 산출물이 같은 소스에서 나오므로 구조가 일치한다.

## 2. 페이지 규격

```js
AD.Layout.PAGE = { W: 13.333, H: 7.5 }   // inch — PPT 16:9 와이드(LAYOUT_WIDE)와 동일
```

모든 좌표 계산의 기준 캔버스. PDF(A4 가로)·미리보기는 이 비율(16:9)을 유지한 채 스케일된다.

## 3. area 문법

```
"area": "r1 / c1 / r2 / c2"      (CSS grid-area 와 동일 · end는 미포함)
```

- 기본 그리드 12열 × 8행 → 열 값은 1~13, 행 값은 1~rows+1
- 예: `"1 / 1 / 2 / 13"` = 1행 전체 폭(헤더) · `"2 / 9 / 5 / 13"` = 2~4행, 9~12열(우측 패널)
- `parseArea(a)` → `{r1,c1,r2,c2}` (누락 시 `1 / 1 / 2 / 13` 기본)

## 4. 변환 수식 — `resolve(block, grid, theme)` → `{x,y,w,h}` inch

```
m   = theme.spacing.pageMargin (기본 0.3)      # 페이지 여백
gap = grid.gap (기본 0.1)                      # 블록 간격
iw  = PAGE.W − 2m ; ih = PAGE.H − 2m           # 내부 캔버스
cw  = iw / cols   ; rh = ih / rows             # 셀 크기

x = m + (c1−1)·cw + gap/2
y = m + (r1−1)·rh + gap/2
w = (c2−c1)·cw − gap
h = (r2−r1)·rh − gap
```

소수 3자리 반올림. 예 (12×8, m=0.3, gap=0.1): `"1 / 1 / 2 / 13"` → `{x:0.35, y:0.35, w:12.633, h:0.763}`.

### abs 예외 (정밀 배치)

```jsonc
{ "component": "text", "abs": { "x": 1.0, "y": 2.5, "w": 5.0, "h": 1.2 }, "props": {...} }
```

`abs` 가 있으면 변환 없이 그대로 반환 — 회사 양식의 정확한 위치 재현(특히 AI Template Builder 산출물 보정)에 사용.
단, abs 블록은 HTML 미리보기에서 grid 배치와 어긋날 수 있으므로 예외적으로만 쓴다.

## 5. 렌더러별 소비 방식

| 렌더러 | Grid 소비 방법 |
|---|---|
| **HTML 미리보기** | `grid-template: repeat(rows,1fr)/repeat(cols,1fr)` 컨테이너에 블록을 `grid-area` 로 배치. 폰트는 페이지 폭 기준 pt→px 환산(`clientWidth/(W·72)`)으로 실물 비율 재현 |
| **PPT** | 블록마다 `resolve()` 호출 → PptxGenJS `{x,y,w,h}` inch 옵션에 1:1 전달 |
| **Excel** | 좌표 대신 **밴드 규칙**: grid 열(1~cols)=시트 열, 같은 r1 에서 시작하는 블록은 같은 시트 행에서 시작, 밴드 높이=블록들이 사용한 행 수의 최댓값, 밴드 사이 여백 1행 |
| **Word** | 흐름 문서라 좌표 없음 — Excel 과 같은 **밴드 순서**(r1 오름차순, 동일 밴드는 c1 오름차순)로 순차 배치 |
| **PDF** | HTML 미리보기를 그대로 캡처하므로 Grid 소비 방식은 미리보기와 동일 |

즉 "좌표형 포맷(PPT)"은 resolve 수식을, "흐름형 포맷(Excel/Word)"은 **밴드 순서화**를 쓴다 — 둘 다 같은 area 선언에서 파생되므로 템플릿은 하나만 저작하면 된다.

## 6. 저작 가이드

- 헤더는 1행 전체 폭, 푸터는 마지막 행 전체 폭이 관례 (자동 배치·AI 빌더도 이 관례를 따름)
- 블록 area 는 서로 겹치지 않게 (미리보기·PPT 는 겹침을 그대로 그림 — 검증하지 않음 📋 겹침 경고는 ROADMAP)
- 내용이 길어질 표·텍스트는 행 수(r2−r1)를 여유 있게 — PPT 는 영역을 넘치면 잘리는 것이 아니라 폰트 그대로 흘러넘침
- 행이 부족하면 `grid.rows` 를 늘린다(관리자 자동 배치는 필요 시 8행 이상으로 자동 확장, 상한 20)
