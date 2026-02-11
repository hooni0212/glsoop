# Growth / Achievements / Quests API

기준 라우트: `routes/growthRoutes.js`

Base: `/api`

---

## Endpoints

- `GET /growth/dashboard` (auth)
- `GET /growth/top-posts` (auth)
- `GET /growth/summary` (auth)
- `GET /growth/achievements` (auth)
- `GET /quests/active` (auth)
- `POST /quests/:stateId/claim` (auth)

---

## 잠금(유료화) 필드 확장

`dashboard` 및 `quests/active`의 `campaigns[].quests[]`에 아래 필드를 추가해 전달합니다.

- `is_locked` (boolean)
- `required_entitlement` (string|null)
- `lock_reason` (string|null)

잠긴 퀘스트 claim 시:

- `403 ENTITLEMENT_REQUIRED`

---

## 보상 확장

`POST /quests/:stateId/claim` 응답에는 XP 외에 코스메틱 보상을 포함할 수 있습니다.

- `gained_cosmetics[]`:
  - `key`, `name`, `icon_emoji`, `rarity`, `season`

---

## 데이터 모델 연결

- `xp_log`
- `quest_templates`
- `quest_campaigns`
- `quest_campaign_items`
- `user_quest_state`
- (보상 연동) `user_cosmetics`

---

## 관련 문서

- 유료화 API: `docs/server/api/monetization.md`
- 유료화 계약: `docs/MONETIZATION_API_CONTRACT_V1.md`
