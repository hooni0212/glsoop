// public/js/home.js

const HomeCuration = (() => {
  const POPULAR_LIMIT = 24;
  const FEATURED_LIMIT = 12;
  const RECENT_DAYS = 30;
  const SECTION_LIMIT = 6;
  const SIDEBAR_EXCERPT_MAX = 62;

  const state = {
    popular: [],
    latest: [],
    randomPool: [],
  };

  function init() {
    const monthList = document.getElementById('curationMonthList');
    if (!monthList) return;

    loadCuration().catch((error) => {
      console.error('홈 큐레이션 로드 실패:', error);
      renderEmptyState(monthList, '추천 글을 불러오지 못했습니다.');
      renderEmptyState(
        document.getElementById('curationStayList'),
        '머무는 글을 불러오지 못했습니다.'
      );
      renderEmptyState(
        document.getElementById('todayPickExcerpt'),
        '추천 글을 불러오지 못했습니다.'
      );
    });

    setupRandomButtons();
    setupMobileHomeSide();
  }

  async function loadCuration() {
    const [popular, latest] = await Promise.all([
      fetchPosts({ sort: 'popular', limit: POPULAR_LIMIT }),
      fetchPosts({ sort: 'latest', limit: FEATURED_LIMIT }),
    ]);

    console.log('[home] curation counts', {
      popular: popular.length,
      latest: latest.length,
    });

    state.popular = popular;
    state.latest = latest;
    state.randomPool = uniquePosts([...popular, ...latest]);

    renderMonthlyCuration();
    renderStayCuration();
    await renderAuthorSpotlight();
    renderEditorPick();
    updateRandomButtons();
  }

  async function fetchPosts({ sort, limit }) {
    const params = new URLSearchParams({
      sort,
      limit: String(limit),
    });
    const res = await fetch(`/api/posts?${params.toString()}`);
    if (!res.ok) {
      throw new Error('Failed to fetch posts');
    }
    const data = await res.json();
    return Array.isArray(data.posts) ? data.posts : [];
  }

  function renderMonthlyCuration() {
    const monthList = document.getElementById('curationMonthList');
    if (!monthList) return;

    const recent = filterByRecent(state.popular, RECENT_DAYS);
    const list = recent.length ? recent : state.popular;

    if (!recent.length) {
      const title = document.getElementById('curationMonthTitle');
      const copy = document.getElementById('curationMonthCopy');
      if (title) title.textContent = '요즘 많이 위로받은 글들';
      if (copy) copy.textContent = '최근 공감이 모인 글을 모았습니다.';
    }

    renderCurationCarousel(monthList, list);
  }

  function renderStayCuration() {
    const stayList = document.getElementById('curationStayList');
    if (!stayList) return;

    const combined = uniquePosts([...state.popular, ...state.latest]);
    const scored = combined
      .map((post) => ({
        post,
        score: buildStayScore(post),
      }))
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.post);

    renderCurationCarousel(stayList, scored);
  }

  async function renderAuthorSpotlight() {
    const nameEl = document.getElementById('curationAuthorName');
    const copyEl = document.getElementById('curationAuthorCopy');
    const linkEl = document.getElementById('curationAuthorLink');

    const author = pickTopAuthor(state.popular);
    if (!author) {
      if (nameEl) nameEl.textContent = '추천 작가를 찾지 못했어요';
      if (copyEl) copyEl.textContent = '조금 뒤에 다시 확인해주세요.';
      return;
    }

    const authorName = buildAuthorName(author);

    if (nameEl) nameEl.textContent = `${authorName}`;
    if (copyEl) {
      copyEl.textContent = '이번 달 공감이 모인 작가를 소개합니다.';
    }
    if (linkEl) {
      linkEl.href = `/html/author.html?userId=${encodeURIComponent(author.author_id)}`;
    }
  }

  function renderEditorPick() {
    const titleEl = document.getElementById('todayPickTitle');
    const excerptEl = document.getElementById('todayPickExcerpt');
    const linkEl = document.getElementById('todayPickLink');
    if (!titleEl || !excerptEl || !linkEl) return;

    const pool = state.latest.length ? state.latest : state.popular;
    if (!pool.length) {
      titleEl.textContent = '추천 글을 찾지 못했어요';
      excerptEl.textContent = '조금 뒤에 다시 확인해주세요.';
      linkEl.href = '/explore';
      return;
    }

    const pick = pool[Math.floor(Math.random() * pool.length)];
    titleEl.textContent = pick.title || '제목 없는 글';
    excerptEl.textContent = buildExcerpt(pick.content || '', SIDEBAR_EXCERPT_MAX);
    linkEl.href = `/html/post.html?postId=${encodeURIComponent(pick.id)}`;
  }

  function setupRandomButtons() {
    const buttons = [
      document.getElementById('randomPostBtn'),
    ].filter(Boolean);

    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const post = pickRandomPost();
        if (!post) {
          alert('랜덤 추천을 준비 중입니다. 잠시만 기다려주세요.');
          return;
        }
        window.location.href = `/html/post.html?postId=${encodeURIComponent(post.id)}`;
      });
    });
  }

  function setupMobileHomeSide() {
    const foldable = document.querySelector('[data-home-foldable="1"]');
    const toggleBtn = document.querySelector('[data-home-side-toggle]');
    if (!foldable || !toggleBtn) return;

    const isMobile = () => window.matchMedia('(max-width: 680px)').matches;

    const applyFoldState = (folded) => {
      foldable.dataset.homeFolded = folded ? 'true' : 'false';
      toggleBtn.setAttribute('aria-expanded', folded ? 'false' : 'true');
      toggleBtn.textContent = folded ? '열기' : '접기';
    };

    const syncByViewport = () => {
      if (isMobile()) {
        applyFoldState(true);
        return;
      }
      applyFoldState(false);
    };

    toggleBtn.addEventListener('click', () => {
      const currentlyFolded = foldable.dataset.homeFolded === 'true';
      applyFoldState(!currentlyFolded);
    });

    syncByViewport();
    window.addEventListener('resize', syncByViewport, { passive: true });
  }

  function updateRandomButtons() {
    const disabled = state.randomPool.length === 0;
    const buttons = [
      document.getElementById('randomPostBtn'),
    ].filter(Boolean);

    buttons.forEach((button) => {
      button.disabled = disabled;
    });
  }

  function pickRandomPost() {
    if (!state.randomPool.length) return null;
    const index = Math.floor(Math.random() * state.randomPool.length);
    return state.randomPool[index];
  }

  function buildStayScore(post) {
    // TODO: 실제 체류/북마크/조회 데이터를 수집하면 점수 계산을 교체한다.
    const likeScore = Number(post.like_count) || 0;
    const created = new Date(post.created_at);
    const ageDays = Number.isNaN(created.getTime())
      ? 30
      : (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
    const recencyScore = Math.max(0, RECENT_DAYS - ageDays);
    return likeScore * 2 + recencyScore;
  }

  function renderCurationList(container, posts) {
    if (!container) return;

    if (!posts || posts.length === 0) {
      renderEmptyState(container, '아직 추천할 글이 없어요.');
      return;
    }

    const heading = container.closest('.home-section')?.querySelector('h3');
    const label = heading?.textContent?.trim()
      ? `${heading.textContent.trim()} 캐러셀`
      : '추천 글 캐러셀';

    const carousel = document.createElement('div');
    carousel.className = 'curation-carousel';
    carousel.setAttribute('role', 'region');
    carousel.setAttribute('aria-label', label);

    const track = document.createElement('div');
    track.className = 'curation-carousel-track';
    track.innerHTML = posts.map((post) => buildCurationCard(post)).join('');

    carousel.appendChild(track);
    container.innerHTML = '';
    container.appendChild(carousel);
    bindCurationImageFallback(track);
    setupCurationMotion(carousel, track, container.id);
  }

  function renderCurationCarousel(container, posts) {
    if (!container) return;
    if (!posts || posts.length === 0) {
      renderEmptyState(container, '아직 추천할 글이 없어요.');
      return;
    }

    const limited = posts.slice(0, SECTION_LIMIT * 5);
    renderCurationList(container, limited);
  }

  function renderEmptyState(container, message) {
    if (!container) return;
    if (!(container instanceof HTMLElement)) return;
    if (container.tagName === 'P') {
      container.textContent = message;
      return;
    }
    container.innerHTML = `<p class="gls-text-muted">${escapeHtml(message)}</p>`;
  }

  function buildCurationCard(post) {
    const title = escapeHtml(post.title || '제목 없는 글');
    const excerpt = escapeHtml(buildExcerpt(post.content || '', 84));
    const author = escapeHtml(buildAuthorName(post));
    const href = `/html/post.html?postId=${encodeURIComponent(post.id)}`;
    const imageUrl = buildCurationImageUrl(post);
    const fallbackClass = imageUrl ? '' : ' is-image-fallback';
    const imageHtml = imageUrl
      ? `
        <img
          class="curation-card-image"
          src="${imageUrl}"
          alt=""
          loading="lazy"
          decoding="async"
        />
      `
      : '';

    return `
      <a class="curation-card${fallbackClass}" href="${href}">
        ${imageHtml}
        <div class="curation-card-body">
          <h4 class="curation-title">${title}</h4>
          <p class="curation-excerpt">${excerpt}</p>
          <div class="curation-meta">
            <span class="curation-author">${author}</span>
          </div>
        </div>
      </a>
    `;
  }


  function extractCurationTemplate(post) {
    if (post?.render_images?.template === 'paper02') return 'paper02';
    const raw = post?.layout_json;
    if (!raw) return 'paper01';
    let parsed = raw;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch (_error) {
        return 'paper01';
      }
    }
    return parsed?.canvas?.presetId === 'paper02' ? 'paper02' : 'paper01';
  }

  function buildCurationImageUrl(post, template) {
    if (!post || !post.id) return '';
    if (typeof post.primary_image === 'string' && post.primary_image.trim()) {
      return post.primary_image.trim();
    }
    const resolvedTemplate = template || extractCurationTemplate(post);
    if (typeof window.buildFeedRenderedImageUrl === 'function') {
      return window.buildFeedRenderedImageUrl(post, resolvedTemplate);
    }

    // postCard.js가 선로드되지 않은 경우에도 홈 큐레이션 이미지는 표시되도록 최소 fallback URL을 유지한다.
    return `/api/feed-images/post/${encodeURIComponent(post.id)}?template=${encodeURIComponent(resolvedTemplate)}&scale=2`;
  }

  function bindCurationImageFallback(scope) {
    if (!scope) return;
    const images = scope.querySelectorAll('.curation-card-image');
    images.forEach((imageEl) => {
      if (imageEl.dataset.fallbackBound === '1') return;
      imageEl.dataset.fallbackBound = '1';

      const activateFallback = () => {
        imageEl.classList.add('is-hidden');
        const card = imageEl.closest('.curation-card');
        if (card) {
          card.classList.add('is-image-fallback');
        }
      };

      imageEl.addEventListener('error', activateFallback, { once: true });
      if (imageEl.complete && imageEl.naturalWidth === 0) {
        activateFallback();
      }
    });
  }

  function setupCurationMotion(carousel, track, containerId = '') {
    if (!carousel || !track) return;

    const cards = Array.from(track.querySelectorAll('.curation-card'));
    if (!cards.length) return;

    cards.forEach((card, index) => {
      card.style.setProperty('--curation-stagger-index', String(index));
    });

    const reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion) {
      carousel.classList.remove('is-prep');
      carousel.classList.remove('is-animated');
      return;
    }

    carousel.classList.add('is-prep');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        carousel.classList.add('is-animated');
      });
    });

    const revealDuration = 620;
    const revealStagger = 70;
    const revealTail = 160;
    const revealTotal = revealDuration + cards.length * revealStagger + revealTail;
    window.setTimeout(() => {
      carousel.classList.remove('is-prep');
      carousel.classList.remove('is-animated');
    }, revealTotal);

    if (cards.length <= 1) return;

    const autoplayInterval = containerId === 'curationStayList' ? 6000 : 5400;
    let timerId = null;
    let interactionUntil = 0;
    let isVisible = true;

    const scheduleNext = (delayMs = autoplayInterval) => {
      if (timerId) {
        window.clearTimeout(timerId);
      }
      timerId = window.setTimeout(goNext, delayMs);
    };

    const findNearestIndex = () => {
      const currentLeft = carousel.scrollLeft;
      let nearestIndex = 0;
      let nearestDelta = Number.POSITIVE_INFINITY;
      cards.forEach((card, index) => {
        const delta = Math.abs(card.offsetLeft - currentLeft);
        if (delta < nearestDelta) {
          nearestDelta = delta;
          nearestIndex = index;
        }
      });
      return nearestIndex;
    };

    const markInteracted = (holdMs = autoplayInterval + 1200) => {
      interactionUntil = Date.now() + holdMs;
      scheduleNext(holdMs);
    };

    const goNext = () => {
      if (!isVisible) {
        scheduleNext(autoplayInterval);
        return;
      }

      const now = Date.now();
      if (now < interactionUntil) {
        scheduleNext(Math.max(320, interactionUntil - now));
        return;
      }

      const currentIndex = findNearestIndex();
      const nextIndex = (currentIndex + 1) % cards.length;

      cards[nextIndex].scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'start',
      });

      scheduleNext(autoplayInterval);
    };

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.target !== carousel) return;
            isVisible = entry.isIntersecting && entry.intersectionRatio >= 0.35;
            if (isVisible) {
              scheduleNext(autoplayInterval);
            }
          });
        },
        { threshold: [0, 0.35, 0.7] }
      );
      observer.observe(carousel);
    }

    carousel.addEventListener('pointerdown', () => markInteracted(), {
      passive: true,
    });
    carousel.addEventListener('touchstart', () => markInteracted(), {
      passive: true,
    });
    carousel.addEventListener('wheel', () => markInteracted(), {
      passive: true,
    });
    carousel.addEventListener('mouseenter', () => markInteracted(autoplayInterval + 1600));
    carousel.addEventListener('focusin', () => markInteracted(autoplayInterval + 1600));
    carousel.addEventListener('mouseleave', () => scheduleNext(autoplayInterval));
    carousel.addEventListener('focusout', () => {
      window.setTimeout(() => {
        if (!carousel.contains(document.activeElement)) {
          scheduleNext(autoplayInterval);
        }
      }, 0);
    });

    scheduleNext(autoplayInterval + 700);
  }

  function buildExcerpt(html, maxLength = 90) {
    const plain = stripHtml(html).trim();
    if (!plain) return '짧은 숨 고르기 같은 글입니다.';
    if (plain.length <= maxLength) return plain;
    return `${plain.slice(0, maxLength).trim()}…`;
  }

  function stripHtml(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html || '';
    return temp.textContent || '';
  }

  function filterByRecent(posts, days) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return posts.filter((post) => {
      const created = new Date(post.created_at);
      if (Number.isNaN(created.getTime())) return false;
      return created.getTime() >= cutoff;
    });
  }

  function uniquePosts(posts) {
    const map = new Map();
    posts.forEach((post) => {
      if (!post || !post.id) return;
      if (!map.has(post.id)) map.set(post.id, post);
    });
    return Array.from(map.values());
  }

  function pickTopAuthor(posts) {
    if (!posts || posts.length === 0) return null;

    const scores = new Map();
    posts.forEach((post) => {
      if (!post || !post.author_id) return;
      const current = scores.get(post.author_id) || {
        author_id: post.author_id,
        author_name: post.author_name,
        author_nickname: post.author_nickname,
        author_email: post.author_email,
        score: 0,
      };
      current.score += Number(post.like_count) || 0;
      scores.set(post.author_id, current);
    });

    return Array.from(scores.values()).sort((a, b) => b.score - a.score)[0] || null;
  }

  function buildAuthorName(post) {
    const nickname = (post.author_nickname || '').trim();
    const name = (post.author_name || '').trim();
    if (nickname) return nickname;
    if (name) return name;
    if (typeof maskEmail === 'function') {
      return maskEmail(post.author_email || '') || '익명';
    }
    return '익명';
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => {
  if (document.body.classList.contains('page-home')) {
    HomeCuration.init();
  }
});
