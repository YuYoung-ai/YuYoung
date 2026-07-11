# Phase 4 구현 명세 — AI Template Builder (최종 목표)

> 상위 문서: [DESIGN.md](DESIGN.md) · [PHASE2.md](PHASE2.md) · [PHASE3.md](PHASE3.md)
> **"회사 샘플 양식을 넣으면, 사용자는 글만 적으면 완성되는 시스템"**

## 1. 전체 흐름

```
관리자: admin.html [🪄 AI 템플릿 빌더] 에 양식 파일 업로드 (.pptx .docx .xlsx .pdf)
  ↓ ① 추출 — 브라우저에서 (js/ai/template-builder.js)
    pptx/docx/xlsx = ZIP+OOXML → JSZip 으로 슬라이드/본문/셀 텍스트 추출
    pdf → pdf.js 로 페이지별 텍스트 추출 (최대 10페이지, 15,000자 상한)
  ↓ ② 분석 — GAS 프록시 {action:'aiTemplate'} → Claude API
    시스템 프롬프트 = 템플릿 스키마 v1 명세 + 컴포넌트/바인딩/레이아웃 규칙
    "고정 서식 vs 사용자가 채우는 값"을 구분해 inputs·layout 설계
  ↓ ③ 정규화 — normalize(): 스키마 검증·보정
    · 키 중복/특수문자 정리, 타입 화이트리스트, textarea 에 AI 버튼 자동 부여
    · 미등록 컴포넌트·잘못된 area 블록 제거 — 전부 무효면 layout=null
      → 편집기의 [자동 배치]가 inputs 기준으로 레이아웃 생성 (안전망)
  ↓ ④ 검토 — 관리자 편집기(Phase 2 폼빌더)가 자동으로 열림
    필드·레이아웃·미리보기 확인, 필요 시 수정
  ↓ ⑤ 게시 — [저장] → 시트 등록 → 카탈로그 즉시 노출
  ↓
사용자: 카탈로그에서 선택 → 자동 생성된 입력폼에 글만 입력 → 원본 형식 문서 생성
```

## 2. 왜 엔진 수정이 0인가

AI의 산출물이 **기존 템플릿 JSON 스키마 그 자체**이기 때문입니다.
- 폼 생성기·렌더러 4종·미리보기는 그 JSON을 이미 처리함
- 검토 화면은 Phase 2 관리자 폼빌더 재사용 (AI = 폼빌더의 "초안 작성자")
- AI 호출은 Phase 3 GAS 프록시 인프라 재사용 (같은 키, 같은 규약)
- AI가 틀려도 **관리자 검토·수정 단계**가 품질을 보장 (AI=초안, 사람=게시 승인)

## 3. 파일별 역할

| 파일 | 역할 |
|---|---|
| `js/ai/template-builder.js` | extract(파일→텍스트) · request(GAS 호출) · normalize(스키마 보정) |
| `admin.html` + `js/admin/admin.js` | 업로드 UI·진행 상태 표시·편집기 연결 |
| `autodoc_gas.gs` `aiTemplate_()` | 스키마 명세 프롬프트로 Claude 호출(max_tokens 16000), 코드펜스 제거 후 JSON 파싱 |

## 4. GAS API 추가분

| 메서드 | 요청 | 응답 |
|---|---|---|
| POST | `{action:'aiTemplate', fileName, fileType, content(추출 텍스트)}` | `{success, data:<템플릿 JSON 초안>, model}` |

설정은 Phase 3와 동일: 스크립트 속성 `ANTHROPIC_API_KEY` (+선택 `AI_MODEL`, 기본 `claude-opus-4-8`).
새 버전 배포만 하면 됨 (setup() 재실행 불필요 — 시트 변경 없음).

## 5. 정규화(normalize) 규칙 — AI 산출물 안전망

| 항목 | 규칙 |
|---|---|
| id | 영문 소문자·하이픈으로 슬러그화, 비면 파일명 기반 생성 |
| inputs.key | `\w` 외 문자 → `_`, 중복 키 자동 회피, 빈 키 → fieldN |
| inputs.type | 화이트리스트(text/number/date/week/select/textarea/table) 외 → text |
| textarea | `ai:["draft","proofread"]` 자동 부여 (Phase 3 버튼 활성) |
| layout.blocks | Registry 미등록 컴포넌트·`r/c/r/c` 형식이 아닌 area·props 없는 블록 제거 |
| layout 전부 무효 | `layout=null` → 편집기 진입 시 자동 배치로 생성 |
| version/theme | 항상 `1.0.0` / `company-default` 로 초기화 |

## 6. 한계와 운영 가이드

- 추출은 **텍스트 기반**입니다. 복잡한 표 병합·이미지 중심 양식은 레이아웃 정확도가 떨어질 수 있음
  → 관리자 검토 단계에서 블록 area 를 조정하거나 [자동 배치]로 재생성
- PDF는 앞 10페이지, 텍스트 15,000자까지 분석 (스캔 이미지 PDF는 추출 불가)
- 향후 고도화 여지: 페이지 렌더 이미지를 함께 전달(멀티모달)해 좌표 정밀도 향상 —
  GAS 프록시에 이미지 base64 전달만 추가하면 되는 구조

## 7. 로드맵 완결

| 단계 | 상태 |
|---|---|
| MVP — 엔진·렌더러(PPT/Excel/PDF간이)·폼 자동생성·시드 3종 | ✅ |
| Phase 2 — 관리자 폼빌더·버전 이력/롤백·승인 워크플로·chart | ✅ |
| Phase 3 — AI 작성 지원·Word·PDF 실파일·전체 생성 | ✅ |
| Phase 4 — AI Template Builder (양식 업로드 → 템플릿 자동 생성) | ✅ |
