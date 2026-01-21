// public/js/verify-email.js
// 이메일 OTP 인증 페이지 스크립트

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('verifyEmailForm');
  if (!form) return;

  const params = new URLSearchParams(window.location.search);
  const pendingId = params.get('pending_id');
  const email = params.get('email');
  const helpEl = document.getElementById('verifyEmailHelp');
  const errorEl = document.getElementById('verifyError');
  const codeInput = form.querySelector('input[name="verification_code"]');
  const resendBtn = document.getElementById('resendOtpBtn');
  const resendTimerEl = document.getElementById('resendTimer');
  const cooldownSeconds = 60;
  let cooldownRemaining = cooldownSeconds;
  let cooldownTimer = null;

  const formatEmailForDisplay = (address) => {
    if (!address || typeof address !== 'string') return '';
    const trimmed = address.trim();
    const atIndex = trimmed.indexOf('@');
    if (atIndex === -1) return trimmed;
    const local = trimmed.slice(0, atIndex);
    const domain = trimmed.slice(atIndex + 1);
    const visibleLocal = local.length <= 3 ? local : local.slice(0, 3);
    const maskedLocal = local.length > 3 ? `${visibleLocal}****` : visibleLocal;
    return `${maskedLocal}@${domain}`;
  };

  if (helpEl && email) {
    const displayEmail = formatEmailForDisplay(email) || email;
    helpEl.innerHTML = `<strong>${displayEmail}</strong> 주소로 인증 번호를 보냈습니다. 메일에 있는 6자리 인증 번호를 입력해 주세요.`;
  }

  if (codeInput) {
    codeInput.focus();
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
      if (errorEl) {
        errorEl.textContent = '';
      }
    });
  }

  const updateCooldown = () => {
    if (!resendBtn || !resendTimerEl) return;
    resendBtn.disabled = cooldownRemaining > 0;
    resendTimerEl.textContent =
      cooldownRemaining > 0
        ? `재발송 가능까지 ${cooldownRemaining}초`
        : '지금 인증 번호를 재발송할 수 있습니다.';
  };

  const startCooldown = (seconds) => {
    cooldownRemaining = seconds;
    updateCooldown();
    if (cooldownTimer) {
      clearInterval(cooldownTimer);
    }
    cooldownTimer = setInterval(() => {
      cooldownRemaining -= 1;
      updateCooldown();
      if (cooldownRemaining <= 0) {
        clearInterval(cooldownTimer);
        cooldownTimer = null;
      }
    }, 1000);
  };

  startCooldown(cooldownSeconds);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!pendingId) {
      const message = '인증에 필요한 정보가 없습니다. 회원가입을 다시 진행해 주세요.';
      if (errorEl) {
        errorEl.textContent = message;
      }
      alert(message);
      return;
    }

    const verificationCode = codeInput ? codeInput.value.trim() : '';

    if (!verificationCode) {
      const message = '인증 번호를 입력해 주세요.';
      if (errorEl) {
        errorEl.textContent = message;
      }
      alert(message);
      return;
    }

    try {
      const res = await fetch('/api/verify-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pending_id: Number(pendingId),
          verification_code: verificationCode,
        }),
      });

      let data = {};
      try {
        data = await res.json();
      } catch (parseErr) {
        console.error('응답 JSON 파싱 오류', parseErr);
      }

      if (!res.ok || !data.ok) {
        const message = data.message || '인증에 실패했습니다.';
        if (errorEl) {
          errorEl.textContent = message;
        }
        alert(message);
        return;
      }

      if (errorEl) {
        errorEl.textContent = '';
      }
      alert(data.message || '이메일 인증이 완료되었습니다.');
      const redirectUrl =
        data.redirect_url || data.redirectUrl || '/html/login.html';
      window.location.href = redirectUrl;
    } catch (err) {
      console.error(err);
      const message = '인증 중 오류가 발생했습니다.';
      if (errorEl) {
        errorEl.textContent = message;
      }
      alert(message);
    }
  });

  if (resendBtn) {
    resendBtn.addEventListener('click', async () => {
      if (!pendingId && !email) {
        const message = '재발송에 필요한 정보가 없습니다. 회원가입을 다시 진행해 주세요.';
        if (errorEl) {
          errorEl.textContent = message;
        }
        alert(message);
        return;
      }

      resendBtn.disabled = true;
      resendBtn.textContent = '재발송 중...';

      try {
        const res = await fetch('/api/verify-email/resend', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            pending_id: pendingId ? Number(pendingId) : null,
            email,
          }),
        });

        let data = {};
        try {
          data = await res.json();
        } catch (parseErr) {
          console.error('응답 JSON 파싱 오류', parseErr);
        }

        if (!res.ok || !data.ok) {
          const message = data.message || '재발송에 실패했습니다.';
          if (errorEl) {
            errorEl.textContent = message;
          }
          alert(message);
          if (data.retry_after) {
            startCooldown(Number(data.retry_after));
          }
          return;
        }

        if (errorEl) {
          errorEl.textContent = '';
        }
        alert(data.message || '인증 번호를 다시 발송했습니다.');
        const retryAfter = data.retry_after ? Number(data.retry_after) : cooldownSeconds;
        startCooldown(retryAfter);
      } catch (err) {
        console.error(err);
        const message = '재발송 중 오류가 발생했습니다.';
        if (errorEl) {
          errorEl.textContent = message;
        }
        alert(message);
      } finally {
        resendBtn.textContent = '인증 번호 재발송';
        resendBtn.disabled = cooldownRemaining > 0;
      }
    });
  }
});
