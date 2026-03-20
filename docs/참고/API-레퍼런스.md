# 글숲 서버 API 레퍼런스

- 문서 타입: `Overview`
- 적용 범위: `glsoop/docs/참고/API-레퍼런스.md`
- 대상 독자: 서버/웹/모바일 개발자, QA
- 상태: `Draft`
- 최종 업데이트: `2026-03-04`
- Owner: `taehun`
- 관련 문서:
  - `docs/서버/API/인증-계정.md`
  - `docs/서버/API/인증-쿠키-세션-정책.md`

---

## 1. 문서 목적

이 문서는 서버 API의 공통 규칙과 핵심 엔드포인트를 빠르게 조회하기 위한 인덱스다.

## 2. 빠른 시작 경로

1. 인증 계약 확인: `docs/서버/API/인증-계정.md`
2. 인증 쿠키/세션 정책 확인: `docs/서버/API/인증-쿠키-세션-정책.md`
3. 상세 구현은 `routes/authRoutes.js`, `routes/postRoutes.js`에서 확인

## 3. 핵심 용어

- Base Path: API 기본 경로(`/api`).
- Auth Required: 인증 쿠키/JWT가 필수인 구간.
- Sunset: 레거시 정책의 종료 시점.

## 4. 읽는 순서

1. 공통 규칙
2. 인증/계정 API
3. 세션/보안 정책
4. 도메인별 상세 API

## 5. 관련 문서 맵

- 인증 계약: `docs/서버/API/인증-계정.md`
- 세션 정책: `docs/서버/API/인증-쿠키-세션-정책.md`
- DB 참고: `docs/참고/DB-스키마.md`
- 시스템 개요: `docs/참고/시스템-개요.md`

---

## 공통 규칙

- 응답 기본 형태:
  - 성공: `{ ok: true, message, ... }`
  - 실패: `{ ok: false, message, code }`
- 인증 구간은 쿠키 기반 세션 검증을 우선한다.
- 레거시 토큰은 sunset 일정 이후 차단한다.

## 핵심 엔드포인트

- `POST /api/login`
- `POST /api/logout`
- `POST /api/logout-all`
- `GET /api/me`
- `GET /api/me/sessions`
- `POST /api/password-reset/validate`

## 게시글 레이아웃(`layout_json`) 계약 (2026-03-04)

- `posts.layout_json`은 선택 필드이며, 없으면 서버 렌더러는 기존 자동 preset 로직을 그대로 사용한다.
- `POST /api/posts`, `PUT /api/posts/:id`는 `layout_json`(또는 `layout`)을 객체/JSON 문자열로 받고, 서버는 TEXT(JSON.stringify)로 저장한다.
- 서버 write 시 `unit` 누락은 `"normalized"`로 정규화 저장하고, `unit !== "normalized"`이면 HTTP `400` + `레이아웃 데이터가 올바르지 않습니다.`를 반환한다.
- 서버 read 응답은 저장된 `layout_json` 문자열을 그대로 반환한다(기존 필드 계약 불변).
- 렌더러 parse 시 `unit` 누락(legacy 데이터)은 `"normalized"`로 간주하며, 지원 불가 `unit` 값이면 `layout_json`을 무시하고 legacy preset으로 fallback 한다.

```json
{
  "layout_version": 1,
  "unit": "normalized",
  "text_box": { "x": 0.336, "y": 0.364, "w": 0.424, "h": 0.346, "align": "center", "font_scale": 1, "line_height": 1.15 },
  "title_box": { "x": 0.336, "y": 0.256, "w": 0.424, "h": 0.122, "align": "center", "font_scale": 1, "line_height": 1.15 },
  "footer_box": { "x": 0.78, "y": 0.90, "w": 0.16, "h": 0.06, "align": "right", "font_scale": 1, "line_height": 1.1 }
}
```

## editor2 로컬 Draft 키/삭제 규칙 (2026-03-04)

- Create 키: `glsoop:editor2:draft:create:u:{userIdOrAnon}`
- Edit 키: `glsoop:editor2:draft:edit:{postId}:u:{userIdOrAnon}`
- 충돌 방지: 같은 브라우저 다중 계정 충돌을 막기 위해 키에 `u:{id}`를 포함한다.
- 삭제 규칙:
  - Create draft는 최초 `POST /api/posts` 성공 직후 즉시 삭제.
  - Edit draft는 `PUT /api/posts/:id` 성공 후 baseline과 일치하면 삭제.
  - 사용자 수동 `초안 삭제` 클릭 시 즉시 삭제.
  - 다른 사용자 토큰으로 식별된 draft는 복구하지 않고 삭제.
  - 30일 이상 지난 editor2 draft는 페이지 진입 시 정리.

## 검색/공유 API 관측 로그 정책 (2026-03-04)

- `GET /api/search`, `POST /api/share-events`는 응답 계약을 바꾸지 않고 서버 로그 관측만 추가한다.
- 로그 필드 표준: `path`, `status`, `method`, `authenticated`, `ts`.
- 목적은 삭제가 아니라 사용량 판단이며, 14일 연속 무사용 + 내부 호출 없음일 때만 deprecate 후보로 분류한다.
