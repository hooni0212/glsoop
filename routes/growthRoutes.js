const express = require('express');
const { authRequired } = require('../middleware/auth');
const {
  addXp,
  fetchGrowthSummary,
  fetchUserAchievements,
} = require('../utils/growth');
const { getActiveQuestsForUser } = require('../utils/questService');
const db = require('../db');

function sendGrowthError(res, status, code, message) {
  return res.status(status).json({ ok: false, code, message });
}

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
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

function mapAchievements(achievements = []) {
  return achievements.map((item) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    description: item.description,
    category: item.category,
    status: item.status,
    progress: item.progress,
    target: item.target,
    unlocked_at: item.unlockedAt,
    position_index: item.positionIndex,
    icon: item.icon,
  }));
}

function mapCampaigns(campaigns = []) {
  return campaigns.map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    description: campaign.description,
    campaign_type: campaign.campaignType,
    start_at: campaign.startAt,
    end_at: campaign.endAt,
    quests: (campaign.quests || []).map((quest) => ({
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
    })),
  }));
}

function toExcerpt(content, maxLength = 100) {
  const normalized = String(content || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
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
    excerpt: toExcerpt(item.content),
    author_name: item.author_name || '',
    category: normalizeTopPostCategory(item.category),
    created_at: item.created_at || null,
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
        u.name AS author_name,
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

const router = express.Router();

router.get('/growth/dashboard', authRequired, async (req, res) => {
  try {
    const [summary, achievements, campaigns, topPosts] = await Promise.all([
      fetchGrowthSummary(req.user.id),
      fetchUserAchievements(req.user.id),
      getActiveQuestsForUser(req.user.id),
      fetchGrowthTopPosts(),
    ]);

    return res.json({
      ok: true,
      message: '성장 대시보드 정보를 불러왔습니다.',
      summary: mapSummary(summary),
      achievements: mapAchievements(achievements),
      campaigns: mapCampaigns(campaigns),
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
    return res.json({
      ok: true,
      message: '업적 정보를 불러왔습니다.',
      achievements: mapAchievements(achievements),
    });
  } catch (error) {
    console.error('growth achievements error:', error);
    return sendGrowthError(res, 500, 'INTERNAL_ERROR', '업적 정보를 불러오지 못했습니다.');
  }
});

router.get('/quests/active', authRequired, async (req, res) => {
  try {
    const campaigns = await getActiveQuestsForUser(req.user.id);
    return res.json({
      ok: true,
      message: '활성 퀘스트를 불러왔습니다.',
      campaigns: mapCampaigns(campaigns),
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

  const nowIso = new Date().toISOString();
  try {
    await runAsync('BEGIN IMMEDIATE;');
    const state = await getAsync(
      `SELECT uqs.id, uqs.user_id, uqs.completed_at, uqs.reward_claimed_at, uqs.template_id, uqs.campaign_id,
              qt.reward_xp
       FROM user_quest_state uqs
       JOIN quest_templates qt ON qt.id = uqs.template_id
       WHERE uqs.id = ? AND uqs.user_id = ?`,
      [stateId, req.user.id]
    );

    if (!state) {
      await runAsync('ROLLBACK;');
      return sendGrowthError(res, 404, 'RESOURCE_NOT_FOUND', '퀘스트 상태를 찾을 수 없습니다.');
    }

    if (!state.completed_at) {
      await runAsync('ROLLBACK;');
      return sendGrowthError(
        res,
        400,
        'INVALID_REQUEST',
        '아직 완료되지 않은 퀘스트입니다.'
      );
    }

    if (state.reward_claimed_at) {
      await runAsync('ROLLBACK;');
      return sendGrowthError(res, 409, 'CONFLICT', '이미 보상을 받았습니다.');
    }

    await runAsync(
      'UPDATE user_quest_state SET reward_claimed_at = ? WHERE id = ?',
      [nowIso, stateId]
    );

    const rewardXp = Number(state.reward_xp) || 0;
    const gainedXp =
      rewardXp > 0
        ? await addXp(req.user.id, rewardXp, 'QUEST_REWARD', {
            stateId,
            templateId: state.template_id,
            campaignId: state.campaign_id,
          })
        : 0;

    const updated = await getAsync('SELECT xp FROM users WHERE id = ?', [req.user.id]);
    const newXp = updated?.xp || 0;

    await runAsync('COMMIT;');
    return res.json({
      ok: true,
      reward_claimed_at: nowIso,
      gained_xp: gainedXp,
      new_xp: newXp,
    });
  } catch (error) {
    try {
      await runAsync('ROLLBACK;');
    } catch (rollbackError) {
      console.error('claim rollback failed:', rollbackError);
    }
    console.error('claim reward error:', error);
    return sendGrowthError(res, 500, 'INTERNAL_ERROR', '보상 지급 중 오류가 발생했습니다.');
  }
});

module.exports = router;
