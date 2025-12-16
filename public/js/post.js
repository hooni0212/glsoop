// public/js/post.js
// 개별 글 상세 페이지 스크립트

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

  try {
    const res = await fetch(`/api/posts/${encodeURIComponent(postId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.ok && data.post) {
        const fresh = data.post;

        postData.title = fresh.title ?? postData.title;
        postData.content = fresh.content ?? postData.content;
        postData.created_at = fresh.created_at ?? postData.created_at;

        postData.author_id = fresh.author_id ?? postData.author_id;
        postData.author_name = fresh.author_name ?? postData.author_name;
        postData.author_nickname = fresh.author_nickname ?? postData.author_nickname;
        postData.author_email = fresh.author_email ?? postData.author_email;

        if (typeof fresh.like_count === 'number') postData.like_count = fresh.like_count;
        if (fresh.user_liked !== undefined) postData.user_liked = fresh.user_liked ? 1 : 0;

        if (fresh.hashtags) postData.hashtags = fresh.hashtags;

        try {
          localStorage.setItem('glsoop_lastPost', JSON.stringify(postData));
        } catch (e) {
          console.warn('glsoop_lastPost 저장 실패', e);
        }
      }
    } else {
      console.warn('detail API 응답 비정상:', res.status, res.statusText);
    }
  } catch (e) {
    console.warn('detail API 호출 실패(무시 가능)', e);
  }

  renderPostDetail(container, postData);
  loadRelatedPosts(postData);
}

/**
 * ✅ 인스타 내보내기 모달(한 번만 생성)
 */
function ensureIgExportModal() {
  if (document.getElementById('igExportModal')) return;

  const modalHtml = `
  <div class="modal fade" id="igExportModal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">인스타 이미지 내보내기</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="닫기"></button>
        </div>

        <div class="modal-body">
          <div class="row g-2">
            <div class="col-6">
              <label class="form-label small mb-1">포맷</label>
              <select id="igOptFormat" class="form-select form-select-sm">
                <option value="feed45">피드 4:5 (1080×1350)</option>
                <option value="square">정사각 (1080×1080)</option>
              </select>
            </div>

            <div class="col-6">
              <label class="form-label small mb-1">스타일</label>
              <select id="igOptStyle" class="form-select form-select-sm">
                <option value="photo-overlay">감성(오버레이)</option>
                <option value="clean-card">클린 카드</option>
              </select>
            </div>

            <div class="col-6">
              <label class="form-label small mb-1">배경 프리셋</label>
              <select id="igOptBgKey" class="form-select form-select-sm">
                <option value="forestMist">숲 안개</option>
                <option value="deepGreen">딥 그린</option>
                <option value="dawnSky">새벽 하늘</option>
                <option value="warmPaper">따뜻한 종이</option>
                <option value="nightLake">밤 호수</option>
                <option value="springLeaf">봄 잎</option>
                <option value="monoInk">잉크 모노</option>
                <option value="sunsetPeach">노을 피치</option>
              </select>
            </div>

            <div class="col-6">
              <label class="form-label small mb-1">오버레이 진하기</label>
              <input id="igOptOverlay" type="range" class="form-range" min="0" max="0.65" step="0.01" value="0.35" />
              <div class="d-flex justify-content-between">
                <span class="text-muted small">밝게</span>
                <span class="text-muted small">진하게</span>
              </div>
            </div>

            <div class="col-12 mt-2">
              <label class="form-label small mb-1">배경 이미지 URL (선택)</label>
              <input id="igOptBgUrl" class="form-control form-control-sm"
                     placeholder="예) /img/ig/bg.jpg 또는 https://..." />
              <div class="form-text">
                URL이 있으면 프리셋 대신 사진이 사용돼.
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-outline-secondary btn-sm" data-bs-dismiss="modal">닫기</button>
          <button type="button" class="btn btn-primary btn-sm" id="igExportRunBtn">PNG 저장</button>
        </div>
      </div>
    </div>
  </div>`;

  const wrap = document.createElement('div');
  wrap.innerHTML = modalHtml;
  document.body.appendChild(wrap.firstElementChild);

  // 실행 버튼 핸들러(한 번만)
  const runBtn = document.getElementById('igExportRunBtn');
  runBtn.addEventListener('click', async () => {
    const post = window.__igExportTargetPost;
    if (!post) return;

    if (typeof window.exportPostToInstagram !== 'function') {
      alert('이미지 내보내기 모듈을 불러오지 못했습니다. (igExport.js 확인)');
      return;
    }

    const format = document.getElementById('igOptFormat')?.value || 'feed45';
    const style = document.getElementById('igOptStyle')?.value || 'photo-overlay';
    const bgKey = document.getElementById('igOptBgKey')?.value || 'forestMist';
    const bgImageUrl = (document.getElementById('igOptBgUrl')?.value || '').trim();
    const overlayOpacity = parseFloat(document.getElementById('igOptOverlay')?.value || '0.35');

    try {
      await window.exportPostToInstagram(post, {
        format,
        style,
        bgKey,
        bgImageUrl,
        overlayOpacity,
      });

      // 모달 닫기
      const modalEl = document.getElementById('igExportModal');
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();
    } catch (e) {
      console.error(e);
      alert('이미지 생성 중 오류가 발생했습니다. 콘솔을 확인해주세요.');
    }
  });
}

/**
 * ✅ 카드 헤더에 “공유(⋯)” 버튼을 넣고 모달을 여는 함수
 * - 가능한 한 구조에 덜 의존하도록 like-btn 옆에 끼워 넣는 방식
 */
function attachIgShareButton(card, post) {
  if (!card || !post) return;

  // 이미 붙였으면 스킵
  if (card.querySelector('[data-ig-share-btn="1"]')) return;

  ensureIgExportModal();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-outline-secondary btn-sm';
  btn.textContent = '⋯';
  btn.setAttribute('data-ig-share-btn', '1');
  btn.style.padding = '2px 10px';
  btn.style.lineHeight = '1.2';
  btn.style.borderRadius = '999px';

  // 넣을 자리: like 버튼 옆이 1순위
  const likeBtn = card.querySelector('.like-btn');
  if (likeBtn && likeBtn.parentElement) {
    // likeBtn 앞에 넣어서 (⋯) [하트] 순서
    likeBtn.parentElement.insertBefore(btn, likeBtn);
    // 간격 확보
    btn.style.marginRight = '8px';
  } else {
    // fallback: 카드 상단 어디든 “오른쪽 끝”에 붙이기
    const headerLikeArea =
      card.querySelector('.card-header') ||
      card.querySelector('.gls-post-header') ||
      card.querySelector('.feed-post-header') ||
      card.querySelector('.post-header') ||
      card;

    headerLikeArea.appendChild(btn);
    btn.style.position = 'absolute';
    btn.style.top = '14px';
    btn.style.right = '14px';
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();

    // 현재 포스트를 전역에 임시 저장(모달 실행 버튼에서 사용)
    window.__igExportTargetPost = post;

    // 모달 열기
    const modalEl = document.getElementById('igExportModal');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
  });
}

/**
 * 선택된 한 개의 글을 화면 상단에 크게 렌더링
 */
function renderPostDetail(container, post) {
  if (!container || !post) return;

  const cardHtml = buildStandardPostCardHTML(post, {
    showMoreButton: false,
  });

  // ✅ 카드 아래쪽 버튼/셀렉트 라인 제거 + “피드로 돌아가기”만 유지
  container.innerHTML = `
    <div class="row justify-content-center">
      <div class="col-md-8">
        ${cardHtml}

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

  const card = container.querySelector('.gls-post-card');
  if (card) {
    enhanceStandardPostCard(card, post);
    setupHashtagSearch(card);

    const feedContent = card.querySelector('.feed-post-content');
    if (feedContent) feedContent.classList.add('expanded');

    const moreBtn = card.querySelector('.more-toggle');
    if (moreBtn) moreBtn.style.display = 'none';

    // ✅ 여기에서 카드 헤더 “공유(⋯)” 버튼 붙이기
    attachIgShareButton(card, post);
  }

  const backBtn = document.getElementById('backToFeedBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = '/index.html';
    });
  }
}

/**
 * 해시태그 버튼 클릭 → 메인 피드 tag 검색
 */
function setupHashtagSearch(scopeEl) {
  if (!scopeEl) return;

  const tagButtons = scopeEl.querySelectorAll(
    '.hashtag-pill, .gls-tag-btn, .gls-hashtag-chip'
  );

  tagButtons.forEach((btn) => {
    if (btn.dataset.tagNavBound) return;

    const tag = btn.getAttribute('data-tag') || btn.dataset.tag;
    if (!tag) return;

    btn.dataset.tagNavBound = '1';
    btn.style.cursor = 'pointer';

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.location.href = `/index.html?tag=${encodeURIComponent(tag)}`;
    });
  });
}

/**
 * 관련 글 로드
 */
async function loadRelatedPosts(currentPost) {
  const box = document.getElementById('relatedPosts');
  if (!box) return;

  box.innerHTML = '<p class="text-muted">관련 글을 불러오는 중입니다...</p>';

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

function buildRelatedPostCardHTML(post) {
  if (!post) return '';
  return buildStandardPostCardHTML(post, {
    showMoreButton: false,
    cardExtraClass: 'related-card',
  });
}

function renderRelatedPosts(box, posts, currentPostId) {
  if (!box) return;

  const list = Array.isArray(posts)
    ? posts.filter((p) => String(p.id) !== String(currentPostId))
    : [];

  if (!list.length) {
    box.innerHTML =
      '<p class="text-muted small mb-0">아직 관련된 글이 없습니다.</p>';
    return;
  }

  const cardsHtml = list.map((post) => buildRelatedPostCardHTML(post)).join('');
  box.innerHTML = cardsHtml;

  list.forEach((post) => {
    const card = box.querySelector(`.gls-post-card[data-post-id="${post.id}"]`);
    if (!card) return;

    if (typeof enhanceStandardPostCard === 'function') {
      enhanceStandardPostCard(card, post);
    }

    setupHashtagSearch(card);

    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
      if (e.target.closest('.like-btn')) return;
      if (e.target.closest('.gls-tag-btn')) return;

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

          author_id: post.author_id || null,
          author_name: post.author_name || null,
          author_nickname:
            (post.author_nickname && post.author_nickname.trim()) ||
            (post.author_name && post.author_name.trim()) ||
            null,
          author_email: post.author_email || null,

          like_count: likeCount,
          user_liked: userLiked,
        };

        localStorage.setItem('glsoop_lastPost', JSON.stringify(detailData));
      } catch (err) {
        console.error('failed to cache related post detail', err);
      }

      window.location.href = `/html/post.html?postId=${encodeURIComponent(post.id)}`;
    });
  });
}
