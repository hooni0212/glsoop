const express = require('express');
const db = require('../db');

const router = express.Router();

const MAX_QUERY_LENGTH = 80;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;
const ALLOWED_TYPES = new Set(['all', 'posts', 'authors']);
const CATEGORY_SQL =
  "CASE WHEN p.category IN ('poem','essay','short') THEN p.category ELSE 'short' END";

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });

function logRouteUsage(req, res) {
  const payload = {
    path: String(req.originalUrl || req.path || '').split('?')[0],
    status: Number(res.statusCode || 0),
    method: String(req.method || 'GET').toUpperCase(),
    authenticated: Boolean(req.user && req.user.id),
    ts: new Date().toISOString(),
  };
  console.info('[api-observe][search]', JSON.stringify(payload));
}

router.use((req, res, next) => {
  res.on('finish', () => {
    logRouteUsage(req, res);
  });
  next();
});

function sendSearchError(res, status, code, message) {
  return res.status(status).json({ ok: false, code, message });
}

function parsePositiveInteger(raw) {
  if (raw === undefined) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSearchQuery(query = {}) {
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (!q) {
    return { error: '검색어를 입력해주세요.' };
  }
  if (q.length > MAX_QUERY_LENGTH) {
    return { error: `검색어는 ${MAX_QUERY_LENGTH}자 이하여야 합니다.` };
  }

  const type = typeof query.type === 'string' ? query.type.trim().toLowerCase() : 'all';
  if (!ALLOWED_TYPES.has(type)) {
    return { error: 'type은 all, posts, authors 중 하나여야 합니다.' };
  }

  const limitRaw = parsePositiveInteger(query.limit);
  const offsetRaw = parsePositiveInteger(query.offset);

  if (limitRaw !== null && (limitRaw < 1 || limitRaw > MAX_LIMIT)) {
    return { error: `limit은 1~${MAX_LIMIT} 범위여야 합니다.` };
  }
  if (offsetRaw !== null && offsetRaw < 0) {
    return { error: 'offset은 0 이상의 정수여야 합니다.' };
  }

  return {
    q,
    type,
    limit: limitRaw ?? DEFAULT_LIMIT,
    offset: offsetRaw ?? 0,
  };
}

function escapeLike(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

async function searchPosts(keyword, limit, offset) {
  const sql = `
    SELECT
      p.id,
      p.title,
      CASE
        WHEN LENGTH(TRIM(REPLACE(REPLACE(COALESCE(p.content, ''), char(10), ' '), char(13), ' '))) > 140
          THEN SUBSTR(TRIM(REPLACE(REPLACE(COALESCE(p.content, ''), char(10), ' '), char(13), ' ')), 1, 140) || '...'
        ELSE TRIM(REPLACE(REPLACE(COALESCE(p.content, ''), char(10), ' '), char(13), ' '))
      END AS excerpt,
      ${CATEGORY_SQL} AS category,
      p.created_at,
      u.id AS author_id,
      u.name AS author_name,
      u.nickname AS author_nickname,
      IFNULL(lc.like_count, 0) AS like_count,
      IFNULL(bc.bookmark_count, 0) AS bookmark_count
    FROM posts p
    JOIN users u ON p.user_id = u.id
    LEFT JOIN (
      SELECT post_id, COUNT(*) AS like_count
      FROM likes
      GROUP BY post_id
    ) lc ON lc.post_id = p.id
    LEFT JOIN (
      SELECT post_id, COUNT(*) AS bookmark_count
      FROM bookmark_items
      GROUP BY post_id
    ) bc ON bc.post_id = p.id
    WHERE (
      p.title LIKE ? ESCAPE '\\'
      OR p.content LIKE ? ESCAPE '\\'
      OR u.name LIKE ? ESCAPE '\\'
      OR COALESCE(u.nickname, '') LIKE ? ESCAPE '\\'
    )
    ORDER BY like_count DESC, bookmark_count DESC, p.created_at DESC
    LIMIT ? OFFSET ?
  `;

  return dbAll(sql, [keyword, keyword, keyword, keyword, limit, offset]);
}

async function searchAuthors(keyword, limit, offset) {
  const sql = `
    SELECT
      u.id,
      u.name,
      u.nickname,
      IFNULL(ps.post_count, 0) AS post_count,
      IFNULL(fs.follower_count, 0) AS follower_count,
      ps.latest_post_at
    FROM users u
    LEFT JOIN (
      SELECT user_id, COUNT(*) AS post_count, MAX(created_at) AS latest_post_at
      FROM posts
      GROUP BY user_id
    ) ps ON ps.user_id = u.id
    LEFT JOIN (
      SELECT followee_id, COUNT(*) AS follower_count
      FROM follows
      GROUP BY followee_id
    ) fs ON fs.followee_id = u.id
    WHERE (
      u.name LIKE ? ESCAPE '\\'
      OR COALESCE(u.nickname, '') LIKE ? ESCAPE '\\'
    )
    ORDER BY post_count DESC, follower_count DESC, ps.latest_post_at DESC, u.id DESC
    LIMIT ? OFFSET ?
  `;

  return dbAll(sql, [keyword, keyword, limit, offset]);
}

router.get('/search', async (req, res) => {
  const parsed = parseSearchQuery(req.query || {});
  if (parsed.error) {
    return sendSearchError(res, 400, 'INVALID_REQUEST', parsed.error);
  }

  const { q, type, limit, offset } = parsed;
  const keyword = `%${escapeLike(q)}%`;

  try {
    const [posts, authors] = await Promise.all([
      type === 'all' || type === 'posts' ? searchPosts(keyword, limit, offset) : Promise.resolve([]),
      type === 'all' || type === 'authors'
        ? searchAuthors(keyword, limit, offset)
        : Promise.resolve([]),
    ]);

    return res.json({
      ok: true,
      message: '검색 결과를 불러왔습니다.',
      query: q,
      type,
      posts,
      authors,
      meta: {
        posts_count: posts.length,
        authors_count: authors.length,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error('[search] failed:', error);
    return sendSearchError(res, 500, 'INTERNAL_ERROR', '검색 중 오류가 발생했습니다.');
  }
});

module.exports = router;
