# Notion Sync

`docs/work-notes/*.md`를 Notion 데이터베이스 페이지로 동기화합니다.

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
- 파일 경로: `docs/work-notes/*.md`
- 페이지 제목: 파일명(`YYYY-MM-DD.md` -> `YYYY-MM-DD`)
- upsert 방식:
  - 같은 제목이 있으면 `UPDATE`
  - 없으면 `CREATE`
- 파일명이 `YYYY-MM-DD` 형식이면 DB의 date 속성에도 날짜를 넣습니다.

## 4) Notion 쪽 필수 조건
- 대상 데이터베이스에 Integration을 `Invite` 해야 합니다.
- Integration에 페이지 생성/수정 권한이 있어야 합니다.

## 5) 선택 설정(필요할 때만)
- `NOTION_NOTES_DIR` (기본값: `docs/work-notes`)
- `NOTION_DATE_PROPERTY` (기본값: DB의 첫 date 타입 속성 자동 선택)
- `NOTION_SYNC_DRY_RUN` (`true`면 시뮬레이션)

## 6) 자주 발생하는 문제
- `...is a page, not a database`:
  - `NOTION_DATABASE_ID`에 페이지 ID를 넣은 경우입니다. DB 링크의 ID로 교체하세요.
- 검색 결과가 비어 있음:
  - DB에 Integration Invite가 안 된 상태입니다.

## 7) alias로 더 짧게 쓰고 싶다면(선택)
`~/.zshrc`에 추가:

```bash
alias nsync='cd /Users/gimtaehun/2026/workspace/projects/glsoop-mobile && npm run sync:notion'
alias nsyncd='cd /Users/gimtaehun/2026/workspace/projects/glsoop-mobile && npm run sync:notion:dry'
```

적용:

```bash
source ~/.zshrc
```
