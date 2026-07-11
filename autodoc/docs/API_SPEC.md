# API_SPEC — GAS API · AutoDoc DB 시트 스키마

> 소스: `autodoc_gas.gs` (저장소 루트) · 클라이언트: `js/core/services.js` · `js/providers/gas-provider.js` · `js/ai/*`
> 관련: [ADMIN_SPEC.md](ADMIN_SPEC.md) · [ARCHITECTURE.md](ARCHITECTURE.md) §4

## 1. 통신 규약 ✅ (기존 BAZ CS 와 동일)

- **GET**: `<GAS /exec URL>?action=<이름>&...` — 조회
- **POST**: `Content-Type: text/plain;charset=utf-8` + JSON body — Apps Script CORS preflight 회피(기존 규약)
- 응답 봉투: 성공 `{"success":true, "data":...}` / 실패 `{"success":false, "error":"사유"}` (HTTP 는 항상 200)
- 기존 GAS 4종과 **배포 URL 자체가 다르므로** action 이름 충돌 여지 없음 (신규 전용 배포)

## 2. 액션 전체 (14종) ✅

### GET

| action | 파라미터 | 반환 data | 용도 |
|---|---|---|---|
| `ping` | — | `{ts}` | 배포 확인 |
| `templates` | — | 활성 템플릿 **메타** 목록 `[{id,name,category,desc,version,minLevel,formats[]}]` | 카탈로그 |
| `templatesAll` | — | 전체 템플릿 **전문**(+status, 보관 포함) | 관리자 목록 |
| `template` | `id` | 템플릿 JSON 전문 | 에디터 로드 |
| `templateHistory` | `id` | `[{row, ts, version, user}]` 최신순 | 버전 이력 |
| `drafts` | `status?` | `[{row, ts, template, name, version, user, values, status, reviewer, comment}]` | 승인함 |

### POST (`{action:..., ...}`)

| action | body | 동작 |
|---|---|---|
| `log` | `user, template, version, format` | 생성이력 행 추가 |
| `templateSave` | `template(JSON), user, status?` | upsert — **기존 행은 먼저 템플릿이력 탭에 스냅샷** 후 갱신, 상태 유지 |
| `templateStatus` | `id, status('활성'\|'보관'), user` | 활성/보관 전환 |
| `templateRestore` | `id, histRow, user` | 이력 행의 json 을 현재본으로 (현재본은 자동 스냅샷 → 롤백의 롤백 가능) |
| `draftSave` | `template, name, version, user, values` | 초안 탭에 '대기' 행 추가 (승인 요청) |
| `draftReview` | `row, status('승인'\|'반려'), reviewer, comment` | 검토 결과·검토자·일시·의견 기록 |
| `ai` | `task('draft'\|'summarize'\|'proofread'\|'translate'), text, context{template,field,values}` | **AI 프록시** → `{text, model}` (§4) |
| `aiTemplate` | `fileName, fileType, content(추출 텍스트)` | **AI 템플릿 빌더** → 템플릿 JSON 초안 (§4) |

## 3. AutoDoc DB 시트 스키마 ✅

`setup()` 1회 실행으로 자동 생성 (기존 업무 시트와 **완전 별개** 스프레드시트).

| 탭 | 컬럼 |
|---|---|
| **템플릿** | id · 이름 · 분류 · 설명 · 버전 · 최소레벨 · 상태(활성/보관) · formats(쉼표) · json(전문) · 수정자 · 수정일 |
| **템플릿이력** | 일시 · id · 버전 · json(이전본 전문) · 수정자 |
| **생성이력** | 일시 · 사용자 · 템플릿 · 버전 · 포맷 |
| **초안** | 일시 · 템플릿id · 템플릿명 · 버전 · 작성자 · values(JSON) · 상태(대기/승인/반려) · 검토자 · 검토일시 · 의견 |
| 테마 📋 | (설계) 테마 id · json · 버전 — 현재 테마는 정적 파일 운영 |
| 권한설정 📋 | (설계) 역할×템플릿 매트릭스 — 현재는 템플릿별 minLevel 로 제어 |

## 4. AI 프록시 (Phase 3·4) ✅

```
브라우저 ──(text/plain POST, 키 없음)──> GAS ──(UrlFetchApp)──> Claude API
                                          └ x-api-key: Script Properties 의 ANTHROPIC_API_KEY
                                            anthropic-version: 2023-06-01
```

- 모델: Script Properties `AI_MODEL` (기본 `claude-opus-4-8`)
- `ai`: max_tokens 4096 (보고서 항목 — 의도적 짧은 출력) · `aiTemplate`: max_tokens 16000
- 응답 처리: `stop_reason === 'refusal'` 이면 오류 반환 · content 의 text 블록만 연결
- aiTemplate 는 코드펜스 제거 후 첫 `{`~마지막 `}` 를 JSON 파싱 — 클라이언트 normalize 가 2차 안전망
- **키는 어디에도 노출되지 않는다**: 저장소 ✕ · 클라이언트 ✕ · GAS Script Properties 에만
- 프록시 경계(`aiCall_`/`aiTemplate_`)만 교체하면 타 LLM 전환 가능 — 클라이언트 계약 불변

## 5. 클라이언트 폴백 체계 ✅

| GAS_URL | 동작 |
|---|---|
| 설정됨 | 시트가 원본. 실패 시 localStorage 캐시(`ad_tpl_*`) → 정적 `templates/` 순 폴백 |
| 비어 있음 | 정적 `templates/` + `config.js STATIC_TEMPLATES` 로 완전 동작 (AI·승인·이력만 비활성 — 버튼 자체가 숨음) |

## 6. 배포 절차 (운영 체크리스트)

1. Apps Script 새 프로젝트 → `autodoc_gas.gs` 붙여넣기
2. `setup()` 1회 실행 → "AutoDoc DB" 스프레드시트·탭 자동 생성 (코드 수정 후 탭 추가 시 재실행 — 기존 데이터 보존)
3. (AI 사용 시) 프로젝트 설정 → Script Properties → `ANTHROPIC_API_KEY` 추가
4. 배포 → 웹 앱 → 액세스 "모든 사용자" → `/exec` URL 복사
5. `autodoc/js/core/config.js` 의 `GAS_URL` 에 입력 → `sw.js` CACHE_VERSION 증가 → 커밋
6. 코드 갱신 시: 새 버전 배포(URL 유지)

## 7. 보안 모델

- 인증은 기존 `auth.js` 토큰 체계(클라이언트 가드) — GAS 액션 자체는 기존 BAZ CS GAS 들과 동일하게 URL 비공개+시트 권한에 의존
- 📋 강화안: POST body 에 BazAuth 토큰 동봉 → GAS 가 인증 GAS 에 verify 위임 (기존 시스템 무수정으로 가능)
