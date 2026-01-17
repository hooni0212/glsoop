const express = require('express');
const { authRequired } = require('../middleware/auth');
const {
  fetchGrowthSummary,
  fetchUserAchievements,
} = require('../utils/growth');
const { getActiveQuestsForUser } = require('../utils/questService');

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

module.exports = router;
