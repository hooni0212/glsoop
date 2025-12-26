# 글숲 UI-Kit & 테마 리팩토링 설계 문서

## 1. 목적과 배경

글숲 프로젝트는 현재 다음과 같은 문제를 안고 있다.

- CSS 파일 간 **중복 규칙이 많고**, 수정 지점이 불명확함
- Bootstrap 의존도가 높아 **구조를 이해·개선하기 어려움**
- winter-theme.css가 구조/컴포넌트/색상 역할을 모두 포함해 **비대해짐**
- UI 일관성을 강제할 기준점(Source of Truth)이 없음

이에 따라 이번 리팩토링의 핵심 목표는:

1. **ui-kit을 모든 UI의 기준(컴포넌트 카탈로그)**으로 만들기
2. **CSS 구조를 토큰 → 컴포넌트 → 페이지 → 테마**로 재정립하기
3. **테마 CSS는 색상/톤 변수만 담당**하도록 단순화하기
4. Bootstrap 의존도를 단계적으로 제거할 수 있는 기반 만들기

---

## 2. UI-Kit의 역할 정의

### 2.1 UI-Kit의 정체성

ui-kit은 다음 역할을 동시에 수행한다.

- 글숲 디자인 시스템의 **표준 문서**
- 실제 서비스에 사용되는 **모든 UI 컴포넌트의 카탈로그**
- Bootstrap 대체 UI를 검증하는 **실험 공간**
- 테마 변경 시 UI 깨짐 여부를 확인하는 **검증 페이지**

### 2.2 UI-Kit에 포함되어야 할 요소

서비스에서 실제 사용되는 모든 UI를 포함한다.

- 버튼(Button)
- 카드(Card)
- 칩/태그(Chip)
- 네비게이션 바(Navbar)
- 드롭다운(Dropdown)
- 모달(Modal)
- 폼(Form)
- 입력 요소(Input, Textarea)
- 토스트/알림(Toast)
- 레이아웃 컨테이너(Container)

각 컴포넌트는 다음 상태를 반드시 포함한다.

- default
- hover
- active
- disabled
- focus-visible
- loading (필요 시)
- error (폼 요소)

---

## 3. CSS 아키텍처 재설계

### 3.1 권장 디렉토리 구조

```
public/css/
├── tokens.css              # 디자인 토큰 (색, 폰트, 간격, 그림자)
├── base.css                # reset + 기본 타이포/레이아웃
├── components/
│   ├── button.css
│   ├── card.css
│   ├── chip.css
│   ├── navbar.css
│   ├── modal.css
│   ├── form.css
│   └── utilities.css
├── pages/
│   ├── index.css
│   ├── post.css
│   ├── editor.css
│   ├── mypage.css
│   └── admin.css
└── themes/
    ├── winter.css
    ├── spring.css
    ├── summer.css
    └── autumn.css
```

### 3.2 레이어별 책임

- tokens.css  
  - 색상, 배경, 텍스트, 그림자, 라운드, 간격 등 **값만 정의**
- base.css  
  - reset, 기본 폰트, body 기본 스타일
- components  
  - 재사용 가능한 UI 부품
  - **직접 색상값 금지 → 변수만 사용**
- pages  
  - 특정 페이지 전용 배치/조립 스타일
- themes  
  - **CSS 변수 덮어쓰기만 허용**
  - 구조/레이아웃/컴포넌트 셀렉터 사용 금지

---

## 4. 테마 CSS 리팩토링 전략

### 4.1 문제 요약

- winter-theme.css가 약 700줄 이상
- 컴포넌트/페이지 구조까지 직접 제어 중
- 다른 테마 대비 유지보수 비용이 매우 큼

### 4.2 목표 상태

- 테마 CSS는 다음만 담당:
  - 배경색
  - 표면색
  - 텍스트 색
  - 강조색
  - 그림자 톤
  - (예외) 배경 이미지/안개 같은 시각 장식

### 4.3 실행 원칙

1. 모든 컴포넌트 CSS에서 **직접 색상값 제거**
2. 색상/톤 관련 값은 전부 tokens.css 변수로 치환
3. winter-theme.css에는 다음 형태만 남김

```css
body.winter-theme {
  --gls-bg: #0f172a;
  --gls-surface: rgba(255,255,255,0.08);
  --gls-text: #e5e7eb;
  --gls-muted: #9ca3af;
  --gls-accent: #93c5fd;
  --gls-shadow: 0 10px 30px rgba(0,0,0,0.25);
}
```

---

## 5. 레거시 UI 프레임워크 의존도 제거 전략 (완료)

### 5.1 제거 순서

1. ui-kit에서 레거시 프레임워크 없이 동작하는 컴포넌트 확정
   - Navbar
   - Dropdown
   - Modal
   - Container/Grid
2. JS에서 `legacy framework.*` 호출 제거
3. 페이지 단위로 레거시 클래스 제거
4. 레거시 CSS/JS 로드 제거

### 5.2 핵심 원칙

- **대체 컴포넌트가 준비되기 전에는 제거하지 않는다**
- 항상 ui-kit → 페이지 이식 순서로 진행

---

## 6. 리팩토링 1차 체크리스트

- [ ] ui-kit 컴포넌트 목록 확정
- [ ] tokens.css 정비 (테마 변경 가능 변수 정의)
- [ ] winter-theme.css 규칙 분류 (컴포넌트/페이지/테마)
- [ ] 구조 CSS를 원래 소속 파일로 이동
- [ ] ui-kit에서 테마 토글 테스트
- [x] 레거시 대체 컴포넌트 구현 시작

---

## 7. 최종 기대 상태

- ui-kit = 글숲 UI의 단일 기준(Source of Truth)
- 새 UI 추가 시:
  1. ui-kit에 컴포넌트 추가
  2. 페이지에 조립
  3. 중복 CSS 제거
- 테마 추가/수정이 **변수 몇 개 변경으로 끝남**
- UI 수정 비용과 실수 확률이 크게 감소

---

이 문서는 글숲 UI 리팩토링의 기준 문서로 사용된다.
