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
    return res.json({ ok: true, summary });
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
    return res.json({ ok: true, achievements });
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
    return res.json({ ok: true, campaigns });
  } catch (error) {
    console.error('active quests error:', error);
    return res
      .status(500)
      .json({ ok: false, message: '활성 퀘스트를 불러오지 못했습니다.' });
  }
});

module.exports = router;
