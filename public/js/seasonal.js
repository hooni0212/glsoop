// /public/js/seasonal.js

document.addEventListener('DOMContentLoaded', () => {
    const body = document.body;
  
    if (!body.classList.contains('page-index')) return;
    if (!body.classList.contains('winter-theme')) return;
  
    const reduceMotionQuery = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
  
    if (reduceMotionQuery && reduceMotionQuery.matches) {
      return;
    }
  
    setupSnowBackground();
  });
  
  function setupSnowBackground() {
    if (document.querySelector('.snow-layer')) return;
  
    const body = document.body;
  
    const layer = document.createElement('div');
    layer.className = 'snow-layer';
    layer.setAttribute('aria-hidden', 'true');
  
    const fragment = document.createDocumentFragment();
  
    const width = window.innerWidth || document.documentElement.clientWidth;
    let SNOW_COUNT;
  
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
  
      if (r < 0.2) {
        sizeClass = 'big';
      } else if (r > 0.8) {
        sizeClass = 'small';
      }
  
      flake.className = `snowflake ${sizeClass}`;
  
      flake.style.left = `${Math.random() * 100}%`;
  
      const maxDuration = 14;
      const delay = Math.random() * -maxDuration;
      flake.style.animationDelay = `${delay.toFixed(2)}s`;
  
      const opacity = 0.4 + Math.random() * 0.5;
      flake.style.opacity = opacity.toFixed(2);
  
      if (Math.random() < 0.3) {
        flake.style.animationName = 'snowFallAlt';
      }
  
      fragment.appendChild(flake);
    }
  
    layer.appendChild(fragment);
    body.appendChild(layer);
  }
  