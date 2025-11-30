
// public/js/post.js
// 개별 글 상세 페이지 (트위터 '트윗 보기' 느낌)

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
        '<p class="text-danger">이 페이지는 피드에서 카드를 클릭해서 들어와야 합니다.<br/>메인으로 돌아가 다시 시도해주세요.</p>';
      return;
    }
  
    renderPostDetail(container, postData);
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
    } else if (typeof post.hashtags === 'string' && post.hashtags.trim() !== '') {
      tags = post.hashtags.split(',').map((t) => t.trim()).filter(Boolean);
    }
  
    const hashtagHtml =
      tags.length > 0
        ? `
        <div class="mt-3">
          ${tags
            .map(
              (t) =>
                `<span class="badge text-bg-success me-1">#${escapeHtml(t)}</span>`
            )
            .join('')}
        </div>
      `
        : '';
  
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
  