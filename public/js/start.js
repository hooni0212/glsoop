// /start 광고 전용 랜딩페이지
// - Instagram UTM last-touch 저장
// - 기기별 CTA 분기
// - 랜딩 조회/CTA 계측

(function bootstrapStartLanding() {
  const APP_STORE_URL = 'https://apps.apple.com/kr/app/id6761228925';
  const ATTRIBUTION_KEY = 'glsoop:acquisition:last_touch';
  const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  const currentUrl = new URL(window.location.href);

  const safeStorageWrite = (key, value) => {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  };

  const cleanCampaignValue = (value) => {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, 180);
  };

  const campaign = Object.fromEntries(
    UTM_KEYS.map((key) => [key, cleanCampaignValue(currentUrl.searchParams.get(key) || '')])
      .filter(([, value]) => value)
  );
  const hasCampaign = Object.keys(campaign).length > 0;

  if (hasCampaign) {
    safeStorageWrite(
      ATTRIBUTION_KEY,
      JSON.stringify({
        ...campaign,
        landing_path: '/start',
        captured_at: new Date().toISOString(),
      })
    );
  }

  const detectDevice = () => {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    const touchPoints = Number(navigator.maxTouchPoints || 0);
    const isIpadDesktopUa = platform === 'MacIntel' && touchPoints > 1;
    if (/iPhone|iPad|iPod/i.test(ua) || isIpadDesktopUa) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return 'desktop';
  };

  const deviceSegment = detectDevice();

  const buildWebDestination = (pathname, extra = {}) => {
    const target = new URL(pathname, window.location.origin);
    UTM_KEYS.forEach((key) => {
      const value = campaign[key] || cleanCampaignValue(currentUrl.searchParams.get(key) || '');
      if (value) target.searchParams.set(key, value);
    });
    Object.entries(extra).forEach(([key, value]) => {
      if (value) target.searchParams.set(key, value);
    });
    return `${target.pathname}${target.search}`;
  };

  const primaryDestination =
    deviceSegment === 'ios'
      ? APP_STORE_URL
      : buildWebDestination('/html/signup.html', { from: 'start' });

  const track = (eventName, properties = {}, options = {}) => {
    if (!window.glsoopAnalytics || typeof window.glsoopAnalytics.trackEvent !== 'function') {
      return;
    }
    window.glsoopAnalytics.trackEvent(
      eventName,
      {
        device_segment: deviceSegment,
        ...properties,
      },
      options
    );
  };

  const applyCampaignToLink = (link) => {
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (!href || href.startsWith('http') || href.startsWith('#')) return;
    const target = new URL(href, window.location.origin);
    link.href = buildWebDestination(target.pathname, {
      ...Object.fromEntries(target.searchParams.entries()),
    });
  };

  document.addEventListener('DOMContentLoaded', () => {
    const primaryCta = document.getElementById('startPrimaryCta');
    const finalCta = document.getElementById('startFinalCta');
    const stickyCta = document.getElementById('startStickyCta');
    const exploreCta = document.getElementById('startExploreCta');
    const sticky = document.getElementById('startSticky');
    const hero = document.querySelector('.start-hero');
    const primaryLabel = document.querySelector('[data-start-primary-label]');
    const finalLabel = document.querySelector('[data-start-final-label]');
    const stickyLabel = document.querySelector('[data-start-sticky-label]');
    const stickyNote = document.querySelector('[data-start-sticky-note]');

    [primaryCta, finalCta, stickyCta].forEach((link) => {
      if (link) link.href = primaryDestination;
    });

    if (exploreCta) {
      exploreCta.href = buildWebDestination('/explore', { from: 'start' });
    }
    document.querySelectorAll('[data-preserve-campaign]').forEach(applyCampaignToLink);

    if (deviceSegment === 'ios') {
      if (primaryLabel) primaryLabel.textContent = 'App Store에서 글숲 시작하기';
      if (finalLabel) finalLabel.textContent = 'iPhone에 글숲 설치하기';
      if (stickyLabel) stickyLabel.textContent = '설치하기';
      if (stickyNote) stickyNote.textContent = 'App Store에서 무료로 받을 수 있어요.';
    } else if (deviceSegment === 'android') {
      if (primaryLabel) primaryLabel.textContent = '웹에서 글숲 시작하기';
      if (finalLabel) finalLabel.textContent = '웹에서 무료로 시작하기';
      if (stickyLabel) stickyLabel.textContent = '웹에서 시작';
      if (stickyNote) stickyNote.textContent = 'Android에서는 웹으로 먼저 만날 수 있어요.';
    } else {
      if (primaryLabel) primaryLabel.textContent = '웹에서 글숲 시작하기';
      if (finalLabel) finalLabel.textContent = '웹에서 무료로 시작하기';
      if (stickyLabel) stickyLabel.textContent = '시작하기';
    }

    track('landing_view', {
      has_campaign: hasCampaign,
      landing_variant: 'start_v1',
    });

    document.querySelectorAll('[data-start-cta]').forEach((link) => {
      link.addEventListener('click', () => {
        const placement = link.getAttribute('data-start-cta') || 'unknown';
        const destination = placement === 'explore' ? 'web_explore' : deviceSegment === 'ios' ? 'app_store' : 'web_signup';
        const eventName =
          destination === 'app_store'
            ? 'landing_app_store_click'
            : destination === 'web_explore'
              ? 'landing_web_preview_click'
              : 'landing_web_signup_click';
        track(
          eventName,
          {
            placement,
            destination,
            landing_variant: 'start_v1',
          },
          { useBeacon: true }
        );
      });
    });

    if (sticky && hero && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        ([entry]) => {
          const visible = !entry.isIntersecting;
          sticky.classList.toggle('is-visible', visible);
          sticky.setAttribute('aria-hidden', visible ? 'false' : 'true');
        },
        { threshold: 0.08 }
      );
      observer.observe(hero);
    }
  });
})();
