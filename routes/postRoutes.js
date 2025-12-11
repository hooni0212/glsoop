// routes/postRoutes.js
// - 글 CRUD, 피드, 추천, 좋아요, 해시태그 필터 관련 API 집합

// ================== 1. 글 작성/수정/삭제 ==================
// POST   /api/posts
// PUT    /api/posts/:id
// DELETE /api/posts/:id

// ================== 2. 내 글 / 공감한 글 ==================
// GET /api/posts/my
// GET /api/posts/liked

// ================== 3. 피드 & 관련 글 ==================
// GET /api/posts/feed
// GET /api/posts/:id/related

// ================== 4. 글 상세 & 좋아요 ==================
// GET  /api/posts/:id
// POST /api/posts/:id/toggle-like
// GET /api/posts/:id/detail

const express = require('express');
const jwt = require('jsonwebtoken');

const db = require('../db');
const { JWT_SECRET } = require('../config');
const { authRequired } = require('../middleware/auth');
const { saveHashtagsForPostFromInput } = require('../utils/hashtags');

const ALLOWED_CATEGORIES = ['poem', 'essay', 'short'];
const CATEGORY_SQL =
  "CASE WHEN p.category IN ('poem','essay','short') THEN p.category ELSE 'short' END";

function parseCategory(input) {
  const value = typeof input === 'string' ? input.trim() : '';
  return ALLOWED_CATEGORIES.includes(value) ? value : null;
}

function coalesceCategory(input) {
  return parseCategory(input) || 'short';
}

function requireValidCategory(input, res) {
  const parsed = parseCategory(input);
  if (!parsed) {
    if (res) {
      res.status(400).json({
        ok: false,
        message: '카테고리를 선택해주세요. (시/에세이/짧은 구절)',
      });
    }
    return null;
  }
  return parsed;
}

const router = express.Router();

// 9-1) 글 작성
router.post('/posts', authRequired, (req, res) => {
  const { title, content, hashtags, category } = req.body;
  const userId = req.user.id;
  const normalizedCategory = requireValidCategory(category, res);

  if (!normalizedCategory) return;

  if (!title || !content) {
    return res
      .status(400)
      .json({ ok: false, message: '제목과 내용을 모두 입력하세요.' });
  }

  // 본문 저장 후 해시태그를 별도 테이블에 기록
  db.run(
    'INSERT INTO posts (user_id, title, content, category) VALUES (?, ?, ?, ?)',
    [userId, title, content, normalizedCategory],
    function (err) {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '글 저장 중 DB 오류가 발생했습니다.' });
      }

      const newPostId = this.lastID;

      saveHashtagsForPostFromInput(newPostId, hashtags, (tagErr) => {
        if (tagErr) {
          console.error('해시태그 저장 중 오류:', tagErr);
          return res.json({
            ok: true,
            message:
              '글은 저장되었지만, 해시태그 저장 중 오류가 발생했습니다.',
            postId: newPostId,
          });
        }

        return res.json({
          ok: true,
          message: '글이 저장되었습니다.',
          postId: newPostId,
        });
      });
    }
  );
});

// 9-2) 글 수정
router.put('/posts/:id', authRequired, (req, res) => {
  const postId = req.params.id;
  const { title, content, hashtags, category } = req.body;
  const userId = req.user.id;
  const isAdmin = !!req.user.isAdmin;
  const normalizedCategory = requireValidCategory(category, res);

  if (!normalizedCategory) return;

  if (!title || !content) {
    return res
      .status(400)
      .json({ ok: false, message: '제목과 내용을 모두 입력하세요.' });
  }

  // 수정 권한 확인(작성자 또는 관리자만 허용)
  db.get('SELECT user_id FROM posts WHERE id = ?', [postId], (err, row) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ ok: false, message: '글 조회 중 DB 오류가 발생했습니다.' });
    }

    if (!row) {
      return res
        .status(404)
        .json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });
    }

    if (!isAdmin && row.user_id !== userId) {
      return res
        .status(403)
        .json({ ok: false, message: '이 글을 수정할 권한이 없습니다.' });
    }

    // 본문 갱신 후 해시태그 매핑을 재작성
    db.run(
      'UPDATE posts SET title = ?, content = ?, category = ? WHERE id = ?',
      [title, content, normalizedCategory, postId],
      function (err2) {
        if (err2) {
          console.error(err2);
          return res
            .status(500)
            .json({ ok: false, message: '글 수정 중 DB 오류가 발생했습니다.' });
        }

        saveHashtagsForPostFromInput(postId, hashtags, (tagErr) => {
          if (tagErr) {
            console.error('해시태그 갱신 중 오류:', tagErr);
            return res.json({
              ok: true,
              message:
                '글은 수정되었지만, 해시태그 저장 중 오류가 발생했습니다.',
            });
          }

          return res.json({
            ok: true,
            message: '글이 수정되었습니다.',
          });
        });
      }
    );
  });
});

// 9-3) 내가 쓴 글 목록
router.get('/posts/my', authRequired, (req, res) => {
  const userId = req.user.id;

  db.all(
    `
    SELECT
      p.id,
      p.title,
      p.content,
      ${CATEGORY_SQL} AS category,
      p.created_at,
      p.user_id                AS author_id,
      u.name                   AS author_name,
      u.nickname               AS author_nickname,
      u.email                  AS author_email,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM likes l2
          WHERE l2.post_id = p.id
            AND l2.user_id = ?
        ) THEN 1
        ELSE 0
      END AS user_liked
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
    `,
    [userId, userId],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({
            ok: false,
            message: '글 목록 조회 중 DB 오류가 발생했습니다.',
          });
      }

      return res.json({
        ok: true,
        posts: rows,
      });
    }
  );
});


// 9-4) 내가 공감한 글 목록
router.get('/posts/liked', authRequired, (req, res) => {
  const userId = req.user.id;

  db.all(
    `
    SELECT
      p.id,
      p.title,
      p.content,
      ${CATEGORY_SQL} AS category,
      p.created_at,
      p.user_id                AS author_id,
      u.name                   AS author_name,
      u.nickname               AS author_nickname,
      u.email                  AS author_email,
      -- 해당 글의 총 공감 수
      (SELECT COUNT(*) FROM likes l2 WHERE l2.post_id = p.id) AS like_count,
      -- "내가 공감한 글" 목록이니까 항상 공감한 상태
      1 AS user_liked
    FROM posts p
    INNER JOIN likes l ON l.post_id = p.id
    JOIN users u ON p.user_id = u.id
    WHERE l.user_id = ?
    ORDER BY l.created_at DESC
    `,
    [userId],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({
            ok: false,
            message: '공감한 글 목록 조회 중 DB 오류가 발생했습니다.',
          });
      }

      return res.json({
        ok: true,
        posts: rows,
      });
    }
  );
});

function handleFeedRequest(req, res) {
  let userId = null;

  const token = req.cookies.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      userId = decoded.id;
    } catch (e) {
      userId = null;
    }
  }

  // 페이지네이션 기본값
  let limit = parseInt(req.query.limit, 10);
  let offset = parseInt(req.query.offset, 10);

  if (isNaN(limit) || limit <= 0 || limit > 50) {
    limit = 20;
  }
  if (isNaN(offset) || offset < 0) {
    offset = 0;
  }

  const sortParam = String(req.query.sort || 'latest');
  const sort = sortParam === 'popular' ? 'popular' : 'latest';

  const typeParam = String(req.query.type || 'all');
  const feedType = typeParam === 'following' ? 'following' : 'all';

  const categoryParam = String(req.query.category || '').trim();
  const category = parseCategory(categoryParam);

  // 쿼리 파라미터로 전달된 태그 목록 정리
  let tags = [];
  if (req.query.tags) {
    tags = String(req.query.tags)
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);
  } else if (req.query.tag) {
    const t = String(req.query.tag).trim().toLowerCase();
    if (t) tags = [t];
  }
  const tagCount = tags.length;

  if (feedType === 'following' && !userId) {
    return res.status(401).json({
      ok: false,
      message: '로그인이 필요한 요청입니다.',
      posts: [],
      hasMore: false,
      context: {
        feedType,
        sort,
        followingCount: 0,
        tags,
        category: category || null,
      },
    });
  }

  const runQuery = (followingCount = null) => {
    const params = [];

    const selectClause = `
      SELECT
        p.id,
        p.title,
        p.content,
        p.created_at,
        ${CATEGORY_SQL} AS category,
        u.id       AS author_id,
        u.name     AS author_name,
        u.nickname AS author_nickname,
        u.email    AS author_email,
        IFNULL(lc.like_count, 0) AS like_count,
        ${
          userId
            ? 'CASE WHEN my.user_id IS NULL THEN 0 ELSE 1 END'
            : '0'
        } AS user_liked,
        GROUP_CONCAT(DISTINCT h.name) AS hashtags
    `;

    const joins = [
      'FROM posts p',
      'JOIN users u ON p.user_id = u.id',
      'LEFT JOIN post_hashtags ph ON ph.post_id = p.id',
      'LEFT JOIN hashtags h ON h.id = ph.hashtag_id',
      'LEFT JOIN (SELECT post_id, COUNT(*) AS like_count FROM likes GROUP BY post_id) lc ON lc.post_id = p.id',
    ];

    if (userId) {
      joins.push('LEFT JOIN likes my ON my.post_id = p.id AND my.user_id = ?');
      params.push(userId);
    }

    const conditions = [];

    if (tagCount > 0) {
      const placeholders = tags.map(() => '?').join(', ');
      conditions.push(`p.id IN (
          SELECT ph2.post_id
          FROM post_hashtags ph2
          JOIN hashtags h2 ON h2.id = ph2.hashtag_id
          WHERE h2.name IN (${placeholders})
          GROUP BY ph2.post_id
          HAVING COUNT(DISTINCT h2.name) = ?
        )`);
      params.push(...tags, tagCount);
    }

    if (feedType === 'following') {
      conditions.push(
        'p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)'
      );
      params.push(userId);
    }

    if (category) {
      conditions.push('p.category = ?');
      params.push(category);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const orderClause =
      sort === 'popular'
        ? 'ORDER BY like_count DESC, p.created_at DESC'
        : 'ORDER BY p.created_at DESC';

    const sql = `
      ${selectClause}
      ${joins.join('\n')}
      ${whereClause}
      GROUP BY p.id
      ${orderClause}
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);

    db.all(sql, params, (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({
          ok: false,
          message: '피드 조회 중 DB 오류가 발생했습니다.',
        });
      }

      return res.json({
        ok: true,
        posts: rows,
        hasMore: rows.length === limit,
        context: {
          feedType,
          sort,
          followingCount,
          tags,
          category: category || null,
        },
      });
    });
  };

  if (feedType === 'following') {
    db.get(
      'SELECT COUNT(*) AS cnt FROM follows WHERE follower_id = ?',
      [userId],
      (err, row) => {
        if (err) {
          console.error(err);
          return res.status(500).json({
            ok: false,
            message: '팔로잉 정보를 확인하는 중 오류가 발생했습니다.',
          });
        }

        runQuery(row?.cnt || 0);
      }
    );
  } else {
    runQuery(null);
  }
}

// 9-5) 피드 조회 (전체 + 해시태그 필터 + 좋아요 여부)
router.get('/posts/feed', handleFeedRequest);
router.get('/posts', handleFeedRequest);

// 9-6) 관련 글 추천
router.get('/posts/:id/related', (req, res) => {
  const postId = parseInt(req.params.id, 10);
  if (!postId) {
    return res
      .status(400)
      .json({ ok: false, message: '잘못된 글 ID입니다.' });
  }

  const limit = parseInt(req.query.limit, 10) || 6;

  // 🔹 0) 현재 로그인한 사용자 ID 추출 (없으면 null)
  let userId = null;
  if (req.user && req.user.id) {
    userId = req.user.id;
  } else if (req.cookies && req.cookies.token) {
    try {
      const decoded = jwt.verify(req.cookies.token, JWT_SECRET);
      userId = decoded.id;
    } catch (e) {
      userId = null;
    }
  }

    // 기준 글의 작성자/태그 정보를 가져와 관련 글 매칭에 사용
    db.get(
    `
    SELECT
      p.id,
      p.user_id AS author_id,
      p.created_at,
      GROUP_CONCAT(DISTINCT h.name) AS hashtags
    FROM posts p
    LEFT JOIN post_hashtags ph ON ph.post_id = p.id
    LEFT JOIN hashtags h ON h.id = ph.hashtag_id
    WHERE p.id = ?
    GROUP BY p.id
    `,
    [postId],
    (err, current) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '기준 글 조회 중 DB 오류가 발생했습니다.' });
      }

      if (!current) {
        return res
          .status(404)
          .json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });
      }

      const currentTags = current.hashtags
        ? current.hashtags
            .split(',')
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean)
        : [];

      const CANDIDATE_LIMIT = 100;

      // 🔹 1) 후보 글들 + like_count + (이 유저가 눌렀는지 user_liked)까지 한 번에 가져오기
      db.all(
        `
        SELECT
          p.id,
          p.title,
          p.content,
          ${CATEGORY_SQL} AS category,
          p.created_at,
          u.id       AS author_id,
          u.name     AS author_name,
          u.nickname AS author_nickname,
          u.email    AS author_email,
          IFNULL(l.like_count, 0) AS like_count,
          -- ✅ 이 유저가 누른 좋아요 여부
          CASE
            WHEN my.user_id IS NULL THEN 0
            ELSE 1
          END AS user_liked,
          GROUP_CONCAT(DISTINCT h.name) AS hashtags
        FROM posts p
        JOIN users u ON p.user_id = u.id
        -- 전체 좋아요 개수 집계
        LEFT JOIN (
          SELECT post_id, COUNT(*) AS like_count
          FROM likes
          GROUP BY post_id
        ) l ON l.post_id = p.id
        -- 현재 로그인한 유저가 누른 좋아요만 따로 조인
        LEFT JOIN likes my
          ON my.post_id = p.id
         AND my.user_id = ?
        LEFT JOIN post_hashtags ph ON ph.post_id = p.id
        LEFT JOIN hashtags h ON h.id = ph.hashtag_id
        WHERE p.id != ?
        GROUP BY p.id
        ORDER BY p.created_at DESC
        LIMIT ?
        `,
        // 파라미터 순서: 1) userId (my.user_id = ?)
        //              2) postId (p.id != ?)
        //              3) CANDIDATE_LIMIT (LIMIT ?)
        [userId, postId, CANDIDATE_LIMIT],
        (err2, rows) => {
          if (err2) {
            console.error(err2);
            return res.status(500).json({
              ok: false,
              message: '관련 글을 불러오는 중 DB 오류가 발생했습니다.',
            });
          }

          if (!rows || rows.length === 0) {
            return res.json({ ok: true, posts: [] });
          }

          const now = Date.now();
          const ONE_DAY = 1000 * 60 * 60 * 24;

            // 해시태그 겹침 + 같은 작가 + 최신순을 가중치로 점수 계산
            const scored = rows.map((p) => {
            const postTags = (p.hashtags || '')
              .split(',')
              .map((t) => t.trim().toLowerCase())
              .filter(Boolean);

            const overlapCount = postTags.filter((t) =>
              currentTags.includes(t)
            ).length;

            const sameAuthor = p.author_id === current.author_id ? 1 : 0;

            const createdTime = new Date(p.created_at).getTime();
            let recencyScore = 0;
            if (!isNaN(createdTime)) {
              const daysAgo = (now - createdTime) / ONE_DAY;
              recencyScore = Math.max(0, 7 - daysAgo);
            }

            const likeCount = p.like_count || 0;

            const score =
              overlapCount * 3 +
              sameAuthor * 2 +
              likeCount * 1 +
              recencyScore * 1;

            return { ...p, _score: score };
          });

          scored.sort((a, b) => b._score - a._score);

          const finalPosts = scored.slice(0, limit).map((p) => {
            const copy = { ...p };
            delete copy._score;
            return copy;
          });

          return res.json({ ok: true, posts: finalPosts });
        }
      );
    }
  );
});


// 9-7) 글 상세 조회 (편집용)
router.get('/posts/:id', authRequired, (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;

  db.get(
    `
    SELECT
      p.id,
      p.title,
      p.content,
      ${CATEGORY_SQL} AS category,
      p.created_at,
      GROUP_CONCAT(DISTINCT h.name) AS hashtags
    FROM posts p
    LEFT JOIN post_hashtags ph ON ph.post_id = p.id
    LEFT JOIN hashtags h ON h.id = ph.hashtag_id
    WHERE p.id = ? AND p.user_id = ?
    GROUP BY p.id
    `,
    [postId, userId],
    (err, row) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '글 조회 중 DB 오류가 발생했습니다.' });
      }

      if (!row) {
        return res
          .status(404)
          .json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });
      }

      const tags = row.hashtags
        ? row.hashtags.split(',').filter((t) => t && t.length > 0)
        : [];

      return res.json({
        ok: true,
        post: {
          id: row.id,
          title: row.title,
          content: row.content,
          category: row.category,
          created_at: row.created_at,
          hashtags: tags,
        },
      });
    }
  );
});

// 9-8) 글 삭제
router.delete('/posts/:id', authRequired, (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;
  const isAdmin = !!req.user.isAdmin;

  db.get('SELECT user_id FROM posts WHERE id = ?', [postId], (err, row) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ ok: false, message: '글 조회 중 DB 오류가 발생했습니다.' });
    }

    if (!row) {
      return res
        .status(404)
        .json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });
    }

    if (!isAdmin && row.user_id !== userId) {
      return res
        .status(403)
        .json({ ok: false, message: '이 글을 삭제할 권한이 없습니다.' });
    }

    db.run('DELETE FROM posts WHERE id = ?', [postId], function (err2) {
      if (err2) {
        console.error(err2);
        return res
          .status(500)
          .json({ ok: false, message: '글 삭제 중 DB 오류가 발생했습니다.' });
      }

      if (this.changes === 0) {
        return res
          .status(404)
          .json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });
      }

      return res.json({ ok: true, message: '글이 삭제되었습니다.' });
    });
  });
});

// 9-9) 좋아요 토글
// - 이미 누른 경우 삭제, 아니면 추가 후 현재 좋아요 수 반환
router.post('/posts/:id/toggle-like', authRequired, (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;

  db.get(
    'SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?',
    [userId, postId],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).json({
          ok: false,
          message: '좋아요 상태 확인 중 DB 오류가 발생했습니다.',
        });
      }

      if (row) {
        db.run(
          'DELETE FROM likes WHERE user_id = ? AND post_id = ?',
          [userId, postId],
          function (err2) {
            if (err2) {
              console.error(err2);
              return res.status(500).json({
                ok: false,
                message: '좋아요 취소 중 DB 오류가 발생했습니다.',
              });
            }

            db.get(
              'SELECT COUNT(*) AS cnt FROM likes WHERE post_id = ?',
              [postId],
              (err3, row2) => {
                if (err3) {
                  console.error(err3);
                  return res.status(500).json({
                    ok: false,
                    message: '좋아요 수 조회 중 DB 오류가 발생했습니다.',
                  });
                }

                return res.json({
                  ok: true,
                  liked: false,
                  likeCount: row2.cnt || 0,
                });
              }
            );
          }
        );
      } else {
        db.run(
          'INSERT INTO likes (user_id, post_id) VALUES (?, ?)',
          [userId, postId],
          function (err2) {
            if (err2) {
              console.error(err2);
              return res.status(500).json({
                ok: false,
                message: '좋아요 추가 중 DB 오류가 발생했습니다.',
              });
            }

            db.get(
              'SELECT COUNT(*) AS cnt FROM likes WHERE post_id = ?',
              [postId],
              (err3, row2) => {
                if (err3) {
                  console.error(err3);
                  return res.status(500).json({
                    ok: false,
                    message: '좋아요 수 조회 중 DB 오류가 발생했습니다.',
                  });
                }

                return res.json({
                  ok: true,
                  liked: true,
                  likeCount: row2.cnt || 0,
                });
              }
            );
          }
        );
      }
    }
  );
});
// 9-10) 공개 글 상세 조회 (좋아요 개수 + 내가 눌렀는지 여부까지)
router.get('/posts/:id/detail', (req, res) => {
  const postId = parseInt(req.params.id, 10);
  if (!postId) {
    return res
      .status(400)
      .json({ ok: false, message: '잘못된 글 ID입니다.' });
  }

  let userId = null;
  const token = req.cookies.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      userId = decoded.id;
    } catch (e) {
      userId = null;
    }
  }

  const baseSelect = `
    SELECT
      p.id,
      p.title,
      p.content,
      ${CATEGORY_SQL} AS category,
      p.created_at,
      u.id       AS author_id,
      u.name     AS author_name,
      u.nickname AS author_nickname,
      u.email    AS author_email,
      IFNULL(l.like_count, 0) AS like_count,
      GROUP_CONCAT(DISTINCT h.name) AS hashtags
    FROM posts p
    JOIN users u ON p.user_id = u.id
    LEFT JOIN (
      SELECT post_id, COUNT(*) AS like_count
      FROM likes
      GROUP BY post_id
    ) l ON l.post_id = p.id
    LEFT JOIN post_hashtags ph ON ph.post_id = p.id
    LEFT JOIN hashtags h ON h.id = ph.hashtag_id
    WHERE p.id = ?
    GROUP BY p.id
  `;

  let sql;
  let params;

  if (userId) {
    sql = `
      SELECT sub.*,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM likes l2
            WHERE l2.post_id = sub.id AND l2.user_id = ?
          ) THEN 1 ELSE 0
        END AS user_liked
      FROM (${baseSelect}) AS sub
    `;
    params = [userId, postId];
  } else {
    sql = `
      SELECT sub.*, 0 AS user_liked
      FROM (${baseSelect}) AS sub
    `;
    params = [postId];
  }

  db.get(sql, params, (err, row) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ ok: false, message: '글 상세 조회 중 DB 오류가 발생했습니다.' });
    }

    if (!row) {
      return res
        .status(404)
        .json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });
    }

    const hashtags = row.hashtags
      ? row.hashtags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    return res.json({
      ok: true,
      post: {
        id: row.id,
        title: row.title,
        content: row.content,
        category: row.category,
        created_at: row.created_at,
        author_id: row.author_id,
        author_name: row.author_name,
        author_nickname: row.author_nickname,
        author_email: row.author_email,
        like_count: row.like_count,
        user_liked: row.user_liked ? 1 : 0,
        hashtags,
      },
    });
  });
});

module.exports = router;
