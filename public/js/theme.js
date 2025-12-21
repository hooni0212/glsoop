// public/js/theme.js
// 전역 계절 테마 적용 유틸
// - localStorage(gls-admin-theme)에 저장된 테마를 읽어 body 클래스 및 전용 CSS 링크(#seasonTheme)를 교체
// - admin.html의 테마 토글뿐 아니라 모든 페이지 진입 시 동일하게 반영되도록 공통 엔트리에서 실행

(function initGlobalTheme() {
  const STORAGE_KEY = 'gls-admin-theme';
  const DEFAULT_THEME = 'winter';
  const ALLOWED = ['spring', 'summer', 'autumn', 'winter'];

  function readTheme() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && ALLOWED.includes(stored)) return stored;
    } catch (e) {
      console.warn('테마를 로컬스토리지에서 읽는 중 문제가 발생했습니다.', e);
    }
    return DEFAULT_THEME;
  }

  function persistTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
      console.warn('테마를 로컬스토리지에 저장할 수 없습니다.', e);
    }
  }

  function applyTheme(theme) {
    const safeTheme = ALLOWED.includes(theme) ? theme : DEFAULT_THEME;
    const body = document.body;
    if (!body) return safeTheme;

    ALLOWED.forEach((t) => body.classList.remove(`${t}-theme`));
    body.classList.add(`${safeTheme}-theme`);

    const themeLink = document.getElementById('seasonTheme');
    if (themeLink) {
      const nextHref = `/css/themes/${safeTheme}-theme.css`;
      if (themeLink.getAttribute('href') !== nextHref) {
        themeLink.setAttribute('href', nextHref);
      }
    }

    body.setAttribute('data-gls-theme', safeTheme);
    return safeTheme;
  }

  // ===== 배경 이미지 관리 =====
  const BG_STORAGE_KEY = 'gls-custom-bg';

  function readBackground() {
    try {
      const stored = localStorage.getItem(BG_STORAGE_KEY);
      return stored || '';
    } catch (e) {
      console.warn('배경 이미지를 로컬스토리지에서 읽는 중 문제가 발생했습니다.', e);
      return '';
    }
  }

  function persistBackground(url) {
    try {
      if (url) {
        localStorage.setItem(BG_STORAGE_KEY, url);
      } else {
        localStorage.removeItem(BG_STORAGE_KEY);
      }
    } catch (e) {
      console.warn('배경 이미지를 로컬스토리지에 저장하는 중 문제가 발생했습니다.', e);
    }
  }

  function applyBackground(url) {
    const body = document.body;
    if (!body) return '';

    const trimmed = (url || '').trim();
    if (!trimmed) {
      body.classList.remove('has-custom-bg');
      body.style.removeProperty('--gls-custom-bg-image');
      return '';
    }

    const sanitized = trimmed.replace(/"/g, '');
    body.classList.add('has-custom-bg');
    body.style.setProperty('--gls-custom-bg-image', `url(${sanitized})`);
    return sanitized;
  }

  function syncBackground() {
    const url = readBackground();
    applyBackground(url);
    return url;
  }

  function syncFromStorage() {
    const theme = readTheme();
    applyTheme(theme);
    syncBackground();
    return theme;
  }

  function init() {
    // DOM 파싱 이후(body 존재) 바로 적용
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', syncFromStorage, { once: true });
    } else {
      syncFromStorage();
    }
  }

  window.Glsoop = window.Glsoop || {};
  window.Glsoop.Theme = {
    STORAGE_KEY,
    DEFAULT_THEME,
    ALLOWED_THEMES: ALLOWED,
    readTheme,
    persistTheme,
    applyTheme,
    syncFromStorage,
    // background helpers
    readBackground,
    persistBackground,
    applyBackground,
    syncBackground,
  };

  init();
})();
