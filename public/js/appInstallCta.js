(function () {
  const DEFAULT_APP_STORE_URL =
    'https://apps.apple.com/kr/app/%EA%B8%80%EC%88%B2/id6761228925';
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

  async function loadAppStoreUrl() {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 1800);
    try {
      const response = await fetch('/api/runtime-config', {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) return DEFAULT_APP_STORE_URL;
      const payload = await response.json();
      const configured = payload && payload.app && payload.app.ios && payload.app.ios.app_store_url;
      if (typeof configured !== 'string' || !configured.trim()) return DEFAULT_APP_STORE_URL;
      const parsed = new URL(configured, window.location.origin);
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'apps.apple.com') {
        return DEFAULT_APP_STORE_URL;
      }
      return parsed.toString();
    } catch (error) {
      return DEFAULT_APP_STORE_URL;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function renderCta() {
    if (!isIosDevice() || readDismissed() || document.querySelector('.gls-app-install-cta')) {
      return;
    }

    const appStoreUrl = await loadAppStoreUrl();
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
      appStoreUrl +
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
