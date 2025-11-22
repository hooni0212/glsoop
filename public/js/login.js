// public/js/login.js
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('loginForm');
    if (!form) return;
  
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
  
      const email = form.email.value.trim();
      const pw = form.pw.value.trim();
  
      if (!email || !pw) {
        alert('이메일과 비밀번호를 모두 입력하세요.');
        return;
      }
  
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, pw }),
        });
  
        const data = await res.json();
        alert(data.message);
  
        if (res.ok && data.ok) {
          // JWT는 httpOnly 쿠키로 저장 → 바로 마이페이지로 이동
          window.location.href = '/html/mypage.html';
        }
      } catch (err) {
        console.error(err);
        alert('로그인 중 오류가 발생했습니다.');
      }
    });
  });
  