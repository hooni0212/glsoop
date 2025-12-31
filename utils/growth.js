const db = require('../db');

const LEVEL_STEP = 50;

const XP_RULES = {
  postCreate: 20,
  firstPostToday: 30,
  likeGiven: { delta: 1, dailyCap: 20 },
  likeReceived: { delta: 2, dailyCap: 30 },
  bookmarkReceived: { delta: 3, dailyCap: 30 },
};

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function computeLevelFromXp(totalXp = 0) {
  let level = 1;
  let threshold = LEVEL_STEP;
  let spent = 0;

  while (totalXp >= spent + threshold) {
    spent += threshold;
    level += 1;
    threshold += LEVEL_STEP;
  }

  const nextLevelXp = spent + threshold;
  return {
    level,
    currentXp: totalXp,
    nextLevelXp,
    xpIntoLevel: totalXp - spent,
    xpForNextLevel: threshold,
  };
}

function getKstDate(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000);
}

function getKstDateString(date = new Date()) {
  return getKstDate(date).toISOString().slice(0, 10);
}

function getKstTimestamp(date = new Date()) {
  // ISO 문자열을 SQLite에서 localtime과 일관되게 사용하기 위해 Z를 제거
  return getKstDate(date).toISOString().replace('Z', '');
}

async function addXp(userId, delta, reason, meta = null, options = {}) {
  const safeDelta = Number.isFinite(delta) ? delta : 0;
  if (!safeDelta || safeDelta <= 0) return 0;

  let applied = safeDelta;
  const capReason = options.capReason || reason;
  if (options.dailyCap) {
    const today = getKstDateString();
    const row = await dbGet(
      'SELECT COALESCE(SUM(delta), 0) AS total FROM xp_log WHERE user_id = ? AND DATE(created_at) = ? AND reason = ?',
      [userId, today, capReason]
    );
    const used = row ? row.total || 0 : 0;
    const remaining = Math.max(options.dailyCap - used, 0);
    applied = Math.min(applied, remaining);
  }

  if (applied <= 0) return 0;

  await dbRun(
    'INSERT INTO xp_log (user_id, delta, reason, meta, created_at) VALUES (?, ?, ?, ?, ?)',
    [userId, applied, reason, meta ? JSON.stringify(meta) : null, getKstTimestamp()]
  );

  await dbRun('UPDATE users SET xp = COALESCE(xp, 0) + ? WHERE id = ?', [applied, userId]);
  const updated = await dbGet('SELECT xp FROM users WHERE id = ?', [userId]);
  if (updated) {
    const { level } = computeLevelFromXp(updated.xp || 0);
    await dbRun('UPDATE users SET level = ? WHERE id = ?', [level, userId]);
  }

  return applied;
}

async function updateStreakOnPost(userId) {
  const todayStr = getKstDateString();
  const yesterdayStr = getKstDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));

  const row = await dbGet(
    'SELECT streak_days, max_streak_days, last_post_date FROM users WHERE id = ?',
    [userId]
  );

  let streakDays = row?.streak_days || 0;
  let maxStreakDays = row?.max_streak_days || 0;
  const lastPostDate = row?.last_post_date;

  if (lastPostDate === todayStr) {
    // 이미 오늘 기록 있음
  } else if (lastPostDate === yesterdayStr) {
    streakDays = (streakDays || 0) + 1;
  } else {
    streakDays = 1;
  }

  maxStreakDays = Math.max(maxStreakDays || 0, streakDays);

  await dbRun(
    'UPDATE users SET streak_days = ?, max_streak_days = ?, last_post_date = ? WHERE id = ?',
    [streakDays, maxStreakDays, todayStr, userId]
  );

  return {
    streakDays,
    maxStreakDays,
    isFirstPostToday: lastPostDate !== todayStr,
  };
}

async function getUserPostCount(userId) {
  const row = await dbGet('SELECT COUNT(*) AS cnt FROM posts WHERE user_id = ?', [userId]);
  return row?.cnt || 0;
}

async function getUserLikesReceived(userId) {
  const row = await dbGet(
    `SELECT COUNT(*) AS cnt
     FROM likes l
     JOIN posts p ON l.post_id = p.id
     WHERE p.user_id = ?`,
    [userId]
  );
  return row?.cnt || 0;
}

async function getPostLikeCount(postId) {
  const row = await dbGet('SELECT COUNT(*) AS cnt FROM likes WHERE post_id = ?', [postId]);
  return row?.cnt || 0;
}

async function getPostBookmarkCountForAuthor(userId) {
  const row = await dbGet(
    `SELECT COUNT(*) AS cnt
     FROM bookmark_items bi
     JOIN posts p ON bi.post_id = p.id
     WHERE p.user_id = ?`,
    [userId]
  );
  return row?.cnt || 0;
}

async function ensureUserAchievementRow(userId, achievementId, progressValue, unlockedAt) {
  const existing = await dbGet(
    'SELECT id, progress_value, unlocked_at FROM user_achievements WHERE user_id = ? AND achievement_id = ?',
    [userId, achievementId]
  );

  const nextProgress = Math.max(progressValue || 0, existing?.progress_value || 0);
  const shouldUnlock = !existing?.unlocked_at && unlockedAt;

  if (!existing) {
    await dbRun(
      'INSERT INTO user_achievements (user_id, achievement_id, progress_value, unlocked_at) VALUES (?, ?, ?, ?)',
      [userId, achievementId, nextProgress, unlockedAt || null]
    );
    return;
  }

  await dbRun(
    'UPDATE user_achievements SET progress_value = ?, unlocked_at = COALESCE(unlocked_at, ?) WHERE id = ?',
    [nextProgress, shouldUnlock ? unlockedAt : null, existing.id]
  );
}

async function updateAchievementProgress(userId, code, progressValue) {
  const achievement = await dbGet(
    'SELECT id, target_value FROM achievements WHERE code = ?',
    [code]
  );
  if (!achievement) return;

  const unlockedAt = progressValue >= achievement.target_value ? new Date().toISOString() : null;
  await ensureUserAchievementRow(userId, achievement.id, progressValue, unlockedAt);
}

async function handlePostCreated(userId, postId) {
  await addXp(userId, XP_RULES.postCreate, 'post_create', { postId });
  const streakInfo = await updateStreakOnPost(userId);
  if (streakInfo.isFirstPostToday) {
    await addXp(userId, XP_RULES.firstPostToday, 'first_post_today', { postId }, {
      dailyCap: XP_RULES.firstPostToday,
    });
  }

  const postCount = await getUserPostCount(userId);
  await updateAchievementProgress(userId, 'first_post', postCount);
  await updateAchievementProgress(userId, 'posts_10', postCount);
  await updateAchievementProgress(userId, 'posts_50', postCount);
  await updateAchievementProgress(userId, 'streak_3', streakInfo.streakDays);
  await updateAchievementProgress(userId, 'streak_7', streakInfo.streakDays);
  await updateAchievementProgress(userId, 'streak_30', streakInfo.streakDays);
}

async function handleLikeAdded(likerId, postAuthorId, postId) {
  await addXp(
    likerId,
    XP_RULES.likeGiven.delta,
    'like_given',
    { postId },
    { dailyCap: XP_RULES.likeGiven.dailyCap }
  );

  if (postAuthorId) {
    await addXp(
      postAuthorId,
      XP_RULES.likeReceived.delta,
      'like_received',
      { postId, from: likerId },
      { dailyCap: XP_RULES.likeReceived.dailyCap }
    );

    const totalLikes = await getUserLikesReceived(postAuthorId);
    const postLikeCount = await getPostLikeCount(postId);
    await updateAchievementProgress(postAuthorId, 'first_like', totalLikes);
    await updateAchievementProgress(postAuthorId, 'likes_10_single', postLikeCount);
  }
}

async function handleBookmarkAdded(bookmarkerId, postAuthorId, postId, inserted) {
  if (!inserted || !postAuthorId) return;
  await addXp(
    postAuthorId,
    XP_RULES.bookmarkReceived.delta,
    'bookmark_received',
    { postId, from: bookmarkerId },
    { dailyCap: XP_RULES.bookmarkReceived.dailyCap }
  );

  const bookmarkCount = await getPostBookmarkCountForAuthor(postAuthorId);
  await updateAchievementProgress(postAuthorId, 'first_bookmark', bookmarkCount);
}

async function fetchGrowthSummary(userId) {
  const user = await dbGet(
    'SELECT xp, level, streak_days, max_streak_days FROM users WHERE id = ?',
    [userId]
  );
  const totalXp = user?.xp || 0;
  const streakDays = user?.streak_days || 0;
  const maxStreakDays = user?.max_streak_days || 0;
  const levelInfo = computeLevelFromXp(totalXp);

  const todayStr = getKstDateString();
  const sevenDaysAgoKst = getKstTimestamp(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

  const todayXpRow = await dbGet(
    'SELECT COALESCE(SUM(delta), 0) AS total FROM xp_log WHERE user_id = ? AND DATE(created_at) = ?',
    [userId, todayStr]
  );
  const todayXp = todayXpRow?.total || 0;

  const weeklyPostsRow = await dbGet(
    'SELECT COUNT(*) AS cnt FROM posts WHERE user_id = ? AND datetime(created_at, "+9 hours") >= datetime(?, "+0 seconds")',
    [userId, sevenDaysAgoKst]
  );

  return {
    level: levelInfo.level,
    currentXp: levelInfo.currentXp,
    nextLevelXp: levelInfo.nextLevelXp,
    xpIntoLevel: levelInfo.xpIntoLevel,
    xpForNextLevel: levelInfo.xpForNextLevel,
    todayXp,
    weeklyPosts: weeklyPostsRow?.cnt || 0,
    streakDays,
    maxStreakDays,
    title: levelInfo.level >= 10 ? '숲의 수호자' : levelInfo.level >= 5 ? '푸른 가지' : '새싹',
  };
}

async function fetchUserAchievements(userId) {
  const rows = await dbAll(
    `SELECT a.*, ua.progress_value, ua.unlocked_at
     FROM achievements a
     LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = ?
     ORDER BY a.position_index ASC, a.id ASC`,
    [userId]
  );

  return rows.map((row) => {
    let status = 'locked';
    if (row.unlocked_at) {
      status = 'completed';
    } else if (row.progress_value > 0) {
      status = 'in_progress';
    }
    const extras = row.extra_json ? safeJsonParse(row.extra_json) : {};
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      category: row.category,
      status,
      progress: row.progress_value || 0,
      target: row.target_value,
      unlockedAt: row.unlocked_at || null,
      positionIndex: row.position_index || 0,
      icon: extras.icon || '🌿',
    };
  });
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return {};
  }
}

module.exports = {
  computeLevelFromXp,
  addXp,
  updateStreakOnPost,
  handlePostCreated,
  handleLikeAdded,
  handleBookmarkAdded,
  fetchGrowthSummary,
  fetchUserAchievements,
};
