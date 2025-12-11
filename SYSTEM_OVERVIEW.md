# 시스템 개요

이 문서는 현재 레포지토리의 서버 동작 흐름과 주요 컴포넌트를 요약해 전체 로직을 한눈에 볼 수 있도록 정리한 것입니다.

## 실행 진입점 및 공통 설정
- **진입점:** `server.js`에서 Express 앱을 생성하고 보안 헤더(CSP/helmet)와 CORS 설정을 적용한 뒤 JSON/URL-encoded 파서, 쿠키 파서, 캐시 방지 헤더를 설정합니다. 이후 정적 파일을 서빙하고 `/api` 하위에 인증·사용자·게시글 라우트를 연결하며, 루트 경로(`/`)는 `public/index.html`을 반환합니다.
- **환경/메일/토큰 설정:** `config.js`는 `.env`를 불러와 Gmail SMTP 트랜스포터와 JWT 비밀키를 준비합니다.
- **DB 초기화:** `db.js`에서 SQLite를 사용해 사용자, 게시글, 좋아요, 팔로우, 해시태그 및 게시글-해시태그 매핑 테이블을 생성합니다.

## 인증 및 계정 흐름 (`routes/authRoutes.js`)
- **회원가입 & 이메일 인증:** `/api/signup`은 사용자 정보를 저장하면서 이메일 인증 토큰을 생성해 발송합니다. `/api/verify-email`은 토큰 유효성을 검사해 인증 상태를 갱신합니다.
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
- **상세 & 좋아요:** `/api/posts/:id`는 단일 글과 좋아요 상태를 주고, `/api/posts/:id/toggle-like`는 좋아요 온/오프를 토글합니다. `/api/posts/:id/detail`은 작성자/좋아요/해시태그 정보를 포함한 상세 데이터를 반환합니다.

## 유틸리티와 보안
- **보안 미들웨어:** `middleware/security.js`가 helmet 기반 CSP, 허용 오리진 검증, CORS 설정을 적용합니다.
- **JWT 검증:** `middleware/auth.js`의 `authRequired`가 JWT 쿠키를 검증해 `req.user`에 디코딩 정보를 저장하며, `adminRequired`는 관리자 권한을 확인합니다.
- **해시태그 처리:** `utils/hashtags.js`는 해시태그 정규화 및 게시글-해시태그 매핑 저장/갱신을 담당합니다.

## 데이터베이스 스키마 요약
- `users`: 기본 프로필, 비밀번호, 관리자/인증 여부, 인증·재설정 토큰/만료 정보를 보관합니다.
- `posts`: 작성자, 제목, 내용, 생성 시각을 저장합니다.
- `likes`: 사용자-게시글 좋아요 매핑을 기록합니다.
- `follows`: 팔로워-팔로이 관계를 저장합니다.
- `hashtags`/`post_hashtags`: 해시태그 목록과 게시글-해시태그 연결을 관리합니다.
