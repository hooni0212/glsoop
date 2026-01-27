# Phase 3 — Legacy Achievements Migration

## 목표 요약
- 기존 하드코딩 업적 정의를 DB 기반 템플릿(`quest_templates`)으로 이전합니다.
- 영구 캠페인("업적")에 연결된 업적 템플릿을 모든 사용자에게 할당(백필)합니다.
- 런타임은 DB 템플릿만 참조하고, 데이터 정의는 SQL 마이그레이션으로 관리합니다.

## 1) 레거시 하드코딩 소스 Audit

### 발견된 레거시 정의/룰
- **업적 카탈로그 데이터**: `docs/legacy-achievements.json`에 레거시 업적 목록(코드/타이틀/조건/아이콘)이 JSON으로 남아 있습니다.
- **런타임 업적 업데이트 트리거**: `utils/growth.js`에서 `updateAchievementProgress`를 통해 업적 코드(예: `first_post`, `posts_10`, `streak_7`)를 직접 호출합니다.
- **레거시 테이블**: `achievements`, `user_achievements` 테이블이 `migrations/0002_initial_schema.sql`에 존재합니다.

### 레거시 → 신규 스키마 매핑
- **레거시 코드** → `quest_templates.code`
- **레거시 이름/설명** → `quest_templates.name` / `quest_templates.description`
- **조건 타입/카테고리** → `quest_templates.condition_type` / `quest_templates.category`
- **목표치** → `quest_templates.target_value`
- **UI 표시 정보** → `quest_templates.ui_json` (icon, label, position_index, legacy_key)
- **캠페인 연결** → `quest_campaign_items`에 영구 캠페인("업적") 연결

## 2) 데이터 마이그레이션 전략

### SQL 마이그레이션 (필수)
- `migrations/0006_seed_legacy_achievements.sql`에서 레거시 업적 템플릿을 **idempotent**하게 삽입/업데이트합니다.
- 업적 코드는 `quest_templates.code` 유니크 인덱스를 통해 재실행 시 중복 삽입을 방지합니다.
- 영구 캠페인("업적")에 대한 연결은 `NOT EXISTS` 조건으로 중복 삽입을 방지합니다.

### 레거시 유저 업적 상태 이관 (옵션)
- 레거시 테이블(`user_achievements`)이 존재하는 DB는 `scripts/phase3-migrate-legacy-achievements.mjs`로
  `user_quest_state`에 업적 진행도를 이관할 수 있습니다.

## 3) 백필(Backfill) 전략

- 영구 캠페인 템플릿을 모든 사용자에게 할당하는 스크립트: `scripts/backfill-permanent-quests.mjs`
- 각 사용자에 대해 현재 지표(게시글 수/좋아요/북마크/스트릭 등)를 계산해 진행도 반영
- 재실행 시 변경점이 없으면 스킵 → **idempotent** 보장

## 4) How to Run

### 4.1 마이그레이션 실행 (신규 DB 기준)
```bash
DB_PATH=./tmp/dev.sqlite node -e "require('./utils/migrations').runMigrations()"
```

### 4.2 레거시 업적 템플릿 이관 확인
```bash
DB_PATH=./tmp/dev.sqlite node scripts/verify-phase3.mjs
```

### 4.3 레거시 유저 업적 이관 (레거시 테이블이 있는 경우)
```bash
DB_PATH=./tmp/dev.sqlite node scripts/phase3-migrate-legacy-achievements.mjs --dry-run
DB_PATH=./tmp/dev.sqlite node scripts/phase3-migrate-legacy-achievements.mjs
```

### 4.4 영구 캠페인 백필 (모든 사용자 할당)
```bash
DB_PATH=./tmp/dev.sqlite node scripts/backfill-permanent-quests.mjs
```

## 5) Expected Output 예시

### Backfill 예시
```
[backfill] users processed: 3
[backfill] templates scanned: 9
[backfill] created: 27 updated: 0 skipped: 0
```

### Phase3 Verify 예시
```
Phase3 Verify Result
1) 런타임 코드에서 legacy-achievements.json 참조 없음 O
2) Phase3 마이그레이션: legacy 업적 템플릿 시드 O
3) Backfill: 영구 캠페인 사용자 할당 + 재실행 안전 O
=> ALL PASS
```
