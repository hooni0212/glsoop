# GLS CSS Architecture
- 목차: 1) 목표/레이어 순서 2) 디렉터리 맵 3) Bootstrap ↔ GLS 경계 4) 토큰/테마 5) 추가 규칙
- 이유: Bootstrap을 교체해도 GLS 디자인 시스템이 주인이 되도록, 책임 영역을 명확히 분리합니다.

## 1. Layer Order (로드 순서)
tokens → base → vendor/bootstrap-overrides → shells → components(all) → pages → themes

## 2. 디렉터리 맵 (어디에 넣을 것인가)
| 경로 | 역할 | 비고 |
| --- | --- | --- |
| `/public/css/app.css` | 단일 진입점(import 모음) | HTML에서는 이것만 링크 |
| `/public/css/gls/tokens.css` | 디자인 토큰(색/폰트/spacing/radius/shadow/z-index/motion) | 값만 정의, 로직 없음 |
| `/public/css/gls/base.css` | reset, 기본 타이포/배경/레이아웃 primitives | 버튼/카드 등 컴포넌트 금지 |
| `/public/css/vendor/bootstrap-overrides.css` | Bootstrap 클래스(.btn/.dropdown/.navbar 등) 덮어쓰기 & 유틸리티 shims | GLS 컴포넌트 정의 금지 |
| `/public/css/gls/shells/*.css` | 페이지 크롬(page shell, readability) | 헤더/푸터/읽기 영역 틀 |
| `/public/css/gls/components/*.css` | 재사용 GLS 컴포넌트 | Single-owner 원칙 |
| `/public/css/gls/pages/*.css` | 페이지 전용 레이아웃/보정 | 컴포넌트 재정의 금지 |
| `/public/css/gls/themes/*.css` | 테마 변수/장식(배경/애니메이션) | 변수 우선, 셀렉터 최소 |

### 주요 컴포넌트 소유권
- Surface → `gls/components/surfaces.css`
- Buttons/Chips → `gls/components/buttons-chips.css`
- Segmented/Tabs → `gls/components/segmented.css`
- Forms → `gls/components/forms.css`
- Cards/Feed/Quote → `gls/components/card.css`, `feed-preview.css`, `quote-card.css`
- Modals → `gls/components/modals.css`
- Actions → `gls/components/actions.css`
- Tabs (페이지 컨텍스트) → `gls/components/mypage-tabs.css`, `admin-tabs.css`

## 3. Bootstrap ↔ GLS 경계 규칙
- Bootstrap override 전용: `vendor/bootstrap-overrides.css`
  - 포함: `.btn*`, `.navbar*`, `.dropdown*`, spacing 유틸(.mb-1 등) 같은 **Bootstrap 클래스 이름**만.
  - 목적: CDN Bootstrap을 대체하거나 제거해도 기존 마크업이 깨지지 않게 하는 보호막.
  - 금지: `.gls-*` 컴포넌트 정의, 테마 변수 선언.
- GLS 전용: `gls/**` 하위
  - 포함: glass surface, segmented, badge, shell, 페이지 레이아웃, 테마 변수.
  - Bootstrap 클래스가 필요할 때는 **컨텍스트 주석**으로 이유를 남기고, 재사용 가능 형태만 둡니다.
- 테마 파일(`gls/themes/*`): 가능하면 변수 덮어쓰기로 끝내고, 셀렉터 override는 마지막 수단만 사용합니다.

## 4. 토큰과 테마
- 디자인 토큰: `/public/css/gls/tokens.css`
  - 색/폰트/spacing/radius/shadow/z-index/motion 값의 단일 소스.
  - 새 변수는 여기서만 추가하고, 컴포넌트/페이지에서는 **값 대신 토큰**을 사용합니다.
- 테마(`gls/themes/*.css`)
  - 우선순위: 1) 토큰 override → 2) 필요한 최소 셀렉터 장식(배경, 애니메이션).
  - `.winter-theme` 등 body 클래스 기반, JS(`public/js/theme.js`)에서 href를 `/css/gls/themes/*.css`로 교체합니다.

## 5. 새 CSS 추가 시 규칙 (Checklist)
- 재사용 컴포넌트인가? → `gls/components/` 새 파일 또는 기존 소유 파일에 추가.
- 페이지 단독 레이아웃/보정인가? → 해당 페이지의 `gls/pages/{page}.css`.
- Bootstrap 클래스 오버라이드가 필요한가? → `vendor/bootstrap-overrides.css` 안 새 섹션 추가(What/Scope/Where 주석 포함).
- 토큰이 필요한가? → 값을 직접 쓰지 말고 `gls/tokens.css`에 정의 후 사용.
- 임포트 순서 유지: `app.css` 내부 순서(tokens → base → vendor → shells → components → pages → themes)를 변경하지 말 것.
