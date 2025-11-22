// public/js/admin.js

document.addEventListener('DOMContentLoaded', () => {
  loadAdminPage();
});

async function loadAdminPage() {
  const statusBox = document.getElementById('adminStatus');
  const contentBox = document.getElementById('adminContent');
  const usersBox = document.getElementById('adminUsers');
  const postsBox = document.getElementById('adminPosts');

  if (!statusBox || !contentBox || !usersBox || !postsBox) {
    console.error(
      'adminStatus / adminContent / adminUsers / adminPosts 요소를 찾을 수 없습니다.'
    );
    return;
  }

  // 1. 내 정보 확인 + 관리자 여부 체크
  try {
    const meRes = await fetch('/api/me');

    if (!meRes.ok) {
      alert('로그인이 필요한 페이지입니다.');
      window.location.href = '/html/login.html';
      return;
    }

    const meData = await meRes.json();

    if (!meData.ok) {
      alert('로그인이 필요한 페이지입니다.');
      window.location.href = '/html/login.html';
      return;
    }

    if (!meData.isAdmin) {
      alert('관리자만 접근할 수 있는 페이지입니다.');
      window.location.href = '/index.html';
      return;
    }

    // 관리자 ✅
    statusBox.innerHTML = `
      <p class="mb-1">
        <strong>${escapeHtml(meData.name)}</strong> 님, 관리자 권한으로 접속했습니다.
      </p>
      <p class="text-muted mb-0">
        회원과 게시글을 이 페이지에서 관리할 수 있습니다.
      </p>
    `;
    contentBox.style.display = 'block';
  } catch (e) {
    console.error(e);
    alert('접근 권한 확인 중 오류가 발생했습니다.');
    window.location.href = '/index.html';
    return;
  }

  // 2. 회원 목록 로드
  await loadUsers(usersBox);

  // 3. 글 목록 로드
  await loadPosts(postsBox);
}

/** 회원 목록 불러오기 & 렌더링 */
async function loadUsers(usersBox) {
  try {
    const res = await fetch('/api/admin/users');

    if (!res.ok) {
      usersBox.innerHTML =
        '<p class="text-danger">회원 목록을 불러오는 중 오류가 발생했습니다.</p>';
      return;
    }

    const data = await res.json();

    if (!data.ok) {
      usersBox.innerHTML = `<p class="text-danger">${
        data.message || '회원 목록을 불러오지 못했습니다.'
      }</p>`;
      return;
    }

    const users = data.users;

    if (!users || users.length === 0) {
      usersBox.innerHTML =
        '<p class="text-muted">현재 가입된 회원이 없습니다.</p>';
      return;
    }

    const rowsHtml = users
      .map((u) => {
        const isAdminBadge = u.is_admin
          ? '<span class="badge bg-danger ms-1">관리자</span>'
          : '';
        const isVerifiedBadge =
          u.is_verified && Number(u.is_verified) === 1
            ? '<span class="badge bg-success ms-1">인증완료</span>'
            : '<span class="badge bg-secondary ms-1">미인증</span>';

        const nicknameText =
          u.nickname && String(u.nickname).trim().length > 0
            ? escapeHtml(u.nickname)
            : '<span class="text-muted">-</span>';

        return `
          <tr data-user-id="${u.id}">
            <td>${u.id}</td>
            <td>${escapeHtml(u.name)}${isAdminBadge}</td>
            <td>${nicknameText}</td>
            <td>${escapeHtml(u.email)}</td>
            <td>${isVerifiedBadge}</td>
            <td>
              <button
                type="button"
                class="btn btn-sm btn-outline-danger admin-delete-user-btn"
              >
                삭제
              </button>
            </td>
          </tr>
        `;
      })
      .join('');

    usersBox.innerHTML = `
      <div class="table-responsive">
        <table class="table align-middle">
          <thead>
            <tr>
              <th style="width: 60px;">ID</th>
              <th style="width: 160px;">이름</th>
              <th style="width: 160px;">닉네임</th>
              <th>이메일</th>
              <th style="width: 120px;">인증 상태</th>
              <th style="width: 80px;">관리</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;

    // 삭제 버튼 이벤트 위임
    const tbody = usersBox.querySelector('tbody');
    if (!tbody) return;

    tbody.addEventListener('click', async (e) => {
      const target = e.target;
      if (!target.classList.contains('admin-delete-user-btn')) return;

      const tr = target.closest('tr');
      if (!tr) return;

      const userId = tr.getAttribute('data-user-id');
      if (!userId) return;

      const sure = confirm(
        `정말로 이 회원(ID: ${userId})을 삭제할까요?\n` +
          `(이 회원이 작성한 글과 공감도 함께 삭제됩니다.)`
      );
      if (!sure) return;

      try {
        const delRes = await fetch(`/api/admin/users/${userId}`, {
          method: 'DELETE',
        });
        const delData = await delRes.json();

        if (!delRes.ok || !delData.ok) {
          alert(delData.message || '회원 삭제에 실패했습니다.');
          return;
        }

        alert('회원이 삭제되었습니다.');
        tr.remove();

        if (!tbody.children.length) {
          usersBox.innerHTML =
            '<p class="text-muted">현재 가입된 회원이 없습니다.</p>';
        }
      } catch (err) {
        console.error(err);
        alert('회원 삭제 중 오류가 발생했습니다.');
      }
    });
  } catch (e) {
    console.error(e);
    usersBox.innerHTML =
      '<p class="text-danger">회원 목록을 불러오는 중 오류가 발생했습니다.</p>';
  }
}

/** 전체 글 불러오기 & 종이 카드 렌더링 + 삭제 */
async function loadPosts(postsBox) {
  try {
    const res = await fetch('/api/posts/feed');

    if (!res.ok) {
      postsBox.innerHTML =
        '<p class="text-danger">글 목록을 불러오는 중 오류가 발생했습니다.</p>';
      return;
    }

    const data = await res.json();

    if (!data.ok) {
      postsBox.innerHTML = `<p class="text-danger">${
        data.message || '글 목록을 불러오지 못했습니다.'
      }</p>`;
      return;
    }

    const posts = data.posts;

    if (!posts || posts.length === 0) {
      postsBox.innerHTML =
        '<p class="text-muted">등록된 글이 없습니다.</p>';
      return;
    }

    const listHtml = posts
      .map((post) => {
        const dateStr = post.created_at
          ? String(post.created_at).replace('T', ' ').slice(0, 16)
          : '';

        const nickname =
          post.author_nickname && post.author_nickname.trim().length > 0
            ? post.author_nickname.trim()
            : '';

        const baseName =
          nickname ||
          (post.author_name && post.author_name.trim().length > 0
            ? post.author_name.trim()
            : '익명');

        const maskedEmail = maskEmail(post.author_email);
        const author = maskedEmail ? `${baseName} (${maskedEmail})` : baseName;

        return `
          <div class="mb-4 admin-post-wrapper" data-post-id="${post.id}">
            <div class="quote-card">
              <div class="mb-3" style="width: 100%;">
                <div class="d-flex flex-column align-items-center">
                  <div class="paper-title mb-1" style="font-size: 1rem; font-weight: 600;">
                    ${escapeHtml(post.title)}
                  </div>
                  <div class="paper-meta" style="font-size: 0.8rem; color: #777;">
                    ${escapeHtml(author)} · ${dateStr}
                  </div>
                </div>
              </div>
              <div class="paper-content">
                ${post.content}
              </div>
            </div>
            <div class="text-end mt-2">
              <button
                class="btn btn-sm btn-outline-danger admin-delete-post-btn"
                type="button"
              >
                삭제
              </button>
            </div>
          </div>
        `;
      })
      .join('');

    postsBox.innerHTML = listHtml;

    // 글 삭제 이벤트(이벤트 위임)
    postsBox.addEventListener('click', async (e) => {
      const target = e.target;
      if (!target.classList.contains('admin-delete-post-btn')) return;

      const wrapper = target.closest('.admin-post-wrapper');
      if (!wrapper) return;

      const postId = wrapper.getAttribute('data-post-id');
      if (!postId) return;

      const ok = confirm('정말 이 글을 삭제하시겠습니까?');
      if (!ok) return;

      try {
        const delRes = await fetch(`/api/posts/${postId}`, {
          method: 'DELETE',
        });
        const delData = await delRes.json();

        if (!delRes.ok || !delData.ok) {
          alert(delData.message || '글 삭제에 실패했습니다.');
          return;
        }

        wrapper.remove();

        if (!postsBox.querySelector('.admin-post-wrapper')) {
          postsBox.innerHTML =
            '<p class="text-muted">등록된 글이 없습니다.</p>';
        }
      } catch (err) {
        console.error(err);
        alert('글 삭제 중 오류가 발생했습니다.');
      }
    });
  } catch (e) {
    console.error(e);
    postsBox.innerHTML =
      '<p class="text-danger">글 목록을 불러오는 중 오류가 발생했습니다.</p>';
  }
}

function maskEmail(email) {
  if (!email) return '';

  const atIndex = email.indexOf('@');
  const localPart = atIndex === -1 ? email : email.slice(0, atIndex);

  if (localPart.length <= 1) {
    return localPart + '***';
  }
  if (localPart.length === 2) {
    return localPart[0] + '***';
  }
  return localPart.slice(0, 2) + '***';
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
