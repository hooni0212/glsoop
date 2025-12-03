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
 * 선택된 한 개의 글을 화면 상단에 크게 렌더링
 * - index 피드 카드와 거의 동일한 레이아웃을 사용
 * - 해시태그는 버튼(.hashtag-pill)로 보여줌
 *
 * @param {HTMLElement} container - #postDetail 엘리먼트
 * @param {Object} post            - 글 데이터(제목, 내용, 작성자, 해시태그 등)
 */
function renderPostDetail(container, post) {
  if (!post) return; // 방어 코드: post가 없으면 렌더링하지 않음

  // 폰트 메타(<!--FONT:...-->) 파싱
  // - content 안에 <!--FONT:serif--> 같은 메타가 들어 있을 수 있음
  // - extractFontFromContent는 HTML 문자열에서 메타를 제거하고, 폰트 타입만 따로 뽑아줌
  const { cleanHtml, fontKey } = extractFontFromContent(post.content || '');

  // 폰트 타입에 따라 quote-card에 적용할 클래스 결정
  // - quote-font-serif / quote-font-sans / quote-font-hand 중 하나
  const quoteFontClass =
    fontKey === 'serif' || fontKey === 'sans' || fontKey === 'hand'
      ? `quote-font-${fontKey}`
      : '';

  // created_at(ISO 문자열 등)을 "YYYY.MM.DD HH:mm" 같은 한국형 시간 문자열로 변환
  const dateStr = formatKoreanDateTime(post.created_at);

  // 닉네임이 있는 경우: 닉네임 우선 사용
  const nickname =
    post.author_nickname && String(post.author_nickname).trim().length > 0
      ? String(post.author_nickname).trim()
      : '';

  // 닉네임이 없으면 이메일 앞부분(아이디) 사용, 둘 다 없으면 '익명'
  const baseName =
    nickname ||
    (post.author_email ? post.author_email.split('@')[0] : '익명');

  // 이메일을 살짝 마스킹 처리 (예: ab***@gmail.com)
  const maskedEmail = maskEmail(post.author_email);
  // 최종 표시용 작성자 문자열 (예: "재원 (ab***@gmail.com)")
  const author = maskedEmail ? `${baseName} (${maskedEmail})` : baseName;

  // 인덱스 페이지와 동일한 스타일의 해시태그 버튼 HTML 생성
  // - #태그 버튼 여러 개가 있는 <div> 문자열을 반환
  const hashtagHtml = buildHashtagHtml(post);

  // 상세 카드 전체 HTML 구조 생성
  // - 크게 보면 .card 안에 .card-body, 그 안에 제목/작성자/해시태그/내용 순
  container.innerHTML = `
    <div class="row justify-content-center">
      <div class="col-md-8">
        <!-- 메인 상세 카드 -->
        <div class="card post-detail-card mb-3" data-post-id="${post.id}">
          <!-- index 카드와 동일하게: card-body 만 사용 (추가 py-2 X) -->
          <div class="card-body">
            <!-- 제목 영역: 인덱스 카드와 동일하게 mb-1 -->
            <h5 class="card-title mb-1">${escapeHtml(post.title || '')}</h5>

            <!-- 작성자 / 날짜 영역 -->
            <p class="card-text mb-1">
              <small class="text-muted">
                ${escapeHtml(author)} · ${dateStr}
              </small>
            </p>

            <!-- 해시태그 버튼 영역 (#태그 버튼들) -->
            ${hashtagHtml}

            <!-- 본문 카드 영역 (index와 동일 구조) -->
            <div class="post-content mt-2 text-end">
              <!-- feed-post-content: 피드에서 '더보기' 접힘/펼침에 쓰던 컨테이너
                   여기서는 expanded 클래스로 항상 전체 내용 보이게 -->
              <div class="feed-post-content expanded">
                <!-- 인스타 감성 종이 카드 (정사각형 quote-card) -->
                <div class="quote-card ${quoteFontClass}">
                  ${cleanHtml}
                </div>
              </div>
            </div>
          </div>
        </div>

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

  // 글귀 카드 폰트 자동 조절
  // - 내용 길이에 따라 폰트 크기를 적당히 줄여주는 util 함수
  const quoteEl = container.querySelector('.quote-card');
  if (quoteEl) {
    autoAdjustQuoteFont(quoteEl);
  }

  // "뒤로 가기" 버튼 클릭 시 index.html로 이동
  const backBtn = container.querySelector('#backToFeedBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = '/index.html';
    });
  }

  // 해시태그 버튼 클릭 시 메인 피드에서 해당 태그로 필터링
  // - /index.html?tag=OOO 형태로 이동
  const tagButtons = container.querySelectorAll('.hashtag-pill');
  tagButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();                  // 상위 카드 클릭 이벤트로 전파 막기
      const tag = btn.getAttribute('data-tag');
      if (!tag) return;

      // index.html 로 이동하면서 ?tag= 쿼리로 전달
      const url = new URL('/index.html', window.location.origin);
      url.searchParams.set('tag', tag);
      window.location.href = url.toString();
    });
  });
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

  // 내용에서 FONT 메타 제거 + 순수 HTML
  const { cleanHtml, fontKey } = extractFontFromContent(post.content || '');
  const text = stripHtml(cleanHtml);

  // 너무 길면 일부만 잘라서 미리보기로 사용
  const maxLen = 120;
  const preview =
    text.length > maxLen ? text.slice(0, maxLen) + '…' : text;

  const dateStr = formatKoreanDateTime(post.created_at);

  // 닉네임 / 이름 / 이메일 마스킹 중 하나 선택
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

  // 해시태그 배열/문자열 모두 처리
  let tags = [];
  if (Array.isArray(post.hashtags)) {
    tags = post.hashtags;
  } else if (typeof post.hashtags === 'string' && post.hashtags.trim() !== '') {
    tags = post.hashtags.split(',').map((t) => t.trim()).filter(Boolean);
  }

  const hashtagHtml =
    tags.length > 0
      ? `
        <div class="mt-2 text-muted small gls-card-hashtags">
          ${tags.map((t) => `#${escapeHtml(t)}`).join(' ')}
        </div>
      `
      : '';

  const likeCount = post.like_count || 0;
  // /api/posts/:id/related는 user_liked는 없으므로 기본은 '안 누른 상태'로 표시
  const heart = '♡';
  const likeBtnClass = 'btn-outline-success';

  const fontClass =
    fontKey === 'serif'
      ? 'quote-font-serif'
      : fontKey === 'hand'
      ? 'quote-font-hand'
      : 'quote-font-sans';  

  return `
    <div class="card mb-3 related-card gls-post-card" data-post-id="${post.id}">
      <div class="card-body">
        <!-- 상단 메타 정보 (작성자, 날짜, 공감 버튼) -->
        <div class="d-flex justify-content-between align-items-center mb-2">
          <div class="d-flex align-items-center gap-2">
            <span class="badge bg-light text-muted border gls-author-badge">
              ${escapeHtml(author)}
            </span>
            <span class="text-muted small">${escapeHtml(dateStr)}</span>
          </div>
          <button
            type="button"
            class="btn btn-sm ${likeBtnClass} gls-like-btn"
            data-post-id="${post.id}"
          >
            <span class="gls-like-heart">${heart}</span>
            <span class="gls-like-count ms-1">${likeCount}</span>
          </button>
        </div>

        <!-- 제목 -->
        <h6 class="card-title mb-2">
          ${escapeHtml(post.title || '')}
        </h6>

        <!-- 본문 미리보기: 인스타 감성 quote-card -->
        <div class="quote-card ${fontClass}">
          ${escapeHtml(preview || '')}
        </div>

        <!-- 해시태그 (있을 때만) -->
        ${hashtagHtml}
      </div>
    </div>
  `;
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
  // posts 배열을 각 카드 HTML 문자열로 변환 후 join
  const cardsHtml = posts.map((post) => buildRelatedPostCardHTML(post)).join('');

  // 조립된 HTML을 컨테이너에 삽입
  box.innerHTML = cardsHtml;

  // 렌더링된 각 카드에 폰트 자동 조절 + 클릭 이벤트 설정
  const cards = box.querySelectorAll('.related-card');
  cards.forEach((card) => {
    const postId = card.getAttribute('data-post-id'); // 카드에 박아둔 data-post-id
    const quote = card.querySelector('.quote-card');
    const likeBtn = card.querySelector('.gls-like-btn');

    // 작은 quote-card에도 내용 길이에 따라 폰트 조절
    if (quote) {
      autoAdjustQuoteFont(quote);
    }

    // 카드 전체를 클릭 가능하게 처리
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => {
      // 현재 클릭한 카드에 해당하는 post 데이터 찾기
      const post = posts.find((p) => String(p.id) === String(postId));
      if (!post) return;

      // 새 글을 상세 보기용으로 localStorage에 저장
      // - initPostDetailPage에서 다시 이 값을 읽어와서 상세 카드 렌더링에 사용
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

      // 해당 글의 상세 페이지로 이동
      // - /html/post.html?postId=OOO
      window.location.href = `/html/post.html?postId=${encodeURIComponent(
        post.id
      )}`;
    });

    // 공감 버튼 클릭 시 좋아요 토글
    if (likeBtn) {
      likeBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // 카드 클릭(상세 페이지 이동)과 분리
        const pid = likeBtn.getAttribute('data-post-id');
        if (!pid) return;
        toggleLike(pid, likeBtn);
      });
    }
  });
}

/**
 * 인덱스 / 포스트 공통 해시태그 버튼 HTML 생성 함수
 * - post.hashtags에서 태그 문자열을 읽어 버튼(.hashtag-pill)들로 변환
 *
 * @param {Object} post - 글 데이터(hashtags 필드 포함)
 * @returns {string}    - <div>...</div> 형태의 HTML 문자열 (버튼 여러 개)
 */
function buildHashtagHtml(post) {
  // 해시태그 정보가 없으면 빈 문자열 반환
  if (!post || !post.hashtags) return '';

  // "태그1, 태그2, 태그3" 같은 문자열을 쉼표 기준으로 나누고 공백 제거
  const tags = String(post.hashtags)
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  // 유효한 태그가 하나도 없으면 역시 빈 문자열
  if (!tags.length) return '';

  // 각 태그를 버튼(.hashtag-pill) HTML로 변환
  const pills = tags
    .map(
      (t) =>
        `<button type="button"
                  class="btn btn-sm btn-outline-success me-1 mb-1 hashtag-pill"
                  data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</button>`
    )
    .join('');

  // 버튼들을 감싸는 div 반환 (좌측 정렬)
  return `<div class="mt-2 text-start">${pills}</div>`;
}

/**
 * 관련 글 카드에서 공감 버튼 클릭 시 좋아요 토글
 * - 서버: POST /api/posts/:id/toggle-like
 * - 응답에 따라 하트 모양 / 숫자 변경
 */
async function toggleLike(postId, btnEl) {
  try {
    const res = await fetch(`/api/posts/${encodeURIComponent(postId)}/toggle-like`, {
      method: 'POST',
    });

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

    const heartSpan = btnEl.querySelector('.gls-like-heart');
    const countSpan = btnEl.querySelector('.gls-like-count');

    if (data.liked) {
      btnEl.classList.remove('btn-outline-success');
      btnEl.classList.add('btn-success');
      if (heartSpan) heartSpan.textContent = '♥';
    } else {
      btnEl.classList.remove('btn-success');
      btnEl.classList.add('btn-outline-success');
      if (heartSpan) heartSpan.textContent = '♡';
    }

    if (countSpan) {
      countSpan.textContent = data.likeCount != null ? data.likeCount : 0;
    }
  } catch (err) {
    console.error(err);
    alert('공감 처리 중 오류가 발생했습니다.');
  }
}
