# Runtime Overview

기준 파일: `server.js`

---

## 1) 부팅 순서

1. `config.js` 로드 (env/JWT/메일 설정)
2. `db.js` 로드 (SQLite 연결)
3. Express 앱 생성 + 공통 보안 미들웨어 적용
4. `/api` 캐시 방지 헤더 적용
5. 정적 파일(`public/`) 서빙
6. API 라우트 마운트
7. `runMigrations()` 실행 후 서버 listen
8. 주기 작업 실행
   - `cleanupExpiredPending()` (30분)
   - `reconcileMonetizationState()` (30분)

---

## 2) API 라우트 마운트 순서

- `app.use('/api', authRoutes)`
- `app.use('/api', userRoutes)`
- `app.use('/api', postRoutes)`
- `app.use('/api', bookmarkRoutes)`
- `app.use('/api', searchRoutes)`
- `app.use('/api', shareRoutes)`
- `app.use('/api', growthRoutes)`
- `app.use('/api', cosmeticsRoutes)`
- `app.use('/api', monetizationRoutes)`
- `app.use('/api', monetizationWebhookRoutes)`
- `app.use('/api/admin', adminRoutes)`

관련 파일:

- `routes/authRoutes.js`
- `routes/userRoutes.js`
- `routes/postRoutes.js`
- `routes/bookmarkRoutes.js`
- `routes/searchRoutes.js`
- `routes/shareRoutes.js`
- `routes/growthRoutes.js`
- `routes/cosmeticsRoutes.js`
- `routes/monetizationRoutes.js`
- `routes/monetizationWebhookRoutes.js`
- `routes/adminRoutes.js`

---

## 3) Admin Page 라우팅

- `GET /admin`는 `adminPageRequired` 통과 시 `public/html/admin.html` 반환
- `GET /html/admin.html`은 직접 접근 차단(404)
- 구현: `routes/adminPageRoutes.js`

---

## 4) 보안/인증 핵심

- `middleware/security.js`
  - CORS, 보안 헤더, CSP
- `middleware/auth.js`
  - `authRequired`: 로그인 필수
  - `adminRequired`: 관리자 권한 필수
- 쿠키 기반 JWT 검증 + `req.user` 주입

---

## 5) 문서 연결

- API 인덱스: `docs/API_REFERENCE.md`
- DB 구조: `docs/server/architecture/database.md`
- 유료화 운영: `docs/MONETIZATION_PHASEC_RUNBOOK.md`
