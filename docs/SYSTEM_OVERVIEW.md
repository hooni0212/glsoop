# 시스템 개요

이 문서는 현재 레포지토리의 서버 동작 흐름과 주요 컴포넌트를 요약해 전체 로직을 한눈에 볼 수 있도록 정리한 것입니다.

## 실행 진입점 및 공통 설정
- **진입점:** `server.js`에서 Express 앱을 생성하고 보안 헤더(CSP/helmet)와 CORS 설정을 적용한 뒤 JSON/URL-encoded 파서, 쿠키 파서, 캐시 방지 헤더를 설정합니다. 이후 정적 파일을 서빙하고 `/api` 하위에 인증·사용자·게시글 라우트를 연결하며, 루트 경로(`/`)는 `public/index.html`을 반환합니다.
- **환경/메일/토큰 설정:** `config.js`는 `.env`를 불러와 Gmail SMTP 트랜스포터와 JWT 비밀키를 준비합니다.
  - **이메일 링크(중요):** 회원가입/비밀번호 재설정 메일에 들어가는 링크는 `utils/baseUrl.js`의 `getBaseUrl()`로 생성됩니다.
    - 배포 환경(특히 Nginx 리버스 프록시)에서는 요청 `Host`가 `127.0.0.1:3000`으로 들어올 수 있어, **메일 링크가 로컬호스트로 박히는 문제**가 생길 수 있습니다.
    - 운영에서는 `BASE_URL=https://www.glsoop.com`(또는 `PUBLIC_BASE_URL`)을 환경변수로 설정하는 것을 권장합니다.
    - 로컬 개발에서 메일 링크를 `localhost`로 유지하려면 `ALLOW_LOOPBACK_BASE_URL=1`을 설정하세요.
- **DB 초기화:** `db.js`에서 SQLite를 사용해 사용자, 게시글, 좋아요, 팔로우, 해시태그 및 게시글-해시태그 매핑 테이블을 생성합니다.

## 인증 및 계정 흐름 (`routes/authRoutes.js`)
- **회원가입 & 이메일 인증:** `/api/signup`은 사용자 정보를 저장하면서 이메일 인증 번호(OTP)를 생성해 발송합니다. `/api/verify-email`은 인증 번호 유효성을 검사해 인증 상태를 갱신하며, `/api/verify-email/resend`는 인증 번호를 재발송합니다.
- **비밀번호 재설정:** `/api/password-reset-request`가 재설정 링크를 이메일로 보내고, `/api/password-reset`이 토큰 검증 후 새 비밀번호를 저장합니다.
- **로그인/로그아웃:** `/api/login`은 비활성 사용자 검증 후 JWT를 httpOnly 쿠키로 발급하고, `/api/logout`은 쿠키를 삭제합니다. 로그인 검증은 `middleware/auth.js`의 `authRequired`가 처리합니다.
- **내 정보 관리:** `/api/me`는 프로필 및 팔로워/팔로잉 수를 반환하고, `/api/me/followings`는 팔로우 목록을, `/api/me` `PUT`은 프로필/소개 갱신을 제공합니다.

## 사용자 프로필과 팔로우 (`routes/userRoutes.js`)
- **공개 프로필 조회:** `/api/users/:id/profile`은 작가 정보, 글 수, 총 좋아요 수, 팔로워/팔로잉 수를 제공하며 요청자의 로그인/팔로우 상태를 함께 반환합니다.
- **팔로우 토글:** `/api/users/:id/follow`는 로그인 사용자가 다른 사용자를 팔로우/언팔로우하도록 처리하며 최신 팔로워 수를 함께 응답합니다.

## 게시글과 피드 (`routes/postRoutes.js`)
- **작성/수정:** `/api/posts`는 새 글을 저장하고 해시태그를 연결합니다. `/api/posts/:id` `PUT`은 작성자나 관리자만 수정할 수 있으며 해시태그 매핑을 갱신합니다.
- **목록:** `/api/posts/my`는 내가 쓴 글을, `/api/posts/liked`는 내가 좋아요한 글을 반환합니다.
- **피드 & 검색:** `/api/posts/feed`는 최신 글을, `/api/posts/:id/related`는 동일 해시태그 기반 관련 글을 제공합니다.
- **상세 & 좋아요:** `/api/posts/:id`는 공개 상세 데이터를 반환하며 작성자/좋아요/해시태그/user_liked 정보를 포함합니다. `/api/posts/:id/edit`은 작성자만 접근 가능한 편집용 조회(authRequired)이고, `/api/posts/:id/toggle-like`는 좋아요 온/오프를 토글합니다.

## 유틸리티와 보안
- **보안 미들웨어:** `middleware/security.js`가 helmet 기반 CSP, 허용 오리진 검증, CORS 설정을 적용합니다.
- **JWT 검증:** `middleware/auth.js`의 `authRequired`가 JWT 쿠키를 검증해 `req.user`에 디코딩 정보를 저장하며, `adminRequired`는 관리자 권한을 확인합니다.
- **요청 사용자 파싱:** `utils/requestUser.js`가 JWT 쿠키에서 로그인 사용자의 페이로드/ID를 추출합니다. 로그인 여부가 선택적인 피드·프로필 API에서 중복 코드를 줄이는 데 사용됩니다.
- **해시태그 처리:** `utils/hashtags.js`는 해시태그 정규화 및 게시글-해시태그 매핑 저장/갱신을 담당합니다.

## 데이터베이스 스키마 요약
- `users`: 기본 프로필, 비밀번호, 관리자/인증 여부, 인증·재설정 토큰/만료 정보를 보관합니다.
- `posts`: 작성자, 제목, 내용, 생성 시각을 저장합니다.
- `likes`: 사용자-게시글 좋아요 매핑을 기록합니다.
- `follows`: 팔로워-팔로이 관계를 저장합니다.
- `hashtags`/`post_hashtags`: 해시태그 목록과 게시글-해시태그 연결을 관리합니다.

## 함수 카탈로그 (어디서 무엇을 하는지 빠르게 찾기)

### 서버 유틸리티·미들웨어
- `middleware/auth.js`
  - `authRequired(req, res, next)`: JWT 쿠키를 검증해 `req.user`에 사용자 정보를 적재합니다. 모든 인증된 API 라우트(피드, 글쓰기, 프로필 수정 등) 앞단에서 사용됩니다. 사용 페이지: 로그인 후 접근하는 모든 보호된 화면.
  - `adminRequired(req, res, next)`: `req.user.isAdmin` 여부를 확인해 관리자 전용 API 접근을 제한합니다. 사용 페이지: `/html/admin.html`.
- `utils/requestUser.js`
  - `getViewerFromRequest(req)`: JWT 쿠키를 해석해 로그인 사용자의 전체 페이로드를 반환합니다(실패 시 `null`).
  - `getViewerId(req)`: 쿠키에서 사용자 ID만 꺼내야 할 때 사용합니다. 팔로우·피드 API에서 선택적 로그인 처리를 단순화합니다.
- `utils/hashtags.js`
  - `normalizeHashtagName(raw)`: 입력된 문자열에서 `#` 제거, 공백/길이 정리, 소문자화하여 저장 가능한 해시태그로 변환합니다. 사용 페이지: 글 작성/수정 화면(`/html/editor.html`).
  - `saveHashtagsForPostFromInput(postId, hashtagsInput, callback)`: 게시글과 연관된 해시태그를 재저장합니다. 기존 매핑 삭제 → 새 태그 생성 → 매핑 저장 순으로 처리하며, 글 작성·수정 API가 호출합니다.

### 클라이언트 공통/레이아웃 스크립트
- `public/js/header.js`
  - `updateHeader()`: `/api/me`로 로그인 여부를 확인해 네비게이션 바의 로그인/로그아웃 상태를 토글합니다. 사용 페이지: 모든 HTML 상단 헤더.
  - `handleLogout()`: `/api/logout` 호출 후 홈으로 리다이렉트합니다. 사용 페이지: 헤더에서 로그아웃 버튼이 노출되는 모든 화면.
- `public/js/seasonal.js`
  - `setupSnowBackground()`: `.winter-theme` 루트에 겨울 눈 배경을 추가하고, 스크롤에 따른 가시성을 조정합니다. 사용 페이지: 겨울 테마를 적용한 모든 화면.
- `public/js/falling.js`
  - `setupSnowBackground()`: `#snow-container`에 랜덤 눈 송이를 만들어 떨어뜨립니다. 사용 페이지: 계절 테마가 없는 기본 홈(`/index.html`) 및 단일 페이지에서 눈 효과를 켜고 싶을 때.

### 클라이언트 페이지별 스크립트
- `public/js/index.js` (홈 피드)
  - `init()`: 태그 파싱 → 피드 초기화 → 필터 UI/히어로 CTA 설정을 순차 실행합니다. 사용 페이지: `/index.html`.
  - `parseTagsFromURL()`: URL 쿼리에서 해시태그 필터를 읽어옵니다.
  - `initFeed()`: 첫 피드 로드와 스크롤 이벤트 바인딩을 담당합니다.
  - `handleFeedScroll()`: 스크롤이 끝에 가까워지면 추가 로드를 트리거합니다.
  - `loadMoreFeed()`: `/api/posts/feed`를 호출해 글을 받아오고 로딩/종료 상태를 갱신합니다.
  - `renderFeedPosts(posts)`: 받은 글을 카드로 렌더링합니다.
  - `setupCardInteractions(card, post)`: 카드 클릭 시 글 상세/작가 페이지 이동과 좋아요 토글을 묶습니다.
  - `handleLikeClick(likeBtn)`: `/api/posts/:id/toggle-like`로 좋아요를 토글합니다.
  - `applyTagFilter(tag)`, `renderTagFilterBar()`, `clearTagFilters()`, `removeTagFilter(tag)`: 상단 해시태그 필터 UI를 관리합니다.
  - `setupHeroCtaLeaves()`: 메인 히어로 CTA 버튼 잎사귀 장식을 배치합니다.
- `public/js/post.js` (글 상세)
  - `initPostDetailPage()`: 게시글 상세 데이터를 로드하고 카드/해시태그/관련 글 섹션을 준비합니다. 사용 페이지: `/html/post.html`.
  - `setupCardAuthorLink(card, post)`, `setupCardInteractions(card, post)`: 상세 카드 내부의 작가/좋아요/태그 인터랙션을 설정합니다.
  - `renderPostDetail(container, post)`: 본문, 메타 정보, 해시태그를 포함한 상세 화면을 그립니다.
  - `setupHashtagSearch(scopeEl)`: 해시태그 클릭 시 필터 검색으로 이동시키는 핸들러를 설정합니다.
  - `loadRelatedPosts(currentPost)`: `/api/posts/:id/related` 호출 후 관련 글을 불러옵니다.
  - `buildRelatedPostCardHTML(post)`, `renderRelatedPosts(box, posts, currentPostId)`: 관련 글 카드 HTML 생성 및 렌더링을 담당합니다.
- `public/js/postCard.js` (공통 글 카드)
  - `buildAuthorDisplay(post)`: 카드 상단 작가명/이메일 마스크를 조합합니다. 홈/마이페이지/작가 페이지 모두에서 사용.
  - `extractContentWithFont(post)`: 본문에서 글꼴 태그를 추출해 표시 글꼴을 결정합니다.
  - `buildStandardPostCardHTML(post, options)`: 좋아요/태그/본문 요약이 포함된 표준 카드 HTML을 만듭니다.
  - `enhanceStandardPostCard(cardElement, post)`: 카드에 좋아요/해시태그/프로필 이동 핸들러를 부착합니다.
  - `toggleLike(postId, likeBtn)`: 좋아요 토글 API를 호출 후 버튼 상태를 업데이트합니다.
  - `setupCardAuthorLink(cardEl, post)`, `setupCardInteractions(cardEl, post)`: 카드 클릭 시 작가/상세 이동 및 좋아요 버튼 처리.
- `public/js/header.js` (공통 헤더)
  - `updateHeader()`, `handleLogout()`: 위 “클라이언트 공통/레이아웃 스크립트” 참고.
- `public/js/login.js` (로그인)
  - DOMContentLoaded 리스너 내부에서 로그인 폼 제출을 가로채 `/api/login`을 호출하고 성공 시 마이페이지로 이동합니다. 사용 페이지: `/html/login.html`.
- `public/js/signup.js` (회원가입)
  - 폼 제출을 가로채 `/api/signup` 요청 후 이메일 인증 안내를 표시합니다. 사용 페이지: `/html/signup.html`.
- `public/js/forgot-password.js` & `public/js/reset-password.js`
  - 재설정 요청/실행 폼을 전송하여 `/api/password-reset-request`, `/api/password-reset`을 호출합니다. 사용 페이지: `/html/forgot-password.html`, `/html/reset-password.html`.
- `public/js/editor.js` (글 작성/수정)
  - 해시태그 정규화(`normalizeTag`), 입력 동기화(`syncHashtagInputFromList`), 프리뷰 업데이트(`updatePreview`) 등 작성기를 구동합니다. 사용 페이지: `/html/editor.html`.
- `public/js/mypage.js` (마이페이지)
  - `loadMyPage()`: 프로필/팔로잉/내 글/좋아요 글을 순차 로드합니다. 탭 전환(`switchMyPageTab`), 카드 렌더링(`renderPostCard`), 팔로잉 렌더링(`renderFollowingCard`), 편집/팔로우 이벤트 설정까지 담당합니다. 사용 페이지: `/html/mypage.html`.
- `public/js/author.js` (작가 페이지)
  - `initAuthorPage()`: 작가 프로필과 글 목록을 초기화합니다.
  - `loadAuthorProfile(authorId)`: 작가 정보를 요청해 카드와 팔로우 버튼 상태를 업데이트합니다.
  - `handleAuthorFollowToggle()`: `/api/users/:id/follow`로 팔로우 상태를 토글합니다.
  - `handleAuthorScroll()`/`loadMoreAuthorPosts()`: 무한 스크롤 기반으로 작가 글을 더 불러옵니다.
  - `renderAuthorPosts(posts)`, `setupAuthorPostInteractions(card)`: 작가 글 카드를 그리거나 인터랙션을 부착합니다.
  - `buildHashtagHtml(post)`: 작가 페이지 전용 해시태그 리스트를 만듭니다.
  - `setupAuthorProfileSticky()` 및 내부 `captureBaseRect`/`resetProfileCardStyle`/`handleStickyScroll()`: 좌측 프로필 카드의 sticky 동작을 제어합니다.
- `public/js/admin.js` (관리자 대시보드)
  - `init()`: 관리자 인증 확인 → 사용자 목록/게시글 목록 로딩을 시작합니다. 사용 페이지: `/html/admin.html`.
  - `fetchMeAsAdmin()`: `/api/me`로 관리자 여부를 검증합니다.
  - `loadUsers(usersBox)`, `buildUsersTableHtml(users)`, `handleUserTableClick(...)`: 사용자 목록 출력과 정지/활성 토글을 처리합니다.
  - `loadPosts(postsBox)`, `buildPostsHtml(posts)`, `handlePostListClick(...)`: 게시글 목록을 표시하고 삭제/검색을 처리합니다.
- `public/js/utils.js` (공통 유틸)
  - `autoAdjustQuoteFont(el)`: 따옴표가 포함된 글의 폰트를 자동 조정합니다.
  - `maskEmail(email)`: 이메일을 마스킹해 UI에 표시합니다.
  - `escapeHtml(str)`: XSS 방지용 HTML 이스케이프.
  - `formatKoreanDateTime(value)`: 날짜를 한국어 형태로 포맷팅합니다.
- `extractFontFromContent(html)`: 본문 내 폰트 태그를 파싱해 대표 폰트를 추출합니다.
- `buildHashtagHtml(source)`: 서버/클라이언트 해시태그 배열에서 태그 HTML을 생성합니다.

## 모달 시스템 (GLS vs Bootstrap)
- **동작 책임(필수 확인):** 자바스크립트 동작은 모두 GLS(`public/js/header.js`의 `glsModal`)가 담당하며, **Bootstrap의 `data-bs-*` 속성이나 JS 초기화는 사용하지 않습니다.**
- **열기/닫기 방법:** 트리거는 `data-gls-toggle="modal"` + `data-gls-target="#modalId"`를 사용하고, 닫기는 `data-gls-dismiss="modal"` 또는 `.gls-modal-close` 클래스를 사용합니다. ESC, 백드롭 클릭, 포커스 관리, 스크롤 잠금/패딩 보정은 GLS가 처리합니다.
- **레이아웃/스타일 역할:** `.modal`, `.modal-dialog`, `.modal-content` 등 기본 골격은 Bootstrap CSS를 이용하되, 시각 언어(유리/블러/그림자/간격)는 `public/css/vendor/bootstrap-overrides.css`와 `public/css/components/modals.css`에서 GLS 토큰에 맞춰 커스텀합니다.
- **새 모달 작성 시 가이드:** 위 규약을 지키면 정적·동적 모달 모두 동일한 방식으로 동작합니다. Bootstrap의 `data-bs-toggle/target`을 혼용하지 말고, 닫기 버튼에 GLS 전용 속성을 반드시 포함하세요.
