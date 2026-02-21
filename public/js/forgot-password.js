// public/js/forgot-password.js
// "비밀번호 찾기" / "비밀번호 재설정 메일 보내기" 페이지 스크립트


document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('forgotForm');
  if (!form) return;

  const msgEl = document.getElementById('forgotMessage');
  const submitBtn = form.querySelector('button[type="submit"]');
  const emailInput = form.querySelector('input[name="email"]');
  const authUtils = window.glsoopAuthFormUtils || null;
  let stopRetryCountdown = null;

  const setFormMessage = (message, type = 'info', focus = false) => {
    if (!msgEl) return;
    if (window.glsoopUi && typeof window.glsoopUi.setFeedbackMessage === 'function') {
      window.glsoopUi.setFeedbackMessage(msgEl, message, { type, focus });
      return;
    }
    msgEl.textContent = message || '';
  };

  const clearFormMessage = () => {
    if (stopRetryCountdown) {
      stopRetryCountdown();
      stopRetryCountdown = null;
    }
    if (!msgEl) return;
    if (window.glsoopUi && typeof window.glsoopUi.clearFeedbackMessage === 'function') {
      window.glsoopUi.clearFeedbackMessage(msgEl);
      return;
    }
    msgEl.textContent = '';
  };

  const showNotice = (message, type = 'info') => {
    if (!window.glsoopUi || typeof window.glsoopUi.showPageNotice !== 'function') return;
    window.glsoopUi.showPageNotice(message, {
      type,
      autoHideMs: type === 'success' ? 2400 : 2800,
    });
  };

  if (emailInput && authUtils) {
    emailInput.addEventListener('blur', () => {
      const value = (emailInput.value || '').trim();
      const valid = !value || authUtils.validateEmail(value);
      authUtils.setFieldInvalid(emailInput, !valid);
    });
    emailInput.addEventListener('input', () => authUtils.setFieldInvalid(emailInput, false));
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = form.email.value.trim();
    clearFormMessage();
    if (authUtils) authUtils.clearFieldErrors(form);

    if (!email) {
      setFormMessage('이메일을 입력해주세요.', 'error', true);
      if (authUtils && emailInput) authUtils.setFieldInvalid(emailInput, true);
      if (emailInput) emailInput.focus();
      return;
    }

    if (authUtils && !authUtils.validateEmail(email)) {
      setFormMessage('이메일 형식을 확인해주세요.', 'error', true);
      if (emailInput) {
        authUtils.setFieldInvalid(emailInput, true);
        emailInput.focus();
      }
      return;
    }

    setFormMessage('메일을 보내는 중입니다...', 'info');

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.dataset.originalText = submitBtn.dataset.originalText || submitBtn.textContent;
      submitBtn.textContent = '전송 중...';
    }

    try {
      const res = await fetch('/api/password-reset-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.ok) {
        setFormMessage(data.message || '요청이 처리되었습니다.', 'success');
        showNotice(data.message || '재설정 메일 안내를 확인해주세요.', 'success');
        return;
      }

      const errorMessage =
        authUtils && typeof authUtils.buildErrorMessage === 'function'
          ? authUtils.buildErrorMessage({
              code: data && data.code,
              message: data && data.message,
              retryAfter: null,
            })
          : data.message || '요청 처리 중 오류가 발생했습니다.';

      const firstInvalid =
        authUtils && typeof authUtils.applyFieldErrors === 'function'
          ? authUtils.applyFieldErrors(form, data && data.field_errors)
          : null;

      setFormMessage(errorMessage, 'error', true);

      const retryAfter = Number(data && data.retry_after);
      if (authUtils && retryAfter > 0 && msgEl) {
        stopRetryCountdown = authUtils.startRetryCountdown(msgEl, retryAfter, (remaining) => {
          setFormMessage(`${errorMessage} (${remaining}초 후 재시도)`, 'error', false);
        });
      }

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
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = submitBtn.dataset.originalText || '재설정 메일 보내기';
      }
    }
  });
});
