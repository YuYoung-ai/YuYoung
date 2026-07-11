# Phase 2 구현 명세 — 관리자 · 버전 관리 · 승인 워크플로

> 상위 문서: [DESIGN.md](DESIGN.md) · [DETAILED_DESIGN.md](DETAILED_DESIGN.md)

## 1. 추가된 것

| 항목 | 파일 | 내용 |
|---|---|---|
| 관리자 화면 | `admin.html` + `js/admin/admin.js` | 템플릿 목록·상태(활성/보관)·권한 레벨 관리, 폼 빌더, 레이아웃 편집, 실시간 미리보기, 저장(버전 자동 증가) |
| chart 컴포넌트 | `js/engine/components/chart.js` | bar/line/pie — PPT는 PptxGenJS addChart, Excel은 데이터 표, 미리보기는 가로 막대 |
| 버전 이력·롤백 | admin.html + GAS | 저장 시 이전본 자동 스냅샷(템플릿이력 탭), 이력 목록에서 [복원] |
| 승인 워크플로 | editor.html [승인 요청] + admin 승인함 + GAS 초안 탭 | 사용자 초안 제출(대기) → 관리자/부서장 승인·반려(+의견) |
| 허브 관리자 링크 | index.html | 레벨 ≥ `ADMIN_MIN_LEVEL`(기본 3)일 때 ⚙️ 관리자 버튼 노출 |

## 2. 관리자 화면 사용법 (코딩 없는 문서 등록)

1. **새 템플릿** → 기본 정보(id/이름/분류/형식/권한) 입력
2. **폼 빌더**에서 입력 필드 추가 — 키·라벨·타입(text/date/week/select/textarea/table)·필수·옵션·표 컬럼
3. **[🪄 자동 배치]** — 입력 필드를 읽어 레이아웃(header + 카드/표/텍스트 블록 + footer)을 자동 생성
4. 필요 시 블록별 area("행 / 열 / 행끝 / 열끝")·props 미세 조정 — 우측 미리보기에 즉시 반영
5. **저장** — 버전 patch 자동 +1
   - GAS 배포 시: 시트에 저장 + 이전본 이력 스냅샷 → 카탈로그 즉시 반영
   - GAS 미설정 시: `<id>.json` 다운로드 → `templates/` 폴더에 커밋 (STATIC_TEMPLATES 에 id 추가)

## 3. GAS API 추가분

| 메서드 | 요청 | 응답/동작 |
|---|---|---|
| GET | `?action=templatesAll` | 전체 템플릿 전문(보관 포함, status 필드 부가) — 관리자 목록용 |
| GET | `?action=templateHistory&id=` | `[{row, ts, version, user}]` 최신순 |
| GET | `?action=drafts[&status=대기]` | 초안 목록 `[{row, ts, template, name, user, values, status, ...}]` |
| POST | `templateStatus {id, status, user}` | 활성/보관 전환 |
| POST | `templateRestore {id, histRow, user}` | 이력 json을 현재본으로 (현재본은 자동 스냅샷) |
| POST | `draftSave {template, name, version, user, values}` | 초안 탭에 '대기' 행 추가 |
| POST | `draftReview {row, status(승인/반려), reviewer, comment}` | 상태·검토자·검토일시·의견 기록 |

**초안 탭 컬럼**: 일시 · 템플릿id · 템플릿명 · 버전 · 작성자 · values(JSON) · 상태 · 검토자 · 검토일시 · 의견

※ 기존 배포에 적용하려면: 새 `autodoc_gas.gs` 붙여넣기 → `setup()` 재실행(초안 탭 생성) → 새 버전 배포.

## 4. chart 컴포넌트 props

```json
{ "component": "chart", "area": "2 / 1 / 5 / 7",
  "props": { "type": "bar", "title": "구분별 건수",
             "source": "@rows", "labelKey": "kind", "valueKey": "count" } }
```
- `source`(표 바인딩) + `labelKey`/`valueKey`, 또는 `labels:[]`/`values:[]` 직접 지정
- `type`: bar(기본, `dir:'col'`=세로) · line · pie(범례 표시)

## 5. 권한

- `admin.html` 은 `BAZ_PAGE_MIN_LEVEL = 3` (기존 auth.js 가드) — 인증 GAS에 레벨 4(관리자) 추가 시 `admin.html`의 값과 `config.js`의 `ADMIN_MIN_LEVEL` 을 4로 상향
- 템플릿별 `minLevel` 은 관리자 편집기에서 지정 → 카탈로그가 레벨 필터링

## 6. Phase 3로 이월된 항목

- 테마 편집 UI (테마 JSON은 수동 관리 — 구조는 이미 버전 필드 보유)
- 승인된 초안을 문서로 바로 생성하는 원클릭 흐름
- 역할×템플릿 전체 권한 매트릭스 UI (현재는 템플릿별 minLevel로 제어)
