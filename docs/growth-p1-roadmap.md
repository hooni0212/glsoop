# Growth P1 Roadmap (branch: feature/growth-p0-uiux-e2e-seed-fix)

## Goal
- P0 UI/UX 개선 이후, growth API 호출/서버 로직/테스트를 P1 수준으로 안정화한다.
- 대상 레포: `/Users/gimtaehun/2026/workspace/projects/glsoop`

## Current Baseline
- P0 UI/UX 반영 커밋: `97c6e23`, `99c331a`
- 핵심 변경 파일:
  - `public/html/growth.html`
  - `public/js/growth.js`
  - `public/css/pages/growth.css`

## Work Scope (P1)
1. API 통합
- 신규 엔드포인트: `GET /api/growth/dashboard`
- 기존 3회 호출(요약/업적/활성퀘스트) 기반 데이터를 1회 응답으로 통합

2. XP/보상 지급 경로 정리
- `POST /api/quests/:stateId/claim`의 XP 반영 로직을 `utils/growth.js` 유틸 경로와 일관되게 정리
- 중복/누락 없는 로그 적재와 레벨 갱신 보장

3. 시간 기준 일관화
- 일일 리셋/주간 집계 기준(KST) 명시
- 관련 쿼리와 유틸이 같은 기준을 사용하도록 점검

4. 테스트 보강
- API: 정상/인증실패/중복 claim(409)/부분 실패
- 로직: streak 경계, daily cap 경계, 업적 진행도
- E2E: 성장 페이지 핵심 흐름 회귀

## Working Files
- 서버 라우트: `routes/growthRoutes.js`
- 성장 유틸: `utils/growth.js`
- 퀘스트 서비스: `utils/questService.js`
- 성장 페이지 스크립트: `public/js/growth.js`
- 성장 페이지 마크업: `public/html/growth.html`
- 성장 페이지 스타일: `public/css/pages/growth.css`
- E2E: `tests/e2e/ui-snapshots.spec.js`
- 문서: `docs/API_REFERENCE.md` (필요 시), `docs/growth-p1-roadmap.md`

## Execution Plan
- [x] Step 1. `GET /api/growth/dashboard` 스펙 확정
- [x] Step 2. 서버 엔드포인트 구현 및 하위호환 유지
- [x] Step 3. 프론트를 dashboard 우선 호출로 전환 (fallback 유지)
- [x] Step 4. claim/XP 경로 일관성 정리
- [ ] Step 5. API + E2E 테스트 추가/보강
- [ ] Step 6. 문서 갱신 및 머지 준비

## Progress Log
- Task 1: `routes/growthRoutes.js`에 `GET /api/growth/dashboard`를 추가하고, 기존 growth 엔드포인트 응답 매핑을 공통 함수로 정리함.
- Task 1: 하위호환을 위해 기존 `/growth/summary`, `/growth/achievements`, `/quests/active` 엔드포인트는 유지함.

- Task 2: `public/js/growth.js` 초기 로드를 `GET /api/growth/dashboard` 우선으로 전환하고, 실패 시 기존 summary/achievements/active quests 호출로 fallback 하도록 구현함.

- Task 3: `routes/growthRoutes.js`의 quest claim XP 적립 경로를 중복 SQL 처리 대신 `addXp` 유틸 재사용으로 통일해 레벨/로그 갱신 경로를 일관화함.

- Task 4: `tests/e2e/growth-dashboard.spec.js`를 추가해 dashboard-first 성공 경로와 dashboard 실패 시 legacy API fallback 경로를 Playwright로 회귀 검증함.

## Definition of Done
- 성장 페이지 초기 진입 시 데이터 로드가 안정적으로 완료된다.
- 보상 지급 재시도/중복 요청에서 서버 응답이 일관된다.
- 기존 P0 UX(스켈레톤, 노티스, 모바일 패널/필터 상태 유지)가 회귀하지 않는다.
- 관련 테스트가 통과한다.
