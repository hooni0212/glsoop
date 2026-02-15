# UI/UX P2 Sequential Roadmap (branch: feature/uiux-p2-sequential-hardening)

## Goal
- 에디터 작성 이탈을 줄이고, 인증/액션/모바일/접근성 UX를 일관된 기준으로 고도화한다.
- 작업 범위: `public/html/*`, `public/js/*`, `public/css/*` (프론트 UI/UX 중심)
- 실행 방식: 단계별 세부 계획 수립 후, 단계별 구현/검증/커밋을 순차 진행한다.

## Current Baseline
- 기준 브랜치: `dev`
- 직전 UI/UX 작업 반영 상태:
  - 인증 후 작성 진입 흐름 개선 (`verify-email -> login -> editor`)
  - 인증 필요 액션(`like/bookmark/follow`)의 `next` 복귀 경로 일부 보강
- 남은 핵심 개선:
  - 에디터 초안 보존/복구 미구현
  - auth form의 `alert` 기반 오류 노출 혼재
  - 액션 피드백(로딩/성공/실패) UI 불일치
  - 마이페이지/북마크 모바일 상호작용 가독성 보완 필요
  - 접근성(focus-visible, aria-live, 오류 포커스) 일관화 필요

## Work Scope (P2)
1. 에디터 이탈 방지
- localStorage 초안 자동 저장
- 재진입 시 초안 복구 UX
- 미저장 상태 이탈 경고(`beforeunload`)

2. 폼 UX 정리 (alert 제거)
- 대상: `login`, `signup`, `verify-email`, `forgot-password`, `reset-password`
- 인라인 오류 메시지 + 상단 노티스/토스트 방식으로 통일

3. 좋아요/북마크/팔로우 피드백 통일
- 대상: `index`, `postCard`, `author`, `bookmarkModal`, `bookmarks`
- 공통 로딩 상태/완료 메시지/오류 메시지와 버튼 처리 일관화

4. 마이페이지/북마크 모바일 IA 개선
- 탭 터치 타깃/가독성 개선
- 빈 상태 CTA 레이아웃 보강
- 탭 영역 sticky 처리와 스크롤 사용성 개선

5. 접근성 패스
- `:focus-visible` 스타일 보강
- `aria-live`/`role=alert` 적절한 적용
- 폼 오류 발생 시 오류 요소/필드로 포커스 이동
- 대비 저하 구간 보정

## Working Files
- JS
  - `public/js/editor.js`
  - `public/js/login.js`
  - `public/js/signup.js`
  - `public/js/verify-email.js`
  - `public/js/forgot-password.js`
  - `public/js/reset-password.js`
  - `public/js/index.js`
  - `public/js/postCard.js`
  - `public/js/author.js`
  - `public/js/bookmarkModal.js`
  - `public/js/bookmarks.js`
  - `public/js/mypage.js`
  - `public/js/utils.js`
- HTML
  - `public/html/login.html`
  - `public/html/signup.html`
  - `public/html/verify-email.html`
  - `public/html/forgot-password.html`
  - `public/html/reset-password.html`
  - `public/html/mypage.html`
  - `public/html/bookmarks.html`
- CSS
  - `public/css/pages/editor.css`
  - `public/css/pages/login.css`
  - `public/css/pages/mypage.css`
  - `public/css/pages/bookmarks.css`
  - `public/css/base.css`
  - `public/css/components/*.css` (필요 시)

## Execution Plan
- [ ] Step 1. 실행 계획 문서 수립 및 기준 확정
- [ ] Step 2. 에디터 이탈 방지(초안 자동저장/복구/이탈 경고) 구현
- [ ] Step 3. auth form `alert` 제거 및 인라인 오류/노티스 통일
- [ ] Step 4. 좋아요/북마크/팔로우 액션 피드백 공통화
- [ ] Step 5. 마이페이지/북마크 모바일 IA 개선
- [ ] Step 6. 접근성 패스 적용
- [ ] Step 7. 전반 코드 리뷰 + 회귀/오류 테스트 + 보완
- [ ] Step 8. `dev` 머지 및 브랜치 정리

## Commit Strategy
- 단계별 최소 1커밋 원칙 (한글 커밋 메시지)
- 예상 커밋 시퀀스:
  1) 계획 수립 문서
  2) 에디터 이탈 방지
  3) auth form UX 통일
  4) 액션 피드백 공통화
  5) 모바일 IA 개선
  6) 접근성 패스
  7) 테스트 보완/최종 정리 (필요 시)

## Verification Plan
- 정적 검증:
  - `node --check` 대상 JS 파일 전체 실행
- 자동 테스트:
  - `npx playwright test tests/e2e/ux-events-api.spec.js --project=desktop-chrome`
  - `npx playwright test tests/e2e/account-menu.spec.js --project=desktop-chrome`
  - 필요 시 UI 회귀 스냅샷/관련 spec 추가 실행
- 수동 점검:
  - 모바일 뷰포트(탭/CTA/focus 이동)
  - auth form 오류/성공 플로우
  - 에디터 초안 복구/이탈 경고

## Definition of Done
- 에디터 작성 이탈 시 초안이 복구 가능하고, 실수 이탈이 방지된다.
- auth form에서 흐름을 끊는 `alert` 의존이 제거되고 인라인/노티스 UX가 일관된다.
- 좋아요/북마크/팔로우 액션의 로딩/결과 피드백이 화면별로 동일하게 동작한다.
- 마이페이지/북마크 모바일 사용성이 개선되고 탭/빈상태 CTA가 명확하다.
- 접근성 핵심 항목(focus-visible, aria-live, 오류 포커스)이 반영된다.
- 테스트 및 문법 검증 통과 후 `dev`에 머지된다.
