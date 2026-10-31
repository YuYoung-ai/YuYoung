# 주간업무보고 생성

주간 PPT는 기존 집계·수리 그래프를 유지하면서 다음 내용을 반영한다.

- A/S에서 전주 대비 증가한 VOC 최대 3개. 증가 건수, 금주 건수, 유형명 순으로 정렬한다.
- 등록된 기본 증상 설명을 자동 입력한다. 보고서용 수정은 주차별 초안에만 적용하고, **기본 문구로 저장**은 레벨 3 API에 저장해 이후 같은 증상에 사용한다.
- PDF는 생성한 PPT에서 작성자가 직접 삽입한다. 생성 화면의 PDF 업로드와 자동 내장은 사용하지 않는다.
- 교육 필요·노즐 재사용 병원 수는 현재·이전 보고 기간 각각의 최신 평가와 고유 병원명으로 집계한다. 이전 기간 기록이 없으면 `비교 없음`으로 표시한다.
- 병원 현황 엑셀은 사용자 제공 양식의 요약·전체 명단 시트, 병합, 서식, 너비, 행 높이, 인쇄 설정을 보존한다. 카드와 같은 집계 결과에서 별도로 다운로드하고 작성자가 PPT에 직접 삽입한다. 양식 자산에는 원본 병원 명단을 포함하지 않는다.
- 특이사항은 직접 작성하는 최대 두 줄이며, 비우면 PPT도 빈칸이다. 하단 카드 높이는 0.85in이다.
- 수리 그래프에서 적용 시작점 관련 배경·후광·문구를 제거한다. 이번 주 강조는 유지한다. 주간에는 이번 주 절감액만 표시하고 월간의 누적 절감액은 유지한다.

## 적용 순서

1. Apps Script의 기존 `handover_gas.gs`를 변경본으로 갱신하고 **기존 웹앱 배포를 새 버전으로 업데이트**한다. 주소를 새로 만들 필요는 없다. `report_phrases`와 `report_phrase_save`가 추가된다. 별도 시트나 마이그레이션은 없으며 기본 문구는 Script Properties에 저장된다.
2. 레벨 3 계정으로 기본 문구 조회·저장이 성공하는지 확인한다. 저장은 revision 충돌 검사를 사용한다. 서버 미갱신·실패를 성공으로 처리하지 않는다.
3. 정적 파일 변경을 GitHub Pages에 배포한다. `assets/report-templates`, CSS, JS 모듈, vendor 파일을 포함한다. 서비스 워커 버전도 함께 갱신한다.
4. 실제 보고 주차로 미리보기와 PPT를 생성해 확인한다.

주간·월간은 원래의 `exMakeReportPPT`와 `PptxGenJS.writeFile` 저장 경로를 공유한다. 주간 전용 ZIP 재조립·XML 정규화·OLE 삽입은 호출하지 않는다. 카드 오른쪽은 비워 두며 PDF·엑셀은 데스크톱 PowerPoint의 삽입 → 개체 → 파일에서 만들기로 직접 넣는다. 아이콘으로 표시하고 연결은 해제하면 PPT 내부에 파일이 포함된다.

## 검증

```sh
node test/dashboard-executive-ppt.mjs
node test/dashboard-voc-normalization.mjs
node test/dashboard-monthly-trend.mjs
node test/report-phrases.mjs
node test/report-attachments.mjs
```

브라우저 검증은 `playwright`, `jszip`, `pdf-lib`와 Chrome/Chromium이 필요하다. 라이브 서버 API는 예시 응답으로 대체하며 외부에 업무 자료를 보내지 않는다.

```sh
# 모듈이 프로젝트 경로에 없으면 CODEX_PRIMARY_RUNTIME_NODE_MODULES에 설치 경로 지정
# 로컬 Chrome 사용 시 PLAYWRIGHT_CHANNEL=chrome 지정
node test/browser/dashboard-weekly-report-browser.mjs
```

생성 예시는 시스템 임시 폴더의 `baz-weekly-report-qa`에 저장된다. `REPORT_OUTPUT`으로 출력 위치를 지정할 수 있다. 검사 대상은 빈 기간·비교 없음·고유 병원 수·저장 문구 재사용·두 줄 특이사항·엑셀 양식 보존·PPT 내장 개체 0개·주간과 월간의 공통 writeFile 호출과 브라우저 오류다.

파일 규격 검사만으로 실제 PowerPoint 열람을 보장하지 않는다. 검토용 PPT를 작성자에게 제공해 사용 중인 PowerPoint에서 확인한다.
