# 삭제된 Handover 원본의 대기 정리

Handover 저장 후 원본 행을 삭제하면, 이미 생성된 `업무Handover대기`는 남을 수 있다. 기존 작업은 이 경우를 중복 ID와 같은 오류로 처리해 삭제된 원본을 계속 재전송하려 했다.

현재 작업은 원본의 기록 ID 열 전체에서 ID를 확인한다. 빈 행이 이어져도 뒤에 있는 실제 원본을 삭제로 판단하지 않는다. 검색 결과가 0건일 때만 ScriptLock 안에서 다시 확인하고 대기 상태를 `source_deleted`로 바꾼다. 상태 셀 메모에는 취소 사유·확인 시각·기록 ID를 남긴다. 원본 JSON·eventKey·recordId·version·생성 시각은 보존한다.

원본 ID가 중복되거나 시트 조회·네트워크가 실패한 경우에는 대기를 유지한다. 원본이 확인과 잠금 사이에 복원되면 취소하지 않는다. 취소한 ID가 동일 버전으로 복원·재저장되면 기존 대기 행을 다시 `pending`으로 전환하며 이벤트를 중복 생성하지 않는다.

`source_deleted`는 전송 대기·오류 집계에서 제외한다. 삭제한 원본을 다시 생성하거나 접수·댓글·처리 이력을 삭제하지 않는다. 취소는 대기 상태의 정리이며 기존에 연결된 결과의 삭제가 아니다.

배포: 기존 Handover Apps Script의 `hospital_work_kv_gas.gs`만 교체한 뒤 현재 웹 앱 배포를 새 버전으로 갱신한다. 기존 `syncHospitalWorkKv`를 실행하거나 5분 작업을 기다린다. 초기화·KV 이전을 다시 실행하지 않는다. 웹 화면은 동기화 버튼으로 최신 집계를 가져온다.

검증: `node test/work-queue-source-deleted.mjs`, `node test/work-queue.mjs`, `node test/work-queue-save.mjs`, `node test/hospital-work.mjs`. 삭제 원본 취소·JSON 보존·메모·대기 및 오류 0건·빈 행 이후 ID·중복/조회 오류 보호·복원 경쟁·네트워크 재시도·동일 버전 복원을 확인한다.
