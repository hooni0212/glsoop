// public/js/falling.js
// - 메인 홈(index.html)에서만 실행되는 단일 눈 배경 스크립트
// - CSS 애니메이션 정의는 public/css/themes/winter-theme.css 참고
// - seasonal.js가 겨울 테마 전반을 담당한다면, 이 파일은 단순 눈 파티클 버전

// DOM이 준비되면 계절 배경 세팅
document.addEventListener('DOMContentLoaded', () => {
  // 혹시 다른 페이지에서 불려도 안전하게: body.page-index 에서만 실행
  if (!document.body.classList.contains('page-index')) return;

  setupSnowBackground();
});

/**
 * 메인 페이지 눈 내리는 배경
 * - body.page-index 안에 .snow-layer를 만들고
 *   그 안에 작은 원(span.snowflake)을 여러 개 랜덤 배치
 */
function setupSnowBackground() {
  // 이미 만들어져 있으면 또 만들지 않기
  if (document.querySelector('.snow-layer')) return;

  const layer = document.createElement('div');
  layer.className = 'snow-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);

  const SNOW_COUNT = 80; // 눈송이 개수 (많으면 줄여도 됨)

  for (let i = 0; i < SNOW_COUNT; i++) {
    const flake = document.createElement('span');
    flake.className = 'snowflake';

    // 크기 랜덤 (2 ~ 5px)
    const size = 2 + Math.random() * 3;
    flake.style.width = `${size}px`;
    flake.style.height = `${size}px`;

    // 시작 가로 위치 0~100%
    flake.style.left = `${Math.random() * 100}%`;

    // 애니메이션 시간 랜덤 (5 ~ 12초)
    const duration = 5 + Math.random() * 7;
    flake.style.animationDuration = `${duration}s`;

    // 시작 지연 (음수로 줘서 이미 떨어지고 있는 것처럼 보이게)
    const delay = Math.random() * -duration;
    flake.style.animationDelay = `${delay}s`;

    // 투명도(0.3 ~ 0.9)
    const opacity = 0.3 + Math.random() * 0.6;
    flake.style.opacity = opacity.toFixed(2);

    layer.appendChild(flake);
  }
}
