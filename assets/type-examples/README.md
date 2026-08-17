# 유형별 참고 예시 사진

이 폴더에는 실제 처리 이력 사진이 아니라, VOC 유형의 증상과 처리 결과를 설명하는 공개 가능한 표준 예시만 저장합니다.

## 파일 원칙

- 사진은 WebP 권장, 가로 최대 1200px, 장당 100~300KB를 목표로 합니다.
- 환자·직원 얼굴, 병원명, 장비 S/N, 문서·모니터 개인정보, GPS/EXIF 메타데이터가 없어야 합니다.
- 기존 파일을 덮어쓰지 않고 내용 해시가 포함된 새 파일명으로 추가합니다.
- 이미지 경로는 반드시 `assets/type-examples/` 아래의 상대 경로만 사용합니다.

## 매니페스트 형식

```json
{
  "schema": 1,
  "updatedAt": "2026-08-16",
  "items": {
    "장비|노즐 누수": {
      "symptom": {
        "src": "assets/type-examples/nozzle-leak/symptom-a82f019c.webp",
        "text": "노즐 주변에 약액이 맺히거나 누수가 확인됩니다."
      },
      "after": {
        "src": "assets/type-examples/nozzle-leak/after-80d51c22.webp",
        "text": "실링 교체와 내부 세척 후 누수가 없는 상태입니다."
      }
    }
  }
}
```

유형 키는 대시보드 데이터의 `대분류|유형`과 정확히 일치해야 합니다.
