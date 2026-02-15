# UX Events API

기준 라우트:

- `routes/uxEventRoutes.js`
- `routes/adminRoutes.js` (`/api/admin/ux-events/summary`)

Base: `/api`

---

## 수집

### `POST /ux-events`

클라이언트 UX 이벤트를 기록합니다.

요청 바디:

- `event_name` (required): 영문 소문자/숫자/언더스코어, 최대 64자
- `session_id` (optional): 최대 120자
- `anonymous_id` (optional): 최대 120자
- `page_path` (optional): 최대 255자
- `referrer` (optional): 최대 500자
- `properties` (optional): JSON object/string, 직렬화 기준 최대 4000자

응답:

- `202`: `{ ok: true, message }`

---

## 관리자 요약

### `GET /api/admin/ux-events/summary`

관리자용 UX 이벤트 집계 조회.

쿼리 파라미터:

- `from` / `to` (optional): `YYYY-MM-DD`
- `event_name` (optional): 이벤트명 단일 필터
- `source` (optional): `all`(default) 또는 source 문자열
- `user_type` (optional): `all|authenticated|anonymous` (default `all`)
- `top_limit` (optional): `1~100` (default `10`)
- `daily_limit` (optional): `1~120` (default `30`)

응답 필드:

- `summary`: 총 이벤트, 고유 사용자/세션, 익명 이벤트 수
- `key_events`: 핵심 이벤트 카운트
- `p0_metrics`: `first_post_24h_rate`, `verify_email_failure_rate`, `post_create_error_rate`
- `by_event`, `by_source`, `daily`

참고:

- `p0_metrics`는 `event_name` 필터를 제외한 동일 조건(`from/to/source/user_type`)으로 계산됩니다.
