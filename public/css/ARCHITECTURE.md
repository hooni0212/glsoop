# GLS CSS 아키텍처

## 0. 목적과 원칙
- **목표:** Bootstrap을 교체해도 GLS 디자인 시스템이 유지되도록 GLS 영역과 Bootstrap 오버라이드를 분리.
- **레이어 순서:** tokens → base → vendor(bootstrap-overrides) → shells → components → pages → themes.
- **이유:** 토큰/베이스를 먼저 고정하고 벤더 오버라이드로 기존 마크업을 보호한 뒤 GLS 컴포넌트/페이지/테마를 안전하게 쌓기 위해서.

## 1. 디자인 토큰 & 베이스 (GLS 단일 소스)
- `public/css/gls/tokens.css`
  - 색/타이포/spacing/radius/shadow/z-index/블러/모션 토큰 정의.
  - **규칙:** 새 전역 값은 이곳에만 추가하고 다른 레이어에서 재정의하지 않는다.
- `public/css/gls/base.css`
  - Reset, body 기본값, 타이포 스케일, 글로벌 레이아웃 프리미티브.
  - **금지:** 버튼/카드/폼 등 컴포넌트 스타일 소유 금지.

## 2. Vendor (Bootstrap 오버라이드)
- `public/css/vendor/bootstrap-overrides.css`
  - Bootstrap 클래스(.btn, .dropdown, .modal 등)와 유틸(.d-flex, .mb-3 등) 보정.
  - **역할:** 기존 Bootstrap 마크업이 깨지지 않도록 최소 호환층 제공. GLS 토큰을 참조할 수 있지만 **GLS 전용 컴포넌트 정의는 금지**.
  - **추가 규칙:** 새 Bootstrap 보정은 여기 한 곳에만 정의하고, GLS 네임스페이스(.gls-*)는 다른 레이어로 보낸다.

## 3. GLS Shells (페이지 공통 레이아웃)
- `public/css/gls/shells/all.css` → `page-shell.css`, `readability.css` 포함.
- 목적: 페이지 공통 패딩/히어로/내비 등 레이아웃 프레임 제공.
- **규칙:** 레이아웃만 다루며 버튼/칩 등 컴포넌트 소유권은 components에 둔다.

## 4. GLS Components
- 위치: `public/css/gls/components/*.css` (집합 import: `all.css`).
- 소유 예시
  - Surface/Panel → `surfaces.css`
  - Buttons/Chips → `buttons-chips.css` (GLS 네임스페이스만)
  - Forms → `forms.css`
  - Tabs/Segmented → `segmented.css` (+ `mypage-tabs.css`, `admin-tabs.css`)
  - Cards/Feed/Quote → `card.css`, `feed-preview.css`, `quote-card.css`
  - Actions/Like/More → `actions.css`, `like.css`, `more-toggle.css`
  - Modals → `modals.css` (GLS 전용 클래스/헬퍼)
- **규칙:** 페이지 전용 조정 금지, Bootstrap 클래스 사용 금지(필요 시 vendor에서 보정 후 GLS class를 조합).

## 5. GLS Pages
- 위치: `public/css/gls/pages/*.css` (집합 import: `pages/all.css`).
- 역할: 페이지 특화 레이아웃/보정(post, mypage, author, editor, index, login 등).
- **규칙:** 공용 컴포넌트 재정의 금지. 필요한 경우 새 토큰을 직접 만들지 말고 컴포넌트에 반영을 제안.

## 6. GLS Themes
- 위치: `public/css/gls/themes/*.css` (집합 import: `themes/all.css`).
- 역할: 색상/배경/이미지 등 테마 토큰 오버라이드(winter/spring/summer/autumn 등).
- **규칙:** 가능하면 CSS 변수 오버라이드만 사용하고, 선택자 오버라이드는 최소화. Bootstrap 보정이 필요하면 vendor에 추가 후 테마에서 변수만 조정.

## 7. Bootstrap ↔ GLS 경계 규칙
1. **Bootstrap override는 vendor 한 곳**
   - `.btn`, `.modal`, `.dropdown`, `.navbar` 등 Bootstrap 클래스/유틸 이름은 `vendor/bootstrap-overrides.css`에서만 관리.
2. **GLS 네임스페이스 강제**
   - 새 컴포넌트/유틸 클래스는 반드시 `.gls-*` 접두사를 사용하고 `gls/components` 또는 `gls/shells`에 둔다.
3. **페이지 보정 분리**
   - 특정 화면 레이아웃/간격 조정은 `gls/pages/<page>.css`에 두고, 재사용 가능해지면 컴포넌트로 승격.
4. **테마 오버라이드 최소화**
   - 테마 파일은 변수 우선, 필요한 경우에만 선택자(예: hero 배경) 오버라이드.

## 8. 새 파일/컴포넌트 추가 가이드
- **토큰 추가:** `gls/tokens.css`에 새 변수 정의 → 필요한 레이어에서 변수 사용.
- **새 컴포넌트:** `gls/components/<name>.css`에 정의하고 `components/all.css`에 import 추가.
- **페이지 전용 스타일:** `gls/pages/<page>.css` 생성 후 `pages/all.css`에 import.
- **테마 추가:** `gls/themes/<theme>-theme.css` 작성 후 `themes/all.css`에 import.
- **Bootstrap 관련 보정:** 기존 마크업 호환이 목적이면 `vendor/bootstrap-overrides.css`에만 추가.

## 9. 로딩 순서(권장)
1. HTML에서는 `/css/app.css` 한 줄만 포함.
2. `app.css` 내부 `@import` 순서 유지: tokens → base → vendor → shells → components → pages → themes.
3. 페이지별 inline 스타일이 필요하다면 themes 뒤, JS 렌더 후 최소화하여 삽입.

## 10. 구조 요약 표
| 레이어 | 경로 | 소유 범위 | 금지 항목 |
| --- | --- | --- | --- |
| Tokens | `gls/tokens.css` | 전역 변수 | 컴포넌트 정의 |
| Base | `gls/base.css` | 리셋/타이포/HTML 기본 | 버튼·폼 등 소유 |
| Vendor | `vendor/bootstrap-overrides.css` | Bootstrap 클래스/유틸 보정 | GLS 전용 컴포넌트 |
| Shells | `gls/shells/*.css` | 공통 레이아웃 | 컴포넌트 소유 |
| Components | `gls/components/*.css` | 재사용 UI | 페이지 전용 보정, Bootstrap 클래스 |
| Pages | `gls/pages/*.css` | 페이지 전용 레이아웃/보정 | 공용 컴포넌트 재정의 |
| Themes | `gls/themes/*.css` | 테마 변수/배경 | 새 변수 없는 하드코딩 색상(지양) |
