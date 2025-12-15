# CLI 단축어 모음 (zshrc)

> VS Code UI 대신, 자주 쓰는 작업을 CLI로 빠르게 하기 위한 alias/함수 모음

---

## 글숲 전용 스크립트

- `glsoop-archive`  
  글숲 프로젝트를 민감/불필요 파일 제외하고 tar.gz로 아카이브 생성  
  실행: `~/2026/workspace/scripts/glsoop-archive.sh`

- `glsoop-db-backup`  
  SQLite DB를 안전 스냅샷(.backup)으로 백업하고, 최신 30개만 유지(자동 삭제)  
  실행: `~/2026/workspace/scripts/glsoop-db-backup.zsh`

---

## Git 단축어

### 상태/로그

- `gs` → `git status -sb`  
  현재 브랜치 + 변경사항을 요약해서 보기 좋게 출력

- `gl` → `git log --oneline -10`  
  최근 커밋 10개를 한 줄 요약으로 출력

- `gt` → `git log --oneline --graph --decorate --all -20`  
  브랜치 분기/병합을 그래프 형태로 출력(트리 느낌)

---

### 브랜치

- `gba` → `git branch -a`  
  로컬 + 원격 브랜치 목록 출력

- `gco` → `git checkout`  
  브랜치 이동/생성(레거시 명령)

- `gsw` → `git switch`  
  브랜치 이동(더 안전/직관)

- `gswc` → `git switch -c`  
  새 브랜치 생성 + 이동

---

### 원격 동기화/정리

- `gpl` → `git pull`  
  원격 변경사항 가져와서 반영

- `gp` → `git push`  
  현재 브랜치를 원격으로 push

- `gpu` → `git push -u origin HEAD`  
  새 브랜치 첫 push(추적 설정까지 같이)

- `gfp` → `git fetch -p`  
  원격 정보 갱신 + 삭제된 원격 브랜치 prune

---

## 안전한 브랜치 삭제 함수

- `gdel <branch>`  
  현재 브랜치 삭제를 방지하고, 안전 삭제(`git branch -d`)를 수행  
  사용 예: `gdel feature/old-branch`

---
