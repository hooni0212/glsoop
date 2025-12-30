# GLS CSS Architecture (Single Source of Truth)

## Layer Order (1st Law)
tokens → base → vendor → shells → components(all) → pages → themes

## Ownership (Authoritative Files)

### Tokens
- public/css/tokens.css
  - colors, spacing, radius, shadow, z-index, typography scale

### Base
- public/css/base.css
  - reset, body, typography defaults, global layout primitives
  - ❌ no buttons, cards, chips, tabs here

### Vendor / Bootstrap
- public/css/vendor/bootstrap-overrides.css
  - Bootstrap 클래스(.btn, .modal 등) 보정
  - ❌ 컴포넌트/페이지/테마 스타일은 이 파일에 추가하지 말 것

### Shells
- public/css/shells/page-shell.css
- public/css/shells/readability.css
  - shared page layout & reading experience

### Components (Single Owner Rule)
- Surface / Panels → components/surfaces.css
- Buttons / Chips → components/buttons-chips.css
- Tabs / Segmented → components/segmented.css
- Forms → components/forms.css
- Cards / Feed / Quote → components/card.css (+ feed-preview.css, quote-card.css)
- Modals → components/modals.css
- Actions → components/actions.css

### Pages
- public/css/pages/*.css
  - layout & page-only adjustments
  - ❌ no redefinition of component styles

### Themes
- public/css/themes/*.css
  - variable overrides first
  - selector overrides only when unavoidable
  - ❌ no component ownership here

### Legacy / Compat (Temporary)
- components/_legacy-components.css
- components/theme-winter-compat.css
  - scheduled for removal after migration
