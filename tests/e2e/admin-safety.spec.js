const { test, expect } = require('@playwright/test');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const REPO_ROOT = process.cwd();
const DB_PATH = process.env.DB_PATH
  ? path.resolve(REPO_ROOT, process.env.DB_PATH)
  : path.join(REPO_ROOT, 'tmp', 'e2e_playwright.sqlite');

const dbRun = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });

const waitForFile = async (filePath, timeoutMs = 10000) => {
  const startedAt = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

async function seedAdminGuardFixtures() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);

  const db = new sqlite3.Database(DB_PATH);
  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [1, 'Admin', '관리자', 'admin@glsoop.test', 'password', 1, 1]
  );
  await new Promise((resolve) => db.close(resolve));
}

async function applyAdminCookie(page, baseURL) {
  const token = jwt.sign(
    {
      id: 1,
      sid: `admin_safety_sid_${process.pid}`,
      name: 'Admin',
      nickname: '관리자',
      email: 'admin@glsoop.test',
      isAdmin: true,
      isVerified: true,
    },
    'devsecret',
    {
      algorithm: 'HS256',
      issuer: 'glsoop',
      audience: 'glsoop-client',
      expiresIn: '2h',
    }
  );

  await page.context().addCookies([
    {
      name: 'token',
      value: token,
      url: baseURL,
    },
  ]);
}

async function mockAdminBootApis(page, options = {}) {
  let reportStatus = options.initialReportStatus || 'queued';
  let pushCampaignId = 700;
  const pushCampaignRows = [...(options.initialPushCampaigns || [])];
  const pushDeliveryRows = [
    ...(options.initialPushDeliveries || [
      {
        id: 810,
        activity_event_id: 910,
        recipient_user_id: 2,
        status: 'queued',
        provider: 'expo',
        title: '새 독자가 생겼어요',
        body: '독자님이 나를 팔로우했어요.',
        type: 'new_follower',
        event_type: 'system',
        target_path: '/users/9',
        attempt_count: 0,
        created_at: '2026-05-20T08:40:00.000Z',
        recipient: {
          id: 2,
          name: '일반사용자',
          nickname: '글쓴이',
          email: 'writer@example.com',
        },
        push_token: {
          id: 510,
          platform: 'ios',
          enabled: true,
          last_seen_at: '2026-05-20T08:35:00.000Z',
        },
      },
    ]),
  ];
  const pushRecipientRows = [
    ...(options.initialPushRecipients || [
      {
        id: 2,
        name: '일반사용자',
        nickname: '글쓴이',
        email: 'writer@example.com',
        marketing_push_opt_in: true,
        marketing_push_opt_in_updated_at: '2026-05-20T08:30:00.000Z',
        total_push_token_count: 1,
        active_push_token_count: 1,
        platforms: ['ios'],
        last_push_token_seen_at: '2026-05-20T08:35:00.000Z',
      },
      {
        id: 3,
        name: '독자사용자',
        nickname: '독자',
        email: 'reader@example.com',
        marketing_push_opt_in: true,
        marketing_push_opt_in_updated_at: '2026-05-20T08:20:00.000Z',
        total_push_token_count: 1,
        active_push_token_count: 1,
        platforms: ['android'],
        last_push_token_seen_at: '2026-05-20T08:25:00.000Z',
      },
    ]),
  ];
  let reportedPostRows = [
    {
      target_post_id: 11,
      target_post_title: 'Poem Post',
      target_user_id: 2,
      target_user_display_name: 'User',
      target_user_nickname: '일반사용자',
      report_count: 8,
      unique_reporter_count: 5,
      queued_count: 7,
      reviewing_count: 1,
      latest_reported_at: '2026-04-03T05:00:00.000Z',
    },
  ];

  await page.route('**/api/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        id: 1,
        name: 'Admin',
        nickname: '관리자',
        email: 'admin@glsoop.test',
        is_admin: 1,
        is_verified: 1,
      }),
    })
  );

  await page.route('**/api/admin/users**', (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname !== '/api/admin/users') {
      return route.fallback();
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        users: [
          {
            id: 1,
            name: 'Admin',
            nickname: '관리자',
            email: 'admin@glsoop.test',
            is_admin: 1,
            is_verified: 1,
          },
          {
            id: 2,
            name: 'User',
            nickname: '일반사용자',
            email: 'user@glsoop.test',
            is_admin: 0,
            is_verified: 1,
          },
        ],
      }),
    });
  });

  await page.route('**/api/admin/posts**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        items: [
          {
            id: 11,
            title: 'Poem Post',
            content: 'Poem content',
            category: 'poem',
            author_name: 'Admin',
            author_nickname: '관리자',
            author_email: 'admin@glsoop.test',
            created_at: '2026-02-23 15:06:00',
            like_count: 1,
          },
        ],
        total: 1,
        page: 1,
        page_size: 48,
      }),
    })
  );

  await page.route('**/api/posts/11**', (route) => {
    const url = route.request().url();
    if (url.includes('/related')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, posts: [] }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        post: {
          id: 11,
          title: 'Poem Post',
          content: 'Poem content',
          category: 'poem',
          author_name: 'Admin',
          author_nickname: '관리자',
          created_at: '2026-02-23 15:06:00',
          like_count: 1,
          liked: false,
        },
      }),
    });
  });

  await page.route('**/api/admin/quest-templates', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        items: [],
      }),
    })
  );

  await page.route('**/api/admin/quest-campaigns', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        items: [],
        campaign_items: [],
      }),
    })
  );

  await page.route('**/api/admin/writing-campaigns/monthly-project', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        campaign: {
          key: 'glsoop-monthly-writing-project-prototype',
          title: '글숲 한달 글쓰기 프로젝트',
          subtitle: '매일 하나의 글감으로 30일 동안 글을 쌓아가요.',
          total_days: 30,
          current_day: 2,
          completed_days: 1,
          remaining_days: 28,
          progress_percent: 7,
          local_date_key: '2026-06-15',
          write_path: '/write?campaignPromptKey=day-02-window',
        },
        today_prompt: {
          key: 'day-02-window',
          day: 2,
          title: '창밖에서 시작된 생각',
          body: '지금 보이는 풍경이나 지나간 장면에서 떠오른 생각을 적어보세요.',
          defaultCategory: 'essay',
          suggestedHashtags: ['창밖', '관찰', '일상'],
          write_path: '/write?campaignPromptKey=day-02-window',
        },
        prompts: Array.from({ length: 30 }, (_, index) => ({
          key: `day-${String(index + 1).padStart(2, '0')}`,
          day: index + 1,
          title: index === 1 ? '창밖에서 시작된 생각' : `${index + 1}일차 주제`,
          body: '주제 설명',
          defaultCategory: 'essay',
          suggestedHashtags: ['글숲프로젝트'],
        })),
        progress_steps: Array.from({ length: 30 }, (_, index) => ({
          key: `day-${String(index + 1).padStart(2, '0')}`,
          day: index + 1,
          title: `${index + 1}일차 주제`,
          state: index === 0 ? 'completed' : index === 1 ? 'current' : 'upcoming',
        })),
        push_preset: {
          title: '2일차 오늘의 글감이 열렸어요',
          body: '창밖에서 시작된 생각 - 지금 보이는 풍경이나 지나간 장면에서 떠오른 생각을 적어보세요.',
          target_path: '/write?campaignPromptKey=day-02-window',
          include_ad_label: false,
          campaign_kind: 'daily_writing_project_prompt',
          campaign_key: 'glsoop-monthly-writing-project-prototype:2026-06-15',
          scheduled_for_date: '2026-06-15',
        },
      }),
    })
  );

  await page.route('**/api/admin/growth/operations/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        health: {
          open_alert_count: 0,
          checks: [
            {
              code: 'GROWTH_FIXTURE_OK',
              status: 'pass',
              level: 'info',
              title: '테스트 운영 상태',
              message: '테스트 fixture 상태입니다.',
              count: 0,
              items: [],
            },
          ],
        },
      }),
    })
  );

  await page.route('**/api/admin/operational-alerts**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        alerts: [],
      }),
    })
  );

  await page.route('**/api/admin/quests/auto-claim-expired-rewards', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (typeof options.onAutoClaimRewards === 'function') {
      options.onAutoClaimRewards({ body });
    }

    const dryRun = body.dry_run === true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        dryRun
          ? {
              ok: true,
              message: '자동 수령 대상 퀘스트 보상을 확인했습니다.',
              dry_run: true,
              limit: body.limit,
              candidate_count: 1,
              claimed_count: 0,
              skipped_count: 0,
              candidates: [
                {
                  state_id: 901,
                  user_id: 2,
                  template_id: 101,
                  campaign_id: 11,
                  campaign_name: '봄 시즌',
                  campaign_type: 'season',
                  end_at: '2026-03-01T00:00:00.000Z',
                },
              ],
              claimed: [],
              skipped: [],
            }
          : {
              ok: true,
              message: '종료된 시즌/이벤트 퀘스트 보상 자동 수령을 처리했습니다.',
              dry_run: false,
              limit: body.limit,
              candidate_count: 1,
              claimed_count: 1,
              skipped_count: 0,
              candidates: [],
              claimed: [
                {
                  state_id: 901,
                  user_id: 2,
                  template_id: 101,
                  campaign_id: 11,
                  campaign_name: '봄 시즌',
                  campaign_type: 'season',
                  end_at: '2026-03-01T00:00:00.000Z',
                  reward_claimed_at: '2026-05-09T00:00:00.000Z',
                  gained_xp: 20,
                  gained_cosmetics_count: 1,
                },
              ],
              skipped: [],
            }
      ),
    });
  });

  await page.route('**/api/admin/share-events/summary**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        summary: {
          total_count: 0,
          shared_count: 0,
          dismissed_count: 0,
          failed_count: 0,
          unique_user_count: 0,
          unique_post_count: 0,
        },
        by_channel: [],
        by_surface: [],
        daily: [],
      }),
    })
  );

  await page.route('**/api/admin/ux-events/summary**', (route) => {
    const requestUrl = new URL(route.request().url());
    options.onDeviceAnalyticsRequest?.({ requestUrl });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        options.deviceAnalyticsPayload || {
          ok: true,
          summary: {
            total_count: 30,
            unique_user_count: 2,
            unique_session_count: 3,
            anonymous_count: 4,
          },
          by_source: [
            {
              source: 'native_client',
              event_count: 18,
              unique_session_count: 2,
              unique_user_count: 1,
            },
            {
              source: 'web_client',
              event_count: 12,
              unique_session_count: 1,
              unique_user_count: 1,
            },
          ],
          by_device: [
            {
              device_class: 'mobile',
              event_count: 20,
              unique_session_count: 2,
              unique_user_count: 1,
            },
            {
              device_class: 'desktop',
              event_count: 10,
              unique_session_count: 1,
              unique_user_count: 1,
            },
          ],
          by_platform: [
            {
              platform_family: 'ios',
              event_count: 20,
              unique_session_count: 2,
              unique_user_count: 1,
            },
            {
              platform_family: 'macos',
              event_count: 10,
              unique_session_count: 1,
              unique_user_count: 1,
            },
          ],
          daily: [
            {
              day: '2026-06-22',
              total_count: 30,
              unique_session_count: 3,
              unique_user_count: 2,
            },
          ],
        }
      ),
    });
  });

  await page.route('**/api/admin/push-deliveries**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        summary: {
          total_count: pushDeliveryRows.length,
          queued_count: pushDeliveryRows.filter((row) => row.status === 'queued').length,
          sent_count: pushDeliveryRows.filter((row) => row.status === 'sent').length,
          failed_count: pushDeliveryRows.filter((row) => row.status === 'failed').length,
          skipped_count: pushDeliveryRows.filter((row) => row.status === 'skipped').length,
        },
        deliveries: pushDeliveryRows,
      }),
    })
  );

  await page.route('**/api/admin/push-recipients**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        summary: {
          opted_in_user_count: pushRecipientRows.length,
          active_token_count: pushRecipientRows.reduce(
            (sum, row) => sum + Number(row.active_push_token_count || 0),
            0
          ),
          listed_count: pushRecipientRows.length,
        },
        recipients: pushRecipientRows,
      }),
    })
  );

  await page.route('**/api/admin/marketing-push-campaigns**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          campaigns: pushCampaignRows,
          audience: {
            eligible_user_count: 2,
            eligible_token_count: 2,
          },
        }),
      });
      return;
    }

    const body = JSON.parse(request.postData() || '{}');
    if (typeof options.onMarketingPushCampaign === 'function') {
      options.onMarketingPushCampaign({ body });
    }

    if (body.dry_run === true) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          dry_run: true,
          eligible_user_count: 2,
          eligible_token_count: 2,
        }),
      });
      return;
    }

    const campaignId = pushCampaignId;
    pushCampaignId += 1;
    const includeAdLabel = body.include_ad_label !== false;
    const rawTitle = String(body.title || '테스트 푸시').replace(/^\(광고\)\s*/u, '').trim();
    pushCampaignRows.unshift({
      id: campaignId,
      title: includeAdLabel ? `(광고) ${rawTitle}` : rawTitle,
      body: body.body || '',
      target_path: body.target_path || '/write',
      queued_count: 2,
      dry_run: false,
      campaign_kind: null,
      created_at: '2026-05-20T09:00:00.000Z',
    });

    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        campaign_id: campaignId,
        queued_count: 2,
        eligible_user_count: 2,
        eligible_token_count: 2,
      }),
    });
  });

  await page.route('**/api/admin/safety/reports**', async (route) => {
    const request = route.request();
    const url = request.url();

    if (request.method() === 'POST' && url.includes('/resolve')) {
      const body = JSON.parse(request.postData() || '{}');
      reportStatus = body.status || reportStatus;
      if (typeof options.onResolveReport === 'function') {
        options.onResolveReport({ url, body });
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          report: {
            id: 101,
            status: reportStatus,
            action: body.action || null,
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        reports: [
          {
            id: 101,
            reporter_id: 7,
            reporter_display_name: '신고자A',
            reporter_nickname: '새벽',
            target_user_id: 2,
            target_user_display_name: 'User',
            target_user_nickname: '일반사용자',
            target_post_id: 11,
            target_post_title: 'Poem Post',
            source: 'report',
            reason_code: 'other',
            detail: '운영 검토가 필요한 내용입니다.',
            status: reportStatus,
            created_at: '2026-04-03T01:30:00.000Z',
          },
        ],
        meta: {
          count: 1,
          source: 'report+block',
          sources: ['report', 'block'],
        },
      }),
    });
  });

  await page.route('**/api/admin/safety/reported-posts**', async (route) => {
    const request = route.request();
    const url = request.url();

    if (request.method() === 'POST' && url.includes('/resolve')) {
      const body = JSON.parse(request.postData() || '{}');
      reportedPostRows = [];
      reportStatus = body.status || reportStatus;
      if (typeof options.onResolveReportedPost === 'function') {
        options.onResolveReportedPost({ url, body });
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          result: {
            target_post_id: 11,
            status: body.status,
            action: body.action,
            updated_count: 8,
          },
        }),
      });
      return;
    }

    if (request.method() === 'POST' && url.includes('/delete')) {
      const body = JSON.parse(request.postData() || '{}');
      reportedPostRows = [];
      reportStatus = 'actioned';
      if (typeof options.onDeleteReportedPost === 'function') {
        options.onDeleteReportedPost({ url, body });
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          result: {
            deleted: true,
            resolved_count: 8,
            post: { id: 11, title: 'Poem Post' },
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        posts: reportedPostRows,
      }),
    });
  });

  await page.route('**/api/ux-events', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  );
}

test.describe('Admin dangerous action safety', () => {
  test.beforeEach(async () => {
    await seedAdminGuardFixtures();
  });

  test('requires two-step confirmation and prevents duplicate delete requests', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://127.0.0.1:3100';
    let deleteCalls = 0;
    let resolveDelete = null;

    await mockAdminBootApis(page);
    await applyAdminCookie(page, baseURL);
    await page.route('**/api/admin/users/2', async (route) => {
      deleteCalls += 1;
      await new Promise((resolve) => {
        resolveDelete = resolve;
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto('/admin');
    const userRow = page.locator('tr[data-user-id="2"]');
    const deleteBtn = userRow.locator('.admin-delete-user-btn');
    await expect(deleteBtn).toBeVisible();

    await deleteBtn.click();
    await expect(page.locator('#adminDangerConfirmModal')).toBeVisible();
    await expect(page.locator('#adminDangerConfirmBtn')).toBeDisabled();
    expect(deleteCalls).toBe(0);

    await page.fill('#adminDangerInput', 'wrong');
    await expect(page.locator('#adminDangerConfirmBtn')).toBeDisabled();

    await page.fill('#adminDangerInput', 'DELETE');
    await expect(page.locator('#adminDangerConfirmBtn')).toBeEnabled();
    await page.click('#adminDangerConfirmBtn');

    await expect.poll(() => deleteCalls).toBe(1);
    await expect(deleteBtn).toBeDisabled();

    await page.evaluate(() => {
      const btn = document.querySelector('tr[data-user-id="2"] .admin-delete-user-btn');
      btn?.click();
    });
    await page.waitForTimeout(120);
    expect(deleteCalls).toBe(1);
    await expect(page.locator('#adminDangerConfirmModal')).toBeHidden();

    if (resolveDelete) resolveDelete();
    await expect(userRow).toHaveCount(0);
    expect(deleteCalls).toBe(1);
  });

  test('renders safety tab with report list and reported-post summary', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://127.0.0.1:3100';

    await mockAdminBootApis(page);
    await applyAdminCookie(page, baseURL);

    await page.goto('/admin');
    await page.getByRole('button', { name: /신고/ }).click();

    await expect(page.locator('#safetyTab')).toBeVisible();
    await expect(page.locator('#adminSafetyReports')).toContainText('신고자');
    await expect(page.locator('#adminSafetyReports')).toContainText('대상 사용자');
    await expect(page.locator('#adminSafetyReports')).toContainText('운영 검토가 필요한 내용입니다.');
    await expect(page.locator('#adminSafetyReports')).toContainText('접수');
    await expect(page.locator('#adminSafetyReports')).toContainText('조치');

    await expect(page.locator('#adminReportedPosts')).toContainText('Poem Post');
    await expect(page.locator('#adminReportedPosts')).toContainText('신고자');
    await expect(page.locator('#adminReportedPosts')).toContainText('5');
    await expect(page.locator('#adminReportedPosts')).toContainText('삭제');
  });

  test('renders aggregate device analytics and applies device filters', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://127.0.0.1:3100';
    const analyticsRequests = [];

    await mockAdminBootApis(page, {
      onDeviceAnalyticsRequest({ requestUrl }) {
        analyticsRequests.push(requestUrl);
      },
    });
    await applyAdminCookie(page, baseURL);

    await page.goto('/admin');
    await page.getByRole('button', { name: /접속 환경/ }).click();

    await expect(page.locator('#deviceAnalyticsTab')).toBeVisible();
    await expect(page.locator('#deviceAnalyticsTab')).toContainText('원본 User-Agent');
    await expect(page.locator('#adminDeviceAnalytics')).toContainText('고유 세션');
    await expect(page.locator('#adminDeviceAnalytics')).toContainText('모바일');
    await expect(page.locator('#adminDeviceAnalytics')).toContainText('iOS/iPadOS');
    await expect(page.locator('#adminDeviceAnalytics')).toContainText('네이티브 앱');
    await expect(page.locator('#adminDeviceAnalytics')).toContainText('66.7%');

    await page.selectOption('#adminDeviceSource', 'native_client');
    await page.selectOption('#adminDeviceClass', 'mobile');
    await page.selectOption('#adminPlatformFamily', 'ios');
    await page.selectOption('#adminDeviceUserType', 'authenticated');
    await page.click('#adminDeviceApply');

    await expect.poll(() => analyticsRequests.length).toBeGreaterThanOrEqual(2);
    const appliedRequest = analyticsRequests.at(-1);
    expect(appliedRequest.searchParams.get('source')).toBe('native_client');
    expect(appliedRequest.searchParams.get('device_class')).toBe('mobile');
    expect(appliedRequest.searchParams.get('platform_family')).toBe('ios');
    expect(appliedRequest.searchParams.get('user_type')).toBe('authenticated');
  });

  test('runs expired reward auto-claim from the quests admin UI', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://127.0.0.1:3100';
    const calls = [];

    await mockAdminBootApis(page, {
      onAutoClaimRewards({ body }) {
        calls.push(body);
      },
    });
    await applyAdminCookie(page, baseURL);

    await page.goto('/admin');
    await page.getByRole('button', { name: /퀘스트/ }).click();

    await expect(page.locator('#growthOperationalStatus')).toContainText('미수령 완료 보상 자동 수령');
    await page.fill('#growthAutoClaimLimit', '12');
    await page.click('#growthAutoClaimPreviewBtn');

    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ limit: 12, dry_run: true });
    await expect(page.locator('#growthAutoClaimResult')).toContainText('대상 1건');
    await expect(page.locator('#growthAutoClaimResult')).toContainText('봄 시즌');

    page.once('dialog', (dialog) => dialog.accept());
    await page.click('#growthAutoClaimRunBtn');

    await expect.poll(() => calls.length).toBe(2);
    expect(calls[1]).toMatchObject({ limit: 12, dry_run: false });
    await expect(page.locator('#growthAutoClaimResult')).toContainText('실행 완료');
    await expect(page.locator('#growthAutoClaimResult')).toContainText('수령 1건');
    await expect(page.locator('#growthAutoClaimResult')).toContainText('+20 XP');
  });

  test('shows daily writing project and queues its prompt push from quests admin UI', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://127.0.0.1:3100';
    const calls = [];

    await mockAdminBootApis(page, {
      onMarketingPushCampaign({ body }) {
        calls.push(body);
      },
    });
    await applyAdminCookie(page, baseURL);

    await page.goto('/admin');
    await page.getByRole('button', { name: /퀘스트/ }).click();

    await expect(page.locator('#writingCampaignProject')).toContainText('글숲 한달 글쓰기 프로젝트');
    await expect(page.locator('#writingCampaignProject')).toContainText('30일 주제 목록');
    await expect(page.locator('#writingCampaignProject')).toContainText('오늘 주제 푸시');

    await page.click('#writingCampaignPushPreviewBtn');

    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toMatchObject({
      include_ad_label: false,
      dry_run: true,
      campaign_kind: 'daily_writing_project_prompt',
    });
    expect(calls[0].target_path).toContain('/write?campaignPromptKey=');
    await expect(page.locator('#writingCampaignProject')).toContainText('대상 확인 완료');

    page.once('dialog', (dialog) => dialog.accept());
    await page.click('#writingCampaignPushSendBtn');

    await expect.poll(() => calls.length).toBe(2);
    expect(calls[1]).toMatchObject({
      include_ad_label: false,
      dry_run: false,
      campaign_kind: 'daily_writing_project_prompt',
    });
    expect(calls[1].campaign_key).toContain('glsoop-monthly-writing-project-prototype');
  });

  test('previews and queues marketing push from the push admin UI', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://127.0.0.1:3100';
    const calls = [];

    await mockAdminBootApis(page, {
      onMarketingPushCampaign({ body }) {
        calls.push(body);
      },
    });
    await applyAdminCookie(page, baseURL);

    await page.goto('/admin');
    await page.getByRole('button', { name: /푸시/ }).click();

    await expect(page.locator('#pushTab')).toBeVisible();
    await expect(page.locator('#adminPushControls')).toContainText('활성 푸시 토큰 2개');
    await expect(page.locator('#adminPushControls')).toContainText('최근 푸시 알림');
    await expect(page.locator('#adminPushControls')).toContainText('새 독자가 생겼어요');
    await expect(page.locator('#adminPushControls')).toContainText('수신 동의 사용자');
    await expect(page.locator('#adminPushControls')).toContainText('글쓴이');

    await page.fill('#adminPushTitle', '이번 주 글쓰기 리마인드');
    await page.fill('#adminPushBody', '조용히 남겨둘 문장을 한 편 써보세요.');
    await expect(page.locator('input[name="include_ad_label"]')).toBeChecked();
    await page.locator('input[name="include_ad_label"]').uncheck();
    await page.click('#adminPushForm button[type="submit"]');

    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toMatchObject({
      title: '이번 주 글쓰기 리마인드',
      body: '조용히 남겨둘 문장을 한 편 써보세요.',
      target_path: '/write',
      include_ad_label: false,
      dry_run: true,
    });
    await expect(page.locator('#adminPushControls')).toContainText('대상 확인 완료');

    page.once('dialog', (dialog) => dialog.accept());
    await page.click('#adminPushSendBtn');

    await expect.poll(() => calls.length).toBe(2);
    expect(calls[1]).toMatchObject({
      title: '이번 주 글쓰기 리마인드',
      body: '조용히 남겨둘 문장을 한 편 써보세요.',
      target_path: '/write',
      include_ad_label: false,
      dry_run: false,
    });
    await expect(page.locator('#adminPushControls')).toContainText('이번 주 글쓰기 리마인드');
    await expect(page.locator('#adminPushControls')).not.toContainText('(광고) 이번 주 글쓰기 리마인드');
    await expect(page.locator('#adminPushControls')).toContainText('2');
  });

  test('opens admin post detail links with postId query parameter', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://127.0.0.1:3100';

    await mockAdminBootApis(page);
    await applyAdminCookie(page, baseURL);

    await page.goto('/admin');
    await page.locator('.admin-tabs .nav-link[data-target="postsTab"]').click();

    const [postPreviewPage] = await Promise.all([
      page.waitForEvent('popup'),
      page.locator('#adminPosts .admin-post-card__preview').click(),
    ]);
    await expect(postPreviewPage).toHaveURL(/\/html\/post\.html\?postId=11$/);
    await postPreviewPage.close();

    await page.locator('.admin-tabs .nav-link[data-target="safetyTab"]').click();
    const [reportedPostPage] = await Promise.all([
      page.waitForEvent('popup'),
      page.locator('#adminReportedPosts [data-reported-post-action="open-post"]').click(),
    ]);
    await expect(reportedPostPage).toHaveURL(/\/html\/post\.html\?postId=11$/);
    await reportedPostPage.close();
  });

  test('resolves reported posts from the safety tab UI', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://127.0.0.1:3100';
    let resolveCalls = 0;
    let resolvePayload = null;

    await mockAdminBootApis(page, {
      onResolveReportedPost({ body }) {
        resolveCalls += 1;
        resolvePayload = body;
      },
    });
    await applyAdminCookie(page, baseURL);

    await page.goto('/admin');
    await page.getByRole('button', { name: /신고/ }).click();

    await page.locator('#adminReportedPosts [data-reported-post-action="dismissed"]').click();

    await expect.poll(() => resolveCalls).toBe(1);
    expect(resolvePayload).toMatchObject({
      status: 'dismissed',
      action: 'no_violation',
    });
    await expect(page.locator('#adminReportedPosts')).toContainText('누적 신고 5건 이상인 글이 없습니다.');
  });

  test('deletes reported posts through the safety tab danger confirmation', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://127.0.0.1:3100';
    let deleteCalls = 0;

    await mockAdminBootApis(page, {
      onDeleteReportedPost() {
        deleteCalls += 1;
      },
    });
    await applyAdminCookie(page, baseURL);

    await page.goto('/admin');
    await page.getByRole('button', { name: /신고/ }).click();

    await page.locator('#adminReportedPosts [data-reported-post-action="delete-post"]').click();
    await expect(page.locator('#adminDangerConfirmModal')).toBeVisible();
    await expect(page.locator('#adminDangerConfirmBtn')).toBeDisabled();

    await page.fill('#adminDangerInput', 'DELETE');
    await expect(page.locator('#adminDangerConfirmBtn')).toBeEnabled();
    await page.click('#adminDangerConfirmBtn');

    await expect.poll(() => deleteCalls).toBe(1);
    await expect(page.locator('#adminReportedPosts')).toContainText('누적 신고 5건 이상인 글이 없습니다.');
  });
});
