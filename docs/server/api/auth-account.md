# Auth / Account API

기준 라우트: `routes/authRoutes.js`

Base: `/api`

---

## Endpoints

- `POST /signup` (public)
- `POST /verify-email` (public)
- `POST /verify-email/resend` (public)
- `POST /password-reset-request` (public)
- `POST /password-reset` (public)
- `POST /login` (public)
- `POST /logout` (public)
- `GET /me` (auth)
- `GET /me/followings` (auth)
- `PUT /me` (auth)

---

## 핵심 동작

- 회원가입은 `pending_signups` 기반 OTP 인증 완료 후 사용자 생성
- 비밀번호 재설정은 토큰 + 만료시간 검증
- 로그인 시 JWT를 쿠키로 발급
- `GET /me`는 프로필 + 관계 수치(팔로워/팔로잉 등) 포함

---

## Signup 시 코스메틱 기본 지급

`commitPendingSignup()`에서 신규 유저 생성 직후:

- `user_cosmetics`에 `badge_default_seedling` 기본 지급
- `user_profile_cosmetics` 기본 row 생성 및 대표 배지 세팅

관련 마이그레이션: `migrations/0009_create_cosmetics.sql`

---

## 관련 문서

- OTP 설계: `docs/OTP_AUTH_DESIGN.md`
- 코스메틱 상세: `docs/server/api/cosmetics-profile.md`
