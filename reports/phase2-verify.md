# Phase2 Verify Report

- Port: 4010
- DB_PATH: /workspace/glsoop/tmp/phase2_verify.sqlite
- Commit: c00aae645edcf133e6d7c8ff13938fcf54be4f6b
- Node: v22.21.1

| # | 항목 | 결과 | 증거 요약 | 수정 포인트 |
| --- | --- | --- | --- | --- |
| 1 | 관리자: 업적 템플릿 생성 시 자동 연결 | O | campaign_id=1, link_count=1 | - |
| 2 | 관리자: 템플릿 수정 시 업적 연결/해제 | O | promotion_links=1, demotion_links=0 | - |
| 3 | 관리자: 템플릿 삭제 시 링크 정리 | O | link_count=0 | - |
| 4 | Active API: 새 필드 포함 + 기존 기능 유지 | O | quest_count=1, required_ok=true, ui_ok=true | - |
| 5 | 업적 Eager assignment 금지 | O | before=0, after=0 | - |
| 6 | Claim API: 권한/상태 검증 | O | other=404, incomplete=400, second=409 | - |
| 7 | Claim 원자성(트랜잭션) | O | xp_delta=7, log_delta=1 | - |
| 8 | 타임스탬프 일관성 | O | completed_at=2026-01-26T13:17:32.226Z, reward_claimed_at=2026-01-26T04:17:32.229Z, xp_log=2026-01-26T04:17:32.229Z | - |

## Evidence Logs
- server stdout: [ENV] NODE_ENV = development
- server stdout: [db] DB_AUTOINIT is disabled; skipping schema creation/seed.
- server stdout: [dotenv@17.2.3] injecting env (0) from .env -- tip: 🔑 add access controls to secrets: https://dotenvx.com/ops
- server stdout: [dev] GMAIL_USER = glsoop1752@gmail.com
[dev] GMAIL_PASS length = 0
- server stderr: [warn] GMAIL_USER 또는 GMAIL_PASS가 없습니다. 개발 환경에서는 메일 전송이 동작하지 않을 수 있습니다.
- server stdout: journal_mode = wal
- server stdout: foreign_keys = 1
- server stdout: [migrations] skip 0001_create_schema_migrations.sql
- server stdout: [migrations] skip 0002_initial_schema.sql
- server stdout: [migrations] skip 0003_add_quest_template_metadata.sql
