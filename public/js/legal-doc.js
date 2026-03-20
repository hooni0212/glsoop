(function initLegalDoc(windowObj) {
  function getByPath(target, path) {
    if (!target || !path) return '';
    const keys = String(path)
      .split('.')
      .map((entry) => entry.trim())
      .filter(Boolean);
    let current = target;
    for (const key of keys) {
      if (!current || typeof current !== 'object' || !(key in current)) {
        return '';
      }
      current = current[key];
    }
    if (current == null) return '';
    return String(current).trim();
  }

  async function applyLegalRuntimeData() {
    const targets = Array.from(document.querySelectorAll('[data-legal-field]'));
    if (targets.length === 0) return;

    let runtimePayload = null;
    try {
      const response = await fetch('/api/runtime-config', { cache: 'no-store' });
      if (response.ok) {
        runtimePayload = await response.json().catch(() => null);
      }
    } catch (error) {
      runtimePayload = null;
    }

    const legalData = runtimePayload && runtimePayload.ok ? runtimePayload.legal : null;

    targets.forEach((element) => {
      const path = element.getAttribute('data-legal-field') || '';
      const value = getByPath(legalData, path) || '-';
      if (element.tagName === 'A') {
        if (path.endsWith('email') && value !== '-') {
          element.textContent = value;
          element.setAttribute('href', `mailto:${value}`);
        } else {
          element.textContent = value;
        }
      } else {
        element.textContent = value;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyLegalRuntimeData();
  });
})(window);
