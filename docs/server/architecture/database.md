# Database Overview

기준:

- 런타임 DB 초기화: `db.js`
- 마이그레이션: `migrations/*.sql`

---

## 1) 핵심 테이블 묶음

### Auth / Users

- `users`
- `otp_verifications`
- `pending_signups`

### Social / Content

- `posts`
- `likes`
- `follows`
- `hashtags`
- `post_hashtags`

### Bookmarks

- `bookmark_lists`
- `bookmark_items`

### Growth / Quests

- `xp_log`
- `quest_templates`
- `quest_campaigns`
- `quest_campaign_items`
- `user_quest_state`

### Cosmetics

- `cosmetic_items`
- `user_cosmetics`
- `user_profile_cosmetics`

### Monetization

- `products`
- `purchases`
- `user_entitlements`
- `monetization_webhook_events`
- `monetization_alerts`

### Share Analytics

- `share_events`

---

## 2) 마이그레이션 맵

- `0001_create_schema_migrations.sql`: 마이그레이션 이력 테이블
- `0002_initial_schema.sql`: 초기 스키마
- `0003_add_quest_template_metadata.sql`: 퀘스트 템플릿 메타 확장
- `0004_add_user_quest_reward_claim.sql`: 퀘스트 보상 클레임 필드
- `0005_seed_permanent_achievement_campaign.sql`: 상시 업적 캠페인 시드
- `0006_seed_legacy_achievements.sql`: 레거시 업적 시드
- `0007_drop_legacy_achievements_tables.sql`: 레거시 테이블 정리
- `0008_create_share_events.sql`: 공유 이벤트 로그
- `0009_create_cosmetics.sql`: 코스메틱 + 프로필 꾸미기
- `0010_create_monetization_entitlements.sql`: 상품/결제/권한
- `0011_create_monetization_webhook_tables.sql`: 웹훅 이벤트/운영 알림

---

## 3) 데이터 규칙

- 응답 필드 표기: `snake_case`
- 신규 기능은 기존 API 필드 제거/변경 없이 확장
- 지급/권한성 데이터는 idempotent 처리 우선
  - 예: `INSERT OR IGNORE`, unique key 기반 upsert

---

## 4) 상세 스키마 문서

- `docs/DB_SCHEMA.md` (레거시 포함 상세 컬럼)
