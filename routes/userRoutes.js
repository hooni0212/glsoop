// routes/userRoutes.js
// - 사용자 프로필, 팔로우 토글
const express = require('express');

const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { getViewerId } = require('../utils/requestUser');

const router = express.Router();

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

function parseId(value) {
  const num = parseInt(value, 10);
  return Number.isNaN(num) ? null : num;
}

function parseListPagination(query = {}) {
  let limit = parseInt(query.limit, 10);
  let offset = parseInt(query.offset, 10);

  if (Number.isNaN(limit) || limit <= 0 || limit > 50) {
    limit = 20;
  }
  if (Number.isNaN(offset) || offset < 0) {
    offset = 0;
  }

  return { limit, offset };
}

async function applyFollowState(targetUserId, viewerId, shouldFollow) {
  const existing = await dbGet(
    'SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?',
    [viewerId, targetUserId]
  );

  const finalize = async () => {
    const countRow = await dbGet(
      'SELECT COUNT(*) AS follower_count FROM follows WHERE followee_id = ?',
      [targetUserId]
    );
    return {
      following: shouldFollow,
      follower_count: countRow?.follower_count || 0,
    };
  };

  if (shouldFollow) {
    if (!existing) {
      try {
        await dbRun(
          'INSERT INTO follows (follower_id, followee_id) VALUES (?, ?)',
          [viewerId, targetUserId]
        );
      } catch (error) {
        if (error.code !== 'SQLITE_CONSTRAINT') throw error;
      }
    }
    return finalize();
  }

  if (existing) {
    await dbRun(
      'DELETE FROM follows WHERE follower_id = ? AND followee_id = ?',
      [viewerId, targetUserId]
    );
  }
  return finalize();
}

async function buildAuthorProfile(authorId) {
  const user = await dbGet(
    `
    SELECT
      id,
      name,
      nickname,
      email,
      bio,
      about,
      COALESCE(level, 1) AS level
    FROM users
    WHERE id = ?
    `,
    [authorId]
  );
  if (!user) return null;

  const stats = await dbGet(
    `
    SELECT
      COUNT(DISTINCT p.id) AS post_count,
      COUNT(l.post_id)     AS total_likes
    FROM posts p
    LEFT JOIN likes l ON l.post_id = p.id
    WHERE p.user_id = ?
    `,
    [authorId]
  );

  const followStats = await dbGet(
    `
    SELECT
      (SELECT COUNT(*) FROM follows f1 WHERE f1.followee_id = ?) AS follower_count,
      (SELECT COUNT(*) FROM follows f2 WHERE f2.follower_id = ?) AS following_count
    `,
    [authorId, authorId]
  );

  return {
    user,
    post_count: stats?.post_count || 0,
    total_likes: stats?.total_likes || 0,
    follower_count: followStats?.follower_count || 0,
    following_count: followStats?.following_count || 0,
  };
}

function validateFollowTarget(targetUserId, viewerId, res) {
  if (!targetUserId) {
    res.status(400).json({ ok: false, message: '잘못된 요청입니다.' });
    return false;
  }
  if (targetUserId === viewerId) {
    res
      .status(400)
      .json({ ok: false, message: '자기 자신을 팔로우할 수 없습니다.' });
    return false;
  }
  return true;
}

async function ensureUserExists(targetUserId, res) {
  const found = await dbGet('SELECT id FROM users WHERE id = ?', [targetUserId]);
  if (!found) {
    res
      .status(404)
      .json({ ok: false, message: '해당 사용자를 찾을 수 없습니다.' });
    return null;
  }
  return found;
}

// 8-1) 작가 공개 프로필 조회
router.get('/users/:id/profile', async (req, res) => {
  const authorId = parseId(req.params.id);
  if (!authorId) {
    return res.status(400).json({ ok: false, message: '잘못된 작가 ID입니다.' });
  }

  const viewerId = getViewerId(req);

  try {
    const profile = await buildAuthorProfile(authorId);
    if (!profile) {
      return res
        .status(404)
        .json({ ok: false, message: '해당 작가를 찾을 수 없습니다.' });
    }

    const isFollowing = viewerId
      ? !!(await dbGet(
          'SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?',
          [viewerId, authorId]
        ))
      : false;

    return res.json({
      ok: true,
      message: '작가 프로필을 불러왔습니다.',
      user: {
        id: profile.user.id,
        name: profile.user.name,
        nickname: profile.user.nickname,
        email: profile.user.email,
        bio: profile.user.bio || null,
        about: profile.user.about || null,
        level: profile.user.level || 1,
        post_count: profile.post_count,
        total_likes: profile.total_likes,
        follower_count: profile.follower_count,
        following_count: profile.following_count,
      },
      viewer: {
        id: viewerId,
        is_logged_in: !!viewerId,
        is_own_profile: !!viewerId && viewerId === profile.user.id,
        is_following: isFollowing,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      ok: false,
      message: '작가 정보 조회 중 오류가 발생했습니다.',
    });
  }
});

// 8-1-1) 작가 팔로우/언팔로우 토글
router.post('/users/:id/follow', authRequired, async (req, res) => {
  const targetUserId = parseId(req.params.id);
  const viewerId = req.user.id;

  if (!validateFollowTarget(targetUserId, viewerId, res)) return;

  try {
    const foundUser = await ensureUserExists(targetUserId, res);
    if (!foundUser) return;

    const exists = await dbGet(
      'SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?',
      [viewerId, targetUserId]
    );
    const result = await applyFollowState(targetUserId, viewerId, !exists);
    return res.json({
      ok: true,
      message: '팔로우 상태가 업데이트되었습니다.',
      following: result.following,
      follower_count: result.follower_count,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      ok: false,
      message: '팔로우 처리 중 오류가 발생했습니다.',
    });
  }
});

// 8-2) 특정 작가의 글 목록 (무한스크롤용)
router.get('/users/:id/posts', async (req, res) => {
  const authorId = parseId(req.params.id);
  if (!authorId) {
    return res
      .status(400)
      .json({ ok: false, message: '잘못된 작가 ID입니다.' });
  }

  const userId = getViewerId(req);
  const { limit, offset } = parseListPagination(req.query);
  const sortKey = typeof req.query.sort === 'string' ? req.query.sort : 'newest';
  let orderBy = 'p.created_at DESC';

  switch (sortKey) {
    case 'oldest':
      orderBy = 'p.created_at ASC';
      break;
    case 'likes':
      orderBy = 'like_count DESC, p.created_at DESC';
      break;
    case 'newest':
    default:
      orderBy = 'p.created_at DESC';
      break;
  }

  const baseSelect = `
    SELECT
      p.id,
      p.title,
      p.content,
      p.created_at,
      (CASE WHEN p.category IN ('poem','essay','short') THEN p.category ELSE 'short' END) AS category,
      p.user_id AS author_id,
      u.name    AS author_name,
      u.nickname AS author_nickname,
      u.email   AS author_email,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
      GROUP_CONCAT(DISTINCT h.name) AS hashtags
  `;

  const baseFromJoin = `
    FROM posts p
    LEFT JOIN post_hashtags ph ON ph.post_id = p.id
    LEFT JOIN hashtags h ON h.id = ph.hashtag_id
    JOIN users u ON p.user_id = u.id
  `;

  const baseWhere = `
    WHERE p.user_id = ?
  `;

  const baseGroupOrder = `
    GROUP BY p.id
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  let sql;
  let params = [];

  if (userId) {
    sql = `
      ${baseSelect},
      CASE
        WHEN EXISTS (
          SELECT 1 FROM likes l2
          WHERE l2.post_id = p.id AND l2.user_id = ?
        ) THEN 1
        ELSE 0
      END AS user_liked
      ${baseFromJoin}
      ${baseWhere}
      ${baseGroupOrder}
    `;
    params = [userId, authorId, limit, offset];
  } else {
    sql = `
      ${baseSelect},
      0 AS user_liked
      ${baseFromJoin}
      ${baseWhere}
      ${baseGroupOrder}
    `;
    params = [authorId, limit, offset];
  }

  try {
    const rows = await dbAll(sql, params);
    return res.json({
      ok: true,
      message: '작가 글 목록을 불러왔습니다.',
      posts: rows,
      has_more: rows.length === limit,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      ok: false,
      message: '작가 글 목록 조회 중 DB 오류가 발생했습니다.',
    });
  }
});

module.exports = router;
