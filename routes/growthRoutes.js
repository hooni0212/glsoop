const express = require('express');
const { authRequired } = require('../middleware/auth');
const {
  fetchGrowthSummary,
  fetchUserAchievements,
} = require('../utils/growth');
const { getActiveQuestsForUser } = require('../utils/questService');
const { computeLevelFromXp } = require('../utils/growth');
const db = require('../db');

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

const router = express.Router();

router.get('/growth/summary', authRequired, async (req, res) => {
  try {
    const summary = await fetchGrowthSummary(req.user.id);
    return res.json({
      ok: true,
      message: '성장 요약 정보를 불러왔습니다.',
      summary: {
        level: summary.level,
        current_xp: summary.currentXp,
        next_level_xp: summary.nextLevelXp,
        today_xp: summary.todayXp,
        weekly_posts: summary.weeklyPosts,
        streak_days: summary.streakDays,
        max_streak_days: summary.maxStreakDays,
        title: summary.title,
      },
    });
  } catch (error) {
    console.error('growth summary error:', error);
    return res
      .status(500)
      .json({ ok: false, message: '성장 요약 정보를 불러오지 못했습니다.' });
  }
});

router.get('/growth/achievements', authRequired, async (req, res) => {
  try {
    const achievements = await fetchUserAchievements(req.user.id);
    const payload = (achievements || []).map((item) => ({
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
    return res.json({
      ok: true,
      message: '업적 정보를 불러왔습니다.',
      achievements: payload,
    });
  } catch (error) {
    console.error('growth achievements error:', error);
    return res
      .status(500)
      .json({ ok: false, message: '업적 정보를 불러오지 못했습니다.' });
  }
});

router.get('/quests/active', authRequired, async (req, res) => {
  try {
    const campaigns = await getActiveQuestsForUser(req.user.id);
    const payload = (campaigns || []).map((campaign) => ({
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
    return res.json({
      ok: true,
      message: '활성 퀘스트를 불러왔습니다.',
      campaigns: payload,
    });
  } catch (error) {
    console.error('active quests error:', error);
    return res
      .status(500)
      .json({ ok: false, message: '활성 퀘스트를 불러오지 못했습니다.' });
  }
});

router.post('/quests/:stateId/claim', authRequired, async (req, res) => {
  const stateId = Number(req.params.stateId);
  if (!Number.isFinite(stateId)) {
    return res.status(400).json({ ok: false, message: '올바르지 않은 stateId입니다.' });
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
      return res.status(404).json({ ok: false, message: '퀘스트 상태를 찾을 수 없습니다.' });
    }

    if (!state.completed_at) {
      await runAsync('ROLLBACK;');
      return res.status(400).json({ ok: false, message: '아직 완료되지 않은 퀘스트입니다.' });
    }

    if (state.reward_claimed_at) {
      await runAsync('ROLLBACK;');
      return res.status(409).json({ ok: false, message: '이미 보상을 받았습니다.' });
    }

    await runAsync(
      'UPDATE user_quest_state SET reward_claimed_at = ? WHERE id = ?',
      [nowIso, stateId]
    );

    const rewardXp = Number(state.reward_xp) || 0;
    let newXp = null;
    if (rewardXp > 0) {
      await runAsync(
        'INSERT INTO xp_log (user_id, delta, reason, meta, created_at) VALUES (?, ?, ?, ?, ?)',
        [
          req.user.id,
          rewardXp,
          'QUEST_REWARD',
          JSON.stringify({
            stateId,
            templateId: state.template_id,
            campaignId: state.campaign_id,
          }),
          nowIso,
        ]
      );
      await runAsync('UPDATE users SET xp = COALESCE(xp, 0) + ? WHERE id = ?', [
        rewardXp,
        req.user.id,
      ]);
      const updated = await getAsync('SELECT xp FROM users WHERE id = ?', [req.user.id]);
      newXp = updated?.xp || 0;
      const { level } = computeLevelFromXp(newXp);
      await runAsync('UPDATE users SET level = ? WHERE id = ?', [level, req.user.id]);
    } else {
      const updated = await getAsync('SELECT xp FROM users WHERE id = ?', [req.user.id]);
      newXp = updated?.xp || 0;
    }

    await runAsync('COMMIT;');
    return res.json({
      ok: true,
      reward_claimed_at: nowIso,
      gained_xp: rewardXp,
      new_xp: newXp,
    });
  } catch (error) {
    try {
      await runAsync('ROLLBACK;');
    } catch (rollbackError) {
      console.error('claim rollback failed:', rollbackError);
    }
    console.error('claim reward error:', error);
    return res.status(500).json({ ok: false, message: '보상 지급 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
