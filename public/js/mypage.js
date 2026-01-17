// public/js/mypage.js
// 마이페이지 화면 스크립트
// - 상단 내 정보 표시
// - 탭(내가 쓴 글 / 공감한 글) 전환
// - 글 카드 렌더링 + 수정/삭제 기능
// - 내 정보 수정 모달(닉네임, 한 줄 소개, 자기소개, 비밀번호 변경)

/**
 * 내가 쓴 글, 공감한 글이 이미 로드되었는지 여부
 * - 탭 전환 시 매번 서버에 요청하지 않기 위한 플래그
 */
let myPostsLoaded = false;
let likedPostsLoaded = false;
let followingsLoaded = false;

// DOM이 완전히 로드되면 마이페이지 초기화
document.addEventListener('DOMContentLoaded', () => {
 setupMyPageTabs();    // 탭 버튼(내가 쓴 글 / 공감한 글) 이벤트 설정
 loadMyPage();       // 내 정보 + 기본 탭(내가 쓴 글) 데이터 로드
 setupUserEditForm();   // 내 정보 수정 모달 폼 처리
 setupMyPostCardEvents(); // 내가 쓴 글 카드에서 수정/삭제 버튼 처리
 setupFollowingListEvents(); // 팔로잉 목록 카드 내 언팔로우 처리
});

/**
 * 마이페이지 전체 초기화
 * - /api/me로 내 정보 불러오기 (로그인 확인도 겸함)
 * - 상단 프로필 박스 렌더링
 * - 모달 기본 값 채우기
 * - 기본 탭(내가 쓴 글) 로딩
 */
async function loadMyPage() {
 const userInfoBox = document.getElementById('userInfo');    // 상단 '내 정보' 영역
 const myPostsBox = document.getElementById('myPosts');     // 내가 쓴 글 리스트 영역
 const likedBox = document.getElementById('likedPosts');    // 공감한 글 리스트 영역

 // 기본 컨테이너가 없으면 스크립트 중단 (레이아웃 깨진 경우 방어)
 if (!userInfoBox || !myPostsBox || !likedBox) {
  console.error('userInfo, myPosts, likedPosts 요소를 찾을 수 없습니다.');
  return;
 }

 try {
  // 1. 내 정보 가져오기 (로그인 확인 겸용)
  const meRes = await fetch('/api/me'); // 로그인 상태 확인 + 사용자 정보

  // HTTP 레벨에서 실패(401, 403 등)인 경우 → 로그인 필요 안내 후 로그인 페이지로 이동
  if (!meRes.ok) {
   userInfoBox.innerHTML =
    '<p class="text-danger">로그인이 필요합니다. 로그인 페이지로 이동합니다.</p>';
   myPostsBox.innerHTML = '';
   likedBox.innerHTML = '';
   setTimeout(() => {
    window.location.href = '/html/login.html';
   }, 1500);
   return;
  }

  const meData = await meRes.json();

  // API 응답에서 ok가 false인 경우도 로그인 실패로 처리
  if (!meData.ok) {
   userInfoBox.innerHTML =
    '<p class="text-danger">로그인이 필요합니다. 로그인 페이지로 이동합니다.</p>';
   myPostsBox.innerHTML = '';
   likedBox.innerHTML = '';
   setTimeout(() => {
    window.location.href = '/html/login.html';
   }, 1500);
   return;
  }

  // 2. 내 정보 출력 + "내 정보 수정" 버튼 (모달 열기)
  // 표시 이름: 닉네임이 있으면 닉네임, 없으면 가입 시 이름 사용
  const displayName =
   meData.nickname && meData.nickname.trim().length > 0
    ? meData.nickname
    : meData.name;

  const followerCount = Number(meData.follower_count) || 0;
  const followingCount = Number(meData.following_count) || 0;

  // 한 줄 소개(bio)가 있는 경우에만 줄 추가
  const bioHtml = meData.bio
   ? `<p class="gls-mb-1 gls-text-muted gls-text-small">한 줄 소개: ${escapeHtml(
     meData.bio
    )}</p>`
   : '';

  // 자기소개(about)가 있는 경우에만 줄 추가
  // - white-space: pre-line; → 줄바꿈(\n)을 실제 줄바꿈으로 보여줌
  const aboutHtml = meData.about
   ? `<p class="gls-mb-0 gls-text-small" style="white-space: pre-line;">${escapeHtml(
     meData.about
    )}</p>`
   : '';

  // 상단 프로필 영역 HTML 구성
  userInfoBox.innerHTML = `
   <div class="gls-flex gls-justify-between gls-items-center gls-flex-wrap gls-gap-2">
    <div>
     <p class="gls-mb-1"><strong>안녕하세요, ${escapeHtml(
      displayName
     )}님!</strong></p>
     <p class="gls-mb-1">이메일: ${escapeHtml(meData.email)}</p>
     ${bioHtml}
     ${aboutHtml}
     <div class="gls-flex gls-gap-3 gls-flex-wrap gls-mt-2 gls-text-small gls-text-muted">
      <span>팔로워 <strong id="mypageFollowerCount">${followerCount}</strong></span>
      <span>팔로잉 <strong id="mypageFollowingCount">${followingCount}</strong></span>
     </div>
    </div>
    <button
     type="button"
     class="gls-btn gls-btn-ghost gls-btn-xs"
     data-gls-toggle="modal"
     data-gls-target="#userEditModal"
    >
     내 정보 수정
    </button>
   </div>
  `;

  const editBtn = userInfoBox.querySelector('[data-gls-target="#userEditModal"]');
  if (editBtn && !editBtn.dataset.glsModalBound) {
   editBtn.dataset.glsModalBound = '1';
   editBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const modalEl = document.getElementById('userEditModal');
    if (!modalEl) return;
    if (window.glsModal) {
     window.glsModal.open(modalEl, editBtn);
    } else {
     modalEl.classList.add('is-open', 'show');
     modalEl.style.display = 'flex';
     modalEl.style.visibility = 'visible';
     modalEl.style.opacity = '1';
    }
   });
  }

  // 2-1. 모달 내 닉네임 / 프로필 기본 값 채우기
  const nicknameInput = document.getElementById('nicknameInput');
  const bioInput = document.getElementById('bioInput');
  const aboutInput = document.getElementById('aboutInput');

  if (nicknameInput) {
   // 기존 닉네임이 있으면 그대로, 없으면 빈 문자열
   nicknameInput.value = meData.nickname || '';
  }
  if (bioInput) {
   bioInput.value = meData.bio || '';
  }
  if (aboutInput) {
   aboutInput.value = meData.about || '';
  }

  await loadGrowthMiniWidget();

  // 기본 탭: "내가 쓴 글" 목록 로드
  await loadMyPosts();
 } catch (e) {
  // /api/me 요청 또는 JSON 파싱 도중 예외 발생 시
  console.error(e);
  userInfoBox.innerHTML =
   '<p class="text-danger">마이페이지를 불러오는 중 오류가 발생했습니다.</p>';

  // 추가로 글 목록/공감한 글 영역에도 오류 메시지 출력
  const myPostsBox2 = document.getElementById('myPosts');
  const likedBox2 = document.getElementById('likedPosts');
  if (myPostsBox2) {
   myPostsBox2.innerHTML =
    '<p class="text-danger">글 목록을 불러오는 중 오류가 발생했습니다.</p>';
  }
  if (likedBox2) {
   likedBox2.innerHTML =
    '<p class="text-danger">공감한 글을 불러오는 중 오류가 발생했습니다.</p>';
  }
 }
}

async function loadGrowthMiniWidget() {
 const widget = document.getElementById('mypageGrowthMini');
 const summaryText = document.querySelector('.mypage-growth-summary-text');
 if (!widget || !summaryText) return;

 try {
  const res = await fetch('/api/growth/summary', { cache: 'no-store' });
  if (!res.ok) throw new Error('growth summary failed');
  const data = await res.json();
  if (!data.ok || !data.summary) throw new Error('growth summary invalid');

  const {
   level = 0,
   today_xp = 0,
   streak_days = 0,
   current_xp = 0,
   next_level_xp = 0,
   title = '성장',
  } = data.summary;
  summaryText.textContent = `Lv.${level} ${title} · ${current_xp} / ${next_level_xp} XP · 오늘 +${today_xp} XP · 연속 ${streak_days}일 글쓰기`;
  widget.classList.remove('gls-hidden');
 } catch (error) {
  console.error(error);
  summaryText.textContent = '성장 정보를 불러오지 못했습니다.';
  widget.classList.remove('gls-hidden');
 }
}

/* ======================
 * 탭 전환 관련
 * ====================== */

/**
 * 마이페이지 상단 탭(내가 쓴 글 / 공감한 글)에 클릭 이벤트 설정
 * - 각 탭을 클릭했을 때 switchMyPageTab으로 섹션 가시성 변경
 * - 아직 로드되지 않은 섹션은 처음 클릭 시 데이터 로딩
 */
function setupMyPageTabs() {
 const tabMy = document.getElementById('tabMyPosts');   // "내가 쓴 글" 탭 버튼
 const tabLiked = document.getElementById('tabLikedPosts'); // "공감한 글" 탭 버튼
 const tabFollowings = document.getElementById('tabFollowings'); // "팔로잉" 탭 버튼
 const tabBookmarks = document.getElementById('tabBookmarks'); // "북마크" 탭 버튼 (bookmarks.html로 이동)

 if (!tabMy || !tabLiked || !tabFollowings) return;

 // "내가 쓴 글" 탭 클릭 시
 tabMy.addEventListener('click', async () => {
  switchMyPageTab('my');  // 탭/섹션 전환
  if (!myPostsLoaded) {
   await loadMyPosts();  // 아직 로드 안 됐으면 서버에서 데이터 가져오기
  }
 });

 // "공감한 글" 탭 클릭 시
 tabLiked.addEventListener('click', async () => {
  switchMyPageTab('liked');
  if (!likedPostsLoaded) {
   await loadLikedPosts(); // 아직 로드 안 됐으면 서버에서 데이터 가져오기
  }
 });

 // "팔로잉" 탭 클릭 시
 tabFollowings.addEventListener('click', async () => {
  switchMyPageTab('followings');
  if (!followingsLoaded) {
   await loadMyFollowings();
  }
 });

 // "북마크" 탭 → 별도 북마크 페이지 이동
 if (tabBookmarks && !tabBookmarks.dataset.bound) {
  tabBookmarks.addEventListener('click', (e) => {
   // 같은 탭 바 레이아웃을 사용하지만, 실제로는 전용 페이지로 이동
   e.preventDefault();
   window.location.href = '/html/bookmarks.html';
  });
  tabBookmarks.dataset.bound = 'true';
 }
}

/**
 * 실제 탭/섹션 전환
 *
 * @param {'my'|'liked'|'followings'} target - 탭/섹션 표시
 */
function switchMyPageTab(target) {
 const tabMy = document.getElementById('tabMyPosts');
 const tabLiked = document.getElementById('tabLikedPosts');
 const tabFollowings = document.getElementById('tabFollowings');
 const tabBookmarks = document.getElementById('tabBookmarks');
 const mySection = document.getElementById('myPostsSection');
 const likedSection = document.getElementById('likedPostsSection');
 const followingsSection = document.getElementById('followingsSection');

 if (!tabMy || !tabLiked || !tabFollowings || !mySection || !likedSection || !followingsSection) return;

 const isMyTab = target === 'my';
 const isLikedTab = target === 'liked';
 const isFollowingsTab = target === 'followings';

 tabMy.classList.toggle('is-active', isMyTab);
 tabLiked.classList.toggle('is-active', isLikedTab);
 tabFollowings.classList.toggle('is-active', isFollowingsTab);
 if (tabBookmarks) {
  tabBookmarks.classList.remove('is-active');
 }

 mySection.classList.toggle('gls-hidden', !isMyTab);
 likedSection.classList.toggle('gls-hidden', !isLikedTab);
 followingsSection.classList.toggle('gls-hidden', !isFollowingsTab);
}

/* ======================
 * 공통 카드 렌더링
 * ====================== */

/**
 * 마이페이지에서 사용하는 공통 글 카드 HTML 생성
 * - 내가 쓴 글 / 공감한 글 둘 다 이 함수를 사용
 * - showActions가 true이면 카드 아래에 수정/삭제 버튼 표시
 *
 * @param {Object} post
 * @param {Object} options
 * @param {boolean} options.showActions - 수정/삭제 버튼 표시 여부
 * @returns {string} HTML 문자열
 */
function renderPostCard(post, options = {}) {
 const { showActions = false } = options;

 // 공통 카드 HTML (내용은 항상 전체 보이게)
 const mainCardHtml = buildStandardPostCardHTML(post, {
  showMoreButton: false,   // 마이페이지에선 더보기 버튼 안 씀
  contentExpanded: true,   // 내용 전체 표시
 });

 // 바깥에 마이페이지 전용 wrapper를 하나 더 두고,
 // 그 안에 공통 카드 + (선택) 수정/삭제 버튼을 넣는다.
 return `
  <div class="mypage-post-card" data-post-id="${post.id}">
   ${mainCardHtml}

   ${
    showActions
     ? `
   <div class="gls-flex gls-justify-end gls-w-100 gls-mt-2 gls-gap-2">
    <button
     type="button"
     class="gls-btn gls-btn-secondary gls-btn-xs edit-post-btn"
    >
     수정
    </button>
    <button
     type="button"
     class="gls-btn gls-btn-danger gls-btn-xs delete-post-btn"
    >
     삭제
    </button>
   </div>
   `
     : ''
   }
  </div>
 `;
}

/**
 * 팔로잉 목록 카드 렌더링
 * @param {Object} user - 팔로잉한 사용자 정보
 * @returns {string}
 */
function renderFollowingCard(user) {
 const displayName = getDisplayName(user);
 const maskedEmail = maskEmail(user.email || '');
 const emailHtml = maskedEmail
  ? `<p class="gls-mb-1 gls-text-muted gls-text-small">${escapeHtml(maskedEmail)}</p>`
  : '';
 const bioHtml = user.bio
  ? `<p class="gls-mb-1 gls-text-muted gls-text-small">${escapeHtml(user.bio)}</p>`
  : '';
 const aboutHtml = user.about
  ? `<p class="gls-mb-1 gls-text-small" style="white-space: pre-line;">${escapeHtml(
    user.about
   )}</p>`
  : '';

 return `
  <div class="card gls-mb-3 mypage-following-card" data-user-id="${user.id}">
   <div class="card-body">
    <div class="gls-flex gls-justify-between gls-items-start gls-gap-3 gls-flex-wrap">
     <div class="flex-fill">
      <h6 class="gls-mb-1">${escapeHtml(displayName)}</h6>
      ${emailHtml}
      ${bioHtml}
      ${aboutHtml}
      <p class="gls-mb-0 gls-text-muted gls-text-small">팔로워 ${user.follower_count || 0}</p>
     </div>
     <div class="gls-flex gls-flex-col gls-gap-2 gls-items-end">
      <a
       class="gls-btn gls-btn-primary gls-btn-xs"
       href="/html/author.html?userId=${encodeURIComponent(user.id)}"
      >
       프로필 보기
      </a>
      <button
       type="button"
       class="gls-btn gls-btn-danger gls-btn-xs unfollow-btn"
       data-user-id="${user.id}"
      >
       언팔로우
      </button>
     </div>
    </div>
   </div>
  </div>
 `;
}

function getDisplayName(user = {}) {
 if (user.nickname && user.nickname.trim().length > 0) {
  return user.nickname;
 }
 return user.name || '';
}

/* ======================
 * 내가 쓴 글 로딩
 * ====================== */

/**
 * "내가 쓴 글" 목록 로딩
 * - GET /api/posts/my 호출
 * - 글이 없으면 안내 문구, 있으면 renderPostCard로 카드 목록 렌더링
 */
async function loadMyPosts() {
 const postsBox = document.getElementById('myPosts');
 if (!postsBox) return;

 // 로딩 중 안내 문구
 postsBox.innerHTML =
  '<p class="gls-text-muted">글 목록을 불러오는 중입니다...</p>';

 try {
  const postsRes = await fetch('/api/posts/my');

  // HTTP 레벨 오류 처리
  if (!postsRes.ok) {
   postsBox.innerHTML =
    '<p class="text-danger">글 목록을 불러오는 중 오류가 발생했습니다.</p>';
   return;
  }

  const postsData = await postsRes.json();

  // API 응답에서 ok가 false인 경우 오류 메시지 표시
  if (!postsData.ok) {
   postsBox.innerHTML = `<p class="text-danger">${
    postsData.message || '글 목록을 불러오지 못했습니다.'
   }</p>`;
   return;
  }

  const posts = postsData.posts || [];

  // 작성한 글이 하나도 없는 경우
  if (!posts.length) {
   postsBox.innerHTML =
    '<p class="gls-text-muted">아직 작성한 글이 없습니다.</p>';
   myPostsLoaded = true;
   return;
  }

  // 글마다 공통 카드 렌더링 (수정/삭제 버튼 있음)
  const listHtml = posts
   .map((post) => renderPostCard(post, { showActions: true }))
   .join('');

   postsBox.innerHTML = listHtml;
   myPostsLoaded = true; // 이후에는 다시 로드하지 않도록 플래그 설정
 
   // ✅ 공통 카드 기능(폰트 조절 등) + 카드 클릭 → 상세 페이지 이동
   posts.forEach((post) => {
    const wrapper = postsBox.querySelector(
     `.mypage-post-card[data-post-id="${post.id}"]`
    );
    if (!wrapper) return;
 
    const card = wrapper.querySelector('.gls-post-card');
    if (card && typeof enhanceStandardPostCard === 'function') {
     // autoAdjustQuoteFont 등 공통 처리
     enhanceStandardPostCard(card, post);
    }
 
    // 카드 전체 클릭 → 상세 페이지로 이동
    wrapper.style.cursor = 'pointer';
    wrapper.addEventListener('click', (e) => {
     // 수정/삭제 버튼 클릭은 상세 페이지로 안 가게 예외 처리
     if (e.target.closest('.edit-post-btn') || e.target.closest('.delete-post-btn')) {
      return;
     }
     window.location.href = `/html/post.html?postId=${encodeURIComponent(
      post.id
     )}`;
    });
   });
 } catch (err) {
  console.error(err);
  postsBox.innerHTML =
   '<p class="text-danger">글 목록을 불러오는 중 오류가 발생했습니다.</p>';
 }
}

/* ======================
 * 내가 공감한 글 로딩
 * ====================== */

/**
 * "공감한 글" 목록 로딩
 * - GET /api/posts/liked 호출
 * - 글이 없으면 안내 문구, 있으면 renderPostCard로 카드 목록 렌더링
 */
async function loadLikedPosts() {
 const likedBox = document.getElementById('likedPosts');
 if (!likedBox) return;

 // 로딩 중 안내 문구
 likedBox.innerHTML =
  '<p class="gls-text-muted">공감한 글을 불러오는 중입니다...</p>';

 try {
  const likedRes = await fetch('/api/posts/liked');

  // HTTP 레벨 오류
  if (!likedRes.ok) {
   likedBox.innerHTML =
    '<p class="text-danger">공감한 글을 불러오는 중 오류가 발생했습니다.</p>';
   return;
  }

  const likedData = await likedRes.json();

  // API 레벨 오류
  if (!likedData.ok) {
   likedBox.innerHTML = `<p class="text-danger">${
    likedData.message || '공감한 글을 불러오지 못했습니다.'
   }</p>`;
   return;
  }

  const likedPosts = likedData.posts || [];

  // 공감한 글이 하나도 없는 경우
  if (!likedPosts.length) {
   likedBox.innerHTML =
    '<p class="gls-text-muted">아직 공감한 글이 없습니다.</p>';
   likedPostsLoaded = true;
   return;
  }

  // 공감한 글은 읽기 전용이므로 showActions: false (수정/삭제 버튼 X)
  const likedHtml = likedPosts
   .map((post) => renderPostCard(post, { showActions: false }))
   .join('');

   likedBox.innerHTML = likedHtml;
   likedPostsLoaded = true;
 
   // ✅ 공통 카드 기능 + 카드 클릭 → 상세 페이지 이동
   likedPosts.forEach((post) => {
    const wrapper = likedBox.querySelector(
     `.mypage-post-card[data-post-id="${post.id}"]`
    );
    if (!wrapper) return;
 
    const card = wrapper.querySelector('.gls-post-card');
    if (card && typeof enhanceStandardPostCard === 'function') {
     enhanceStandardPostCard(card, post);
    }
 
    wrapper.style.cursor = 'pointer';
    wrapper.addEventListener('click', (e) => {
     // (여긴 수정/삭제 버튼이 없으니까 바로 이동)
     window.location.href = `/html/post.html?postId=${encodeURIComponent(
      post.id
     )}`;
    });
   });

 } catch (err) {
  console.error(err);
  likedBox.innerHTML =
   '<p class="text-danger">공감한 글을 불러오는 중 오류가 발생했습니다.</p>';
 }
}

/* ======================
 * 내가 팔로잉하는 사람들 로딩
 * ====================== */

/**
 * "팔로잉" 목록 로딩
 * - GET /api/me/followings 호출
 * - 목록이 없으면 안내 문구, 있으면 카드 렌더링
 */
async function loadMyFollowings() {
 const followingsBox = document.getElementById('followingsList');
 if (!followingsBox) return;

 followingsBox.innerHTML =
  '<p class="gls-text-muted">팔로잉 목록을 불러오는 중입니다...</p>';

 try {
  const res = await fetch('/api/me/followings');

  if (!res.ok) {
   followingsBox.innerHTML =
    '<p class="text-danger">팔로잉 목록을 불러오는 중 오류가 발생했습니다.</p>';
   return;
  }

  const data = await res.json();
  if (!data.ok) {
   followingsBox.innerHTML = `<p class="text-danger">${
    data.message || '팔로잉 목록을 불러오지 못했습니다.'
   }</p>`;
   return;
  }

  const followings = data.followings || [];
  if (!followings.length) {
   followingsBox.innerHTML =
    '<p class="gls-text-muted">아직 팔로잉한 사람이 없습니다.</p>';
   followingsLoaded = true;
   return;
  }

  const cardsHtml = followings
   .map((user) => renderFollowingCard(user))
   .join('');

  followingsBox.innerHTML = cardsHtml;
  followingsLoaded = true;
 } catch (err) {
  console.error(err);
  followingsBox.innerHTML =
   '<p class="text-danger">팔로잉 목록을 불러오는 중 오류가 발생했습니다.</p>';
 }
}

/* ======================
 * 팔로잉 카드 이벤트 (언팔로우)
 * ====================== */

function setupFollowingListEvents() {
 const followingsBox = document.getElementById('followingsList');
 if (!followingsBox) return;

 followingsBox.addEventListener('click', async (e) => {
  const target = e.target;
  if (!target.classList.contains('unfollow-btn')) return;

  const userId = target.getAttribute('data-user-id');
  if (!userId) return;

  if (!confirm('이 사용자를 언팔로우하시겠어요?')) {
   return;
  }

  const originalText = target.textContent;
  target.disabled = true;
  target.textContent = '처리 중...';

  try {
   const res = await fetch(`/api/users/${userId}/follow`, { method: 'POST' });
   const data = await res.json().catch(() => ({}));

   if (!res.ok || !data.ok) {
    alert(data.message || '언팔로우 중 오류가 발생했습니다.');
    target.disabled = false;
    target.textContent = originalText;
    return;
   }

   const stillFollowing = !!data.following;
   const followingCountEl = document.getElementById('mypageFollowingCount');

   if (!stillFollowing) {
    // 팔로우가 해제된 경우 카드 제거
    const card = target.closest('.mypage-following-card');
    if (card) {
     card.remove();
    }

    // 상단 팔로잉 카운트 갱신
    if (followingCountEl) {
     const current = Number(followingCountEl.textContent) || 0;
     followingCountEl.textContent = Math.max(current - 1, 0);
    }

    // 카드가 모두 사라졌다면 안내 문구 노출
    if (!followingsBox.querySelector('.mypage-following-card')) {
     followingsBox.innerHTML =
      '<p class="gls-text-muted">아직 팔로잉한 사람이 없습니다.</p>';
    }
   } else {
    // 여전히 팔로잉 상태라면 버튼만 복원
    target.disabled = false;
    target.textContent = originalText;
   }
  } catch (err) {
   console.error(err);
   alert('언팔로우 처리 중 오류가 발생했습니다.');
   target.disabled = false;
   target.textContent = originalText;
  }
 });
}

/* ======================
 * 수정/삭제 버튼 이벤트
 * ====================== */

/**
 * "내가 쓴 글" 카드 영역에 이벤트 위임 설정
 * - 카드 내부의 수정/삭제 버튼 클릭을 한 곳에서 처리
 */
function setupMyPostCardEvents() {
 const postsBox = document.getElementById('myPosts');
 if (!postsBox) return;

 // myPosts 영역에 클릭 이벤트 리스너를 한 번만 등록
 postsBox.addEventListener('click', async (e) => {
  const target = e.target;
  // 클릭된 요소에서 가장 가까운 .mypage-post-card(부모 카드) 찾기
  const card = target.closest('.mypage-post-card');
  if (!card) return;

  const postId = card.getAttribute('data-post-id');
  if (!postId) return;

  // ===== 삭제 버튼 처리 =====
  if (target.classList.contains('delete-post-btn')) {
   const ok = confirm('정말 이 글을 삭제하시겠습니까?');
   if (!ok) return;

   try {
    // DELETE /api/posts/:id 요청
    const delRes = await fetch(`/api/posts/${postId}`, {
     method: 'DELETE',
    });
    const delData = await delRes.json();

    // HTTP 또는 응답 ok가 false이면 실패
    if (!delRes.ok || !delData.ok) {
     alert(delData.message || '글 삭제에 실패했습니다.');
     return;
    }

    // DOM에서 해당 카드 제거
    card.remove();

    // 더 이상 카드가 없으면 "아직 작성한 글이 없습니다" 문구 출력
    if (!postsBox.querySelector('.mypage-post-card')) {
     postsBox.innerHTML =
      '<p class="gls-text-muted">아직 작성한 글이 없습니다.</p>';
    }
   } catch (err) {
    console.error(err);
    alert('글 삭제 중 오류가 발생했습니다.');
   }
  }

  // ===== 수정 버튼 처리 → 에디터 페이지로 이동 =====
  if (target.classList.contains('edit-post-btn')) {
   // 글쓰기 페이지(editor.html)에 postId 쿼리로 넘김
   // - 에디터 쪽에서 ?postId=...를 보고 수정 모드로 동작
   window.location.href = `/html/editor.html?postId=${postId}`;
  }
 });
}

/* ======================
 * 내 정보 수정 폼
 * ====================== */

/**
 * 내 정보 수정 모달 폼 처리
 * - 닉네임 / 한 줄 소개 / 자기소개 / 비밀번호 변경
 * - 비밀번호 변경 시 간단한 클라이언트 검증
 * - PUT /api/me 호출 후 성공 시 프로필 갱신 + 모달 닫기
 */
function setupUserEditForm() {
 const form = document.getElementById('userEditForm');

 // 각 입력 필드
 const nicknameInput = document.getElementById('nicknameInput');
 const bioInput = document.getElementById('bioInput');
 const aboutInput = document.getElementById('aboutInput');
 const currentPwInput = document.getElementById('currentPwInput');
 const newPwInput = document.getElementById('newPwInput');
 const newPwConfirmInput = document.getElementById('newPwConfirmInput');

 // 결과/에러 메시지 출력용 span
 const messageSpan = document.getElementById('userEditMessage');

 // 폼이 없는 경우(레이아웃 변경 등)에는 아무 것도 하지 않음
 if (!form) {
  return;
 }

 // 폼 제출(submit) 이벤트 처리
 form.addEventListener('submit', async (e) => {
  e.preventDefault(); // 기본 폼 제출(페이지 새로고침) 막기

  // 각 값을 읽어서 트리밍
  const nickname = nicknameInput ? nicknameInput.value.trim() : '';
  const bio = bioInput ? bioInput.value.trim() : '';
  const about = aboutInput ? aboutInput.value : '';
  const currentPw = currentPwInput ? currentPwInput.value : '';
  const newPw = newPwInput ? newPwInput.value : '';
  const newPwConfirm = newPwConfirmInput ? newPwConfirmInput.value : '';

  // 메시지 영역 초기화
  if (messageSpan) {
   messageSpan.classList.remove('text-danger', 'text-success');
   messageSpan.textContent = '';
  }

  // ===== 비밀번호 변경 관련 기본 검증 =====
  // newPw 또는 newPwConfirm 중 하나라도 입력되어 있으면 "비밀번호 변경" 의도가 있다고 보고 검증
  if (newPw || newPwConfirm) {
   // 둘 중 하나만 입력된 경우
   if (!newPw || !newPwConfirm) {
    if (messageSpan) {
     messageSpan.classList.add('text-danger');
     messageSpan.textContent = '새 비밀번호와 확인을 모두 입력해주세요.';
    }
    return;
   }

   // 새 비밀번호와 확인이 일치하지 않을 때
   if (newPw !== newPwConfirm) {
    if (messageSpan) {
     messageSpan.classList.add('text-danger');
     messageSpan.textContent = '새 비밀번호가 서로 일치하지 않습니다.';
    }
    return;
   }

   // 현재 비밀번호를 입력하지 않은 경우
   if (!currentPw) {
    if (messageSpan) {
     messageSpan.classList.add('text-danger');
     messageSpan.textContent =
      '비밀번호를 변경하려면 현재 비밀번호를 입력해주세요.';
    }
    return;
   }

   // 새 비밀번호 길이 제한 (간단 검증)
   if (newPw.length < 6) {
    if (messageSpan) {
     messageSpan.classList.add('text-danger');
     messageSpan.textContent =
      '비밀번호는 최소 6자 이상이 좋습니다.';
    }
    return;
   }
  }

  // ===== 변경할 내용이 하나도 없는 경우 막기 =====
  // 닉네임, 한 줄 소개, 자기소개, 새 비밀번호 중 아무 것도 입력되지 않았으면 제출 X
  if (!nickname && !bio && !about && !newPw) {
   if (messageSpan) {
    messageSpan.classList.add('text-danger');
    messageSpan.textContent = '변경할 내용을 입력해주세요.';
   }
   return;
  }

  try {
   // /api/me에 PUT으로 수정 요청
   const res = await fetch('/api/me', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
     nickname: nickname || null, // 닉네임을 비우면 null로 보내서 서버에서 이름 사용
     currentPw: currentPw || null,
     newPw: newPw || null,
     bio: bio,
     about: about,
    }),
   });

   // 응답 JSON 파싱 (실패하면 {}로 대체)
   const data = await res.json().catch(() => ({}));

   // HTTP 또는 data.ok 실패 시 에러 메시지 출력
   if (!res.ok || !data.ok) {
    if (messageSpan) {
     messageSpan.classList.add('text-danger');
     messageSpan.textContent =
      (data && data.message) || '정보 수정에 실패했습니다.';
    }
    return;
   }

   // 성공 메시지 출력
   if (messageSpan) {
    messageSpan.classList.add('text-success');
    messageSpan.textContent =
     data.message || '내 정보가 수정되었습니다.';
   }

   // 비밀번호 입력칸은 항상 비워주기 (보안/UX)
   if (currentPwInput) currentPwInput.value = '';
   if (newPwInput) newPwInput.value = '';
   if (newPwConfirmInput) newPwConfirmInput.value = '';

   // ✅ 모달 닫기 (GLS Modal)
   const modalEl = document.getElementById('userEditModal');
   if (modalEl && window.glsModal) window.glsModal.close(modalEl);

   // 상단 프로필 영역도 바로 갱신 (새 닉네임/소개 반영)
   await loadMyPage();
  } catch (err) {
   console.error(err);
   if (messageSpan) {
    messageSpan.classList.add('text-danger');
    messageSpan.textContent =
     '정보 수정 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
   }
  }
 });
}
