# Share Events API

기준 라우트:

- `routes/shareRoutes.js`
- `routes/adminRoutes.js` (`/admin/share-events/summary`)

Base: `/api`

---

## Endpoints

- `POST /share-events` (public, authOptional)
- `GET /api/admin/share-events/summary` (admin)

---

## `POST /share-events`

Body(required):

- `post_id`
- `platform` (`mobile | web`)
- `surface`
- `channel`
- `result` (`shared | dismissed | failed`)

Body(optional):

- `request_id`
- `meta` (object|string, 서버에서 JSON 문자열로 저장)

Success:

- `201`
- `event.id`, `event.created_at`

---

## `GET /api/admin/share-events/summary`

Query(optional):

- `from`, `to` (YYYY-MM-DD)
- `platform` (`all | mobile | web`)
- `surface`
- `channel`
- `top_limit`
- `daily_limit`

Response:

- `summary`
- `by_channel`
- `by_surface`
- `daily`
- `filters`

---

## 데이터 모델 연결

- `share_events`

마이그레이션:

- `migrations/0008_create_share_events.sql`
