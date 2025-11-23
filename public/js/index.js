// public/js/index.js

// === 피드 무한 스크롤 상태 ===
const FEED_LIMIT = 10;
let feedOffset = 0;
let feedLoading = false;
let feedDone = false;

document.addEventListener('DOMContentLoaded', () => {
  initFeed();
});

// 피드 초기화: 첫 20개 로드 + 스크롤 이벤트 등록
async function initFeed() {
  const feedBox = document.getElementById('feedPosts');
  if (!feedBox) {
    console.error('feedPosts 요소를 찾을 수 없습니다.');
    return;
  }

  feedBox.innerHTML = '<p class="text-muted">피드를 불러오는 중입니다...</p>';

  await loadMoreFeed();

  // 스크롤 끝 근처에서 추가 로드
  window.addEventListener('scroll', handleFeedScroll);
}

function handleFeedScroll() {
  if (feedLoading || feedDone) return;

  const scrollTop =
    window.pageYOffset ||
    document.documentElement.scrollTop ||
    document.body.scrollTop ||
    0;
  const clientHeight =
    document.documentElement.clientHeight || window.innerHeight;
  const scrollHeight =
    document.documentElement.scrollHeight || document.body.scrollHeight;

  // 맨 아래에서 200px 이내로 내려오면 다음 글 로드
  if (scrollTop + clientHeight >= scrollHeight - 200) {
    loadMoreFeed();
  }
}

// === 서버에서 글 목록 추가 로드 ===
async function loadMoreFeed() {
  const feedBox = document.getElementById('feedPosts');
  if (!feedBox) return;
  if (feedLoading || feedDone) return;

  feedLoading = true;

  try {
    const params = new URLSearchParams({
      offset: String(feedOffset),
      limit: String(FEED_LIMIT),
    });

    const res = await fetch('/api/posts/feed?' + params.toString());

    if (!res.ok) {
      if (feedOffset === 0) {
        feedBox.innerHTML =
          '<p class="text-danger">피드를 불러오는 중 오류가 발생했습니다.</p>';
      }
      feedLoading = false;
      return;
    }

    const data = await res.json();

    if (!data.ok) {
      if (feedOffset === 0) {
        feedBox.innerHTML = `<p class="text-danger">${
          data.message || '피드를 불러올 수 없습니다.'
        }</p>`;
      }
      feedLoading = false;
      return;
    }

    const posts = data.posts || [];

    // 첫 로드인데 글이 아예 없는 경우
    if (feedOffset === 0 && posts.length === 0) {
      feedBox.innerHTML =
        '<p class="text-muted">아직 작성된 글이 없습니다.</p>';
      feedDone = true;
      feedLoading = false;
      return;
    }

    // 더 이상 받아올 글이 없는 경우
    if (posts.length === 0) {
      feedDone = true;
      feedLoading = false;
      return;
    }

    renderFeedPosts(posts);

    feedOffset += posts.length;
    if (posts.length < FEED_LIMIT) {
      feedDone = true;
    }
  } catch (e) {
    console.error(e);
    if (feedOffset === 0) {
      feedBox.innerHTML =
        '<p class="text-danger">피드를 불러오는 중 오류가 발생했습니다.</p>';
    }
  } finally {
    feedLoading = false;
  }
}

// === 받아온 posts를 DOM에 추가하고, 카드별 이벤트 세팅 ===
function renderFeedPosts(posts) {
  const feedBox = document.getElementById('feedPosts');
  if (!feedBox || !posts || posts.length === 0) return;

  const fragmentHtml = posts
    .map((post) => {
      const dateStr = post.created_at
        ? String(post.created_at).replace('T', ' ').slice(0, 16)
        : '';

      // 닉네임 + (마스킹 이메일) 표시
      const nickname =
        post.author_nickname && post.author_nickname.trim().length > 0
          ? post.author_nickname.trim()
          : '';

      const baseName =
        nickname ||
        (post.author_name && post.author_name.trim().length > 0
          ? post.author_name.trim()
          : '익명');

      // 이메일 마스킹
      const maskedEmail = maskEmail(post.author_email);

      // 최종 표시: 닉네임(마스킹된이메일) 형식
      const author = maskedEmail ? `${baseName} (${maskedEmail})` : baseName;

      const likeCount =
        typeof post.like_count === 'number' ? post.like_count : 0;
      const liked =
        post.user_liked === 1 || post.user_liked === true ? true : false;

      return `
        <div class="card mb-3" data-post-id="${post.id}">
          <div class="card-body">
            <h5 class="card-title mb-1">${escapeHtml(post.title)}</h5>
            <p class="card-text mb-1">
              <small class="text-muted">${escapeHtml(
                author
              )} · ${dateStr}</small>
            </p>

            <!-- 공감(하트) 버튼 -->
            <div class="mb-1">
              <button
                class="like-btn ${liked ? 'liked' : ''}"
                type="button"
                data-post-id="${post.id}"
                data-liked="${liked ? '1' : '0'}"
              >
                <span class="like-heart">${liked ? '♥' : '♡'}</span>
                <span class="like-count ms-1">${likeCount}</span>
              </button>
            </div>

            <div class="post-content mt-2 text-end">
              <div class="feed-post-content">
                <!-- 인스타 감성 글귀 카드 -->
                <div class="quote-card">
                  ${post.content}
                </div>
              </div>
              <button
                class="btn btn-link p-0 mt-1 more-toggle"
                type="button"
                style="display:none;"
              >
                더보기...
              </button>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  // 첫 로드에서 "불러오는 중..." 제거
  if (!feedBox.dataset.initialized) {
    feedBox.innerHTML = '';
    feedBox.dataset.initialized = '1';
  }

  // 맨 아래에 추가
  feedBox.insertAdjacentHTML('beforeend', fragmentHtml);

  // 새로 추가된 카드들에 대해 폰트/더보기/좋아요 설정
  posts.forEach((post) => {
    const card = feedBox.querySelector(`.card[data-post-id="${post.id}"]`);
    if (!card) return;
    setupCardInteractions(card);
  });
}

// === 개별 카드에 대한 인터랙션 세팅 ===
function setupCardInteractions(card) {
  // 1) 글귀 폰트 자동 조절
  const quoteCard = card.querySelector('.quote-card');
  if (quoteCard) {
    autoAdjustQuoteFont(quoteCard);
  }

  // 2) 더보기 토글
  const contentBox = card.querySelector('.feed-post-content');
  const moreBtn = card.querySelector('.more-toggle');

  if (contentBox && moreBtn) {
    const isOverflowing =
      contentBox.scrollHeight > contentBox.clientHeight + 4;

    if (!isOverflowing) {
      moreBtn.style.display = 'none';
    } else {
      moreBtn.style.display = 'inline-block';
      moreBtn.textContent = '더보기...';

      moreBtn.addEventListener('click', () => {
        const nowExpanded = contentBox.classList.toggle('expanded');
        moreBtn.textContent = nowExpanded ? '접기' : '더보기...';
      });
    }
  }

  // 3) 좋아요(공감) 버튼
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

        // 좋아요 ON일 때만 "톡" 애니메이션
        if (heartEl && liked) {
          heartEl.classList.remove('bump');
          // 강제 리플로우
          void heartEl.offsetWidth;
          heartEl.classList.add('bump');

          setTimeout(() => {
            heartEl.classList.remove('bump');
          }, 220);
        }
      } catch (e) {
        console.error(e);
        alert('공감 처리 중 오류가 발생했습니다.');
      }
    });
  }
}

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
  const localPart = atIndex === -1 ? email : email.slice(0, atIndex); // @ 앞부분만 사용

  if (localPart.length <= 1) {
    return localPart + '***';
  }
  if (localPart.length === 2) {
    return localPart[0] + '***';
  }
  // 3글자 이상이면 앞 2글자만 보이고 나머지는 ***
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

// ===== 히어로 CTA 잎사귀 애니메이션 =====
document.addEventListener('DOMContentLoaded', () => {
  const LEAF_COUNT = 10;

  const heroButtons = document.querySelectorAll('.hero-cta-btn');

  heroButtons.forEach((btn) => {
    const leavesContainer = btn.querySelector('.hero-cta-leaves');
    if (!leavesContainer) return;

    // 잎사귀 span 여러 개 생성
    for (let i = 0; i < LEAF_COUNT; i++) {
      const leaf = document.createElement('span');
      leaf.className = 'hero-cta-leaf';
      leaf.textContent = '🌿';
      leavesContainer.appendChild(leaf);
    }

    const leaves = Array.from(
      leavesContainer.querySelectorAll('.hero-cta-leaf')
    );

    const triggerLeaves = () => {
      const BASE_POSITIONS = [
        { x: -70, y: -36 },
        { x: -55, y: -30 },
        { x: -40, y: -26 },
        { x: -25, y: -34 },
        { x: -10, y: -28 },
        { x: 10, y: -32 },
        { x: 25, y: -24 },
        { x: 40, y: -30 },
        { x: 55, y: -26 },
        { x: 70, y: -36 },
      ];

      const shuffled = BASE_POSITIONS.slice().sort(() => Math.random() - 0.5);

      leaves.forEach((leaf, idx) => {
        const base = shuffled[idx % shuffled.length];

        const jitterX = Math.random() * 12 - 6; // -6 ~ +6
        const jitterY = Math.random() * 10 - 5; // -5 ~ +5

        const offsetX = base.x + jitterX;
        const offsetY = base.y + jitterY;

        const scale = 0.85 + Math.random() * 0.5; // 0.85 ~ 1.35
        const rotate = -35 + Math.random() * 70; // -35deg ~ 35deg

        leaf.style.setProperty('--leaf-tx', `${offsetX}px`);
        leaf.style.setProperty('--leaf-ty', `${offsetY}px`);
        leaf.style.setProperty('--leaf-scale', scale);
        leaf.style.setProperty('--leaf-rot', `${rotate}deg`);

        leaf.classList.remove('leaf-show');
        void leaf.offsetWidth;
        leaf.classList.add('leaf-show');

        setTimeout(() => {
          leaf.classList.remove('leaf-show');
        }, 1000);
      });
    };

    btn.addEventListener('mouseenter', triggerLeaves);
    btn.addEventListener('focus', triggerLeaves);
  });
});
