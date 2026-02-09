const { test, expect } = require('@playwright/test');

const dashboardSummary = {
  level: 3,
  current_xp: 90,
  next_level_xp: 140,
  today_xp: 12,
  weekly_posts: 2,
  streak_days: 2,
  max_streak_days: 5,
  title: 'Sprout',
};

const dashboardAchievements = [
  {
    id: 1,
    code: 'first_post',
    name: 'First Post',
    description: 'Write your first post',
    category: 'growth',
    status: 'in_progress',
    progress: 1,
    target: 3,
    unlocked_at: null,
    position_index: 1,
    icon: '🌱',
  },
];

const dashboardTopPosts = [
  {
    id: 101,
    title: '테스트 인기 글',
    excerpt: '인기 글 요약',
    author_name: '테스터',
    like_count: 12,
    bookmark_count: 4,
  },
];

const fallbackSummary = {
  level: 4,
  current_xp: 130,
  next_level_xp: 200,
  today_xp: 20,
  weekly_posts: 3,
  streak_days: 3,
  max_streak_days: 7,
  title: 'Branch',
};

const fallbackAchievements = [
  {
    id: 2,
    code: 'likes_10_single',
    name: 'Popular Post',
    description: 'Get 10 likes on one post',
    category: 'social',
    status: 'completed',
    progress: 10,
    target: 10,
    unlocked_at: '2026-02-09T00:00:00.000Z',
    position_index: 2,
    icon: '🏆',
  },
];

const fallbackCampaigns = [
  {
    id: 11,
    name: 'Daily Quest',
    description: 'Daily writing mission',
    campaign_type: 'daily',
    start_at: '2026-02-09T00:00:00.000Z',
    end_at: null,
    quests: [
      {
        id: 22,
        state_id: 33,
        name: 'Write 1 post',
        description: 'Publish one post today',
        condition_type: 'POST_COUNT_TOTAL',
        category: null,
        target: 1,
        reward_xp: 20,
        status: 'in_progress',
        progress: 0,
        position_index: 1,
        campaign_id: 11,
        campaign_type: 'daily',
        template_kind: 'normal',
        code: 'daily_write_once',
        ui_json: null,
        completed_at: null,
        reward_claimed_at: null,
      },
    ],
  },
];

async function mockAuth(page) {
  await page.route('**/api/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  );
}

test.describe('Growth dashboard loading', () => {
  test('uses dashboard endpoint first and skips legacy calls on success', async ({ page }) => {
    let dashboardHits = 0;
    let summaryHits = 0;
    let achievementsHits = 0;
    let activeQuestsHits = 0;

    const dashboardResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/growth/dashboard') && response.request().method() === 'GET'
    );

    await mockAuth(page);

    await page.route('**/api/growth/dashboard', (route) => {
      dashboardHits += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          summary: dashboardSummary,
          achievements: dashboardAchievements,
          campaigns: [],
          top_posts: dashboardTopPosts,
        }),
      });
    });

    await page.route('**/api/growth/summary', (route) => {
      summaryHits += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, summary: fallbackSummary }),
      });
    });

    await page.route('**/api/growth/achievements', (route) => {
      achievementsHits += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, achievements: fallbackAchievements }),
      });
    });

    await page.route('**/api/quests/active', (route) => {
      activeQuestsHits += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, campaigns: fallbackCampaigns }),
      });
    });

    await page.goto('/html/growth.html');

    const dashboardResponse = await dashboardResponsePromise;
    const dashboardJson = await dashboardResponse.json();
    expect(Array.isArray(dashboardJson.top_posts)).toBe(true);
    expect(dashboardJson.top_posts.length).toBeGreaterThan(0);
    expect(dashboardJson.top_posts[0]).toMatchObject({
      id: expect.any(Number),
      title: expect.any(String),
      excerpt: expect.any(String),
      author_name: expect.any(String),
      like_count: expect.any(Number),
      bookmark_count: expect.any(Number),
    });

    await expect(page.locator('#growthLevelLabel')).toContainText('Lv.3');

    expect(dashboardHits).toBe(1);
    expect(summaryHits).toBe(0);
    expect(achievementsHits).toBe(0);
    expect(activeQuestsHits).toBe(0);
  });

  test('falls back to legacy endpoints when dashboard request fails', async ({ page }) => {
    let dashboardHits = 0;
    let summaryHits = 0;
    let achievementsHits = 0;
    let activeQuestsHits = 0;

    await mockAuth(page);

    await page.route('**/api/growth/dashboard', (route) => {
      dashboardHits += 1;
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, message: 'dashboard unavailable' }),
      });
    });

    await page.route('**/api/growth/summary', (route) => {
      summaryHits += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, summary: fallbackSummary }),
      });
    });

    await page.route('**/api/growth/achievements', (route) => {
      achievementsHits += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, achievements: fallbackAchievements }),
      });
    });

    await page.route('**/api/quests/active', (route) => {
      activeQuestsHits += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, campaigns: fallbackCampaigns }),
      });
    });

    await page.goto('/html/growth.html');

    await expect(page.locator('#growthLevelLabel')).toContainText('Lv.4');

    expect(dashboardHits).toBe(1);
    expect(summaryHits).toBeGreaterThan(0);
    expect(achievementsHits).toBeGreaterThan(0);
    expect(activeQuestsHits).toBeGreaterThan(0);
  });
});
