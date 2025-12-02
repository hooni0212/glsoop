// public/js/header.js
// 상단 공통 헤더(네비게이션 바) 스크립트
// - 로그인 여부에 따라 "로그인/회원가입" 또는 "내 이름/마이페이지/글쓰기/로그아웃" 표시
// - 로그아웃 버튼 동작 처리

document.addEventListener('DOMContentLoaded', () => {
  // 페이지가 로드되면 헤더 상태(로그인/로그아웃)를 먼저 갱신
  updateHeader();

  // 로그아웃 버튼 이벤트 등록
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }
});

/**
 * 헤더 영역에 로그인 상태 반영
 * - /api/me로 사용자 정보를 요청
 *   - 성공(200, data.ok=true) → 로그인 상태로 판단
 *   - 실패(401 등) 또는 data.ok=false → 비로그인 상태로 판단
 * - .before-login 요소: 로그인 전 메뉴(로그인/회원가입)
 * - .after-login 요소: 로그인 후 메뉴(닉네임/마이페이지/글쓰기/로그아웃)
 */
async function updateHeader() {
  // 로그인 전/후 메뉴 그룹들을 모두 가져옴 (페이지마다 여러 개 있을 수 있음)
  const beforeEls = document.querySelectorAll('.before-login');
  const afterEls = document.querySelectorAll('.after-login');
  const nameSpan = document.getElementById('navUserName'); // 상단에 "OOO님" 표시용

  try {
    const res = await fetch('/api/me', { cache: 'no-store' });

    // HTTP 레벨에서 실패하면 "로그인 안 된 상태"로 처리
    if (!res.ok) {
      // 로그인 안 된 상태: before-login 보이기, after-login 숨기기
      beforeEls.forEach((el) => (el.style.display = 'flex'));
      afterEls.forEach((el) => (el.style.display = 'none'));
      if (nameSpan) nameSpan.textContent = '';
      return;
    }

    const data = await res.json();

    if (data.ok) {
      // 로그인 상태
      // - 로그인 전 메뉴 숨기고
      // - 로그인 후 메뉴 보이기
      beforeEls.forEach((el) => (el.style.display = 'none'));
      afterEls.forEach((el) => (el.style.display = 'flex'));

      // 상단에 사용자 이름 표시 (예: "홍길동님")
      if (nameSpan) nameSpan.textContent = `${data.name}님`;
    } else {
      // 응답은 200이지만 data.ok가 false → 로그인 실패로 간주
      beforeEls.forEach((el) => (el.style.display = 'flex'));
      afterEls.forEach((el) => (el.style.display = 'none'));
      if (nameSpan) nameSpan.textContent = '';
    }
  } catch (e) {
    // 네트워크 에러 등 예외 발생 시에도 안전하게 "비로그인" 상태로 표시
    console.error(e);
    beforeEls.forEach((el) => (el.style.display = 'flex'));
    afterEls.forEach((el) => (el.style.display = 'none'));
    if (nameSpan) nameSpan.textContent = '';
  }
}

/**
 * 로그아웃 버튼 클릭 처리
 * - POST /api/logout 호출
 * - 성공/실패와 상관 없이 마지막에는 홈(/index.html)으로 이동
 */
async function handleLogout() {
  try {
    // 서버에 로그아웃 요청 (세션/쿠키 삭제 등)
    const res = await fetch('/api/logout', { method: 'POST' });

    // JSON 파싱 실패할 수도 있으니 .catch로 빈 객체 대체
    const data = await res.json().catch(() => ({}));

    // 서버에서 내려준 메시지를 우선 사용, 없으면 기본 문구
    alert((data && data.message) || '로그아웃되었습니다.');
  } catch (e) {
    console.error(e);
    alert('로그아웃 중 오류가 발생했습니다.');
  } finally {
    // 로그아웃 후에는 항상 메인 페이지로 이동
    window.location.href = '/index.html';
  }
}
