// public/js/postCard.js

/**
 * 공통: 작성자 표시 문자열 만들기
 * - 닉네임 > 이름 > 익명
 * - 이메일은 마스킹해서 괄호 안에 표시 (예: 재원 (ab***@gmail.com))
 */
function buildAuthorDisplay(post) {
  const nickname =
    post.author_nickname && String(post.author_nickname).trim().length > 0
      ? String(post.author_nickname).trim()
      : '';

  const baseName =
    nickname ||
    (post.author_name && String(post.author_name).trim().length > 0
      ? String(post.author_name).trim()
      : '익명');

  const maskedEmail = post.author_email ? maskEmail(post.author_email) : '';
  return maskedEmail ? `${baseName} (${maskedEmail})` : baseName;
}

/**
 * 공통: 글 내용 + 폰트 메타 파싱
 * - post.content 안에 <!--FONT:serif--> 같은 메타가 있으면 분리
 * - cleanHtml : 실제로 카드에 넣을 HTML
 * - fontClass : quote-card에 붙일 폰트 클래스 (quote-font-*)
 */
function extractContentWithFont(post) {
  const raw = post.content || '';
  const { cleanHtml, fontKey } = extractFontFromContent(raw);

  const quoteFontClass =
    fontKey === 'serif' || fontKey === 'sans' || fontKey === 'hand'
      ? `quote-font-${fontKey}`
      : '';

  return { cleanHtml, quoteFontClass };
}

/**
 * ⭐ 공통 카드 HTML 생성 함수
 * - 인덱스 피드 / 관련 글 / 마이페이지 등에서 모두 같은 구조를 쓰기 위해 사용
 * - 좋아요/해시태그/작성자/타임스탬프/제목/내용 카드 구조 통일
 */
function buildStandardPostCardHTML(post, options = {}) {
  // 옵션 (필요하면 나중에 조금씩 조정 가능)
  const {
    // 상세 페이지에서 "더보기" 버튼을 숨기고 싶으면 false로 넘길 수 있게
    showMoreButton = true,
  } = options;

  const dateStr = formatKoreanDateTime(post.created_at);
  const author = buildAuthorDisplay(post);

  const likeCount =
    typeof post.like_count === 'number' ? post.like_count : 0;
  const liked =
    post.user_liked === 1 || post.user_liked === true ? true : false;

  const hashtagHtml = buildHashtagHtml(post);
  const { cleanHtml, quoteFontClass } = extractContentWithFont(post);

  return `
    <div class="card mb-3 gls-post-card" data-post-id="${post.id}">
      <div class="card-body">
        <!-- 상단 메타 영역: 작성자 / 날짜 / 공감 버튼 -->
        <div class="d-flex justify-content-between align-items-center mb-2">
          <div class="d-flex align-items-center gap-2">
            <span class="badge bg-light text-muted border gls-author-badge">
              ${escapeHtml(author)}
            </span>
            <span class="text-muted small">${escapeHtml(dateStr)}</span>
          </div>
          <button
            type="button"
            class="btn btn-sm like-btn ${liked ? 'liked' : ''}"
            data-post-id="${post.id}"
            data-liked="${liked ? '1' : '0'}"
          >
            <span class="like-heart">${liked ? '♥' : '♡'}</span>
            <span class="like-count ms-1">${likeCount}</span>
          </button>
        </div>

        <!-- 제목 -->
        <h5 class="card-title mb-2">
          ${escapeHtml(post.title || '')}
        </h5>

        <!-- 본문 카드 영역 -->
        <div class="post-content mt-2">
          <div class="feed-post-content">
            <div class="quote-card ${quoteFontClass}">
              ${cleanHtml}
            </div>
          </div>

          ${
            showMoreButton
              ? `
          <!-- 더보기 버튼 (필요할 때만 노출) -->
          <div class="mt-1 text-end">
            <button
              class="btn btn-link p-0 more-toggle"
              type="button"
              style="display:none;"
            >
              더보기...
            </button>
          </div>`
              : ''
          }
        </div>

        <!-- 해시태그 버튼들 -->
        ${hashtagHtml}
      </div>
    </div>
  `;
}

/**
 * 공통 카드에 “동작” 붙여주는 함수
 * - autoAdjustQuoteFont
 * - 작성자 클릭 → 작가 페이지 이동 (setupCardAuthorLink)
 * - 좋아요/더보기/상세보기 등 (setupCardInteractions)
 *
 * render할 때마다 이걸 호출해주면 됨.
 */
function enhanceStandardPostCard(cardElement, post) {
  if (!cardElement) return;

  const quoteEl = cardElement.querySelector('.quote-card');
  if (quoteEl) {
    autoAdjustQuoteFont(quoteEl);
  }

  // 페이지별로 이미 존재하는 함수 재사용
  if (typeof setupCardAuthorLink === 'function') {
    setupCardAuthorLink(cardElement, post);
  }
  if (typeof setupCardInteractions === 'function') {
    setupCardInteractions(cardElement, post);
  }
}
