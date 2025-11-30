// public/js/index.js
// 글숲 홈 피드 페이지 스크립트 (모듈 방식)

window.Glsoop = window.Glsoop || {};

Glsoop.FeedPage = (function () {
  // === 내부 상태(전역 대신 모듈 스코프에만 둠) ===
  const FEED_LIMIT = 10;
  let feedOffset = 0;
  let feedLoading = false;
  let feedDone = false;

  // 여러 태그 AND 조건용
  let currentTags = []; // 예: ['힐링', '위로']

  // === 초기화 ===
  function init() {
    // 1) URL 쿼리에서 태그 읽기
    parseTagsFromURL();

    // 2) 피드 초기화
    initFeed();

    // 3) 태그가 이미 붙어 있다면 상단 필터 바 표시
    if (currentTags.length > 0) {
      renderTagFilterBar();
    }

    // 4) 히어로 CTA 잎사귀 애니메이션 세팅
    setupHeroCtaLeaves();
  }

  // URL 쿼리에서 ?tag / ?tags 파싱
  function parseTagsFromURL() {
    const params = new URLSearchParams(window.location.search);

    const singleTag = params.get('tag');   // ?tag=힐링
    const multiTags = params.get('tags');  // ?tags=힐링,위로

    if (multiTags) {
      currentTags = String(multiTags)
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
    } else if (singleTag) {
      currentTags = [singleTag.trim()];
    } else {
      currentTags = [];
    }
  }

  // 피드 초기화: 첫 로드 + 스크롤 이벤트 등록
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

  // 스크롤 이벤트 핸들러
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

      // 현재 태그 필터가 있으면 함께 보내기 (?tags=a,b,c)
      if (currentTags.length > 0) {
        params.set('tags', currentTags.join(','));
      }

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
        if (currentTags.length > 0) {
          const label = currentTags
            .map((t) => `#${escapeHtml(t)}`)
            .join(', ');
          feedBox.innerHTML = `<p class="text-muted">${label} 태그를 모두 포함하는 글이 아직 없습니다.</p>`;
        } else {
          feedBox.innerHTML =
            '<p class="text-muted">아직 작성된 글이 없습니다.</p>';
        }
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
          '<p class="text-danger">피드를 불러오는 중 오류가 발생했습니다。</p>';
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
        // ✅ UTC 문자열을 한국시간으로 변환
        const dateStr = formatKoreanDateTime(post.created_at);

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

        // 이메일 마스킹 (utils.js)
        const maskedEmail = maskEmail(post.author_email);

        // 최종 표시: 닉네임(마스킹된이메일) 형식
        const author = maskedEmail ? `${baseName} (${maskedEmail})` : baseName;

        const likeCount =
          typeof post.like_count === 'number' ? post.like_count : 0;
        const liked =
          post.user_liked === 1 || post.user_liked === true ? true : false;

        // 해시태그 뱃지 HTML
        const hashtagHtml = buildHashtagHtml(post);

        // 폰트 메타(<!--FONT:...-->) 파싱 (utils.js)
        const { cleanHtml, fontKey } = extractFontFromContent(post.content);
        const quoteFontClass =
          fontKey === 'serif' || fontKey === 'sans' || fontKey === 'hand'
            ? `quote-font-${fontKey}`
            : '';

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

              <!-- 해시태그 뱃지들 -->
              ${hashtagHtml}

              <div class="post-content mt-2">
                <div class="feed-post-content">
                  <!-- 인스타 감성 글귀 카드 -->
                  <div class="quote-card ${quoteFontClass}">
                    ${cleanHtml}
                  </div>
                </div>
                <!-- 버튼만 오른쪽 정렬 -->
                <div class="mt-1 text-end">
                  <button
                    class="btn btn-link p-0 more-toggle"
                    type="button"
                    style="display:none;"
                  >
                    더보기...
                  </button>
                </div>
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

    // 새로 추가된 카드들에 대해 폰트/더보기/좋아요/해시태그/작성자 링크/상세보기 설정
    posts.forEach((post) => {
      const card = feedBox.querySelector(`.card[data-post-id="${post.id}"]`);
      if (!card) return;
      setupCardAuthorLink(card, post);
      setupCardInteractions(card, post); // 🔥 post도 함께 넘김
    });
  }

  // === 개별 카드에 대한 인터랙션 세팅 ===
  function setupCardInteractions(card, post) {
    // 1) 글귀 폰트 자동 조절 (utils.js)
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

        moreBtn.addEventListener('click', (e) => {
          // 카드 전체 클릭으로 버블링되지 않게
          e.stopPropagation();
          const nowExpanded = contentBox.classList.toggle('expanded');
          moreBtn.textContent = nowExpanded ? '접기' : '더보기...';
        });
      }
    }

    // 3) 좋아요(공감) 버튼
    const likeBtn = card.querySelector('.like-btn');
    if (likeBtn) {
      likeBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // 카드 클릭 막기
        handleLikeClick(likeBtn);
      });
    }

    // 4) 해시태그 뱃지 클릭 → 태그 필터 추가 (AND 조건)
    const tagButtons = card.querySelectorAll('.hashtag-pill');
    tagButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // 카드 클릭 막기
        const tag = btn.getAttribute('data-tag');
        if (!tag) return;
        applyTagFilter(tag);
      });
    });

    // 5) 카드 전체 클릭 → 글 상세 페이지(트위터 형식)로 이동
    card.addEventListener('click', () => {
      const postId =
        card.getAttribute('data-post-id') || (post && post.id);
      if (!postId) return;

      // localStorage에 글 데이터 저장 (post.html에서 사용)
      if (post) {
        try {
          const detailData = {
            id: post.id,
            title: post.title,
            content: post.content,
            created_at: post.created_at,
            hashtags: post.hashtags,
            author_nickname:
              (post.author_nickname && post.author_nickname.trim()) ||
              (post.author_name && post.author_name.trim()) ||
              null,
            author_email: post.author_email || null,
          };
          localStorage.setItem(
            'glsoop_lastPost',
            JSON.stringify(detailData)
          );
        } catch (err) {
          console.error('failed to cache post detail', err);
        }
      }

      window.location.href = `/html/post.html?postId=${encodeURIComponent(
        postId
      )}`;
    });
  }

  // 좋아요 토글 처리
  async function handleLikeClick(likeBtn) {
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
  }

  // 작성자 영역 클릭 시 작가 페이지로 이동
  function setupCardAuthorLink(card, post) {
    if (!post || !post.author_id) return;

    const metaEl = card.querySelector('.card-text small.text-muted');
    if (!metaEl) return;

    metaEl.setAttribute('data-author-id', post.author_id);
    metaEl.style.cursor = 'pointer';

    metaEl.addEventListener('click', (e) => {
      // 카드 전체 클릭(상세 페이지 이동)과 분리
      e.stopPropagation();
      const authorId = metaEl.getAttribute('data-author-id');
      if (!authorId) return;
      window.location.href = `/html/author.html?userId=${encodeURIComponent(
        authorId
      )}`;
    });
  }

  // ===== 태그 필터 관련 =====

  // 태그 필터 적용 (여러 태그 AND 조건)
  function applyTagFilter(tag) {
    if (!tag) return;

    if (!currentTags.includes(tag)) {
      currentTags.push(tag);
    }

    feedOffset = 0;
    feedDone = false;

    const feedBox = document.getElementById('feedPosts');
    if (feedBox) {
      feedBox.dataset.initialized = '';
      const label = currentTags.map((t) => `#${escapeHtml(t)}`).join(', ');
      feedBox.innerHTML = `<p class="text-muted">${label} 태그를 포함한 글을 불러오는 중입니다...</p>`;
    }

    renderTagFilterBar();

    window.scrollTo({ top: 0, behavior: 'smooth' });
    loadMoreFeed();
  }

  // 태그 필터 바 렌더링
  function renderTagFilterBar() {
    const feedBox = document.getElementById('feedPosts');
    if (!feedBox) return;

    let bar = document.getElementById('tagFilterBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'tagFilterBar';
      bar.className = 'd-flex flex-wrap align-items-center gap-2 mb-3';

      if (feedBox.parentNode) {
        feedBox.parentNode.insertBefore(bar, feedBox);
      }
    }

    if (!currentTags.length) {
      bar.innerHTML = '';
      bar.style.display = 'none';
      return;
    }

    bar.style.display = 'flex';

    const tagsHtml = currentTags
      .map(
        (t) =>
          `<span class="badge text-bg-success me-1">#${escapeHtml(t)}</span>`
      )
      .join('');

    bar.innerHTML = `
      <span class="me-1 small text-muted">적용 중인 태그:</span>
      ${tagsHtml}
      <button type="button" class="btn btn-sm btn-outline-secondary ms-2" id="tagFilterClearBtn">
        필터 지우기
      </button>
    `;

    const clearBtn = bar.querySelector('#tagFilterClearBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', clearTagFilters);
    }
  }

  // 태그 필터 전체 해제
  function clearTagFilters() {
    currentTags = [];
    feedOffset = 0;
    feedDone = false;

    const feedBox = document.getElementById('feedPosts');
    if (feedBox) {
      feedBox.dataset.initialized = '';
      feedBox.innerHTML =
        '<p class="text-muted">전체 글을 불러오는 중입니다...</p>';
    }

    renderTagFilterBar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    loadMoreFeed();
  }

  // 서버에서 내려준 post.hashtags 문자열을 버튼들로 변환
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

    return `<div class="mt-2 text-start">${pills}</div>`;
  }

  // ===== 히어로 CTA 잎사귀 애니메이션 =====
  function setupHeroCtaLeaves() {
    const LEAF_COUNT = 10;
    const heroButtons = document.querySelectorAll('.hero-cta-btn');

    heroButtons.forEach((btn) => {
      const leavesContainer = btn.querySelector('.hero-cta-leaves');
      if (!leavesContainer) return;

      // 잎사귀 span 여러 개 생성 (한 번만)
      if (!leavesContainer.dataset.ready) {
        for (let i = 0; i < LEAF_COUNT; i++) {
          const leaf = document.createElement('span');
          leaf.className = 'hero-cta-leaf';
          leaf.textContent = '🌿';
          leavesContainer.appendChild(leaf);
        }
        leavesContainer.dataset.ready = '1';
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
  }

  // 모듈에서 외부로 내보낼 것
  return {
    init,
  };
})();

// DOMContentLoaded 시점에 모듈 init 호출
document.addEventListener('DOMContentLoaded', () => {
  if (Glsoop && Glsoop.FeedPage && typeof Glsoop.FeedPage.init === 'function') {
    Glsoop.FeedPage.init();
  }
});
