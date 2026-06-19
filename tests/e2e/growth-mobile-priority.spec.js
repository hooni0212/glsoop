const { test, expect } = require('@playwright/test');

const dashboardPayload = {
  ok: true,
  summary: {
    level: 1,
    current_xp: 14,
    next_level_xp: 50,
    today_xp: 6,
    weekly_posts: 1,
    streak_days: 2,
    max_streak_days: 5,
    title: '새싹',
  },
  achievements: [
    {
      id: 1,
      code: 'first_post',
      name: '첫 글쓰기',
      description: '첫 글을 작성해보세요.',
      category: 'growth',
      status: 'in_progress',
      progress: 1,
      target: 3,
      unlocked_at: null,
      position_index: 1,
      icon: '🌱',
    },
  ],
  campaigns: [
    {
      id: 100,
      name: '오늘의 캠페인',
      description: '오늘의 할 일을 먼저 진행해보세요.',
      campaign_type: 'daily',
      campaign_type_label: '일일',
      start_at: '2026-02-23T00:00:00.000Z',
      end_at: null,
      quests: [
        {
          id: 300,
          state_id: 301,
          name: '오늘 글 1개 작성',
          description: '짧은 글도 좋아요.',
          condition_type: 'POST_COUNT_TOTAL',
          condition_type_label: '총 글 작성',
          category: null,
          target: 1,
          reward_xp: 20,
          status: 'in_progress',
          progress: 0,
          template_kind: 'quest',
          code: 'daily_write_once',
          ui_json: null,
        },
      ],
    },
  ],
  top_posts: [],
};

test.describe('Growth mobile priority layout', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', 'Mobile only');
  });

  test('prioritizes quest flow and persists the achievement filter', async ({ page }) => {
    await page.route('**/api/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          id: 2,
          name: 'User',
          nickname: '일반사용자',
          email: 'user@glsoop.test',
          is_admin: 0,
          is_verified: 1,
        }),
      })
    );
    await page.route('**/api/growth/dashboard', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(dashboardPayload),
      })
    );
    await page.route('**/api/ux-events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    );

    await page.goto('/html/growth.html');
    await expect(page.locator('#growthQuestListToday .quest-card')).toBeVisible();

    const positions = await page.evaluate(() => {
      const quest = document.getElementById('growthQuestSection')?.getBoundingClientRect()?.top ?? 99999;
      const achievements = document
        .getElementById('growthAchievementListSection')
        ?.getBoundingClientRect()?.top ?? 99999;
      const summary = document.getElementById('growthSummarySection')?.getBoundingClientRect()?.top ?? 99999;
      return { quest, achievements, summary };
    });
    expect(positions.quest).toBeLessThan(positions.achievements);
    expect(positions.achievements).toBeLessThan(positions.summary);

    const completedFilter = page.locator('#achievementFilters [data-filter="completed"]');
    await completedFilter.click();
    await expect(completedFilter).toHaveClass(/is-active/);

    const storedFilter = await page.evaluate(() =>
      window.localStorage.getItem('glsoop:growth:achievement-filter')
    );
    expect(storedFilter).toBe('completed');

    await page.reload();
    await expect(page.locator('#achievementFilters [data-filter="completed"]')).toHaveClass(/is-active/);
    await expect(page.locator('#growthAchievementListSection')).toBeVisible();
  });
});
