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
      '<p class="text-danger">글 정보를 찾을 수 없습니다. 다시 시도해주세요.</p>';
    return;
  }

  container.innerHTML = '<p class="gls-text-muted">글을 불러오는 중입니다...</p>';

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

  try {
    const res = await fetch(`/api/posts/${encodeURIComponent(postId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.ok && data.post) {
        const fresh = data.post;
        postData = postData ? { ...postData, ...fresh } : fresh;

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

  if (!postData) {
    container.innerHTML =
      '<p class="text-danger">글을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>';
    return;
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
          <button type="button" class="gls-modal-close" data-gls-dismiss="modal" aria-label="닫기"></button>
        </div>

        <div class="modal-body">
          <div class="gls-grid gls-grid-2 gls-gap-2">
            <div>
              <label class="gls-label gls-text-small gls-mb-1">포맷</label>
              <select id="igOptFormat" class="gls-select gls-select-sm">
                <option value="feed45">피드 4:5 (1080×1350)</option>
                <option value="square">정사각 (1080×1080)</option>
              </select>
            </div>

            <div>
              <label class="gls-label gls-text-small gls-mb-1">스타일</label>
              <select id="igOptStyle" class="gls-select gls-select-sm">
                <option value="photo-overlay">감성(오버레이)</option>
                <option value="clean-card">클린 카드</option>
              </select>
            </div>

            <div>
              <label class="gls-label gls-text-small gls-mb-1">배경 프리셋</label>
              <select id="igOptBgKey" class="gls-select gls-select-sm">
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

            <div>
              <label class="gls-label gls-text-small gls-mb-1">오버레이 진하기</label>
              <input id="igOptOverlay" type="range" class="gls-range" min="0" max="0.65" step="0.01" value="0.35" />
              <div class="gls-spread">
                <span class="gls-text-muted gls-text-small">밝게</span>
                <span class="gls-text-muted gls-text-small">진하게</span>
              </div>
            </div>

            <div class="gls-col-span-2 gls-mt-2">
              <label class="gls-label gls-text-small gls-mb-1">배경 이미지 URL (선택)</label>
              <input id="igOptBgUrl" class="gls-input gls-input-sm"
                     placeholder="예) /img/ig/bg.jpg 또는 https://..." />
              <div class="gls-form-help">
                URL이 있으면 프리셋 대신 사진이 사용돼.
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="gls-btn gls-btn-secondary gls-btn-sm" data-gls-dismiss="modal">닫기</button>
          <button type="button" class="gls-btn gls-btn-primary gls-btn-sm" id="igExportRunBtn">PNG 저장</button>
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
      if (window.glsModal) window.glsModal.close(modalEl);
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
  btn.className = 'gls-btn gls-btn-xs gls-btn-secondary ig-share-btn';
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
    if (window.glsModal) window.glsModal.open(modalEl);
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

  // ✅ 레이아웃은 post.html(2컬럼)에서 담당
  // - 여기서는 카드만 렌더링하고, 메타 바는 별도 컨테이너에 담는다
  container.innerHTML = `${cardHtml}`;

  const card = container.querySelector('.gls-post-card');
  if (card) {
    const authorBadge = card.querySelector('.gls-author-badge');
    if (authorBadge) {
      const authorName = authorBadge.textContent?.trim() || '글쓴이';
      const badgeWrap = document.createElement('div');
      badgeWrap.className = 'gls-user-badge gls-user-badge--compact';
      badgeWrap.innerHTML = `
        <div class="gls-user-badge__avatar" aria-hidden="true"></div>
        <div class="gls-user-badge__body">
          <span class="gls-user-badge__name"></span>
        </div>
      `;

      const avatarEl = badgeWrap.querySelector('.gls-user-badge__avatar');
      if (avatarEl) {
        avatarEl.textContent = authorName.charAt(0) || '🌿';
      }

      const nameEl = badgeWrap.querySelector('.gls-user-badge__name');
      if (nameEl) {
        nameEl.textContent = authorName;
      }

      authorBadge.replaceWith(badgeWrap);
    }

    enhanceStandardPostCard(card, post);
    setupHashtagSearch(card);

    const feedContent = card.querySelector('.feed-post-content');
    if (feedContent) feedContent.classList.add('expanded', 'post-inner-surface');

    const moreBtn = card.querySelector('.more-toggle');
    if (moreBtn) moreBtn.style.display = 'none';


    // ✅ 우측 스티키 패널(액션) 버튼과 카드 액션을 연결
    bindSideActions(card, post);
  }

  // ✅ 메타 바(타입 + 해시태그 + 피드 링크)를 카드 아래에서 하나로 묶기
  const metaBar = document.getElementById('postMetaBar');
  const metaCategory = document.getElementById('postMetaCategory');
  const metaTags = document.getElementById('postMetaTags');
  const backLink = document.getElementById('backToFeedLink');

  if (metaBar && metaCategory && metaTags) {
    metaCategory.innerHTML = '';
    metaTags.innerHTML = '';

    const legacyMeta = card?.querySelector('.post-bottom-meta');
    if (legacyMeta) {
      // category row + hashtag row(s)를 분리해서 담기
      const categoryRow = legacyMeta.querySelector('.post-category-row');
      if (categoryRow) {
        const categoryBadge = categoryRow.querySelector('.post-category-label');
        if (categoryBadge) categoryBadge.classList.add('post-type-chip');
        metaCategory.appendChild(categoryRow);
      }

      // 해시태그 컨테이너(.gls-card-hashtags)는 그대로 옮기되 버튼 클래스를 통일
      legacyMeta.querySelectorAll('.gls-tag-btn').forEach((btn) => {
        btn.classList.add('post-tag-chip');
      });

      Array.from(legacyMeta.children || []).forEach((node) => {
        // categoryRow는 이미 이동했으니 스킵
        if (node.classList?.contains('post-category-row')) return;
        metaTags.appendChild(node);
      });

      legacyMeta.remove();
    }

    metaBar.hidden = false;
    setupHashtagSearch(metaBar);
  }

  if (backLink) {
    backLink.setAttribute('role', 'button');
  }
}

/**
 * 우측 패널(좋아요/북마크/공유) 버튼을 카드 액션과 연결
 * - 카드 구조를 바꾸지 않고도 "액션바" UX를 만들기 위한 프록시
 */
function bindSideActions(card, post) {
  const sideLikeBtn = document.getElementById('sideLikeBtn');
  const sideLikeCount = document.getElementById('sideLikeCount');
  const sideBookmarkBtn = document.getElementById('sideBookmarkBtn');
  const sideShareBtn = document.getElementById('sideShareBtn');

  if (!sideLikeBtn || !sideBookmarkBtn || !sideShareBtn) return;
  if (!card) return;

  const likeBtn = card.querySelector('.like-btn');
  const bookmarkBtn = card.querySelector('.post-bookmark-toggle');

  const syncLikeState = () => {
    if (!likeBtn || !sideLikeBtn) return;

    const liked = likeBtn.getAttribute('data-liked') === '1';
    const heartEl = sideLikeBtn.querySelector('.post-side-like-heart');
    if (heartEl) heartEl.textContent = liked ? '♥' : '♡';

    const countEl = likeBtn.querySelector('.like-count');
    const countTxt = countEl ? String(countEl.textContent || '0') : '0';
    if (sideLikeCount) sideLikeCount.textContent = countTxt;

    sideLikeBtn.setAttribute('aria-pressed', liked ? 'true' : 'false');
  };

  // 최초 동기화
  syncLikeState();

  // 좋아요: 사이드 → 카드 클릭
  sideLikeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!likeBtn) return;
    likeBtn.click();
    // toggle는 비동기일 수 있어 두 번 동기화
    setTimeout(syncLikeState, 0);
    setTimeout(syncLikeState, 350);
  });

  // 카드 좋아요 클릭 시에도 사이드 동기화
  if (likeBtn) {
    likeBtn.addEventListener('click', () => {
      setTimeout(syncLikeState, 0);
      setTimeout(syncLikeState, 350);
    });
  }

  // 북마크: 사이드 → 카드 북마크(모달) 클릭
  sideBookmarkBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!bookmarkBtn) return;
    bookmarkBtn.click();
  });

  // 공유: 사이드 → 인스타 내보내기 모달 열기
  sideShareBtn.addEventListener('click', (e) => {
    e.preventDefault();
    try {
      ensureIgExportModal();
      window.__igExportTargetPost = post;
      const modalEl = document.getElementById('igExportModal');
      if (window.glsModal) window.glsModal.open(modalEl);
    } catch (err) {
      console.error(err);
      alert('공유 모달을 열지 못했습니다. 콘솔을 확인해주세요.');
    }
  });
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
      window.location.href = `/explore?tag=${encodeURIComponent(tag)}`;
    });
  });
}

/**
 * 관련 글 로드
 */
async function loadRelatedPosts(currentPost) {
  const highlightEl = document.getElementById('relatedHighlight');
  const listEl = document.getElementById('relatedList');
  const legacyBox = document.getElementById('relatedPosts');

  const hasSidebarTargets = !!(highlightEl && listEl);
  const box = hasSidebarTargets ? null : legacyBox;

  if (hasSidebarTargets) {
    highlightEl.innerHTML = '<p class="gls-text-muted gls-text-small gls-mb-0">관련 글을 불러오는 중입니다...</p>';
    listEl.innerHTML = '';
  } else {
    if (!box) return;
    box.innerHTML = '<p class="gls-text-muted">관련 글을 불러오는 중입니다...</p>';
  }

  try {
    const res = await fetch(
      `/api/posts/${encodeURIComponent(currentPost.id)}/related?limit=12`
    );

    if (!res.ok) {
      if (hasSidebarTargets) {
        highlightEl.innerHTML =
          '<p class="gls-text-muted gls-text-small gls-mb-0">관련 글을 불러오는 중 오류가 발생했습니다.</p>';
      } else if (box) {
        box.innerHTML =
          '<p class="gls-text-muted">관련 글을 불러오는 중 오류가 발생했습니다.</p>';
      }
      return;
    }

    const data = await res.json();
    if (!data.ok) {
      if (hasSidebarTargets) {
        highlightEl.innerHTML =
          '<p class="gls-text-muted gls-text-small gls-mb-0">관련 글을 불러오는 중 오류가 발생했습니다.</p>';
      } else if (box) {
        box.innerHTML =
          '<p class="gls-text-muted">관련 글을 불러오는 중 오류가 발생했습니다.</p>';
      }
      return;
    }

    const posts = (data.posts || []).filter(
      (p) => String(p.id) !== String(currentPost.id)
    );

    if (!posts.length) {
      if (hasSidebarTargets) {
        highlightEl.innerHTML =
          '<p class="gls-text-muted gls-text-small gls-mb-0">아직 함께 읽어볼 만한 관련 글이 없습니다.</p>';
        listEl.innerHTML = '';
      } else if (box) {
        box.innerHTML =
          '<p class="gls-text-muted">아직 함께 읽어볼 만한 관련 글이 없습니다.</p>';
      }
      return;
    }

    if (hasSidebarTargets) {
      renderRelatedSidebar(posts, currentPost);
    } else if (box) {
      renderRelatedPosts(box, posts, currentPost.id);
    }
  } catch (e) {
    console.error(e);
    if (highlightEl && listEl) {
      highlightEl.innerHTML =
        '<p class="gls-text-muted gls-text-small gls-mb-0">관련 글을 불러오는 중 오류가 발생했습니다.</p>';
      listEl.innerHTML = '';
    } else if (legacyBox) {
      legacyBox.innerHTML =
        '<p class="gls-text-muted">관련 글을 불러오는 중 오류가 발생했습니다.</p>';
    }
  }
}

function toPlainText(html) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(html || ''), 'text/html');
    return (doc.body && doc.body.textContent ? doc.body.textContent : '').trim();
  } catch {
    return String(html || '').replace(/<[^>]+>/g, '').trim();
  }
}

function buildSnippetFromPost(post, maxLen = 70) {
  if (!post) return '';

  let raw = post.content || '';
  try {
    // extractContentWithFont는 postCard.js에서 제공(있으면 사용)
    if (typeof extractContentWithFont === 'function') {
      const extracted = extractContentWithFont(post);
      if (extracted && extracted.cleanHtml) raw = extracted.cleanHtml;
    }
  } catch (e) {
    console.warn('extractContentWithFont failed(ignored)', e);
  }

  const text = toPlainText(raw).replace(/\s+/g, ' ');
  if (!text) return '';
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

function cacheAndNavigateToDetail(post) {
  if (!post) return;
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
        (post.author_nickname && String(post.author_nickname).trim()) ||
        (post.author_name && String(post.author_name).trim()) ||
        null,
      author_email: post.author_email || null,

      like_count: typeof post.like_count === 'number' ? post.like_count : 0,
      user_liked: post.user_liked === 1 || post.user_liked === true ? 1 : 0,
    };

    localStorage.setItem('glsoop_lastPost', JSON.stringify(detailData));
  } catch (e) {
    console.warn('failed to cache detail', e);
  }

  window.location.href = `/html/post.html?postId=${encodeURIComponent(post.id)}`;
}

function renderRelatedSidebar(posts, currentPost) {
  const highlightEl = document.getElementById('relatedHighlight');
  const listEl = document.getElementById('relatedList');
  const moreBtn = document.getElementById('relatedMoreBtn');

  if (!highlightEl || !listEl) return;

  // 내부 상태: "더 보기" 토글
  const state = window.__glsoopRelatedState || {
    expanded: false,
    limit: 12,
    posts: [],
    currentId: null,
  };

  state.posts = posts;
  state.currentId = currentPost?.id;
  window.__glsoopRelatedState = state;

  const render = (expanded) => {
    const maxList = expanded ? 12 : 6;
    const list = Array.isArray(state.posts) ? state.posts : [];
    const top = list[0];
    const rest = list.slice(1, 1 + maxList);

    // highlight
    if (top) {
      const dateStr = typeof formatKoreanDateTime === 'function'
        ? formatKoreanDateTime(top.created_at)
        : '';
      const snippet = buildSnippetFromPost(top, 90);
      const likeCount = typeof top.like_count === 'number' ? top.like_count : 0;

      highlightEl.innerHTML = `
        <div class="post-related-h-title">${escapeHtml(top.title || '')}</div>
        <p class="post-related-h-snippet">${escapeHtml(snippet)}</p>
        <div class="post-related-h-meta">
          ${dateStr ? `<span>${escapeHtml(dateStr)}</span>` : ''}
          <span>♥ ${likeCount}</span>
        </div>
      `;
      highlightEl.onclick = () => cacheAndNavigateToDetail(top);
    }

    // list
    listEl.innerHTML = rest
      .map((p) => {
        const dateStr = typeof formatKoreanDateTime === 'function'
          ? formatKoreanDateTime(p.created_at)
          : '';
        const snippet = buildSnippetFromPost(p, 70);
        const likeCount = typeof p.like_count === 'number' ? p.like_count : 0;

        return `
          <div class="post-related-item" data-post-id="${escapeHtml(String(p.id))}">
            <div class="post-related-item-title">${escapeHtml(p.title || '')}</div>
            <p class="post-related-item-snippet">${escapeHtml(snippet)}</p>
            <div class="post-related-item-meta">
              ${dateStr ? `<span>${escapeHtml(dateStr)}</span>` : ''}
              <span>♥ ${likeCount}</span>
            </div>
          </div>
        `;
      })
      .join('');

    listEl.querySelectorAll('.post-related-item').forEach((el) => {
      el.addEventListener('click', () => {
        const pid = el.getAttribute('data-post-id');
        const p = (state.posts || []).find((x) => String(x.id) === String(pid));
        if (p) cacheAndNavigateToDetail(p);
      });
    });

    // more btn
    if (moreBtn) {
      const shouldShow = list.length > 1 + 6;
      moreBtn.style.display = shouldShow ? 'inline-block' : 'none';
      moreBtn.textContent = expanded ? '접기' : '더 보기';
      moreBtn.dataset.expanded = expanded ? '1' : '0';
    }
  };

  render(state.expanded);

  // 더 보기: 필요하면 더 많이 fetch 후 확장
  if (moreBtn && !moreBtn.dataset.bound) {
    moreBtn.dataset.bound = '1';
    moreBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      state.expanded = !(moreBtn.dataset.expanded === '1');

      if (state.expanded && (state.posts || []).length < 18 && currentPost?.id) {
        try {
          const res = await fetch(
            `/api/posts/${encodeURIComponent(currentPost.id)}/related?limit=24`
          );
          if (res.ok) {
            const data = await res.json();
            if (data.ok) {
              state.posts = (data.posts || []).filter(
                (p) => String(p.id) !== String(currentPost.id)
              );
            }
          }
        } catch (err) {
          console.warn('related more fetch failed(ignored)', err);
        }
      }

      render(state.expanded);
    });
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
      '<p class="gls-text-muted gls-text-small gls-mb-0">아직 관련된 글이 없습니다.</p>';
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
