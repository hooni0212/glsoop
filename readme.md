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

## 4) 문서 구조

이 저장소에는 서버 실행, API 구현, DB 구조처럼 코드와 직접 붙어 있는 기술 문서만 둡니다.
제품, 기획, QA, 릴리즈, App Review, 운영, 정책, 마케팅, 디자인 문서는 `../glsoop-docs`를 기준으로 관리합니다.

서버 기술 문서:

- `docs/참고/API-레퍼런스.md`
- `docs/서버/API/인증-계정.md`
- `docs/서버/API/인증-쿠키-세션-정책.md`
- `docs/참고/시스템-개요.md`
- `docs/참고/DB-스키마.md`

공통 문서 canonical:

- 문서 허브: `../glsoop-docs/00_Index/문서-허브.md`
- 작업 시작 가이드: `../glsoop-docs/08_Operations/agent-start-here.md`
- 문서 표준: `../glsoop-docs/08_Operations/documentation-standard.md`
- Notion sync 표준: `../glsoop-docs/08_Operations/notion-sync-standard.md`
- QA 분류 허브: `../glsoop-docs/05_QA/README.md`
- 서버 공통 운영 문서: `../glsoop-docs/08_Operations/glsoop/`
- 공통 API 계약: `../glsoop-docs/04_API_Contracts/monetization-api-contract-v1.md`
- 서버 archive: `../glsoop-docs/90_Archive/glsoop/`

주의:

- 기존 `docs/운영/*`, `docs/수익화/API-계약서-v1.md` 원본은 링크 호환을 위해 임시 유지한다.
- 서버 실행/배포/런타임과 직접 연결된 문서와 정적 HTML은 이 저장소를 우선 기준으로 유지한다.

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
