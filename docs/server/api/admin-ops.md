# Admin / Ops API

기준 라우트:

- `routes/adminRoutes.js`
- `routes/adminPageRoutes.js`

Base: `/api/admin`

---

## Admin Page

- `GET /admin` (admin page 진입)
- `GET /html/admin.html` (직접 접근 차단)

---

## Endpoints

헬스:

- `GET /` (admin API 연결 확인)

사용자/게시글 관리:

- `GET /users`
- `DELETE /users/:id`
- `GET /posts`
- `GET /posts/:id`
- `DELETE /posts/:id`

퀘스트 템플릿/캠페인:

- `GET /quest-templates`
- `POST /quest-templates`
- `PUT /quest-templates/:id`
- `DELETE /quest-templates/:id`
- `POST /quests/achievements/backfill`
- `GET /quest-campaigns`
- `POST /quest-campaigns`
- `PUT /quest-campaigns/:id`
- `DELETE /quest-campaigns/:id`
- `PUT /quest-campaigns/:id/items`

모네타이제이션 운영:

- `POST /entitlements/grant`
- `POST /purchases/reconcile`
- `POST /monetization/reconcile`
- `GET /monetization/webhook-events`
- `GET /monetization/alerts`
- `POST /monetization/alerts/:id/resolve`

기타 운영:

- `POST /cosmetics/grant`
- `GET /share-events/summary`

---

## 운영 시 우선 확인

1. open alert 존재 여부 (`/monetization/alerts?status=open`)
2. webhook 실패/무시 이벤트 (`/monetization/webhook-events`)
3. 필요 시 수동 reconcile (`/purchases/reconcile`, `/monetization/reconcile`)

---

## 관련 문서

- 유료화 런북: `docs/MONETIZATION_PHASEC_RUNBOOK.md`
- API 인덱스: `docs/API_REFERENCE.md`
