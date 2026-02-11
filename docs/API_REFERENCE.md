# 글숲 Server API Reference

서버 API 문서를 기능별로 재구성한 인덱스입니다.

---

## 공통 규칙

- Base: `/api`
- Admin Base: `/api/admin`
- 응답 키: `snake_case`
- 성공: `{ ok: true, message, ... }`
- 실패: `{ ok: false, message, code? }`
- 하위호환: 기존 필드 변경/삭제 금지, 신규 필드 추가만 허용

대표 오류 코드:

- `INVALID_REQUEST` (400)
- `AUTH_REQUIRED` / `AUTH_INVALID_TOKEN` / `AUTH_INVALID_SESSION` (401)
- `AUTH_FORBIDDEN` / `ENTITLEMENT_REQUIRED` / `NOT_OWNED` (403)
- `RESOURCE_NOT_FOUND` (404)
- `CONFLICT` / `ALREADY_CLAIMED` (409)
- `VERIFICATION_FAILED` (400/502)
- `VERIFICATION_UNAVAILABLE` (503/504)
- `INTERNAL_ERROR` (500)

---

## 기능별 API 문서

- 인증/계정: `docs/server/api/auth-account.md`
- 사용자/팔로우/프로필: `docs/server/api/users-follow.md`
- 게시글/피드/좋아요: `docs/server/api/posts-feed-likes.md`
- 북마크: `docs/server/api/bookmarks.md`
- 검색: `docs/server/api/search.md`
- 성장/퀘스트: `docs/server/api/growth-quests.md`
- 코스메틱/프로필 꾸미기: `docs/server/api/cosmetics-profile.md`
- 유료화(결제/권한/웹훅): `docs/server/api/monetization.md`
- 공유 이벤트: `docs/server/api/share-events.md`
- 관리자 운영: `docs/server/api/admin-ops.md`

---

## 빠른 엔드포인트 맵

### 1) Auth / Account

- `POST /api/signup`
- `POST /api/verify-email`
- `POST /api/verify-email/resend`
- `POST /api/password-reset-request`
- `POST /api/password-reset`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/me`
- `GET /api/me/followings`
- `PUT /api/me`

### 2) Users / Follow

- `GET /api/users/:id/profile`
- `POST /api/users/:id/follow`
- `GET /api/users/:id/posts`

### 3) Posts / Feed / Likes

- `POST /api/posts`
- `PUT /api/posts/:id`
- `DELETE /api/posts/:id`
- `GET /api/posts/my`
- `GET /api/posts/liked`
- `GET /api/posts/feed`
- `GET /api/posts`
- `GET /api/posts/:id`
- `GET /api/posts/:id/edit`
- `GET /api/posts/:id/related`
- `POST /api/posts/:id/toggle-like`

### 4) Bookmarks

- `GET /api/bookmarks/lists`
- `GET /api/bookmarks/lists/recent`
- `POST /api/bookmarks/lists`
- `PATCH /api/bookmarks/lists/:listId`
- `DELETE /api/bookmarks/lists/:listId`
- `GET /api/bookmarks/lists/:listId/items`
- `POST /api/bookmarks/lists/:listId/items`
- `DELETE /api/bookmarks/lists/:listId/items/:postId`
- `GET /api/posts/:postId/bookmarks`

### 5) Search

- `GET /api/search`

### 6) Growth / Quests

- `GET /api/growth/dashboard`
- `GET /api/growth/top-posts`
- `GET /api/growth/summary`
- `GET /api/growth/achievements`
- `GET /api/quests/active`
- `POST /api/quests/:stateId/claim`

### 7) Cosmetics / Profile

- `GET /api/cosmetics/me`
- `PUT /api/me/profile-cosmetics`
- `GET /api/users/:id/profile` (`user.profile_cosmetics` 확장)
- `POST /api/admin/cosmetics/grant`

### 8) Monetization

- `GET /api/store/catalog`
- `GET /api/entitlements/me`
- `POST /api/purchases/verify`
- `POST /api/monetization/webhooks/apple`
- `POST /api/monetization/webhooks/google`

### 9) Share Events

- `POST /api/share-events`
- `GET /api/admin/share-events/summary`

### 10) Admin

- `GET /api/admin/`
- `GET /api/admin/users`
- `DELETE /api/admin/users/:id`
- `GET /api/admin/posts`
- `GET /api/admin/posts/:id`
- `DELETE /api/admin/posts/:id`
- `GET /api/admin/quest-templates`
- `POST /api/admin/quest-templates`
- `PUT /api/admin/quest-templates/:id`
- `DELETE /api/admin/quest-templates/:id`
- `POST /api/admin/quests/achievements/backfill`
- `GET /api/admin/quest-campaigns`
- `POST /api/admin/quest-campaigns`
- `PUT /api/admin/quest-campaigns/:id`
- `DELETE /api/admin/quest-campaigns/:id`
- `PUT /api/admin/quest-campaigns/:id/items`
- `POST /api/admin/entitlements/grant`
- `POST /api/admin/purchases/reconcile`
- `POST /api/admin/monetization/reconcile`
- `GET /api/admin/monetization/webhook-events`
- `GET /api/admin/monetization/alerts`
- `POST /api/admin/monetization/alerts/:id/resolve`
- `POST /api/admin/cosmetics/grant`
- `GET /api/admin/share-events/summary`

---

## 운영/계약 문서

- 유료화 계약서: `docs/MONETIZATION_API_CONTRACT_V1.md`
- 유료화 운영 런북: `docs/MONETIZATION_PHASEC_RUNBOOK.md`
- 서버 문서 허브: `docs/README.md`
