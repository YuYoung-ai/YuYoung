# VALIDATION_SPEC — 입력 검증 규칙

> 소스: `autodoc/js/form/validator.js` · 관련: [JSON_SCHEMA.md](JSON_SCHEMA.md)

## 1. 실행 시점과 결과 ✅

`AD.Validator.validate(values, template)` 는 문서 **생성 직전**(개별 생성·전체 생성·승인 요청)에 실행된다.

```js
→ { ok: boolean, errors: string[], warns: string[] }
```

| 종류 | 의미 | UX |
|---|---|---|
| **error** | 생성 차단 | ❌ 토스트로 사유 나열, 진행 안 함 |
| **warn** | 확인 후 진행 | `confirm()` — 사용자가 승인하면 계속 |

## 2. 검사 1 — required (자동) ✅

`inputs[].required: true` 인 필드가 `null` / `''` / **빈 배열**(table 타입)이면
`"[라벨] 항목은 필수입니다"` error. 템플릿에 rules 를 쓰지 않아도 항상 동작한다.

## 3. 검사 2 — rules (템플릿 선언) ✅

```jsonc
"rules": [
  { "if": "rows.length == 0", "warn":  "처리 내역이 비어 있습니다. 그대로 생성할까요?" },
  { "if": "writer == ''",     "error": "작성자가 없습니다" }
]
```

### 조건식 문법

```
<path>[.length] <op> <숫자 | '문자열' | "문자열">
op ∈  ==  !=  >=  <=  >  <
```

- `path`: 입력 키(점 표기 중첩 허용) — 값은 `values` 에서 조회
- `.length`: 배열·문자열 길이 (없으면 0)
- 우변이 숫자 형태면 좌변도 숫자로 강제 변환 후 비교, 문자열이면 느슨한 `==`/`!=` 비교
- 문법에 맞지 않는 조건은 **false 취급** (검증이 문서 생성을 오탐으로 막지 않게 하는 정책)

## 4. 평가기의 의도적 한계 ✅

- 단일 비교식만 — `&&`/`||`/괄호/산술 없음. `eval()` 미사용(정규식 파서) → **주입 위험 원천 차단**
- 관리자·AI 가 생성한 임의 문자열이 들어와도 안전한 것이 우선 가치

## 5. 확장 계획 📋

| 항목 | 안 |
|---|---|
| 복합 조건 | `"all": [cond...]` / `"any": [cond...]` 배열 형태 (문자열 파서 확장 대신 구조로 해결) |
| 형식 검사 | Input 에 `pattern`(정규식)·`min`/`max`(number·date) 선언 → 입력 시점 인라인 오류 |
| 표 내부 검사 | `"each": {"of":"rows", "if":"content == ''", "warn":…}` — 행 단위 규칙 |
| 실시간 표시 | 생성 시점 일괄 검사 → 필드 blur 시 인라인 메시지 병행 |

## 6. 관련 검증 계층 (혼동 주의)

| 계층 | 대상 | 문서 |
|---|---|---|
| 본 문서 (Validator) | **사용자 입력값** | — |
| normalize | **템플릿 JSON 자체** (AI 생성·Import) | [JSON_SCHEMA.md](JSON_SCHEMA.md) §7 |
| 관리자 저장 검사 | id/name 필수·입력 키 중복 | [ADMIN_SPEC.md](ADMIN_SPEC.md) §5 |
