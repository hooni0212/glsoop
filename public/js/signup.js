// public/js/signup.js
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('signupForm');
  if (!form) return;

  let submitting = false; // 🔒 중복 제출 방지 플래그

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (submitting) {
      // 이미 요청 중이면 무시 (모바일 더블 탭 방지)
      return;
    }

    // --- 입력 필드 찾기 (name 또는 id 둘 다 대응) ---
    const nameInput =
      form.querySelector('input[name="name"], input#name') || null;
    const nicknameInput =
      form.querySelector('input[name="nickname"], input#nickname') || null;
    const emailInput =
      form.querySelector('input[name="email"], input#email') || null;
    const pwInput =
      form.querySelector(
        'input[name="pw"], input[name="password"], input#pw, input#password'
      ) || null;

    const name = nameInput ? nameInput.value.trim() : '';
    const nickname = nicknameInput ? nicknameInput.value.trim() : '';
    const email = emailInput ? emailInput.value.trim() : '';
    const pw = pwInput ? pwInput.value.trim() : '';

    // --- 필수값 체크 ---
    // 닉네임 필드는 실제로 존재할 때만 필수로 취급
    const needNickname = !!nicknameInput;

    if (!name || !email || !pw || (needNickname && !nickname)) {
      alert('이름, 닉네임, 이메일, 비밀번호를 모두 입력하세요.');
      return;
    }

    submitting = true;
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '가입 처리 중...';
    }

    try {
      const payload = {
        name,
        email,
        pw,
      };

      // 닉네임 필드가 실제로 존재하면 같이 보내기 (백엔드에서 nickname 받도록 했으면)
      if (needNickname) {
        payload.nickname = nickname;
      }

      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      let data = {};
      try {
        data = await res.json();
      } catch (parseErr) {
        console.error('응답 JSON 파싱 오류', parseErr);
      }

      // ✅ 실패 처리 (이미 사용 중인 이메일 등)
      if (!res.ok || !data.ok) {
        alert(data.message || '회원가입 중 오류가 발생했습니다.');
        return; // 여기서 끝! 아래 성공 코드로 내려가지 않게.
      }

      // ✅ 성공 처리
      alert(
        data.message ||
          '입력하신 이메일로 인증 링크를 보냈어요. 메일에서 인증을 완료한 뒤 로그인해 주세요.'
      );
      window.location.href = '/html/login.html';
    } catch (err) {
      console.error(err);
      alert('회원가입 중 오류가 발생했습니다.');
    } finally {
      submitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '가입하기';
      }
    }
  });
});
