// routes/userRoutes.js
// - 사용자 프로필, 팔로우 토글
const express = require('express');

const db = require('../db');
const { authRequired, authOptional } = require('../middleware/auth');
const {
  parseStoredProfileCosmetics,
  extractProfileCosmeticKeys,
  makeKeyedCosmeticMap,
  buildExpandedProfileCosmetics,
} = require('../utils/profileCosmetics');
const {
  ACCOUNT_STATUS_ACTIVE,
  buildPublicDisplayName,
  normalizePublicPostAuthor,
} = require('../utils/accountLifecycle');
const { decoratePostRowsWithRenderImages } = require('../utils/postRenderImages');
const { ACTIVITY_TYPES, createActivityEvent } = require('../utils/activityEvents');
const {
  appendViewerBlockedAuthorCondition,
  blockUser,
  createSafetyReport,
  getActiveUserSummary,
  isSafetyValidationError,
  isUserBlockedByViewer,
  listBlockedUsers,
  parseSafetyRequestPayload,
  unblockUser,
} = require('../utils/safety');

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
      nickname,
      bio,
      about,
      COALESCE(account_status, 'active') AS account_status,
      COALESCE(level, 1) AS level
    FROM users
    WHERE id = ?
      AND COALESCE(account_status, 'active') = 'active'
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

function normalizeOptionalNickname(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

async function fetchExpandedProfileCosmetics(userId) {
  const profileRow = await dbGet(
    `
    SELECT
	      primary_badge_key,
	      profile_background_key,
	      showcase_badge_keys_json,
	      header_stickers_json
    FROM user_profile_cosmetics
    WHERE user_id = ?
    LIMIT 1
    `,
    [userId]
  );

  const parsedProfile = parseStoredProfileCosmetics(profileRow);
  const keys = extractProfileCosmeticKeys(parsedProfile);
  if (keys.length === 0) {
    return buildExpandedProfileCosmetics(parsedProfile, new Map());
  }

  const placeholders = keys.map(() => '?').join(', ');
  const cosmeticItems = await dbAll(
    `
    SELECT
      ci.key,
      ci.type,
      ci.name,
      ci.icon_emoji,
      COALESCE(ci.rarity, 'common') AS rarity,
      ci.season,
      ci.meta_json
    FROM user_cosmetics uc
    JOIN cosmetic_items ci ON ci.id = uc.cosmetic_id
    WHERE uc.user_id = ?
      AND ci.key IN (${placeholders})
    `,
    [userId, ...keys]
  );
  const backgroundItems = await dbAll(
    `
    SELECT
      pbi.key,
      'background' AS type,
      pbi.name,
      pbi.icon_emoji,
      COALESCE(pbi.rarity, 'common') AS rarity,
      pbi.season,
      pbi.meta_json
    FROM user_profile_backgrounds upb
    JOIN profile_background_items pbi ON pbi.id = upb.background_id
    WHERE upb.user_id = ?
      AND pbi.key IN (${placeholders})
      AND pbi.is_active = 1
    `,
    [userId, ...keys]
  );

  const itemByKey = makeKeyedCosmeticMap([...cosmeticItems, ...backgroundItems]);
  return buildExpandedProfileCosmetics(parsedProfile, itemByKey);
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
  const found = await dbGet(
    'SELECT id FROM users WHERE id = ? AND COALESCE(account_status, ?) = ?',
    [targetUserId, ACCOUNT_STATUS_ACTIVE, ACCOUNT_STATUS_ACTIVE]
  );
  if (!found) {
    res
      .status(404)
      .json({ ok: false, message: '해당 사용자를 찾을 수 없습니다.' });
    return null;
  }
  return found;
}

// 8-1) 작가 공개 프로필 조회
router.get('/users/:id/profile', authOptional, async (req, res) => {
  const authorId = parseId(req.params.id);
  if (!authorId) {
    return res.status(400).json({ ok: false, message: '잘못된 작가 ID입니다.' });
  }

  const viewerId = req.user?.id || null;

  try {
    if (viewerId && (await isUserBlockedByViewer(viewerId, authorId))) {
      return res
        .status(404)
        .json({ ok: false, message: '해당 작가를 찾을 수 없습니다.' });
    }

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
    const profileCosmetics = await fetchExpandedProfileCosmetics(authorId);

    return res.json({
      ok: true,
      message: '작가 프로필을 불러왔습니다.',
      user: {
        id: profile.user.id,
        display_name: buildPublicDisplayName(
          profile.user.nickname,
          profile.user.account_status
        ),
        name: buildPublicDisplayName(
          profile.user.nickname,
          profile.user.account_status
        ),
        nickname: normalizeOptionalNickname(profile.user.nickname),
        email: null,
        bio: profile.user.bio || null,
        about: profile.user.about || null,
        level: profile.user.level || 1,
        post_count: profile.post_count,
        total_likes: profile.total_likes,
        follower_count: profile.follower_count,
        following_count: profile.following_count,
        profile_cosmetics: profileCosmetics,
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
    if (!exists && result.following) {
      try {
        const actor = await dbGet(
          `
          SELECT nickname, COALESCE(account_status, 'active') AS account_status
          FROM users
          WHERE id = ?
          LIMIT 1
          `,
          [viewerId]
        );
        const actorName = buildPublicDisplayName(actor?.nickname, actor?.account_status);
        await createActivityEvent({
          recipientUserId: targetUserId,
          actorUserId: viewerId,
          eventType: ACTIVITY_TYPES.SYSTEM,
          title: '새 팔로워',
          body: `${actorName}님이 나를 팔로우했어요.`,
          meta: { notification_type: 'new_follower' },
          uniqueKey: `new_follower:${targetUserId}:${viewerId}`,
        });
      } catch (activityError) {
        console.error('follow activity 처리 실패:', activityError);
      }
    }
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

router.post('/users/:id/report', authRequired, async (req, res) => {
  const targetUserId = parseId(req.params.id);
  const reporterId = req.user.id;

  if (!validateFollowTarget(targetUserId, reporterId, res)) return;

  try {
    const targetUser = await getActiveUserSummary(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ ok: false, message: '해당 사용자를 찾을 수 없습니다.' });
    }

    const payload = parseSafetyRequestPayload(req.body, {
      defaultReasonCode: 'other',
      allowContextPostId: true,
    });
    const report = await createSafetyReport({
      reporterId,
      targetType: 'user',
      targetUserId,
      targetPostId: payload.contextPostId,
      reasonCode: payload.reasonCode,
      detail: payload.detail,
    });

    return res.json({
      ok: true,
      message:
        '신고가 접수되었습니다. 운영팀이 검토 후 24시간 내 조치합니다. 위반 시 콘텐츠 삭제 및 계정 제재가 이루어질 수 있습니다.',
      report_id: report?.id || null,
      status: report?.status || 'queued',
    });
  } catch (error) {
    if (isSafetyValidationError(error)) {
      return res.status(400).json({
        ok: false,
        message: error.message,
      });
    }
    console.error('[users/report] failed:', error);
    return res.status(500).json({
      ok: false,
      message: '신고를 접수하지 못했어요. 잠시 후 다시 시도해주세요.',
    });
  }
});

router.post('/users/:id/block', authRequired, async (req, res) => {
  const targetUserId = parseId(req.params.id);
  const blockerId = req.user.id;

  if (!validateFollowTarget(targetUserId, blockerId, res)) return;

  try {
    const targetUser = await getActiveUserSummary(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ ok: false, message: '해당 사용자를 찾을 수 없습니다.' });
    }

    const payload = parseSafetyRequestPayload(req.body, {
      defaultReasonCode: 'harassment',
      allowContextPostId: true,
    });
    const result = await blockUser({
      blockerId,
      blockedUserId: targetUserId,
      reasonCode: payload.reasonCode,
      detail: payload.detail,
      contextPostId: payload.contextPostId,
    });

    return res.json({
      ok: true,
      message: result.created
        ? '사용자를 차단했어요. 이 사용자의 글과 프로필이 내 화면에서 즉시 숨겨지고, 운영팀이 검토 후 필요한 경우 콘텐츠 삭제 또는 계정 제재를 진행할 수 있습니다.'
        : '이미 차단한 사용자예요. 이 사용자의 글과 프로필은 계속 내 화면에서 숨겨집니다.',
      blocked_user_id: targetUserId,
      hidden_post_count: result.hidden_post_count,
      report_id: result.report?.id || null,
      already_blocked: !result.created,
    });
  } catch (error) {
    if (isSafetyValidationError(error)) {
      return res.status(400).json({
        ok: false,
        message: error.message,
      });
    }
    console.error('[users/block] failed:', error);
    return res.status(500).json({
      ok: false,
      message: '차단 처리에 실패했어요. 잠시 후 다시 시도해주세요.',
    });
  }
});

router.delete('/users/:id/block', authRequired, async (req, res) => {
  const targetUserId = parseId(req.params.id);
  const blockerId = req.user.id;

  if (!validateFollowTarget(targetUserId, blockerId, res)) return;

  try {
    const result = await unblockUser({ blockerId, blockedUserId: targetUserId });
    return res.json({
      ok: true,
      message: result.removed
        ? '사용자 차단을 해제했어요.'
        : '이미 차단이 해제된 상태예요.',
      blocked_user_id: targetUserId,
      removed: result.removed,
    });
  } catch (error) {
    console.error('[users/unblock] failed:', error);
    return res.status(500).json({
      ok: false,
      message: '차단 해제에 실패했어요. 잠시 후 다시 시도해주세요.',
    });
  }
});

router.get('/me/blocks', authRequired, async (req, res) => {
  try {
    const blocks = await listBlockedUsers(req.user.id);
    return res.json({
      ok: true,
      message: '차단 목록을 불러왔습니다.',
      blocks,
    });
  } catch (error) {
    console.error('[me/blocks] failed:', error);
    return res.status(500).json({
      ok: false,
      message: '차단 목록을 불러오지 못했습니다.',
    });
  }
});

// 8-2) 특정 작가의 글 목록 (무한스크롤용)
router.get('/users/:id/posts', authOptional, async (req, res) => {
  const authorId = parseId(req.params.id);
  if (!authorId) {
    return res
      .status(400)
      .json({ ok: false, message: '잘못된 작가 ID입니다.' });
  }

  const userId = req.user?.id || null;
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
      p.layout_json,
      p.content_pages,
      p.created_at,
      (CASE WHEN p.category IN ('poem','essay','short') THEN p.category ELSE 'short' END) AS category,
      p.user_id AS author_id,
      u.nickname AS author_nickname,
      COALESCE(u.account_status, 'active') AS author_account_status,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
      GROUP_CONCAT(DISTINCT h.name) AS hashtags
  `;

  const baseFromJoin = `
    FROM posts p
    LEFT JOIN post_hashtags ph ON ph.post_id = p.id
    LEFT JOIN hashtags h ON h.id = ph.hashtag_id
    JOIN users u ON p.user_id = u.id
  `;

  const baseGroupOrder = `
    GROUP BY p.id
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  let sql;
  let params = [];

  if (userId) {
    const conditions = ['p.user_id = ?'];
    const viewerScopedParams = [];
    appendViewerBlockedAuthorCondition(conditions, viewerScopedParams, userId, 'p.user_id');
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
      WHERE ${conditions.join(' AND ')}
      ${baseGroupOrder}
    `;
    params = [userId, authorId, ...viewerScopedParams, limit, offset];
  } else {
    sql = `
      ${baseSelect},
      0 AS user_liked
      ${baseFromJoin}
      WHERE p.user_id = ?
      ${baseGroupOrder}
    `;
    params = [authorId, limit, offset];
  }

  try {
    if (userId && (await isUserBlockedByViewer(userId, authorId))) {
      return res.status(404).json({
        ok: false,
        message: '해당 작가를 찾을 수 없습니다.',
      });
    }

    const author = await dbGet(
      'SELECT id FROM users WHERE id = ? AND COALESCE(account_status, ?) = ? LIMIT 1',
      [authorId, ACCOUNT_STATUS_ACTIVE, ACCOUNT_STATUS_ACTIVE]
    );
    if (!author) {
      return res.status(404).json({
        ok: false,
        message: '해당 작가를 찾을 수 없습니다.',
      });
    }

    const rows = await dbAll(sql, params);
    const posts = await decoratePostRowsWithRenderImages(
      rows.map((row) => normalizePublicPostAuthor(row))
    );
    return res.json({
      ok: true,
      message: '작가 글 목록을 불러왔습니다.',
      posts,
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
