// public/js/seasonal.js
// - 계절 테마(특히 겨울) 전용 인터랙션 스크립트
// - winter-theme.css에 정의된 .snowflake 애니메이션을 기반으로 DOM에 눈파티클을 주입
// - 홈/글/작가 화면에서만 실행되도록 페이지 클래스로 가드, 모션 민감도(prefers-reduced-motion)도 고려

// 페이지 로드 이후에만 실행
// (index.html <body>에는 page-index 클래스가 있으며, 겨울 스킨은 winter-theme 클래스로 구분)
document.addEventListener('DOMContentLoaded', () => {
  const body = document.body;

  // 눈 효과를 켜는 페이지 범위: 홈 / 글 상세 / 작가
  const snowEnabledPages = ['page-index', 'page-post', 'page-author'];
  const isSnowPage = snowEnabledPages.some((cls) => body.classList.contains(cls));

  if (!isSnowPage) return;
  // 테마가 겨울이 아닐 때도 조용히 종료
  if (!body.classList.contains('winter-theme')) return;

  // 사용자 OS 차원의 모션 감소 설정을 존중
  const reduceMotionQuery = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  if (reduceMotionQuery && reduceMotionQuery.matches) {
    return;
  }

  setupSnowBackground();
});

/**
 * 뷰포트 폭에 따라 눈송이 개수를 조절하며 배경 DOM을 생성
 * - animation 정의는 /public/css/themes/winter-theme.css 안의 @keyframes snowFall / snowFallAlt 참조
 */
function setupSnowBackground() {
  // 이미 생성된 눈 레이어가 있으면 중복 생성 방지
  if (document.querySelector('.snow-layer')) return;

  const body = document.body;

  const layer = document.createElement('div');
  layer.className = 'snow-layer';
  layer.setAttribute('aria-hidden', 'true');

  const fragment = document.createDocumentFragment();

  const width = window.innerWidth || document.documentElement.clientWidth;
  let SNOW_COUNT;

  // 반응형: 모바일/태블릿/데스크톱 분기마다 적당한 수량만 렌더링
  if (width <= 576) {
    SNOW_COUNT = 40;
  } else if (width <= 992) {
    SNOW_COUNT = 70;
  } else {
    SNOW_COUNT = 90;
  }

  for (let i = 0; i < SNOW_COUNT; i++) {
    const flake = document.createElement('span');

    const r = Math.random();
    let sizeClass = 'mid';

    // 균일하지 않게 크기 클래스 분배 (small / mid / big)
    if (r < 0.2) {
      sizeClass = 'big';
    } else if (r > 0.8) {
      sizeClass = 'small';
    }

    flake.className = `snowflake ${sizeClass}`;

    // 가로 위치: 0~100% 사이 랜덤 배치
    flake.style.left = `${Math.random() * 100}%`;

    // 애니메이션 시작 지연값을 음수로 줘서 "이미 내리고 있는" 효과
    const maxDuration = 14;
    const delay = Math.random() * -maxDuration;
    flake.style.animationDelay = `${delay.toFixed(2)}s`;

    // 살짝 불투명/투명 섞어서 깊이감 부여
    const opacity = 0.4 + Math.random() * 0.5;
    flake.style.opacity = opacity.toFixed(2);

    // 30% 확률로 대체 애니메이션 사용(snowFallAlt)
    if (Math.random() < 0.3) {
      flake.style.animationName = 'snowFallAlt';
    }

    fragment.appendChild(flake);
  }

  layer.appendChild(fragment);
  body.appendChild(layer);
}
