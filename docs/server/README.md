# Server Docs By Feature

서버 문서를 API 기능 단위로 분리한 인덱스입니다.

---

## API Features

- 인증/계정: `docs/server/api/auth-account.md`
- 사용자/프로필/팔로우: `docs/server/api/users-follow.md`
- 게시글/피드/좋아요: `docs/server/api/posts-feed-likes.md`
- 북마크: `docs/server/api/bookmarks.md`
- 검색: `docs/server/api/search.md`
- 성장/퀘스트: `docs/server/api/growth-quests.md`
- 코스메틱/프로필 꾸미기: `docs/server/api/cosmetics-profile.md`
- 유료화/웹훅: `docs/server/api/monetization.md`
- 공유 이벤트: `docs/server/api/share-events.md`
- UX 이벤트: `docs/server/api/ux-events.md`
- 관리자 운영: `docs/server/api/admin-ops.md`

---

## Architecture

- 런타임 구조/라우팅: `docs/server/architecture/runtime-overview.md`
- DB/마이그레이션: `docs/server/architecture/database.md`

---

## Contracts / Runbooks

- 유료화 계약 v1: `docs/MONETIZATION_API_CONTRACT_V1.md`
- 유료화 운영 런북(Phase C): `docs/MONETIZATION_PHASEC_RUNBOOK.md`

---

## Conventions

- 응답 키: `snake_case`
- 성공 envelope: `{ ok: true, message, ... }`
- 실패 envelope: `{ ok: false, message, code? }`
- 기존 필드 변경/삭제 금지, 신규 필드만 추가 (backward compatible)
