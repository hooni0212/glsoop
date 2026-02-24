const AUTHOR_POSTS = [
  {
    id: 103,
    title: 'Newest Post',
    content: '<p>Newest content</p>',
    category: 'poem',
    created_at: '2026-02-23T16:00:00.000Z',
    like_count: 2,
    user_liked: 0,
    hashtags: '시,산책',
    author_id: 1,
  },
  {
    id: 102,
    title: 'Middle Post',
    content: '<p>Middle content</p>',
    category: 'essay',
    created_at: '2026-02-22T10:30:00.000Z',
    like_count: 5,
    user_liked: 1,
    hashtags: '에세이,기록',
    author_id: 1,
  },
  {
    id: 101,
    title: 'Old Post',
    content: '<p>Old content</p>',
    category: 'short',
    created_at: '2026-02-20T08:10:00.000Z',
    like_count: 1,
    user_liked: 0,
    hashtags: '짧은문장',
    author_id: 1,
  },
];

const LONG_ABOUT_TEXT =
  '마음의 결을 오래 관찰하며 계절마다 다른 톤의 문장을 수집합니다. 조용한 새벽에 쓰기 시작한 메모를 낮의 빛으로 다듬고, 독자가 숨을 고를 수 있는 간격을 남기려 합니다. 긴 문장을 짧게 접어도 의미가 남는 구조를 좋아하고, 한 편의 글 안에서 이미지와 리듬이 자연스럽게 이어지도록 집중합니다. 또한 같은 주제를 다른 길이와 리듬으로 여러 번 다시 쓰며, 독자가 어느 문단에서 멈추더라도 중심 감정이 남도록 호흡을 조율합니다.';

function sortPosts(posts, sortKey) {
  const next = [...posts];
  switch (sortKey) {
    case 'oldest':
      return next.sort(
        (a, b) => Date.parse(String(a.created_at || '')) - Date.parse(String(b.created_at || ''))
      );
    case 'likes':
      return next.sort((a, b) => {
        const likeDiff = Number(b.like_count || 0) - Number(a.like_count || 0);
        if (likeDiff !== 0) return likeDiff;
        return Date.parse(String(b.created_at || '')) - Date.parse(String(a.created_at || ''));
      });
    case 'newest':
    default:
      return next.sort(
        (a, b) => Date.parse(String(b.created_at || '')) - Date.parse(String(a.created_at || ''))
      );
  }
}

async function mockAuthorPageApis(page, options = {}) {
  const {
    authorId = 1,
    viewer = {
      id: 2,
      is_logged_in: true,
      is_own_profile: false,
      is_following: false,
    },
    profile = {},
    posts = AUTHOR_POSTS,
  } = options;

  const uxEvents = [];
  let following = Boolean(viewer.is_following);
  let followerCount = Number(profile.follower_count ?? 2);

  await page.route('**/api/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        id: viewer.id || 2,
        name: 'User',
        nickname: '일반사용자',
        email: 'user@glsoop.test',
        is_admin: 0,
        is_verified: 1,
      }),
    })
  );

  await page.route('**/api/ux-events', (route) => {
    try {
      const payload = route.request().postDataJSON();
      if (payload?.event_name) uxEvents.push(payload.event_name);
    } catch (error) {
      // no-op: 계측 payload 파싱 실패는 테스트를 막지 않음
    }

    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.route(`**/api/users/${authorId}/profile`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        user: {
          id: authorId,
          name: 'Admin',
          nickname: '관리자',
          email: 'admin@glsoop.test',
          bio: '매일 짧은 기록을 남깁니다.',
          about: LONG_ABOUT_TEXT,
          level: 8,
          post_count: posts.length,
          total_likes: posts.reduce((sum, post) => sum + Number(post.like_count || 0), 0),
          follower_count: followerCount,
          following_count: 3,
          ...profile,
        },
        viewer: {
          ...viewer,
          is_following: following,
        },
      }),
    })
  );

  await page.route(`**/api/users/${authorId}/posts**`, (route) => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get('offset') || '0');
    const limit = Number(url.searchParams.get('limit') || '10');
    const sort = url.searchParams.get('sort') || 'newest';

    const sorted = sortPosts(posts, sort);
    const slice = sorted.slice(offset, offset + limit);

    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        posts: slice,
      }),
    });
  });

  await page.route(`**/api/users/${authorId}/follow`, (route) => {
    following = !following;
    followerCount += following ? 1 : -1;

    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        following,
        follower_count: followerCount,
      }),
    });
  });

  return {
    uxEvents,
    getFollowing: () => following,
    getFollowerCount: () => followerCount,
  };
}

module.exports = {
  AUTHOR_POSTS,
  LONG_ABOUT_TEXT,
  mockAuthorPageApis,
};
