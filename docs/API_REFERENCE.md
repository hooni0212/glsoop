# 글숲 Server API Reference

> 기준: `server.js` 라우팅 구성
>
> - API Base: `/api`
> - Admin API Base: `/api/admin`
>
> 표기
>
> - **public**: 로그인 없이 호출 가능
> - **auth**: 로그인 필요 (`authRequired`)
> - **admin**: 관리자 권한 필요 (`authRequired` + `adminRequired`)
>
> 응답 규칙
>
> - 성공/실패 모두 `ok`, `message` 필드를 포함합니다.
> - 실패 응답은 `code` 필드를 포함합니다.
> - 복합 단어 키는 `snake_case`로 통일합니다.
> - 공통 오류 코드(1차 표준화): `INVALID_REQUEST`(400), `AUTH_REQUIRED`(401), `AUTH_INVALID_TOKEN`(401), `AUTH_INVALID_SESSION`(401), `AUTH_FORBIDDEN`(403), `ENTITLEMENT_REQUIRED`(403), `NOT_OWNED`(403), `RESOURCE_NOT_FOUND`(404), `CONFLICT`(409), `ALREADY_CLAIMED`(409), `INTERNAL_ERROR`(500)
> - 공유 정책(2026-02-10): Phase A/B는 클라이언트 시스템 ShareSheet만 사용하고 서버 API는 추가하지 않습니다. 공유 이벤트 로깅은 Phase C에서 필요 시 별도 API로 분리합니다.

---

## 0) Admin Page (HTML)

- `GET /admin` (**admin**) — 관리자 페이지 진입점 (admin.html)
- `GET /html/admin.html` (**blocked**) — 직접 접근은 항상 404 (의도적으로 차단)

---

## 1) Auth / Account (`/api`)

- `POST /api/signup` (**public**) — 회원가입 + 이메일 인증 메일 발송
- `POST /api/verify-email` (**public**) — 이메일 인증 번호(OTP) 검증
- `POST /api/verify-email/resend` (**public**) — 이메일 인증 번호(OTP) 재발송
- `POST /api/password-reset-request` (**public**) — 비밀번호 재설정 메일 요청
- `POST /api/password-reset` (**public**) — 비밀번호 재설정 처리
- `POST /api/login` (**public**) — 로그인
- `POST /api/logout` (**public**) — 로그아웃
- `GET /api/me` (**auth**) — 내 정보 조회
- `PUT /api/me` (**auth**) — 내 정보 수정
- `GET /api/me/followings` (**auth**) — 내가 팔로우 중인 사용자 목록

---

## 2) Users / Follow (`/api`)

- `GET /api/users/:id/profile` (**public**) — 작가 공개 프로필
- `GET /api/users/:id/posts` (**public**) — 특정 작가의 글 목록 (무한스크롤)

팔로우
- `POST /api/users/:id/follow` (**auth**) — 팔로우/언팔로우 토글

---

## 3) Search (`/api`)

- `GET /api/search` (**public**) — 통합 검색(글/작가 분리 반환)
  - Query: `q`(required, 1~80), `type`(`all|posts|authors`, default `all`)
  - Query: `limit`(1~30, default 10), `offset`(0+, default 0)
  - Response: `query`, `type`, `posts[]`, `authors[]`, `meta{ posts_count, authors_count, limit, offset }`
  - Error: 400 `INVALID_REQUEST`, 500 `INTERNAL_ERROR`

---

## 4) Posts / Feed / Likes (`/api`)

작성/수정/삭제
- `POST /api/posts` (**auth**) — 글 작성
- `PUT /api/posts/:id` (**auth**) — 글 수정
- `DELETE /api/posts/:id` (**auth**) — 글 삭제

내 글/좋아요
- `GET /api/posts/my` (**auth**) — 내가 쓴 글 목록
- `GET /api/posts/liked` (**auth**) — 내가 좋아요한 글 목록

피드/목록
- `GET /api/posts/feed` (**public**) — 피드
- `GET /api/posts` (**public**) — 글 목록 (필터/정렬/페이징 포함)

상세/편집/관련
- `GET /api/posts/:id` (**public**) — 글 상세
- `GET /api/posts/:id/edit` (**auth**) — 편집 화면용 데이터
- `GET /api/posts/:id/related` (**public**) — 관련 글

좋아요
- `POST /api/posts/:id/toggle-like` (**auth**) — 좋아요 토글

---

## 5) Bookmarks (`/api`)

북마크 폴더
- `GET /api/bookmarks/lists` (**auth**) — 내 북마크 폴더 목록
- `GET /api/bookmarks/lists/recent?post_id=<id>&limit=<n>` (**auth**) — 특정 글 기준 최근 사용 폴더 목록 (`contains`, `item_count`, `last_used_at` 포함)
  - Query: `post_id`(required), `limit`(optional, default 5, max 20)
  - 모바일 권장 흐름: 상세 북마크 모달 최초 진입 시 recent API를 우선 호출하고, 폴더 전체 상태는 `GET /api/posts/:postId/bookmarks`로 동기화
- `POST /api/bookmarks/lists` (**auth**) — 폴더 생성
- `PATCH /api/bookmarks/lists/:listId` (**auth**) — 폴더 수정
- `DELETE /api/bookmarks/lists/:listId` (**auth**) — 폴더 삭제

폴더 내 글
- `GET /api/bookmarks/lists/:listId/items` (**auth**) — 폴더 내 글 목록
- `POST /api/bookmarks/lists/:listId/items` (**auth**) — 폴더에 글 추가
- `DELETE /api/bookmarks/lists/:listId/items/:postId` (**auth**) — 폴더에서 글 제거

글 기준(내 폴더들 중 어디에 담겼는지)
- `GET /api/posts/:postId/bookmarks` (**auth**) — 특정 글이 담긴 내 폴더 목록

---

## 6) Growth / Achievements / Quests (`/api`)

- `GET /api/growth/dashboard` (**auth**) — 성장 대시보드 통합 응답 (summary + achievements + campaigns + top_posts)
  - `campaigns[].quests[]` 추가 필드: `is_locked`(boolean), `required_entitlement`(string|null), `lock_reason`(string|null)
- `GET /api/growth/summary` (**auth**) — 성장 요약
- `GET /api/growth/achievements` (**auth**) — 업적 진행/해제 현황
- `GET /api/quests/active` (**auth**) — 활성 퀘스트(캠페인) 조회
  - `campaigns[].quests[]`에 `is_locked`, `required_entitlement`, `lock_reason` 포함
- `POST /api/quests/:stateId/claim` (**auth**) — 퀘스트 보상 수령
  - 잠금 퀘스트(`required_entitlement` 미보유)일 경우 403 `ENTITLEMENT_REQUIRED`
  - Response 확장: `gained_cosmetics[]` (`key`, `name`, `icon_emoji`, `rarity`, `season`)
- `GET /api/growth/top-posts` (**auth**) — 인기 글 요약 목록(대시보드와 동일 스키마)
- `top_posts` 항목 필드: `id`, `title`, `excerpt`, `author_name`, `category`, `created_at`, `like_count`, `bookmark_count`
- 하위호환: 기존 개별 엔드포인트는 유지되며, 프론트는 dashboard 우선 호출 후 필요 시 fallback

---

## 7) Share Events (`/api`)

- `POST /api/share-events` (**public, authOptional**) — 공유 이벤트 기록
  - Body: `post_id`(required), `platform`(`mobile|web`), `surface`, `channel`, `result`(`shared|dismissed|failed`)
  - Body(optional): `request_id`, `meta`(object|string, JSON 저장)
  - Success: `201` + `event{id, created_at}`
  - Error: 400 `INVALID_REQUEST`, 404 `RESOURCE_NOT_FOUND`, 500 `INTERNAL_ERROR`

- `GET /api/admin/share-events/summary` (**admin**) — 공유 이벤트 요약 통계
  - Query(optional): `from`, `to`(YYYY-MM-DD), `platform`(`all|mobile|web`), `surface`, `channel`
  - Query(optional): `top_limit`(1~50, default 10), `daily_limit`(1~120, default 30)
  - Response: `summary`, `by_channel`, `by_surface`, `daily`, `filters`
  - Error: 400 `INVALID_REQUEST`, 500 `INTERNAL_ERROR`

---

## 8) Monetization (`/api`)

- `GET /api/store/catalog` (**public**) — 스토어 카탈로그 조회
  - 활성 상품만 반환(`is_active=1`)
  - Response: `products[]` (`store_sku`, `platform`, `product_type`, `entitlement_key`, `title`, `description`, `season`, `is_active`, `meta`)
  - Error: 500 `INTERNAL_ERROR`

- `GET /api/entitlements/me` (**auth**) — 내 entitlement 목록 조회
  - Response: `entitlements[]` (`entitlement_key`, `status`, `starts_at`, `ends_at`, `source`)
  - Error: 500 `INTERNAL_ERROR`

- `POST /api/purchases/verify` (**auth**) — 결제 검증 요청/처리
  - Body(required): `platform`(`apple|google|web`), `store_sku`
  - Body(platform): `transaction_id`(apple), `purchase_token` 또는 `receipt_data`(google)
  - Body(optional): `receipt_data`, `client_meta`
  - 동작(기본): `purchases` 원장에 `pending` 저장 + `user_entitlements` 기본 `inactive` 생성/유지
  - 동작(옵션): 서버 `MONETIZATION_VERIFY_MODE=auto_active`일 때 `active`로 즉시 반영
  - 중복 처리: 같은 플랫폼 식별자 재요청 시 동일 사용자 기준 idempotent 응답
  - Response: `purchase`, `entitlements`
  - Error: 400 `INVALID_REQUEST`, 404 `RESOURCE_NOT_FOUND`, 409 `CONFLICT`, 500 `INTERNAL_ERROR`

---

## 9) Admin API (`/api/admin`)

헬스 체크
- `GET /api/admin/` (**admin**) — admin API 연결 확인

Users
- `GET /api/admin/users` (**admin**) — 회원 목록(검색/필터/정렬/페이지)
- `DELETE /api/admin/users/:id` (**admin**) — 회원 삭제(관련 데이터 포함)

Posts
- `GET /api/admin/posts` (**admin**) — 글 목록(검색/필터/정렬/페이지)
- `GET /api/admin/posts/:id` (**admin**) — 글 상세
- `DELETE /api/admin/posts/:id` (**admin**) — 글 삭제(좋아요/북마크 아이템 정리 포함)

Quest Templates
- `GET /api/admin/quest-templates` (**admin**) — 템플릿 목록
- `POST /api/admin/quest-templates` (**admin**) — 템플릿 생성
- `PUT /api/admin/quest-templates/:id` (**admin**) — 템플릿 수정
- `DELETE /api/admin/quest-templates/:id` (**admin**) — 템플릿 삭제

Quest Campaigns
- `GET /api/admin/quest-campaigns` (**admin**) — 캠페인 목록
- `POST /api/admin/quest-campaigns` (**admin**) — 캠페인 생성
- `PUT /api/admin/quest-campaigns/:id` (**admin**) — 캠페인 수정
- `DELETE /api/admin/quest-campaigns/:id` (**admin**) — 캠페인 삭제
- `PUT /api/admin/quest-campaigns/:id/items` (**admin**) — 캠페인 아이템(템플릿 연결) 업데이트

Monetization / Cosmetics (Debug)
- `POST /api/admin/entitlements/grant` (**admin**) — 사용자 entitlement 강제 활성화(테스트/복구)
  - Body: `user_id`, `entitlement_key`, `ends_at`(optional), `source`(`admin|promo`, optional)
- `POST /api/admin/purchases/reconcile` (**admin**) — 결제 상태 강제 반영 + entitlement 동기화
  - Lookup: `purchase_id` 또는 `platform + (transaction_id|purchase_token)`
  - Body(required): `status`(`active|expired|refunded|canceled|pending`)
  - Body(optional): `expires_at`(ISO datetime), `source`(`admin|promo|iap`), `reason`
  - Response: `purchase`, `entitlement`, `summary`
- `POST /api/admin/monetization/reconcile` (**admin**) — 만료/상태 동기화 수동 실행
  - Body(optional): `user_id` (없으면 전체)
  - Response: `summary{expired_purchases, activated_entitlements, deactivated_entitlements}`
- `POST /api/admin/cosmetics/grant` (**admin**) — 사용자 코스메틱 지급(중복 요청 idempotent)
  - Body: `user_id`, `cosmetic_key`
