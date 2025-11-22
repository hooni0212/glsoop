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

    // 5. 카드 + 종이질감 quote-card + 공감수 + 수정/삭제 버튼
    const listHtml = posts
      .map((post) => {
        const dateStr = post.created_at
          ? String(post.created_at).replace('T', ' ').slice(0, 16)
          : '';

        const likeCount =
          post.like_count !== undefined && post.like_count !== null
            ? Number(post.like_count)
            : 0;

        return `
          <div class="card mb-3 mypost-card" data-post-id="${post.id}">
            <div class="card-body d-flex flex-column align-items-center">
              <div class="quote-card">
                <div class="mb-3" style="width: 100%;">
                  <div class="d-flex flex-column align-items-center">
                    <div class="paper-title mb-1" style="font-size: 1rem; font-weight: 600;">
                      ${escapeHtml(post.title)}
                    </div>
                    <div class="paper-meta" style="font-size: 0.8rem; color: #777;">
                      ${dateStr}
                      &nbsp;&nbsp;
                      <span class="mypage-like">
                        <span class="mypage-like-heart">♥</span>
                        <span class="mypage-like-count">${likeCount}</span>
                      </span>
                    </div>
                  </div>
                </div>
                <div class="paper-content">
                  ${post.content}
                </div>
              </div>

              <!-- 수정 / 삭제 버튼 줄 -->
              <div class="d-flex justify-content-end w-100 mt-3 gap-2">
                <button
                  type="button"
                  class="btn btn-sm btn-outline-secondary edit-post-btn"
                >
                  수정
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-outline-danger delete-post-btn"
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

    // 6. 수정 / 삭제 버튼 이벤트 (이벤트 위임)
    postsBox.addEventListener('click', async (e) => {
      const target = e.target;

      // 가장 가까운 카드 요소 찾기
      const card = target.closest('.mypost-card');
      if (!card) return;

      const postId = card.getAttribute('data-post-id');
      if (!postId) return;

      // 삭제 버튼
      if (target.classList.contains('delete-post-btn')) {
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

          // DOM에서 카드 제거
          card.remove();

          if (!postsBox.querySelector('.mypost-card')) {
            postsBox.innerHTML =
              '<p class="text-muted">아직 작성한 글이 없습니다.</p>';
          }
        } catch (err) {
          console.error(err);
          alert('글 삭제 중 오류가 발생했습니다.');
        }
      }

      // 수정 버튼 → 에디터 페이지로 이동 (쿼리스트링에 postId 전달)
      if (target.classList.contains('edit-post-btn')) {
        window.location.href = `/html/editor.html?postId=${postId}`;
      }
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
