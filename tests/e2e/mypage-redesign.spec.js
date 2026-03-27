const { test, expect } = require('@playwright/test');

function buildFixtures(overrides = {}) {
  return {
    me: {
      ok: true,
      id: 2,
      name: '테스트사용자',
      nickname: '대시보더',
      bio: '테스트 소개',
      about: '테스트 자기소개',
      email: 'user@glsoop.test',
      remember_login_enabled: true,
      follower_count: 5,
      following_count: 3,
      ...overrides.me,
    },
    postsMy:
      overrides.postsMy || [
        {
          id: 101,
          title: '내가 쓴 첫 번째 글',
          content: '이것은 마이페이지 리디자인 테스트를 위한 본문입니다.',
          category: 'essay',
          created_at: '2026-02-24T12:00:00.000Z',
          author_name: '테스트사용자',
          author_nickname: '대시보더',
          like_count: 7,
        },
      ],
    liked:
      overrides.liked || [
        {
          id: 201,
          title: '공감한 글 샘플',
          content: '공감한 글의 본문입니다.',
          category: 'poem',
          created_at: '2026-02-23T09:30:00.000Z',
          author_name: '다른유저',
          author_nickname: '시인',
          like_count: 12,
        },
      ],
    followings:
      overrides.followings || [
        {
          id: 11,
          name: '팔로잉유저1',
          nickname: '나무',
          bio: '숲을 좋아합니다.',
          about: '시와 에세이를 씁니다.',
          email: 'tree@glsoop.test',
          follower_count: 10,
        },
        {
          id: 12,
          name: '팔로잉유저2',
          nickname: '바람',
          bio: '짧은 글을 씁니다.',
          about: '매일 한 문장 기록합니다.',
          email: 'wind@glsoop.test',
          follower_count: 8,
        },
      ],
    sessions:
      overrides.sessions || [
        {
          current: true,
          remember_me: true,
          created_at: '2026-02-20T10:00:00.000Z',
          last_seen_at: '2026-02-25T10:30:00.000Z',
          expires_at: '2026-03-20T10:00:00.000Z',
          ip_hint: '203.0.113.10',
          user_agent: 'Desktop Chrome',
        },
      ],
    growth: {
      ok: true,
      summary: {
        level: 3,
        today_xp: 20,
        streak_days: 5,
        current_xp: 180,
        next_level_xp: 240,
        title: '초록길',
      },
      ...(overrides.growth || {}),
    },
  };
}

async function mockMypageApis(page, overrides = {}) {
  const fixtures = buildFixtures(overrides);
  let me = { ...fixtures.me };
  let postsMy = [...fixtures.postsMy];
  let likedPosts = [...fixtures.liked];
  let followings = [...fixtures.followings];

  const putPayloads = [];
  const accountClosurePayloads = [];
  const deletePostIds = [];
  const unfollowIds = [];

  await page.route('**/api/me', async (route) => {
    const req = route.request();
    if (req.method() === 'PUT') {
      const payload = req.postDataJSON() || {};
      putPayloads.push(payload);

      if (payload.nickname !== undefined) me.nickname = payload.nickname;
      if (payload.bio !== undefined) me.bio = payload.bio;
      if (payload.about !== undefined) me.about = payload.about;
      if (payload.remember_login_enabled !== undefined) {
        me.remember_login_enabled = !!payload.remember_login_enabled;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, message: '정보가 성공적으로 수정되었습니다.' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(me),
    });
  });

  await page.route('**/api/growth/summary', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixtures.growth),
    });
  });

  await page.route('**/api/me/sessions', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, sessions: fixtures.sessions }),
    });
  });

  await page.route('**/api/logout-all', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, message: '모든 기기에서 로그아웃되었습니다.' }),
    });
  });

  await page.route('**/api/me/account-closure', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') {
      await route.fallback();
      return;
    }

    const payload = req.postDataJSON() || {};
    accountClosurePayloads.push(payload);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        mode: payload.mode || 'deactivate',
        scheduled_purge_at: '2026-04-25T00:00:00.000Z',
        message:
          payload.mode === 'delete'
            ? '회원 탈퇴가 완료되었습니다.'
            : '계정이 비활성화되었습니다. 30일 안에 다시 로그인하면 복구됩니다.',
      }),
    });
  });

  await page.route('**/api/posts/my', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, posts: postsMy }),
    });
  });

  await page.route('**/api/posts/liked', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, posts: likedPosts }),
    });
  });

  await page.route(/\/api\/posts\/\d+$/, async (route) => {
    const req = route.request();
    if (req.method() !== 'DELETE') {
      await route.fallback();
      return;
    }

    const postId = Number(req.url().split('/').pop());
    deletePostIds.push(postId);
    postsMy = postsMy.filter((post) => Number(post.id) !== postId);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, message: '글이 삭제되었습니다.' }),
    });
  });

  await page.route('**/api/me/followings', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, followings }),
    });
  });

  await page.route(/\/api\/users\/\d+\/follow$/, async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') {
      await route.fallback();
      return;
    }

    const userId = Number(req.url().split('/').slice(-2, -1)[0]);
    unfollowIds.push(userId);
    followings = followings.filter((user) => Number(user.id) !== userId);
    me.following_count = Math.max(0, Number(me.following_count || 0) - 1);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, following: false }),
    });
  });

  return {
    putPayloads,
    accountClosurePayloads,
    deletePostIds,
    unfollowIds,
  };
}

test.describe('MyPage redesign', () => {
  test('redirects unauthenticated user to login page with next/from', async ({ page }) => {
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, message: '로그인이 필요합니다.' }),
      });
    });

    await page.goto('/html/mypage.html');
    await expect(page.locator('#userInfo')).toContainText('로그인이 필요합니다');
    await page.waitForURL(/\/html\/login\.html\?/, { timeout: 5000 });
    await expect(page).toHaveURL(/from=mypage/);
  });

  test('supports keyboard tab navigation and section switching', async ({ page }) => {
    await mockMypageApis(page);

    await page.goto('/html/mypage.html');
    const tabMy = page.locator('#tabMyPosts');
    const tabLiked = page.locator('#tabLikedPosts');
    const tabFollowings = page.locator('#tabFollowings');

    await expect(tabMy).toHaveAttribute('aria-selected', 'true');

    await tabMy.focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabLiked).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#likedPosts .mypage-post-card')).toHaveCount(1);

    await tabLiked.focus();
    await page.keyboard.press('End');
    await expect(tabFollowings).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#followingsList .mypage-following-card')).toHaveCount(2);

    await page.click('#tabBookmarks');
    await expect(page).toHaveURL(/\/html\/bookmarks\.html/);
  });

  test('opens account management flow modal and submits deactivation step-by-step', async ({ page }) => {
    const { accountClosurePayloads } = await mockMypageApis(page);

    await page.goto('/html/mypage.html');
    await page.getByRole('button', { name: '내 정보 수정' }).click();

    await expect(page.locator('#accountClosureOpenBtn')).toHaveText('계정 관리');
    await page.locator('#accountClosureOpenBtn').click();

    const flowModal = page.locator('#accountClosureFlowModal');
    await expect(flowModal).toBeVisible();
    await expect(page.locator('#accountClosureChoiceStep')).toBeVisible();
    await expect(page.locator('#accountClosureConfirmStep')).toBeHidden();

    await page.locator('#accountClosureNextBtn').click();
    await expect(page.locator('#accountClosureConfirmStep')).toBeVisible();

    await page.locator('#accountClosureCurrentPwInput').fill('Pass1234');
    await page.locator('#accountClosureConfirmInput').fill('DELETE');
    await page.locator('#accountClosureSubmitBtn').click();

    await expect(page.locator('#accountClosureMessage')).toContainText('계정이 비활성화되었습니다');
    await page.waitForURL(/\/html\/login\.html\?from=account-closure&mode=deactivate/);

    expect(accountClosurePayloads).toEqual([
      {
        mode: 'deactivate',
        currentPw: 'Pass1234',
        confirmText: 'DELETE',
      },
    ]);
  });

  test('deletes my post and shows empty state CTA', async ({ page }) => {
    const trackers = await mockMypageApis(page, {
      postsMy: [
        {
          id: 555,
          title: '삭제 대상 글',
          content: '삭제 테스트 본문입니다.',
          category: 'short',
          created_at: '2026-02-20T01:00:00.000Z',
          author_name: '테스트사용자',
          author_nickname: '대시보더',
          like_count: 1,
        },
      ],
    });

    await page.goto('/html/mypage.html');
    await expect(page.locator('#myPosts .mypage-post-card')).toHaveCount(1);

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#myPosts .delete-post-btn').click();

    await expect(page.locator('#myPosts .mypage-post-card')).toHaveCount(0);
    await expect(page.locator('#myPosts')).toContainText('아직 작성한 글이 없습니다.');
    await expect(page.locator('#mypageEmptyCreatePostCta')).toBeVisible();
    expect(trackers.deletePostIds).toEqual([555]);
  });

  test('validates password mismatch and submits profile updates', async ({ page }) => {
    const trackers = await mockMypageApis(page);

    await page.goto('/html/mypage.html');
    await page.getByRole('button', { name: '내 정보 수정' }).click();

    await page.fill('#newPwInput', 'abcd1234');
    await page.fill('#newPwConfirmInput', 'abcd9999');
    await page.click('#userEditForm button[type="submit"]');
    await expect(page.locator('#userEditMessage')).toContainText('새 비밀번호가 서로 일치하지 않습니다.');

    await page.fill('#nicknameInput', '수정닉네임');
    await page.fill('#currentPwInput', 'password123');
    await page.fill('#newPwInput', 'abcd1234');
    await page.fill('#newPwConfirmInput', 'abcd1234');
    await page.click('#userEditForm button[type="submit"]');

    await expect.poll(() => trackers.putPayloads.length).toBeGreaterThan(0);
    expect(trackers.putPayloads.at(-1)).toMatchObject({
      nickname: '수정닉네임',
      currentPw: 'password123',
      newPw: 'abcd1234',
    });

    await expect(page.locator('#userInfo')).toContainText('수정닉네임님');
  });

  test('unfollow removes following card and decreases count', async ({ page }) => {
    const trackers = await mockMypageApis(page, {
      me: { following_count: 2 },
      followings: [
        {
          id: 31,
          name: '팔로잉유저A',
          nickname: '새싹',
          bio: 'bio-a',
          about: 'about-a',
          email: 'a@glsoop.test',
          follower_count: 3,
        },
        {
          id: 32,
          name: '팔로잉유저B',
          nickname: '햇살',
          bio: 'bio-b',
          about: 'about-b',
          email: 'b@glsoop.test',
          follower_count: 4,
        },
      ],
    });

    await page.goto('/html/mypage.html');
    await page.click('#tabFollowings');

    await expect(page.locator('#followingsList .mypage-following-card')).toHaveCount(2);
    await expect(page.locator('#mypageFollowingCount')).toHaveText('2');

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#followingsList .unfollow-btn').first().click();

    await expect(page.locator('#followingsList .mypage-following-card')).toHaveCount(1);
    await expect(page.locator('#mypageFollowingCount')).toHaveText('1');
    expect(trackers.unfollowIds).toContain(31);
  });
});
