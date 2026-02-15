# 2026-02-13 Feed Image Render PoC Plan

- 브랜치: `feat/feed-image-render-poc`
- 목적: Explore 텍스트 오버레이(CSS) 방식 대신 서버 이미지 렌더링으로 품질/일관성 확보

## 진행 상태 (2026-02-13)
- `sharp` 기반 서버 렌더러 추가 완료 (`utils/feedImageRenderer.js`)
- API 추가 완료: `GET /api/feed-images/post/:postId?template=paper01&scale=2`
- 템플릿 리소스 추가 완료:
  - `public/img/feed-templates-v2/paper-source-01.jpg`
  - `public/img/feed-templates-v2/paper-source-02.jpg`
- Explore 카드 연결 완료:
  - Explore에서 렌더 이미지 우선 사용
  - 이미지 로드 실패 시 기존 텍스트 카드 fallback 표시
- 타이포 튜닝 반영:
  - `scale=2`에서 최종 합성 해상도 기준으로 폰트/행간 계산
  - 글자 크기, 줄간격, 좌상단/여백 비율 재보정(v3)

## 1) 배경과 문제
- 현재 CSS 오버레이는 브라우저별 폰트 렌더링 차이, 줄바꿈 차이, 반응형 스케일 영향으로 미세 정렬이 흔들림
- 짧은 글/중간 글/긴 글의 미감 유지가 어렵고, 안전영역 튜닝 비용이 반복적으로 발생
- 목표 레퍼런스(1~3번 이미지)처럼 "종이 위 인쇄된 문장" 느낌을 안정적으로 재현하려면 픽셀 단위 조판이 필요

## 2) 기술 방향(결정)
- 선택: 서버 렌더링 기반 이미지 생성 파이프라인
- 비선택: Playwright/브라우저 캡처 기반 렌더링
  - 이유: 현재 환경에서 WebKit/Chrome headless 런타임 크래시가 반복 발생

### 권장 스택
- `@napi-rs/canvas` (텍스트 조판 + 합성)
- `sharp` (최종 리사이즈/압축/WebP 변환)

## 3) PoC 범위 (1차)
- 템플릿 1개(`paper-source-01.jpg`)만 적용
- 길이 구간 3개만 우선 지원
  - short / medium / long (xlong은 fallback)
- 출력 포맷
  - `image/webp` 1x, 2x
- Explore 카드에서 렌더 이미지 우선, 실패 시 기존 텍스트 카드 fallback

## 4) 렌더 규칙 (초안)
- 입력: `post.id`, `title`, `content`, `category`, `updated_at`
- 조판:
  - HTML 제거 후 plain text 조판
  - 한글 기준 단어 경계 우선 줄바꿈 + 강제 줄바꿈 fallback
  - 구간별 텍스트 박스(안전영역) 고정
- 스타일:
  - 폰트: Noto Serif KR
  - 텍스트 색: 진한 잉크 톤(현재 CSS 기준보다 약간 진하게)
  - 줄간격: CSS 대비 소폭 축소(레퍼런스 톤 유지)
- 캐시 키:
  - `postId + content_hash + template + scale`

## 5) API/파일 구조 (제안)
- `utils/feedImageRenderer.js`
  - `renderFeedCardImage({ post, templateKey, scale })`
- `routes/feedImageRoutes.js`
  - `GET /api/feed-images/post/:postId?template=paper01&scale=2`
- 캐시 경로
  - `tmp/feed-image-cache/{cacheKey}.webp`

## 6) 구현 단계
1. PoC 렌더 유틸 작성
- 템플릿 원본 로드
- 텍스트 박스/조판/합성
- 단일 이미지 파일 저장

2. API 라우트 연결
- 미스 시 생성, 히트 시 바로 반환
- `Cache-Control`, `ETag` 설정

3. Explore 연결
- 카드 이미지 레이어를 렌더 URL로 교체
- 로딩 실패 시 기존 CSS 텍스트 방식 fallback

4. 품질 튜닝
- short/medium/long 3구간 안전영역 보정
- 텍스트 농도, 줄간격, 여백 조정

5. 운영성 체크
- 생성 시간, 캐시 히트율 로그
- 과도한 파일 증가 방지(간단한 LRU/만료)

## 7) 테스트 데이터 (확보)
- 기존 더미 계정 `user_id=56` 기준
  - `[UI TEST] short-1`
  - `[UI TEST] medium-1`
  - `[UI TEST] medium-2`
  - `[UI TEST] long-1`

## 8) 완료 기준 (DoD)
- 동일 포스트가 어떤 브라우저에서 봐도 텍스트 위치/줄바꿈이 동일
- short/medium/long 카드가 레퍼런스(1~3) 톤에 근접
- API 실패 시 기존 텍스트 렌더 fallback이 정상 동작
- Explore 성능 저하가 체감되지 않음(캐시 히트 기준)

## 9) 오픈 이슈
- 폰트 파일 번들링 방식(서버 환경 고정)
- 캐시 디렉터리 정책(정리 주기/용량 상한)
- xlong 처리 전략(즉시 fallback vs 2페이지 템플릿)
