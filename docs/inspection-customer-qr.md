# 고객 휴대폰 QR 서명

## 사용하는 순서

1. `inspection.html`에서 기본 양식으로 작성하고 CS 담당자가 서명한다.
2. **고객 휴대폰으로 확인·서명 (QR)**에서 유효시간(10/30/60분, 기본 30분)을 선택한다.
3. QR 발급 시 본문·사진·CS 서명이 포함된 PDF와 확인용 이미지를 고정한다. QR 대화상자가 열려 있는 동안 작성 화면을 수정할 수 없다.
4. 고객은 별도 로그인 없이 QR을 스캔하고, 본문과 사진을 확인한 뒤 이름·확인 체크·손글씨 서명을 제출한다.
5. 서버가 고정된 PDF의 병원 담당자 칸에 이름·서명을 반영한다. 서명 위치가 페이지 경계에 걸리면 양쪽 페이지에 맞게 잘라 표시한다. 고객은 엔지니어 화면이 닫혀 있어도 다운로드할 수 있다.
6. 직원 화면에서 서명 완료를 확인하면 **같은 PDF 바이트**를 기존 Drive·Handover·접수 댓글 저장 흐름에 전달한다. 기존 전송 복구 기능도 그대로 사용한다.

QR을 취소하면 해당 고객 링크는 즉시 차단된다. 내용을 수정한 뒤에는 새 QR을 발급한다. 서명 완료 후 작성 내용을 변경하면 이전 고객 서명이 해제된다. 이미 발행한 PDF는 바뀌지 않는다.

## 유효시간과 보관

- 유효시간은 서버 시간으로 검사한다. 고객 기기의 시계를 바꿔도 연장되지 않는다.
- 서명을 시간 내 접수하면 최종 PDF 준비 완료부터 최소 10분의 다운로드 시간을 준다. 원래 만료시간이 더 늦으면 그 시간까지 허용한다.
- 서명은 한 번만 접수한다. 같은 제출의 재시도는 중복 처리하지 않으며, 네트워크·파일 저장 실패 시 기존 접수 서명으로 복구한다.
- QR 토큰은 256비트 난수이며 URL의 fragment에 넣는다. 서버·정적 사이트 요청 URL에 실리지 않는다. DB에는 토큰의 SHA-256만 저장한다. QR 인코딩도 브라우저에서 하므로 외부 QR 생성 API에 링크를 보내지 않는다.
- QR 소지자는 만료 전 해당 문서에 접근할 수 있다. 고객의 휴대폰 명의자 본인인증을 수행하는 기능은 아니다.
- 직원용 문서 API는 기존 로그인 서버에서 확인한 계정만 접근할 수 있으며, 발급자에게만 허용한다.
- 서버 임시 파일은 기본 30일 후 정리한다(`RETENTION_DAYS`, 최대 90). 고객 링크 만료와 회사 원본 보관은 별개다. 직원 화면을 다시 열어 Drive 저장 완료를 확인한다. 직원 화면이 닫혀 있으면 Drive 업로드는 재개할 때 진행된다.
- PDF에는 확인한 원본의 SHA-256, 서명 이미지의 SHA-256, 이름·확인 문구·서버 접수시각을 담은 `customer-confirmation.json`이 첨부된다.

## Cloudflare 구성

`global_fetch_strictly_public` 호환성 플래그로 같은 계정의 기존 로그인 Worker를 공개 인증 경로로 호출한다. 별도의 Worker 미리보기 URL은 비활성화한다.

기존 `yuyoung-production` 로그인·업무 Worker는 수정하지 않는다.

- 전용 Worker: `baz-inspection-qr`
- 전용 D1: `baz-inspection-qr` (`DB` 바인딩)
- 웹 화면: 기존 GitHub Pages의 `customer-sign.html`
- 설정: `js/baz-inspection-qr-config.js`
- 원본 영구 보관: 기존 Google Drive 흐름

기본 구성은 **Workers + D1**만 필요하며 R2 구독을 추가하지 않는다. D1에는 임시 PDF·미리보기·서명을 256KB 이하 BLOB 조각으로 저장한다. 월 100건, PDF 5MB 가정 시 원본·미리보기·서명본을 포함해 30일 임시 저장은 대략 1~2GB 규모다. 실제 사용량은 사진·렌더링 압축률·기존 서비스 사용량에 따라 다르다. 대량 운영 시 비공개 R2 버킷을 `FILES`로 바인딩하면 같은 API에서 R2를 사용한다.

PDF 서명 반영은 서버에서 `pdf-lib`로 수행하므로 Browser Rendering 서비스가 필요 없다. QR 발급 전 PDF 상한은 6.5MB, 미리보기 포함 업로드 상한은 18MB다. 기존 Drive의 7MB 제한에 맞추기 위해 여유를 둔다.

## CLI 배포

```powershell
cd cloudflare/inspection-qr
pnpm install --frozen-lockfile
pnpm exec wrangler login
# 신규 계정에 설치할 때만 생성하고 반환된 ID를 wrangler.jsonc에 입력한다.
pnpm exec wrangler d1 create baz-inspection-qr
pnpm exec wrangler d1 migrations apply baz-inspection-qr --remote
pnpm test
pnpm exec wrangler deploy
```

현재 계정의 DB ID는 `wrangler.jsonc`에 기록돼 있다. 다른 계정에 배포할 경우 DB ID와 `AUTH_URL`, `ALLOWED_ORIGINS`, `CUSTOMER_PAGE` 및 프런트 설정의 API 주소를 변경한다. 직원 인증 토큰·Cloudflare 인증 정보는 파일에 넣지 않는다.

대시보드에서 배포할 경우:

1. `wrangler deploy --dry-run --minify --outdir .wrangler/bundle`로 번들 생성.
2. Worker 코드에 생성된 `worker.js`를 배포.
3. `DB`에 전용 D1을 바인딩하고 migrations의 SQL 두 파일을 실행.
4. Settings의 Cron Trigger에 `17 * * * *`를 추가해 임시 파일 보관기간을 정리.
5. `/health`가 성공하는지 확인한 다음 GitHub Pages 변경을 배포.

기본 공개 설정은 Worker 코드에도 포함되어 있다. 대시보드에서 설정을 덮어쓸 때는 wrangler.jsonc와 일치시킨다. 요청·응답에 문서/토큰이 포함될 수 있으므로 관측 로그는 기본으로 꺼 둔다.

## 검증

```powershell
node test/inspection-qr-ui.mjs
node test/inspection-pdf-formats.mjs
node test/inspection-pdf-recovery.mjs
node test/inspection-upload.mjs
node test/inspection-share-ui.mjs
cd cloudflare/inspection-qr
node --test test/worker.test.mjs
node scripts/preview.mjs
```

미리보기는 `http://127.0.0.1:8765/inspection.html`에 테스트 점검서를 제공한다. 인증·저장소를 메모리에서 대체하며 실제 병원·계정·Drive에 요청하지 않는다. 실행 중에만 유효하며, 외부 접속용 서버로 사용하지 않는다.

서버 검증은 직원/다른 계정 접근, 토큰/Origin 변조, 확인 누락, 중복·동시 제출, 만료 경계와 다운로드 여유시간, 실패 후 복구, 두 페이지 서명 위치, 임시 파일 정리, D1만 사용하는 전체 흐름과 다중 조각 무결성을 검사한다.
