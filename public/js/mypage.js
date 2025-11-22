// public/js/mypage.js

document.addEventListener('DOMContentLoaded', () => {
  loadMyPage();
});

async function loadMyPage() {
  const userInfoBox = document.getElementById('userInfo');
  const postsBox = document.getElementById('myPosts');

  if (!userInfoBox || !postsBox) {
    console.error('userInfo 또는 myPosts 요소를 찾을 수 없습니다.');
    return;
  }

  try {
    // 1. 내 정보 가져오기 (로그인 확인 겸용)
    const meRes = await fetch('/api/me');

    if (!meRes.ok) {
      userInfoBox.innerHTML =
        '<p class="text-danger">로그인이 필요합니다. 로그인 페이지로 이동합니다.</p>';
      postsBox.innerHTML = '';
      setTimeout(() => {
        window.location.href = '/html/login.html';
      }, 1500);
      return;
    }

    const meData = await meRes.json();

    if (!meData.ok) {
      userInfoBox.innerHTML =
        '<p class="text-danger">로그인이 필요합니다. 로그인 페이지로 이동합니다.</p>';
      postsBox.innerHTML = '';
      setTimeout(() => {
        window.location.href = '/html/login.html';
      }, 1500);
      return;
    }

    // 2. 내 정보 출력
    userInfoBox.innerHTML = `
      <p class="mb-1"><strong>안녕하세요, ${escapeHtml(meData.name)}님!</strong></p>
      <p class="mb-1">이메일: ${escapeHtml(meData.email)}</p>
    `;

    // 3. 내가 쓴 글 목록 가져오기
    const postsRes = await fetch('/api/posts/my');

    if (!postsRes.ok) {
      postsBox.innerHTML =
        '<p class="text-danger">글 목록을 불러오는 중 오류가 발생했습니다.</p>';
      return;
    }

    const postsData = await postsRes.json();

    if (!postsData.ok) {
      postsBox.innerHTML = `<p class="text-danger">${
        postsData.message || '글 목록을 불러오지 못했습니다.'
      }</p>`;
      return;
    }

    const posts = postsData.posts;

    // 4. 작성한 글이 하나도 없을 때
    if (!posts || posts.length === 0) {
      postsBox.innerHTML =
        '<p class="text-muted">아직 작성한 글이 없습니다.</p>';
      return;
    }

    // 5. 글 목록 카드로 렌더링 (제목 + 날짜 + 공감 수 + 내용 + 수정/삭제 버튼)
    const listHtml = posts
      .map((post) => {
        const dateStr = post.created_at
          ? String(post.created_at).replace('T', ' ').slice(0, 16)
          : '';

        const likeCount =
          typeof post.like_count === 'number' ? post.like_count : 0;

        return `
          <div class="card mb-3" data-post-id="${post.id}">
            <div class="card-body">
              <h5 class="card-title mb-1">${escapeHtml(post.title)}</h5>

              <div class="d-flex align-items-center mb-1">
                <small class="text-muted me-2">
                  ${dateStr}
                </small>
                <span class="mypage-like d-inline-flex align-items-center">
                  <span class="mypage-like-heart">♥</span>
                  <span class="mypage-like-count ms-1">${likeCount}</span>
                </span>
              </div>

              <div class="post-content mt-2">
                <div class="border rounded p-2">
                  ${post.content}
                </div>
              </div>

              <div class="mt-3 d-flex gap-2">
                <button
                  type="button"
                  class="btn btn-sm btn-outline-success edit-post-btn"
                  data-post-id="${post.id}"
                >
                  수정
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-outline-danger delete-post-btn"
                  data-post-id="${post.id}"
                >
                  삭제
                </button>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    postsBox.innerHTML = listHtml;

    // 6. 수정 버튼 이벤트
    const editButtons = postsBox.querySelectorAll('.edit-post-btn');
    editButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const postId = btn.getAttribute('data-post-id');
        if (!postId) return;
        // editor.html 수정 모드로 이동
        window.location.href = `/html/editor.html?postId=${postId}`;
      });
    });

    // 7. 삭제 버튼 이벤트
    const deleteButtons = postsBox.querySelectorAll('.delete-post-btn');
    deleteButtons.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const postId = btn.getAttribute('data-post-id');
        if (!postId) return;

        const ok = window.confirm('정말 이 글을 삭제하시겠습니까?');
        if (!ok) return;

        try {
          const res = await fetch(`/api/posts/${postId}`, {
            method: 'DELETE',
          });

          const data = await res.json();

          if (!res.ok || !data.ok) {
            alert(data.message || '글 삭제에 실패했습니다.');
            return;
          }

          alert('글이 삭제되었습니다.');
          // 카드 DOM에서 제거
          const card = btn.closest('.card');
          if (card) {
            card.remove();
          }
        } catch (e) {
          console.error(e);
          alert('글 삭제 중 오류가 발생했습니다.');
        }
      });
    });
  } catch (e) {
    console.error(e);
    userInfoBox.innerHTML =
      '<p class="text-danger">마이페이지를 불러오는 중 오류가 발생했습니다.</p>';
    postsBox.innerHTML = '';
  }
}

// 제목/이메일용 이스케이프 (content는 HTML 그대로 렌더링)
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
