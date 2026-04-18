# Notion Sync

기본적으로 `docs/work-notes/*.md`를 Notion 데이터베이스 페이지로 동기화합니다.

지금부터는 문서 메타데이터 기반 opt-in sync도 지원합니다. 다만 기존 `work-notes` 흐름은 그대로 유지됩니다.

## 1) 한 번만 설정
프로젝트 루트 `.env`에 아래 값을 넣습니다.

```env
NOTION_API_KEY=...
NOTION_DATABASE_ID=...
```

이미 이 프로젝트에는 값이 세팅되어 있으므로 바로 실행 가능합니다.

## 2) 매일 사용하는 명령
드라이런(실제 반영 없음):

```bash
npm run sync:notion:dry
```

실제 반영:

```bash
npm run sync:notion
```

## 3) 동작 규칙

### 기본 모드(하위호환)
- 파일 경로: `docs/work-notes/*.md`
- 페이지 제목: 파일명(`YYYY-MM-DD.md` -> `YYYY-MM-DD`)
- upsert 방식:
  - 같은 제목이 있으면 `UPDATE`
  - 없으면 `CREATE`
- 파일명이 `YYYY-MM-DD` 형식이면 DB의 date 속성에도 날짜를 넣습니다.

### 메타데이터 opt-in 모드
- `NOTION_NOTES_DIR=docs`처럼 더 넓은 경로를 지정하면 기본적으로 opt-in 문서만 sync합니다.
- 문서 상단에 `- Notion Sync: \`true\`` 가 있어야 sync 대상이 됩니다.
- `- Notion Database: \`qa-hub\`` 같은 alias를 쓰면 alias별 DB로 분기할 수 있습니다.
- `- Notion Title`, `- Notion Date`, `- QA Category`, `- QA Result` 같은 메타데이터는 DB 속성으로 매핑할 수 있습니다.

## 4) Notion 쪽 필수 조건
- 대상 데이터베이스에 Integration을 `Invite` 해야 합니다.
- Integration에 페이지 생성/수정 권한이 있어야 합니다.

## 5) 선택 설정(필요할 때만)
- `NOTION_NOTES_DIR` (기본값: `docs/work-notes`)
- `NOTION_DATE_PROPERTY` (기본값: DB의 첫 date 타입 속성 자동 선택)
- `NOTION_SYNC_DRY_RUN` (`true`면 시뮬레이션)
- `NOTION_REQUIRE_OPT_IN` (`true`면 어떤 경로에서도 opt-in 문서만 sync)
- `NOTION_DATABASE_MAP_JSON` (예: `{"work-notes":"...", "qa-hub":"..."}`)
- `NOTION_DATABASE_MAP_FILE` (alias -> database id JSON 파일 경로)

## 6) 문서 메타데이터 예시

```md
# 문서 제목

- 문서 타입: `Checklist`
- 상태: `Review`
- 최종 업데이트: `2026-04-15`
- Owner: `taehun`
- Notion Sync: `true`
- Notion Database: `qa-hub`
- Notion Title: `Growth Release Gate`
- Notion Tags: `qa, release`
- QA Category: `Release Gate`
- QA Result: `Partial`
```

## 7) 자주 발생하는 문제
- `...is a page, not a database`:
  - `NOTION_DATABASE_ID`에 페이지 ID를 넣은 경우입니다. DB 링크의 ID로 교체하세요.
- 검색 결과가 비어 있음:
  - DB에 Integration Invite가 안 된 상태입니다.
- `Database alias "qa-hub" is not configured`:
  - `NOTION_DATABASE_MAP_JSON` 또는 `NOTION_DATABASE_MAP_FILE`에 alias 매핑이 없습니다.

## 8) alias로 더 짧게 쓰고 싶다면(선택)
`~/.zshrc`에 추가:

```bash
alias nsync='cd /Users/gimtaehun/2026/workspace/projects/glsoop-mobile && npm run sync:notion'
alias nsyncd='cd /Users/gimtaehun/2026/workspace/projects/glsoop-mobile && npm run sync:notion:dry'
```

적용:

```bash
source ~/.zshrc
```
