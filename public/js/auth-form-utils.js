(function attachAuthFormUtils(global) {
  const CODE_MESSAGE_MAP = {
    AUTH_RATE_LIMITED: '요청이 많습니다. 잠시 후 다시 시도해주세요.',
    AUTH_ACCOUNT_LOCKED: '요청이 많습니다. 잠시 후 다시 시도해주세요.',
    AUTH_INVALID_CREDENTIALS: '이메일 또는 비밀번호가 올바르지 않습니다.',
    AUTH_LOGIN_REQUIRED_FIELDS: '이메일과 비밀번호를 입력하세요.',
    AUTH_SIGNUP_REQUIRED_FIELDS: '필수 입력값을 확인해주세요.',
    AUTH_EMAIL_ALREADY_REGISTERED: '이미 가입된 이메일입니다.',
    AUTH_PENDING_EMAIL_EXISTS: '이미 가입 진행 중인 이메일입니다.',
    AUTH_SIGNUP_EMAIL_SEND_FAILED: '인증 메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.',
    AUTH_PASSWORD_TOO_SHORT: '비밀번호는 8자 이상이어야 합니다.',
    AUTH_PASSWORD_WEAK: '비밀번호는 영문과 숫자를 모두 포함해야 합니다.',
    AUTH_RESET_TOKEN_INVALID: '유효하지 않은 링크입니다.',
    AUTH_RESET_TOKEN_EXPIRED: '비밀번호 재설정 링크가 만료되었습니다. 다시 요청해주세요.',
    AUTH_RESET_TOKEN_USED: '이미 사용된 링크입니다. 다시 요청해주세요.',
    AUTH_LEGACY_TOKEN_DEPRECATED: '기존 로그인 정보가 만료되었습니다. 다시 로그인해주세요.',
    AUTH_RESET_REQUIRED_FIELDS: '토큰과 새 비밀번호를 모두 입력해주세요.',
    AUTH_RESET_EMAIL_REQUIRED: '이메일을 입력해주세요.',
    AUTH_VERIFY_REQUIRED_FIELDS: '인증에 필요한 정보가 누락되었습니다.',
    AUTH_VERIFY_CODE_MISMATCH: '인증 번호가 올바르지 않습니다.',
    AUTH_VERIFY_ATTEMPTS_EXCEEDED: '인증 시도 횟수를 초과했습니다.',
    AUTH_VERIFY_RESEND_COOLDOWN: '재발송은 잠시 후 다시 시도해주세요.',
    AUTH_VERIFY_RESEND_EMAIL_SEND_FAILED:
      '인증 메일 재발송에 실패했습니다. 잠시 후 다시 시도해주세요.',
  };

  const PASSWORD_LABELS = {
    0: '매우 약함',
    1: '약함',
    2: '보통',
    3: '좋음',
    4: '강함',
  };

  function findInput(form, key) {
    if (!form || !key) return null;
    const selectors = [
      `[name="${key}"]`,
      `#${key}`,
      `#${key}Input`,
      `[name="${key}Input"]`,
    ];
    for (const selector of selectors) {
      const found = form.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  function setFieldInvalid(inputEl, invalid) {
    if (!inputEl) return;
    if (invalid) {
      inputEl.setAttribute('aria-invalid', 'true');
      inputEl.classList.add('is-invalid');
      return;
    }
    inputEl.removeAttribute('aria-invalid');
    inputEl.classList.remove('is-invalid');
  }

  function clearFieldErrors(form) {
    if (!form) return;
    form.querySelectorAll('input, textarea, select').forEach((field) => {
      setFieldInvalid(field, false);
    });
  }

  function applyFieldErrors(form, fieldErrors = {}) {
    if (!form || !fieldErrors || typeof fieldErrors !== 'object') return null;
    let firstInvalid = null;
    Object.entries(fieldErrors).forEach(([key, value]) => {
      if (!value) return;
      const input = findInput(form, key);
      if (!input) return;
      setFieldInvalid(input, true);
      if (!firstInvalid) firstInvalid = input;
    });
    return firstInvalid;
  }

  function validateEmail(email) {
    if (!email || typeof email !== 'string') return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }

  function evaluatePasswordStrength(password) {
    const raw = typeof password === 'string' ? password : '';
    const checks = {
      length: raw.length >= 8,
      letter: /[a-zA-Z]/.test(raw),
      number: /\d/.test(raw),
      special: /[^a-zA-Z0-9]/.test(raw),
    };
    const score = Object.values(checks).reduce((acc, pass) => acc + (pass ? 1 : 0), 0);
    return {
      score,
      checks,
      isStrong: checks.length && checks.letter && checks.number,
      label: PASSWORD_LABELS[score] || PASSWORD_LABELS[0],
    };
  }

  function renderPasswordStrength(targetEl, password) {
    if (!targetEl) return evaluatePasswordStrength(password);
    const result = evaluatePasswordStrength(password);
    targetEl.textContent =
      password && password.length > 0
        ? `비밀번호 강도: ${result.label} (영문/숫자 포함, 8자 이상 권장)`
        : '비밀번호 강도: 입력 대기';
    targetEl.dataset.strengthScore = String(result.score);
    return result;
  }

  function buildErrorMessage({ code, message, retryAfter }) {
    const base = CODE_MESSAGE_MAP[code] || message || '요청 처리 중 오류가 발생했습니다.';
    if (retryAfter && Number(retryAfter) > 0) {
      return `${base} (${Math.ceil(Number(retryAfter))}초 후 재시도)`;
    }
    return base;
  }

  function startRetryCountdown(targetEl, retryAfter, render) {
    if (!targetEl || !retryAfter || Number(retryAfter) <= 0) return () => {};
    let remaining = Math.ceil(Number(retryAfter));
    if (typeof render === 'function') {
      render(remaining);
    } else {
      targetEl.textContent = `${remaining}초 후 다시 시도할 수 있습니다.`;
    }

    const timer = global.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        global.clearInterval(timer);
        if (typeof render === 'function') {
          render(0);
        } else {
          targetEl.textContent = '';
        }
        return;
      }

      if (typeof render === 'function') {
        render(remaining);
      } else {
        targetEl.textContent = `${remaining}초 후 다시 시도할 수 있습니다.`;
      }
    }, 1000);

    return () => global.clearInterval(timer);
  }

  function focusFirstInvalid(form) {
    if (!form) return;
    const first = form.querySelector('[aria-invalid="true"], .is-invalid');
    if (first && typeof first.focus === 'function') {
      first.focus();
    }
  }

  function ensureFeedbackElement(form, fallbackId) {
    if (window.glsoopUi && typeof window.glsoopUi.ensureFormFeedbackElement === 'function') {
      return window.glsoopUi.ensureFormFeedbackElement(form, fallbackId);
    }
    if (!form) return null;
    if (fallbackId) {
      const byId = document.getElementById(fallbackId);
      if (byId) return byId;
    }
    return form.querySelector('.gls-feedback');
  }

  function setFormFeedback(feedbackEl, message, type = 'error', focus = false) {
    if (!feedbackEl) return;
    if (window.glsoopUi && typeof window.glsoopUi.setFeedbackMessage === 'function') {
      window.glsoopUi.setFeedbackMessage(feedbackEl, message, { type, focus });
      return;
    }
    feedbackEl.textContent = message || '';
    if (focus && typeof feedbackEl.focus === 'function') {
      feedbackEl.focus();
    }
  }

  function clearFormFeedback(feedbackEl) {
    if (!feedbackEl) return;
    if (window.glsoopUi && typeof window.glsoopUi.clearFeedbackMessage === 'function') {
      window.glsoopUi.clearFeedbackMessage(feedbackEl);
      return;
    }
    feedbackEl.textContent = '';
  }

  global.glsoopAuthFormUtils = {
    findInput,
    setFieldInvalid,
    clearFieldErrors,
    applyFieldErrors,
    validateEmail,
    evaluatePasswordStrength,
    renderPasswordStrength,
    buildErrorMessage,
    startRetryCountdown,
    focusFirstInvalid,
    ensureFeedbackElement,
    setFormFeedback,
    clearFormFeedback,
  };
})(window);
