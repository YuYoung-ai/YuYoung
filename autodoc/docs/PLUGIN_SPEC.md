# PLUGIN_SPEC — 플러그인 아키텍처 (인터페이스 정의)

> 상태: **📋 전체가 설계 단계 — 이번에는 구현하지 않는다. 인터페이스만 확정한다.**
> 관련: [ARCHITECTURE.md](ARCHITECTURE.md) §5 · [RENDERER_SPEC.md](RENDERER_SPEC.md) · [API_SPEC.md](API_SPEC.md)

## 1. 출발점 — 이미 존재하는 확장점 ✅

AutoDoc 은 처음부터 register 패턴으로 지어졌다. 아래 3개 레지스트리가 사실상의 플러그인 계약이며,
**등록만 하면 본체 무수정으로 동작**함이 4개 렌더러·7개 컴포넌트·3개 프로바이더로 이미 증명되어 있다:

| 레지스트리 | 계약 | 확장 예 |
|---|---|---|
| `AD.Renderers.register` | `{id,label,ext,render(model)→Blob\|null}` | HWP·이미지 내보내기 |
| `AD.Providers.register` | `{id, fetch(query)→Promise<any>}` | REST·**ERP·MES·SAP** 데이터 소스 |
| `AD.Registry.register` | 컴포넌트 4메서드 | 서명란·QR·결재선 블록 |

플러그인 시스템은 이 셋을 **하나의 배포 단위로 묶고, 생명주기 훅을 추가**하는 상위 계층이다.

## 2. 플러그인 인터페이스 📋

```js
// plugins/<id>/plugin.js
AD.Plugins.register({
  id: 'slack-notify',
  name: 'Slack 알림',
  version: '1.0.0',
  requires: { engine: '>=0.1.0' },          // 호환성 선언 — 로드 시 검사

  /* 설치 시 1회 — ctx 로만 시스템에 접근 (전역 직접 접근 금지) */
  setup(ctx) {
    // ctx.Renderers / ctx.Providers / ctx.Registry : 위 3개 레지스트리
    // ctx.config(key)  : 읽기 전용 설정
    // ctx.storage(ns)  : 플러그인 전용 네임스페이스 저장소 (ad_plugin_<id>_*)
    // ctx.gas(action, body) : AutoDoc GAS 프록시 호출 (외부 API 비밀키는 GAS 쪽에 둠)
  },

  /* 이벤트 훅 — 필요한 것만 구현 */
  hooks: {
    'document:generated':  (ev) => {},   // {template, format, blob, user, values}
    'document:generating': (ev) => {},   // 생성 직전 — ev.cancel() 로 중단 가능
    'template:published':  (ev) => {},   // {template}
    'draft:submitted':     (ev) => {},   // {template, values, user}
    'draft:reviewed':      (ev) => {},   // {status, reviewer, comment}
    'form:built':          (ev) => {},   // {template, container} — 폼에 UI 추가
  }
});
```

### 런타임 계약

- `AD.Plugins = { register(p), get(id), list(), emit(hook, ev) }` — 구현은 `js/core/bus.js` 확장으로 충분(이미 존재)
- 훅 호출부는 본체 6곳(생성 완료·생성 직전·게시·초안 제출/검토·폼 구축)에 `AD.Plugins.emit()` 한 줄씩
- 훅은 **비차단**: 예외는 격리(try/catch)되어 본체 동작에 영향 없음. `document:generating` 만 cancel 허용
- 로드: `plugins/<id>/plugin.js` 를 화면에서 script 로드 (📋 매니페스트 `plugins/index.json` 기반 동적 로드)
- 비밀키 원칙: 플러그인의 외부 API 인증은 **GAS 프록시 경유** (AI 프록시와 동일 패턴 — 클라이언트에 키 없음)

## 3. 목표 연동별 적용 방안 📋

| 연동 | 방식 |
|---|---|
| **AI** | ✅ 이미 프록시로 구현(ai-service·template-builder) — 플러그인 도입 시 `ai` 플러그인으로 이관 가능한 형태 |
| **메일 / Slack / Teams** | `document:generated` 훅 → GAS 프록시(MailApp / Incoming Webhook)로 문서 발송·알림 |
| **ERP / MES / SAP** | setup 에서 `ctx.Providers.register()` — 템플릿 prefill 바인딩으로 기준정보 자동 채움 |
| 결재 시스템 | `draft:submitted/reviewed` 훅 ↔ 전자결재 API 연동 |

## 4. 구현 로드맵

1. Next-단계: `AD.Plugins` 코어(50줄 내외 — bus 확장) + 본체 emit 6곳 + `plugins/` 폴더
2. 레퍼런스 플러그인 1개(Slack 알림)로 계약 검증
3. 매니페스트 동적 로드 + 관리자 화면 플러그인 on/off

우선순위·평가는 [ROADMAP.md](ROADMAP.md) 참조.
