// public/js/reset-password.js
// 비밀번호 재설정 페이지 전용 스크립트

document.addEventListener('DOMContentLoaded', () => {
  // 👉 1) URL 쿼리스트링에서 토큰(token) 꺼내기 (?token=xxxx 형태)
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  // 👉 2) HTML 요소들 가져오기
  const form = document.getElementById('resetForm');        // 비밀번호 재설정 폼
  const msgEl = document.getElementById('resetMessage');    // 안내/에러 메시지 영역

  // ✅ 토큰이 없으면: 잘못된/만료된 링크로 간주 → 폼 숨기고 에러 표시
  if (!token) {
    msgEl.textContent = '유효하지 않은 링크입니다.'; // 사용자에게 안내 메시지
    msgEl.classList.add('text-danger');               // 빨간 글씨 스타일
    msgEl.style.display = 'block';                    // 메시지 보이기
    form.style.display = 'none';                      // 폼은 숨기기
    return;                                           // 더 이상 진행하지 않음
  }

  // ✅ 토큰이 있는 정상적인 접근일 때: 폼 submit 이벤트 핸들러 등록
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); // 기본 폼 제출(페이지 새로고침) 막기

    // 👉 3) 사용자가 입력한 새 비밀번호 / 비밀번호 확인 값 읽기
    const newPw = form.newPw.value;
    const newPw2 = form.newPw2.value;

    // 3-1) 두 비밀번호가 서로 같은지 확인
    if (newPw !== newPw2) {
      msgEl.textContent = '비밀번호가 서로 일치하지 않습니다.';
      msgEl.classList.remove('text-success'); // 혹시 남아있을 수 있는 초록색 클래스 제거
      msgEl.classList.add('text-danger');     // 빨간색 메시지 스타일 적용
      msgEl.style.display = 'block';          // 메시지 보이기
      return;
    }

    // 3-2) 비밀번호 최소 길이 검증 (예: 8자 이상)
    if (newPw.length < 8) {
      msgEl.textContent = '비밀번호는 8자 이상으로 설정해주세요.';
      msgEl.classList.remove('text-success');
      msgEl.classList.add('text-danger');
      msgEl.style.display = 'block';
      return;
    }

    // 👉 4) 서버에 비밀번호 재설정 요청 보내기
    //  - 엔드포인트: POST /api/password-reset
    //  - 요청 데이터: { token, newPw }
    try {
      const res = await fetch('/api/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }, // JSON 전송 헤더
        body: JSON.stringify({ token, newPw }),          // 요청 바디에 토큰 + 새 비밀번호 포함
      });

      // 서버에서 돌려준 JSON 응답 파싱
      const data = await res.json();

      // 기본 메시지 텍스트 설정 (서버에서 message를 보내면 그걸 우선 사용)
      msgEl.textContent = data.message || '요청이 처리되었습니다.';
      msgEl.style.display = 'block'; // 메시지 영역 보이기

      if (data.ok) {
        // ✅ 성공 케이스
        msgEl.classList.remove('text-danger');
        msgEl.classList.add('text-success'); // 초록색 성공 메시지

        // 몇 초 후 로그인 페이지로 이동 (UX상 선택 사항이지만 편의를 위해)
        setTimeout(() => {
          window.location.href = '/html/login.html';
        }, 2000); // 2초 후 이동
      } else {
        // ❌ 서버에서 실패 처리한 경우 (예: 토큰 만료 등)
        msgEl.classList.remove('text-success');
        msgEl.classList.add('text-danger');
      }
    } catch (err) {
      // 👉 5) 네트워크 오류, 서버 다운 등 예외 상황
      console.error(err); // 콘솔에 에러 로그 출력 (개발자 확인용)
      msgEl.textContent =
        '요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
      msgEl.classList.remove('text-success');
      msgEl.classList.add('text-danger');
      msgEl.style.display = 'block';
    }
  });
});
