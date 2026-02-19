// public/js/login.js
// 로그인 페이지 스크립트
// - 로그인 폼 submit 처리
// - /api/login 호출 후 결과에 따라 마이페이지로 이동

document.addEventListener('DOMContentLoaded', () => {
  // 로그인 폼 요소 가져오기
  const form = document.getElementById('loginForm');
  if (!form) return; // 폼이 없으면 아무 것도 하지 않음 (안전장치)
  const feedbackEl =
    (window.glsoopUi &&
      typeof window.glsoopUi.ensureFormFeedbackElement === 'function' &&
      window.glsoopUi.ensureFormFeedbackElement(form, 'loginMessage')) ||
    document.getElementById('loginMessage');
  const params = new URLSearchParams(window.location.search);
  const nextUrl = params.get('next');
  const source = params.get('from');
  const emailFromQuery = (params.get('email') || '').trim();
  const authShell = document.querySelector('[data-auth-shell="1"]');
  const reducedMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canHover = window.matchMedia
    && window.matchMedia('(hover: hover)').matches;
  const isSafeInternalPath = (value) =>
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.startsWith('/\\');
  const safeNextUrl = isSafeInternalPath(nextUrl) ? nextUrl : null;
  let submitting = false;

  const trackEvent = (eventName, properties = {}, options = {}) => {
    if (!window.glsoopAnalytics || typeof window.glsoopAnalytics.trackEvent !== 'function') {
      return;
    }
    window.glsoopAnalytics.trackEvent(eventName, properties, options);
  };

  const setFormMessage = (message, type = 'error', focus = false) => {
    if (!feedbackEl) return;
    if (window.glsoopUi && typeof window.glsoopUi.setFeedbackMessage === 'function') {
      window.glsoopUi.setFeedbackMessage(feedbackEl, message, { type, focus });
      return;
    }
    feedbackEl.textContent = message || '';
  };

  const clearFormMessage = () => {
    if (!feedbackEl) return;
    if (window.glsoopUi && typeof window.glsoopUi.clearFeedbackMessage === 'function') {
      window.glsoopUi.clearFeedbackMessage(feedbackEl);
      return;
    }
    feedbackEl.textContent = '';
  };

  const setAuthShellMotion = (x, y) => {
    if (!authShell) return;
    authShell.style.setProperty('--auth-mouse-x', `${Math.round(x * 100)}%`);
    authShell.style.setProperty('--auth-mouse-y', `${Math.round(y * 100)}%`);
    const rotateY = (x - 0.5) * 4.2;
    const rotateX = (0.5 - y) * 3.4;
    authShell.style.setProperty('--auth-rotate-y', `${rotateY.toFixed(2)}deg`);
    authShell.style.setProperty('--auth-rotate-x', `${rotateX.toFixed(2)}deg`);
    authShell.style.setProperty('--auth-shift-x', `${((x - 0.5) * 16).toFixed(1)}px`);
    authShell.style.setProperty('--auth-shift-y', `${((y - 0.5) * 12).toFixed(1)}px`);
  };

  const bindAuthShellParallax = () => {
    if (!authShell || reducedMotion || !canHover) return;
    let raf = 0;
    let nextX = 0.5;
    let nextY = 0.36;

    const flush = () => {
      raf = 0;
      setAuthShellMotion(nextX, nextY);
    };

    const queue = (x, y) => {
      nextX = Math.min(1, Math.max(0, x));
      nextY = Math.min(1, Math.max(0, y));
      if (!raf) {
        raf = window.requestAnimationFrame(flush);
      }
    };

    authShell.addEventListener('pointermove', (event) => {
      const rect = authShell.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      authShell.dataset.authShellActive = '1';
      queue(
        (event.clientX - rect.left) / rect.width,
        (event.clientY - rect.top) / rect.height
      );
    });

    authShell.addEventListener('pointerleave', () => {
      delete authShell.dataset.authShellActive;
      queue(0.5, 0.36);
    });
  };

  const bindFormFieldState = () => {
    const inputs = form.querySelectorAll('.auth-field .gls-input');
    if (!inputs.length) return;

    const syncField = (inputEl) => {
      const field = inputEl.closest('.auth-field');
      if (!field) return;
      const active = document.activeElement === inputEl;
      const filled = Boolean((inputEl.value || '').trim());
      field.classList.toggle('is-active', active);
      field.classList.toggle('is-filled', filled);
    };

    const syncEngaged = () => {
      const focused = document.activeElement && form.contains(document.activeElement);
      form.classList.toggle('is-engaged', Boolean(focused));
    };

    inputs.forEach((inputEl) => {
      syncField(inputEl);
      inputEl.addEventListener('focus', () => {
        syncField(inputEl);
        syncEngaged();
      });
      inputEl.addEventListener('blur', () => {
        syncField(inputEl);
        syncEngaged();
      });
      inputEl.addEventListener('input', () => {
        syncField(inputEl);
      });
    });
  };

  const triggerFormState = (stateClass) => {
    if (!stateClass) return;
    form.classList.remove('is-login-error', 'is-login-success');
    form.classList.add(stateClass);
    window.setTimeout(() => {
      form.classList.remove(stateClass);
    }, 700);
  };

  trackEvent('login_view');
  bindAuthShellParallax();
  bindFormFieldState();

  if (emailFromQuery && form.email && !form.email.value) {
    form.email.value = emailFromQuery;
    const pwInput = form.querySelector('input[name="pw"]');
    if (pwInput) {
      pwInput.focus();
    }
    trackEvent('login_prefilled_from_query', {
      source: source || null,
    });
  }

  // 폼 제출 이벤트 리스너 등록
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); // 기본 폼 제출(페이지 새로고침) 막기
    if (submitting) return;
    clearFormMessage();

    trackEvent('login_submit_clicked', {
      has_next: Boolean(safeNextUrl),
      source: source || null,
    });

    // 폼 안의 input name="email", name="pw"에서 값 읽기
    const email = form.email.value.trim();
    const pw = form.pw.value.trim();

    // 이메일 또는 비밀번호가 비어 있으면 경고
    if (!email || !pw) {
      trackEvent('login_validation_error', {
        reason: 'required_fields_missing',
      });
      setFormMessage('이메일과 비밀번호를 모두 입력하세요.', 'error', true);
      if (!email && form.email) {
        form.email.focus();
      } else if (!pw && form.pw) {
        form.pw.focus();
      }
      return;
    }

    submitting = true;
    form.classList.remove('is-login-error', 'is-login-success');
    form.classList.add('is-submitting');
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.dataset.originalText = submitBtn.dataset.originalText || submitBtn.textContent;
      submitBtn.textContent = '로그인 중...';
    }

    try {
      // /api/login 엔드포인트로 POST 요청
      // - body: { email, pw }
      // - 서버에서 로그인 성공 시 JWT를 httpOnly 쿠키에 세팅
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, pw }),
      });

      // 응답 JSON 파싱 (예: { ok: true/false, message: '...' })
      const data = await res.json();

      // HTTP 응답도 OK이고, 응답 JSON의 ok도 true인 경우 "로그인 성공"으로 간주
      // 로그인 성공 후 이동
      if (res.ok && data.ok) {
        form.classList.add('is-login-success');
        setFormMessage(data.message || '로그인에 성공했습니다.', 'success');
        // 안전장치: 내부 경로만 허용
        if (safeNextUrl) {
          trackEvent(
            'login_success',
            {
              redirect_to: safeNextUrl,
            },
            { useBeacon: true }
          );
          window.location.href = safeNextUrl;
        } else {
          const fallbackRedirect =
            source === 'verify-email' ? '/html/editor.html' : '/html/mypage.html';
          trackEvent(
            'login_success',
            {
              redirect_to: fallbackRedirect,
            },
            { useBeacon: true }
          );
          window.location.href = fallbackRedirect;
        }
      } else {
        triggerFormState('is-login-error');
        trackEvent('login_error', {
          status: res.status || null,
          has_message: Boolean(data && data.message),
        });
        setFormMessage(data.message || '로그인에 실패했습니다.', 'error', true);
      }
    } catch (err) {
      // 네트워크 에러 등 예외 처리
      console.error(err);
      triggerFormState('is-login-error');
      trackEvent('login_error', {
        reason: 'network_error',
      });
      setFormMessage('로그인 중 오류가 발생했습니다.', 'error', true);
    } finally {
      submitting = false;
      form.classList.remove('is-submitting');
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = submitBtn.dataset.originalText || '로그인';
      }
    }
  });
});
