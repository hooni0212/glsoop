// public/js/forgot-password.js
// "비밀번호 찾기" / "비밀번호 재설정 메일 보내기" 페이지 스크립트
// - 이메일을 입력받아 /api/password-reset-request 엔드포인트에 요청
// - 처리 결과에 따라 메세지 영역에 안내 문구 출력
// - 전송 중일 때 버튼 비활성화 + 로딩 문구 표시

document.addEventListener('DOMContentLoaded', () => {
  // 폼 요소와 메시지 출력 영역, 전송 버튼 가져오기
  const form = document.getElementById('forgotForm');
  if (!form) return;
  const msgEl = document.getElementById('forgotMessage');
  const submitBtn = form.querySelector('button[type="submit"]');
  const setFormMessage = (message, type = 'info', focus = false) => {
    if (!msgEl) return;
    if (window.glsoopUi && typeof window.glsoopUi.setFeedbackMessage === 'function') {
      window.glsoopUi.setFeedbackMessage(msgEl, message, { type, focus });
      return;
    }
    msgEl.textContent = message || '';
  };
  const clearFormMessage = () => {
    if (!msgEl) return;
    if (window.glsoopUi && typeof window.glsoopUi.clearFeedbackMessage === 'function') {
      window.glsoopUi.clearFeedbackMessage(msgEl);
      return;
    }
    msgEl.textContent = '';
  };
  const showNotice = (message, type = 'info') => {
    if (!window.glsoopUi || typeof window.glsoopUi.showPageNotice !== 'function') return;
    window.glsoopUi.showPageNotice(message, {
      type,
      autoHideMs: type === 'success' ? 2400 : 2800,
    });
  };

  // 폼 제출 이벤트 처리
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); // 기본 폼 제출(페이지 새로고침) 막기

    // 입력한 이메일 값 읽기
    const email = form.email.value.trim();
    if (!email) {
      setFormMessage('이메일을 입력해주세요.', 'error', true);
      if (form.email) form.email.focus();
      return;
    }

    // ===== 전송 시작: UI 준비 =====
    // 메시지 영역 초기화 + 로딩 문구 표시
    clearFormMessage();
    setFormMessage('메일을 보내는 중입니다...', 'info');

    // 버튼 비활성화 + 버튼 텍스트 "전송 중..." 으로 변경
    if (submitBtn) {
      submitBtn.disabled = true;
      // 나중에 원래 텍스트로 돌리기 위해 data-original-text에 백업
      submitBtn.dataset.originalText =
        submitBtn.dataset.originalText || submitBtn.textContent;
      submitBtn.textContent = '전송 중...';
    }

    try {
      // /api/password-reset-request 엔드포인트 호출
      // - body: { email }
      const res = await fetch('/api/password-reset-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      // 서버에서 내려준 message 사용, 없으면 기본 문구
      if (data.ok) {
        setFormMessage(data.message || '요청이 처리되었습니다.', 'success');
        showNotice(data.message || '재설정 메일 안내를 확인해주세요.', 'success');
      } else {
        setFormMessage(data.message || '요청 처리 중 오류가 발생했습니다.', 'error', true);
      }
    } catch (err) {
      // 네트워크 에러 등 예외 처리
      console.error(err);
      setFormMessage(
        '요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        'error',
        true
      );
    } finally {
      // ===== 전송 종료: 버튼 상태 복구 =====
      if (submitBtn) {
        submitBtn.disabled = false;
        // 원래 텍스트가 저장돼있으면 복구, 없으면 기본값 사용
        submitBtn.textContent =
          submitBtn.dataset.originalText || '재설정 메일 보내기';
      }
    }
  });
});
