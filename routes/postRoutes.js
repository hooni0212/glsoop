// routes/postRoutes.js

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
// POST /api/posts/:id/detail


const express = require('express');
const jwt = require('jsonwebtoken');

const db = require('../db');
const { JWT_SECRET } = require('../config');
const { authRequired } = require('../middleware/auth');
const { saveHashtagsForPostFromInput } = require('../utils/hashtags');

const router = express.Router();

// 9-1) 글 작성
router.post('/posts', authRequired, (req, res) => {
  const { title, content, hashtags } = req.body;
  const userId = req.user.id;

  if (!title || !content) {
    return res
      .status(400)
      .json({ ok: false, message: '제목과 내용을 모두 입력하세요.' });
  }

  db.run(
    'INSERT INTO posts (user_id, title, content) VALUES (?, ?, ?)',
    [userId, title, content],
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
  const { title, content, hashtags } = req.body;
  const userId = req.user.id;
  const isAdmin = !!req.user.isAdmin;

  if (!title || !content) {
    return res
      .status(400)
      .json({ ok: false, message: '제목과 내용을 모두 입력하세요.' });
  }

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

    db.run(
      'UPDATE posts SET title = ?, content = ? WHERE id = ?',
      [title, content, postId],
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
      p.created_at,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count
    FROM posts p
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
    `,
    [userId],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '글 목록 조회 중 DB 오류가 발생했습니다.' });
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
      p.created_at,
      (SELECT COUNT(*) FROM likes l2 WHERE l2.post_id = p.id) AS like_count
    FROM posts p
    INNER JOIN likes l ON l.post_id = p.id
    WHERE l.user_id = ?
    ORDER BY l.created_at DESC
    `,
    [userId],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '공감한 글 목록 조회 중 DB 오류가 발생했습니다.' });
      }

      return res.json({
        ok: true,
        posts: rows,
      });
    }
  );
});

// 9-5) 피드 조회 (전체 + 해시태그 필터 + 좋아요 여부)
router.get('/posts/feed', (req, res) => {
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

  let limit = parseInt(req.query.limit, 10);
  let offset = parseInt(req.query.offset, 10);

  if (isNaN(limit) || limit <= 0 || limit > 50) {
    limit = 20;
  }
  if (isNaN(offset) || offset < 0) {
    offset = 0;
  }

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

  const baseSelect = `
    SELECT
      p.id,
      p.title,
      p.content,
      p.created_at,
      u.id      AS author_id,
      u.name     AS author_name,
      u.nickname AS author_nickname,
      u.email    AS author_email,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
      GROUP_CONCAT(DISTINCT h.name) AS hashtags
  `;

  const baseFromJoin = `
    FROM posts p
    JOIN users u ON p.user_id = u.id
    LEFT JOIN post_hashtags ph ON ph.post_id = p.id
    LEFT JOIN hashtags h ON h.id = ph.hashtag_id
  `;

  const baseOrder = `
    GROUP BY p.id
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `;

  let sql;
  let params = [];

  if (userId) {
    if (tagCount > 0) {
      const placeholders = tags.map(() => '?').join(', ');
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
        WHERE p.id IN (
          SELECT ph2.post_id
          FROM post_hashtags ph2
          JOIN hashtags h2 ON h2.id = ph2.hashtag_id
          WHERE h2.name IN (${placeholders})
          GROUP BY ph2.post_id
          HAVING COUNT(DISTINCT h2.name) = ?
        )
        ${baseOrder}
      `;
      params = [userId, ...tags, tagCount, limit, offset];
    } else {
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
        ${baseOrder}
      `;
      params = [userId, limit, offset];
    }
  } else {
    if (tagCount > 0) {
      const placeholders = tags.map(() => '?').join(', ');
      sql = `
        ${baseSelect},
        0 AS user_liked
        ${baseFromJoin}
        WHERE p.id IN (
          SELECT ph2.post_id
          FROM post_hashtags ph2
          JOIN hashtags h2 ON h2.id = ph2.hashtag_id
          WHERE h2.name IN (${placeholders})
          GROUP BY ph2.post_id
          HAVING COUNT(DISTINCT h2.name) = ?
        )
        ${baseOrder}
      `;
      params = [...tags, tagCount, limit, offset];
    } else {
      sql = `
        ${baseSelect},
        0 AS user_liked
        ${baseFromJoin}
        ${baseOrder}
      `;
      params = [limit, offset];
    }
  }

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ ok: false, message: '피드 조회 중 DB 오류가 발생했습니다.' });
    }

    return res.json({
      ok: true,
      posts: rows,
      hasMore: rows.length === limit,
    });
  });
});

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

  // 쿠키에 로그인 토큰이 있으면 userId 추출 (없으면 null)
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

  // 기본 SELECT (like_count까지 포함)
  const baseSelect = `
    SELECT
      p.id,
      p.title,
      p.content,
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

  // user_liked 까지 붙이는 쿼리 (로그인 여부에 따라 다름)
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
    params = [postId, userId];
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

    // hashtags: "힐링,위로" → 배열로 변환해 주면 프론트 쓰기 편함
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
