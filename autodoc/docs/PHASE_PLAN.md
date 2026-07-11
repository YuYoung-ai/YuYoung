# PHASE_PLAN — 단계별 계획·기록·검증

> 관련: [ROADMAP.md](ROADMAP.md) · 단계별 상세: [DETAILED_DESIGN.md](DETAILED_DESIGN.md) · [PHASE2.md](PHASE2.md) · [PHASE3.md](PHASE3.md) · [PHASE4.md](PHASE4.md)

## 완료된 단계 ✅

각 단계는 "범위 → 구현 → 자동화 검증 통과" 를 완료 기준으로 진행되었다.

### MVP — 템플릿 기반 문서 생성 파이프라인
- **범위**: 폴더 골격 / DocumentModel·Layout·Theme·Registry / 컴포넌트 5종 / PPT·Excel·PDF(간이) 렌더러 /
  Provider 3종 / 폼 자동생성+Validator / index·editor 화면 / 시드 템플릿 3종 / auth.js 연동 / PWA(sw v1)
- **검증**: Node 엔진 스모크 **18항목**(모델 조립·좌표 범위·바인딩·검증 규칙) +
  Chromium E2E **15항목**(카탈로그→폼→미리보기→PPT/Excel 실파일 생성·내용 확인·초안 복원) — 전체 통과
- **완료 기준 충족 증거**: 생성된 .pptx/.xlsx 를 unzip 해 입력값 포함 확인

### Phase 2 — 관리자 · 버전 · 승인
- **범위**: admin.html(목록·폼 빌더·레이아웃 편집·자동 배치·미리보기) / 버전 이력·롤백 / 초안 승인 워크플로 /
  chart 컴포넌트 / GAS 확장(templatesAll·history·restore·drafts 계열)
- **검증**: chart 단위 5항목 + 관리자 E2E **17항목**(편집→저장 버전 증가, 자동 배치, chart 렌더) + MVP 회귀 — 전체 통과
- 검증 중 발견·수정: admin 에 renderer-base 미로드로 저장 다운로드 실패 → 수정

### Phase 3 — AI 작성 지원 · Word · PDF 실파일 · 전체 생성
- **범위**: AIService+GAS 프록시(초안/요약/교정/번역) / 폼 AI 버튼 자동 부착 / Word 렌더러(docx) /
  PDF 실파일(html2pdf) / [전체 생성] / 시드 v1.1(ai 선언·docx 포맷)
- **검증**: Word 하네스(실제 .docx 생성·내용 확인) + Phase 3 E2E **14항목**(Word/PDF 매직바이트,
  전체 생성 4파일, 모의 GAS 로 AI 버튼·초안 반영·미리보기 동기화) + 전체 회귀 — 통과
- 검증 중 발견·수정: html2pdf 빈 PDF 버그 2건(absolute 클론 높이 0 / aspect-ratio 유실) → [RENDERER_SPEC.md](RENDERER_SPEC.md) §6 에 기록

### Phase 4 — AI Template Builder (최종 목표)
- **범위**: 양식 업로드(pptx/docx/xlsx/pdf) → 추출(JSZip·pdf.js) → GAS aiTemplate 분석 → normalize 안전망 → 편집기 검토 → 게시
- **검증**: normalize/xmlText 단위 **15항목** + E2E **12항목**(실제 docx 업로드 → 추출 텍스트가 AI 요청에
  포함됨을 확인 → 오염 블록 제거 → 편집기 오픈 → 게시 버전 증가) + Phase 1~3 전체 회귀 — 통과

## 다음 단계 계획 📋

우선순위·평가는 [ROADMAP.md](ROADMAP.md), 스펙은 각 참조 문서에 확정되어 있음.

### Next-1: 입력 타입 확장 + Import/Export
| 항목 | 작업 | 참조 |
|---|---|---|
| checkbox·radio·image·repeat 입력 | form-generator 타입 4종 + image 컴포넌트 | [JSON_SCHEMA.md](JSON_SCHEMA.md) §2 · [COMPONENT_SPEC.md](COMPONENT_SPEC.md) §5 |
| Template/Theme Import·Export 버튼 | normalize 재사용 (신규 검증 코드 불필요) | [JSON_SCHEMA.md](JSON_SCHEMA.md) §6 |
| minEngine 호환성 검사 | TemplateService.load 1개소 | [JSON_SCHEMA.md](JSON_SCHEMA.md) §5 |
- 완료 기준: 신규 타입별 E2E(입력→미리보기→PPT 반영) + Import 오염 JSON 거부 테스트

### Next-2: Storage 통합 + 플러그인 코어
| 항목 | 작업 | 참조 |
|---|---|---|
| `AD.Storage` 인터페이스 | store.js/services.js 캡슐화 리팩터 + IndexedDB 백엔드 | [ARCHITECTURE.md](ARCHITECTURE.md) §6 |
| `AD.Plugins` 코어 + emit 6곳 | 레퍼런스 플러그인(Slack 알림) 1개로 계약 검증 | [PLUGIN_SPEC.md](PLUGIN_SPEC.md) |
- 완료 기준: 기존 E2E 전체 무회귀 + 플러그인 훅 수신 테스트

### Next-3: 빌더 고도화
격자 GUI Layout Builder · Theme Builder · 권한 매트릭스 UI(레벨 4 도입과 함께) — [ADMIN_SPEC.md](ADMIN_SPEC.md) §7

## 검증 자산 (회귀 스위트)

세션 스크래치에 구축된 E2E 스위트(e2e.js / e2e-admin.js / e2e-p3.js / e2e-p4.js + 엔진·normalize 하네스)는
로컬 http 서버 + Playwright(Chromium) + CDN 로컬 스텁 + 모의 GAS 라우팅 구조다.
📋 차기 단계에서 `autodoc/tests/` 로 저장소에 편입해 CI 화하는 것을 권장 (현재는 세션 산출물).
