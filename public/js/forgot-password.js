// public/js/forgot-password.js
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('forgotForm');
  const msgEl = document.getElementById('forgotMessage');
  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = form.email.value.trim();
    if (!email) return;

    // 메시지 초기화 + 로딩 표시
    msgEl.classList.remove('text-success', 'text-danger');
    msgEl.textContent = '메일을 보내는 중입니다...';
    msgEl.style.display = 'block';

    // 버튼 비활성화 + 텍스트 변경
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

      const data = await res.json();

      msgEl.textContent = data.message || '요청이 처리되었습니다.';
      msgEl.classList.remove('text-success', 'text-danger');

      if (data.ok) {
        msgEl.classList.add('text-success');
      } else {
        msgEl.classList.add('text-danger');
      }
    } catch (err) {
      console.error(err);
      msgEl.textContent =
        '요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
      msgEl.classList.remove('text-success');
      msgEl.classList.add('text-danger');
    } finally {
      // 버튼 복구
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = submitBtn.dataset.originalText || '재설정 메일 보내기';
      }
    }
  });
});
