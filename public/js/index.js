// public/js/index.js
// 글숲 홈 피드 페이지 스크립트 (모듈 방식)
// - 메인 피드 무한 스크롤
// - 공감(좋아요) 기능
// - 해시태그 필터(AND 조건) 기능
// - 글 상세 페이지(post.html)로 이동
// - 작가 페이지(author.html)로 이동
// - 히어로 버튼(바로 글 쓰러가기) 잎사귀 애니메이션

// 전역 네임스페이스 보존 (다른 스크립트와 충돌 방지용)
window.Glsoop = window.Glsoop || {};

// 즉시 실행 함수(IIFE)로 모듈 스코프 생성
Glsoop.FeedPage = (function () {
  // === 내부 상태(전역 대신 모듈 스코프에만 둠) ===
  const FEED_LIMIT = 10;     // 한 번에 가져올 글 개수
  let feedOffset = 0;        // 서버에서 글을 가져올 때 시작 위치(offset)
  let feedLoading = false;   // 현재 글을 가져오는 중인지 여부
  let feedDone = false;      // 더 이상 가져올 글이 없는지 여부

  // 여러 태그 AND 조건용 필터 목록
  // 예: ['힐링', '위로'] → 이 두 태그를 모두 포함한 글만 보기
  let currentTags = [];

  // === 초기화 ===
  function init() {
    // 1) URL 쿼리에서 태그 읽기 (?tag=힐링 또는 ?tags=힐링,위로)
    parseTagsFromURL();

    // 2) 피드 초기화 (첫 로드 + 스크롤 이벤트 등록)
    initFeed();

    // 3) 태그가 이미 붙어 있다면 상단 필터 바 표시
    if (currentTags.length > 0) {
      renderTagFilterBar();
    }

    // 4) 히어로 CTA 잎사귀 애니메이션 세팅
    setupHeroCtaLeaves();
  }

  /**
   * URL 쿼리 문자열에서 ?tag / ?tags 파싱
   * - ?tag=힐링 → currentTags = ['힐링']
   * - ?tags=힐링,위로 → currentTags = ['힐링','위로']
   */
  function parseTagsFromURL() {
    const params = new URLSearchParams(window.location.search);

    const singleTag = params.get('tag');   // ?tag=힐링
    const multiTags = params.get('tags');  // ?tags=힐링,위로

    if (multiTags) {
      currentTags = String(multiTags)
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
    } else if (singleTag) {
      currentTags = [singleTag.trim()];
    } else {
      currentTags = [];
    }
  }

  /**
   * 피드 초기화
   * - 첫 페이지 글 로드
   * - 무한 스크롤 이벤트 등록
   */
  async function initFeed() {
    const feedBox = document.getElementById('feedPosts');
    if (!feedBox) {
      console.error('feedPosts 요소를 찾을 수 없습니다.');
      return;
    }

    // 초기 로딩 메시지
    feedBox.innerHTML = '<p class="text-muted">피드를 불러오는 중입니다...</p>';

    // 첫 페이지 로딩
    await loadMoreFeed();

    // 스크롤 끝 근처에서 추가 로드하도록 이벤트 등록
    window.addEventListener('scroll', handleFeedScroll);
  }

  /**
   * 스크롤 이벤트 핸들러
   * - 스크롤이 페이지 맨 아래에서 200px 이내로 내려오면 다음 글 로드 시도
   */
  function handleFeedScroll() {
    // 이미 로딩 중이거나 더 이상 글이 없으면 아무 것도 하지 않음
    if (feedLoading || feedDone) return;

    const scrollTop =
      window.pageYOffset ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      0;
    const clientHeight =
      document.documentElement.clientHeight || window.innerHeight;
    const scrollHeight =
      document.documentElement.scrollHeight || document.body.scrollHeight;

    // 맨 아래에서 200px 이내면 다음 글 로드
    if (scrollTop + clientHeight >= scrollHeight - 200) {
      loadMoreFeed();
    }
  }

  // === 서버에서 글 목록 추가 로드 ===
  /**
   * /api/posts/feed에서 글 목록 추가로 가져오기
   * - offset, limit, tags를 쿼리로 전달
   * - 첫 페이지에서 글이 없거나 에러가 나면 안내 문구 표시
   */
  async function loadMoreFeed() {
    const feedBox = document.getElementById('feedPosts');
    if (!feedBox) return;
    if (feedLoading || feedDone) return; // 중복 호출 방지

    feedLoading = true;

    try {
      const params = new URLSearchParams({
        offset: String(feedOffset),
        limit: String(FEED_LIMIT),
      });

      // 현재 태그 필터가 있으면 함께 보내기 (?tags=a,b,c)
      if (currentTags.length > 0) {
        params.set('tags', currentTags.join(','));
      }

      const res = await fetch('/api/posts/feed?' + params.toString());
      if (!res.ok) {
        // 첫 로드에서 실패하면 에러 메시지 표시
        if (feedOffset === 0) {
          feedBox.innerHTML =
            '<p class="text-danger">피드를 불러오는 중 오류가 발생했습니다.</p>';
        }
        feedLoading = false;
        return;
      }

      const data = await res.json();

      if (!data.ok) {
        // API 레벨에서 실패한 경우
        if (feedOffset === 0) {
          feedBox.innerHTML = `<p class="text-danger">${
            data.message || '피드를 불러올 수 없습니다.'
          }</p>`;
        }
        feedLoading = false;
        return;
      }

      const posts = data.posts || [];

      // 첫 로드인데 글이 아예 없는 경우
      if (feedOffset === 0 && posts.length === 0) {
        if (currentTags.length > 0) {
          const label = currentTags
            .map((t) => `#${escapeHtml(t)}`)
            .join(', ');
          feedBox.innerHTML = `<p class="text-muted">${label} 태그를 모두 포함하는 글이 아직 없습니다.</p>`;
        } else {
          feedBox.innerHTML =
            '<p class="text-muted">아직 작성된 글이 없습니다.</p>';
        }
        feedDone = true;
        feedLoading = false;
        return;
      }

      // 더 이상 받아올 글이 없는 경우 (이후 스크롤 시 로드를 멈춤)
      if (posts.length === 0) {
        feedDone = true;
        feedLoading = false;
        return;
      }

      // 실제 글 카드 렌더링
      renderFeedPosts(posts);

      // offset 갱신
      feedOffset += posts.length;
      // 한 번에 받은 글 수가 FEED_LIMIT보다 작으면 더 이상 글이 없는 것으로 판단
      if (posts.length < FEED_LIMIT) {
        feedDone = true;
      }
    } catch (e) {
      console.error(e);
      if (feedOffset === 0) {
        feedBox.innerHTML =
          '<p class="text-danger">피드를 불러오는 중 오류가 발생했습니다。</p>';
      }
    } finally {
      // 로딩 상태 해제
      feedLoading = false;
    }
  }

/*
 * 서버에서 받아온 posts 배열을 DOM에 카드 형태로 추가
 * - 각 카드마다 좋아요/해시태그/더보기/상세보기/작가페이지 이동 이벤트 연결
 */
function renderFeedPosts(posts) {
  const feedBox = document.getElementById('feedPosts');
  if (!feedBox || !posts || posts.length === 0) return;

  // posts 배열을 HTML 문자열로 변환
  const fragmentHtml = posts
  .map((post) =>
    buildStandardPostCardHTML(post, {
      showMoreButton: true, // 인덱스 피드에는 더보기 버튼 사용
    })
  )
  .join('');


  // 첫 로드에서 "피드를 불러오는 중..." 문구 제거
  if (!feedBox.dataset.initialized) {
    feedBox.innerHTML = '';
    feedBox.dataset.initialized = '1';
  }

  // 새 카드들을 피드 맨 아래에 추가
  feedBox.insertAdjacentHTML('beforeend', fragmentHtml);

  // 새로 추가된 카드들에 대해 폰트/더보기/좋아요/해시태그/작성자 링크/상세보기 설정
  posts.forEach((post) => {
    const card = feedBox.querySelector(`.card[data-post-id="${post.id}"]`);
    if (!card) return;
    setupCardAuthorLink(card, post);  // 작성자 클릭 → 작가 페이지
    setupCardInteractions(card, post); // 좋아요/더보기/상세보기 등
  });
}


  /**
   * 개별 카드에 대한 인터랙션 세팅
   * - 글귀 폰트 자동 조절
   * - 더보기/접기 버튼
   * - 좋아요 버튼
   * - 해시태그 버튼(AND 필터)
   * - 카드 전체 클릭 시 글 상세 페이지 이동
   */
  function setupCardInteractions(card, post) {
    // 1) 글귀 폰트 자동 조절 (내용 길이에 따라 폰트 크기 조정)
    const quoteCard = card.querySelector('.quote-card');
    if (quoteCard) {
      autoAdjustQuoteFont(quoteCard);
    }

    // 2) 더보기 토글 (내용이 잘리는 경우에만 버튼 표시)
    const contentBox = card.querySelector('.feed-post-content');
    const moreBtn = card.querySelector('.more-toggle');

    if (contentBox && moreBtn) {
      // 내용이 영역 높이를 넘어가는지 체크
      const isOverflowing =
        contentBox.scrollHeight > contentBox.clientHeight + 4;

      if (!isOverflowing) {
        // 넘치지 않으면 더보기 버튼 숨김
        moreBtn.style.display = 'none';
      } else {
        // 넘치면 더보기 버튼 활성화
        moreBtn.style.display = 'inline-block';
        moreBtn.textContent = '더보기...';

        moreBtn.addEventListener('click', (e) => {
          // 카드 전체 클릭으로 버블링되지 않게 막기
          e.stopPropagation();
          // expanded 클래스를 토글해 높이 제한 on/off
          const nowExpanded = contentBox.classList.toggle('expanded');
          moreBtn.textContent = nowExpanded ? '접기' : '더보기...';
        });
      }
    }

    // 3) 좋아요(공감) 버튼
    const likeBtn = card.querySelector('.like-btn');
    if (likeBtn) {
      likeBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // 카드 전체 클릭 이벤트 막기
        handleLikeClick(likeBtn);
      });
    }

    // 4) 해시태그 버튼 클릭 → 태그 필터 추가 (여러 태그 AND 조건)
    const tagButtons = card.querySelectorAll('.hashtag-pill');
    tagButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // 카드 클릭(상세보기) 막기
        const tag = btn.getAttribute('data-tag');
        if (!tag) return;
        applyTagFilter(tag);
      });
    });

    // 5) 카드 전체 클릭 → 글 상세 페이지(트위터 형식)로 이동
    card.addEventListener('click', () => {
      const postId =
        card.getAttribute('data-post-id') || (post && post.id);
      if (!postId) return;

      // 상세 페이지에서 다시 서버를 안 치기 위해,
      // 현재 카드의 post 데이터를 localStorage에 저장
      if (post) {
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
          localStorage.setItem(
            'glsoop_lastPost',
            JSON.stringify(detailData)
          );
        } catch (err) {
          console.error('failed to cache post detail', err);
        }
      }

      // post.html로 이동하면서 ?postId=... 쿼리로 전달
      window.location.href = `/html/post.html?postId=${encodeURIComponent(
        postId
      )}`;
    });
  }

  /**
   * 좋아요(공감) 버튼 클릭 처리
   * - POST /api/posts/:id/toggle-like
   * - 비로그인 시 로그인 페이지로 유도
   * - 성공 시 하트/숫자 갱신 + 작은 애니메이션
   */
  async function handleLikeClick(likeBtn) {
    const postId = likeBtn.getAttribute('data-post-id');
    if (!postId) return;

    try {
      const res = await fetch(`/api/posts/${postId}/toggle-like`, {
        method: 'POST',
      });

      // 401 → 비로그인
      if (res.status === 401) {
        alert('로그인 후 공감할 수 있습니다.');
        window.location.href = '/html/login.html';
        return;
      }

      const data = await res.json();

      if (!res.ok || !data.ok) {
        alert(data.message || '공감 처리 중 오류가 발생했습니다.');
        return;
      }

      // 서버에서 돌려준 liked 상태, 총 likeCount
      const liked = !!data.liked;
      const likeCount =
        typeof data.likeCount === 'number' ? data.likeCount : 0;

      // data-liked 속성 업데이트
      likeBtn.setAttribute('data-liked', liked ? '1' : '0');

      const heartEl = likeBtn.querySelector('.like-heart');
      const countEl = likeBtn.querySelector('.like-count');

      // 하트 모양(♥ / ♡) 갱신
      if (heartEl) {
        heartEl.textContent = liked ? '♥' : '♡';
      }
      // 숫자 갱신
      if (countEl) {
        countEl.textContent = likeCount;
      }

      // liked 상태에 따라 클래스 토글 (색상 등 스타일 적용용)
      likeBtn.classList.toggle('liked', liked);

      // 좋아요 ON일 때만 "톡" 애니메이션
      if (heartEl && liked) {
        // transform 초기화
        heartEl.style.transition = 'transform 0.16s ease-out';
        heartEl.style.transform = 'scale(1)';
        // 강제로 reflow를 발생시켜 애니메이션 리셋
        void heartEl.offsetWidth;
        // 살짝 크게
        heartEl.style.transform = 'scale(1.28)';
        // 다시 원래 크기로
        setTimeout(() => {
          heartEl.style.transform = 'scale(1)';
        }, 160);
      }
    } catch (e) {
      console.error(e);
      alert('공감 처리 중 오류가 발생했습니다.');
    }
  }

  /**
   * 작성자 영역(작은 텍스트)을 클릭하면 작가 페이지로 이동
   * - /html/author.html?userId=...
   */
  function setupCardAuthorLink(card, post) {
    // author_id가 없으면 작가 페이지로 이동할 수 없음
    if (!post || !post.author_id) return;

    // 작성자 정보가 들어 있는 <small class="text-muted"> 요소
    const metaEl = card.querySelector('.card-text small.text-muted');
    if (!metaEl) return;

    // 데이터 속성에 작가 ID 주입
    metaEl.setAttribute('data-author-id', post.author_id);
    metaEl.style.cursor = 'pointer';

    metaEl.addEventListener('click', (e) => {
      // 카드 전체 클릭(상세페이지 이동)과 분리
      e.stopPropagation();
      const authorId = metaEl.getAttribute('data-author-id');
      if (!authorId) return;
      window.location.href = `/html/author.html?userId=${encodeURIComponent(
        authorId
      )}`;
    });
  }

  // ===== 태그 필터 관련 =====

  /**
   * 태그 필터 적용 (여러 태그 AND 조건)
   * - 클릭한 태그를 currentTags에 추가
   * - 피드 상태 리셋 후 처음부터 다시 로드
   */
  function applyTagFilter(tag) {
    if (!tag) return;

    // 이미 있는 태그가 아니면 추가
    if (!currentTags.includes(tag)) {
      currentTags.push(tag);
    }

    // 피드 상태 리셋
    feedOffset = 0;
    feedDone = false;

    const feedBox = document.getElementById('feedPosts');
    if (feedBox) {
      // 첫 로드 플래그 초기화
      feedBox.dataset.initialized = '';
      const label = currentTags.map((t) => `#${escapeHtml(t)}`).join(', ');
      feedBox.innerHTML = `<p class="text-muted">${label} 태그를 포함한 글을 불러오는 중입니다...</p>`;
    }

    // 상단 필터 바 갱신
    renderTagFilterBar();

    // 화면을 맨 위로 올리고 새 글 로딩
    window.scrollTo({ top: 0, behavior: 'smooth' });
    loadMoreFeed();
  }

  /**
   * 태그 필터 바 렌더링
   * - "적용 중인 태그: #힐링 #위로" + "필터 지우기" 버튼
   */
  function renderTagFilterBar() {
    const feedBox = document.getElementById('feedPosts');
    if (!feedBox) return;

    // 이미 존재하는 바를 재사용, 없으면 새로 생성
    let bar = document.getElementById('tagFilterBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'tagFilterBar';
      bar.className = 'd-flex flex-wrap align-items-center gap-2 mb-3';

      // feedBox 바로 위에 삽입
      if (feedBox.parentNode) {
        feedBox.parentNode.insertBefore(bar, feedBox);
      }
    }

    // 적용 중인 태그가 없으면 바 숨기기
    if (!currentTags.length) {
      bar.innerHTML = '';
      bar.style.display = 'none';
      return;
    }

    // 태그가 있으면 바 표시
    bar.style.display = 'flex';

    // 태그 뱃지 HTML
    const tagsHtml = currentTags
      .map(
        (t) =>
          `<span class="badge text-bg-success me-1">#${escapeHtml(t)}</span>`
      )
      .join('');

    // 바 전체 HTML
    bar.innerHTML = `
      <span class="me-1 small text-muted">적용 중인 태그:</span>
      ${tagsHtml}
      <button type="button" class="btn btn-sm btn-outline-secondary ms-2" id="tagFilterClearBtn">
        필터 지우기
      </button>
    `;

    // "필터 지우기" 버튼 이벤트
    const clearBtn = bar.querySelector('#tagFilterClearBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', clearTagFilters);
    }
  }

  /**
   * 태그 필터 전체 해제
   * - currentTags 비우고 피드를 전체 글 모드로 리셋
   */
  function clearTagFilters() {
    currentTags = [];
    feedOffset = 0;
    feedDone = false;

    const feedBox = document.getElementById('feedPosts');
    if (feedBox) {
      feedBox.dataset.initialized = '';
      feedBox.innerHTML =
        '<p class="text-muted">전체 글을 불러오는 중입니다...</p>';
    }

    // 필터 바 갱신(숨기기)
    renderTagFilterBar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    loadMoreFeed();
  }

  // ===== 히어로 CTA 잎사귀 애니메이션 =====

  /**
   * 메인 히어로 "바로 글 쓰러 가기" 버튼 주변에 잎사귀 파티클 애니메이션 추가
   * - 버튼 hover / focus 시 잎사귀 이모지들이 살짝 흩어지며 나타남
   */
  function setupHeroCtaLeaves() {
    const LEAF_COUNT = 10; // 버튼당 잎사귀 개수
    const heroButtons = document.querySelectorAll('.hero-cta-btn');

    heroButtons.forEach((btn) => {
      const leavesContainer = btn.querySelector('.hero-cta-leaves');
      if (!leavesContainer) return;

      // 잎사귀 span 여러 개 생성 (한 번만)
      if (!leavesContainer.dataset.ready) {
        for (let i = 0; i < LEAF_COUNT; i++) {
          const leaf = document.createElement('span');
          leaf.className = 'hero-cta-leaf';
          leaf.textContent = '🌿';
          leavesContainer.appendChild(leaf);
        }
        leavesContainer.dataset.ready = '1';
      }

      const leaves = Array.from(
        leavesContainer.querySelectorAll('.hero-cta-leaf')
      );

      // 실제 애니메이션을 트리거하는 함수
      const triggerLeaves = () => {
        // 기본 위치 집합 (버튼 위쪽 호 모양)
        const BASE_POSITIONS = [
          { x: -70, y: -36 },
          { x: -55, y: -30 },
          { x: -40, y: -26 },
          { x: -25, y: -34 },
          { x: -10, y: -28 },
          { x: 10, y: -32 },
          { x: 25, y: -24 },
          { x: 40, y: -30 },
          { x: 55, y: -26 },
          { x: 70, y: -36 },
        ];

        // 조금씩 랜덤하게 섞어서 똑같은 모양으로만 보이지 않도록 함
        const shuffled = BASE_POSITIONS.slice().sort(() => Math.random() - 0.5);

        leaves.forEach((leaf, idx) => {
          const base = shuffled[idx % shuffled.length];

          // 각 잎사귀마다 약간의 랜덤 오프셋
          const jitterX = Math.random() * 12 - 6; // -6 ~ +6
          const jitterY = Math.random() * 10 - 5; // -5 ~ +5

          const offsetX = base.x + jitterX;
          const offsetY = base.y + jitterY;

          // 스케일, 회전 각도도 랜덤
          const scale = 0.85 + Math.random() * 0.5; // 0.85 ~ 1.35
          const rotate = -35 + Math.random() * 70;  // -35deg ~ 35deg

          // CSS 변수로 위치/스케일/회전 주입 → CSS에서 transform으로 사용
          leaf.style.setProperty('--leaf-tx', `${offsetX}px`);
          leaf.style.setProperty('--leaf-ty', `${offsetY}px`);
          leaf.style.setProperty('--leaf-scale', scale);
          leaf.style.setProperty('--leaf-rot', `${rotate}deg`);

          // 애니메이션 클래스 리셋 후 다시 추가해서 재생
          leaf.classList.remove('leaf-show');
          void leaf.offsetWidth; // reflow로 강제 리셋
          leaf.classList.add('leaf-show');

          // 1초 뒤에 잎사귀 감추기
          setTimeout(() => {
            leaf.classList.remove('leaf-show');
          }, 1000);
        });
      };

      // 마우스를 올리거나 키보드 포커스할 때 잎사귀 발동
      btn.addEventListener('mouseenter', triggerLeaves);
      btn.addEventListener('focus', triggerLeaves);
    });
  }

  // 모듈에서 외부로 내보낼 것
  return {
    init,
  };
})();

// DOMContentLoaded 시점에 모듈 init 호출
document.addEventListener('DOMContentLoaded', () => {
  if (Glsoop && Glsoop.FeedPage && typeof Glsoop.FeedPage.init === 'function') {
    Glsoop.FeedPage.init();
  }
});
