# Cache Spec — 캐시 정책 · 무효화

> **문서 상태**: 📋 설계만 (v2.5 Technical Specification · 미구현)
> **관련 문서**: [LOCAL_STORAGE_SPEC.md](LOCAL_STORAGE_SPEC.md) · [PWA_SPEC.md](PWA_SPEC.md) · [STORAGE_SPEC.md](STORAGE_SPEC.md) · [../ui/OFFLINE_MODE.md](../ui/OFFLINE_MODE.md)
> **한 줄 목적**: 무엇을·어디에·언제까지 캐시하고 어떻게 무효화하는지의 단일 정책 — 오프라인 요건과 신선도 요건의 균형점을 정의한다.

---

## 목차

1. [목적](#1-목적) · 2. [책임 — 캐시 정책표](#2-책임--캐시-정책표) · 3. [인터페이스](#3-인터페이스) · 4. [입력](#4-입력) · 5. [출력](#5-출력) · 6. [데이터 흐름](#6-데이터-흐름) · 7. [의존성](#7-의존성) · 8. [확장성](#8-확장성) · 9. [장점](#9-장점) · 10. [단점](#10-단점)

---

## 1. 목적

두 캐시 층을 구분한다: **SW Cache Storage**(정적 자산 — 앱 셸·JS·렌더 라이브러리)와 **IndexedDB cache 스토어**(데이터 레코드 — Template·DNA·KB). 핵심 원리: **자산 레코드는 버전 불변이므로 `id@version` 키 캐시는 영구 유효** — 무효화 문제가 "최신 버전 포인터 갱신" 문제로 축소된다.

## 2. 책임 — 캐시 정책표

| 대상 | 층 | 전략 | 무효화 |
|---|---|---|---|
| 앱 셸(HTML/CSS/JS) | SW | precache + 버전 교체 | SW 버전 배포 ([PWA_SPEC.md](PWA_SPEC.md)) |
| 렌더 라이브러리(CDN) | SW | 첫 사용 시 cache-first 저장 | 라이브러리 버전 좌표 고정 — 수동 상향 |
| Template/Theme `id@v` | IndexedDB | 불변 — cache-forever | 없음(불변) · LRU 용량 정리만 |
| 최신 버전 포인터(목록·Golden 지정) | IndexedDB | stale-while-revalidate: 캐시 즉시 표시 + 백그라운드 갱신 | bootstrap·watch 통지 |
| DNA/KB/Memory 최신 | IndexedDB | 〃 | `dna.updated` 등 동기 이벤트 |
| 사용자 데이터(내 문서 목록) | IndexedDB | network-first(오프라인 시 캐시) | 쓰기 성공 시 즉시 |
| 우선 캐시(오프라인 보장) | 양층 | **Golden Template + 최근 사용 Template + 렌더 lib** 선제 확보 | [../ui/OFFLINE_MODE.md](../ui/OFFLINE_MODE.md) §2 |

## 3. 인터페이스

| 연산(개념) | 서명 |
|---|---|
| 조회 | `cached(key) → record?` — Store 읽기 경로 내부에서 호출 |
| 적재 | `prime(keys[])` — 로그인 직후 우선 캐시 선제 확보 |
| 무효화 | `invalidatePointer(collection)` — 포인터류만 (불변 레코드는 대상 아님) |
| 정리 | `evictLRU(targetBytes)` — drafts 제외 규칙 상속 ([LOCAL_STORAGE_SPEC.md](LOCAL_STORAGE_SPEC.md) §6) |

## 4. 입력

Store 읽기 요청 · bootstrap 응답(포인터 일괄) · 동기 완료 이벤트 · 용량 신호.

## 5. 출력

캐시 히트 레코드(즉시) · 백그라운드 갱신 후 `cache.refreshed` 내부 통지(화면 소프트 갱신) · 정리 결과.

## 6. 데이터 흐름

```
읽기(list templates): 캐시 포인터 즉시 반환(화면 표시)
   → 백그라운드 remote 조회 → 변경 시 포인터 갱신 + 화면 소프트 갱신
읽기(get template@v7): id@v 캐시 → 히트=끝 (불변) / 미스 → remote → 영구 캐시
로그인 직후: prime([golden 전부, 최근 사용 3종, 렌더 lib])  ← 오프라인 보장 확보
```

```mermaid
graph LR
    REQ[읽기 요청] --> K{키 종류}
    K -->|id@version 불변| F[cache-forever]
    K -->|포인터·목록| SWR[stale-while-revalidate]
    SWR -->|캐시 즉시| UI[화면]
    SWR -->|백그라운드| NET[remote] -->|변경| UI2[소프트 갱신]
    LOGIN[로그인] --> PRIME[prime: Golden·최근·렌더 lib]
```

## 7. 의존성

캐시 로직은 Store 읽기 경로와 SW에 내장 — 독립 모듈이 아니라 **정책 문서**다. 정책표(§2)가 두 구현 지점의 공통 규범.

## 8. 확장성

- 새 데이터 유형 = 정책표 1행 (전략 4종 중 택1 — 새 전략 발명 금지).
- 오프라인 보장 목록 확대 = prime 목록 조정 (KB 용어 오프라인 검사 등 📋).

## 9. 장점

1. **불변 = 무효화 소멸** — 캐시의 최난제(무효화)가 버전 불변 설계 덕에 포인터 문제로 축소.
2. **체감 속도** — stale-while-revalidate로 모든 목록 화면이 즉시 뜬다.
3. **오프라인 보장의 명시화** — prime 목록이 "지하에서 되는 것"의 계약이다.

## 10. 단점

1. **이중 층 혼동** — SW 캐시와 IndexedDB 캐시의 역할을 혼동하기 쉽다. (→ "코드는 SW, 데이터는 IDB" 한 줄 규칙)
2. **소프트 갱신 깜빡임** — 표시 후 갱신은 목록이 바뀌는 시각적 점프 유발. (→ 위치 보존 갱신 규약)
3. **prime 비용** — 로그인 직후 대역폭 사용. (→ 유휴 시점 지연 실행 + Wi-Fi 우선)
