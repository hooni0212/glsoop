// public/js/reset-password.js
// 비밀번호 재설정 페이지 전용 스크립트

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const token = (params.get('token') || '').trim();

  const form = document.getElementById('resetForm');
  const authUtils = window.glsoopAuthFormUtils || null;
  const msgEl =
    (authUtils && typeof authUtils.ensureFeedbackElement === 'function'
      ? authUtils.ensureFeedbackElement(form, 'resetMessage')
      : null) || document.getElementById('resetMessage');
  const tokenStateEl = document.getElementById('resetTokenState');
  const strengthEl = document.getElementById('resetPwStrength');

  if (!form || !msgEl) return;

  const setFormMessage = (message, type = 'error', focus = false) => {
    if (authUtils && typeof authUtils.setFormFeedback === 'function') {
      authUtils.setFormFeedback(msgEl, message, type, focus);
      return;
    }
    msgEl.textContent = message || '';
  };

  const clearFormMessage = () => {
    if (authUtils && typeof authUtils.clearFormFeedback === 'function') {
      authUtils.clearFormFeedback(msgEl);
      return;
    }
    msgEl.textContent = '';
  };

  const showNotice = (message, type = 'info') => {
    if (!window.glsoopUi || typeof window.glsoopUi.showPageNotice !== 'function') return;
    window.glsoopUi.showPageNotice(message, {
      type,
      autoHideMs: type === 'success' ? 2200 : 2800,
    });
  };

  const setTokenState = (message, type = 'info', includeRecoveryLink = false) => {
    if (!tokenStateEl) return;
    if (window.glsoopUi && typeof window.glsoopUi.setFeedbackMessage === 'function') {
      window.glsoopUi.setFeedbackMessage(tokenStateEl, message, { type, focus: false });
    } else {
      tokenStateEl.textContent = message || '';
    }

    if (includeRecoveryLink) {
      const link = document.createElement('a');
      link.href = '/html/forgot-password.html';
      link.className = 'auth-link-inline gls-ml-2';
      link.textContent = '재설정 다시 요청하기';
      tokenStateEl.appendChild(document.createTextNode(' '));
      tokenStateEl.appendChild(link);
    }
  };

  const hideFormForInvalidToken = (message) => {
    form.classList.add('is-hidden');
    setFormMessage('', 'info', false);
    setTokenState(message, 'error', true);
  };

  if (authUtils) {
    const pwInput = form.querySelector('input[name="newPw"]');
    const pw2Input = form.querySelector('input[name="newPw2"]');
    if (pwInput) {
      authUtils.renderPasswordStrength(strengthEl, pwInput.value || '');
      pwInput.addEventListener('input', () => {
        authUtils.renderPasswordStrength(strengthEl, pwInput.value || '');
        authUtils.setFieldInvalid(pwInput, false);
      });
      pwInput.addEventListener('blur', () => {
        const value = pwInput.value || '';
        if (!value) return;
        const result = authUtils.evaluatePasswordStrength(value);
        authUtils.setFieldInvalid(pwInput, !result.isStrong);
      });
    }

    if (pw2Input) {
      pw2Input.addEventListener('input', () => authUtils.setFieldInvalid(pw2Input, false));
    }
  }

  const validateToken = async () => {
    if (!token) {
      hideFormForInvalidToken('유효하지 않은 링크입니다.');
      return false;
    }

    setTokenState('링크를 확인하고 있습니다...', 'info');

    try {
      const res = await fetch('/api/password-reset/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.ok) {
        setTokenState('유효한 링크입니다. 새 비밀번호를 입력해주세요.', 'success');
        return true;
      }

      const message =
        authUtils && typeof authUtils.buildErrorMessage === 'function'
          ? authUtils.buildErrorMessage({
              code: data && data.code,
              message: data && data.message,
              retryAfter: data && data.retry_after,
            })
          : data.message || '유효하지 않은 링크입니다.';

      hideFormForInvalidToken(message);
      return false;
    } catch (error) {
      console.error('[reset-password] token validation failed:', error);
      hideFormForInvalidToken('링크 확인 중 오류가 발생했습니다. 다시 요청해주세요.');
      return false;
    }
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormMessage();
    if (authUtils) authUtils.clearFieldErrors(form);

    const newPw = form.newPw.value;
    const newPw2 = form.newPw2.value;

    if (newPw !== newPw2) {
      if (authUtils) {
        authUtils.setFieldInvalid(form.newPw, true);
        authUtils.setFieldInvalid(form.newPw2, true);
      }
      setFormMessage('비밀번호가 서로 일치하지 않습니다.', 'error', true);
      if (form.newPw2) form.newPw2.focus();
      return;
    }

    if (authUtils) {
      const strength = authUtils.evaluatePasswordStrength(newPw);
      if (!strength.isStrong) {
        authUtils.setFieldInvalid(form.newPw, true);
        setFormMessage('비밀번호는 8자 이상, 영문/숫자를 포함해야 합니다.', 'error', true);
        if (form.newPw) form.newPw.focus();
        return;
      }
    } else if (newPw.length < 8) {
      setFormMessage('비밀번호는 8자 이상으로 설정해주세요.', 'error', true);
      if (form.newPw) form.newPw.focus();
      return;
    }

    try {
      const res = await fetch('/api/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPw }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.ok) {
        setFormMessage(data.message || '비밀번호가 변경되었습니다.', 'success');
        showNotice(data.message || '비밀번호가 변경되었습니다.', 'success');
        setTimeout(() => {
          window.location.href = '/html/login.html?from=reset-password';
        }, 2000);
        return;
      }

      const errorMessage =
        authUtils && typeof authUtils.buildErrorMessage === 'function'
          ? authUtils.buildErrorMessage({
              code: data && data.code,
              message: data && data.message,
              retryAfter: data && data.retry_after,
            })
          : data.message || '비밀번호 변경에 실패했습니다.';

      const firstInvalid =
        authUtils && typeof authUtils.applyFieldErrors === 'function'
          ? authUtils.applyFieldErrors(form, data && data.field_errors)
          : null;

      setFormMessage(errorMessage, 'error', true);
      if (firstInvalid && typeof firstInvalid.focus === 'function') {
        firstInvalid.focus();
      }
    } catch (err) {
      console.error(err);
      setFormMessage(
        '요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        'error',
        true
      );
    }
  });

  validateToken();
});
