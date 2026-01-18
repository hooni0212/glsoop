// public/js/verify-email.js
// 이메일 OTP 인증 페이지 스크립트

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('verifyEmailForm');
  if (!form) return;

  const params = new URLSearchParams(window.location.search);
  const userId = params.get('user_id');
  const email = params.get('email');
  const helpEl = document.getElementById('verifyEmailHelp');

  if (helpEl && email) {
    const masked = typeof maskEmail === 'function' ? maskEmail(email) : email;
    helpEl.textContent = `${masked} 주소로 인증 번호를 보냈습니다. 메일에 있는 6자리 인증 번호를 입력해 주세요.`;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!userId) {
      alert('인증에 필요한 정보가 없습니다. 회원가입을 다시 진행해 주세요.');
      return;
    }

    const codeInput =
      form.querySelector('input[name="verification_code"]') || null;
    const verificationCode = codeInput ? codeInput.value.trim() : '';

    if (!verificationCode) {
      alert('인증 번호를 입력해 주세요.');
      return;
    }

    try {
      const res = await fetch('/api/verify-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: Number(userId),
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
        alert(data.message || '인증에 실패했습니다.');
        return;
      }

      alert(data.message || '이메일 인증이 완료되었습니다.');
      window.location.href = '/html/login.html';
    } catch (err) {
      console.error(err);
      alert('인증 중 오류가 발생했습니다.');
    }
  });
});
