(function () {
  const APP_STORE_URL = 'https://apps.apple.com/kr/app/id6761228925';
  const DISMISS_KEY = 'glsoop.ios_app_cta.dismissed.v1';

  function isIosDevice() {
    const ua = window.navigator.userAgent || '';
    const platform = window.navigator.platform || '';
    const maxTouchPoints = window.navigator.maxTouchPoints || 0;
    return /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
  }

  function readDismissed() {
    try {
      return window.localStorage.getItem(DISMISS_KEY) === 'true';
    } catch {
      return false;
    }
  }

  function writeDismissed() {
    try {
      window.localStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      // Storage can be blocked in private browsing; dismissal still works for this page.
    }
  }

  function track(eventName, properties) {
    if (!window.glsoopAnalytics || typeof window.glsoopAnalytics.trackEvent !== 'function') {
      return;
    }
    window.glsoopAnalytics.trackEvent(eventName, properties, { useBeacon: true });
  }

  function renderCta() {
    if (!isIosDevice() || readDismissed() || document.querySelector('.gls-app-install-cta')) {
      return;
    }

    const cta = document.createElement('aside');
    cta.className = 'gls-app-install-cta';
    cta.setAttribute('role', 'region');
    cta.setAttribute('aria-label', '글숲 iOS 앱 설치');
    cta.innerHTML =
      '<div class="gls-app-install-cta__icon" aria-hidden="true">글</div>' +
      '<div class="gls-app-install-cta__body">' +
      '  <p class="gls-app-install-cta__title">글숲 앱에서 더 편하게 읽기</p>' +
      '  <p class="gls-app-install-cta__copy">iPhone에 설치하고 바로 이어서 볼 수 있어요.</p>' +
      '</div>' +
      '<a class="gls-app-install-cta__action" href="' +
      APP_STORE_URL +
      '" aria-label="App Store에서 글숲 설치">설치</a>' +
      '<button class="gls-app-install-cta__close" type="button" aria-label="앱 설치 안내 닫기">×</button>';

    cta.querySelector('.gls-app-install-cta__action')?.addEventListener('click', () => {
      track('ios_app_install_cta_click', { path: window.location.pathname });
    });
    cta.querySelector('.gls-app-install-cta__close')?.addEventListener('click', () => {
      writeDismissed();
      cta.remove();
      track('ios_app_install_cta_dismiss', { path: window.location.pathname });
    });

    document.body.appendChild(cta);
    track('ios_app_install_cta_impression', { path: window.location.pathname });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderCta);
  } else {
    renderCta();
  }
})();
