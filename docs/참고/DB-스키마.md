# DB 스키마 참고

- 문서 타입: `Overview`
- 적용 범위: `glsoop/docs/참고/DB-스키마.md`
- 대상 독자: 서버 개발자, QA
- 상태: `Draft`
- 최종 업데이트: `2026-03-04`
- Owner: `taehun`
- 관련 문서:
  - `docs/참고/시스템-개요.md`
  - `docs/서버/API/인증-계정.md`

---

## 1. 문서 목적

이 문서는 운영/개발 시 자주 참조하는 핵심 테이블과 인증 관련 마이그레이션 포인트를 요약한다.

## 2. 빠른 시작 경로

1. 인증 세션 테이블 확인
2. 리셋 토큰 해시 컬럼 확인
3. API 계약 문서와 교차 검증

## 3. 핵심 용어

- 세션 테이블: 토큰 `sid`와 서버 세션 상태를 관리하는 테이블.
- 마이그레이션: 스키마 변경을 순차 적용하는 SQL 스크립트.
- 해시 저장: 원문 토큰 대신 해시를 저장하는 보안 방식.

## 4. 읽는 순서

1. 최근 마이그레이션
2. 인증 관련 테이블
3. 사용자/게시글 기본 테이블

## 5. 관련 문서 맵

- 시스템 개요: `docs/참고/시스템-개요.md`
- 인증 API: `docs/서버/API/인증-계정.md`
- 인증 정책: `docs/서버/API/인증-쿠키-세션-정책.md`

---

## 최근 인증 마이그레이션

- `migrations/0013_create_auth_sessions_security.sql`
- `migrations/0014_auth_preferences_reset_token_hash.sql`
- `migrations/0015_signup_legal_consents.sql`

## 동의 이력 관련 테이블

- `user_consent_events`
  - 목적: 약관/개인정보/마케팅 동의 상태 변경 이력을 사용자 단위로 보관
  - 핵심 컬럼:
    - `user_id`
    - `consent_type` (`terms` | `privacy` | `marketing`)
    - `consent_version`
    - `is_granted`
    - `source` (`signup` | `mypage`)
    - `ip_hash`, `user_agent`, `created_at`

## 사용자/가입 확장 컬럼

- `users`
  - `marketing_email_opt_in`
  - `marketing_opt_in_updated_at`
- `pending_signups`
  - `age_confirmed`
  - `terms_version`
  - `privacy_version`
  - `marketing_version`
  - `marketing_email_opt_in`
  - `consent_ip_hash`
  - `consent_user_agent`
  - `consent_recorded_at`

## 게시글 확장 컬럼

- `posts`
  - `layout_json` (TEXT, nullable, optional)
  - 용도: 피드/공유 이미지 렌더 시 제목/본문/푸터 텍스트 박스 좌표를 사용자 지정으로 고정
  - 기본 스키마: `layout_version:1`, `unit:"normalized"`, `text_box`(필수), `title_box`/`footer_box`(선택)
  - 호환성: `NULL`이면 기존 자동 레이아웃 프리셋 로직을 그대로 사용
  - 예시(JSON 문자열 저장):
    - `{"layout_version":1,"unit":"normalized","text_box":{"x":0.336,"y":0.364,"w":0.424,"h":0.346,"align":"center","font_scale":1,"line_height":1.15},"title_box":{"x":0.336,"y":0.256,"w":0.424,"h":0.122},"footer_box":{"x":0.78,"y":0.9,"w":0.16,"h":0.06}}`
