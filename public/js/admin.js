// public/js/admin.js
// 글숲 관리자 페이지 스크립트 (모듈 방식)

window.Glsoop = window.Glsoop || {};

Glsoop.AdminPage = (function () {
  /**
   * 엔트리 포인트
   * - DOM 요소 찾기
   * - 관리자 권한 확인
   * - 유저 목록 / 글 목록 로드
   */
  async function init() {
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
    const me = await fetchMeAsAdmin();
    if (!me) return; // 함수 내부에서 이미 리다이렉트 처리

    // 관리자 안내 메시지
    statusBox.innerHTML = `
      <p class="mb-1">
        <strong>${escapeHtml(me.name)}</strong> 님, 관리자 권한으로 접속했습니다.
      </p>
      <p class="text-muted mb-0">
        회원과 게시글을 이 페이지에서 관리할 수 있습니다.
      </p>
    `;
    contentBox.style.display = 'block';

    // 2. 회원 목록 로드
    await loadUsers(usersBox);

    // 3. 글 목록 로드
    await loadPosts(postsBox);
  }

  /**
   * /api/me 호출해서 관리자 여부 확인
   * - 관리자 아니면 alert + 리다이렉트
   * - 성공 시 me 데이터 반환
   */
  async function fetchMeAsAdmin() {
    try {
      const meRes = await fetch('/api/me');

      if (!meRes.ok) {
        alert('로그인이 필요한 페이지입니다.');
        window.location.href = '/html/login.html';
        return null;
      }

      const meData = await meRes.json();

      if (!meData.ok) {
        alert('로그인이 필요한 페이지입니다.');
        window.location.href = '/html/login.html';
        return null;
      }

      if (!meData.isAdmin) {
        alert('관리자만 접근할 수 있는 페이지입니다.');
        window.location.href = '/index.html';
        return null;
      }

      return meData;
    } catch (e) {
      console.error(e);
      alert('접근 권한 확인 중 오류가 발생했습니다.');
      window.location.href = '/index.html';
      return null;
    }
  }

  /**
   * 회원 목록 불러오기 & 렌더링
   */
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

      usersBox.innerHTML = buildUsersTableHtml(users);

      // 삭제 버튼 이벤트 위임
      const tbody = usersBox.querySelector('tbody');
      if (!tbody) return;

      tbody.addEventListener('click', (e) =>
        handleUserTableClick(e, tbody, usersBox)
      );
    } catch (e) {
      console.error(e);
      usersBox.innerHTML =
        '<p class="text-danger">회원 목록을 불러오는 중 오류가 발생했습니다.</p>';
    }
  }

  /**
   * 회원 테이블 HTML 생성
   */
  function buildUsersTableHtml(users) {
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

    return `
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
  }

  /**
   * 회원 삭제 버튼 클릭 처리 (이벤트 위임)
   */
  async function handleUserTableClick(e, tbody, usersBox) {
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
  }

  /**
   * 전체 글 불러오기 & 종이 카드 렌더링 + 삭제
   */
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

      postsBox.innerHTML = buildPostsHtml(posts);

      // 글 삭제 이벤트(이벤트 위임)
      postsBox.addEventListener('click', (e) =>
        handlePostListClick(e, postsBox)
      );
    } catch (e) {
      console.error(e);
      postsBox.innerHTML =
        '<p class="text-danger">글 목록을 불러오는 중 오류가 발생했습니다.</p>';
    }
  }

  /**
   * 관리자 글 카드 목록 HTML 생성
   */
  function buildPostsHtml(posts) {
    return posts
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
  }

  /**
   * 관리자 글 목록 영역 클릭 처리 (삭제 버튼용)
   */
  async function handlePostListClick(e, postsBox) {
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
  }

  // 모듈 외부로 내보낼 것
  return {
    init,
  };
})();

// DOMContentLoaded 시점에 모듈 init 호출
document.addEventListener('DOMContentLoaded', () => {
  if (
    window.Glsoop &&
    Glsoop.AdminPage &&
    typeof Glsoop.AdminPage.init === 'function'
  ) {
    Glsoop.AdminPage.init();
  }
});
