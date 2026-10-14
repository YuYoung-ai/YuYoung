# PDF 자동 저장과 Handover 댓글 연결

점검 내역서에서 PDF 생성 버튼을 누르면 PDF를 Google Apps Script에 직접 전송하고 Google Drive의 `AS_점검_내역서` 폴더에 저장한다. PDF 파일은 Deno를 거치지 않는다. 미리보기와 빈 수기 양식은 업로드하지 않으며 기존 PDF 파일 공유 기능도 유지한다.

최대 파일 크기는 7MiB(7,340,032바이트)이다. 브라우저와 Google 서버에서 파일 크기, PDF 헤더, SHA-256을 검증한다. 파일 전송에는 기존 로그인 토큰을 사용한다. 실패하면 생성된 PDF는 유지하고 같은 전송 식별자·내용으로 다시 시도한다. 파일 업로드 응답이 유실되어도 시트의 저장 확인 정보로 중복 파일을 만들지 않는다.

## 저장 위치와 연결

- 운영 Handover 원본 탭의 AE열 `PDF 링크`, AF열 `PDF 정보`를 사용한다. AF는 연결에 필요한 작은 JSON이며 숨겨 둔다. 기존 열을 이동하거나 기존 행을 일괄 변경하지 않는다.
- Google Drive 폴더 ID: `1-redhvS6V8wZJ1DXYfjJ_LSr3kvhDzJU`. 폴더 자체는 비공개이며 생성한 PDF 파일만 링크를 가진 사람이 볼 수 있게 한다. PDF 파일에는 기간 제한을 두지 않는다.
- Handover 저장 후 내역서 이어쓰기를 사용하면 원본 기록 ID를 작업에 보존한다. 직접 작성한 내역서는 병원명·처리일·장비 S/N이 일치하는 유일한 기존 기록을 찾는다. 누락·중복·다른 지점·다른 날짜·다른 S/N은 임의 연결하지 않고 해당 Handover 기록을 먼저 저장하도록 안내한다.
- PDF 메타데이터를 포함한 원본을 기존 Handover 큐로 전달한다. 업로드 완료 후 해당 기록만 즉시 전달하고, 실패 시 기존 큐·5분 작업에서 재시도한다. Deno에는 URL·파일명·크기·해시·기록 연결 정보만 저장한다.
- 현재 원본과 연결된 접수에 제목 `AS/점검 내역서`의 자동 댓글을 생성한다. 이미 완료된 접수에도 댓글을 추가하고 상태와 기존 처리 결과·댓글을 보존한다. 접수에서 동기화하면 새 댓글을 확인할 수 있다.
- 다시 생성하면 같은 자동 댓글의 링크를 갱신한다. 재전송은 댓글을 복제하지 않는다. 이전에 생성한 PDF 파일은 Drive에 남아 기존 외부 링크를 보존하므로 Drive 저장공간에 포함된다. 같은 PDF의 재전송은 파일을 추가하지 않는다.
- 아직 접수에 연결되지 않은 PDF는 작은 대기 정보만 유지하며, 해당 원본의 자동/수동 연결 후 반영한다. 일반 동기화는 저장된 전체 PDF 파일을 순회하지 않고 대기 항목만 처리한다.

## 배포

기존 Handover Apps Script 프로젝트에 `handover_inspection_pdf_gas.gs`를 추가하고 `Code.gs`의 doPost에 inspection_pdf_* 라우팅 한 줄을 추가한다. 운영 Code.gs의 별도 변경은 보존한다. `hospital_work_gas.gs`의 원본 PDF 메타데이터 읽기와 `hospital_work_kv_gas.gs`의 기록별 전달 필터를 적용한다. `setupInspectionPdf`를 한 번 실행한 뒤 기존 웹앱 배포를 새 버전으로 갱신한다. 웹앱 URL·인증 설정·기존 KV와 권한은 유지한다. `setupHospitalWork`·KV 이전·기존 데이터 초기화를 다시 실행하지 않는다.

Deno는 기존 GitHub 연결 배포에서 변경한 `deno-auth/work-store.ts`를 반영한다. Pages/SW는 v238이다.

## 검증

`test/inspection-upload.mjs`: 7MiB 전송·해시, Google 직접 경로, 재시도 식별자, 크기/주소 거부, UI 상태와 작업 ID.
`test/inspection-upload-gas.mjs`: 기록 식별과 기존 열 보존, 인증, Drive 저장, 해시/크기 검증, 중복 파일 방지, 버전 충돌, URL 쓰기 실패 후 복구, 미확정 파일 정리.
`test/work-pdf-attachments.mjs`: 완료 상태 보존, 댓글 중복 방지·재생성 갱신, 이전 원본·일반 댓글 보존, 삭제/복원, 오래된 전달 거부, 지연/모호/수동 연결, 구배포 메타데이터 복구, KV에 바이너리 미저장.

`verifyInspectionPdfDrive`는 편집기에서 합성 7MiB PDF의 Drive 저장·내용을 확인하고 시험 파일을 휴지통으로 이동한다. `test/browser/inspection-upload-check.html`의 관리자용 확인 버튼은 실제 브라우저→Google 서버→Drive 전송을 검증하고 시험 파일을 정리한다. 두 확인 경로 모두 Handover 원본·접수·댓글에 시험 기록을 만들지 않는다.
