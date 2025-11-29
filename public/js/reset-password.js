// public/js/reset-password.js
document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  const form = document.getElementById('resetForm');
  const msgEl = document.getElementById('resetMessage');

  if (!token) {
    msgEl.textContent = '유효하지 않은 링크입니다.';
    msgEl.classList.add('text-danger');
    msgEl.style.display = 'block';
    form.style.display = 'none';
    return;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const newPw = form.newPw.value;
    const newPw2 = form.newPw2.value;

    if (newPw !== newPw2) {
      msgEl.textContent = '비밀번호가 서로 일치하지 않습니다.';
      msgEl.classList.remove('text-success');
      msgEl.classList.add('text-danger');
      msgEl.style.display = 'block';
      return;
    }

    if (newPw.length < 8) {
      msgEl.textContent = '비밀번호는 8자 이상으로 설정해주세요.';
      msgEl.classList.remove('text-success');
      msgEl.classList.add('text-danger');
      msgEl.style.display = 'block';
      return;
    }

    try {
      const res = await fetch('/api/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPw }),
      });

      const data = await res.json();
      msgEl.textContent = data.message || '요청이 처리되었습니다.';
      msgEl.style.display = 'block';

      if (data.ok) {
        msgEl.classList.remove('text-danger');
        msgEl.classList.add('text-success');

        // 몇 초 후 로그인 페이지로 이동 (선택)
        setTimeout(() => {
          window.location.href = '/html/login.html';
        }, 2000);
      } else {
        msgEl.classList.remove('text-success');
        msgEl.classList.add('text-danger');
      }
    } catch (err) {
      console.error(err);
      msgEl.textContent = '요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
      msgEl.classList.remove('text-success');
      msgEl.classList.add('text-danger');
      msgEl.style.display = 'block';
    }
  });
});
