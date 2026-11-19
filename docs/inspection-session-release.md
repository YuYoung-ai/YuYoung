# 점검 내역서 진입·생성·전송 분리 (v348)

## 해결한 문제

Handover의 새 병원을 적용하기 전에 마지막 초안을 복원하고 과거 outbox를
자동 실행해, 새 폼 위에 이전 문서의 완료 창이 나타날 수 있었다.
PDF 생성도 이전 publisher의 busy 상태와 서버 원본 조회를 기다렸다.

이번 변경은 저장소 준비와 진입 대상 적용을 `inspectionSessionReady`로 합친다.
명시적인 이어쓰기/접수 진입은 이전 병원을 먼저 표시하지 않는다.
진입 자료 누락·만료·계정 불일치·원본 조회·초안 저장 실패는 오류로 표시한다.

- 새 Handover 전달은 계정과 임의 entry ID별로 저장한다. URL에는 nonce만 둔다.
- 기존 `?prefill=1` 전달도 원본 검증과 새 진입 우선 규칙을 적용한다.
- 페이지 진입 및 초안 열기 시 과거 PDF 자동 복구를 시작하지 않는다.
- 수동 복구, 미완료 PDF와 동일 upload ID/hash/baseRevision의 재시도는 유지한다.
- 작업/진입 세대와 병원·처리일·S/N을 검증한 콜백만 현재 UI를 변경한다.
- 이전 전송은 원래 초안의 저장 결과만 갱신한다. 새 문서의 로컬 생성은
  이전 문서의 네트워크 대기와 독립적이며, 전송 요청은 직렬 처리한다.
- 대기 중 새 PDF도 대기열에 넣기 전에 Blob을 보관한다. 보관 실패는 명시한다.
- 본문·서명·사진·파일명은 한 번 고정한 스냅샷을 사용한다.
- 로컬 생성 뒤 서버 원본 확인과 Drive/Handover/댓글 처리를 진행한다.
- 진입 때 받은 원본으로 기존 서버와 같은 sourceBasis fingerprint를 계산한다.
  원본·최신 PDF revision이 달라졌거나 기준이 없으면 파일을 보존하고 멈춘다.
  확인하지 않은 최신 기준을 과거 PDF에 자동으로 붙이지 않는다.
- 초안 저장 실패 시 화면을 유지하고 자동 전송과 분리된 PDF 보관 버튼을 제공한다.

기존 outbox/IndexedDB 자료의 초기화나 재이전은 없다. GAS 배포와 서버 소스는
이번 프런트 수정에 포함하지 않는다. 이전 버전 초안에 원본 기준이 없으면
`Handover 기록 연결 변경`에서 원본을 확인한 후 새 PDF를 생성할 수 있다.

## 검증

`node test/inspection-session.mjs`는 진입별 저장·계정·TTL·호환 전달·스냅샷과
공개 서버의 실제 fingerprint 함수와의 일치를 검사한다.
`node test/inspection-session-upload.mjs`는 원본/버전 충돌·지연된 복구 응답·
원래 작업 업데이트·전송 직렬화·대기 중 Blob 보관을 검사한다.

기존 `test/inspection*.mjs`와 새 테스트 총 18개를 통과했다.
`test/browser/inspection-session.mjs`는 Chromium과 WebKit에서 다음을 검사한다.

1. 과거 A outbox를 보존한 채 B 이어쓰기 (A 조회·팝업·업로드 없음)
2. 두 진입 ID의 B/C 병원 분리
3. 실제 본문·사진·서명 PDF 및 QR 서명 위치 렌더링
4. 실제 미리보기와 빈 양식 생성
5. 늦은 이전 전송 응답이 새 작업에 영향을 주지 않음
6. 진입 자료 누락 시 이전 작업으로 전환하지 않음
7. 중복 클릭 한 번 생성, 렌더 대기 중 수정과 고정 스냅샷 분리
8. 서버 조회 대기 중 로컬 PDF 생성 완료 및 이후 검증된 전송
9. 저장 공간 오류 시 폼 보존과 별도 PDF 보관 (자동 업로드 없음)
10. 필수값이 누락된 단계로 이동하고 지속적인 오류 안내

기존 원본 연결/수동 댓글 복구 브라우저 검사와 IndexedDB 저장/사진/서명/
백업/충돌/보관 보호 검사도 수행한다. 합성 요청만 사용하며 운영 데이터는 쓰지 않는다.
브라우저 엔진 검증은 실제 iPhone Safari/설치형 사용 검증을 대신하지 않는다.

실행 예시 (Playwright를 별도 runtime에서 제공하는 경우):

```powershell
$env:CODEX_PRIMARY_RUNTIME_NODE_MODULES='<runtime node_modules>'
$env:PLAYWRIGHT_ENGINE='webkit' # 또는 chromium
$env:PLAYWRIGHT_WEBKIT='<호환 Playwright WebKit executable>'
node test/browser/inspection-session.mjs
```

배포는 최신 main의 다른 화면 변경을 보존하고, SW 캐시 버전과 수정 모듈 쿼리를
갱신한다. 배포 완료 후 운영 HTML/JS/SW의 바이트 해시를 릴리스 파일과 비교한다.
