// public/js/signup.js
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('signupForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = form.name.value.trim();
    const nickname = form.nickname.value.trim();
    const email = form.email.value.trim();
    const pw = form.pw.value.trim();

    if (!name || !nickname || !email || !pw) {
      alert('모든 필드를 입력하세요.');
      return;
    }

    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, nickname, email, pw }),
      });

      const data = await res.json();
      alert(data.message);

      if (res.ok && data.ok) {
        // 가입 성공 → 로그인 페이지로 이동
        window.location.href = '/html/login.html';
      }
    } catch (err) {
      console.error(err);
      alert('회원가입 중 오류가 발생했습니다.');
    }
  });
});
