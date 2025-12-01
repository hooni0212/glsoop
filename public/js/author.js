// === 작가 글 목록 무한 스크롤 상태 ===
// 한 작가(유저)의 글을 모아서 보여주는 페이지에서 사용할 상태값들

const AUTHOR_LIMIT = 10;      // 한 번에 가져올 글 개수(페이지 크기)
let authorOffset = 0;         // 지금까지 불러온 글 개수(다음 요청 offset)
let authorLoading = false;    // 현재 글을 로딩 중인지 여부(중복 요청 방지)
let authorDone = false;       // 더 이상 불러올 글이 없는지 여부
let currentAuthorId = null;   // 현재 작가(유저)의 ID

// 페이지가 완전히 로드되면 작가 페이지 초기화 + 프로필 카드 스티키 처리 설정
document.addEventListener('DOMContentLoaded', () => {
  initAuthorPage();
  setupAuthorProfileSticky();
});

/**
 * 작가 페이지 초기화
 * - URL의 ?userId= 값을 읽어서 현재 작가를 결정
 * - 작가 프로필 로드
 * - 작가 글 목록 첫 페이지 로드
 * - 스크롤 이벤트 등록(무한 스크롤)
 */
async function initAuthorPage() {
  const params = new URLSearchParams(window.location.search);
  const userId = params.get('userId');

  // userId 없이 접근하면 잘못된 진입으로 간주
  if (!userId) {
    alert('잘못된 접근입니다. 작가 정보를 찾을 수 없어요.');
    window.location.href = '/index.html';
    return;
  }

  currentAuthorId = userId;

  // 1) 프로필 먼저 로드
  await loadAuthorProfile(userId);

  // 2) 글 목록 첫 페이지 로드
  await loadMoreAuthorPosts();

  // 3) 스크롤로 추가 로드(무한 스크롤)
  window.addEventListener('scroll', handleAuthorScroll);
}

/**
 * === 작가 프로필 불러오기 ===
 * - GET /api/users/:authorId/profile
 * - 닉네임, 이메일(마스킹), bio, about, 통계 등을 페이지에 채움
 */
async function loadAuthorProfile(authorId) {
  try {
    const res = await fetch(`/api/users/${authorId}/profile`);
    const data = await res.json();

    if (!res.ok || !data.ok) {
      alert(data.message || '작가 정보를 불러오는 중 오류가 발생했습니다.');
      return;
    }

    const user = data.user;

    // 닉네임이 있으면 사용, 없으면 "익명"
    const nickname = (user.nickname && user.nickname.trim()) || '익명';
    // 이메일은 utils.js의 maskEmail로 일부만 보여주기
    const emailMasked = maskEmail(user.email || '');
    const bio = (user.bio || '').trim();     // 한 줄 소개
    const about = (user.about || '').trim(); // 여러 줄 자기소개

    // 상단 타이틀 (ex: "홍길동님의 나무")
    const titleEl = document.getElementById('authorPageTitle');
    if (titleEl) {
      titleEl.textContent = `${nickname}님의 나무`;
    }

    // 왼쪽 프로필 카드의 닉네임 표시
    const nickEl = document.getElementById('authorNicknameDisplay');
    if (nickEl) {
      nickEl.textContent = nickname;
    }

    // 이메일 (마스킹된 값)
    const emailEl = document.getElementById('authorEmailDisplay');
    if (emailEl) {
      emailEl.textContent = emailMasked
        ? `이메일: ${emailMasked}`
        : '이메일: -';
    }

    // 🔽 프로필 문구: 한 줄 소개
    const bioEl = document.getElementById('authorBio');
    if (bioEl) {
      if (bio) {
        bioEl.textContent = `한 줄 소개: ${bio}`;
      } else {
        bioEl.textContent = '아직 한 줄 소개가 등록되지 않았습니다.';
      }
    }

    // 🔽 프로필 문구: 자기소개 (여러 줄, CSS에서 white-space: pre-line 예정)
    const aboutEl = document.getElementById('authorAbout');
    if (aboutEl) {
      if (about) {
        aboutEl.textContent = about; // 줄바꿈 유지 ⇒ CSS에서 pre-line이면 됨
        aboutEl.style.display = 'block';
      } else {
        aboutEl.textContent = '';
        aboutEl.style.display = 'none';
      }
    }

    // 통계 정보: 글 수, 총 좋아요 수
    const postCountEl = document.getElementById('authorPostCount');
    const likeCountEl = document.getElementById('authorLikeCount');

    if (postCountEl) postCountEl.textContent = user.postCount || 0;
    if (likeCountEl) likeCountEl.textContent = user.totalLikes || 0;
  } catch (e) {
    console.error(e);
    alert('작가 정보를 불러오는 중 오류가 발생했습니다.');
  }
}

/**
 * === 스크롤로 다음 글 로드 ===
 * - 화면 맨 아래에서 200px 근처에 도달하면 loadMoreAuthorPosts 실행
 * - authorLoading / authorDone 플래그로 중복요청, 불필요요청 방지
 */
function handleAuthorScroll() {
  if (authorLoading || authorDone) return;

  const scrollTop =
    window.pageYOffset ||
    document.documentElement.scrollTop ||
    document.body.scrollTop ||
    0;
  const clientHeight =
    document.documentElement.clientHeight || window.innerHeight;
  const scrollHeight =
    document.documentElement.scrollHeight || document.body.scrollHeight;

  // 스크롤이 거의 맨 아래까지 내려왔을 때
  if (scrollTop + clientHeight >= scrollHeight - 200) {
    loadMoreAuthorPosts();
  }
}

/**
 * === 작가 글 목록 추가 로드 ===
 * - GET /api/users/:userId/posts?offset=&limit=
 * - 첫 로드에서 글이 없으면 "아직 글이 없습니다" 메시지 표시
 * - 이후 더 이상 글이 없으면 authorDone = true + "끝" 메시지 노출
 */
async function loadMoreAuthorPosts() {
  if (!currentAuthorId) return;

  const listBox = document.getElementById('authorPostsList');   // 글 카드들이 들어갈 영역
  const loadingEl = document.getElementById('authorPostsLoading'); // "불러오는 중..." 표시
  const emptyEl = document.getElementById('authorPostsEmpty');     // "아직 글이 없습니다" 표시
  const endEl = document.getElementById('authorPostsEnd');         // "마지막 글입니다" 표시

  if (!listBox) return;
  if (authorLoading || authorDone) return; // 이미 로딩 중이거나 끝났으면 종료

  authorLoading = true;
  if (loadingEl) loadingEl.style.display = 'block';

  try {
    const params = new URLSearchParams({
      offset: String(authorOffset),
      limit: String(AUTHOR_LIMIT),
    });

    const res = await fetch(
      `/api/users/${currentAuthorId}/posts?` + params.toString()
    );
    const data = await res.json();

    if (!res.ok || !data.ok) {
      alert(data.message || '작가 글을 불러오는 중 오류가 발생했습니다.');
      return;
    }

    const posts = data.posts || [];

    // 첫 로드인데 글이 아예 없는 경우
    if (authorOffset === 0 && posts.length === 0) {
      if (emptyEl) emptyEl.style.display = 'block';
      authorDone = true;
      return;
    }

    // 더 이상 가져올 글이 없는 경우
    if (posts.length === 0) {
      authorDone = true;
      if (endEl) endEl.style.display = 'block';
      return;
    }

    // 실제 카드 렌더링
    renderAuthorPosts(posts);

    // offset 업데이트
    authorOffset += posts.length;

    // 이번에 가져온 개수가 limit보다 적으면 → 이 페이지가 마지막
    if (posts.length < AUTHOR_LIMIT) {
      authorDone = true;
      if (endEl) endEl.style.display = 'block';
    }
  } catch (e) {
    console.error(e);
    alert('작가 글을 불러오는 중 오류가 발생했습니다.');
  } finally {
    authorLoading = false;
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

/**
 * === 작가 글 카드 렌더링 ===
 * - posts 배열을 받아서 카드 HTML을 만들어 authorPostsList에 추가
 * - 각 카드에 좋아요/해시태그/폰트 조절 등 인터랙션 세팅
 */
function renderAuthorPosts(posts) {
  const listBox = document.getElementById('authorPostsList');
  if (!listBox || !posts || posts.length === 0) return;

  const fragmentHtml = posts
    .map((post) => {
      // 작성일 포맷 (utils.js의 formatKoreanDateTime 사용)
      const dateStr = post.created_at
        ? formatKoreanDateTime(post.created_at)
        : '';

      // 좋아요 개수
      const likeCount =
        typeof post.like_count === 'number' ? post.like_count : 0;

      // 현재 로그인 유저가 공감한 상태인지 여부
      const liked =
        post.user_liked === 1 || post.user_liked === true ? true : false;

      // 해시태그 버튼 HTML (아래 buildHashtagHtml)
      const hashtagHtml = buildHashtagHtml(post);

      // 폰트 메타 파싱 (<!--FONT:...--> 같은 것 파싱)
      const { cleanHtml, fontKey } = extractFontFromContent(post.content);
      const quoteFontClass =
        fontKey === 'serif' || fontKey === 'sans' || fontKey === 'hand'
          ? `quote-font-${fontKey}`
          : '';

      // 카드 전체 HTML
      return `
        <div class="card author-post-card" data-post-id="${post.id}">
          <div class="card-body">
            <h6 class="author-post-title mb-1">${escapeHtml(
              post.title
            )}</h6>
            <div class="author-post-meta text-muted mb-1">
              <small>${dateStr}</small>
            </div>

            <div class="author-post-extra d-flex align-items-center mb-2">
              <!-- 공감 버튼 (index.js와 구조 맞춤) -->
              <button
                class="like-btn ${liked ? 'liked' : ''}"
                type="button"
                data-post-id="${post.id}"
                data-liked="${liked ? '1' : '0'}"
              >
                <span class="like-heart">${liked ? '♥' : '♡'}</span>
                <span class="like-count ms-1">${likeCount}</span>
              </button>
              <div class="ms-2">
                ${hashtagHtml}
              </div>
            </div>

            <!-- 글 내용 인스타 감성 카드 -->
            <div class="post-content mt-2 text-end">
              <div class="feed-post-content">
                <div class="quote-card ${quoteFontClass}">
                  ${cleanHtml}
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  // DOM에 추가
  listBox.insertAdjacentHTML('beforeend', fragmentHtml);

  // 새 카드들에 인터랙션 세팅
  posts.forEach((post) => {
    const card = listBox.querySelector(
      `.author-post-card[data-post-id="${post.id}"]`
    );
    if (!card) return;
    setupAuthorPostInteractions(card);
  });
}

/**
 * === 개별 작가 글 카드 인터랙션 ===
 * - 글귀 폰트 자동조절(autoAdjustQuoteFont)
 * - 좋아요 토글 처리
 * - 해시태그 버튼 클릭 시 태그로 필터된 홈 피드로 이동
 */
function setupAuthorPostInteractions(card) {
  // 글귀 폰트 자동 조절 (글 길이에 따라 폰트 크기 조정)
  const quoteCard = card.querySelector('.quote-card');
  if (quoteCard) {
    autoAdjustQuoteFont(quoteCard);
  }

  // 좋아요 버튼
  const likeBtn = card.querySelector('.like-btn');
  if (likeBtn) {
    likeBtn.addEventListener('click', async () => {
      const postId = likeBtn.getAttribute('data-post-id');
      if (!postId) return;

      try {
        const res = await fetch(`/api/posts/${postId}/toggle-like`, {
          method: 'POST',
        });

        // 로그인 안 되어 있으면 로그인 페이지로
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

        const liked = !!data.liked;
        const likeCount =
          typeof data.likeCount === 'number' ? data.likeCount : 0;

        // data-liked 속성 업데이트
        likeBtn.setAttribute('data-liked', liked ? '1' : '0');

        const heartEl = likeBtn.querySelector('.like-heart');
        const countEl = likeBtn.querySelector('.like-count');

        // 하트 모양, 숫자 갱신
        if (heartEl) {
          heartEl.textContent = liked ? '♥' : '♡';
        }
        if (countEl) {
          countEl.textContent = likeCount;
        }

        // liked 클래스 토글
        likeBtn.classList.toggle('liked', liked);

        // 좋아요 애니메이션 (ON일 때만)
        if (heartEl && liked) {
          heartEl.style.transition = 'transform 0.16s ease-out';
          heartEl.style.transform = 'scale(1)';
          // reflow를 강제로 일으켜 애니메이션 초기화
          void heartEl.offsetWidth;
          heartEl.style.transform = 'scale(1.28)';
          setTimeout(() => {
            heartEl.style.transform = 'scale(1)';
          }, 160);
        }
      } catch (e) {
        console.error(e);
        alert('공감 처리 중 오류가 발생했습니다.');
      }
    });
  }

  // 해시태그 클릭 시 홈 피드로 이동해서 해당 태그로 필터 적용
  const tagButtons = card.querySelectorAll('.hashtag-pill');
  tagButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tag = btn.getAttribute('data-tag');
      if (!tag) return;
      // index.html?tag=태그 형식으로 이동
      window.location.href = `/index.html?tag=${encodeURIComponent(tag)}`;
    });
  });
}

/* ===== 해시태그 → 버튼 HTML =====
 * post.hashtags 문자열을 받아서
 * Bootstrap outline 버튼들로 변환
 */
function buildHashtagHtml(post) {
  if (!post.hashtags) return '';

  const tags = String(post.hashtags)
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (!tags.length) return '';

  const pills = tags
    .map(
      (t) =>
        `<button type="button"
                  class="btn btn-sm btn-outline-success me-1 mb-1 hashtag-pill"
                  data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</button>`
    )
    .join('');

  return `<div class="mt-1 text-start">${pills}</div>`;
}

/**
 * === 작가 프로필 카드가 스크롤을 따라오게 만들기 ===
 * - 데스크탑(가로폭 >= 992px)에서만 적용
 * - 왼쪽 프로필 카드(.author-profile-card)를 스크롤에 맞춰 고정
 * - 상단 네비게이션 높이(NAV_OFFSET)만큼 띄워서 자연스럽게 따라오도록
 */
function setupAuthorProfileSticky() {
  const profileCard = document.querySelector('.author-profile-card');
  if (!profileCard) return;

  // 최초 위치 / 크기 저장용 변수
  let baseTop = 0;
  let baseLeft = 0;
  let baseWidth = 0;

  // 카드의 원래 위치/크기를 계산해서 저장
  function captureBaseRect() {
    const rect = profileCard.getBoundingClientRect();
    baseTop =
      rect.top +
      (window.pageYOffset ||
        document.documentElement.scrollTop ||
        0);
    baseLeft =
      rect.left +
      (window.pageXOffset ||
        document.documentElement.scrollLeft ||
        0);
    baseWidth = rect.width;
  }

  // profileCard를 원래 상태로 되돌리기
  function resetProfileCardStyle() {
    profileCard.style.position = '';
    profileCard.style.top = '';
    profileCard.style.left = '';
    profileCard.style.width = '';
  }

  // 스크롤 시 호출되는 함수
  function handleStickyScroll() {
    const viewportWidth =
      window.innerWidth || document.documentElement.clientWidth || 0;

    // 모바일 / 태블릿(폭 < 992px)에서는 따라다니지 않게 (원래 레이아웃 유지)
    if (viewportWidth < 992) {
      resetProfileCardStyle();
      return;
    }

    const scrollY =
      window.pageYOffset ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      0;

    // 네비게이션 높이 + 살짝 여백 (카드 상단 위치)
    const NAV_OFFSET = 140;

    // 아직 기본 크기/위치를 못 잡았으면 한 번 계산
    if (!baseWidth) {
      captureBaseRect();
    }

    // 스크롤이 카드의 원래 위치를 지나쳤을 때 → 화면에 고정
    if (scrollY + NAV_OFFSET > baseTop) {
      profileCard.style.position = 'fixed';
      profileCard.style.top = NAV_OFFSET + 'px';
      profileCard.style.left = baseLeft + 'px';
      profileCard.style.width = baseWidth + 'px';
    } else {
      // 아직 원래 위치 위쪽이면 고정 해제
      resetProfileCardStyle();
    }
  }

  // 초기 기준값 계산
  captureBaseRect();

  // 스크롤 시마다 스티키 처리
  window.addEventListener('scroll', handleStickyScroll);

  // 창 크기 변경 시, 기준 다시 계산
  window.addEventListener('resize', () => {
    resetProfileCardStyle();
    captureBaseRect();
    handleStickyScroll();
  });

  // 최초 한 번 실행해서 초기 상태 맞추기
  handleStickyScroll();
}
