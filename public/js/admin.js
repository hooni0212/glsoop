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
    // 상단 상태 메시지 박스
    const statusBox = document.getElementById('adminStatus');
    // 실제 관리자 컨텐츠 전체를 감싸는 영역 (기본은 display: none;일 수 있음)
    const contentBox = document.getElementById('adminContent');
    // 회원 목록이 들어갈 영역
    const usersBox = document.getElementById('adminUsers');
    // 게시글 목록이 들어갈 영역
    const postsBox = document.getElementById('adminPosts');

    // 필수 DOM 요소가 없으면 관리자 페이지 동작 불가
    if (!statusBox || !contentBox || !usersBox || !postsBox) {
      console.error(
        'adminStatus / adminContent / adminUsers / adminPosts 요소를 찾을 수 없습니다.'
      );
      return;
    }

    // 1. 내 정보 확인 + 관리자 여부 체크
    const me = await fetchMeAsAdmin();
    if (!me) return; // 함수 내부에서 이미 리다이렉트 처리

    // 관리자 안내 메시지 출력
    statusBox.innerHTML = `
      <p class="mb-1">
        <strong>${escapeHtml(me.name)}</strong> 님, 관리자 권한으로 접속했습니다.
      </p>
      <p class="text-muted mb-0">
        회원과 게시글을 이 페이지에서 관리할 수 있습니다.
      </p>
    `;
    // 실제 관리자 컨텐츠 영역 보여주기
    contentBox.style.display = 'block';

    // 2. 회원 목록 로드
    await loadUsers(usersBox);

    // 3. 글 목록 로드
    await loadPosts(postsBox);
  }

  /**
   * /api/me 호출해서 관리자 여부 확인
   * - 로그인 안 되어 있으면: 로그인 페이지로 이동
   * - 로그인은 되어 있는데 관리자 아님: 메인으로 이동
   * - 정상 관리자일 경우 me 데이터 반환
   */
  async function fetchMeAsAdmin() {
    try {
      const meRes = await fetch('/api/me');

      if (!meRes.ok) {
        // 세션 / 토큰 없음 → 로그인 필요
        alert('로그인이 필요한 페이지입니다.');
        window.location.href = '/html/login.html';
        return null;
      }

      const meData = await meRes.json();

      if (!meData.ok) {
        // API에서 ok=false → 로그인 정보 문제
        alert('로그인이 필요한 페이지입니다.');
        window.location.href = '/html/login.html';
        return null;
      }

      if (!meData.isAdmin) {
        // 관리자 플래그가 false라면 접근 차단
        alert('관리자만 접근할 수 있는 페이지입니다.');
        window.location.href = '/index.html';
        return null;
      }

      // 정상적인 관리자 정보 반환
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
   * - GET /api/admin/users
   * - 테이블 형태로 회원들을 보여줌
   * - 삭제 버튼은 이벤트 위임으로 처리
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

      // 가입된 회원이 하나도 없는 경우
      if (!users || users.length === 0) {
        usersBox.innerHTML =
          '<p class="text-muted">현재 가입된 회원이 없습니다.</p>';
        return;
      }

      // 테이블 HTML 생성 후 삽입
      usersBox.innerHTML = buildUsersTableHtml(users);

      // 삭제 버튼 이벤트 위임
      const tbody = usersBox.querySelector('tbody');
      if (!tbody) return;

      // tbody 하위에서 발생하는 클릭 이벤트를 handleUserTableClick으로 전달
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
   * - 관리자 여부 / 이메일 인증 여부를 뱃지로 표시
   * - 각 행에 "삭제" 버튼 추가
   */
  function buildUsersTableHtml(users) {
    const rowsHtml = users
      .map((u) => {
        // is_admin 플래그에 따라 "관리자" 뱃지
        const isAdminBadge = u.is_admin
          ? '<span class="badge bg-danger ms-1">관리자</span>'
          : '';

        // is_verified 값에 따라 이메일 인증 상태 뱃지
        const isVerifiedBadge =
          u.is_verified && Number(u.is_verified) === 1
            ? '<span class="badge bg-success ms-1">인증완료</span>'
            : '<span class="badge bg-secondary ms-1">미인증</span>';

        // 닉네임이 없으면 회색 "-" 표시
        const nicknameText =
          u.nickname && String(u.nickname).trim().length > 0
            ? escapeHtml(u.nickname)
            : '<span class="text-muted">-</span>';

        // 각 회원 한 줄(row) HTML
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

    // 전체 테이블 감싸는 HTML
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
   * - 실제 클릭은 tbody에서 일어나고,
   *   admin-delete-user-btn 클래스를 가진 버튼인지 확인 후 처리
   */
  async function handleUserTableClick(e, tbody, usersBox) {
    const target = e.target;
    if (!target.classList.contains('admin-delete-user-btn')) return;

    // 클릭된 버튼이 속한 tr 찾기
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
      // 관리자 전용 회원 삭제 API
      const delRes = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
      });
      const delData = await delRes.json();

      if (!delRes.ok || !delData.ok) {
        alert(delData.message || '회원 삭제에 실패했습니다.');
        return;
      }

      alert('회원이 삭제되었습니다.');
      // 해당 행 제거
      tr.remove();

      // 더 이상 행이 없으면 "회원 없음" 메시지로 교체
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
   * - GET /api/posts/feed (관리자용 별도 API를 만들 수도 있지만 여기선 공용 피드 활용)
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

      // 등록된 글이 하나도 없을 때
      if (!posts || posts.length === 0) {
        postsBox.innerHTML =
          '<p class="text-muted">등록된 글이 없습니다.</p>';
        return;
      }

      // 카드 목록 HTML 생성 후 삽입
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
   * - 인스타 종이 카드(quote-card) 스타일 재활용
   * - 제목 / 작성자 / 작성일 / 내용 표시
   * - 아래쪽에 "삭제" 버튼
   */
  function buildPostsHtml(posts) {
    return posts
      .map((post) => {
        // created_at을 간단히 "YYYY-MM-DD HH:mm" 형식으로 잘라 사용
        const dateStr = post.created_at
          ? String(post.created_at).replace('T', ' ').slice(0, 16)
          : '';

        // 닉네임이 있으면 우선 사용
        const nickname =
          post.author_nickname && post.author_nickname.trim().length > 0
            ? post.author_nickname.trim()
            : '';

        // 닉네임이 없으면 author_name, 그것도 없으면 "익명"
        const baseName =
          nickname ||
          (post.author_name && post.author_name.trim().length > 0
            ? post.author_name.trim()
            : '익명');

        // 이메일 일부 마스킹
        const maskedEmail = maskEmail(post.author_email);
        const author = maskedEmail ? `${baseName} (${maskedEmail})` : baseName;

        // 관리자 화면용 글 카드 HTML
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
   * - admin-delete-post-btn 클릭 시 해당 글 삭제
   */
  async function handlePostListClick(e, postsBox) {
    const target = e.target;
    if (!target.classList.contains('admin-delete-post-btn')) return;

    // 삭제 버튼이 속한 글 래퍼 요소
    const wrapper = target.closest('.admin-post-wrapper');
    if (!wrapper) return;

    const postId = wrapper.getAttribute('data-post-id');
    if (!postId) return;

    const ok = confirm('정말 이 글을 삭제하시겠습니까?');
    if (!ok) return;

    try {
      // 공용 게시글 삭제 API 사용
      const delRes = await fetch(`/api/posts/${postId}`, {
        method: 'DELETE',
      });
      const delData = await delRes.json();

      if (!delRes.ok || !delData.ok) {
        alert(delData.message || '글 삭제에 실패했습니다.');
        return;
      }

      // DOM에서 해당 글 카드 제거
      wrapper.remove();

      // 더 이상 admin-post-wrapper가 없으면 "등록된 글이 없습니다"로 변경
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
