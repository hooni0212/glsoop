# API 네이밍 규칙 (camelCase vs snake_case)

> 목표: **코드 내부는 camelCase**, **API 응답/요청은 snake_case**로 통일한다.

---

## 1) 기본 원칙

- **서버/클라이언트 코드 내부**
  - 함수/변수명: `camelCase`
  - 예: `handleLikeToggle`, `currentUserId`

- **API 계약(JSON 요청/응답)**
  - 키: `snake_case`
  - 예: `user_id`, `like_count`, `has_more`

---

## 2) 적용 범위

### 적용 대상
- 모든 REST API 응답 바디
- REST API 요청 바디

### 예외
- 쿼리 파라미터는 **기존 관례를 유지**하되,
  문서에 표준 표기를 명확히 기재한다.

---

## 3) 예시

### 내부 코드 (camelCase)
```js
const currentUserId = req.user.id;
const likeCount = row.like_count;
```

### API 응답 (snake_case)
```json
{
  "ok": true,
  "message": "좋아요 상태가 업데이트되었습니다.",
  "like_count": 12
}
```

---

## 4) 도입 효과

- 언어 관례 충돌 최소화 (JS ↔ API)
- 계약 가독성 및 문서화 용이
- 다양한 클라이언트(웹/앱)에서 일관된 파싱 가능

---

## 5) 운영 가이드

- 신규 API 추가 시 반드시 `snake_case` 필드 사용
- 기존 응답 수정 시, 가능한 한 camelCase 필드를 제거
- 문서(`docs/API_REFERENCE.md`)에 변경 내용 반영

