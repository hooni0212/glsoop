// public/js/ui-kit.js
// - UI Kit 페이지 전용 스크립트
// - 테마(봄/여름/가을/겨울) 토글을 쉽게 확인하기 위한 유틸

(function () {
  const THEMES = ['winter', 'spring', 'summer', 'autumn'];
  const STORAGE_KEY = 'glsoop_theme';

  function clearThemeClasses(body) {
    THEMES.forEach((t) => body.classList.remove(`${t}-theme`));
  }

  function setTheme(theme) {
    const body = document.body;
    if (!THEMES.includes(theme)) theme = 'winter';

    clearThemeClasses(body);
    body.classList.add(`${theme}-theme`);

    // 버튼 active 표시
    document.querySelectorAll('[data-set-theme]').forEach((b) => {
      b.classList.toggle('is-active', b.getAttribute('data-set-theme') === theme);
    });

    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
      // ignore
    }
  }

  function getThemeFromQuery() {
    const params = new URLSearchParams(location.search);
    const t = params.get('theme');
    return t && THEMES.includes(t) ? t : null;
  }

  function init() {
    const queryTheme = getThemeFromQuery();
    const stored = (() => {
      try {
        return localStorage.getItem(STORAGE_KEY);
      } catch (e) {
        return null;
      }
    })();

    setTheme(queryTheme || stored || 'winter');

    document.querySelectorAll('[data-set-theme]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const theme = btn.getAttribute('data-set-theme');
        setTheme(theme);

        // 주소창에도 남겨서 공유/북마크하기 쉬움
        const params = new URLSearchParams(location.search);
        params.set('theme', theme);
        const next = `${location.pathname}?${params.toString()}`;
        history.replaceState(null, '', next);
      });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
