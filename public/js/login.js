// public/js/login.js
// 로그인 페이지 스크립트
// - 로그인 폼 submit 처리
// - /api/login 호출 후 결과에 따라 마이페이지로 이동

document.addEventListener('DOMContentLoaded', () => {
  // 로그인 폼 요소 가져오기
  const form = document.getElementById('loginForm');
  if (!form) return; // 폼이 없으면 아무 것도 하지 않음 (안전장치)

  const trackEvent = (eventName, properties = {}, options = {}) => {
    if (!window.glsoopAnalytics || typeof window.glsoopAnalytics.trackEvent !== 'function') {
      return;
    }
    window.glsoopAnalytics.trackEvent(eventName, properties, options);
  };

  trackEvent('login_view');

  // 폼 제출 이벤트 리스너 등록
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); // 기본 폼 제출(페이지 새로고침) 막기

    const params = new URLSearchParams(window.location.search);
    const nextUrl = params.get('next');
    trackEvent('login_submit_clicked', {
      has_next: Boolean(nextUrl && nextUrl.startsWith('/')),
    });

    // 폼 안의 input name="email", name="pw"에서 값 읽기
    const email = form.email.value.trim();
    const pw = form.pw.value.trim();

    // 이메일 또는 비밀번호가 비어 있으면 경고
    if (!email || !pw) {
      trackEvent('login_validation_error', {
        reason: 'required_fields_missing',
      });
      alert('이메일과 비밀번호를 모두 입력하세요.');
      return;
    }

    try {
      // /api/login 엔드포인트로 POST 요청
      // - body: { email, pw }
      // - 서버에서 로그인 성공 시 JWT를 httpOnly 쿠키에 세팅
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, pw }),
      });

      // 응답 JSON 파싱 (예: { ok: true/false, message: '...' })
      const data = await res.json();

      // 서버에서 전달한 메시지(alert로 간단히 보여주기)
      alert(data.message);

      // HTTP 응답도 OK이고, 응답 JSON의 ok도 true인 경우 "로그인 성공"으로 간주
// 로그인 성공 후 이동
      if (res.ok && data.ok) {
        // 안전장치: 내부 경로만 허용
        if (nextUrl && nextUrl.startsWith('/')) {
          trackEvent(
            'login_success',
            {
              redirect_to: nextUrl,
            },
            { useBeacon: true }
          );
          window.location.href = nextUrl;
        } else {
          trackEvent(
            'login_success',
            {
              redirect_to: '/html/mypage.html',
            },
            { useBeacon: true }
          );
          window.location.href = '/html/mypage.html';
        }
      } else {
        trackEvent('login_error', {
          status: res.status || null,
          has_message: Boolean(data && data.message),
        });
      }
    } catch (err) {
      // 네트워크 에러 등 예외 처리
      console.error(err);
      trackEvent('login_error', {
        reason: 'network_error',
      });
      alert('로그인 중 오류가 발생했습니다.');
    }
  });
});
