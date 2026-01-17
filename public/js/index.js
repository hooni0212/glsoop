// public/js/index.js
// 글숲 홈 피드 페이지 스크립트 (모듈 방식)
// - 메인 피드 무한 스크롤
// - 공감(좋아요) 기능
// - 해시태그 필터(AND 조건) 기능
// - 글 상세 페이지(post.html)로 이동
// - 작가 페이지(author.html)로 이동
// 전역 네임스페이스 보존 (다른 스크립트와 충돌 방지용)
window.Glsoop = window.Glsoop || {};

// 즉시 실행 함수(IIFE)로 모듈 스코프 생성
Glsoop.FeedPage = (function () {
  // === 내부 상태(전역 대신 모듈 스코프에만 둠) ===
  const FEED_LIMIT = 10;     // 한 번에 가져올 글 개수
  let feedOffset = 0;        // 서버에서 글을 가져올 때 시작 위치(offset)
  let feedLoading = false;   // 현재 글을 가져오는 중인지 여부
  let feedDone = false;      // 더 이상 가져올 글이 없는지 여부
  let currentSort = 'latest'; // 현재 정렬 옵션 (latest | popular)
  let currentFeedType = 'all'; // 현재 피드 유형 (all | following)
  let currentCategory = null; // 현재 카테고리 필터 (null | poem | essay | short)
  let feedSession = 0;       // 정렬/필터 전환 시 세션 토큰 (응답 혼선 방지)

  // 여러 태그 AND 조건용 필터 목록
  // 예: ['힐링', '위로'] → 이 두 태그를 모두 포함한 글만 보기
  let currentTags = [];

  // === 초기화 ===
  function init() {
    // 1) URL 쿼리에서 태그 읽기 (?tag=힐링 또는 ?tags=힐링,위로)
    parseTagsFromURL();

    // 2) 피드 탭(최신/인기/팔로잉) 이벤트 등록
    setupFeedTabs();

    // 3) 카테고리 필터(전체/시/에세이/짧은 구절) 이벤트 등록
    setupCategoryFilters();

    // 4) 피드 초기화 (첫 로드 + 스크롤 이벤트 등록)
    initFeed();

    // 5) 태그가 이미 붙어 있다면 상단 필터 바 표시
    if (currentTags.length > 0) {
      renderTagFilterBar();
    }
  }

  /**
   * URL 쿼리 문자열에서 ?tag / ?tags 파싱
   * - ?tag=힐링 → currentTags = ['힐링']
   * - ?tags=힐링,위로 → currentTags = ['힐링','위로']
   */
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

  function setupFeedTabs() {
    const tabButtons = document.querySelectorAll('[data-feed-tab]');
    if (!tabButtons.length) return;

    const activeTab =
      document.querySelector('[data-feed-tab].active') || tabButtons[0];
    if (activeTab) {
      currentSort = activeTab.dataset.sort || 'latest';
      currentFeedType = activeTab.dataset.type || 'all';
    }

    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextSort = btn.dataset.sort || 'latest';
        const nextType = btn.dataset.type || 'all';

        if (nextSort === currentSort && nextType === currentFeedType) return;

        tabButtons.forEach((tab) => {
          const isActive = tab === btn;
          tab.classList.toggle('active', isActive);
          tab.classList.toggle('feed-tab-active', isActive);
          if (isActive) {
            tab.setAttribute('aria-current', 'true');
          } else {
            tab.removeAttribute('aria-current');
          }
        });

        resetFeedState({ sort: nextSort, type: nextType });
      });
    });
  }

  function setupCategoryFilters() {
    const categoryButtons = document.querySelectorAll('[data-category-filter]');
    if (!categoryButtons.length) return;

    const activeBtn =
      document.querySelector('[data-category-filter].active') || categoryButtons[0];
    if (activeBtn) {
      currentCategory = normalizeCategoryValue(activeBtn.dataset.categoryFilter);
    }

    categoryButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextCategory = normalizeCategoryValue(btn.dataset.categoryFilter);
        if (nextCategory === currentCategory) return;

        categoryButtons.forEach((b) => {
          const isActive = b === btn;
          b.classList.toggle('active', isActive);
          if (isActive) {
            b.setAttribute('aria-current', 'true');
          } else {
            b.removeAttribute('aria-current');
          }
        });

        resetFeedState({ category: nextCategory });
      });
    });
  }

  function normalizeCategoryValue(raw) {
    if (!raw || raw === 'all') return null;
    if (raw === 'poem' || raw === 'essay' || raw === 'short') return raw;
    return null;
  }

  function resetFeedState({
    sort = currentSort,
    type = currentFeedType,
    category = currentCategory,
  } = {}) {
    currentSort = sort;
    currentFeedType = type;
    currentCategory = category;
    feedSession += 1;
    feedOffset = 0;
    feedDone = false;
    feedLoading = false;

    const feedBox = document.getElementById('feedPosts');
    if (feedBox) {
      feedBox.dataset.initialized = '';
      const loadingLabel =
        currentFeedType === 'following'
          ? '팔로잉 피드를 불러오는 중입니다...'
          : '피드를 불러오는 중입니다...';
      feedBox.innerHTML = `<p class="gls-text-muted">${loadingLabel}</p>`;
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    loadMoreFeed();
  }

  /**
   * 피드 초기화
   * - 첫 페이지 글 로드
   * - 무한 스크롤 이벤트 등록
   */
  async function initFeed() {
    const feedBox = document.getElementById('feedPosts');
    if (!feedBox) {
      console.error('feedPosts 요소를 찾을 수 없습니다.');
      return;
    }

    resetFeedState({
      sort: currentSort,
      type: currentFeedType,
      category: currentCategory,
    });

    // 스크롤 끝 근처에서 추가 로드하도록 이벤트 등록
    window.addEventListener('scroll', handleFeedScroll);
  }

  /**
   * 스크롤 이벤트 핸들러
   * - 스크롤이 페이지 맨 아래에서 200px 이내로 내려오면 다음 글 로드 시도
   */
  function handleFeedScroll() {
    // 이미 로딩 중이거나 더 이상 글이 없으면 아무 것도 하지 않음
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

    // 맨 아래에서 200px 이내면 다음 글 로드
    if (scrollTop + clientHeight >= scrollHeight - 200) {
      loadMoreFeed();
    }
  }

  // === 서버에서 글 목록 추가 로드 ===
  /**
   * /api/posts에서 글 목록 추가로 가져오기
   * - offset, limit, sort, type, category, tags를 쿼리로 전달
   * - 첫 페이지에서 글이 없거나 에러가 나면 안내 문구 표시
   */
  async function loadMoreFeed() {
    const feedBox = document.getElementById('feedPosts');
    if (!feedBox) return;
    if (feedLoading || feedDone) return; // 중복 호출 방지

    feedLoading = true;
    const sessionKey = feedSession;
    const requestSort = currentSort;
    const requestType = currentFeedType;
    const requestCategory = currentCategory;
    const requestTags = [...currentTags];
    const requestOffset = feedOffset;

    try {
      const params = new URLSearchParams({
        offset: String(requestOffset),
        limit: String(FEED_LIMIT),
        sort: requestSort,
      });

      if (requestType === 'following') {
        params.set('type', 'following');
      }

      if (requestCategory) {
        params.set('category', requestCategory);
      }

      // 현재 태그 필터가 있으면 함께 보내기 (?tags=a,b,c)
      if (requestTags.length > 0) {
        params.set('tags', requestTags.join(','));
      }

      const res = await fetch('/api/posts?' + params.toString());
      if (!res.ok) {
        // 첫 로드에서 실패하면 에러 메시지 표시
        if (requestOffset === 0 && sessionKey === feedSession) {
          const baseMsg =
            requestType === 'following'
              ? '팔로잉 피드를 불러오는 중 오류가 발생했습니다.'
              : '피드를 불러오는 중 오류가 발생했습니다.';
          feedBox.innerHTML = `<p class="text-danger">${baseMsg}</p>`;
        }

        if (res.status === 401 && requestType === 'following' && sessionKey === feedSession) {
          feedBox.innerHTML =
            '<p class="gls-text-muted">로그인 후 팔로잉 피드를 볼 수 있습니다.</p>';
          feedDone = true;
        }

        feedLoading = false;
        return;
      }

      const data = await res.json();

      if (sessionKey !== feedSession) {
        return;
      }

      if (!data.ok) {
        // API 레벨에서 실패한 경우
        if (requestOffset === 0) {
          feedBox.innerHTML = `<p class="text-danger">${
            data.message || '피드를 불러올 수 없습니다.'
          }</p>`;
        }
        feedLoading = false;
        return;
      }

      const posts = data.posts || [];
      const context = data.context || {};
      const followingCount = context.following_count;

      // 첫 로드인데 글이 아예 없는 경우
      if (requestOffset === 0 && posts.length === 0) {
        if (currentFeedType === 'following') {
          const message =
            typeof followingCount === 'number' && followingCount === 0
              ? '아직 팔로우한 작가가 없습니다. 작가 페이지에서 마음에 드는 작가를 팔로우해 보세요.'
              : '팔로우한 작가들의 글이 아직 없습니다.';
          feedBox.innerHTML = `<p class="gls-text-muted">${message}</p>`;
        } else if (currentTags.length > 0) {
          const label = currentTags
            .map((t) => `#${escapeHtml(t)}`)
            .join(', ');
          feedBox.innerHTML = `<p class="gls-text-muted">${label} 태그를 모두 포함하는 글이 아직 없습니다.</p>`;
        } else {
          feedBox.innerHTML =
            '<p class="gls-text-muted">아직 작성된 글이 없습니다.</p>';
        }
        feedDone = true;
        feedLoading = false;
        return;
      }

      // 더 이상 받아올 글이 없는 경우 (이후 스크롤 시 로드를 멈춤)
      if (posts.length === 0) {
        feedDone = true;
        feedLoading = false;
        return;
      }

      // 실제 글 카드 렌더링
      renderFeedPosts(posts);

      // offset 갱신
      feedOffset += posts.length;

      const hasMore =
        typeof data.has_more === 'boolean'
          ? data.has_more
          : posts.length === FEED_LIMIT;

      if (!hasMore) {
        feedDone = true;
      }
    } catch (e) {
      console.error(e);
      if (feedOffset === 0) {
        feedBox.innerHTML =
          '<p class="text-danger">피드를 불러오는 중 오류가 발생했습니다。</p>';
      }
    } finally {
      // 로딩 상태 해제
      feedLoading = false;
    }
  }

/*
 * 서버에서 받아온 posts 배열을 DOM에 카드 형태로 추가
 * - 각 카드마다 좋아요/해시태그/더보기/상세보기/작가페이지 이동 이벤트 연결
 */
function renderFeedPosts(posts) {
  const feedBox = document.getElementById('feedPosts');
  if (!feedBox || !posts || posts.length === 0) return;

  // posts 배열을 HTML 문자열로 변환
  const fragmentHtml = posts
  .map((post) =>
    buildStandardPostCardHTML(post, {
      showMoreButton: true, // 인덱스 피드에는 더보기 버튼 사용
    })
  )
  .join('');


  // 첫 로드에서 "피드를 불러오는 중..." 문구 제거
  if (!feedBox.dataset.initialized) {
    feedBox.innerHTML = '';
    feedBox.dataset.initialized = '1';
  }

  // 새 카드들을 피드 맨 아래에 추가
  feedBox.insertAdjacentHTML('beforeend', fragmentHtml);

  // 새로 추가된 카드들에 대해 폰트/더보기/좋아요/해시태그/작성자 링크/상세보기 설정
  posts.forEach((post) => {
    const card = feedBox.querySelector(`.card[data-post-id="${post.id}"]`);
    if (!card) return;

    const quoteEl = card.querySelector('.quote-card');

    if (quoteEl && typeof autoAdjustQuoteFont === 'function') {
      autoAdjustQuoteFont(quoteEl);
    }

    
    setupCardAuthorLink(card, post);  // 작성자 클릭 → 작가 페이지
    setupCardInteractions(card, post); // 좋아요/더보기/상세보기 등
  });
}


  /**
   * 개별 카드에 대한 인터랙션 세팅
   * - 글귀 폰트 자동 조절
   * - 더보기/접기 버튼
   * - 좋아요 버튼
   * - 해시태그 버튼(AND 필터)
   * - 카드 전체 클릭 시 글 상세 페이지 이동
   */
// 작성자 영역(작은 텍스트)을 클릭하면 작가 페이지로 이동
// - /html/author.html?userId=...
/**
 * 개별 카드에 대한 인터랙션 세팅
 * - 글귀 폰트 자동 조절
 * - 더보기/접기 버튼
 * - 좋아요 버튼
 * - 해시태그 버튼(AND 필터)
 * - 카드 전체 클릭 시 글 상세 페이지 이동
 */
function setupCardInteractions(card, post) {
  if (!card || !post) return;

  // 1) 글 내용 폰트 자동 조절 (PostCard 모듈이 있다면 사용)
  const contentEl = card.querySelector('.gls-post-content');
  if (
    contentEl &&
    window.Glsoop &&
    Glsoop.PostCard &&
    typeof Glsoop.PostCard.adjustContentFont === 'function'
  ) {
    Glsoop.PostCard.adjustContentFont(contentEl);
  }

  // 2) 더보기 / 접기 버튼
  const moreBtn = card.querySelector('.gls-post-more-btn');
  if (moreBtn && contentEl) {
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();

      const isExpanded = contentEl.classList.toggle('expanded');
      moreBtn.textContent = isExpanded ? '접기' : '더보기';
    });
  }

  // 3) 좋아요 버튼
  const likeBtn = card.querySelector('.like-btn');
  if (likeBtn) {
    // 어떤 글에 대한 버튼인지 식별용
    likeBtn.setAttribute('data-post-id', post.id);

    likeBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // 카드 전체 클릭(상세 이동) 막기
      handleLikeClick(likeBtn);
    });
  }

  // 4) 해시태그 칩 클릭 → AND 필터 적용
  const hashtagChips = card.querySelectorAll('.hashtag-pill, .gls-hashtag-chip');
  hashtagChips.forEach((chip) => {
    const tag = chip.getAttribute('data-tag') || chip.dataset.tag;
    if (!tag) return;

    chip.style.cursor = 'pointer';
    chip.addEventListener('click', (e) => {
      e.stopPropagation(); // 카드 클릭과 분리
      applyTagFilter(tag);
    });
  });

  // 5) 카드 전체 클릭 → 글 상세 페이지로 이동 + localStorage에 상세 데이터 캐싱
  card.addEventListener('click', (e) => {
    // 좋아요 버튼 / 해시태그 클릭 시에는 상세 이동 막기
    if (e.target.closest('.like-btn')) return;
    if (e.target.closest('.gls-tag-btn')) return;
    if (e.target.closest('.post-bookmark-toggle')) return;
  
    // 현재 카드에서 좋아요 상태/개수 읽기
    let likeCount = 0;
    let userLiked = 0;
    const likeBtn = card.querySelector('.like-btn');
    if (likeBtn) {
      const countEl = likeBtn.querySelector('.like-count');
      if (countEl) {
        const parsed = parseInt(countEl.textContent, 10);
        likeCount = Number.isNaN(parsed) ? 0 : parsed;
      }
      userLiked = likeBtn.getAttribute('data-liked') === '1' ? 1 : 0;
    }
  
    try {
      const detailData = {
        id: post.id,
        title: post.title,
        content: post.content,
        created_at: post.created_at,
        hashtags: post.hashtags,
        category: post.category || null,

        // 작가 정보
        author_id: post.author_id || null,
        author_name: post.author_name || null,
        author_nickname:
          (post.author_nickname && post.author_nickname.trim()) ||
          (post.author_name && post.author_name.trim()) ||
          null,
        author_email: post.author_email || null,
  
        // 좋아요 정보
        like_count: likeCount,
        user_liked: userLiked,
      };
      localStorage.setItem('glsoop_lastPost', JSON.stringify(detailData));
    } catch (err) {
      console.error('failed to cache related post detail', err);
    }
  
    window.location.href = `/html/post.html?postId=${encodeURIComponent(
      post.id
    )}`;
  });  
}



  /**
   * 좋아요(공감) 버튼 클릭 처리
   * - POST /api/posts/:id/toggle-like
   * - 비로그인 시 로그인 페이지로 유도
   * - 성공 시 하트/숫자 갱신 + 작은 애니메이션
   */
  async function handleLikeClick(likeBtn) {
    const postId = likeBtn.getAttribute('data-post-id');
    if (!postId) return;

    try {
      const res = await fetch(`/api/posts/${postId}/toggle-like`, {
        method: 'POST',
      });

      // 401 → 비로그인
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

      // 서버에서 돌려준 liked 상태, 총 likeCount
      const liked = !!data.liked;
      const likeCount =
        typeof data.like_count === 'number' ? data.like_count : 0;

      // data-liked 속성 업데이트
      likeBtn.setAttribute('data-liked', liked ? '1' : '0');

      const heartEl = likeBtn.querySelector('.like-heart');
      const countEl = likeBtn.querySelector('.like-count');

      // 하트 모양(♥ / ♡) 갱신
      if (heartEl) {
        heartEl.textContent = liked ? '♥' : '♡';
      }
      // 숫자 갱신
      if (countEl) {
        countEl.textContent = likeCount;
      }

      // liked 상태에 따라 클래스 토글 (색상 등 스타일 적용용)
      likeBtn.classList.toggle('liked', liked);

      // 좋아요 ON일 때만 "톡" 애니메이션
      if (heartEl && liked) {
        // transform 초기화
        heartEl.style.transition = 'transform 0.16s ease-out';
        heartEl.style.transform = 'scale(1)';
        // 강제로 reflow를 발생시켜 애니메이션 리셋
        void heartEl.offsetWidth;
        // 살짝 크게
        heartEl.style.transform = 'scale(1.28)';
        // 다시 원래 크기로
        setTimeout(() => {
          heartEl.style.transform = 'scale(1)';
        }, 160);
      }
    } catch (e) {
      console.error(e);
      alert('공감 처리 중 오류가 발생했습니다.');
    }
  }

  // ===== 태그 필터 관련 =====

  /**
   * 태그 필터 적용 (여러 태그 AND 조건)
   * - 클릭한 태그를 currentTags에 추가
   * - 피드 상태 리셋 후 처음부터 다시 로드
   */
  function applyTagFilter(tag) {
    if (!tag) return;

    // 이미 있는 태그가 아니면 추가
    if (!currentTags.includes(tag)) {
      currentTags.push(tag);
    }

    // 피드 상태 리셋
    feedSession += 1;
    feedOffset = 0;
    feedDone = false;

    const feedBox = document.getElementById('feedPosts');
    if (feedBox) {
      // 첫 로드 플래그 초기화
      feedBox.dataset.initialized = '';
      const label = currentTags.map((t) => `#${escapeHtml(t)}`).join(', ');
      feedBox.innerHTML = `<p class="gls-text-muted">${label} 태그를 포함한 글을 불러오는 중입니다...</p>`;
    }

    // 상단 필터 바 갱신
    renderTagFilterBar();

    // 화면을 맨 위로 올리고 새 글 로딩
    window.scrollTo({ top: 0, behavior: 'smooth' });
    loadMoreFeed();
  }

  /**
   * 태그 필터 바 렌더링
   * - "적용 중인 태그: #힐링 #위로" + "필터 지우기" 버튼
   */
  function renderTagFilterBar() {
    const feedBox = document.getElementById('feedPosts');
    if (!feedBox) return;

    // 이미 존재하는 바를 재사용, 없으면 새로 생성
    let bar = document.getElementById('tagFilterBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'tagFilterBar';
      bar.className = 'gls-flex gls-flex-wrap gls-items-center gls-gap-2 gls-mb-3';

      // feedBox 바로 위에 삽입
      if (feedBox.parentNode) {
        feedBox.parentNode.insertBefore(bar, feedBox);
      }
    }

    // 적용 중인 태그가 없으면 바 숨기기
    if (!currentTags.length) {
      bar.innerHTML = '';
      bar.style.display = 'none';
      return;
    }

    // 태그가 있으면 바 표시
    bar.style.display = 'flex';

    // 태그 칩 HTML (UI Kit 버튼 시스템)
    const tagsHtml = currentTags
      .map((t) => {
        const safeTag = escapeHtml(t);
        return `
          <span class="gls-btn gls-btn-secondary gls-chip" data-tag="${safeTag}">
            <span>#${safeTag}</span>
            <button
              type="button"
              class="gls-chip-remove tag-filter-remove"
              aria-label="${safeTag} 태그 제거"
              data-tag="${safeTag}"
            >
              ×
            </button>
          </span>
        `;
      })
      .join('');

    // 바 전체 HTML
    bar.innerHTML = `
      <span class="me-1 gls-text-small gls-text-muted">적용 중인 태그:</span>
      ${tagsHtml}
      <button type="button" class="gls-btn gls-btn-secondary gls-btn-sm" id="tagFilterClearBtn">
        필터 지우기
      </button>
    `;

    // "필터 지우기" 버튼 이벤트
    const clearBtn = bar.querySelector('#tagFilterClearBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', clearTagFilters);
    }

    // 개별 태그 제거 버튼 이벤트
    bar.querySelectorAll('.tag-filter-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tag = btn.dataset.tag;
        removeTagFilter(tag);
      });
    });
  }

  /**
   * 태그 필터 전체 해제
   * - currentTags 비우고 피드를 전체 글 모드로 리셋
   */
  function clearTagFilters() {
    currentTags = [];
    feedOffset = 0;
    feedDone = false;

    const feedBox = document.getElementById('feedPosts');
    if (feedBox) {
      feedBox.dataset.initialized = '';
      feedBox.innerHTML =
        '<p class="gls-text-muted">전체 글을 불러오는 중입니다...</p>';
    }

    // 필터 바 갱신(숨기기)
    renderTagFilterBar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    loadMoreFeed();
  }

  /**
   * 특정 태그 필터만 해제
   * - 태그를 목록에서 제거하고 남은 태그 조건으로 다시 로드
   */
  function removeTagFilter(tag) {
    if (!tag) return;
    if (!currentTags.includes(tag)) return;

    currentTags = currentTags.filter((t) => t !== tag);

    // 남은 태그가 없으면 전체 필터 초기화로 위임
    if (!currentTags.length) {
      clearTagFilters();
      return;
    }

    feedOffset = 0;
    feedDone = false;

    const feedBox = document.getElementById('feedPosts');
    if (feedBox) {
      feedBox.dataset.initialized = '';
      const label = currentTags.map((t) => `#${escapeHtml(t)}`).join(', ');
      feedBox.innerHTML = `<p class="gls-text-muted">${label} 태그를 포함한 글을 불러오는 중입니다...</p>`;
    }

    renderTagFilterBar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    loadMoreFeed();
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
