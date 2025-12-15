
# 글숲 (Glsoop)

감성 글(시, 짧은 에세이, 명언, 필사 등)을 쓰고 읽고 공유하는 문학 커뮤니티 프로젝트.

---

## 1. 핵심 링크

- 문서 모음: `docs/`
  - 작업 프로토콜/협업 규칙: `docs/WORKFLOW.md` (작성 예정/이동 예정)
  - CLI 단축어(zshrc): `docs/CLI-SHORTCUTS.md` (작성 예정/추가 예정)

---

## 2. 주요 기능 (요약)

- 회원가입/로그인 기반 글 작성/조회
- 글/피드 UI (정적 파일: `public/`)
- 라우트 분리 구조 (`routes/`)
- 인증/보안 미들웨어 (`middleware/`)
- SQLite 기반 데이터 저장소 (`data/live/`)

> 상세 기능은 코드/라우트 및 `docs/` 문서에서 계속 정리 예정.

---

## 3. 기술 스택

- **Backend**: Node.js, Express
- **DB**: SQLite (WAL 모드 사용)
- **Frontend**: 정적 HTML/CSS/JS (`public/`)
- **Deploy/Infra**: (환경에 따라) 로컬/서버 배포

---

## 4. 디렉토리 구조

```text
.
├── config.js
├── db.js
├── data/
│   ├── live/          # 실제 서비스가 사용하는 DB 세트(users.db + wal/shm)
│   └── backups/       # 백업 스냅샷(.bak) 보관
├── docs/              # 문서(가이드/정리)
├── legacy/            # 예전 코드/보관용
├── middleware/        # 인증/보안/기능 미들웨어
├── notes/             # 개인 메모/임시 파일(필요시 docs로 정리)
├── public/            # 정적 프론트엔드 (html/css/js/img/fonts)
├── routes/            # Express 라우터 모음
├── utils/             # 서비스 로직/헬퍼
├── server.js          # 서버 엔트리
├── package.json
└── package-lock.json
````

---

## 5. 시작하기 (로컬 실행)

### 5-1) 설치

```bash
cd ~/2026/workspace/projects/glsoop
npm install
```

### 5-2) 환경변수(.env)

`.env` 파일을 프로젝트 루트에 생성하고 값을 채워 넣어야 함.
(⚠️ `.env`는 Git에 올리지 않음)

예시:

```bash
# 예시일 뿐, 실제 값으로 교체
GMAIL_USER=your@gmail.com
GMAIL_PASS=your_app_password
JWT_SECRET=change_me
```

### 5-3) DB 위치

프로젝트는 SQLite DB를 아래 경로로 두는 것을 권장:

* `data/live/users.db`

> `db.js`에서 DB 경로를 `data/live/users.db` 기준으로 열도록 맞춰두는 것을 추천.

### 5-4) 실행

```bash
node server.js
```

---

## 6. DB 백업 정책 (WAL 모드)

SQLite WAL 모드에서는 변경분이 `users.db`뿐 아니라 `users.db-wal`, `users.db-shm`에 남을 수 있음.
따라서 **파일 복사(cp)만으로는 최신 상태가 누락될 수 있음**.

권장 백업 방식:

* `sqlite3 ... ".backup '...'"` (스냅샷 백업)

프로젝트에서는 아래 디렉토리 기준으로 관리:

* live DB: `data/live/`
* backups: `data/backups/`

---

## 7. 보안/커밋 주의

다음은 **절대 커밋 금지(개인정보/비밀키 포함 가능)**:

* `.env`, `*.env*`
* `data/` 아래 DB/백업 파일
* `*.db`, `*-wal`, `*-shm`, `*.bak`

`.gitignore`로 차단되어 있어야 함.

---

## 8. 유지보수 메모

* 문서(정리)는 `docs/`에 계속 누적
* 임시 파일/레거시 파일은 `notes/`, `legacy/`로 분리하여 루트 청결 유지

---

## 9. 라이선스

개인 프로젝트 (추후 결정)

```

원하면 내가 이 README를 너 스타일로 더 “프로덕트 느낌” 나게 바꿔줄 수도 있어:
- 스크린샷/데모 GIF 자리 만들기
- “API 라우트 목록” 표로 정리 (`routes/` 기반)
- “개발 환경 체크리스트”(Node 버전, DB 초기화, 메일 설정 등) 추가
```
