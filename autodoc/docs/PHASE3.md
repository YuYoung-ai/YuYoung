# Phase 3 구현 명세 — AI 작성 지원 · Word 렌더러 · PDF 고도화 · 전체 생성

> 상위 문서: [DESIGN.md](DESIGN.md) · [DETAILED_DESIGN.md](DETAILED_DESIGN.md) · [PHASE2.md](PHASE2.md)

## 1. 추가된 것

| 항목 | 파일 | 내용 |
|---|---|---|
| AI Service | `js/ai/ai-service.js` + GAS `aiCall_()` | 초안 작성·요약·교정·영문 번역 — GAS 프록시 경유 Claude API 호출 |
| AI 버튼 자동 부착 | `js/form/form-generator.js` | 템플릿 inputs에 `"ai":[...]` 선언 시 해당 입력란 아래 버튼 표시 |
| Word 렌더러 | `js/renderers/word-renderer.js` + 컴포넌트별 `word()` | docx 라이브러리(UMD)로 A4 가로 .docx 생성 |
| PDF 고도화 | `js/renderers/pdf-renderer.js` | html2pdf.js로 실제 .pdf Blob 다운로드 (실패 시 인쇄 폴백) |
| 전체 생성 | `editor.html` | 한 번 입력 → PPT+Excel+Word+PDF 순차 생성 [📦 전체 생성] |
| 시드 템플릿 갱신 | `templates/*.json` v1.1.0 | 전 템플릿 docx 포맷 + ai 선언 추가 |

## 2. AI 아키텍처

```
브라우저 (editor.html)
  └─ AD.AI.run(task, text, context)
       └─ POST GAS {action:'ai', task, text, context}     ← API 키 없음
            └─ autodoc_gas.gs aiCall_()
                 └─ POST https://api.anthropic.com/v1/messages
                    headers: x-api-key(스크립트 속성), anthropic-version: 2023-06-01
                    body: {model, max_tokens: 4096, system, messages:[{role:'user', ...}]}
```

- **키 보안**: `ANTHROPIC_API_KEY`는 GAS Script Properties에만 존재 — 클라이언트/저장소 비노출
- **모델**: 기본 `claude-opus-4-8`, 스크립트 속성 `AI_MODEL`로 변경 가능
- **응답 처리**: `stop_reason === 'refusal'` 확인 후 content의 text 블록만 연결
- **max_tokens 4096**: 보고서 항목 텍스트는 의도적으로 짧은 출력
- 프록시 경계(`aiCall_`)만 교체하면 다른 LLM 제공사로 전환 가능 — 클라이언트 계약(`{task, text, context}`) 불변

### AI 설정 절차
1. GAS 프로젝트 → 프로젝트 설정 → 스크립트 속성 → `ANTHROPIC_API_KEY` 추가
2. 새 버전 배포 (기존 /exec URL 유지)
3. 템플릿 inputs에 `"ai": ["draft", "proofread"]` 등 선언 → 버튼 자동 표시

### task 종류

| task | 버튼 | 동작 |
|---|---|---|
| `draft` | ✨ AI 초안 | 문서명·항목명·다른 입력값을 컨텍스트로 초안 작성 (빈 칸에서 사용 가능) |
| `summarize` | 📝 요약 | 입력된 텍스트를 항목에 맞게 요약 |
| `proofread` | 🩺 교정 | 맞춤법·문장 교정 (형식 유지) |
| `translate` | 🌐 영문 번역 | 비즈니스 영어로 번역 |

## 3. Word 렌더러

- 계약 동일: `{id:'docx', render(model) → Promise<Blob>}` — 본체 무수정으로 등록
- Word는 흐름 문서이므로 Excel과 동일한 **밴드(grid r1) 순서**로 블록을 순차 배치
- 컴포넌트 계약에 `word(ctx, props)` 추가 — ctx = `{d(docx lib), theme, children[]}`
- 매핑: header→음영 밴드 문단, table→docx Table(헤더 음영·zebra), text→제목+문단,
  card→"라벨 : 값" 문단, chart→데이터 목록, footer→중앙 정렬 소형 문단
- 폰트/크기: 테마 토큰 (docx는 half-point 단위 — pt×2)

## 4. PDF 고도화

- html2pdf.js(html2canvas+jsPDF 번들)로 미리보기 HTML을 화면 밖에서 렌더 → A4 가로 .pdf Blob
- 페이지 여러 장이면 `.ad-page`마다 page-break
- CDN 로드 실패 시 기존 인쇄 다이얼로그 폴백 (계약상 Blob 대신 null 반환)

## 5. Phase 4(AI Template Builder)로 가는 길

Phase 3로 다음 인프라가 준비됨:
- GAS ↔ Claude API 프록시 (Phase 4의 양식 분석 호출이 같은 경로 사용)
- 관리자 폼빌더 (AI가 생성한 템플릿 JSON의 검토·수정 화면)
- 템플릿 스키마 v1 (AI 산출물의 타깃 포맷)

남은 것: 파일 업로드 UI + OOXML/PDF 추출(JSZip·pdf.js) + 분석 프롬프트 → 템플릿 JSON 초안.
