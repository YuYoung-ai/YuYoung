# 교체품 재고 연동 v1

## 적용 범위

- Handpiece Ass'y의 기존 S/N·유상/무상 우선순위 매칭은 유지한다.
- 나머지 실제 부품은 품목별 탭에 연결한다. 풋스위치 완제품, Repair, 케이블, 커넥터는 별개다.
- 없음·재체결·내부 세척·대체장비입고는 재고 반영에서 제외한다. Handover 기록 선택지는 유지한다.
- 정적 선택지와 기존 기록에서 확인한 이름을 합쳐 52개 선택지를 지원한다. 제외 4개, HP 1개, 나머지 47개 표기(거치대 동의어 1개 포함)를 비직렬 재고 탭 46개에 연결한다.
- Handpiece 2개 탭을 포함한 원장 탭 수는 48개다. 기존 비직렬 5개를 재사용하고 새 부품 탭 41개를 추가한다.

## 실제 반영 조건

각 재고 행은 담당자에게 출고된 부품 1개를 나타낸다.

1. 품명은 해당 탭의 품목 또는 명시된 동의어와 일치해야 한다.
2. 불출처·입고일·입고처·입고수량·출고일·출고처·출고수량이 있어야 한다.
3. 입고수량은 1 이상, 출고수량은 1이어야 한다. 묶음 출고는 개별 행으로 나눈다.
4. 출고처는 Handover 담당 FSE와 일치해야 한다.
5. 사용일·사용자·사용처·사용수량 및 원본 기록 ID가 빈 행만 사용한다.
6. 사용내역 K:N과 추적정보 S:X는 동일한 setValues 작업으로 기록한다. 사이의 기존 값·수식·ERP 체크박스는 유지한다.

현재 Handover 한 건은 교체품 한 종류·사용수량 1개다. 새 탭에 입출고 사실이나 재고 수량을 추정해 채우지 않는다.

## 원장과 대기목록

- 재고 파일: https://docs.google.com/spreadsheets/d/1pFIdZ_aUNadN45osR6LYsxdqPYKlu0B70r-SUTIVzBM/edit
- 원본 파일: https://docs.google.com/spreadsheets/d/1BJU7-1cee2jeRVIQ5FnKSYyzrXKt-aABs4lnx6Bf3v4/edit
- 대기목록: 원본 파일의 **교체품 반영대기** 탭. 원장 권한 오류 중에도 요청을 보관하도록 원본 파일에 둔다.
- 대기 사유와 대상 품목·담당자·병원을 기록한다. 토큰·사진·전체 처리 내용을 저장하지 않는다.
- 반영에 성공하면 상태를 완료로 바꾼다. 기록 ID가 이미 있는데 사용내역이 다르면 확인필요로 남기고 덮어쓰지 않는다.
- 원장 보완 후 5분 주기 syncReplacementInventory가 건당 최대 20개를 재확인한다.
- 오래 확인하지 않은 요청부터 처리해 이전 미해결 건이 후속 건을 막지 않게 한다.
- 수동 재확인은 Apps Script 편집기에서 syncReplacementInventory를 실행한다. Handover를 새 기록으로 재저장하지 않는다.
- 원본 저장 성공과 재고 반영 상태는 분리한다. 재고 미반영 경고는 Handover 저장 카드에도 유지한다.

## 중요한 품목 매핑

| Handover 교체품 | 대상 탭 |
|---|---|
| Handpiece Ass'y | 기존 Repair·새제품 탭(S/N 방식 유지) |
| Foot-SW Ass'y | CS 재고 수량(풋스위치) |
| Foot-SW Ass'y (Repair) | CS 재고 수량(풋스위치 Repair) |
| Foot-SW cable | CS 재고 수량(Foot-SW cable) |
| Foot-SW Connector(장비) | CS 재고 수량(Foot Switch Connector(F)) |
| Cradle (거치대), HP-Cradle Ass'y(거치대) | CS 재고 수량(HP 거치대) |
| Power Cable(대소문자 무관) | CS 재고 수량(Power Cable) |
| 기타 부품 | CS 재고 수량(해당 품목명) |

기존 SN 헤더는 형식 보존을 위해 남겨 둔다. 비직렬 부품의 SN·N/A를 매칭 키로 사용하지 않는다. 탭명에 사용할 수 없는 / 등은 ·로 표시한다. 과거 제품명/버전 표기는 임의로 다른 부품과 합치지 않는다.

## 배포 순서

1. 현재 Apps Script 소스를 보관하고, 기존 handover_gas 파일을 이 변경본으로 갱신한다.
2. 같은 프로젝트에 **handover_inventory_gas.gs** 파일을 추가한다. 다른 기존 GAS 파일을 삭제하거나 교체하지 않는다.
3. 두 파일을 저장한 뒤 **setupReplacementInventory**를 한 번 실행한다. 기존 내용은 보존하고 필요한 탭·추적 헤더·대기목록을 확인하며 5분 트리거 1개를 설치한다.
4. 기존 웹앱 배포를 편집해 새 버전으로 배포한다. 기존 /exec URL을 유지한다.
5. /exec?action=ping 응답에서 **inventorySchema:1**을 확인한다. 새 모듈 파일이 없으면 0이다.
6. 그 뒤 프런트 변경(handover.html·js/baz-handover-core.js·sw.js)을 main에 반영한다. 캐시 버전은 v252다.
7. 실제 업무에서 새 부품 기록을 저장한 뒤 원장 기록 ID 및 대기목록 상태를 대조한다. 운영 시트에 가상 Handover 기록을 넣지 않는다.

시트 구성만 바뀌어도 이미 배포된 구형 GAS의 문자열 FOOT 분기는 바뀌지 않는다. 웹앱 배포 전에는 새 자동 반영이 동작한다고 판단하면 안 된다.

## 보존과 정정

- 기존 Handpiece 원장·수식·재고 데이터는 변경하지 않는다.
- 기존 비직렬 원장의 A:R 데이터와 수식은 보존하고 S:X 추적용 헤더만 추가한다.
- 기존 케이블 수리 건을 완제품 원장에서 자동 취소하거나 과거 Handover 기록을 일괄 재전송하지 않는다.
- 관리자 본문 검수·원본 삭제에 맞춘 과거 재고 정정은 자동으로 수행하지 않는다. 실제 출고/사용 사실을 확인한 후 별도 정정한다.
- 대기목록 저장 자체가 실패하면 자동 재시도를 약속하지 않고 확인필요 경고를 표시한다.

## 검증

- node test/replacement-inventory.mjs: 18개 시나리오
- node test/handover-integrity.mjs: 기존 196개 검증
- node test/hospital-work.mjs
- node test/work-handover-gas.mjs
- node test/handover-workflow.mjs
- node test/work-queue-source-deleted.mjs
- node test/work-source-refresh-gas.mjs

부품 분리, 필수 입출고 누락, 담당자 누락, 단위 수량, 중복 요청, 본문 변조, 권한 오류, 응답 유실, 부분 기입 보호, 수식/체크박스 보존, 대기 재처리, 비정상 대기 행 격리, HP 회귀를 모의 시트로 확인한다.

