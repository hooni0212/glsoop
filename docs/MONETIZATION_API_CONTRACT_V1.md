# 글숲 유료화 API 계약서 초안 (v1.1)

- 상태: Draft v1.1
- 작성일: 2026-02-10
- 목적: 글숲 유료화(시즌 패스/프리미엄 퀘스트) + 코스메틱(뱃지/스티커) + 프로필 꾸미기 기능을 서버/모바일에서 일관되게 구현하기 위한 API Contract 및 설계 규칙 정의

---

## 1) Canonical 규칙

### 1.1 응답/네이밍

- 응답 필드: `snake_case`
- 기본 envelope
  - 성공: `{ ok: true, message }`
  - 실패: `{ ok: false, message }`
- 신규 API 실패 형태(정책 확정)
  - `{ ok: false, code, message }`
  - 유료화/코스메틱 신규 엔드포인트는 `code` 필수

### 1.2 호환성 원칙

- Backward compatible 필수
- 기존 엔드포인트/필드 변경 금지 (추가만 허용)
- 모바일은 신규 필드가 없어도 안전 렌더링

### 1.3 계약 우선순위 (정책 확정)

- 본 문서의 규칙은 유료화/코스메틱 신규 API 계약의 기준 문서로 취급
- 구현 시 기존 서버 스타일(`snake_case`, `ok/message`)을 우선 유지
- 충돌 시 우선순위
  - 1순위: backward compatibility
  - 2순위: 권한/보안 규칙 (`entitlement`, 소유권 검증)
  - 3순위: 응답 형태 일관성 (`ok/code/message`)

---

## 2) 유료화 목표(제품)

### 2.1 핵심 수익 모델 (우선순위)

1. 시즌 패스(Season Pass)
- 결제 시 프리미엄 캠페인(퀘스트 묶음) 해제
- 퀘스트 완료/클레임 시 코스메틱 보상 지급
- 지급 코스메틱으로 프로필 꾸미기(대표 뱃지/쇼케이스/헤더 스티커)

2. 코스메틱 시스템 확장
- 1차: 패스/퀘스트 보상 지급
- 2차: 단품/번들 상점 (`server catalog` + `mobile IAP` 매핑)

---

## 3) 도메인 모델

### 3.1 Product / Purchase / Entitlement

- `Product`: 스토어 SKU 단위 상품(예: `pass_2026_spring`)
- `Purchase`: 결제 트랜잭션 원장(검증/상태 포함)
- `Entitlement`: 서버가 부여하는 권한 키(예: `pass:2026_spring`)
- 프리미엄 퀘스트 잠금/해제 판단 기준은 `entitlement`

### 3.2 Cosmetic

- `Cosmetic Item`: 뱃지/스티커 아이템 메타
- `User Cosmetics`: 유저 소유 상태
- `Profile Cosmetics`: 유저 장착/적용 상태

---

## 4) DB 설계 (V1 최소)

V1 목표는 아래 흐름의 완결입니다.

`시즌 패스 구매 -> entitlement 활성화 -> 프리미엄 퀘스트 해제 -> claim 보상(코스메틱 지급) -> 프로필 꾸미기 반영`

### 4.1 유료화 권한 테이블

#### (1) `products` (카탈로그/매핑)

- `id` INTEGER PK
- `platform` TEXT (`apple|google|web`)
- `store_sku` TEXT NOT NULL
- `product_type` TEXT (`non_consumable|subscription|consumable`)
- `entitlement_key` TEXT NOT NULL (예: `pass:2026_spring`)
- `title` TEXT
- `description` TEXT
- `season` TEXT NULL
- `meta_json` TEXT NULL
- `is_active` INTEGER DEFAULT 1
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
- unique 제약
  - `UNIQUE(platform, store_sku)` 권장

#### (2) `purchases` (결제 원장)

- `id` INTEGER PK
- `user_id` INTEGER NOT NULL FK `users(id)` ON DELETE CASCADE
- `platform` TEXT NOT NULL
- `store_sku` TEXT NOT NULL
- `transaction_id` TEXT NULL (apple)
- `purchase_token` TEXT NULL (google)
- `status` TEXT NOT NULL (`active|expired|refunded|canceled|pending`)
- `purchased_at` DATETIME NOT NULL
- `expires_at` DATETIME NULL
- `raw_json` TEXT NULL
- unique 제약(권장 구현)
  - `UNIQUE(platform, transaction_id) WHERE transaction_id IS NOT NULL`
  - `UNIQUE(platform, purchase_token) WHERE purchase_token IS NOT NULL`
- 플랫폼별 식별자 유효성 규칙
  - `platform='apple'` -> `transaction_id` 필수, `purchase_token` NULL 허용
  - `platform='google'` -> `purchase_token` 필수, `transaction_id` NULL 허용
  - `platform='web'` -> 내부 정책에 따라 둘 다 NULL 가능

#### (3) `user_entitlements` (권한 상태)

- `id` INTEGER PK
- `user_id` INTEGER NOT NULL FK `users(id)` ON DELETE CASCADE
- `entitlement_key` TEXT NOT NULL
- `status` TEXT NOT NULL (`active|inactive`)
- `source` TEXT NOT NULL (`iap|admin|promo`)
- `starts_at` DATETIME DEFAULT CURRENT_TIMESTAMP
- `ends_at` DATETIME NULL
- `meta_json` TEXT NULL
- `UNIQUE(user_id, entitlement_key)`

### 4.2 코스메틱 테이블

#### (4) `cosmetic_items`

- `id` INTEGER PK
- `type` TEXT (`badge|sticker`)
- `key` TEXT UNIQUE NOT NULL (모바일 안정 키)
- `name` TEXT NOT NULL
- `rarity` TEXT DEFAULT `common` (`common|rare|epic|legendary`)
- `season` TEXT NULL
- `icon_emoji` TEXT NULL
- `meta_json` TEXT NULL
- `is_active` INTEGER DEFAULT 1
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP

#### (5) `user_cosmetics`

- `id` INTEGER PK
- `user_id` INTEGER NOT NULL FK `users(id)` ON DELETE CASCADE
- `cosmetic_id` INTEGER NOT NULL FK `cosmetic_items(id)` ON DELETE CASCADE
- `source` TEXT DEFAULT `unknown` (`quest|pass|admin|default`)
- `earned_at` DATETIME DEFAULT CURRENT_TIMESTAMP
- `UNIQUE(user_id, cosmetic_id)`

#### (6) `user_profile_cosmetics`

- `user_id` INTEGER PK FK `users(id)` ON DELETE CASCADE
- `primary_badge_key` TEXT NULL
- `showcase_badge_keys_json` TEXT NULL (`JSON array`, max 6)
- `header_stickers_json` TEXT NULL (`JSON array`, max 3)
- `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP

### 4.3 DDL 권장안 (정책 확정)

아래는 SQLite 기준 권장 DDL/인덱스 예시입니다.

```sql
-- products
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_platform_sku
  ON products(platform, store_sku);

-- purchases: nullable 식별자 중복 방지
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchases_apple_tx
  ON purchases(platform, transaction_id)
  WHERE transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchases_google_token
  ON purchases(platform, purchase_token)
  WHERE purchase_token IS NOT NULL;

-- purchases: 플랫폼별 식별자 체크
-- (SQLite table-level CHECK 예시)
-- CHECK (
--   (platform = 'apple'  AND transaction_id IS NOT NULL) OR
--   (platform = 'google' AND purchase_token IS NOT NULL) OR
--   (platform = 'web')
-- )
```

---

## 5) 퀘스트/캠페인 유료 잠금 규칙

### 5.1 `quest_templates.ui_json` 확장 예시

```json
{
  "required_entitlement": "pass:2026_spring",
  "rewards": {
    "xp": 20,
    "cosmetics": ["sticker_star", "badge_spring_2026"]
  },
  "ui": {
    "tag": "프리미엄",
    "accent": "spring"
  }
}
```

### 5.2 서버 계산 필드 (비파괴 추가)

`/growth/dashboard`, `/quests/active`의 `quest` 객체에 추가:

- `is_locked` (boolean)
- `required_entitlement` (string|null)
- `lock_reason` (string|null, 예: `SEASON_PASS_REQUIRED`)

모바일은 최소 `is_locked`로 동작 가능. `ui_json`은 UI 장식 용도로 사용.

---

## 6) 공통 에러 계약

- `400`: `INVALID_REQUEST`
- `401`: `UNAUTHORIZED`
- `403`: `FORBIDDEN` / `ENTITLEMENT_REQUIRED` / `NOT_OWNED`
- `404`: `RESOURCE_NOT_FOUND`
- `409`: `CONFLICT` / `ALREADY_CLAIMED`
- `500`: `INTERNAL_ERROR`

신규 API 실패 응답 (정책 확정):

```json
{
  "ok": false,
  "code": "INVALID_REQUEST",
  "message": "..."
}
```

추가 규칙:

- 신규 유료화/코스메틱 API는 `code` 필수
- 기존 레거시 API는 점진적으로 `code`를 확장하되, 기존 클라이언트 호환을 위해 즉시 강제하지 않음

---

## 7) API: 권한/카탈로그/구매 검증

### 7.1 `GET /api/store/catalog` (Public)

서버 상품 메타 반환. 가격은 모바일 스토어 SDK 기준.

```json
{
  "ok": true,
  "message": "스토어 카탈로그를 불러왔습니다.",
  "products": [
    {
      "store_sku": "pass_2026_spring",
      "platform": "apple",
      "product_type": "non_consumable",
      "entitlement_key": "pass:2026_spring",
      "title": "2026 봄 시즌 패스",
      "description": "프리미엄 퀘스트와 한정 보상을 획득하세요.",
      "season": "2026_spring",
      "is_active": 1,
      "meta": {
        "benefits": ["premium_campaign_unlock", "cosmetic_rewards"]
      }
    }
  ]
}
```

### 7.2 `GET /api/entitlements/me` (Private)

```json
{
  "ok": true,
  "message": "권한 정보를 불러왔습니다.",
  "entitlements": [
    {
      "entitlement_key": "pass:2026_spring",
      "status": "active",
      "starts_at": "2026-02-10T12:00:00.000Z",
      "ends_at": "2026-04-01T00:00:00.000Z",
      "source": "iap"
    }
  ]
}
```

### 7.3 `POST /api/purchases/verify` (Private)

요청:

```json
{
  "platform": "apple",
  "store_sku": "pass_2026_spring",
  "transaction_id": "1000000123456789",
  "receipt_data": "base64-or-jws-or-token",
  "client_meta": {
    "app_version": "1.0.0",
    "device": "ios"
  }
}
```

응답 200:

```json
{
  "ok": true,
  "message": "결제가 확인되었습니다.",
  "purchase": {
    "platform": "apple",
    "store_sku": "pass_2026_spring",
    "status": "active",
    "purchased_at": "2026-02-10T12:00:00.000Z",
    "expires_at": "2026-04-01T00:00:00.000Z"
  },
  "entitlements": [
    {
      "entitlement_key": "pass:2026_spring",
      "status": "active",
      "starts_at": "2026-02-10T12:00:00.000Z",
      "ends_at": "2026-04-01T00:00:00.000Z",
      "source": "iap"
    }
  ]
}
```

응답 409:

```json
{
  "ok": false,
  "code": "CONFLICT",
  "message": "이미 처리된 결제입니다."
}
```

구현 전략(단계적):

- 초기: 저장 중심 + admin 검증 플래그
- 이후: Apple/Google 실검증 연동

### 7.4 `verify` 활성화 규칙 (정책 확정)

`/api/purchases/verify`는 아래 규칙으로 entitlement 상태를 결정합니다.

1. 실검증 성공
- `purchases.status = active`
- `user_entitlements.status = active`
- `starts_at/ends_at` 갱신

2. 실검증 미수행(임시 모드) 또는 검증 대기
- `purchases.status = pending`
- `user_entitlements.status = inactive` 유지
- admin 승인 또는 후속 검증 성공 시에만 `active` 전환

3. 중복/재시도 요청 (멱등 처리)
- 동일 플랫폼 식별자(`transaction_id` 또는 `purchase_token`)가 이미 처리된 경우
  - 동일 결과 반환(200) 또는 `409 CONFLICT` 정책 중 하나로 고정
  - 본 문서 권장: 최초 active 처리 이후 동일 요청은 200으로 현재 상태 재반환

4. 권장 감사 필드
- `purchases.raw_json`에 검증 원본/요약 저장
- 변경 시각/변경 주체(`source`)를 entitlement 메타에 기록

---

## 8) API: 코스메틱 인벤토리 + 프로필 꾸미기

### 8.1 `GET /api/cosmetics/me` (Private)

```json
{
  "ok": true,
  "message": "코스메틱 정보를 불러왔습니다.",
  "inventory": {
    "badges": [
      {
        "key": "badge_default_seedling",
        "name": "새싹",
        "icon_emoji": "🌱",
        "rarity": "common",
        "season": null
      }
    ],
    "stickers": [
      {
        "key": "sticker_star",
        "name": "별빛",
        "icon_emoji": "✨",
        "rarity": "common",
        "season": "2026_spring"
      }
    ]
  },
  "profile": {
    "primary_badge_key": "badge_default_seedling",
    "showcase_badge_keys": ["badge_default_seedling"],
    "header_stickers": [
      { "slot": "tr", "key": "sticker_star" }
    ]
  }
}
```

### 8.2 `PUT /api/me/profile-cosmetics` (Private)

요청:

```json
{
  "primary_badge_key": "badge_spring_2026",
  "showcase_badge_keys": ["badge_spring_2026", "badge_default_seedling"],
  "header_stickers": [
    { "slot": "tl", "key": "sticker_leaf" },
    { "slot": "tr", "key": "sticker_star" }
  ]
}
```

제약:

- `showcase_badge_keys` 최대 6개, 중복 금지
- `header_stickers` 최대 3개, slot 중복 금지
- badge 슬롯에는 badge만, sticker 슬롯에는 sticker만
- 모두 유저 소유(`user_cosmetics`) 아이템이어야 함

응답 200:

```json
{
  "ok": true,
  "message": "프로필 꾸미기가 저장되었습니다.",
  "profile_cosmetics": {
    "primary_badge": {
      "key": "badge_spring_2026",
      "name": "봄의 기록자",
      "icon_emoji": "🌸",
      "rarity": "rare",
      "season": "2026_spring"
    },
    "showcase_badges": [
      {
        "key": "badge_spring_2026",
        "name": "봄의 기록자",
        "icon_emoji": "🌸",
        "rarity": "rare",
        "season": "2026_spring"
      },
      {
        "key": "badge_default_seedling",
        "name": "새싹",
        "icon_emoji": "🌱",
        "rarity": "common",
        "season": null
      }
    ],
    "header_stickers": [
      {
        "slot": "tl",
        "sticker": {
          "key": "sticker_leaf",
          "name": "잎사귀",
          "icon_emoji": "🍃",
          "rarity": "common",
          "season": null
        }
      },
      {
        "slot": "tr",
        "sticker": {
          "key": "sticker_star",
          "name": "별빛",
          "icon_emoji": "✨",
          "rarity": "common",
          "season": "2026_spring"
        }
      }
    ]
  }
}
```

응답 403:

```json
{
  "ok": false,
  "code": "NOT_OWNED",
  "message": "보유하지 않은 코스메틱입니다."
}
```

### 8.3 `GET /api/users/:id/profile` (Public, 기존 확장)

`user.profile_cosmetics`만 비파괴 추가.

```json
{
  "ok": true,
  "message": "작가 프로필을 불러왔습니다.",
  "user": {
    "id": 12,
    "name": "...",
    "nickname": "...",
    "level": 3,
    "profile_cosmetics": {
      "primary_badge": {
        "key": "badge_spring_2026",
        "name": "봄의 기록자",
        "icon_emoji": "🌸",
        "rarity": "rare",
        "season": "2026_spring"
      },
      "showcase_badges": [
        {
          "key": "badge_default_seedling",
          "name": "새싹",
          "icon_emoji": "🌱",
          "rarity": "common",
          "season": null
        }
      ],
      "header_stickers": [
        {
          "slot": "tr",
          "sticker": {
            "key": "sticker_star",
            "name": "별빛",
            "icon_emoji": "✨",
            "rarity": "common",
            "season": "2026_spring"
          }
        }
      ]
    }
  },
  "viewer": {
    "is_own_profile": false,
    "is_following": false
  }
}
```

---

## 9) API: 성장/퀘스트 프리미엄 잠금 확장

### 9.1 `GET /api/growth/dashboard` (Private, 기존 확장)

`campaigns[].quests[]`에 아래 필드 추가:

- `is_locked`
- `required_entitlement`
- `lock_reason`

예시:

```json
{
  "id": 101,
  "state_id": 901,
  "name": "봄 시즌: 글 5개 작성",
  "reward_xp": 20,
  "ui_json": {
    "required_entitlement": "pass:2026_spring",
    "rewards": {
      "xp": 20,
      "cosmetics": ["sticker_star"]
    }
  },
  "is_locked": true,
  "required_entitlement": "pass:2026_spring",
  "lock_reason": "SEASON_PASS_REQUIRED",
  "status": "locked",
  "progress": 0
}
```

주의:

- `status` 기존 의미와 충돌 우려 시 변경하지 않고 `is_locked`만 추가해도 됨
- 모바일 UX 관점에서 `is_locked`는 필수

### 9.2 `POST /api/quests/:stateId/claim` (Private, 기존 확장)

`ui_json.rewards.cosmetics`가 있으면 XP와 함께 코스메틱 지급.

응답 200:

```json
{
  "ok": true,
  "reward_claimed_at": "2026-02-10T12:10:20.000Z",
  "gained_xp": 20,
  "new_xp": 200,
  "gained_cosmetics": [
    {
      "key": "sticker_star",
      "name": "별빛",
      "icon_emoji": "✨",
      "rarity": "common",
      "season": "2026_spring"
    }
  ]
}
```

잠금 상태 claim 시 403:

```json
{
  "ok": false,
  "code": "ENTITLEMENT_REQUIRED",
  "message": "시즌 패스가 필요합니다."
}
```

### 9.3 Claim 멱등성/보상 지급 규칙 (정책 확정)

`POST /api/quests/:stateId/claim`는 중복 요청에도 안전해야 합니다.

1. 1회성 보상 지급 원칙
- 같은 `state_id`는 `reward_claimed_at IS NULL`일 때만 지급
- 코스메틱 지급은 `INSERT OR IGNORE`로 중복 지급 방지

2. 중복 claim 요청 처리
- 이미 보상 수령된 상태면 409 또는 200(no-op) 중 하나로 고정
- 본 문서 권장: `409 CONFLICT` + `ALREADY_CLAIMED`

3. 트랜잭션 원칙
- XP 지급, 코스메틱 지급, `reward_claimed_at` 갱신은 단일 트랜잭션으로 처리
- 중간 실패 시 전체 rollback

4. 잠금 상태 보호
- `is_locked=true` 또는 entitlement 불충족이면 지급 로직에 진입하지 않고 즉시 403

---

## 10) Admin API

### 10.1 `POST /api/admin/entitlements/grant` (Admin)

요청:

```json
{
  "user_id": 12,
  "entitlement_key": "pass:2026_spring",
  "ends_at": "2026-04-01T00:00:00.000Z",
  "source": "admin"
}
```

### 10.2 `POST /api/admin/cosmetics/grant` (Admin)

요청:

```json
{
  "user_id": 12,
  "cosmetic_key": "sticker_star",
  "source": "admin"
}
```

---

## 11) 모바일 통합 흐름

### 11.1 구매 플로우

1. 성장 탭 잠금 퀘스트 클릭
2. Paywall 화면
- `/api/store/catalog`으로 시즌/혜택 노출
- 실제 가격/결제는 스토어 SDK 기준
3. 결제 성공 후 `/api/purchases/verify`
4. 응답 기반 entitlement 갱신
5. `/growth/dashboard` 재조회로 잠금 해제 확인 (`is_locked=false`)
6. 퀘스트 claim 후 `gained_cosmetics`
7. 프로필 꾸미기로 유도 (즉시 보상 체감)

### 11.2 캐싱/갱신 포인트

- `GET /api/entitlements/me` 호출 시점
  - 앱 시작
  - 결제 직후
  - 성장 탭 진입 시 (필요한 경우)
- 최적화 옵션
  - `/growth/dashboard` 응답에 `entitlements` 병합 (비파괴 추가)

### 11.3 레포 경계 규칙 (정책 확정)

- 서버 작업 레포: `glsoop`
  - 대상: DB migration, API route, server-side validation, server docs
- 모바일 작업 레포: `glsoop-mobile`
  - 대상: IAP SDK 연동, paywall UI, client cache/state, profile decorate UI
- 단일 PR/브랜치에서 서버/모바일 레포를 혼합 수정하지 않음
- 모바일 변경은 반드시 모바일 레포의 `dev` 기반 브랜치에서 진행

---

## 12) 마이그레이션/릴리즈 플랜

### Phase A: 코스메틱 + 프로필 꾸미기

- `cosmetic_items`, `user_cosmetics`, `user_profile_cosmetics`
- 기본 뱃지 전체 지급 + 신규 가입 자동 지급
- 프로필 꾸미기 화면 및 공개 프로필 노출

### Phase B: entitlement + 프리미엄 잠금

- `products`, `purchases`, `user_entitlements`
- `ui_json.required_entitlement` 반영
- dashboard/quests `is_locked` 계산 추가
- claim 시 entitlement 체크

### Phase C: verify 강화 + 운영 자동화

- `POST /api/purchases/verify` 실검증 연동
- 환불/취소/만료 반영
- admin 복구/지급 자동화

---

## 13) Definition of Done

- 결제 전 프리미엄 퀘스트 잠금 표시 (`is_locked=true`)
- 결제 verify 후 entitlement `active` + 즉시 해제
- 프리미엄 퀘스트 claim 시 XP + 코스메틱 지급
- 지급 코스메틱이 `/api/cosmetics/me` 인벤토리에 반영
- 프로필 장착 후 `/api/users/:id/profile`에 공개 반영
- 기존 API/화면 무중단 (기존 필드 불변, 신규 필드 추가만)
