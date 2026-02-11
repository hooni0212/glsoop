# Bookmarks API

기준 라우트: `routes/bookmarkRoutes.js`

Base: `/api`

---

## Endpoints

북마크 폴더:

- `GET /bookmarks/lists` (auth)
- `GET /bookmarks/lists/recent` (auth)
- `POST /bookmarks/lists` (auth)
- `PATCH /bookmarks/lists/:listId` (auth)
- `DELETE /bookmarks/lists/:listId` (auth)

폴더 내 글:

- `GET /bookmarks/lists/:listId/items` (auth)
- `POST /bookmarks/lists/:listId/items` (auth)
- `DELETE /bookmarks/lists/:listId/items/:postId` (auth)

글 기준 조회:

- `GET /posts/:postId/bookmarks` (auth)

---

## 핵심 규칙

- 폴더 이름은 사용자 단위 unique
- 동일 폴더 내 중복 글 추가 방지
- recent API는 모바일 상세 모달 초기 진입 최적화 용도

---

## 데이터 모델 연결

- `bookmark_lists`
- `bookmark_items`

---

## 관련 문서

- 게시글 API: `docs/server/api/posts-feed-likes.md`
