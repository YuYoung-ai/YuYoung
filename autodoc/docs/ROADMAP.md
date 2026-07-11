# ROADMAP — 현황 · 설계 리뷰 · 차기 계획

> 관련: [PHASE_PLAN.md](PHASE_PLAN.md)(단계별 상세) · [DESIGN.md](DESIGN.md)(원 설계)

## 1. 완료 현황 (원 로드맵 대비)

| 단계 | 내용 | 상태 | 평가 (개발 난이도 / 유지보수 / 확장성) |
|---|---|---|---|
| 설계 | 아키텍처·스키마·로드맵 확정 | ✅ | — |
| MVP | 엔진·PPT/Excel/PDF(간이)·폼 자동생성·시드 3종 | ✅ 검증 통과 | 중 / 상 / 상 |
| Phase 2 | 관리자 폼 빌더·버전 이력/롤백·승인 워크플로·chart | ✅ 검증 통과 | 상 / 상 / 상 |
| Phase 3 | AI 작성 지원·Word·PDF 실파일·전체 생성 | ✅ 검증 통과 | 상 / 중 / 최상 |
| Phase 4 | AI Template Builder (양식 업로드→템플릿 자동 생성) | ✅ 검증 통과 | 최상 / 중 / 최상 |

**핵심 사상 검증 완료**: "새 문서 = JSON 추가"가 시드 3종·AI 생성 템플릿으로 실증됨.
문서 종류 확장(월간보고·점검보고·품질보고·교육보고·ISO·CAPA·AS 보고서…)은 이제 등록 작업일 뿐이다.

## 2. 설계 리뷰 — 요청서 대비 gap 분석과 결정 기록

| 요청 항목 | 현재 상태 | 결정/경로 |
|---|---|---|
| `preview.html` 별도 페이지 | editor 내장 실시간 미리보기 + 독립 모듈(preview.js) | **통합 유지** — 근거는 [FOLDER_STRUCTURE.md](FOLDER_STRUCTURE.md) §2. 공유 링크 필요 시 20줄로 추가 가능 📋 |
| Storage Layer (Sheet/Local/IDB/DB) | store.js+services.js 로 역할 분산 (원칙은 준수) | `AD.Storage` 통합 인터페이스 리팩터 📋 — [ARCHITECTURE.md](ARCHITECTURE.md) §6 |
| `plugins/` 플러그인 구조 | register 3종이 사실상 플러그인 계약으로 동작 중 | `AD.Plugins` 인터페이스 확정 📋 — [PLUGIN_SPEC.md](PLUGIN_SPEC.md) |
| 입력 checkbox/radio/image/repeat | text/number/date/week/select/textarea/table 7종 구현 | 4종 스펙 확정 📋 — [JSON_SCHEMA.md](JSON_SCHEMA.md) §2 |
| Component Image/Section/Repeat | 6종 구현(text/header/table/card/chart/footer) | 3종 스펙 확정 📋 — [COMPONENT_SPEC.md](COMPONENT_SPEC.md) §5 |
| Import / Export | Export 는 GAS 미설정 저장 폴백으로 부분 존재 | 명시 버튼 + Import(normalize 재사용) 📋 — [JSON_SCHEMA.md](JSON_SCHEMA.md) §6 |
| 독립 버전 + 호환성 검사 | Template semver 자동·Engine 버전 존재 | `minEngine` 검사 📋 — [JSON_SCHEMA.md](JSON_SCHEMA.md) §5 |
| `config/` `storage/` 폴더 | 단일 파일(config.js·store.js)로 시작 | 규모 증가 시 폴더 승격 — [FOLDER_STRUCTURE.md](FOLDER_STRUCTURE.md) §2 |
| 관리자 레벨 4 | 현행 인증 GAS 최고 레벨(3) 사용 | 인증 GAS 에 4 추가 시 상수 2곳 상향 📋 |

### 리뷰에서 도출된 개선점 (요청서 외 자체 발견)

1. **E2E 스위트의 저장소 편입** — 현재 세션 산출물인 회귀 테스트를 `autodoc/tests/` 로 이관, CI 연결 ([PHASE_PLAN.md](PHASE_PLAN.md))
2. **블록 겹침 경고** — 레이아웃 편집 시 area 중첩 검출 ([LAYOUT_ENGINE.md](LAYOUT_ENGINE.md) §6)
3. **GAS 액션 인증 강화** — POST 에 BazAuth 토큰 동봉·검증 ([API_SPEC.md](API_SPEC.md) §7)
4. **chart 시리즈 팔레트의 테마 토큰화** ([THEME_ENGINE.md](THEME_ENGINE.md) §6)
5. **AI 빌더 멀티모달 확장** — 페이지 렌더 이미지를 함께 전달해 좌표 정밀도 향상 ([PHASE4.md](PHASE4.md) §6)

## 3. 차기 로드맵 📋

| 단계 | 내용 | 난이도 / 유지보수 / 확장성 |
|---|---|---|
| **Next-1** | 입력 4종(checkbox·radio·image·repeat) + image 컴포넌트 + Import/Export + minEngine | 중 / 상 / 상 |
| **Next-2** | `AD.Storage` 통합(+IndexedDB) + `AD.Plugins` 코어 + Slack 알림 레퍼런스 플러그인 | 중 / 상 / 최상 |
| **Next-3** | 격자 GUI Layout Builder · Theme Builder · 권한 매트릭스(레벨 4) | 상 / 상 / 상 |
| **Next-4** | 연동 플러그인(메일·Teams·ERP/MES 프로바이더) · E2E 저장소 편입·CI | 상 / 중 / 최상 |

각 단계의 작업 항목·완료 기준은 [PHASE_PLAN.md](PHASE_PLAN.md) 참조.

## 4. 운영 시작 체크리스트 (재게)

1. main 병합 → GitHub Pages 자동 배포 → `…/autodoc/` (정적 모드로 즉시 사용 가능)
2. `autodoc_gas.gs` 배포 + `setup()` → `config.js GAS_URL` (시트 운영·승인·이력 활성)
3. Script Properties `ANTHROPIC_API_KEY` (AI 버튼·AI 템플릿 빌더 활성) — [API_SPEC.md](API_SPEC.md) §6
