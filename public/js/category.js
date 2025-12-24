// public/js/category.js
// 카테고리 전용 피드 페이지 스크립트

(() => {
  const CATEGORY_LABELS = {
    poem: '시',
    essay: '에세이/일기',
    short: '짧은 구절',
  };

  const FEED_LIMIT = 10;
  let currentCategory = null;
  let feedOffset = 0;
  let feedLoading = false;
  let feedDone = false;
  let feedSession = 0;

  document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    currentCategory = parseCategory(params.get('category'));

    updateCategoryHeading();
    resetFeed();
    window.addEventListener('scroll', handleScroll);
  });

  function parseCategory(raw) {
    if (!raw) return null;
    const val = String(raw).trim();
    return ['poem', 'essay', 'short'].includes(val) ? val : null;
  }

  function getCategoryLabel(category) {
    if (!category) return '전체';
    return CATEGORY_LABELS[category] || '전체';
  }

  function updateCategoryHeading() {
    const titleEl = document.getElementById('categoryPageTitle');
    const sortHintEl = document.getElementById('categorySortHint');

    if (titleEl) {
      titleEl.textContent = `${getCategoryLabel(currentCategory)} 글 모아보기`;
    }
    if (sortHintEl) {
      sortHintEl.textContent = '정렬: 최신순';
    }
  }

  function resetFeed() {
    const feedBox = document.getElementById('categoryFeed');
    feedSession += 1;
    feedOffset = 0;
    feedDone = false;
    feedLoading = false;

    if (feedBox) {
      feedBox.dataset.initialized = '';
      feedBox.innerHTML = '<p class="gls-text-muted">피드를 불러오는 중입니다...</p>';
    }

    loadMore();
  }

  function handleScroll() {
    if (feedLoading || feedDone) return;
    const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 200;
    if (nearBottom) {
      loadMore();
    }
  }

  async function loadMore() {
    if (feedLoading || feedDone) return;
    const sessionId = feedSession;
    feedLoading = true;

    try {
      const url = new URL('/api/posts', window.location.origin);
      url.searchParams.set('limit', FEED_LIMIT);
      url.searchParams.set('offset', feedOffset);
      url.searchParams.set('sort', 'latest');
      if (currentCategory) {
        url.searchParams.set('category', currentCategory);
      }

      const res = await fetch(url.toString());
      const data = await res.json().catch(() => ({ ok: false }));

      if (sessionId !== feedSession) {
        return;
      }

      if (!res.ok || !data.ok) {
        showError(data.message || '피드를 불러오는 중 오류가 발생했습니다.');
        feedDone = true;
        return;
      }

      const posts = Array.isArray(data.posts) ? data.posts : [];
      renderPosts(posts, data.context);

      feedOffset += posts.length;
      feedDone = posts.length < FEED_LIMIT;

      if (!posts.length && feedOffset === 0) {
        showEmptyState();
      }
    } catch (e) {
      console.error(e);
      showError('피드를 불러오는 중 오류가 발생했습니다.');
      feedDone = true;
    } finally {
      feedLoading = false;
    }
  }

  function renderPosts(posts, context) {
    const feedBox = document.getElementById('categoryFeed');
    if (!feedBox) return;

    if (!feedBox.dataset.initialized) {
      feedBox.innerHTML = '';
      feedBox.dataset.initialized = '1';
    }

    posts.forEach((post) => {
      const html = buildStandardPostCardHTML(post, { showMoreButton: true });
      const wrapper = document.createElement('div');
      wrapper.innerHTML = html.trim();
      const card = wrapper.firstElementChild;
      feedBox.appendChild(card);
      enhanceStandardPostCard(card, post);
    });

    // 카테고리 컨텍스트가 바뀐 경우 제목 업데이트 (혹시 서버가 보정했을 때)
    if (context && context.category) {
      currentCategory = context.category;
      updateCategoryHeading();
    }
  }

  function showError(message) {
    const feedBox = document.getElementById('categoryFeed');
    if (!feedBox) return;
    feedBox.innerHTML = `<p class="text-danger">${escapeHtml(message)}</p>`;
  }

  function showEmptyState() {
    const feedBox = document.getElementById('categoryFeed');
    if (!feedBox) return;

    const label = getCategoryLabel(currentCategory);
    feedBox.innerHTML = `<div class="gls-text-center gls-text-muted gls-py-4">${escapeHtml(
      `${label} 글이 아직 없습니다.`
    )}</div>`;
  }
})();
