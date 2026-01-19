# 글숲 Server API Reference

> 기준: `server.js` 라우팅 구성
>
> - API Base: `/api`
> - Admin API Base: `/api/admin`
>
> 표기
>
> - **public**: 로그인 없이 호출 가능
> - **auth**: 로그인 필요 (`authRequired`)
> - **admin**: 관리자 권한 필요 (`authRequired` + `adminRequired`)
>
> 응답 규칙
>
> - 성공/실패 모두 `ok`, `message` 필드를 포함합니다.
> - 복합 단어 키는 `snake_case`로 통일합니다.

---

## 0) Admin Page (HTML)

- `GET /admin` (**admin**) — 관리자 페이지 진입점 (admin.html)
- `GET /html/admin.html` (**blocked**) — 직접 접근은 항상 404 (의도적으로 차단)

---

## 1) Auth / Account (`/api`)

- `POST /api/signup` (**public**) — 회원가입 + 이메일 인증 메일 발송
- `POST /api/verify-email` (**public**) — 이메일 인증 번호(OTP) 검증
- `POST /api/verify-email/resend` (**public**) — 이메일 인증 번호(OTP) 재발송
- `POST /api/password-reset-request` (**public**) — 비밀번호 재설정 메일 요청
- `POST /api/password-reset` (**public**) — 비밀번호 재설정 처리
- `POST /api/login` (**public**) — 로그인
- `POST /api/logout` (**public**) — 로그아웃
- `GET /api/me` (**auth**) — 내 정보 조회
- `PUT /api/me` (**auth**) — 내 정보 수정
- `GET /api/me/followings` (**auth**) — 내가 팔로우 중인 사용자 목록

---

## 2) Users / Follow (`/api`)

- `GET /api/users/:id/profile` (**public**) — 작가 공개 프로필
- `GET /api/users/:id/posts` (**public**) — 특정 작가의 글 목록 (무한스크롤)

팔로우
- `POST /api/users/:id/follow` (**auth**) — 팔로우/언팔로우 토글

---

## 3) Posts / Feed / Likes (`/api`)

작성/수정/삭제
- `POST /api/posts` (**auth**) — 글 작성
- `PUT /api/posts/:id` (**auth**) — 글 수정
- `DELETE /api/posts/:id` (**auth**) — 글 삭제

내 글/좋아요
- `GET /api/posts/my` (**auth**) — 내가 쓴 글 목록
- `GET /api/posts/liked` (**auth**) — 내가 좋아요한 글 목록

피드/목록
- `GET /api/posts/feed` (**public**) — 피드
- `GET /api/posts` (**public**) — 글 목록 (필터/정렬/페이징 포함)

상세/편집/관련
- `GET /api/posts/:id` (**public**) — 글 상세
- `GET /api/posts/:id/edit` (**auth**) — 편집 화면용 데이터
- `GET /api/posts/:id/related` (**public**) — 관련 글

좋아요
- `POST /api/posts/:id/toggle-like` (**auth**) — 좋아요 토글

---

## 4) Bookmarks (`/api`)

북마크 폴더
- `GET /api/bookmarks/lists` (**auth**) — 내 북마크 폴더 목록
- `POST /api/bookmarks/lists` (**auth**) — 폴더 생성
- `PATCH /api/bookmarks/lists/:listId` (**auth**) — 폴더 수정
- `DELETE /api/bookmarks/lists/:listId` (**auth**) — 폴더 삭제

폴더 내 글
- `GET /api/bookmarks/lists/:listId/items` (**auth**) — 폴더 내 글 목록
- `POST /api/bookmarks/lists/:listId/items` (**auth**) — 폴더에 글 추가
- `DELETE /api/bookmarks/lists/:listId/items/:postId` (**auth**) — 폴더에서 글 제거

글 기준(내 폴더들 중 어디에 담겼는지)
- `GET /api/posts/:postId/bookmarks` (**auth**) — 특정 글이 담긴 내 폴더 목록

---

## 5) Growth / Achievements / Quests (`/api`)

- `GET /api/growth/summary` (**auth**) — 성장 요약
- `GET /api/growth/achievements` (**auth**) — 업적 진행/해제 현황
- `GET /api/quests/active` (**auth**) — 활성 퀘스트(캠페인) 조회

---

## 6) Admin API (`/api/admin`)

헬스 체크
- `GET /api/admin/` (**admin**) — admin API 연결 확인

Users
- `GET /api/admin/users` (**admin**) — 회원 목록(검색/필터/정렬/페이지)
- `DELETE /api/admin/users/:id` (**admin**) — 회원 삭제(관련 데이터 포함)

Posts
- `GET /api/admin/posts` (**admin**) — 글 목록(검색/필터/정렬/페이지)
- `GET /api/admin/posts/:id` (**admin**) — 글 상세
- `DELETE /api/admin/posts/:id` (**admin**) — 글 삭제(좋아요/북마크 아이템 정리 포함)

Quest Templates
- `GET /api/admin/quest-templates` (**admin**) — 템플릿 목록
- `POST /api/admin/quest-templates` (**admin**) — 템플릿 생성
- `PUT /api/admin/quest-templates/:id` (**admin**) — 템플릿 수정
- `DELETE /api/admin/quest-templates/:id` (**admin**) — 템플릿 삭제

Quest Campaigns
- `GET /api/admin/quest-campaigns` (**admin**) — 캠페인 목록
- `POST /api/admin/quest-campaigns` (**admin**) — 캠페인 생성
- `PUT /api/admin/quest-campaigns/:id` (**admin**) — 캠페인 수정
- `DELETE /api/admin/quest-campaigns/:id` (**admin**) — 캠페인 삭제
- `PUT /api/admin/quest-campaigns/:id/items` (**admin**) — 캠페인 아이템(템플릿 연결) 업데이트
