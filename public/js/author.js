// public/js/author.js

// === 작가 글 목록 무한 스크롤 상태 ===
const AUTHOR_LIMIT = 10;
let authorOffset = 0;
let authorLoading = false;
let authorDone = false;
let currentAuthorId = null;

document.addEventListener('DOMContentLoaded', () => {
  initAuthorPage();
});

async function initAuthorPage() {
  const params = new URLSearchParams(window.location.search);
  const userId = params.get('userId');

  if (!userId) {
    alert('잘못된 접근입니다. 작가 정보를 찾을 수 없어요.');
    window.location.href = '/index.html';
    return;
  }

  currentAuthorId = userId;

  // 프로필 먼저 로드
  await loadAuthorProfile(userId);

  // 글 목록 첫 페이지 로드
  await loadMoreAuthorPosts();

  // 스크롤로 추가 로드
  window.addEventListener('scroll', handleAuthorScroll);
}

// === 작가 프로필 불러오기 ===
async function loadAuthorProfile(authorId) {
  try {
    const res = await fetch(`/api/users/${authorId}/profile`);
    const data = await res.json();

    if (!res.ok || !data.ok) {
      alert(data.message || '작가 정보를 불러오는 중 오류가 발생했습니다.');
      return;
    }

    const user = data.user;

    const nickname = (user.nickname && user.nickname.trim()) || '익명';
    const emailMasked = maskEmail(user.email || '');

    // 상단 타이틀
    const titleEl = document.getElementById('authorPageTitle');
    if (titleEl) {
      titleEl.textContent = `${nickname}님의 나무`;
    }

    // 왼쪽 카드 닉네임
    const nickEl = document.getElementById('authorNicknameDisplay');
    if (nickEl) {
      nickEl.textContent = nickname;
    }

    // ✅ 실명은 전혀 노출하지 않고, 이메일도 마스킹만
    const emailEl = document.getElementById('authorEmailDisplay');
    if (emailEl) {
      emailEl.textContent = emailMasked
        ? `이메일: ${emailMasked}`
        : '이메일: -';
    }

    // 통계
    const postCountEl = document.getElementById('authorPostCount');
    const likeCountEl = document.getElementById('authorLikeCount');

    if (postCountEl) postCountEl.textContent = user.postCount || 0;
    if (likeCountEl) likeCountEl.textContent = user.totalLikes || 0;
  } catch (e) {
    console.error(e);
    alert('작가 정보를 불러오는 중 오류가 발생했습니다.');
  }
}

// === 스크롤로 다음 글 로드 ===
function handleAuthorScroll() {
  if (authorLoading || authorDone) return;

  const scrollTop =
    window.pageYOffset ||
    document.documentElement.scrollTop ||
    document.body.scrollTop ||
    0;
  const clientHeight =
    document.documentElement.clientHeight || window.innerHeight;
  const scrollHeight =
    document.documentElement.scrollHeight || document.body.scrollHeight;

  if (scrollTop + clientHeight >= scrollHeight - 200) {
    loadMoreAuthorPosts();
  }
}

// === 작가 글 목록 추가 로드 ===
async function loadMoreAuthorPosts() {
  if (!currentAuthorId) return;

  const listBox = document.getElementById('authorPostsList');
  const loadingEl = document.getElementById('authorPostsLoading');
  const emptyEl = document.getElementById('authorPostsEmpty');
  const endEl = document.getElementById('authorPostsEnd');

  if (!listBox) return;
  if (authorLoading || authorDone) return;

  authorLoading = true;
  if (loadingEl) loadingEl.style.display = 'block';

  try {
    const params = new URLSearchParams({
      offset: String(authorOffset),
      limit: String(AUTHOR_LIMIT),
    });

    const res = await fetch(
      `/api/users/${currentAuthorId}/posts?` + params.toString()
    );
    const data = await res.json();

    if (!res.ok || !data.ok) {
      alert(data.message || '작가 글을 불러오는 중 오류가 발생했습니다.');
      return;
    }

    const posts = data.posts || [];

    // 첫 로드인데 글이 아예 없는 경우
    if (authorOffset === 0 && posts.length === 0) {
      if (emptyEl) emptyEl.style.display = 'block';
      authorDone = true;
      return;
    }

    if (posts.length === 0) {
      authorDone = true;
      if (endEl) endEl.style.display = 'block';
      return;
    }

    renderAuthorPosts(posts);

    authorOffset += posts.length;
    if (posts.length < AUTHOR_LIMIT) {
      authorDone = true;
      if (endEl) endEl.style.display = 'block';
    }
  } catch (e) {
    console.error(e);
    alert('작가 글을 불러오는 중 오류가 발생했습니다.');
  } finally {
    authorLoading = false;
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

// === 작가 글 카드 렌더링 ===
function renderAuthorPosts(posts) {
  const listBox = document.getElementById('authorPostsList');
  if (!listBox || !posts || posts.length === 0) return;

  const fragmentHtml = posts
    .map((post) => {
      const dateStr = post.created_at
        ? String(post.created_at).replace('T', ' ').slice(0, 16)
        : '';

      const likeCount =
        typeof post.like_count === 'number' ? post.like_count : 0;
      const liked =
        post.user_liked === 1 || post.user_liked === true ? true : false;

      const hashtagHtml = buildHashtagHtml(post);

      // 폰트 메타 파싱
      const { cleanHtml, fontKey } = extractFontFromContent(post.content);
      const quoteFontClass =
        fontKey === 'serif' || fontKey === 'sans' || fontKey === 'hand'
          ? `quote-font-${fontKey}`
          : '';

      return `
        <div class="card author-post-card" data-post-id="${post.id}">
          <div class="card-body">
            <h6 class="author-post-title mb-1">${escapeHtml(
              post.title
            )}</h6>
            <div class="author-post-meta text-muted mb-1">
              <small>${dateStr}</small>
            </div>

            <div class="author-post-extra d-flex align-items-center mb-2">
              <button
                class="like-btn ${liked ? 'liked' : ''}"
                type="button"
                data-post-id="${post.id}"
                data-liked="${liked ? '1' : '0'}"
              >
                <span class="like-heart">${liked ? '♥' : '♡'}</span>
                <span class="like-count ms-1">${likeCount}</span>
              </button>
              <div class="ms-2">
                ${hashtagHtml}
              </div>
            </div>

            <div class="post-content mt-2 text-end">
              <div class="feed-post-content">
                <div class="quote-card ${quoteFontClass}">
                  ${cleanHtml}
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  listBox.insertAdjacentHTML('beforeend', fragmentHtml);

  // 새 카드들에 인터랙션 세팅
  posts.forEach((post) => {
    const card = listBox.querySelector(
      `.author-post-card[data-post-id="${post.id}"]`
    );
    if (!card) return;
    setupAuthorPostInteractions(card);
  });
}

// === 개별 작가 글 카드 인터랙션 ===
function setupAuthorPostInteractions(card) {
  // 글귀 폰트 자동 조절
  const quoteCard = card.querySelector('.quote-card');
  if (quoteCard) {
    autoAdjustQuoteFont(quoteCard);
  }

  // 좋아요 버튼
  const likeBtn = card.querySelector('.like-btn');
  if (likeBtn) {
    likeBtn.addEventListener('click', async () => {
      const postId = likeBtn.getAttribute('data-post-id');
      if (!postId) return;

      try {
        const res = await fetch(`/api/posts/${postId}/toggle-like`, {
          method: 'POST',
        });

        if (res.status === 401) {
          alert('로그인 후 공감할 수 있습니다.');
          window.location.href = '/html/login.html';
          return;
        }

        const data = await res.json();
        if (!res.ok || !data.ok) {
          alert(data.message || '공감 처리 중 오류가 발생했습니다.');
          return;
        }

        const liked = !!data.liked;
        const likeCount =
          typeof data.likeCount === 'number' ? data.likeCount : 0;

        likeBtn.setAttribute('data-liked', liked ? '1' : '0');

        const heartEl = likeBtn.querySelector('.like-heart');
        const countEl = likeBtn.querySelector('.like-count');

        if (heartEl) {
          heartEl.textContent = liked ? '♥' : '♡';
        }
        if (countEl) {
          countEl.textContent = likeCount;
        }

        likeBtn.classList.toggle('liked', liked);

        // 좋아요 애니메이션
        if (heartEl && liked) {
          heartEl.style.transition = 'transform 0.16s ease-out';
          heartEl.style.transform = 'scale(1)';
          void heartEl.offsetWidth;
          heartEl.style.transform = 'scale(1.28)';
          setTimeout(() => {
            heartEl.style.transform = 'scale(1)';
          }, 160);
        }
      } catch (e) {
        console.error(e);
        alert('공감 처리 중 오류가 발생했습니다.');
      }
    });
  }

  // 해시태그 클릭 시 홈 피드로 이동해서 필터 적용 (선택)
  const tagButtons = card.querySelectorAll('.hashtag-pill');
  tagButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tag = btn.getAttribute('data-tag');
      if (!tag) return;
      // 홈 피드로 이동하면서 태그 쿼리 넘기기
      window.location.href = `/index.html?tag=${encodeURIComponent(tag)}`;
    });
  });
}

/* ===== 공통 유틸 (index.js와 동일 스타일) ===== */

// 글 길이에 따라 카드 안 글꼴 크기 자동 조절
function autoAdjustQuoteFont(el) {
  if (!el) return;

  const text = el.innerText.trim();
  const len = text.length;

  let fontSize = 1.6; // 기본

  if (len > 140) {
    fontSize = 1.1;
  } else if (len > 100) {
    fontSize = 1.2;
  } else if (len > 70) {
    fontSize = 1.3;
  } else if (len > 40) {
    fontSize = 1.4;
  } else {
    fontSize = 1.6;
  }

  if (fontSize < 1.1) fontSize = 1.1;

  el.style.fontSize = fontSize + 'rem';
  el.style.lineHeight = Math.min(fontSize + 0.4, 2.0);
}

function maskEmail(email) {
  if (!email) return '';

  const atIndex = email.indexOf('@');
  const localPart = atIndex === -1 ? email : email.slice(0, atIndex);
  const len = localPart.length;

  if (len === 0) return '';

  const visibleLen = Math.min(3, len);
  const visible = localPart.slice(0, visibleLen);
  const hiddenCount = len - visibleLen;
  const stars = hiddenCount > 0 ? '*'.repeat(hiddenCount) : '';

  return visible + stars;
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

// 해시태그 → 버튼 HTML
function buildHashtagHtml(post) {
  if (!post.hashtags) return '';

  const tags = String(post.hashtags)
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (!tags.length) return '';

  const pills = tags
    .map(
      (t) =>
        `<button type="button"
                  class="btn btn-sm btn-outline-success me-1 mb-1 hashtag-pill"
                  data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</button>`
    )
    .join('');

  return `<div class="mt-1 text-start">${pills}</div>`;
}

// 글 content에서 폰트 메타(<!--FONT:...-->) 분리
function extractFontFromContent(html) {
  if (!html) {
    return { cleanHtml: '', fontKey: null };
  }

  const str = String(html);
  const m = str.match(/^<!--FONT:(serif|sans|hand)-->/);
  if (!m) {
    return { cleanHtml: str, fontKey: null };
  }

  const cleanHtml = str.replace(m[0], '').trim();
  const fontKey = m[1];
  return { cleanHtml, fontKey };
}

// === 작가 프로필 카드가 스크롤을 따라오게 만들기 ===
function setupAuthorProfileSticky() {
  const profileCard = document.querySelector('.author-profile-card');
  if (!profileCard) return;

  // 최초 위치 / 크기 저장용 변수
  let baseTop = 0;
  let baseLeft = 0;
  let baseWidth = 0;

  function captureBaseRect() {
    const rect = profileCard.getBoundingClientRect();
    baseTop = rect.top + (window.pageYOffset ||
      document.documentElement.scrollTop ||
      0);
    baseLeft = rect.left + (window.pageXOffset ||
      document.documentElement.scrollLeft ||
      0);
    baseWidth = rect.width;
  }

  function resetProfileCardStyle() {
    profileCard.style.position = '';
    profileCard.style.top = '';
    profileCard.style.left = '';
    profileCard.style.width = '';
  }

  function handleStickyScroll() {
    const viewportWidth =
      window.innerWidth || document.documentElement.clientWidth || 0;

    // 모바일 / 태블릿에서는 따라다니지 않게 (원래대로)
    if (viewportWidth < 992) {
      resetProfileCardStyle();
      return;
    }

    const scrollY =
      window.pageYOffset ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      0;

    // 네비게이션 높이 + 살짝 여백
    const NAV_OFFSET = 140; // 필요하면 80~120 사이로 숫자만 조절해도 됨

    // 아직 기준값을 못 잡았으면 한 번 계산
    if (!baseWidth) {
      captureBaseRect();
    }

    // 스크롤이 카드의 원래 위치를 지나쳤을 때 → 화면에 고정
    if (scrollY + NAV_OFFSET > baseTop) {
      profileCard.style.position = 'fixed';
      profileCard.style.top = NAV_OFFSET + 'px';
      profileCard.style.left = baseLeft + 'px';
      profileCard.style.width = baseWidth + 'px';
    } else {
      // 원래 자리 위쪽일 때는 고정 해제
      resetProfileCardStyle();
    }
  }

  // 초기 기준값 계산
  captureBaseRect();

  // 스크롤/창 크기 변경 시마다 다시 계산
  window.addEventListener('scroll', handleStickyScroll);
  window.addEventListener('resize', () => {
    resetProfileCardStyle();
    captureBaseRect();
    handleStickyScroll();
  });

  // 최초 한 번 실행
  handleStickyScroll();
}

// ✅ 기존 initAuthorPage와는 별도로, DOMContentLoaded에 한 번 더 등록
document.addEventListener('DOMContentLoaded', () => {
  setupAuthorProfileSticky();
});
