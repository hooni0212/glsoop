// public/js/header.js
document.addEventListener('DOMContentLoaded', () => {
    updateHeader();
  
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', handleLogout);
    }
  });
  
  async function updateHeader() {
    const beforeEls = document.querySelectorAll('.before-login');
    const afterEls = document.querySelectorAll('.after-login');
    const nameSpan = document.getElementById('navUserName');
  
    try {
      const res = await fetch('/api/me');
      if (!res.ok) {
        // 로그인 안 된 상태
        beforeEls.forEach((el) => (el.style.display = 'flex'));
        afterEls.forEach((el) => (el.style.display = 'none'));
        if (nameSpan) nameSpan.textContent = '';
        return;
      }
  
      const data = await res.json();
      if (data.ok) {
        // 로그인 상태
        beforeEls.forEach((el) => (el.style.display = 'none'));
        afterEls.forEach((el) => (el.style.display = 'flex'));
        if (nameSpan) nameSpan.textContent = `${data.name}님`;
      } else {
        beforeEls.forEach((el) => (el.style.display = 'flex'));
        afterEls.forEach((el) => (el.style.display = 'none'));
      }
    } catch (e) {
      console.error(e);
      beforeEls.forEach((el) => (el.style.display = 'flex'));
      afterEls.forEach((el) => (el.style.display = 'none'));
    }
  }
  
  async function handleLogout() {
    try {
      const res = await fetch('/api/logout', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      alert((data && data.message) || '로그아웃되었습니다.');
    } catch (e) {
      console.error(e);
      alert('로그아웃 중 오류가 발생했습니다.');
    } finally {
      window.location.href = '/index.html';
    }
  }
  