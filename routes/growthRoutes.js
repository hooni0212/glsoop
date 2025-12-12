const express = require('express');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

function buildMockSummary(userId) {
  // Placeholder summary; in future, pull from DB
  return {
    userId,
    level: 3,
    currentXp: 180,
    nextLevelXp: 250,
    todayXp: 35,
    weeklyPosts: 3,
    streakDays: 5,
    maxStreakDays: 9,
    title: '작은 묘목',
  };
}

function buildMockAchievements(userId) {
  // In a real implementation, these would be fetched per-user
  return [
    {
      id: 1,
      code: 'first_post',
      name: '첫 걸음',
      description: '첫 글을 작성했습니다.',
      category: 'habit',
      status: 'completed',
      progress: 1,
      target: 1,
      unlockedAt: '2025-12-01',
      positionIndex: 1,
      icon: '🌱',
    },
    {
      id: 2,
      code: 'posts_10',
      name: '조심스러운 시작',
      description: '글 10개를 작성했습니다.',
      category: 'count_posts',
      status: 'in_progress',
      progress: 7,
      target: 10,
      unlockedAt: null,
      positionIndex: 2,
      icon: '🌿',
    },
    {
      id: 3,
      code: 'streak_7',
      name: '꾸준한 발걸음',
      description: '연속 7일 글을 작성했습니다.',
      category: 'streak',
      status: 'locked',
      progress: 5,
      target: 7,
      unlockedAt: null,
      positionIndex: 3,
      icon: '🔥',
    },
    {
      id: 4,
      code: 'likes_50',
      name: '따뜻한 공감',
      description: '내 글이 50개의 공감을 받았습니다.',
      category: 'likes',
      status: 'completed',
      progress: 50,
      target: 50,
      unlockedAt: '2025-12-03',
      positionIndex: 4,
      icon: '✨',
    },
  ].map((achievement, idx) => ({
    ...achievement,
    positionIndex: achievement.positionIndex || idx + 1,
  }));
}

router.get('/growth/summary', authRequired, (req, res) => {
  const summary = buildMockSummary(req.user.id);
  res.json({ ok: true, summary });
});

router.get('/growth/achievements', authRequired, (req, res) => {
  const achievements = buildMockAchievements(req.user.id);
  res.json({ ok: true, achievements });
});

module.exports = router;
