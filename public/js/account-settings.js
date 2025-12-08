let originalAccount = {
  nickname: '',
  bio: '',
  about: '',
};

async function loadAccountSettings() {
  const emailField = document.getElementById('emailField');
  const nicknameField = document.getElementById('nicknameField');
  const bioField = document.getElementById('bioField');
  const aboutField = document.getElementById('aboutField');
  const messageSpan = document.getElementById('accountSettingsMessage');

  try {
    const res = await fetch('/api/me');
    const data = await res.json();

    if (!res.ok || !data.ok) {
      if (messageSpan) {
        messageSpan.classList.remove('text-success');
        messageSpan.classList.add('text-danger');
        messageSpan.textContent = '로그인이 필요합니다. 로그인 페이지로 이동합니다.';
      }
      setTimeout(() => {
        window.location.href = '/html/login.html';
      }, 1500);
      return;
    }

    if (emailField) emailField.value = data.email || '';

    originalAccount.nickname = data.nickname || '';
    originalAccount.bio = data.bio || '';
    originalAccount.about = data.about || '';

    if (nicknameField) nicknameField.value = originalAccount.nickname;
    if (bioField) bioField.value = originalAccount.bio;
    if (aboutField) aboutField.value = originalAccount.about;
  } catch (err) {
    console.error(err);
    if (messageSpan) {
      messageSpan.classList.remove('text-success');
      messageSpan.classList.add('text-danger');
      messageSpan.textContent = '계정 정보를 불러오지 못했습니다.';
    }
  }
}

function setupAccountSettingsForm() {
  const form = document.getElementById('accountSettingsForm');
  if (!form) return;

  const emailField = document.getElementById('emailField');
  const nicknameField = document.getElementById('nicknameField');
  const bioField = document.getElementById('bioField');
  const aboutField = document.getElementById('aboutField');
  const currentPwField = document.getElementById('currentPwField');
  const newPwField = document.getElementById('newPwField');
  const newPwConfirmField = document.getElementById('newPwConfirmField');
  const messageSpan = document.getElementById('accountSettingsMessage');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const nickname = nicknameField ? nicknameField.value.trim() : '';
    const bio = bioField ? bioField.value.trim() : '';
    const about = aboutField ? aboutField.value : '';
    const currentPw = currentPwField ? currentPwField.value : '';
    const newPw = newPwField ? newPwField.value : '';
    const newPwConfirm = newPwConfirmField ? newPwConfirmField.value : '';

    if (messageSpan) {
      messageSpan.classList.remove('text-danger', 'text-success');
      messageSpan.textContent = '';
    }

    if (newPw || newPwConfirm) {
      if (!newPw || !newPwConfirm) {
        if (messageSpan) {
          messageSpan.classList.add('text-danger');
          messageSpan.textContent = '새 비밀번호와 확인을 모두 입력해주세요.';
        }
        return;
      }

      if (newPw !== newPwConfirm) {
        if (messageSpan) {
          messageSpan.classList.add('text-danger');
          messageSpan.textContent = '새 비밀번호가 서로 일치하지 않습니다.';
        }
        return;
      }

      if (!currentPw) {
        if (messageSpan) {
          messageSpan.classList.add('text-danger');
          messageSpan.textContent = '비밀번호를 변경하려면 현재 비밀번호를 입력해주세요.';
        }
        return;
      }

      if (newPw.length < 6) {
        if (messageSpan) {
          messageSpan.classList.add('text-danger');
          messageSpan.textContent = '비밀번호는 최소 6자 이상이 좋습니다.';
        }
        return;
      }
    }

    const hasProfileChange =
      nickname !== (originalAccount.nickname || '') ||
      bio !== (originalAccount.bio || '') ||
      about !== (originalAccount.about || '');

    if (!hasProfileChange && !newPw) {
      if (messageSpan) {
        messageSpan.classList.add('text-danger');
        messageSpan.textContent = '변경할 내용을 입력해주세요.';
      }
      return;
    }

    try {
      const res = await fetch('/api/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: nickname || null,
          currentPw: currentPw || null,
          newPw: newPw || null,
          bio: bio,
          about: about,
          email: emailField ? emailField.value : undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        if (messageSpan) {
          messageSpan.classList.add('text-danger');
          messageSpan.textContent = (data && data.message) || '정보 수정에 실패했습니다.';
        }
        return;
      }

      originalAccount.nickname = nickname;
      originalAccount.bio = bio;
      originalAccount.about = about;

      if (messageSpan) {
        messageSpan.classList.add('text-success');
        messageSpan.textContent = data.message || '계정 정보가 저장되었습니다.';
      }

      setTimeout(() => {
        window.location.href = '/html/mypage.html';
      }, 800);

      if (currentPwField) currentPwField.value = '';
      if (newPwField) newPwField.value = '';
      if (newPwConfirmField) newPwConfirmField.value = '';
    } catch (err) {
      console.error(err);
      if (messageSpan) {
        messageSpan.classList.add('text-danger');
        messageSpan.textContent = '정보를 저장하는 중 오류가 발생했습니다.';
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadAccountSettings();
  setupAccountSettingsForm();
});
