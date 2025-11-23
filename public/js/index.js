// public/js/index.js

document.addEventListener('DOMContentLoaded', () => {
  loadFeed();
});

// 글귀 피드 불러오기
async function loadFeed() {
  const feedBox = document.getElementById('feedPosts');
  if (!feedBox) {
    console.error('feedPosts 요소를 찾을 수 없습니다.');
    return;
  }

  try {
    const res = await fetch('/api/posts/feed');

    if (!res.ok) {
      feedBox.innerHTML =
        '<p class="text-danger">피드를 불러오는 중 오류가 발생했습니다.</p>';
      return;
    }

    const data = await res.json();

    if (!data.ok) {
      feedBox.innerHTML = `<p class="text-danger">${
        data.message || '피드를 불러올 수 없습니다.'
      }</p>`;
      return;
    }

    const posts = data.posts;

    if (!posts || posts.length === 0) {
      feedBox.innerHTML =
        '<p class="text-muted">아직 작성된 글이 없습니다.</p>';
      return;
    }

    const listHtml = posts
      .map((post) => {
        const dateStr = post.created_at
          ? String(post.created_at).replace('T', ' ').slice(0, 16)
          : '';

        // 닉네임 + (마스킹 이메일) 표시
        const nickname =
          post.author_nickname && post.author_nickname.trim().length > 0
            ? post.author_nickname.trim()
            : '';

        const baseName =
          nickname ||
          (post.author_name && post.author_name.trim().length > 0
            ? post.author_name.trim()
            : '익명');

        // 이메일 마스킹
        const maskedEmail = maskEmail(post.author_email);

        // 최종 표시: 닉네임 (마스킹된이메일) 형식
        const author = maskedEmail ? `${baseName} (${maskedEmail})` : baseName;

        const likeCount =
          typeof post.like_count === 'number' ? post.like_count : 0;
        const liked =
          post.user_liked === 1 || post.user_liked === true ? true : false;

        return `
          <div class="card mb-3" data-post-id="${post.id}">
            <div class="card-body">
              <h5 class="card-title mb-1">${escapeHtml(post.title)}</h5>
              <p class="card-text mb-1">
                <small class="text-muted">
                  ${escapeHtml(author)} · ${dateStr}
                </small>
              </p>

              <!-- 공감(하트) 버튼 -->
              <div class="mb-1">
                <button
                  class="like-btn ${liked ? 'liked' : ''}"
                  type="button"
                  data-post-id="${post.id}"
                  data-liked="${liked ? '1' : '0'}"
                >
                  <span class="like-heart">${liked ? '♥' : '♡'}</span>
                  <span class="like-count ms-1">${likeCount}</span>
                </button>
              </div>

              <div class="post-content mt-2 text-end">
                <div class="feed-post-content">
                  <!-- 인스타 감성 글귀 카드 -->
                  <div class="quote-card">
                    ${post.content}
                  </div>
                </div>
                <button
                  class="btn btn-link p-0 mt-1 more-toggle"
                  type="button"
                  style="display:none;"
                >
                  더보기...
                </button>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    feedBox.innerHTML = listHtml;

    // ✅ 각 글귀 카드에 글 길이 따라 폰트 크기 자동 조절
    const quoteCards = feedBox.querySelectorAll('.quote-card');
    quoteCards.forEach((card) => autoAdjustQuoteFont(card));

    // 🔽 "더보기/접기" 토글 처리
    const postContents = feedBox.querySelectorAll('.post-content');

    postContents.forEach((postContent) => {
      const contentBox = postContent.querySelector('.feed-post-content');
      const moreBtn = postContent.querySelector('.more-toggle');

      if (!contentBox || !moreBtn) return;

      const isOverflowing =
        contentBox.scrollHeight > contentBox.clientHeight + 4;

      if (!isOverflowing) {
        moreBtn.style.display = 'none';
        return;
      }

      moreBtn.style.display = 'inline-block';
      moreBtn.textContent = '더보기...';

      moreBtn.addEventListener('click', () => {
        const nowExpanded = contentBox.classList.toggle('expanded');
        moreBtn.textContent = nowExpanded ? '접기' : '더보기...';
      });
    });
// 🔽 공감(하트) 버튼 클릭 처리 + bump 애니메이션
const likeButtons = feedBox.querySelectorAll('.like-btn');

likeButtons.forEach((btn) => {
  btn.addEventListener('click', async () => {
    const postId = btn.getAttribute('data-post-id');
    if (!postId) return;

    try {
      const res = await fetch(`/api/posts/${postId}/toggle-like`, {
        method: 'POST',
      });

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
      const likeCount = typeof data.likeCount === 'number'
        ? data.likeCount
        : 0;

      btn.setAttribute('data-liked', liked ? '1' : '0');
      const heartEl = btn.querySelector('.like-heart');
      const countEl = btn.querySelector('.like-count');

      if (heartEl) {
        heartEl.textContent = liked ? '♥' : '♡';
      }
      if (countEl) {
        countEl.textContent = likeCount;
      }

      // 좋아요 여부에 따른 색상 스타일
      btn.classList.toggle('liked', liked);

      // ✅ 좋아요를 "켜는 순간"에만 톡! 애니메이션
      if (heartEl && liked) {
        // 이전 애니메이션 리셋
        heartEl.classList.remove('bump');
        // 강제 리플로우로 상태 초기화
        // eslint-disable-next-line no-unused-expressions
        heartEl.offsetWidth;
        // bump 클래스로 scale(1 -> 1.8) 애니메이션
        heartEl.classList.add('bump');

        // 애니메이션 끝날 때쯤 bump 제거 → 다시 scale(1)로 자연스럽게 복귀
        setTimeout(() => {
          heartEl.classList.remove('bump');
        }, 220);
      }
    } catch (e) {
      console.error(e);
      alert('공감 처리 중 오류가 발생했습니다.');
    }
  });
});
  } catch (e) {
    console.error(e);
    feedBox.innerHTML =
      '<p class="text-danger">피드를 불러오는 중 오류가 발생했습니다.</p>';
  }
}

// 글 길이에 따라 카드 안 글꼴 크기 자동 조절
function autoAdjustQuoteFont(el) {
  if (!el) return;

  const text = el.innerText.trim();
  const len = text.length;

  let fontSize = 1.6; // 기본

  if (len > 140) {
    fontSize = 1.1;
  } else if (len > 100) {
    fontSize = 1.2;
  } else if (len > 70) {
    fontSize = 1.3;
  } else if (len > 40) {
    fontSize = 1.4;
  } else {
    fontSize = 1.6;
  }

  if (fontSize < 1.1) fontSize = 1.1;

  el.style.fontSize = fontSize + 'rem';
  el.style.lineHeight = Math.min(fontSize + 0.4, 2.0);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ================================
   히어로 CTA 잎사귀 애니메이션
================================ */

document.addEventListener('DOMContentLoaded', () => {
  const LEAF_COUNT = 10;

  const heroButtons = document.querySelectorAll('.hero-cta-btn');

  heroButtons.forEach((btn) => {
    const leavesContainer = btn.querySelector('.hero-cta-leaves');
    if (!leavesContainer) return;

    // 잎사귀 span 생성
    for (let i = 0; i < LEAF_COUNT; i++) {
      const leaf = document.createElement('span');
      leaf.className = 'hero-cta-leaf';
      leaf.textContent = '🌿';
      leavesContainer.appendChild(leaf);
    }

    const leaves = Array.from(
      leavesContainer.querySelectorAll('.hero-cta-leaf')
    );

    const triggerLeaves = () => {
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

      const shuffled = BASE_POSITIONS.slice().sort(() => Math.random() - 0.5);

      leaves.forEach((leaf, idx) => {
        const base = shuffled[idx % shuffled.length];

        const jitterX = Math.random() * 12 - 6;
        const jitterY = Math.random() * 10 - 5;

        const offsetX = base.x + jitterX;
        const offsetY = base.y + jitterY;

        const scale = 0.85 + Math.random() * 0.5;
        const rotate = -35 + Math.random() * 70;

        leaf.style.setProperty('--leaf-tx', `${offsetX}px`);
        leaf.style.setProperty('--leaf-ty', `${offsetY}px`);
        leaf.style.setProperty('--leaf-scale', scale);
        leaf.style.setProperty('--leaf-rot', `${rotate}deg`);

        leaf.classList.remove('leaf-show');
        // 강제 리플로우
        // eslint-disable-next-line no-unused-expressions
        leaf.offsetWidth;
        leaf.classList.add('leaf-show');

        setTimeout(() => {
          leaf.classList.remove('leaf-show');
        }, 1000);
      });
    };

    btn.addEventListener('mouseenter', triggerLeaves);
    btn.addEventListener('focus', triggerLeaves);
  });
});

/**
 * 이메일 마스킹
 * - @ 뒤 도메인은 사용하지 않음
 * - @ 앞 자리수는 유지하면서 앞 1~2글자만 보이게
 */
function maskEmail(email) {
  if (!email) return '';

  const atIndex = email.indexOf('@');
  const localPart = atIndex === -1 ? email : email.slice(0, atIndex); // @ 앞부분만 사용

  if (!localPart) return '';

  if (localPart.length === 1) {
    return localPart; // 한 글자는 그대로
  }

  const visibleCount = Math.min(2, localPart.length - 1); // 최대 2글자까지만 보이게
  const hiddenCount = localPart.length - visibleCount;

  return localPart.slice(0, visibleCount) + '*'.repeat(hiddenCount);
}
