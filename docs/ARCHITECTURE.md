# 글숲 시스템 아키텍처

## 1. 개요
- **목표:** Express + SQLite 기반 API 서버와 정적 HTML/JS/CSS 프런트로 이루어진 글쓰기/읽기 서비스.
- **실행 진입점:** `server.js`가 환경 초기화 → 공통 미들웨어 → 정적 자산 제공 → API 라우트 → 루트 페이지 순으로 설정.
- **특징:** JWT 쿠키 인증, SQLite 단일 파일 DB, 테마 가능한 프런트(bootstrap 의존 최소화).

## 2. 서버 실행 흐름
1. **프로세스 초기화**
   - `server.js`가 `config.js`(환경 변수/JWT/메일 설정)와 `db.js`(SQLite 초기화)를 즉시 로드.
   - `app.set('trust proxy', 1)`으로 프록시 환경 대비.
2. **보안 및 공통 미들웨어**
   - `middleware/security.applySecurity`로 Helmet/CORS 등 보안 헤더를 선 적용.
   - `body-parser`·`cookie-parser`로 JSON/폼/쿠키 파싱.
   - `/api` 네임스페이스에 no-cache 헤더 적용.
3. **정적 자산 제공**
   - `/public` 폴더를 정적 루트로 노출(`app.use(express.static(...))`).
4. **라우팅**
   - `/api` 아래에 인증(`routes/authRoutes`), 사용자(`routes/userRoutes`), 글(`routes/postRoutes`), 북마크(`routes/bookmarkRoutes`), 성장/업적(`routes/growthRoutes`) 라우트 연결.
   - `/api/admin`은 `routes/adminRoutes`가 담당하며 `middleware/auth.adminRequired`로 보호.
   - 관리자 전용 HTML은 `middleware/adminPageGuard.js`로 `/admin` 진입 시 선 검증.
5. **루트 핸들러**
   - `GET /`에서 `public/index.html` 반환.
6. **서버 시작**
   - `HOST`/`PORT` 환경 변수를 우선하며 기본값은 `0.0.0.0:3000`.

## 3. 인증과 권한
- **JWT 쿠키 인증:** `middleware/auth.js`의 `authRequired`가 `token` 쿠키를 검증(JWT_SECRET 사용).
- **관리자 권한 확인:** `adminRequired`가 DB에서 `users.is_admin`을 재확인하여 관리자 전용 라우트 보호.
- **만료/오류 처리:** 잘못된 토큰은 401 JSON 응답으로 반환해 클라이언트가 재로그인하도록 유도.

## 4. 데이터베이스(SQLite)
- **파일 경로:** `data/live/users.db`.
- **초기화:** `db.js`가 PRAGMA(WAL, foreign_keys 등) 적용 후 테이블 생성 및 업적 시드 삽입.
- **핵심 테이블:**
  - 사용자/콘텐츠: `users`(프로필·인증·XP/스트릭), `posts`, `likes`, `follows`.
  - 태그: `hashtags`, `post_hashtags`.
  - 북마크: `bookmark_lists`, `bookmark_items`.
  - 성장: `xp_log`, `achievements`, `user_achievements`, `quest_*`.
- **확장 규칙:** 새 테이블/컬럼은 `db.serialize` 블록 안에서 생성하여 동일한 PRAGMA 컨텍스트를 유지.

## 5. 프런트엔드 정적 자산 구조
- **HTML:** `public/index.html`(메인) + `public/html/*.html`(post, author, mypage, admin, auth 등).
- **CSS:** 엔트리 `public/css/app.css` 한 줄로 토큰 → 베이스 → 벤더 부트스트랩 오버라이드 → GLS 컴포넌트/페이지/테마 순서 로드.
- **JS:**
  - 공통: `public/js/utils.js`(포맷/escape/폰트 조절), `public/js/header.js`(내비/모달/테마 트리거), `public/js/theme.js`(테마/시즌), `public/js/bookmarkModal.js`(모달 제어).
  - 페이지 스크립트: `index.js`, `post.js`, `author.js`, `category.js`, `mypage.js`, `editor.js`, `admin.js`, `growth.js`, `bookmarks.js`, `signup.js`, `login.js`, `forgot-password.js`, `reset-password.js`, `igExport.js` 등.
  - 카드/공통 UI: `postCard.js`, `igExportUI.js`, `falling.js`(시즌 연출).
- **정적 이미지:** `public/img`.

## 6. 새 기능 추가 가이드
- **서버 API:**
  - 위치: `routes/<feature>Routes.js` 작성 후 `server.js`에서 `/api[/admin]` 경로에 연결.
  - 인증 필요 시 `authRequired`/`adminRequired`를 첫 미들웨어로 배치.
  - 공통 보안/레이트리밋이 필요하면 `middleware/security` 또는 `middleware/rateLimiters` 활용.
- **데이터 스키마:** `db.js`의 PRAGMA 이후 `CREATE TABLE IF NOT EXISTS`를 추가하고, 필요 시 `PRAGMA table_info` 검사로 컬럼 보강.
- **프런트 자산:**
  - HTML은 `public/html`에 추가하고 라우트/링크를 `/public` 서빙 경로에 맞춘다.
  - JS는 페이지 단위 파일을 `public/js/<page>.js`로 두고, 공통 로직은 `utils.js`/`header.js`에 배치.
  - CSS는 `public/css/app.css`가 로드하는 계층을 사용(7절 참조).
- **환경 변수:** `.env.example`에 키를 추가하고 `config.js`에서 읽도록 정의.

## 7. 실행/요청 흐름 요약
1. 클라이언트가 `/` 또는 `/html/*.html` 요청 → 정적 HTML과 `app.css`/페이지 JS 로드.
2. JS가 API 호출 시 쿠키의 JWT를 자동 전송하며 실패 시 로그인 화면으로 리다이렉트 처리.
3. API 요청은 `server.js` → 보안 미들웨어 → `/api` 라우터 → 컨트롤러에서 DB(SQLite) 읽기/쓰기.
4. 응답 JSON을 프런트 JS가 받아 DOM을 갱신(카드 렌더, 모달 토글, 테마 반영).

## 8. 디렉터리 맵(주요 항목)
| 경로 | 설명 |
| --- | --- |
| `server.js` | Express 엔트리, 미들웨어/라우터 결선 |
| `config.js` | 환경 변수, JWT/메일 설정 초기화 |
| `db.js` | SQLite 연결, PRAGMA, 스키마/시드 생성 |
| `routes/` | 기능별 API 라우터(auth, user, post, bookmark, growth, admin) |
| `middleware/` | 보안, 인증, 해시태그, 관리자 페이지 가드, 레이트리밋 |
| `public/` | 정적 자산 루트(HTML/CSS/JS/img) |
| `public/css/` | CSS 엔트리(`app.css`), GLS + vendor 스타일 레이어 |
| `public/js/` | 공통 유틸 및 페이지별 스크립트 |
| `data/` | SQLite DB 파일 저장 위치 |

---
- **디자인/CSS 세부 구조는 `public/css/ARCHITECTURE.md`에서 확인.**
