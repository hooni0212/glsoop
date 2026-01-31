
# 글숲 (Glsoop)

감성 글(시, 짧은 에세이, 명언, 필사 등)을 **쓰고 · 읽고 · 공유하는** 문학 커뮤니티 프로젝트.

---

## 1) 문서 / 가이드

- 전체 구조 개요: `docs/SYSTEM_OVERVIEW.md`
- 작업 프로토콜/협업 규칙: `docs/WORKFLOW.md`
- 웹페이지 UI/개선 메모: `docs/WEBPAGE_CRITIQUE.md`
- CLI 단축어(zshrc): `docs/cli-shortcuts.md`

---

## 2) 주요 기능 (요약)

- 회원가입/로그인 기반 글 작성/조회
- 피드/글 상세/작성 UI (정적 파일: `public/`)
- 라우트 분리 구조 (`routes/`)
- 인증/보안 미들웨어 (`middleware/`)
- SQLite 기반 데이터 저장 + 백업 구조 (`data/`)

> 상세 기능/라우트는 `docs/` 문서에 계속 누적합니다.

---

## 3) 기술 스택

- **Backend**: Node.js, Express
- **DB**: SQLite (WAL 모드)
- **Frontend**: 정적 HTML/CSS/JS (`public/`)

---

## 4) 디렉토리 구조

```text
.
├── server.js          # 서버 엔트리
├── config.js          # 환경 변수/메일/JWT 설정 로드
├── db.js              # SQLite 연결 + 스키마/인덱스
├── routes/            # Express 라우터 모음
├── middleware/        # 인증/보안/공통 미들웨어
├── utils/             # 서비스 로직/헬퍼
├── public/            # 정적 프론트엔드 (html/css/js/img/fonts)
├── docs/              # 문서(가이드/정리)
├── data/              # 로컬 DB / 백업 (Git 커밋 금지 권장)
├── legacy/            # 예전 코드/보관용
└── notes/             # 개인 메모/임시 파일

---

## 5) 시작하기 (로컬 실행)

### 5-1) 설치

```bash
npm install
```

### 5-2) 환경변수(.env)

프로젝트 루트에 `.env` 파일을 만들고 값을 채워 넣어야 합니다.
(⚠️ `.env`는 Git에 올리지 않습니다)

예시:

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

### 테스트 환경(outbox 메일)

SMTP 네트워크가 차단된 환경에서는 outbox 전송 모드를 사용해 비밀번호 재설정 E2E를 검증할 수 있습니다.

```bash
MAIL_TRANSPORT=outbox \
MAIL_OUTBOX_PATH=data/test/outbox.jsonl \
BASE_URL=http://localhost:3100 \
DB_PATH=data/test/users.db \
node server.js
```

테스트 스크립트는 아래 명령으로 실행합니다.

```bash
node scripts/e2e_password_reset_outbox.js
```

⚠️ 운영 환경에서는 outbox 전송을 허용하지 않습니다.

### 5-3) 실행

```bash
npm run start
```

기본 포트: `http://localhost:3000`

---

## 5-4) UI 스냅샷 E2E (Playwright)

UI 스냅샷 투어를 실행하면 **guest/authed/admin 모드**로 주요 페이지를 순회하며
desktop/mobile 프로젝트에서 fullPage 스크린샷을 저장하고 갤러리를 생성합니다.

```bash
npm run e2e:ui
```

결과:

- 스냅샷: `test-results/ui-snapshots/runs/<RUN_ID>/<project>/<mode>/*.png`
- 최신 스냅샷: `test-results/ui-snapshots/latest/<project>/<mode>/*.png`
- 갤러리: `test-results/ui-snapshots/index.html` (항상 latest로 리다이렉트)
- Playwright 리포트: `playwright-report/index.html`

갤러리만 다시 생성하려면:

```bash
npm run e2e:ui:show
```

스냅샷 경로/Run ID를 바꾸려면:

```bash
GLSOOP_SNAPSHOT_ROOT=/Users/gimtaehun/2026/workspace/archives/glsoop/ui-snapshots \
GLSOOP_SNAPSHOT_RUN_ID=2026-01-01_120000 \
npm run e2e:ui
```

특정 run의 갤러리를 다시 만들려면:

```bash
node scripts/build-snapshot-gallery.mjs --run 2026-01-01_120000
```

run 갤러리 경로:

- `test-results/ui-snapshots/runs/<RUN_ID>/index.html` (root index는 변경되지 않음)

---

## 6) DB / 백업 정책 (WAL 모드)

SQLite WAL 모드에서는 `users.db` 외에 `-wal`, `-shm` 파일에도 변경분이 남을 수 있어
**단순 파일 복사만으로는 최신 상태가 누락될 수 있습니다.**

권장 백업 방식:

* `sqlite3 ... ".backup '...'"` (스냅샷 백업)

폴더 예시:

* live DB: `data/live/`
* backups: `data/backups/`

---

## 7) 보안/커밋 주의

다음은 **절대 커밋 금지(개인정보/비밀키 포함 가능)**:

* `.env`, `*.env*`
* `*.db`, `*-wal`, `*-shm`, `*.bak`
* `data/` 아래 DB/백업 파일

`.gitignore` 설정을 꼭 확인하세요.

---

## 8) 라이선스

개인 프로젝트 (추후 결정)

```

---

## 4) 다음 액션(추천)
- README 교체한 다음, **`.gitignore`에서 `data/` 무시를 실제로 켜는 것**도 같이 하면 “DB 실수 커밋” 사고가 거의 사라져.

원하면 내가 **README에 맞춰서 `.gitignore`도 안전하게 업데이트 버전**까지 바로 써줄게.
```
