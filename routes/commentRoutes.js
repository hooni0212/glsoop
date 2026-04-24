const express = require('express');
const { authRequired, authOptional } = require('../middleware/auth');
const { buildPublicDisplayName } = require('../utils/accountLifecycle');
const { getAsync, allAsync, runAsync } = require('../utils/questService');
const {
  appendViewerBlockedAuthorCondition,
  isUserBlockedByViewer,
} = require('../utils/safety');
const { ACTIVITY_TYPES, createActivityEvent, toPositiveInt } = require('../utils/activityEvents');

const router = express.Router();

const COMMENT_MAX_LENGTH = 1000;

function sendCommentError(res, status, code, message) {
  return res.status(status).json({ ok: false, code, message });
}

function parsePagination(query = {}) {
  const requestedLimit = Number.parseInt(query.limit, 10);
  const requestedOffset = Number.parseInt(query.offset, 10);
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 50)
      : 20;
  const offset = Number.isFinite(requestedOffset) && requestedOffset > 0 ? requestedOffset : 0;
  return { limit, offset };
}

function normalizeCommentContent(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .slice(0, COMMENT_MAX_LENGTH);
}

function mapCommentRow(row) {
  if (!row) return null;
  const isDeleted = row.status === 'deleted';
  return {
    id: row.id,
    post_id: row.post_id,
    parent_comment_id: row.parent_comment_id || null,
    status: row.status,
    content: isDeleted ? null : row.content,
    author: isDeleted
      ? null
      : {
          id: row.user_id,
          nickname: row.author_nickname || null,
          display_name: buildPublicDisplayName(row.author_nickname, row.author_account_status),
        },
    reply_count: Number(row.reply_count || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at || null,
  };
}

async function fetchPostForComment(postId) {
  return getAsync(
    `
    SELECT
      p.id,
      p.user_id AS author_id,
      p.title,
      COALESCE(u.account_status, 'active') AS author_account_status
    FROM posts p
    JOIN users u ON u.id = p.user_id
    WHERE p.id = ?
    LIMIT 1
    `,
    [postId]
  );
}

async function assertCommentWriteAllowed({ viewerId, post }) {
  if (!post) {
    const error = new Error('해당 글을 찾을 수 없습니다.');
    error.status = 404;
    error.code = 'RESOURCE_NOT_FOUND';
    throw error;
  }

  if (post.author_account_status !== 'active') {
    const error = new Error('댓글을 작성할 수 없는 글입니다.');
    error.status = 403;
    error.code = 'COMMENT_NOT_ALLOWED';
    throw error;
  }

  const [viewerBlockedAuthor, authorBlockedViewer] = await Promise.all([
    isUserBlockedByViewer(viewerId, post.author_id),
    isUserBlockedByViewer(post.author_id, viewerId),
  ]);

  if (viewerBlockedAuthor || authorBlockedViewer) {
    const error = new Error('차단 관계가 있는 글에는 댓글을 작성할 수 없습니다.');
    error.status = 403;
    error.code = 'COMMENT_BLOCKED';
    throw error;
  }
}

router.get('/posts/:postId/comments', authOptional, async (req, res) => {
  const postId = toPositiveInt(req.params.postId);
  const viewerId = req.user?.id ? toPositiveInt(req.user.id) : null;
  const { limit, offset } = parsePagination(req.query || {});

  if (!postId) {
    return sendCommentError(res, 400, 'INVALID_REQUEST', '잘못된 글 ID입니다.');
  }

  try {
    const conditions = ['c.post_id = ?'];
    const params = [postId];
    appendViewerBlockedAuthorCondition(conditions, params, viewerId, 'c.user_id');
    if (viewerId) {
      conditions.push(
        `NOT EXISTS (
          SELECT 1
          FROM user_blocks ub2
          WHERE ub2.blocker_id = c.user_id
            AND ub2.blocked_user_id = ?
        )`
      );
      params.push(viewerId);
    }

    const rows = await allAsync(
      `
      SELECT
        c.*,
        u.nickname AS author_nickname,
        COALESCE(u.account_status, 'active') AS author_account_status,
        (
          SELECT COUNT(*)
          FROM comments child
          WHERE child.parent_comment_id = c.id
            AND child.status = 'active'
        ) AS reply_count
      FROM comments c
      JOIN users u ON u.id = c.user_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY c.created_at ASC, c.id ASC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    const totalRow = await getAsync(
      `
      SELECT COUNT(*) AS cnt
      FROM comments c
      WHERE ${conditions.join(' AND ')}
      `,
      params
    );

    return res.json({
      ok: true,
      message: '댓글을 불러왔습니다.',
      comments: rows.map(mapCommentRow),
      pagination: {
        limit,
        offset,
        total: Number(totalRow?.cnt || 0),
        has_more: offset + rows.length < Number(totalRow?.cnt || 0),
      },
    });
  } catch (error) {
    console.error('[comments/list] failed:', error);
    return sendCommentError(
      res,
      500,
      'INTERNAL_ERROR',
      '댓글 목록 조회 중 오류가 발생했습니다.'
    );
  }
});

router.post('/posts/:postId/comments', authRequired, async (req, res) => {
  const postId = toPositiveInt(req.params.postId);
  const userId = toPositiveInt(req.user.id);
  const parentCommentId = toPositiveInt(req.body?.parent_comment_id);
  const content = normalizeCommentContent(req.body?.content);

  if (!postId) {
    return sendCommentError(res, 400, 'INVALID_REQUEST', '잘못된 글 ID입니다.');
  }
  if (!content) {
    return sendCommentError(res, 400, 'INVALID_REQUEST', '댓글 내용을 입력해주세요.');
  }
  if (typeof req.body?.content === 'string' && req.body.content.trim().length > COMMENT_MAX_LENGTH) {
    return sendCommentError(
      res,
      400,
      'INVALID_REQUEST',
      `댓글은 ${COMMENT_MAX_LENGTH}자 이하로 입력해주세요.`
    );
  }

  try {
    const post = await fetchPostForComment(postId);
    await assertCommentWriteAllowed({ viewerId: userId, post });

    let parentComment = null;
    if (parentCommentId) {
      parentComment = await getAsync(
        `
        SELECT id, post_id, user_id, parent_comment_id, status
        FROM comments
        WHERE id = ?
        LIMIT 1
        `,
        [parentCommentId]
      );
      if (!parentComment || parentComment.post_id !== postId || parentComment.status !== 'active') {
        return sendCommentError(
          res,
          400,
          'INVALID_REQUEST',
          '답글을 달 수 없는 댓글입니다.'
        );
      }
      if (parentComment.parent_comment_id) {
        return sendCommentError(
          res,
          400,
          'INVALID_REQUEST',
          '답글은 한 단계까지만 작성할 수 있습니다.'
        );
      }
      const [viewerBlockedParentAuthor, parentAuthorBlockedViewer] = await Promise.all([
        isUserBlockedByViewer(userId, parentComment.user_id),
        isUserBlockedByViewer(parentComment.user_id, userId),
      ]);
      if (viewerBlockedParentAuthor || parentAuthorBlockedViewer) {
        return sendCommentError(
          res,
          403,
          'COMMENT_BLOCKED',
          '차단 관계가 있는 댓글에는 답글을 작성할 수 없습니다.'
        );
      }
    }

    const result = await runAsync(
      `
      INSERT INTO comments (post_id, user_id, parent_comment_id, content)
      VALUES (?, ?, ?, ?)
      `,
      [postId, userId, parentCommentId || null, content]
    );

    const row = await getAsync(
      `
      SELECT
        c.*,
        u.nickname AS author_nickname,
        COALESCE(u.account_status, 'active') AS author_account_status,
        0 AS reply_count
      FROM comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.id = ?
      LIMIT 1
      `,
      [result.lastID]
    );

    if (parentComment) {
      await createActivityEvent({
        recipientUserId: parentComment.user_id,
        actorUserId: userId,
        eventType: ACTIVITY_TYPES.COMMENT_REPLIED,
        postId,
        commentId: result.lastID,
        parentCommentId,
        postTitle: post.title,
        uniqueKey: `comment_replied:${result.lastID}`,
      });
    } else {
      await createActivityEvent({
        recipientUserId: post.author_id,
        actorUserId: userId,
        eventType: ACTIVITY_TYPES.COMMENT_CREATED,
        postId,
        commentId: result.lastID,
        postTitle: post.title,
        uniqueKey: `comment_created:${result.lastID}`,
      });
    }

    return res.status(201).json({
      ok: true,
      message: '댓글이 작성되었습니다.',
      comment: mapCommentRow(row),
    });
  } catch (error) {
    if (error?.status && error?.code) {
      return sendCommentError(res, error.status, error.code, error.message);
    }
    console.error('[comments/create] failed:', error);
    return sendCommentError(res, 500, 'INTERNAL_ERROR', '댓글 작성 중 오류가 발생했습니다.');
  }
});

router.patch('/comments/:commentId', authRequired, async (req, res) => {
  const commentId = toPositiveInt(req.params.commentId);
  const userId = toPositiveInt(req.user.id);
  const content = normalizeCommentContent(req.body?.content);

  if (!commentId) {
    return sendCommentError(res, 400, 'INVALID_REQUEST', '잘못된 댓글 ID입니다.');
  }
  if (!content) {
    return sendCommentError(res, 400, 'INVALID_REQUEST', '댓글 내용을 입력해주세요.');
  }
  if (typeof req.body?.content === 'string' && req.body.content.trim().length > COMMENT_MAX_LENGTH) {
    return sendCommentError(
      res,
      400,
      'INVALID_REQUEST',
      `댓글은 ${COMMENT_MAX_LENGTH}자 이하로 입력해주세요.`
    );
  }

  try {
    const comment = await getAsync('SELECT * FROM comments WHERE id = ? LIMIT 1', [commentId]);
    if (!comment) {
      return sendCommentError(res, 404, 'RESOURCE_NOT_FOUND', '댓글을 찾을 수 없습니다.');
    }
    if (comment.user_id !== userId) {
      return sendCommentError(res, 403, 'AUTH_FORBIDDEN', '댓글을 수정할 권한이 없습니다.');
    }
    if (comment.status !== 'active') {
      return sendCommentError(res, 400, 'INVALID_REQUEST', '삭제된 댓글은 수정할 수 없습니다.');
    }

    await runAsync(
      `
      UPDATE comments
      SET content = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [content, commentId]
    );

    const row = await getAsync(
      `
      SELECT
        c.*,
        u.nickname AS author_nickname,
        COALESCE(u.account_status, 'active') AS author_account_status,
        (
          SELECT COUNT(*)
          FROM comments child
          WHERE child.parent_comment_id = c.id
            AND child.status = 'active'
        ) AS reply_count
      FROM comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.id = ?
      LIMIT 1
      `,
      [commentId]
    );

    return res.json({
      ok: true,
      message: '댓글이 수정되었습니다.',
      comment: mapCommentRow(row),
    });
  } catch (error) {
    console.error('[comments/update] failed:', error);
    return sendCommentError(res, 500, 'INTERNAL_ERROR', '댓글 수정 중 오류가 발생했습니다.');
  }
});

router.delete('/comments/:commentId', authRequired, async (req, res) => {
  const commentId = toPositiveInt(req.params.commentId);
  const userId = toPositiveInt(req.user.id);
  const isAdmin = Boolean(req.user.isAdmin || req.user.is_admin);

  if (!commentId) {
    return sendCommentError(res, 400, 'INVALID_REQUEST', '잘못된 댓글 ID입니다.');
  }

  try {
    const comment = await getAsync(
      `
      SELECT c.*, p.user_id AS post_author_id
      FROM comments c
      JOIN posts p ON p.id = c.post_id
      WHERE c.id = ?
      LIMIT 1
      `,
      [commentId]
    );
    if (!comment) {
      return sendCommentError(res, 404, 'RESOURCE_NOT_FOUND', '댓글을 찾을 수 없습니다.');
    }
    if (!isAdmin && comment.user_id !== userId && comment.post_author_id !== userId) {
      return sendCommentError(res, 403, 'AUTH_FORBIDDEN', '댓글을 삭제할 권한이 없습니다.');
    }

    await runAsync(
      `
      UPDATE comments
      SET status = 'deleted',
          content = '',
          deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [commentId]
    );

    return res.json({
      ok: true,
      message: '댓글이 삭제되었습니다.',
      comment: {
        id: commentId,
        status: 'deleted',
      },
    });
  } catch (error) {
    console.error('[comments/delete] failed:', error);
    return sendCommentError(res, 500, 'INTERNAL_ERROR', '댓글 삭제 중 오류가 발생했습니다.');
  }
});

module.exports = router;
