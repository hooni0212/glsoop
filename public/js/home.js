// public/js/home.js

const HomeCuration = (() => {
  const POPULAR_LIMIT = 24;
  const FEATURED_LIMIT = 12;
  const RECENT_DAYS = 30;
  const SECTION_LIMIT = 6;

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
    excerptEl.textContent = buildExcerpt(pick.content || '', 90);
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

    container.innerHTML = posts
      .map((post) => buildCurationCard(post))
      .join('');
  }

  function renderCurationCarousel(container, posts) {
    if (!container) return;
    if (!posts || posts.length === 0) {
      renderEmptyState(container, '아직 추천할 글이 없어요.');
      return;
    }

    const limited = posts.slice(0, SECTION_LIMIT * 5);
    const slides = chunkPosts(limited, SECTION_LIMIT);

    if (slides.length > 1) {
      const last = slides[slides.length - 1];
      if (last.length < SECTION_LIMIT) {
        const deficit = SECTION_LIMIT - last.length;
        slides[slides.length - 1] = last.concat(limited.slice(0, deficit));
      }
    }

    if (slides.length <= 1) {
      renderCurationList(container, limited.slice(0, SECTION_LIMIT));
      return;
    }

    container.innerHTML = '';

    const viewport = document.createElement('div');
    viewport.className = 'curation-carousel';

    const track = document.createElement('div');
    track.className = 'curation-track';

    let currentSlide = document.createElement('div');
    currentSlide.className = 'curation-slide is-current';
    currentSlide.appendChild(buildSlideGrid(slides[0]));

    let nextSlide = document.createElement('div');
    nextSlide.className = 'curation-slide is-next';
    nextSlide.appendChild(buildSlideGrid(slides[1]));

    track.appendChild(currentSlide);
    track.appendChild(nextSlide);
    viewport.appendChild(track);
    container.appendChild(viewport);

    const reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion) {
      renderCurationList(container, limited.slice(0, SECTION_LIMIT));
      return;
    }

    const transitionDuration = 1050;
    const autoplayInterval =
      container.id === 'curationStayList' ? 3800 : 3500;
    const initialDelay = 300;
    const staggerDelay = 0;
    const slideInDelay = 160;

    let currentIndex = 0;
    let nextIndex = 1;
    let isAnimating = false;
    let timerId = null;
    let safetyId = null;
    let transitionLogged = false;

    console.log('[home] carousel timing', {
      autoplayInterval,
      transitionDuration,
      initialDelay,
    });

    const updateViewportHeight = () => {
      const currentHeight = currentSlide?.offsetHeight || 0;
      const nextHeight = nextSlide?.offsetHeight || 0;
      const target = Math.max(320, currentHeight, nextHeight);
      viewport.style.minHeight = `${target}px`;
      return target;
    };

    const goNext = () => {
      if (isAnimating) return;
      isAnimating = true;
      currentSlide.classList.add('is-dimming');
      updateViewportHeight();
      nextSlide.setAttribute('aria-hidden', 'false');
      nextSlide.classList.add('is-ready');
      nextSlide.offsetHeight;

      if (safetyId) {
        window.clearTimeout(safetyId);
        safetyId = null;
      }
      safetyId = window.setTimeout(() => {
        if (!isAnimating) return;
        isAnimating = false;
        scheduleNext(autoplayInterval);
      }, transitionDuration + 500);

      window.setTimeout(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            nextSlide.classList.add('slide-in');
          });
        });
      }, slideInDelay);
    };

    const scheduleNext = (delayMs) => {
      if (timerId) {
        window.clearTimeout(timerId);
        timerId = null;
      }
      timerId = window.setTimeout(goNext, delayMs);
    };

    const stopTimer = () => {
      if (!timerId) return;
      window.clearTimeout(timerId);
      timerId = null;
    };

    const handleTransitionEnd = (event) => {
      if (event.propertyName !== 'transform') return;
      if (!isAnimating) return;
      if (event.target !== nextSlide) return;

      if (safetyId) {
        window.clearTimeout(safetyId);
        safetyId = null;
      }

      if (!transitionLogged) {
        console.log('[home] carousel transitionend', true);
        transitionLogged = true;
      }

      currentIndex = nextIndex;
      nextIndex = (nextIndex + 1) % slides.length;

      const incomingSlide = nextSlide;
      const outgoingSlide = currentSlide;

      incomingSlide.classList.remove('slide-in', 'is-next', 'is-ready');
      incomingSlide.classList.add('is-current');
      incomingSlide.classList.remove('is-dimming');

      outgoingSlide.classList.add('is-reset');
      outgoingSlide.classList.remove('is-dimming');
      outgoingSlide.classList.remove('is-current');
      outgoingSlide.classList.add('is-next');
      outgoingSlide.offsetHeight;
      outgoingSlide.classList.remove('is-reset');

      currentSlide = incomingSlide;
      nextSlide = outgoingSlide;

      nextSlide.replaceChildren(buildSlideGrid(slides[nextIndex]));
      currentSlide.setAttribute('aria-hidden', 'false');
      nextSlide.setAttribute('aria-hidden', 'true');
      updateViewportHeight();
      isAnimating = false;

      console.log('[home] carousel index', currentIndex);
      scheduleNext(autoplayInterval);
    };

    currentSlide.addEventListener('transitionend', handleTransitionEnd);
    nextSlide.addEventListener('transitionend', handleTransitionEnd);
    currentSlide.setAttribute('aria-hidden', 'false');
    nextSlide.setAttribute('aria-hidden', 'true');
    const initialHeight = updateViewportHeight();
    if (!initialHeight) {
      renderCurationList(container, limited.slice(0, SECTION_LIMIT));
      return;
    }
    scheduleNext(autoplayInterval + initialDelay + staggerDelay);

    viewport.addEventListener('mouseenter', stopTimer);
    viewport.addEventListener('mouseleave', () => {
      if (!isAnimating) {
        scheduleNext(autoplayInterval);
      }
    });
    viewport.addEventListener('focusin', stopTimer);
    viewport.addEventListener('focusout', () => {
      window.setTimeout(() => {
        if (!viewport.contains(document.activeElement)) {
          if (!isAnimating) {
            scheduleNext(autoplayInterval);
          }
        }
      }, 0);
    });

    window.addEventListener('resize', updateViewportHeight);
  }

  function chunkPosts(posts, size) {
    const chunks = [];
    for (let i = 0; i < posts.length; i += size) {
      chunks.push(posts.slice(i, i + size));
    }
    return chunks;
  }

  function buildSlideGrid(posts) {
    const grid = document.createElement('div');
    grid.className = 'curation-grid';
    grid.innerHTML = posts.map((post) => buildCurationCard(post)).join('');
    return grid;
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
    const excerpt = escapeHtml(buildExcerpt(post.content || ''));
    const author = escapeHtml(buildAuthorName(post));
    const href = `/html/post.html?postId=${encodeURIComponent(post.id)}`;

    return `
      <a class="curation-card" href="${href}">
        <div class="curation-card-body">
          <h4 class="curation-title">${title}</h4>
          <p class="curation-excerpt">${excerpt}</p>
        </div>
        <div class="curation-meta">
          <span class="curation-author">${author}</span>
        </div>
      </a>
    `;
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
