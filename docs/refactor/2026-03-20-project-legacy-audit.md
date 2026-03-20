# 글숲 프로젝트 전반 레거시 점검

- 문서 타입: `Project Legacy Audit`
- 기준 일자: `2026-03-20`
- 상태: `Draft`
- 범위: `editor3/post3 정리 제외`

---

## 1. 목적

- 현재 저장소 전반에 남아 있는 레거시를 `죽은 파일`, `호환 코드`, `alias 경로`, `실험 플로우`, `전역 번들 과적재`로 나눠 다시 본다.
- 이번 라운드에서는 삭제보다 `유지 / 분리 후보 / 삭제 후보 / 정책 의존` 분류를 우선한다.
- 다음 삭제/정리 PR에서 근거표로 바로 사용할 수 있도록, 실제 참조 경로와 리스크를 함께 남긴다.

---

## 2. 확인 방법

- `npm run check:orphans`
  - 결과: orphan candidate `0`
  - duplicate basename group `1`
- `rg`로 실제 include/import/route 문자열 참조 확인
- 주요 진입점과 관련 문서/테스트를 함께 대조

메모:

- 이번 기준에서는 “아무도 참조하지 않는 tracked 파일”보다 “호환 때문에 남아 있는 코드”가 더 많았다.
- 따라서 정리 우선순위는 대량 삭제가 아니라 구조 명확화와 유지 사유 문서화에 가깝다.

---

## 3. 점검 결과

| 영역 | 상태 | 대상 | 현재 판단 | 근거 / 메모 |
|---|---|---|---|---|
| 인증/세션 | `정책 의존` | `middleware/auth.js`의 legacy token 허용/차단 레이어 | 유지 | `tests/e2e/auth-legacy-deprecation.spec.js`, `docs/서버/API/인증-쿠키-세션-정책.md`, `public/js/auth-form-utils.js`가 현재 계약에 의존한다. 운영 정책이므로 UI 정리와 별개로 다뤄야 한다. |
| 마이그레이션 | `정책 의존` | `utils/migrations.js`의 `baseline_legacy` | 유지 | 문서/테스트 직접 참조는 약하지만, 기존 DB를 baseline으로 편입시키는 안전장치다. 제거는 “신규/기존 DB 마이그레이션 경로가 완전히 검증된 뒤” 별도 작업으로 진행해야 한다. |
| URL 호환 alias | `유지` | `public/html/category.html` | 유지 | 제품 내부 링크는 거의 없지만, 기존 공유 URL/bookmark 호환용 shim이다. 외부 링크 가능성이 있는 alias는 기본값으로 유지한다. |
| 실험 에디터 | `분리 후보` | `public/html/editor2.html`, `public/js/editor2.js`, `public/js/editor2LayoutEditor.js`, `public/css/pages/editor2.css` | 유지하되 메인 플로우에서 낮춤 | `public/html/editor3.html`이 “실험 에디터 보기”로 연결하고, 루트 alias `public/editor2.html`, 운영 문서 `docs/참고/API-레퍼런스.md`, `docs/운영/작업-프로토콜.md`도 참조한다. 즉시 삭제보다는 `legacy-experimental` 성격으로 분리하는 편이 안전하다. |
| 전역 CSS 번들 | `분리 후보` | `public/css/pages/all.css` | 1차 정리 완료 | 페이지 전용 CSS를 전역 번들에서 분리하고, 각 HTML에서 직접 로드하도록 정리했다. 남은 과제는 추가 실험 페이지가 다시 전역 import로 섞이지 않게 관리하는 것이다. |
| 이미지 렌더 preview | `유지` | `routes/feedImageRoutes.js`의 `/feed-images/preview` | 유지 | `public/js/editor.js`, `public/js/editor2.js`, `public/js/post3.js`에서 실제로 사용 중이다. preview route는 아직 레거시라기보다 active dependency에 가깝다. |
| 이미지 렌더 fallback | `유지` | `utils/feedImageRenderer.js`의 legacy preset fallback | 유지 | `layout_json`이 없거나 legacy 데이터일 때 기존 preset 렌더를 유지하는 계약이 문서화되어 있다. `docs/참고/API-레퍼런스.md`, `docs/운영/작업-프로토콜.md`와 연결된다. |
| 로그인 프리뷰 자산 | `유지` | `public/js/login-rive-preview.js`, `public/css/pages/login.css` 내 preview 블록 | 유지 | 별도 preview HTML은 제거됐고, preview 전용 CSS도 `login.css`로 흡수했다. 현재는 실제 `login.html`이 사용하는 로그인 연출 자산이다. |
| 성장 기능 네이밍 | `분리 후보` | `public/js/growth-dashboard.js` vs `utils/growth-service.js` | 1차 정리 완료 | 클라이언트와 서버 유틸의 basename 충돌을 제거했다. 남은 과제는 관련 문서와 작업 메모를 새 이름 기준으로 천천히 정리하는 것이다. |
| 구형 자산/실험 파일 | `삭제 후보 아님` | UI-kit / demo 계열 | 문서상 보관 | 현재 브랜치 기준으로는 대부분 tracked runtime asset이 아니다. 코드 삭제보다 저장소 정책/문서 관리 범주다. |

---

## 4. 항목별 상세 메모

### 4.1 인증/세션 레이어

대상:

- `middleware/auth.js`

확인 결과:

- `sid` 없는 legacy token 차단/허용 로직이 남아 있다.
- 관련 테스트가 존재한다.
  - `tests/e2e/auth-legacy-deprecation.spec.js`
  - `tests/e2e/auth-signup-consent.spec.js`
- 운영 문서도 이 상태를 기준으로 적혀 있다.
  - `docs/서버/API/인증-쿠키-세션-정책.md`

판단:

- 정리 후보가 아니라 `정책 의존`이다.
- 제거 검토를 하려면 테스트 계약, 운영 문서, 토큰 발급 흐름을 같이 바꿔야 한다.

### 4.2 데이터/마이그레이션 레이어

대상:

- `utils/migrations.js`

확인 결과:

- `baseline_legacy`와 `isLegacySchema()`는 기존 DB를 안전하게 `schema_migrations` 체계에 편입시키는 레이어다.
- 직접 참조는 이 파일 내부에 집중되어 있어 “안 쓰는 코드”처럼 보일 수 있지만, 역할상 bootstrap safety에 가깝다.

판단:

- 지금 제거하면 신규 DB보다 기존 DB 업그레이드 경로에서 더 위험하다.
- 즉시 삭제가 아니라 “제거 조건”을 먼저 정의해야 한다.

제거 조건 초안:

- 운영 DB 전수가 `schema_migrations` 기반으로 정규화됨
- 더 이상 `0002_initial_schema.sql` skip 분기가 필요 없다는 검증 완료
- 기존 DB bootstrap 회귀 테스트 확보

### 4.3 프론트 호환/실험 레이어

#### `public/html/category.html`

- 단순 redirect shim이다.
- 내부 링크는 적지만, 외부 공유 URL이나 예전 bookmark 가능성이 있다.

판단:

- 유지

#### `editor2` 계열

- 아직 문서/링크/루트 alias가 남아 있다.
- `editor3`에서 “실험 에디터 보기” 링크가 살아 있다.
- 저장/초안 규칙도 운영 문서에 적혀 있다.

판단:

- 삭제보다 `legacy-experimental` 분리가 적절하다.
- 다음 라운드에서 할 일은 삭제가 아니라:
  - 메인 내비게이션 노출 축소
  - 문서 위치 명확화
  - 전역 CSS import 분리 검토

#### `public/css/pages/all.css`

확인된 import:

- `editor2.css`
- `editor3.css`
- `post3.css`

판단:

- 모두 orphan는 아니지만, 전역 번들 입장에선 실험/보조 흐름까지 한 번에 싣는 구조다.
- 구조 최적화 대상이다.

### 4.4 이미지 렌더 preview / fallback

대상:

- `routes/feedImageRoutes.js`
- `utils/feedImageRenderer.js`

확인 결과:

- `/feed-images/preview`는 `editor`, `editor2`, `post3`가 실제 사용 중이다.
- `layout_json`이 없을 때 legacy preset으로 fallback 하는 계약도 현재 문서와 맞물려 있다.

판단:

- 지금은 레거시 제거 대상이 아니라 active compatibility layer다.
- 향후 `editor/editor2` 정리가 끝난 뒤에 다시 판단해야 한다.

### 4.5 네이밍/구조 최적화 후보

대상:

- `public/js/growth-dashboard.js`
- `utils/growth-service.js`

확인 결과:

- `public/js/growth-dashboard.js`: 성장 페이지 렌더/상호작용
- `utils/growth-service.js`: XP, 레벨, streak, 업적 진행 계산

판단:

- 기능상 충돌은 없었지만 basename이 겹쳐 있었다.
- 향후 rename 검토 후보로 남긴다.

반영 결과:

- 클라이언트: `growth-dashboard.js`
- 서버 유틸: `growth-service.js`

---

## 5. 다음 라운드 권장 작업

1. `editor2`를 삭제가 아니라 `legacy-experimental`로 공식 분류
2. `all.css`의 전역 import를 페이지 책임 기준으로 재분류
3. 인증 legacy token 제거 조건을 운영/테스트 계약 단위로 문서화
4. migration baseline 제거 조건을 DB 안전성 기준으로 문서화
5. `growth.js` 중복 basename rename 여부 결정

---

## 6. 결론

- 현재 저장소는 “쓸모없는 파일”보다 “호환 때문에 남은 코드”가 더 많다.
- 따라서 다음 정리 PR의 기준은 `삭제 여부`보다 `왜 유지하는지 명확히 적는 것`이어야 한다.
- 이번 점검 기준으로 바로 지워도 되는 tracked runtime file은 추가로 확인되지 않았다.
- 다음 정리의 핵심은 `구조 명확화`, `문서 분리`, `제거 조건 정의`다.
