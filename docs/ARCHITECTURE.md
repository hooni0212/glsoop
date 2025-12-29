# 글숲(glsoop) 아키텍처 개요
- 목적: 서버/클라이언트 흐름을 한눈에 파악하고, 새 기능을 어디에 추가해야 하는지 빠르게 결정할 수 있게 합니다.
- 구성: 1) 실행 흐름 요약 2) 서버(Express) 3) 데이터 계층(SQLite) 4) 프론트(public) 5) 확장 가이드.

## 0. 실행 흐름 요약
1. `server.js`가 Express 앱을 부팅하고 `middleware/security`(Helmet/CORS) → body/cookie 파서 → 슬로우 로그 → `/api` 캐시 방지 → `adminPageRoutes` 보호 → 정적 파일 서빙 순으로 미들웨어를 배치합니다.
2. `/api` 이하로 각 라우트 모듈(`routes/*.js`)이 연결되고, JWT 검증은 `middleware/auth.js`가 담당합니다.
3. SQLite(`data/live/users.db`)는 `db.js`에서 초기화되며, 서버 시작 시 스키마를 확인/자동 확장합니다.
4. 정적 리소스는 `/public`에서 제공되며, 각 HTML은 `public/css/app.css`와 페이지별 JS를 로드합니다.

## 1. 서버/Express 구조
- 엔트리: `server.js`
  - 포트/호스트 결정 → `applySecurity`로 Helmet + CORS 설정 → bodyParser/cookieParser → 슬로우 요청 로거(300ms 이상) → `/api` no-cache 헤더 → `adminPageRoutes`로 관리자 HTML 보호 → `express.static('public')` → API 라우트(`authRoutes`, `userRoutes`, `postRoutes`, `bookmarkRoutes`, `growthRoutes`, `adminRoutes`).
- 라우팅/미들웨어
  - 인증: `middleware/auth.js`의 `authRequired`가 쿠키의 JWT를 검증하고 `req.user`를 설정합니다. `adminRequired`는 DB에서 `is_admin`을 재확인합니다.
  - 보안: `middleware/security.js`의 Helmet(CSP 포함) + CORS 화이트리스트, `middleware/rateLimiters.js`의 로그인/회원가입/비밀번호 관련 rate limit.
  - 기타: `middleware/adminPageGuard.js`로 관리자 HTML 차단, `middleware/hashtags.js`로 해시태그 파싱 유틸.
- 라우트 모듈 역할 (요약)
  - `routes/authRoutes.js`: 회원가입/이메일 인증/로그인·로그아웃/비밀번호 재설정. 로그인 성공 시 JWT를 쿠키에 세팅.
  - `routes/userRoutes.js`: 프로필 조회/수정, 팔로우/언팔로우, 마이페이지 데이터.
  - `routes/postRoutes.js`: 글 CRUD, 좋아요, 해시태그 필터.
  - `routes/bookmarkRoutes.js`: 북마크 폴더/아이템 CRUD.
  - `routes/growthRoutes.js`: XP/레벨, 업적, 퀘스트 상태.
  - `routes/adminRoutes.js`: 관리자 전용 대시보드/유저 관리.
  - `routes/adminPageRoutes.js`: 관리자 HTML 접근을 별도 가드로 처리.
- JWT 흐름
  - `config.js`에서 `JWT_SECRET`을 로드 → 로그인/회원가입 후 발급한 토큰을 쿠키(`token`)에 저장 → 보호 라우트에서 `authRequired`로 검증 → 관리자 라우트는 `adminRequired`로 2차 검증.

## 2. 데이터 계층(SQLite)
- 초기화: `db.js`가 `data/live/users.db`를 열고 `PRAGMA WAL`, `foreign_keys`, `busy_timeout` 등을 설정합니다.
- 스키마: users, posts, likes, follows, hashtags, post_hashtags, bookmark_lists/items, XP 로그, 업적, 퀘스트 등 주요 테이블을 생성/보강합니다. 누락 컬럼은 서버 기동 시 `ALTER TABLE`로 추가합니다.
- 시드: 업적(예: first_post, posts_10 등)을 `INSERT OR IGNORE`로 주입.
- 접근 패턴: 라우트 모듈에서 `db.get/db.all/db.run`을 직접 사용합니다. 복잡한 쿼리는 해당 라우트 파일에 집중되어 있으므로, 새 기능은 동일 파일 내에서 DB 접근을 추가하고, 트랜잭션/외래키 제약을 고려합니다.

## 3. 프론트(public) 구조
- HTML 위치: 루트 `public/index.html` + `/public/html/*.html`(로그인/글쓰기/마이페이지/관리자 등).
- CSS 진입점: `/public/css/app.css` 한 파일을 링크합니다.
  - 내부 순서: tokens → base → vendor/bootstrap-overrides → shells → components → pages → themes (세부는 `public/css/ARCHITECTURE.md` 참고).
- JS 구조(주요 파일)
  - 공통: `public/js/header.js`(네비/로그인 상태), `public/js/utils.js`(fetch 래퍼/폼 헬퍼), `public/js/theme.js`(계절 테마 링크 교체).
  - 페이지 엔트리: `index.js`, `post.js`, `author.js`, `mypage.js`, `growth.js`, `admin.js`, `editor.js` 등 각 HTML과 1:1 매칭.
  - UI 조각: `postCard.js`, `bookmarkModal.js`, `igExport.js/igExportUI.js` 등 재사용 가능한 UI/동작 모듈.
- 에셋 로딩
  - Bootstrap CSS/JS는 CDN에서 로드 후, `app.css`가 GLS 스타일을 덮어씁니다.
  - 테마 CSS는 `<link id="seasonTheme" href="/css/gls/themes/winter-theme.css">`를 시작값으로 두고, `theme.js`가 body 클래스와 href를 교체합니다.

## 4. 새 기능/파일 추가 가이드
- 백엔드
  - 새 API: `routes/{feature}Routes.js`를 추가하고, `server.js`에서 `/api` 경로에 마운트합니다.
  - 인증이 필요한 경우 `authRequired`, 관리자만이면 `adminRequired`를 먼저 적용합니다.
  - DB가 필요하면 `db.js`에 스키마 추가(필요 시 `ALTER TABLE` 가드 포함) 후 해당 라우트에서 쿼리를 작성합니다.
- 프론트
  - CSS: `public/css/ARCHITECTURE.md`의 레이어 규칙을 따라 `gls/components`(재사용) 또는 `gls/pages`(페이지 한정)에 추가합니다. Bootstrap 클래스 override는 `vendor/bootstrap-overrides.css`에만 작성합니다.
  - JS: 페이지 전용 로직은 `/public/js/{page}.js`, 공유 UI는 기존 모듈(`postCard.js`, `bookmarkModal.js` 등) 옆에 새 파일을 만들어 import하거나 HTML에서 로드합니다.
  - HTML: 기존 페이지 패턴(부트스트랩 CDN + `/css/app.css` + 페이지별 JS)을 따라 `/public/html`에 추가합니다.

## 5. 주요 디렉터리 한눈에 보기
| 경로 | 설명 |
| --- | --- |
| `/server.js` | Express 엔트리, 미들웨어/라우트 연결 |
| `/routes/*.js` | 도메인별 API 라우트(auth/user/post/bookmark/growth/admin) |
| `/middleware/*.js` | 인증, 보안, rate limit, 관리자 HTML 가드 |
| `/db.js` | SQLite 초기화 및 스키마 관리 |
| `/public/` | 정적 HTML/CSS/JS/이미지 자산 |
| `/public/css/app.css` | 프론트 스타일 단일 진입점(import 체인) |
| `/public/js/*.js` | 페이지별 및 공통 JS 모듈 |
