# Search API

기준 라우트: `routes/searchRoutes.js`

Base: `/api`

---

## Endpoint

- `GET /search` (public)

---

## Query

- `q`: 필수, 1~80자
- `type`: `all | posts | authors` (default `all`)
- `limit`: 1~30 (default 10)
- `offset`: 0 이상 (default 0)

---

## Response 요약

- `query`
- `type`
- `posts[]`
- `authors[]`
- `meta`
  - `posts_count`
  - `authors_count`
  - `limit`
  - `offset`

---

## 에러 코드

- `400 INVALID_REQUEST`
- `500 INTERNAL_ERROR`

---

## 관련 문서

- 게시글 API: `docs/server/api/posts-feed-likes.md`
- 사용자 API: `docs/server/api/users-follow.md`
