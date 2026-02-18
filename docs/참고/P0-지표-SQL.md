# P0 지표 SQL

대상 DB: `data/live/users.db`

```bash
sqlite3 data/live/users.db
```

## 1) 주 KPI: `first_post_24h_rate`

코호트 기준: `verify_email_success`를 완료한 신규 사용자

```sql
WITH cohort AS (
  SELECT
    user_id,
    MIN(created_at) AS verified_at
  FROM ux_events
  WHERE event_name = 'verify_email_success'
    AND datetime(created_at) >= datetime('now', '-28 day')
  GROUP BY user_id
),
first_post AS (
  SELECT
    user_id,
    MIN(created_at) AS first_post_at
  FROM posts
  GROUP BY user_id
)
SELECT
  COUNT(*) AS cohort_users,
  SUM(
    CASE
      WHEN fp.first_post_at IS NOT NULL
       AND ((julianday(fp.first_post_at) - julianday(c.verified_at)) * 24.0) BETWEEN 0 AND 24
      THEN 1 ELSE 0
    END
  ) AS first_post_24h_users,
  ROUND(
    100.0 * SUM(
      CASE
        WHEN fp.first_post_at IS NOT NULL
         AND ((julianday(fp.first_post_at) - julianday(c.verified_at)) * 24.0) BETWEEN 0 AND 24
        THEN 1 ELSE 0
      END
    ) / NULLIF(COUNT(*), 0),
    2
  ) AS first_post_24h_rate
FROM cohort c
LEFT JOIN first_post fp ON fp.user_id = c.user_id;
```

## 2) 보호지표: `verify_email_failure_rate`

분모: `verify_email_submit`
분자: `verify_email_error`

```sql
SELECT
  SUM(CASE WHEN event_name = 'verify_email_submit' THEN 1 ELSE 0 END) AS verify_submit_count,
  SUM(CASE WHEN event_name = 'verify_email_error' THEN 1 ELSE 0 END) AS verify_error_count,
  ROUND(
    100.0 * SUM(CASE WHEN event_name = 'verify_email_error' THEN 1 ELSE 0 END)
    / NULLIF(SUM(CASE WHEN event_name = 'verify_email_submit' THEN 1 ELSE 0 END), 0),
    2
  ) AS verify_email_failure_rate
FROM ux_events
WHERE datetime(created_at) >= datetime('now', '-28 day')
  AND event_name IN ('verify_email_submit', 'verify_email_error');
```

## 3) 보호지표: `post_create_error_rate`

분모: `post_create_submit`
분자: `post_create_error`

```sql
SELECT
  SUM(CASE WHEN event_name = 'post_create_submit' THEN 1 ELSE 0 END) AS post_submit_count,
  SUM(CASE WHEN event_name = 'post_create_error' THEN 1 ELSE 0 END) AS post_error_count,
  ROUND(
    100.0 * SUM(CASE WHEN event_name = 'post_create_error' THEN 1 ELSE 0 END)
    / NULLIF(SUM(CASE WHEN event_name = 'post_create_submit' THEN 1 ELSE 0 END), 0),
    2
  ) AS post_create_error_rate
FROM ux_events
WHERE datetime(created_at) >= datetime('now', '-28 day')
  AND event_name IN ('post_create_submit', 'post_create_error');
```

## 4) 일자별 KPI 추이

```sql
WITH cohort AS (
  SELECT
    user_id,
    DATE(MIN(created_at)) AS cohort_day,
    MIN(created_at) AS verified_at
  FROM ux_events
  WHERE event_name = 'verify_email_success'
    AND datetime(created_at) >= datetime('now', '-28 day')
  GROUP BY user_id
),
first_post AS (
  SELECT user_id, MIN(created_at) AS first_post_at
  FROM posts
  GROUP BY user_id
)
SELECT
  c.cohort_day,
  COUNT(*) AS cohort_users,
  SUM(
    CASE
      WHEN fp.first_post_at IS NOT NULL
       AND ((julianday(fp.first_post_at) - julianday(c.verified_at)) * 24.0) BETWEEN 0 AND 24
      THEN 1 ELSE 0
    END
  ) AS first_post_24h_users,
  ROUND(
    100.0 * SUM(
      CASE
        WHEN fp.first_post_at IS NOT NULL
         AND ((julianday(fp.first_post_at) - julianday(c.verified_at)) * 24.0) BETWEEN 0 AND 24
        THEN 1 ELSE 0
      END
    ) / NULLIF(COUNT(*), 0),
    2
  ) AS first_post_24h_rate
FROM cohort c
LEFT JOIN first_post fp ON fp.user_id = c.user_id
GROUP BY c.cohort_day
ORDER BY c.cohort_day DESC;
```
