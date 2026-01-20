// public/js/signup.js
// 회원가입 페이지 전용 스크립트
// - 필드 값 읽기
// - 필수값 검증
// - 중복 제출 방지
// - /api/signup 호출 후 결과 처리

document.addEventListener('DOMContentLoaded', () => {
  // 회원가입 폼 요소 찾기
  const form = document.getElementById('signupForm');
  if (!form) return; // 폼이 없으면 아무 것도 하지 않고 종료
    // ✅ 전체 동의(agreeAll) 체크박스 동작 (CSP 대응: 인라인 스크립트 제거)
  // - #agreeAll 체크 시: 필수/선택 항목을 모두 동일 상태로 맞춤
  // - 개별 체크 변경 시: 전체 동의 체크 여부를 자동 갱신
  const agreeAll = document.getElementById('agreeAll');
  if (agreeAll) {
    const requiredChecks = document.querySelectorAll('.agree-required');
    const optionalChecks = document.querySelectorAll('.agree-optional');

    function updateAgreeAll() {
      const allRequiredChecked = Array.from(requiredChecks).every((chk) => chk.checked);
      const allOptionalChecked =
        Array.from(optionalChecks).every((chk) => chk.checked) || optionalChecks.length === 0;

      agreeAll.checked = allRequiredChecked && allOptionalChecked;
    }

    agreeAll.addEventListener('change', () => {
      const checked = agreeAll.checked;
      requiredChecks.forEach((chk) => { chk.checked = checked; });
      optionalChecks.forEach((chk) => { chk.checked = checked; });
    });

    requiredChecks.forEach((chk) => chk.addEventListener('change', updateAgreeAll));
    optionalChecks.forEach((chk) => chk.addEventListener('change', updateAgreeAll));

    // 초기 상태 동기화
    updateAgreeAll();
  }


  // 🔒 중복 제출 방지용 플래그 (요청 중일 때 true)
  let submitting = false;

  // 폼 전송 이벤트 리스너 등록
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); // 기본 폼 제출(페이지 새로고침) 막기

    // 이미 제출 요청이 진행 중이면 추가 클릭 무시 (모바일 더블 탭 등 대비)
    if (submitting) {
      return;
    }

    // --- 1) 입력 필드 찾기 ---
    // name 속성이든, id 속성이든 대응할 수 있도록 둘 다 검색
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

    // --- 2) 입력 값 읽어서 공백 제거 ---
    const name = nameInput ? nameInput.value.trim() : '';
    const nickname = nicknameInput ? nicknameInput.value.trim() : '';
    const email = emailInput ? emailInput.value.trim() : '';
    const pw = pwInput ? pwInput.value.trim() : '';

    // --- 3) 필수값 체크 ---
    // 닉네임 필드는 실제로 DOM에 존재할 때만 필수 항목으로 취급
    const needNickname = !!nicknameInput;

    // 이름 / 이메일 / 비밀번호 / (닉네임 필요하면 닉네임까지) 모두 확인
    if (!name || !email || !pw || (needNickname && !nickname)) {
      alert('이름, 닉네임, 이메일, 비밀번호를 모두 입력하세요.');
      return;
    }

    // 여기까지 통과하면 실제로 서버에 요청 보내기 시작
    submitting = true; // 중복 제출 방지 on

    // 제출 버튼을 찾아서 UX 개선 (비활성화 + 문구 변경)
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '가입 처리 중...';
    }

    try {
      // --- 4) 서버에 보낼 payload 구성 ---
      const payload = {
        name,
        email,
        pw,
      };

      // 닉네임 필드가 실제로 존재한다면 함께 보내기
      // (백엔드가 nickname을 받도록 구현되어 있다면 이 값이 저장됨)
      if (needNickname) {
        payload.nickname = nickname;
      }

      // --- 5) /api/signup 엔드포인트로 POST 요청 ---
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', // JSON 형식으로 전송
        },
        body: JSON.stringify(payload), // payload를 문자열로 변환해서 보냄
      });

      // 응답 JSON 파싱 (혹시 JSON이 아니더라도 앱이 죽지 않도록 try/catch)
      let data = {};
      try {
        data = await res.json();
      } catch (parseErr) {
        console.error('응답 JSON 파싱 오류', parseErr);
      }

      // --- 6) 실패 처리 ---
      // - HTTP 상태 코드가 200이 아니거나
      // - data.ok 가 false라면 에러로 간주
      // (예: 이미 존재하는 이메일, 유효하지 않은 입력 등)
      if (!res.ok || !data.ok) {
        alert(data.message || '회원가입 중 오류가 발생했습니다.');
        return; // 여기서 종료 → 아래 성공 처리로 내려가지 않음
      }

      // --- 7) 성공 처리 ---
      // 백엔드에서 message를 내려주면 그걸 우선 사용
      alert(data.message || '인증 번호를 이메일로 발송했습니다.');

      const pendingId = data.pending_id ? String(data.pending_id) : '';
      const query = new URLSearchParams();
      if (pendingId) {
        query.set('pending_id', pendingId);
      }
      if (email) {
        query.set('email', email);
      }

      const queryString = query.toString();

      // 가입 성공 후 인증 번호 입력 페이지로 이동
      window.location.href = queryString
        ? `/html/verify-email.html?${queryString}`
        : '/html/verify-email.html';
    } catch (err) {
      // --- 8) 네트워크 오류 등 예외 상황 ---
      console.error(err);
      alert('회원가입 중 오류가 발생했습니다.');
    } finally {
      // --- 9) 항상 실행되는 후처리 ---
      submitting = false; // 다음 제출을 허용하도록 플래그 해제

      // 버튼 상태 원래대로 복원
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '가입하기';
      }
    }
  });
});
