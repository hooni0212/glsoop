# 글숲 (Glsoop) Server

감성 글(시, 짧은 에세이, 명언, 필사)을 쓰고 읽고 공유하는 커뮤니티의 서버 레포입니다.

---

## 1) 기술 스택

- Backend: Node.js + Express
- DB: SQLite (WAL)
- Auth: JWT(cookie)
- Static: `public/` 정적 페이지

---

## 2) 빠른 시작

### 설치

```bash
npm install
```

### 실행

```bash
npm run start
```

기본 주소: `http://localhost:3000`

---

## 3) 필수 환경 변수

로컬 `.env` 예시:

```bash
GMAIL_USER=your@gmail.com
GMAIL_PASS=your_app_password
JWT_SECRET=change_me
JWT_ISSUER=http://localhost:3000
JWT_AUDIENCE=glsoop-client
CORS_ALLOWED_HOSTS=www.glsoop.com,m.glsoop.com,localhost,127.0.0.1
MAIL_TRANSPORT=smtp
MAIL_OUTBOX_PATH=data/test/outbox.jsonl
MAIL_FAIL_SEND=0
```

운영에서는 `BASE_URL` 또는 `PUBLIC_BASE_URL`을 명시해 메일 링크가 올바른 도메인을 가리키게 설정합니다.

---

## 4) 문서 구조 (기능별 리팩토링)

문서 허브:

- `docs/README.md`
- `docs/server/README.md`

API 인덱스:

- `docs/API_REFERENCE.md`

기능별 API 문서:

- `docs/server/api/auth-account.md`
- `docs/server/api/users-follow.md`
- `docs/server/api/posts-feed-likes.md`
- `docs/server/api/bookmarks.md`
- `docs/server/api/search.md`
- `docs/server/api/growth-quests.md`
- `docs/server/api/cosmetics-profile.md`
- `docs/server/api/monetization.md`
- `docs/server/api/share-events.md`
- `docs/server/api/admin-ops.md`

아키텍처/DB:

- `docs/server/architecture/runtime-overview.md`
- `docs/server/architecture/database.md`
- `docs/DB_SCHEMA.md`

유료화:

- `docs/MONETIZATION_API_CONTRACT_V1.md`
- `docs/MONETIZATION_PHASEC_RUNBOOK.md`

---

## 5) 디렉토리 요약

```text
.
├── server.js
├── config.js
├── db.js
├── routes/
├── middleware/
├── utils/
├── migrations/
├── services/
├── public/
├── docs/
├── tests/
└── data/
```

---

## 6) 테스트 / 운영 스크립트

- 서버 실행: `npm run start`
- UI 스냅샷 E2E: `npm run e2e:ui`
- 스냅샷 갤러리 생성: `npm run e2e:ui:show`
- 유료화 사전 점검: `npm run verify:monetization:preflight`

---

## 7) 데이터/보안 주의

커밋 금지 대상:

- `.env`, `*.env*`
- `*.db`, `*-wal`, `*-shm`, `*.bak`
- 개인 정보/토큰 포함 로그 파일

SQLite WAL 환경에서는 안전한 백업을 위해 `sqlite3 ... ".backup ..."` 방식 사용을 권장합니다.
