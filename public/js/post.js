// public/js/post.js
// 개별 글 상세 페이지 스크립트
// - index.html 피드에서 카드를 클릭해 들어온 "해당 글 1개"를 크게 보여줌
// - 아래에는 현재 글과 연관된 "관련 글 리스트"를 보여줌

// DOM이 완전히 로드된 뒤에 상세 페이지 초기화 시작
document.addEventListener('DOMContentLoaded', () => {
  initPostDetailPage();
});

/**
 * 글 상세 페이지 초기화
 * - URL 쿼리에서 postId 추출
 * - localStorage에 저장되어 있는 글 데이터(glsoop_lastPost)에서 해당 글 찾기
 * - 찾은 데이터를 기반으로 상세 카드 렌더링 + 관련 글 로딩
 */
async function initPostDetailPage() {
  // 현재 URL 예: /html/post.html?postId=3
  const params = new URLSearchParams(window.location.search);
  const postId = params.get('postId');           // 쿼리스트링에서 postId 값 가져오기
  const container = document.getElementById('postDetail'); // 상세 카드가 들어갈 컨테이너

  // postDetail 컨테이너가 없으면 아무 것도 하지 않고 종료
  if (!container) return;

  // URL에 postId가 없으면 잘못된 접근 → 에러 메시지 출력
  if (!postId) {
    container.innerHTML =
      '<p class="text-danger">글 정보를 찾을 수 없습니다. 메인 피드에서 다시 시도해주세요.</p>';
    return;
  }

  // 1) 먼저 localStorage에 저장해 둔 데이터에서 찾아보기
  //    - index.js에서 상세 페이지로 이동하기 전에 glsoop_lastPost에 마지막 클릭한 글 정보를 저장함
  let postData = null;
  try {
    const stored = localStorage.getItem('glsoop_lastPost'); // 문자열(JSON) 가져오기
    if (stored) {
      const parsed = JSON.parse(stored);                    // JSON → 객체로 파싱
      // 저장된 객체의 id와 현재 URL의 postId가 일치하면 그 데이터를 사용
      if (parsed && String(parsed.id) === String(postId)) {
        postData = parsed;
      }
    }
  } catch (e) {
    // localStorage 파싱 중 예외 발생 시 콘솔에만 에러 출력 (화면은 진행)
    console.error('Failed to parse glsoop_lastPost', e);
  }

  // localStorage에서 데이터를 못 찾은 경우
  // - 이 페이지는 원래 index에서 카드 클릭으로 들어와야 하기 때문에
  //   단독 접근 시에는 다시 메인으로 돌아가도록 안내
  if (!postData) {
    container.innerHTML =
      '<p class="text-danger">이 페이지는 메인 피드에서 카드를 클릭해서 들어와야 합니다.<br/>메인으로 돌아가 다시 시도해주세요.</p>';
    return;
  }

  // 2) 상세 글 카드 렌더링
  renderPostDetail(container, postData);

  // 3) 현재 글을 기준으로 "관련 글" 목록 불러오기
  loadRelatedPosts(postData); // 🔥 관련 글 불러오기
}

/**
 * 상세/관련글 카드에서 작성자 배지를 클릭하면 작가 페이지로 이동
 * - post.author_id 가 있어야 동작
 */
function setupCardAuthorLink(card, post) {
  if (!card || !post || !post.author_id) return;

  const badge = card.querySelector('.gls-author-badge');
  if (!badge) return;

  badge.style.cursor = 'pointer';
  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    window.location.href = `/html/author.html?userId=${encodeURIComponent(
      post.author_id
    )}`;
  });
}

/**
 * 상세/관련글 카드에서 좋아요 버튼 동작 붙이기
 * - 표준 카드 템플릿(.like-btn / .like-heart / .like-count)에 맞춰서 처리
 */
function setupCardInteractions(card, post) {
  if (!card || !post) return;

  const likeBtn = card.querySelector('.like-btn');
  if (likeBtn) {
    likeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pid = likeBtn.getAttribute('data-post-id') || post.id;
      if (!pid) return;
      toggleLike(pid, likeBtn);
    });
  }

  // 이 페이지(post.html)에서는 카드 전체 클릭 → 상세 이동은
  // renderRelatedPosts 안에서 따로 처리하고 있으므로 여기서는 안 건드려도 됨.
}


/**
 * 선택된 한 개의 글을 화면 상단에 크게 렌더링
 * - index 피드 카드와 거의 동일한 레이아웃을 사용
 * - 해시태그는 버튼(.hashtag-pill)로 보여줌
 *
 * @param {HTMLElement} container - #postDetail 엘리먼트
 * @param {Object} post            - 글 데이터(제목, 내용, 작성자, 해시태그 등)
 */
function renderPostDetail(container, post) {
  if (!container || !post) return;

  // 1) 공통 카드 HTML을 한 장 만든다 (더보기 버튼은 숨김)
  const cardHtml = buildStandardPostCardHTML(post, {
    showMoreButton: false, // 상세 페이지는 항상 전체 내용 보여줄 거라서
  });

  // 2) 레이아웃(가운데 정렬 + "피드로 돌아가기" 버튼 포함) 조립
  container.innerHTML = `
    <div class="row justify-content-center">
      <div class="col-md-8">
        ${cardHtml}

        <!-- 아래에 '피드로 돌아가기' 버튼 -->
        <div class="d-flex justify-content-between align-items-center mt-2">
          <button
            type="button"
            class="btn btn-outline-secondary btn-sm"
            id="backToFeedBtn"
          >
            ← 피드로 돌아가기
          </button>
        </div>
      </div>
    </div>
  `;

  // 3) 방금 만든 카드 DOM을 찾아서 기능 붙이기
  const card = container.querySelector('.gls-post-card');
  if (card) {
    // 글귀 카드 폰트 자동 조절 + (있다면) 공통 상호작용 함수 호출
    enhanceStandardPostCard(card, post);

    // 상세 페이지에서는 내용이 항상 전체 보이도록 강제
    const feedContent = card.querySelector('.feed-post-content');
    if (feedContent) {
      feedContent.classList.add('expanded'); // height 제한 해제
    }

    // 상세에서는 더보기 버튼 안 쓰므로 안전하게 숨김
    const moreBtn = card.querySelector('.more-toggle');
    if (moreBtn) {
      moreBtn.style.display = 'none';
    }
  }

  // 4) '피드로 돌아가기' 버튼 동작
  const backBtn = document.getElementById('backToFeedBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = '/index.html';
    });
  }
}

/**
 * HTML → 텍스트 변환 (미리보기용)
 * - 태그 제거 + 공백 정리
 */
function stripHtml(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const text = tmp.textContent || tmp.innerText || '';
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 현재 글 기준으로 서버에서 "관련 글" 추천 받기
 * - 백엔드 API: GET /api/posts/:id/related?limit=6
 * - 응답으로 받은 글들을 #relatedPosts 박스에 카드 형태로 렌더링
 *
 * @param {Object} currentPost - 현재 상세 페이지에서 보고 있는 글 데이터
 */
async function loadRelatedPosts(currentPost) {
  // 관련 글 카드가 들어갈 컨테이너
  const box = document.getElementById('relatedPosts');
  if (!box) return;

  // 로딩 중 텍스트 표시
  box.innerHTML =
    '<p class="text-muted">관련 글을 불러오는 중입니다...</p>';

  try {
    // /api/posts/:id/related?limit=6 엔드포인트 호출
    const res = await fetch(
      `/api/posts/${encodeURIComponent(currentPost.id)}/related?limit=6`
    );

    // HTTP 응답 코드가 200 범위가 아니면 오류 처리
    if (!res.ok) {
      box.innerHTML =
        '<p class="text-muted">관련 글을 불러오는 중 오류가 발생했습니다.</p>';
      return;
    }

    const data = await res.json();

    // 서버 응답 JSON에서 ok 플래그 확인
    if (!data.ok) {
      box.innerHTML =
        '<p class="text-muted">관련 글을 불러오는 중 오류가 발생했습니다.</p>';
      return;
    }

    // 현재 글 자기 자신은 목록에서 제외
    const posts = (data.posts || []).filter(
      (p) => String(p.id) !== String(currentPost.id)
    );

    // 관련 글이 하나도 없으면 안내 문구 출력
    if (!posts.length) {
      box.innerHTML =
        '<p class="text-muted">아직 함께 읽어볼 만한 관련 글이 없습니다.</p>';
      return;
    }

    // 관련 글 카드들 렌더링
    renderRelatedPosts(box, posts, currentPost.id);
  } catch (e) {
    // fetch / JSON 파싱 중 예외 발생 시 콘솔 출력 + 안내 문구
    console.error(e);
    box.innerHTML =
      '<p class="text-muted">관련 글을 불러오는 중 오류가 발생했습니다.</p>';
  }
}

/**
 * 관련 글 카드 하나의 HTML 템플릿
 * - 메인 피드 카드와 최대한 비슷한 구조로 구성
 * - 상단: 작성자/날짜 + 작은 공감 버튼
 * - 중간: 제목 + quote-card에 들어가는 미리보기 문구
 * - 하단: 해시태그
 */
function buildRelatedPostCardHTML(post) {
  if (!post) return '';

  // 더보기 버튼은 안 보이게, .related-card 클래스는 그대로 유지
  return buildStandardPostCardHTML(post, {
    showMoreButton: false,
    cardExtraClass: 'related-card',
  });
}
/**
 * 관련 글 카드 목록 렌더링
 * - 오른쪽/아래쪽에 작게 여러 개 표시되는 카드들
 * - 각 카드 클릭 시 해당 글 상세 페이지로 이동
 *
 * @param {HTMLElement} box      - #relatedPosts 컨테이너
 * @param {Array} posts          - 관련 글 데이터 배열
 * @param {number|string} currentPostId - 현재 글 ID (자기 자신 제외 용도, 여기선 이미 제외된 상태)
 */
function renderRelatedPosts(box, posts, currentPostId) {
  if (!box) return;

  // 혹시 현재 글이 목록에 섞여있다면 제외
  const list = Array.isArray(posts)
    ? posts.filter((p) => String(p.id) !== String(currentPostId))
    : [];

  if (!list.length) {
    box.innerHTML =
      '<p class="text-muted small mb-0">아직 관련된 글이 없습니다.</p>';
    return;
  }

  // 1) 카드 HTML 조립 (공통 템플릿 사용)
  const cardsHtml = list.map((post) => buildRelatedPostCardHTML(post)).join('');
  box.innerHTML = cardsHtml;

  // 2) 각 카드에 공통 기능 + 클릭 이동 붙이기
  list.forEach((post) => {
    const card = box.querySelector(
      `.gls-post-card[data-post-id="${post.id}"]`
    );
    if (!card) return;

    // (1) 글귀 폰트/좋아요/작성자 링크 등 공통 처리
    if (typeof enhanceStandardPostCard === 'function') {
      enhanceStandardPostCard(card, post);
    }

    // (2) 카드 전체 클릭 → 상세 페이지로 이동
    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
      // 좋아요 버튼 / 해시태그 클릭 시에는 이동 막기
      if (e.target.closest('.like-btn')) return;
      if (e.target.closest('.gls-tag-btn')) return;

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

