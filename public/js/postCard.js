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
  // 옵션
  const {
    showMoreButton = true,     // 더보기 버튼 표시 여부 (피드는 true, 관련글/마이페이지는 false도 가능)
    cardExtraClass = '',       // .related-card 같은 추가 클래스
    contentExpanded = false,   // true면 feed-post-content에 expanded 클래스 추가 (잘리지 않게)
  } = options;

  const dateStr = formatKoreanDateTime(post.created_at);
  const author = buildAuthorDisplay(post);

  const likeCount =
    typeof post.like_count === 'number' ? post.like_count : 0;
  const liked =
    post.user_liked === 1 || post.user_liked === true ? true : false;

  const hashtagHtml = buildHashtagHtml(post);
  const { cleanHtml, quoteFontClass } = extractContentWithFont(post);

  // 카드에 붙일 추가 클래스
  const extraClass = cardExtraClass ? ` ${cardExtraClass}` : '';

  // feed-post-content에 expanded 붙일지 여부
  const feedContentClass = contentExpanded
    ? 'feed-post-content expanded'
    : 'feed-post-content';

  return `
    <div class="card mb-3 gls-post-card${extraClass}" data-post-id="${post.id}">
      <div class="card-body">
        <!-- 상단 메타 영역: 작성자 / 날짜 / 공감 버튼 -->
        <div class="d-flex justify-content-between align-items-center mb-2">
          <div class="d-flex align-items-center gap-3" >
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
          <div class="${feedContentClass}">
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

// ==============================
// 공통: 좋아요 토글
// ==============================
async function toggleLike(postId, btnEl) {
  if (!btnEl) return;

  try {
    const res = await fetch(
      `/api/posts/${encodeURIComponent(postId)}/toggle-like`,
      { method: 'POST' }
    );

    if (!res.ok) {
      if (res.status === 401) {
        alert('공감을 누르려면 먼저 로그인해 주세요.');
        return;
      }
      alert('공감 처리 중 오류가 발생했습니다.');
      return;
    }

    const data = await res.json();
    if (!data.ok) {
      alert(data.message || '공감 처리 중 오류가 발생했습니다.');
      return;
    }

    const heartSpan = btnEl.querySelector('.like-heart');
    const countSpan = btnEl.querySelector('.like-count');

    if (data.liked) {
      btnEl.classList.add('liked');
      if (heartSpan) heartSpan.textContent = '♥';
    } else {
      btnEl.classList.remove('liked');
      if (heartSpan) heartSpan.textContent = '♡';
    }

    if (countSpan) {
      countSpan.textContent =
        data.likeCount != null ? data.likeCount : 0;
    }
  } catch (err) {
    console.error(err);
    alert('공감 처리 중 오류가 발생했습니다.');
  }
}

// ==============================
// 공통: 작가 배지 클릭 → 작가 페이지
// ==============================
function setupCardAuthorLink(cardEl, post) {
  if (!cardEl || !post) return;

  const badge = cardEl.querySelector('.gls-author-badge');
  if (!badge) return;

  // author_id 또는 user_id 중 있는 것 사용
  const authorId = post.author_id || post.user_id;
  if (!authorId) return;

  badge.style.cursor = 'pointer';
  badge.addEventListener('click', (e) => {
    e.stopPropagation(); // 카드 클릭(상세 이동)과 분리
    window.location.href = `/html/author.html?userId=${encodeURIComponent(
      authorId
    )}`;
  });
}

// ==============================
// 공통: 카드 상호작용(♥, 더보기, 상세 페이지 이동)
// ==============================
function setupCardInteractions(cardEl, post) {
  if (!cardEl || !post) return;

  // 1) 좋아요 버튼
  const likeBtn = cardEl.querySelector('.like-btn');
  if (likeBtn) {
    likeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pid = likeBtn.getAttribute('data-post-id') || post.id;
      toggleLike(pid, likeBtn);
    });
  }

  // 2) 더보기 버튼 (내용이 넘칠 때만 표시)
  const feedContent = cardEl.querySelector('.feed-post-content');
  const moreBtn = cardEl.querySelector('.more-toggle');

  if (feedContent && moreBtn) {
    // 처음 렌더링 직후 높이 비교해서 넘치면 버튼 노출
    const checkOverflow = () => {
      if (feedContent.scrollHeight > feedContent.clientHeight + 4) {
        moreBtn.style.display = 'inline-block';
        moreBtn.textContent = '더보기...';
      } else {
        moreBtn.style.display = 'none';
      }
    };

    // 바로 한 번 체크 + 렌더링 직후 한 번 더
    checkOverflow();
    setTimeout(checkOverflow, 0);

    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const expanded = feedContent.classList.toggle('expanded');
      if (expanded) {
        moreBtn.textContent = '접기';
      } else {
        moreBtn.textContent = '더보기...';
      }
    });
  }

  // 3) 카드 전체 클릭 → 상세 페이지로 이동
  cardEl.addEventListener('click', (e) => {
    // 카드 안의 다른 버튼 클릭은 무시
    if (e.target.closest('.like-btn')) return;
    if (e.target.closest('.gls-tag-btn')) return;
    if (e.target.closest('.edit-post-btn')) return;
    if (e.target.closest('.delete-post-btn')) return;

    try {
      const detailData = {
        id: post.id,
        title: post.title,
        content: post.content,
        created_at: post.created_at,
        hashtags: post.hashtags,
        author_nickname:
          (post.author_nickname &&
            String(post.author_nickname).trim()) ||
          (post.author_name && String(post.author_name).trim()) ||
          null,
        author_email: post.author_email || null,
        like_count:
          post.like_count != null ? post.like_count : 0,
        user_liked:
          post.user_liked != null ? post.user_liked : 0,
      };
      localStorage.setItem(
        'glsoop_lastPost',
        JSON.stringify(detailData)
      );
    } catch (err) {
      console.error('failed to cache detail post', err);
    }

    window.location.href = `/html/post.html?postId=${encodeURIComponent(
      post.id
    )}`;
  });
}
