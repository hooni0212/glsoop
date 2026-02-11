# Cosmetics / Profile Decoration API

기준 라우트:

- `routes/cosmeticsRoutes.js`
- `routes/userRoutes.js` (`/users/:id/profile` 확장)
- `routes/adminRoutes.js` (`/admin/cosmetics/grant`)

Base: `/api`

---

## Endpoints

- `GET /cosmetics/me` (auth)
- `PUT /me/profile-cosmetics` (auth)
- `GET /users/:id/profile` (public, `user.profile_cosmetics` 추가)
- `POST /api/admin/cosmetics/grant` (admin)

---

## `GET /cosmetics/me`

Response:

- `inventory.badges[]`
- `inventory.stickers[]`
- `profile.primary_badge_key`
- `profile.showcase_badge_keys[]`
- `profile.header_stickers[]` (`slot`, `key`)

---

## `PUT /me/profile-cosmetics` 제약

Body:

- `primary_badge_key`: `string | null`
- `showcase_badge_keys`: `string[]` (max 6, unique)
- `header_stickers`: `{ slot, key }[]` (max 3, slot unique, `slot in [tl,tr,br]`)

서버 검증:

- badge 슬롯에는 badge만 허용
- sticker 슬롯에는 sticker만 허용
- 요청된 key는 모두 사용자가 소유(`user_cosmetics`)해야 함

오류:

- `400 INVALID_REQUEST`
- `403 NOT_OWNED`
- `500 INTERNAL_ERROR`

---

## 공개 프로필 확장

`GET /users/:id/profile` 응답의 `user` 하위에 추가:

- `profile_cosmetics.primary_badge`
- `profile_cosmetics.showcase_badges`
- `profile_cosmetics.header_stickers`

하위호환 원칙:

- 기존 필드 변경/삭제 없음
- 신규 필드 추가만 수행

---

## 데이터 모델 연결

- `cosmetic_items`
- `user_cosmetics`
- `user_profile_cosmetics`

마이그레이션:

- `migrations/0009_create_cosmetics.sql`

---

## 관련 문서

- 유료화 계약: `docs/MONETIZATION_API_CONTRACT_V1.md`
