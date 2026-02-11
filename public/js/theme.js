// public/js/theme.js
// 전역 계절 테마 적용 유틸
// - localStorage(gls-admin-theme)에 저장된 테마를 읽어 body 클래스 및 전용 CSS 링크(#seasonTheme)를 교체
// - admin.html의 테마 토글뿐 아니라 모든 페이지 진입 시 동일하게 반영되도록 공통 엔트리에서 실행

(function initGlobalTheme() {
  const STORAGE_KEY = 'gls-admin-theme';
  const MIGRATION_KEY = 'gls-theme-default-migrated-v1';
  const DEFAULT_THEME = 'default';
  const ALLOWED = ['default', 'spring', 'summer', 'autumn', 'winter'];

  function readTheme() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return DEFAULT_THEME;

      // 2026-02: 과거 기본값(winter)에서 현재 기본값(default)으로 1회 전환
      // - 이전에 저장된 winter 값이 있더라도 최초 1회는 default로 교체해 시작한다.
      // - 이후 사용자가 다시 winter를 선택하면 그대로 유지된다.
      if (stored === 'winter' && !localStorage.getItem(MIGRATION_KEY)) {
        localStorage.setItem(STORAGE_KEY, DEFAULT_THEME);
        localStorage.setItem(MIGRATION_KEY, '1');
        return DEFAULT_THEME;
      }

      if (ALLOWED.includes(stored)) return stored;
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

  function syncFromStorage() {
    const theme = readTheme();
    applyTheme(theme);
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
  };

  init();
})();
