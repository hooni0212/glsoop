# 업적 보상 및 프로필 코스메틱 서버 개편 계획

작성일: 2026-05-04
브랜치: `feature/profile-cosmetics-achievements`

## 배경

설치 앱과 원격 서버에서 프로필 꾸미기가 약하게 보이는 이유는 기능 범위와 운영 안정화가 아직 부족하기 때문이다. 현재 서버 모델은 `badge`와 `sticker`만 지원하고, `user_profile_cosmetics`도 대표 뱃지, 쇼케이스 뱃지, 헤더 스티커만 저장한다. 업적 완수자에게 지급할 특별 배경은 DB, API, 보상 지급, 공개 프로필 응답에 아직 포함되어 있지 않다.

## 목표

- 원격 서버에서도 기본 코스메틱 인벤토리와 프로필 저장이 안정적으로 동작하게 한다.
- 업적별 보상 배지를 seed하고, 업적/퀘스트 보상 수령 시 사용자 인벤토리에 지급한다.
- `background` 코스메틱 타입을 추가하고 프로필 배경으로 장착할 수 있게 한다.
- 공개 작가 프로필과 글 author payload에서도 선택한 프로필 코스메틱을 일관되게 반환한다.

## 서버 작업 범위

1. DB 마이그레이션
   - `cosmetic_items.type` 허용값을 `badge`, `sticker`, `background`로 확장한다.
   - `user_profile_cosmetics.profile_background_key` 컬럼을 추가한다.
   - 기본 배경과 업적 전용 배경 seed를 추가한다.
   - 기존 업적 코드별 보상 배지를 seed한다.
   - 기존 업적 템플릿 `ui_json.rewards.cosmetics`에 보상 키를 연결한다.

2. 프로필 코스메틱 API 안정화
   - `GET /api/cosmetics/me`에서 기본 배지/기본 배경 소유권과 프로필 row가 없으면 자동 보정한다.
   - inventory 응답을 `badges`, `stickers`, `backgrounds`로 확장한다.
   - cosmetic item 응답에 `type`과 `meta`를 포함해 모바일이 배경 스타일을 해석할 수 있게 한다.
   - `PUT /api/me/profile-cosmetics`에서 `profile_background_key`를 검증하고 저장한다.
   - 기존 앱이 배경 필드를 보내지 않아도 기존 배경이 지워지지 않도록 omitted 필드는 보존한다.

3. 보상 지급 확장
   - `growthRoutes`의 코스메틱 보상 지급을 `background` 타입까지 허용한다.
   - `gained_cosmetics` 응답에서 배지/스티커/배경을 동일한 item contract로 반환한다.
   - 업적 보상 수령 직후 프로필 꾸미기 화면에서 최신 인벤토리가 반영될 수 있게 한다.

4. 공개 프로필 응답 확장
   - `routes/userRoutes.js`의 공개 프로필 코스메틱 응답에 `profile_background`를 포함한다.
   - `routes/postRoutes.js`의 author profile cosmetics payload도 배경을 포함하도록 확장한다.

## 업적별 보상 초안

| 업적 코드 | 보상 |
| --- | --- |
| `first_post` | `badge_first_post` |
| `posts_10` | `badge_posts_10` |
| `posts_50` | `badge_posts_50`, `background_writer_grove` |
| `first_like` | `badge_first_like` |
| `likes_10_single` | `badge_loved_post` |
| `streak_3` | `badge_streak_3` |
| `streak_7` | `badge_streak_7` |
| `streak_30` | `badge_streak_30`, `background_deep_forest` |
| `first_bookmark` | `badge_first_bookmark` |

## 검증

- `node --check` for changed server JS files.
- `npx playwright test tests/e2e/cosmetics-api.spec.js tests/e2e/monetization-growth.spec.js tests/e2e/growth-dashboard.spec.js --project=desktop-chrome`
- `npm run verify:phase2`
- `npm run verify:phase3`

## 주의사항

- 원격 서버 적용 시 마이그레이션 실행 여부, 기본 배지/기본 배경 backfill 여부를 먼저 확인한다.
- production 모바일 빌드는 `EXPO_PUBLIC_API_BASE_URL=https://glsoop.com`을 사용해야 한다.
- 기존 `badge`/`sticker` 클라이언트와 호환되도록 배경 필드는 optional하게 처리한다.
