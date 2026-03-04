// public/js/signup.js
// 회원가입 페이지 전용 스크립트
// - 필드 값 읽기
// - 필수값/필수 동의 검증
// - 중복 제출 방지
// - /api/signup 호출 후 결과 처리

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('signupForm');
  if (!form) return;

  const feedbackEl =
    (window.glsoopUi &&
      typeof window.glsoopUi.ensureFormFeedbackElement === 'function' &&
      window.glsoopUi.ensureFormFeedbackElement(form, 'signupMessage')) ||
    document.getElementById('signupMessage');
  const authUtils = window.glsoopAuthFormUtils || null;
  const pwStrengthEl = document.getElementById('signupPwStrength');

  const nameInput = form.querySelector('input[name="name"], input#name');
  const nicknameInput = form.querySelector('input[name="nickname"], input#nickname');
  const emailInput = form.querySelector('input[name="email"], input#email');
  const pwInput = form.querySelector(
    'input[name="pw"], input[name="password"], input#pw, input#password'
  );

  const ageAgreeInput = form.querySelector('input[name="age_confirmed"]');
  const termsAgreeInput = form.querySelector('input[name="terms_agreed"]');
  const privacyAgreeInput = form.querySelector('input[name="privacy_agreed"]');
  const marketingAgreeInput = form.querySelector('input[name="marketing_email_opt_in"]');

  const requiredChecks = Array.from(form.querySelectorAll('.agree-required'));
  const optionalChecks = Array.from(form.querySelectorAll('.agree-optional'));

  const legalMeta = {
    terms_version: '',
    privacy_version: '',
    marketing_version: '',
  };

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

  const setCheckboxInvalid = (checkbox, invalid) => {
    if (!checkbox) return;
    if (authUtils && typeof authUtils.setFieldInvalid === 'function') {
      authUtils.setFieldInvalid(checkbox, invalid);
    } else {
      checkbox.classList.toggle('is-invalid', Boolean(invalid));
    }
    const wrapper = checkbox.closest('.gls-check');
    if (wrapper) {
      wrapper.classList.toggle('is-invalid', Boolean(invalid));
    }
  };

  const clearConsentInvalidState = () => {
    requiredChecks.forEach((checkbox) => setCheckboxInvalid(checkbox, false));
    optionalChecks.forEach((checkbox) => setCheckboxInvalid(checkbox, false));
  };

  const clearFieldErrors = () => {
    if (authUtils && typeof authUtils.clearFieldErrors === 'function') {
      authUtils.clearFieldErrors(form);
    }
    clearConsentInvalidState();
  };

  const applyFieldErrors = (fieldErrors) => {
    let firstInvalid = null;
    if (authUtils && typeof authUtils.applyFieldErrors === 'function') {
      firstInvalid = authUtils.applyFieldErrors(form, fieldErrors || {});
    }

    const mappedConsents = [
      ['age_confirmed', ageAgreeInput],
      ['terms_agreed', termsAgreeInput],
      ['privacy_agreed', privacyAgreeInput],
      ['marketing_email_opt_in', marketingAgreeInput],
    ];

    mappedConsents.forEach(([fieldName, checkbox]) => {
      if (!checkbox) return;
      const hasError = Boolean(fieldErrors && fieldErrors[fieldName]);
      setCheckboxInvalid(checkbox, hasError);
      if (!firstInvalid && hasError) {
        firstInvalid = checkbox;
      }
    });

    return firstInvalid;
  };

  let legalMetaLoadPromise = null;
  const loadLegalMeta = () => {
    if (legalMetaLoadPromise) return legalMetaLoadPromise;

    legalMetaLoadPromise = fetch('/api/runtime-config', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json().catch(() => null);
        const versions = payload && payload.legal && payload.legal.versions;
        if (!versions || typeof versions !== 'object') return;

        legalMeta.terms_version =
          typeof versions.terms === 'string' ? versions.terms.trim() : '';
        legalMeta.privacy_version =
          typeof versions.privacy === 'string' ? versions.privacy.trim() : '';
        legalMeta.marketing_version =
          typeof versions.marketing === 'string' ? versions.marketing.trim() : '';
      })
      .catch(() => {})
      .finally(() => {
        legalMetaLoadPromise = null;
      });

    return legalMetaLoadPromise;
  };

  trackEvent('signup_view');
  loadLegalMeta();

  const agreeAll = document.getElementById('agreeAll');
  if (agreeAll) {
    const updateAgreeAll = () => {
      const allRequiredChecked = requiredChecks.every((checkbox) => checkbox.checked);
      const allOptionalChecked =
        optionalChecks.every((checkbox) => checkbox.checked) || optionalChecks.length === 0;
      agreeAll.checked = allRequiredChecked && allOptionalChecked;
    };

    agreeAll.addEventListener('change', () => {
      const checked = agreeAll.checked;
      requiredChecks.forEach((checkbox) => {
        checkbox.checked = checked;
        setCheckboxInvalid(checkbox, false);
      });
      optionalChecks.forEach((checkbox) => {
        checkbox.checked = checked;
        setCheckboxInvalid(checkbox, false);
      });
    });

    requiredChecks.forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        updateAgreeAll();
        setCheckboxInvalid(checkbox, false);
      });
    });
    optionalChecks.forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        updateAgreeAll();
        setCheckboxInvalid(checkbox, false);
      });
    });

    updateAgreeAll();
  }

  let submitting = false;

  if (pwInput && authUtils) {
    authUtils.renderPasswordStrength(pwStrengthEl, pwInput.value || '');
    pwInput.addEventListener('input', () => {
      authUtils.renderPasswordStrength(pwStrengthEl, pwInput.value || '');
      authUtils.setFieldInvalid(pwInput, false);
    });
  }

  if (emailInput && authUtils) {
    emailInput.addEventListener('blur', () => {
      const value = (emailInput.value || '').trim();
      const valid = !value || authUtils.validateEmail(value);
      authUtils.setFieldInvalid(emailInput, !valid);
    });
    emailInput.addEventListener('input', () => authUtils.setFieldInvalid(emailInput, false));
  }

  if (nameInput && authUtils) {
    nameInput.addEventListener('input', () => authUtils.setFieldInvalid(nameInput, false));
  }
  if (nicknameInput && authUtils) {
    nicknameInput.addEventListener('input', () => authUtils.setFieldInvalid(nicknameInput, false));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;

    clearFormMessage();
    clearFieldErrors();

    trackEvent('signup_submit_clicked');

    const name = nameInput ? nameInput.value.trim() : '';
    const nickname = nicknameInput ? nicknameInput.value.trim() : '';
    const email = emailInput ? emailInput.value.trim() : '';
    const pw = pwInput ? pwInput.value.trim() : '';

    const needNickname = !!nicknameInput;

    if (!name || !email || !pw || (needNickname && !nickname)) {
      trackEvent('signup_validation_error', { reason: 'required_fields_missing' });
      setFormMessage('이름, 닉네임, 이메일, 비밀번호를 모두 입력하세요.', 'error', true);
      if (!name && nameInput) {
        if (authUtils) authUtils.setFieldInvalid(nameInput, true);
        nameInput.focus();
      } else if (needNickname && !nickname && nicknameInput) {
        if (authUtils) authUtils.setFieldInvalid(nicknameInput, true);
        nicknameInput.focus();
      } else if (!email && emailInput) {
        if (authUtils) authUtils.setFieldInvalid(emailInput, true);
        emailInput.focus();
      } else if (!pw && pwInput) {
        if (authUtils) authUtils.setFieldInvalid(pwInput, true);
        pwInput.focus();
      }
      return;
    }

    if (authUtils && !authUtils.validateEmail(email)) {
      trackEvent('signup_validation_error', { reason: 'invalid_email_format' });
      if (emailInput) authUtils.setFieldInvalid(emailInput, true);
      setFormMessage('이메일 형식을 확인해주세요.', 'error', true);
      if (emailInput) emailInput.focus();
      return;
    }

    if (authUtils) {
      const passwordStrength = authUtils.evaluatePasswordStrength(pw);
      if (!passwordStrength.isStrong) {
        trackEvent('signup_validation_error', { reason: 'weak_password' });
        if (pwInput) authUtils.setFieldInvalid(pwInput, true);
        setFormMessage('비밀번호는 8자 이상, 영문/숫자를 포함해야 합니다.', 'error', true);
        if (pwInput) pwInput.focus();
        return;
      }
    }

    const ageConfirmed = Boolean(ageAgreeInput && ageAgreeInput.checked);
    const termsAgreed = Boolean(termsAgreeInput && termsAgreeInput.checked);
    const privacyAgreed = Boolean(privacyAgreeInput && privacyAgreeInput.checked);
    const marketingEmailOptIn = Boolean(marketingAgreeInput && marketingAgreeInput.checked);

    const missingConsentErrors = {};
    if (!ageConfirmed) missingConsentErrors.age_confirmed = '만 14세 이상 여부를 확인해주세요.';
    if (!termsAgreed) missingConsentErrors.terms_agreed = '서비스 이용약관 동의가 필요합니다.';
    if (!privacyAgreed) missingConsentErrors.privacy_agreed = '개인정보 수집 및 이용 동의가 필요합니다.';

    if (Object.keys(missingConsentErrors).length > 0) {
      trackEvent('signup_validation_error', { reason: 'required_consents_missing' });
      const firstInvalid = applyFieldErrors(missingConsentErrors);
      setFormMessage('필수 약관 동의를 완료해주세요.', 'error', true);
      if (firstInvalid && typeof firstInvalid.focus === 'function') {
        firstInvalid.focus();
      }
      return;
    }

    if (!legalMeta.terms_version || !legalMeta.privacy_version || !legalMeta.marketing_version) {
      await loadLegalMeta();
    }

    if (!legalMeta.terms_version || !legalMeta.privacy_version || !legalMeta.marketing_version) {
      trackEvent('signup_validation_error', { reason: 'legal_meta_unavailable' });
      setFormMessage('약관 정보를 불러오지 못했습니다. 페이지를 새로고침 후 다시 시도해주세요.', 'error', true);
      return;
    }

    submitting = true;

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '가입 처리 중...';
    }

    try {
      const payload = {
        name,
        email,
        pw,
        age_confirmed: ageConfirmed,
        terms_agreed: termsAgreed,
        privacy_agreed: privacyAgreed,
        marketing_email_opt_in: marketingEmailOptIn,
        terms_version: legalMeta.terms_version,
        privacy_version: legalMeta.privacy_version,
        marketing_version: legalMeta.marketing_version,
      };

      if (needNickname) {
        payload.nickname = nickname;
      }

      const response = await fetch('/api/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      let data = {};
      try {
        data = await response.json();
      } catch (parseErr) {
        console.error('응답 JSON 파싱 오류', parseErr);
      }

      if (!response.ok || !data.ok) {
        trackEvent('signup_api_error', {
          status: response.status || null,
          has_message: Boolean(data && data.message),
          code: data && data.code ? data.code : null,
        });
        const errorMessage =
          authUtils && typeof authUtils.buildErrorMessage === 'function'
            ? authUtils.buildErrorMessage({
                code: data && data.code,
                message: data && data.message,
                retryAfter: data && data.retry_after,
              })
            : data.message || '회원가입 중 오류가 발생했습니다.';
        const firstInvalid = applyFieldErrors(data && data.field_errors);
        setFormMessage(errorMessage, 'error', true);
        if (firstInvalid && typeof firstInvalid.focus === 'function') {
          firstInvalid.focus();
        } else if (authUtils && typeof authUtils.focusFirstInvalid === 'function') {
          authUtils.focusFirstInvalid(form);
        }
        return;
      }

      setFormMessage(data.message || '인증 번호를 이메일로 발송했습니다.', 'success');
      if (window.glsoopUi && typeof window.glsoopUi.showPageNotice === 'function') {
        window.glsoopUi.showPageNotice('인증 번호를 이메일로 보냈습니다.', {
          type: 'success',
          autoHideMs: 2200,
        });
      }

      const pendingId = data.pending_id ? String(data.pending_id) : '';
      trackEvent(
        'signup_success_pending_created',
        {
          pending_id: pendingId || null,
          resend_after: data.resend_after || null,
        },
        { useBeacon: true }
      );

      const query = new URLSearchParams();
      if (pendingId) {
        query.set('pending_id', pendingId);
      }
      if (email) {
        query.set('email', email);
      }

      const queryString = query.toString();
      setTimeout(() => {
        window.location.href = queryString
          ? `/html/verify-email.html?${queryString}`
          : '/html/verify-email.html';
      }, 250);
    } catch (error) {
      console.error(error);
      trackEvent('signup_api_error', {
        reason: 'network_error',
      });
      setFormMessage('회원가입 중 오류가 발생했습니다.', 'error', true);
    } finally {
      submitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '가입하기';
      }
    }
  });
});
