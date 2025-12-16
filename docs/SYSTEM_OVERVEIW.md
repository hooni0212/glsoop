# 시스템 개요 (오타 호환 버전)

> **참고:** 이 문서는 원본 `docs/SYSTEM_OVERVIEW.md`의 주요 내용을 축약해 담고 있으며, 글 관련 라우트 계약을 최신 코드에 맞춰 다시 명시합니다. 일부 자동화된 링크에서 잘못된 파일명을 참조할 수 있어, 동일 정보를 여기에도 제공해 혼선을 줄입니다.

## 게시글 라우트 핵심 요약 (`routes/postRoutes.js`)
- **공개 상세:** `GET /api/posts/:id` — 누구나 볼 수 있는 상세 정보로, 작성자/좋아요/해시태그/user_liked 상태를 포함합니다.
- **편집용 조회:** `GET /api/posts/:id/edit` — 작성자만 접근할 수 있는 편집 전용 데이터 조회로, `authRequired`가 적용됩니다.
- **레거시 호환:** `GET /api/posts/:id/detail` — 공개 상세와 동일 응답을 제공하는 임시 alias입니다(향후 제거 예정).
- **좋아요 토글:** `POST /api/posts/:id/toggle-like` — 로그인 사용자가 좋아요 온/오프를 전환합니다.

## 기타 흐름 안내
- **목록/피드:** `/api/posts/feed`는 최신 글 피드를, `/api/posts/my`와 `/api/posts/liked`는 각각 내 글과 좋아요한 글 목록을 제공합니다.
- **작성·수정:** `POST /api/posts`로 글을 생성하고, `PUT /api/posts/:id`는 작성자나 관리자가 글과 해시태그 매핑을 수정합니다.
- **관련 글:** `/api/posts/:id/related`는 동일 해시태그 기반으로 관련 게시글을 반환합니다.

추가 세부 사항은 원본 문서(`docs/SYSTEM_OVERVIEW.md`)를 참고하세요.
