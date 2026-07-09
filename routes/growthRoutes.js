const express = require('express');
const { authRequired } = require('../middleware/auth');
const {
  fetchGrowthSummary,
  fetchUserAchievements,
} = require('../utils/growth-service');
const { buildPublicDisplayName } = require('../utils/accountLifecycle');
const { getActiveQuestsForUser } = require('../utils/questService');
const { buildPostExcerpt } = require('../utils/postPreview');
const {
  QuestRewardClaimError,
  buildQuestLockState,
  claimQuestReward,
  collectRewardCosmeticKeys,
  fetchActiveEntitlementKeySet,
  fetchRewardCosmeticMap,
  getRewardCosmeticPayload,
} = require('../utils/questRewardClaimService');
const { normalizeUtcDateTime } = require('../utils/dateTime');
const {
  DAILY_WRITING_CAMPAIGN_KEY,
  getWritingEventDefinition,
  getWritingEventProgressSteps,
  getWritingEventStatus,
} = require('../utils/dailyWritingCampaign');
const db = require('../db');

function sendGrowthError(res, status, code, message) {
  return res.status(status).json({ ok: false, code, message });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function mapSummary(summary) {
  return {
    level: summary.level,
    current_xp: summary.currentXp,
    next_level_xp: summary.nextLevelXp,
    today_xp: summary.todayXp,
    weekly_posts: summary.weeklyPosts,
    streak_days: summary.streakDays,
    max_streak_days: summary.maxStreakDays,
    title: summary.title,
  };
}

async function mapAchievements(achievements = []) {
  const rewardCosmeticByKey = await fetchRewardCosmeticMap(
    collectRewardCosmeticKeys(achievements, (item) => item?.uiJson)
  );

  return achievements.map((item) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    description: item.description,
    category: item.category,
    status: item.status,
    progress: item.progress,
    target: item.target,
    state_id: item.stateId,
    unlocked_at: item.unlockedAt,
    reward_claimed_at: item.rewardClaimedAt,
    position_index: item.positionIndex,
    icon: item.icon,
    ui_json: item.uiJson,
    ...getRewardCosmeticPayload(item.uiJson, rewardCosmeticByKey),
  }));
}

async function mapCampaigns(campaigns = [], entitlementKeySet = new Set()) {
  const quests = campaigns.flatMap((campaign) => campaign.quests || []);
  const rewardCosmeticByKey = await fetchRewardCosmeticMap(
    collectRewardCosmeticKeys(quests, (quest) => quest?.uiJson)
  );

  return campaigns.map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    description: campaign.description,
    campaign_type: campaign.campaignType,
    start_at: campaign.startAt,
    end_at: campaign.endAt,
    quests: (campaign.quests || []).map((quest) => ({
      ...buildQuestLockState(quest, entitlementKeySet),
      id: quest.id,
      state_id: quest.stateId,
      name: quest.name,
      description: quest.description,
      condition_type: quest.conditionType,
      category: quest.category,
      target: quest.target,
      reward_xp: quest.rewardXp,
      status: quest.status,
      progress: quest.progress,
      position_index: quest.positionIndex,
      campaign_id: quest.campaignId,
      campaign_type: quest.campaignType,
      template_kind: quest.templateKind,
      code: quest.code,
      ui_json: quest.uiJson,
      completed_at: quest.completedAt,
      reward_claimed_at: quest.rewardClaimedAt,
      ...getRewardCosmeticPayload(quest.uiJson, rewardCosmeticByKey),
    })),
  }));
}

function normalizeTopPostCategory(category) {
  const normalized = String(category || '').trim().toLowerCase();
  if (normalized === 'poem' || normalized === 'essay' || normalized === 'short') {
    return normalized;
  }
  return 'short';
}

function mapTopPosts(posts = []) {
  return posts.map((item) => ({
    id: item.id,
    title: item.title,
    excerpt: buildPostExcerpt(item.content, 100),
    author_display_name: buildPublicDisplayName(
      item.author_nickname,
      item.author_account_status
    ),
    author_name: buildPublicDisplayName(
      item.author_nickname,
      item.author_account_status
    ),
    category: normalizeTopPostCategory(item.category),
    created_at: item.created_at ? normalizeUtcDateTime(item.created_at) : null,
    like_count: Number(item.like_count) || 0,
    bookmark_count: Number(item.bookmark_count) || 0,
  }));
}

async function fetchGrowthTopPosts(limit = 3) {
  const parsedLimit = Number(limit);
  const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(10, Math.floor(parsedLimit))
    : 3;

  return allAsync(
    `
      SELECT
        p.id,
        p.title,
        p.content,
        p.category,
        p.created_at,
        u.nickname AS author_nickname,
        COALESCE(u.account_status, 'active') AS author_account_status,
        IFNULL(lc.like_count, 0) AS like_count,
        IFNULL(bc.bookmark_count, 0) AS bookmark_count
      FROM posts p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN (
        SELECT post_id, COUNT(*) AS like_count
        FROM likes
        GROUP BY post_id
      ) lc ON lc.post_id = p.id
      LEFT JOIN (
        SELECT bi.post_id, COUNT(DISTINCT bl.user_id) AS bookmark_count
        FROM bookmark_items bi
        JOIN bookmark_lists bl ON bl.id = bi.list_id
        GROUP BY bi.post_id
      ) bc ON bc.post_id = p.id
      ORDER BY IFNULL(lc.like_count, 0) DESC, IFNULL(bc.bookmark_count, 0) DESC, p.created_at DESC
      LIMIT ?
    `,
    [safeLimit]
  );
}

function normalizeEventKey(input) {
  const value = typeof input === 'string' ? input.trim() : '';
  return value.slice(0, 160);
}

async function fetchUserWritingEventPosts(userId, eventKey, limit = 12) {
  const parsedLimit = Number(limit);
  const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(30, Math.floor(parsedLimit))
    : 12;

  return allAsync(
    `
      SELECT
        p.id,
        p.title,
        p.content,
        p.category,
        p.created_at,
        ctx.event_key,
        ctx.event_title,
        ctx.prompt_key,
        ctx.prompt_day,
        ctx.prompt_title,
        ctx.prompt_body
      FROM post_writing_event_contexts ctx
      JOIN posts p ON p.id = ctx.post_id
      WHERE ctx.user_id = ?
        AND ctx.event_key = ?
      ORDER BY COALESCE(ctx.prompt_day, 9999) ASC, datetime(p.created_at) ASC, p.id ASC
      LIMIT ?
    `,
    [userId, eventKey, safeLimit]
  );
}

function mapWritingEventPosts(posts = []) {
  return posts.map((item) => ({
    id: item.id,
    title: item.title || '제목 없는 글',
    excerpt: buildPostExcerpt(item.content, 86),
    category: normalizeTopPostCategory(item.category),
    created_at: item.created_at ? normalizeUtcDateTime(item.created_at) : null,
    event_key: item.event_key,
    event_title: item.event_title || null,
    prompt_key: item.prompt_key,
    prompt_day: Number(item.prompt_day) || null,
    prompt_title: item.prompt_title || null,
    prompt_body: item.prompt_body || null,
  }));
}

const router = express.Router();

router.get('/writing-events/:eventKey', (req, res) => {
  const eventKey = normalizeEventKey(req.params.eventKey || DAILY_WRITING_CAMPAIGN_KEY);
  const event = eventKey ? getWritingEventDefinition(eventKey) : null;
  if (!event) {
    return sendGrowthError(
      res,
      404,
      'WRITING_EVENT_NOT_FOUND',
      '해당 글쓰기 이벤트를 찾을 수 없습니다.'
    );
  }

  const status = getWritingEventStatus(event.key);
  return res.json({
    ok: true,
    event: {
      key: status.campaignKey,
      title: status.title,
      subtitle: status.subtitle,
      active: Boolean(status.active),
      total_days: status.totalDays,
      current_day: status.currentDay,
      completed_days: status.completedDays,
      remaining_days: status.remainingDays,
      progress_percent: status.progressPercent,
      local_date_key: status.localDateKey,
      prompt_label: status.promptLabel,
      write_path: status.writePath,
      prompt_set_key: status.promptSetKey,
      prompt_set_starts_local_date: status.promptSetStartsLocalDate,
      next_prompt_set_key: status.nextPromptSetKey,
      next_prompt_set_starts_local_date: status.nextPromptSetStartsLocalDate,
    },
    today_prompt: status.prompt
      ? {
          ...status.prompt,
          write_path: status.writePath,
        }
      : null,
    prompts: status.active ? status.prompts || event.prompts : [],
    progress_steps: getWritingEventProgressSteps(status),
  });
});

router.get('/writing-events/:eventKey/me/posts', authRequired, async (req, res) => {
  const eventKey = normalizeEventKey(req.params.eventKey || DAILY_WRITING_CAMPAIGN_KEY);
  if (!eventKey) {
    return sendGrowthError(res, 400, 'INVALID_EVENT_KEY', '글쓰기 이벤트 키가 올바르지 않습니다.');
  }

  try {
    const posts = await fetchUserWritingEventPosts(req.user.id, eventKey, req.query.limit || 12);
    return res.json({
      ok: true,
      event_key: eventKey,
      posts: mapWritingEventPosts(posts),
    });
  } catch (error) {
    console.error('writing event posts error:', error);
    return sendGrowthError(
      res,
      500,
      'INTERNAL_ERROR',
      '글쓰기 이벤트 글 목록을 불러오지 못했습니다.'
    );
  }
});

router.get('/growth/dashboard', authRequired, async (req, res) => {
  try {
    const [summary, achievements, campaigns, topPosts, entitlementKeySet] =
      await Promise.all([
        fetchGrowthSummary(req.user.id),
        fetchUserAchievements(req.user.id),
        getActiveQuestsForUser(req.user.id),
        fetchGrowthTopPosts(),
        fetchActiveEntitlementKeySet(req.user.id),
      ]);
    const [mappedAchievements, mappedCampaigns] = await Promise.all([
      mapAchievements(achievements),
      mapCampaigns(campaigns, entitlementKeySet),
    ]);

    return res.json({
      ok: true,
      message: '성장 대시보드 정보를 불러왔습니다.',
      summary: mapSummary(summary),
      achievements: mappedAchievements,
      campaigns: mappedCampaigns,
      top_posts: mapTopPosts(topPosts),
    });
  } catch (error) {
    console.error('growth dashboard error:', error);
    return sendGrowthError(
      res,
      500,
      'INTERNAL_ERROR',
      '성장 대시보드 정보를 불러오지 못했습니다.'
    );
  }
});

router.get('/growth/top-posts', authRequired, async (req, res) => {
  try {
    const topPosts = await fetchGrowthTopPosts(req.query.limit || 3);
    return res.json({
      ok: true,
      message: '인기 글 정보를 불러왔습니다.',
      top_posts: mapTopPosts(topPosts),
    });
  } catch (error) {
    console.error('growth top posts error:', error);
    return sendGrowthError(res, 500, 'INTERNAL_ERROR', '인기 글 정보를 불러오지 못했습니다.');
  }
});

router.get('/growth/summary', authRequired, async (req, res) => {
  try {
    const summary = await fetchGrowthSummary(req.user.id);
    return res.json({
      ok: true,
      message: '성장 요약 정보를 불러왔습니다.',
      summary: mapSummary(summary),
    });
  } catch (error) {
    console.error('growth summary error:', error);
    return sendGrowthError(res, 500, 'INTERNAL_ERROR', '성장 요약 정보를 불러오지 못했습니다.');
  }
});

router.get('/growth/achievements', authRequired, async (req, res) => {
  try {
    const achievements = await fetchUserAchievements(req.user.id);
    const mappedAchievements = await mapAchievements(achievements);
    return res.json({
      ok: true,
      message: '업적 정보를 불러왔습니다.',
      achievements: mappedAchievements,
    });
  } catch (error) {
    console.error('growth achievements error:', error);
    return sendGrowthError(res, 500, 'INTERNAL_ERROR', '업적 정보를 불러오지 못했습니다.');
  }
});

router.get('/quests/active', authRequired, async (req, res) => {
  try {
    const [campaigns, entitlementKeySet] = await Promise.all([
      getActiveQuestsForUser(req.user.id),
      fetchActiveEntitlementKeySet(req.user.id),
    ]);

    return res.json({
      ok: true,
      message: '활성 퀘스트를 불러왔습니다.',
      campaigns: await mapCampaigns(campaigns, entitlementKeySet),
    });
  } catch (error) {
    console.error('active quests error:', error);
    return sendGrowthError(res, 500, 'INTERNAL_ERROR', '활성 퀘스트를 불러오지 못했습니다.');
  }
});

router.post('/quests/:stateId/claim', authRequired, async (req, res) => {
  const stateId = Number(req.params.stateId);
  if (!Number.isFinite(stateId)) {
    return sendGrowthError(res, 400, 'INVALID_REQUEST', '올바르지 않은 stateId입니다.');
  }

  try {
    const result = await claimQuestReward({
      stateId,
      userId: req.user.id,
      source: 'manual',
    });
    return res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    if (error instanceof QuestRewardClaimError) {
      return sendGrowthError(res, error.status, error.code, error.message);
    }
    console.error('claim reward error:', error);
    return sendGrowthError(res, 500, 'INTERNAL_ERROR', '보상 지급 중 오류가 발생했습니다.');
  }
});

module.exports = router;
