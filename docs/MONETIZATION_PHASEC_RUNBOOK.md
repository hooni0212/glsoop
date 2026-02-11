# 글숲 유료화 Phase C 운영 가이드 (Runbook)

- 상태: Active
- 마지막 업데이트: 2026-02-11
- 대상 레포: `glsoop` (server)
- 기준 문서:
  - 계약: `docs/MONETIZATION_API_CONTRACT_V1.md`
  - API 레퍼런스: `docs/API_REFERENCE.md`

---

## 1) 목적

이 문서는 Phase C 범위(실검증 + 웹훅 + 운영 알림)를 실제 운영에서 안전하게 다루기 위한 실행 절차를 제공합니다.

- 결제 검증 모드 선택/전환
- Apple/Google 자격증명 점검
- 웹훅 이벤트 처리/모니터링
- 장애/누락 이벤트 대응

---

## 2) 현재 서버 구성 요약

### 2.1 Verify API

- `POST /api/purchases/verify`
- 모드: `MONETIZATION_VERIFY_MODE`
  - `pending_only` (기본)
  - `auto_active`
  - `receipt_inspect`
  - `live_verify`

### 2.2 Webhook Ingestion

- `POST /api/monetization/webhooks/apple`
- `POST /api/monetization/webhooks/google`
- 이벤트 원장: `monetization_webhook_events`

### 2.3 Ops Monitoring

- `GET /api/admin/monetization/webhook-events`
- `GET /api/admin/monetization/alerts`
- `POST /api/admin/monetization/alerts/:id/resolve`
- 알림 테이블: `monetization_alerts`

### 2.4 Background Sync

- `reconcileMonetizationState()`:
  - 서버 시작 시 1회
  - 30분 주기 재실행

---

## 3) Verify 모드 선택 가이드

| 모드 | 권장 사용 | 동작 |
|---|---|---|
| `pending_only` | 기본 개발/안전 모드 | purchase `pending`, entitlement `inactive` 유지 |
| `auto_active` | 로컬 데모/빠른 QA | verify 성공 시 `active` 즉시 반영 |
| `receipt_inspect` | 실검증 연동 전 중간 단계 | `receipt_data` 기반 휴리스틱 상태 추론 |
| `live_verify` | 운영 권장 | Apple/Google API 실검증 수행 |

`live_verify` 세부 정책:

- `MONETIZATION_VERIFY_LIVE_STRICT=true`
  - 실검증 실패 시 즉시 에러 반환
  - 코드: `VERIFICATION_FAILED` 또는 `VERIFICATION_UNAVAILABLE`
- `MONETIZATION_VERIFY_LIVE_STRICT=false` (기본)
  - 실검증 실패 시 fallback 실행
  - `MONETIZATION_VERIFY_LIVE_FALLBACK_MODE=receipt_inspect|pending_only`

---

## 4) 환경 변수 체크리스트

### 4.1 공통

- `MONETIZATION_VERIFY_MODE`
- `MONETIZATION_VERIFY_LIVE_STRICT`
- `MONETIZATION_VERIFY_LIVE_FALLBACK_MODE`
- `MONETIZATION_VERIFY_TIMEOUT_MS`

### 4.2 Apple (live_verify)

- `MONETIZATION_APPLE_ISSUER_ID` (required)
- `MONETIZATION_APPLE_KEY_ID` (required)
- `MONETIZATION_APPLE_PRIVATE_KEY` (required)
- `MONETIZATION_APPLE_BUNDLE_ID` (optional but strongly recommended)
- `MONETIZATION_APPLE_ENV` (`sandbox|production`)

### 4.3 Google (live_verify)

- `MONETIZATION_GOOGLE_PACKAGE_NAME` (required)
- `MONETIZATION_GOOGLE_SERVICE_ACCOUNT_EMAIL` (required)
- `MONETIZATION_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (required)
- 또는 `MONETIZATION_GOOGLE_SERVICE_ACCOUNT_JSON` (대체 가능)

### 4.4 Webhook 인증

- `MONETIZATION_WEBHOOK_SECRET` (공통)
- 또는 provider 전용:
  - `MONETIZATION_APPLE_WEBHOOK_SECRET`
  - `MONETIZATION_GOOGLE_WEBHOOK_SECRET`

---

## 5) 사전 점검 (Preflight)

실행:

```bash
npm run verify:monetization:preflight
```

해석:

- `READY`: 해당 provider 실검증 준비 완료
- `NOT READY`: 필수 키 누락
- 현재 모드가 `live_verify`가 아니면 missing이어도 즉시 장애는 아님

운영 권장:

1. preflight를 CI/CD 배포 전 단계에 포함
2. `live_verify + strict=true` 전환 전 반드시 Apple/Google 모두 `READY` 확인

---

## 6) API 동작 시나리오

### 6.1 Verify 성공 시

1. `/api/purchases/verify`
2. `purchases.status` 반영
3. `reconcileMonetizationState()` 실행
4. `user_entitlements` 활성/비활성 동기화

### 6.2 Verify 실패 시

- strict=true: 실패 즉시 에러
- strict=false: fallback 모드로 변환하여 처리 지속

### 6.3 Webhook 매칭 성공 시

1. 이벤트 저장 (`monetization_webhook_events`)
2. purchase 매칭
3. purchase 상태 업데이트
4. entitlement reconcile
5. 이벤트 상태 `processed`

### 6.4 Webhook 매칭 실패 시

1. 이벤트 상태 `ignored`
2. `WEBHOOK_PURCHASE_NOT_FOUND` 알림 생성
3. admin에서 확인 후 수동 reconcile 또는 원인 해결

---

## 7) 운영 대응 절차 (Triage)

### 7.1 알림 확인

```bash
GET /api/admin/monetization/alerts?status=open
```

우선순위:

1. `error` 레벨
2. `warn` 레벨 중 반복 발생
3. 누락 지급 의심 사용자 문의 건

### 7.2 이벤트 추적

```bash
GET /api/admin/monetization/webhook-events?process_state=failed
GET /api/admin/monetization/webhook-events?process_state=ignored
```

확인 항목:

- `provider`, `event_id`
- `transaction_id` / `purchase_token`
- `process_message`
- `purchase_id`, `user_id` 매칭 여부

### 7.3 상태 복구

필요 시:

```bash
POST /api/admin/purchases/reconcile
POST /api/admin/monetization/reconcile
```

복구 후:

```bash
POST /api/admin/monetization/alerts/:id/resolve
```

---

## 8) 수동 검증 시나리오 (릴리즈 체크)

1. `live_verify + strict=false`에서 verify 요청 시 fallback 포함 정상 응답 확인
2. `live_verify + strict=true` + 키 누락 상태에서 `VERIFICATION_UNAVAILABLE` 확인
3. Google webhook(매칭 실패) 인입 시 이벤트 `ignored` + alert 생성 확인
4. Apple webhook(매칭 성공) 인입 시 purchase/entitlement 상태 반영 확인
5. admin alert resolve 후 open 목록에서 제거되는지 확인

---

## 9) 배포 체크리스트

배포 전:

- [ ] `npm run verify:monetization:preflight` 실행
- [ ] `live_verify` 설정값 확인 (`strict`, `fallback_mode`)
- [ ] webhook secret 설정 확인
- [ ] `migrations/0011_create_monetization_webhook_tables.sql` 적용 확인

배포 직후:

- [ ] `/api/store/catalog` 정상 응답
- [ ] `/api/purchases/verify` 샘플 호출 확인
- [ ] webhook test event 1건 인입 확인
- [ ] admin alerts/webhook-events 조회 확인

---

## 10) 알려진 후속 과제

- Apple/Google 웹훅 서명 검증 고도화
- 알림 채널 연동(Slack/Email/Pager)
- webhook 재처리(replay) 전용 관리자 API
- provider별 장애율/지연 메트릭 대시보드
