# tokens.css 설계안 (tar.gz 기준 v1)

이 문서는 **glsoop_main_2025-12-23_00-09-07.tar.gz**(업로드본) 기준으로,
현재 `public/css/base.css` 안에 섞여있는 `:root` 변수를 **tokens.css로 분리**하기 위한 설계안이다.

---

## 1) 목표

- `tokens.css` = **값만**(색/간격/라운드/섀도/타이포/레이아웃 토큰)
- `base.css` / `components.css` / `pages/*.css` = **규칙만**(셀렉터/구조), 값은 `var(--token)`으로 참조
- `themes/*.css` = **변수 덮어쓰기만**(색/톤), 구조 셀렉터 금지

> 특히 `themes/winter-theme.css`는 최종적으로 **토큰 덮어쓰기**만 남기는 것이 목표.

---

## 2) 현 상태(업로드본) 요약

- `public/css/base.css` 안에 `:root { ... }` 변수가 약 **113개** 존재
- `themes/winter-theme.css`의 `body.winter-theme { ... }`에는 변수 25개가 덮어쓰기 형태로 존재하지만,
  파일 전체는 약 700줄대로 커져 있음(구조/컴포넌트 규칙이 섞인 상태)

---

## 3) 제안: tokens.css 파일(초안 v1)

- 아래 파일은 **base.css의 :root 변수들을 그대로 흡수**하고,
  추가로 **font/motion/z-index** 토큰을 더해 정리한 버전이다.
- 변수명은 기존 것을 최대한 유지해서 “첫 분리” 단계에서 충돌을 최소화한다.

📄 파일: `public/css/tokens.css` (v1)  
(첨부 파일: `glsoop_tokens_design_v1.css`)

---

## 4) 적용(리팩토링 시작) 가이드

### 4-1) 파일 추가/이동
1. `public/css/tokens.css` 생성 (첨부 v1 내용으로 시작)
2. `public/css/base.css`에서 `:root { ... }` 블록 제거  
   - 또는 임시로 남겨두되, 최종적으로는 tokens.css로만 유지

### 4-2) 로드 순서(중요)
HTML에서 CSS 로드 순서를 통일한다.

권장:
1) tokens.css  
2) base.css  
3) components.css  
4) pages/*.css  
5) themes/*.css (선택적으로 마지막)

예시:
```html
<link rel="stylesheet" href="/css/tokens.css">
<link rel="stylesheet" href="/css/base.css">
<link rel="stylesheet" href="/css/components.css">
<link rel="stylesheet" href="/css/main.css"> <!-- 또는 pages/index.css -->
<link rel="stylesheet" href="/css/themes/winter-theme.css">
```

---

## 5) 테마 파일 규칙 (겨울 테마 다이어트용)

테마 파일은 최종적으로 아래만 허용:

- `body.winter-theme { --token: value; ... }`
- (예외) 배경 이미지/안개 레이어 같은 “테마 장식” 1~2개 셀렉터

금지:
- `.card { ... }`, `.navbar { ... }` 같은 **컴포넌트 구조 스타일**

---

## 6) 다음 단계(우리가 바로 이어서 할 작업)

1) `winter-theme.css`에서 **변수 덮어쓰기 블록을 제외한 규칙들을 분류**
   - components로 갈 것 / pages로 갈 것 / theme 장식으로 남길 것
2) 컴포넌트 CSS에서 **직접 색상값(#hex, rgba) 제거 → 토큰화**
3) ui-kit에서 테마 토글로 깨짐 여부 체크

---

## 7) 첨부

- `glsoop_tokens_design_v1.css` : tokens.css 초안 (기존 변수 + font/motion/z-index 포함)

