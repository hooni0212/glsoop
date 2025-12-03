// routes/userRoutes.js
const express = require('express');
const jwt = require('jsonwebtoken');

const db = require('../db');
const { JWT_SECRET } = require('../config');
const { authRequired, adminRequired } = require('../middleware/auth');

const router = express.Router();

// 8-1) 작가 공개 프로필 조회
router.get('/users/:id/profile', (req, res) => {
  const authorId = req.params.id;

  db.get(
    `
    SELECT
      id,
      name,
      nickname,
      email,
      bio,
      about
    FROM users
    WHERE id = ?
    `,
    [authorId],
    (err, user) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '작가 정보 조회 중 DB 오류가 발생했습니다.' });
      }

      if (!user) {
        return res
          .status(404)
          .json({ ok: false, message: '해당 작가를 찾을 수 없습니다.' });
      }

      db.get(
        `
        SELECT
          COUNT(DISTINCT p.id) AS post_count,
          COUNT(l.post_id)     AS total_likes
        FROM posts p
        LEFT JOIN likes l ON l.post_id = p.id
        WHERE p.user_id = ?
        `,
        [authorId],
        (err2, stats) => {
          if (err2) {
            console.error(err2);
            return res.status(500).json({
              ok: false,
              message: '작가 통계 조회 중 DB 오류가 발생했습니다.',
            });
          }

          return res.json({
            ok: true,
            user: {
              id: user.id,
              name: user.name,
              nickname: user.nickname,
              email: user.email,
              bio: user.bio || null,
              about: user.about || null,
              postCount: stats?.post_count || 0,
              totalLikes: stats?.total_likes || 0,
            },
          });
        }
      );
    }
  );
});

// 8-2) 특정 작가의 글 목록 (무한스크롤용)
router.get('/users/:id/posts', (req, res) => {
  const authorId = req.params.id;

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

  const baseSelect = `
    SELECT
      p.id,
      p.title,
      p.content,
      p.created_at,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
      GROUP_CONCAT(DISTINCT h.name) AS hashtags
  `;

  const baseFromJoin = `
    FROM posts p
    LEFT JOIN post_hashtags ph ON ph.post_id = p.id
    LEFT JOIN hashtags h ON h.id = ph.hashtag_id
  `;

  const baseWhere = `
    WHERE p.user_id = ?
  `;

  const baseGroupOrder = `
    GROUP BY p.id
    ORDER BY p.created_at DESC
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

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        ok: false,
        message: '작가 글 목록 조회 중 DB 오류가 발생했습니다.',
      });
    }

    return res.json({
      ok: true,
      posts: rows || [],
      hasMore: rows.length === limit,
    });
  });
});

// 10-1) 관리자: 전체 회원 목록
router.get('/admin/users', authRequired, adminRequired, (req, res) => {
  db.all(
    `
    SELECT
      id,
      name,
      email,
      nickname,
      is_admin,
      COALESCE(is_verified, 0) AS is_verified
    FROM users
    ORDER BY id ASC
    `,
    [],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '유저 목록 조회 중 DB 오류가 발생했습니다.' });
      }

      return res.json({
        ok: true,
        users: rows,
      });
    }
  );
});

// 10-2) 관리자: 특정 회원 및 관련 데이터 삭제
router.delete(
  '/admin/users/:id',
  authRequired,
  adminRequired,
  (req, res) => {
    const targetUserId = req.params.id;

    db.serialize(() => {
      db.run(
        'DELETE FROM likes WHERE user_id = ?',
        [targetUserId],
        function (err1) {
          if (err1) {
            console.error(err1);
            return res.status(500).json({
              ok: false,
              message: '회원 좋아요 삭제 중 오류가 발생했습니다.',
            });
          }

          db.run(
            `
            DELETE FROM likes
            WHERE post_id IN (SELECT id FROM posts WHERE user_id = ?)
            `,
            [targetUserId],
            function (err2) {
              if (err2) {
                console.error(err2);
                return res.status(500).json({
                  ok: false,
                  message:
                    '회원 게시글의 좋아요 삭제 중 오류가 발생했습니다.',
                });
              }

              db.run(
                'DELETE FROM posts WHERE user_id = ?',
                [targetUserId],
                function (err3) {
                  if (err3) {
                    console.error(err3);
                    return res.status(500).json({
                      ok: false,
                      message: '회원 게시글 삭제 중 오류가 발생했습니다.',
                    });
                  }

                  db.run(
                    'DELETE FROM users WHERE id = ?',
                    [targetUserId],
                    function (err4) {
                      if (err4) {
                        console.error(err4);
                        return res.status(500).json({
                          ok: false,
                          message: '회원 삭제 중 DB 오류가 발생했습니다.',
                        });
                      }

                      if (this.changes === 0) {
                        return res.status(404).json({
                          ok: false,
                          message: '해당 회원을 찾을 수 없습니다.',
                        });
                      }

                      return res.json({
                        ok: true,
                        message: '회원 및 관련 데이터가 모두 삭제되었습니다.',
                      });
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  }
);

module.exports = router;
