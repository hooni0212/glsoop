// public/js/post.js
// 개별 글 상세 페이지 (트위터 '트윗 보기' 느낌 + 관련 글 리스트)

document.addEventListener('DOMContentLoaded', () => {
    initPostDetailPage();
  });
  
  async function initPostDetailPage() {
    const params = new URLSearchParams(window.location.search);
    const postId = params.get('postId');
    const container = document.getElementById('postDetail');
  
    if (!container) return;
  
    if (!postId) {
      container.innerHTML =
        '<p class="text-danger">글 정보를 찾을 수 없습니다. 메인 피드에서 다시 시도해주세요.</p>';
      return;
    }
  
    // 1) 먼저 localStorage에 저장해 둔 데이터에서 찾아보기
    let postData = null;
    try {
      const stored = localStorage.getItem('glsoop_lastPost');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && String(parsed.id) === String(postId)) {
          postData = parsed;
        }
      }
    } catch (e) {
      console.error('Failed to parse glsoop_lastPost', e);
    }
  
    if (!postData) {
      container.innerHTML =
        '<p class="text-danger">이 페이지는 메인 피드에서 카드를 클릭해서 들어와야 합니다.<br/>메인으로 돌아가 다시 시도해주세요.</p>';
      return;
    }
  
    renderPostDetail(container, postData);
    loadRelatedPosts(postData); // 🔥 관련 글 불러오기
  }
  
  function renderPostDetail(container, post) {
    const { cleanHtml, fontKey } = extractFontFromContent(post.content);
    const quoteFontClass =
      fontKey === 'serif' || fontKey === 'sans' || fontKey === 'hand'
        ? `quote-font-${fontKey}`
        : '';
  
    const dateStr = formatKoreanDateTime(post.created_at);
  
    const nickname =
      post.author_nickname && String(post.author_nickname).trim().length > 0
        ? String(post.author_nickname).trim()
        : '';
  
    const baseName =
      nickname ||
      (post.author_email ? post.author_email.split('@')[0] : '익명');
  
    const maskedEmail = maskEmail(post.author_email);
    const author = maskedEmail ? `${baseName} (${maskedEmail})` : baseName;
  
    // 해시태그 처리 (문자열 or 배열 모두 지원)
    let tags = [];
    if (Array.isArray(post.hashtags)) {
      tags = post.hashtags;
    } else if (
      typeof post.hashtags === 'string' &&
      post.hashtags.trim() !== ''
    ) {
      tags = post.hashtags.split(',').map((t) => t.trim()).filter(Boolean);
    }
  
    const hashtagHtml =
      tags.length > 0
        ? `
        <div class="mt-3">
          ${tags
            .map(
              (t) =>
                `<span class="badge text-bg-success me-1">#${escapeHtml(
                  t
                )}</span>`
            )
            .join('')}
        </div>
      `
        : '';
  
    // 🔥 템플릿 리터럴은 백틱(`)으로 시작해서 백틱으로 끝나야 함
    container.innerHTML = `
      <div class="row justify-content-center">
        <div class="col-md-8">
          <div class="card post-detail-card mb-3" data-post-id="${post.id}">
            <div class="card-body">
              <h5 class="card-title mb-2">${escapeHtml(post.title || '')}</h5>
              <p class="card-text mb-3">
                <small class="text-muted">${escapeHtml(author)} · ${dateStr}</small>
              </p>
  
              <div class="feed-post-content">
                <div class="quote-card ${quoteFontClass}">
                  ${cleanHtml}
                </div>
              </div>
  
              ${hashtagHtml}
            </div>
          </div>
  
          <div class="d-flex justify-content-between align-items-center mt-2">
            <button type="button" class="btn btn-outline-secondary btn-sm" id="backToFeedBtn">
              ← 피드로 돌아가기
            </button>
          </div>
        </div>
      </div>
    `;
  
    // 글귀 카드 폰트 자동 조절
    const quoteEl = container.querySelector('.quote-card');
    if (quoteEl) {
      autoAdjustQuoteFont(quoteEl);
    }
  
    // "뒤로" 버튼
    const backBtn = container.querySelector('#backToFeedBtn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        window.location.href = '/index.html';
      });
    }
  }
  
  /**
   * 현재 글 기준으로 서버에서 "관련 글" 추천 받기
   * - GET /api/posts/:id/related?limit=6
   */
  async function loadRelatedPosts(currentPost) {
    const box = document.getElementById('relatedPosts');
    if (!box) return;
  
    box.innerHTML =
      '<p class="text-muted">관련 글을 불러오는 중입니다...</p>';
  
    try {
      const res = await fetch(
        `/api/posts/${encodeURIComponent(currentPost.id)}/related?limit=6`
      );
  
      if (!res.ok) {
        box.innerHTML =
          '<p class="text-muted">관련 글을 불러오는 중 오류가 발생했습니다.</p>';
        return;
      }
  
      const data = await res.json();
      if (!data.ok) {
        box.innerHTML =
          '<p class="text-muted">관련 글을 불러오는 중 오류가 발생했습니다.</p>';
        return;
      }
  
      const posts = (data.posts || []).filter(
        (p) => String(p.id) !== String(currentPost.id)
      );
  
      if (!posts.length) {
        box.innerHTML =
          '<p class="text-muted">아직 함께 읽어볼 만한 관련 글이 없습니다.</p>';
        return;
      }
  
      renderRelatedPosts(box, posts, currentPost.id);
    } catch (e) {
      console.error(e);
      box.innerHTML =
        '<p class="text-muted">관련 글을 불러오는 중 오류가 발생했습니다.</p>';
    }
  }
  
  function renderRelatedPosts(box, posts, currentPostId) {
    const cardsHtml = posts
      .map((post) => {
        const dateStr = formatKoreanDateTime(post.created_at);
  
        const nickname =
          post.author_nickname && post.author_nickname.trim().length > 0
            ? post.author_nickname.trim()
            : '';
  
        const baseName =
          nickname ||
          (post.author_name && post.author_name.trim().length > 0
            ? post.author_name.trim()
            : '익명');
  
        const maskedEmail = maskEmail(post.author_email);
        const author = maskedEmail ? `${baseName} (${maskedEmail})` : baseName;
  
        const { cleanHtml, fontKey } = extractFontFromContent(post.content);
        const quoteFontClass =
          fontKey === 'serif' || fontKey === 'sans' || fontKey === 'hand'
            ? `quote-font-${fontKey}`
            : '';
  
        // 해시태그 표시 (간단 버전)
        let tags = [];
        if (Array.isArray(post.hashtags)) {
          tags = post.hashtags;
        } else if (
          typeof post.hashtags === 'string' &&
          post.hashtags.trim() !== ''
        ) {
          tags = post.hashtags.split(',').map((t) => t.trim()).filter(Boolean);
        }
  
        const hashtagHtml =
          tags.length > 0
            ? `
            <div class="mt-1">
              ${tags
                .map(
                  (t) =>
                    `<span class="badge text-bg-light text-muted me-1">#${escapeHtml(
                      t
                    )}</span>`
                )
                .join('')}
            </div>
          `
            : '';
  
        return `
          <div class="card mb-2 related-card" data-post-id="${post.id}">
            <div class="card-body py-2">
              <h6 class="card-title mb-1">${escapeHtml(post.title || '')}</h6>
              <p class="card-text mb-1">
                <small class="text-muted">${escapeHtml(
                  author
                )} · ${dateStr}</small>
              </p>
              <div class="related-content-preview">
                <div class="quote-card small ${quoteFontClass}">
                  ${cleanHtml}
                </div>
              </div>
              ${hashtagHtml}
            </div>
          </div>
        `;
      })
      .join('');
  
    box.innerHTML = cardsHtml;
  
    // 폰트/클릭 인터랙션 세팅
    const cards = box.querySelectorAll('.related-card');
    cards.forEach((card) => {
      const postId = card.getAttribute('data-post-id');
      const quote = card.querySelector('.quote-card');
      if (quote) {
        autoAdjustQuoteFont(quote);
      }
  
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => {
        const post = posts.find((p) => String(p.id) === String(postId));
        if (!post) return;
  
        // 새 글을 상세 보기용으로 localStorage에 저장
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
          localStorage.setItem('glsoop_lastPost', JSON.stringify(detailData));
        } catch (err) {
          console.error('failed to cache related post detail', err);
        }
  
        window.location.href = `/html/post.html?postId=${encodeURIComponent(
          post.id
        )}`;
      });
    });
  }
  