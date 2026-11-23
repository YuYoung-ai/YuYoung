# BAZ 영업 서비스 현황

프런트엔드 진입점은 `sales-service/`입니다. 서비스 현황 조회와 알림은 운영 Cloudflare Worker의 `sales_` POST 요청을 사용합니다. 운영 Worker 원본에서 후보 모듈을 준비하고, 배포 전에 소스가 기준 버전과 일치하는지 확인합니다.

```powershell
node cloudflare/sales-service/assemble-worker.mjs <현재-Worker-모듈> <후보-모듈>
node --test test/sales-service.mjs
```

기존 BAZ CS의 활성 Google 관리자는 국내 지역으로 확인된 접수를 조회할 수 있습니다. 영업 담당자와 알림 수신 계정을 등록하려면 운영 D1의 `sales-service-v1` 네임스페이스에 영업 계정 정책을 설정합니다. `sales_admin_access` 요청은 현재 권한이 3인 기존 BAZ CS Google 관리자만 실행할 수 있습니다. `policy` 값에 국내 영업 담당명, 승인 계정과 역할을 입력합니다. 아래는 가상 예시입니다.

영업 계정과 기기는 관리자 화면의 **보안 관리**에서도 등록하고 변경할 수 있습니다. Lv.1은 입력한 영업 담당자명에 해당하는 국내 접수, Lv.2는 국내 접수 전체, Lv.3은 국내 접수 전체와 보안 관리 권한을 부여합니다. 개별 알림 수신 연결은 아래 정책의 `primaryFor`를 사용합니다.

```json
{
  "notifications": false,
  "domesticSales": ["국내 영업 A"],
  "accounts": {
    "sales@example.com": {"name": "담당자", "role": "staff", "sales": ["국내 영업 A"], "primaryFor": ["국내 영업 A"]},
    "lead@example.com": {"name": "팀장", "role": "lead", "canSend": true}
  }
}
```

`staff`는 `sales`에 지정된 접수만 볼 수 있습니다. `lead`는 `domesticSales`에 해당하는 접수를 조회합니다. 담당명마다 `primaryFor`로 수신 계정 한 개를 지정합니다. 로그인과 목록을 확인한 뒤 `notifications`를 켜면 그 시점 이후의 상태 전환과 수동 알림 처리가 시작됩니다. Google OAuth 허용 목록에 영업 앱 호스트가 포함되어야 합니다. 실계정이나 토큰은 저장소에 넣지 않습니다.
