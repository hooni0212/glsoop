// public/js/mypage.js

let myPostsLoaded = false;
let likedPostsLoaded = false;

document.addEventListener('DOMContentLoaded', () => {
  setupMyPageTabs();
  loadMyPage();          // 내 정보 + 기본 탭(내가 쓴 글) 로드
  setupUserEditForm();   // 내 정보 수정 모달
  setupMyPostCardEvents(); // 수정/삭제 버튼 이벤트
});

async function loadMyPage() {
  const userInfoBox = document.getElementById('userInfo');
  const myPostsBox = document.getElementById('myPosts');
  const likedBox = document.getElementById('likedPosts');

  if (!userInfoBox || !myPostsBox || !likedBox) {
    console.error('userInfo, myPosts, likedPosts 요소를 찾을 수 없습니다.');
    return;
  }

  try {
    // 1. 내 정보 가져오기 (로그인 확인 겸용)
    const meRes = await fetch('/api/me');

    if (!meRes.ok) {
      userInfoBox.innerHTML =
        '<p class="text-danger">로그인이 필요합니다. 로그인 페이지로 이동합니다.</p>';
      myPostsBox.innerHTML = '';
      likedBox.innerHTML = '';
      setTimeout(() => {
        window.location.href = '/html/login.html';
      }, 1500);
      return;
    }

    const meData = await meRes.json();

    if (!meData.ok) {
      userInfoBox.innerHTML =
        '<p class="text-danger">로그인이 필요합니다. 로그인 페이지로 이동합니다.</p>';
      myPostsBox.innerHTML = '';
      likedBox.innerHTML = '';
      setTimeout(() => {
        window.location.href = '/html/login.html';
      }, 1500);
      return;
    }

    // 2. 내 정보 출력 + "내 정보 수정" 버튼 (모달 열기)
    userInfoBox.innerHTML = `
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div>
          <p class="mb-1"><strong>안녕하세요, ${escapeHtml(
            meData.name
          )}님!</strong></p>
          <p class="mb-1">이메일: ${escapeHtml(meData.email)}</p>
        </div>
        <button
          type="button"
          class="btn btn-outline-secondary btn-sm"
          data-bs-toggle="modal"
          data-bs-target="#userEditModal"
        >
          내 정보 수정
        </button>
      </div>
    `;

    // 2-1. 모달 내 닉네임 기본 값 채우기
    const nicknameInput = document.getElementById('nicknameInput');
    if (nicknameInput) {
      nicknameInput.value = meData.nickname || '';
    }

    // 기본 탭: 내가 쓴 글
    await loadMyPosts();
  } catch (e) {
    console.error(e);
    userInfoBox.innerHTML =
      '<p class="text-danger">마이페이지를 불러오는 중 오류가 발생했습니다.</p>';
    const myPostsBox = document.getElementById('myPosts');
    const likedBox = document.getElementById('likedPosts');
    if (myPostsBox) myPostsBox.innerHTML = '';
    if (likedBox) likedBox.innerHTML =
      '<p class="text-danger">공감한 글을 불러오는 중 오류가 발생했습니다.</p>';
  }
}

/* ======================
 *  탭 전환 관련
 * ====================== */

function setupMyPageTabs() {
  const tabMy = document.getElementById('tabMyPosts');
  const tabLiked = document.getElementById('tabLikedPosts');

  if (!tabMy || !tabLiked) return;

  tabMy.addEventListener('click', async () => {
    switchMyPageTab('my');
    if (!myPostsLoaded) {
      await loadMyPosts();
    }
  });

  tabLiked.addEventListener('click', async () => {
    switchMyPageTab('liked');
    if (!likedPostsLoaded) {
      await loadLikedPosts();
    }
  });
}

function switchMyPageTab(target) {
  const tabMy = document.getElementById('tabMyPosts');
  const tabLiked = document.getElementById('tabLikedPosts');
  const mySection = document.getElementById('myPostsSection');
  const likedSection = document.getElementById('likedPostsSection');

  if (!tabMy || !tabLiked || !mySection || !likedSection) return;

  if (target === 'my') {
    tabMy.classList.add('active');
    tabLiked.classList.remove('active');
    mySection.classList.remove('d-none');
    likedSection.classList.add('d-none');
  } else {
    tabMy.classList.remove('active');
    tabLiked.classList.add('active');
    mySection.classList.add('d-none');
    likedSection.classList.remove('d-none');
  }
}

/* ======================
 *  공통 카드 렌더링
 * ====================== */

function renderPostCard(post, options = {}) {
  const { showActions = false } = options;

  const dateStr = formatKoreanDateTime(post.created_at);

  const likeCount =
    post.like_count !== undefined && post.like_count !== null
      ? Number(post.like_count)
      : 0;

  return `
    <div class="card mb-3 mypage-post-card" data-post-id="${post.id}">
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

        ${
          showActions
            ? `
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
        `
            : ''
        }
      </div>
    </div>
  `;
}

/* ======================
 *  내가 쓴 글 로딩
 * ====================== */

async function loadMyPosts() {
  const postsBox = document.getElementById('myPosts');
  if (!postsBox) return;

  postsBox.innerHTML =
    '<p class="text-muted">글 목록을 불러오는 중입니다...</p>';

  try {
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

    const posts = postsData.posts || [];

    if (!posts.length) {
      postsBox.innerHTML =
        '<p class="text-muted">아직 작성한 글이 없습니다.</p>';
      myPostsLoaded = true;
      return;
    }

    const listHtml = posts
      .map((post) => renderPostCard(post, { showActions: true }))
      .join('');

    postsBox.innerHTML = listHtml;
    myPostsLoaded = true;
  } catch (err) {
    console.error(err);
    postsBox.innerHTML =
      '<p class="text-danger">글 목록을 불러오는 중 오류가 발생했습니다.</p>';
  }
}

/* ======================
 *  내가 공감한 글 로딩
 * ====================== */

async function loadLikedPosts() {
  const likedBox = document.getElementById('likedPosts');
  if (!likedBox) return;

  likedBox.innerHTML =
    '<p class="text-muted">공감한 글을 불러오는 중입니다...</p>';

  try {
    const likedRes = await fetch('/api/posts/liked');

    if (!likedRes.ok) {
      likedBox.innerHTML =
        '<p class="text-danger">공감한 글을 불러오는 중 오류가 발생했습니다.</p>';
      return;
    }

    const likedData = await likedRes.json();

    if (!likedData.ok) {
      likedBox.innerHTML = `<p class="text-danger">${
        likedData.message || '공감한 글을 불러오지 못했습니다.'
      }</p>`;
      return;
    }

    const likedPosts = likedData.posts || [];

    if (!likedPosts.length) {
      likedBox.innerHTML =
        '<p class="text-muted">아직 공감한 글이 없습니다.</p>';
      likedPostsLoaded = true;
      return;
    }

    const likedHtml = likedPosts
      .map((post) => renderPostCard(post, { showActions: false }))
      .join('');

    likedBox.innerHTML = likedHtml;
    likedPostsLoaded = true;
  } catch (err) {
    console.error(err);
    likedBox.innerHTML =
      '<p class="text-danger">공감한 글을 불러오는 중 오류가 발생했습니다.</p>';
  }
}

/* ======================
 *  수정/삭제 버튼 이벤트
 * ====================== */

function setupMyPostCardEvents() {
  const postsBox = document.getElementById('myPosts');
  if (!postsBox) return;

  postsBox.addEventListener('click', async (e) => {
    const target = e.target;
    const card = target.closest('.mypage-post-card');
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

        card.remove();

        if (!postsBox.querySelector('.mypage-post-card')) {
          postsBox.innerHTML =
            '<p class="text-muted">아직 작성한 글이 없습니다.</p>';
        }
      } catch (err) {
        console.error(err);
        alert('글 삭제 중 오류가 발생했습니다.');
      }
    }

    // 수정 버튼 → 에디터 페이지로 이동
    if (target.classList.contains('edit-post-btn')) {
      window.location.href = `/html/editor.html?postId=${postId}`;
    }
  });
}

/* ======================
 *  내 정보 수정 폼
 * ====================== */

function setupUserEditForm() {
  const form = document.getElementById('userEditForm');
  const nicknameInput = document.getElementById('nicknameInput');
  const currentPwInput = document.getElementById('currentPwInput');
  const newPwInput = document.getElementById('newPwInput');
  const newPwConfirmInput = document.getElementById('newPwConfirmInput');
  const messageSpan = document.getElementById('userEditMessage');

  if (!form) {
    return; // 폼이 없으면 아무 것도 하지 않음
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const nickname = nicknameInput ? nicknameInput.value.trim() : '';
    const currentPw = currentPwInput ? currentPwInput.value : '';
    const newPw = newPwInput ? newPwInput.value : '';
    const newPwConfirm = newPwConfirmInput ? newPwConfirmInput.value : '';

    if (messageSpan) {
      messageSpan.classList.remove('text-danger', 'text-success');
      messageSpan.textContent = '';
    }

    // 비밀번호 변경 시 기본 검증
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
          messageSpan.textContent =
            '비밀번호를 변경하려면 현재 비밀번호를 입력해주세요.';
        }
        return;
      }

      if (newPw.length < 6) {
        if (messageSpan) {
          messageSpan.classList.add('text-danger');
          messageSpan.textContent =
            '비밀번호는 최소 6자 이상이 좋습니다.';
        }
        return;
      }
    }

    // 변경할 내용이 하나도 없으면 막기
    if (!nickname && !newPw) {
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
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        if (messageSpan) {
          messageSpan.classList.add('text-danger');
          messageSpan.textContent =
            (data && data.message) || '정보 수정에 실패했습니다.';
        }
        return;
      }

      if (messageSpan) {
        messageSpan.classList.add('text-success');
        messageSpan.textContent =
          data.message || '내 정보가 수정되었습니다.';
      }

      // 비밀번호 입력칸은 항상 비워주기
      if (currentPwInput) currentPwInput.value = '';
      if (newPwInput) newPwInput.value = '';
      if (newPwConfirmInput) newPwConfirmInput.value = '';
    } catch (err) {
      console.error(err);
      if (messageSpan) {
        messageSpan.classList.add('text-danger');
        messageSpan.textContent =
          '정보 수정 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
      }
    }
  });
}
