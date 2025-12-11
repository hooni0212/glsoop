// routes/userRoutes.js
// - 사용자 프로필/팔로우 및 관리자 전용 사용자 관리 API
const express = require('express');
const jwt = require('jsonwebtoken');

const db = require('../db');
const { JWT_SECRET } = require('../config');
const { authRequired, adminRequired } = require('../middleware/auth');

const router = express.Router();

function applyFollowState(targetUserId, viewerId, shouldFollow, callback) {
  db.get(
    `SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?`,
    [viewerId, targetUserId],
    (err, exists) => {
      if (err) return callback(err);

      const finalize = () => {
        db.get(
          `SELECT COUNT(*) AS follower_count FROM follows WHERE followee_id = ?`,
          [targetUserId],
          (err2, countRow) => {
            if (err2) return callback(err2);
            callback(null, {
              following: shouldFollow,
              followerCount: countRow?.follower_count || 0,
            });
          }
        );
      };

      if (shouldFollow) {
        if (exists) return finalize();

        db.run(
          `INSERT INTO follows (follower_id, followee_id) VALUES (?, ?)`,
          [viewerId, targetUserId],
          (err3) => {
            if (err3 && err3.code === 'SQLITE_CONSTRAINT') {
              return finalize();
            }

            if (err3) return callback(err3);

            finalize();
          }
        );
      } else {
        if (!exists) return finalize();

        db.run(
          `DELETE FROM follows WHERE follower_id = ? AND followee_id = ?`,
          [viewerId, targetUserId],
          (err4) => {
            if (err4) return callback(err4);
            finalize();
          }
        );
      }
    }
  );
}

// 8-1) 작가 공개 프로필 조회
router.get('/users/:id/profile', (req, res) => {
  const authorId = req.params.id;

  let viewerId = null;
  const token = req.cookies.token;
  // 로그인한 사용자가 있으면 viewerId로 구분 (팔로우 여부, 소유 여부 판단용)
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      viewerId = decoded.id;
    } catch (e) {
      viewerId = null;
    }
  }

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

      // 게시글 수/누적 좋아요를 먼저 집계
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

        // 팔로워/팔로잉 수 집계 후, 로그인한 사용자의 팔로우 여부까지 확인
        db.get(
          `
          SELECT
            (SELECT COUNT(*) FROM follows f1 WHERE f1.followee_id = ?) AS follower_count,
            (SELECT COUNT(*) FROM follows f2 WHERE f2.follower_id = ?) AS following_count
          `,
          [authorId, authorId],
          (err3, followStats) => {
            if (err3) {
              console.error(err3);
              return res.status(500).json({
                ok: false,
                message: '팔로우 통계 조회 중 DB 오류가 발생했습니다.',
              });
            }

            const sendProfileResponse = (isFollowing = false) =>
              res.json({
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
                  followerCount: followStats?.follower_count || 0,
                  followingCount: followStats?.following_count || 0,
                },
                viewer: {
                  id: viewerId,
                  isLoggedIn: !!viewerId,
                  isOwnProfile: !!viewerId && viewerId === user.id,
                  isFollowing: !!isFollowing,
                },
              });

            if (viewerId) {
              db.get(
                `SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?`,
                [viewerId, authorId],
                (err4, followRow) => {
                  if (err4) {
                    console.error(err4);
                    return res.status(500).json({
                      ok: false,
                      message: '팔로우 상태 조회 중 DB 오류가 발생했습니다.',
                    });
                  }

                  return sendProfileResponse(!!followRow);
                }
              );
            } else {
              return sendProfileResponse(false);
            }
          }
        );
      }
    );
  }
  );
});

// 8-1-1) 작가 팔로우/언팔로우 토글
router.post('/users/:id/follow', authRequired, (req, res) => {
  const targetUserId = parseInt(req.params.id, 10);
  const viewerId = req.user.id;

  if (Number.isNaN(targetUserId)) {
    return res.status(400).json({ ok: false, message: '잘못된 요청입니다.' });
  }

  if (targetUserId === viewerId) {
    return res
      .status(400)
      .json({ ok: false, message: '자기 자신을 팔로우할 수 없습니다.' });
  }

  db.get(
    `SELECT id FROM users WHERE id = ?`,
    [targetUserId],
    (err, foundUser) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '사용자 조회 중 오류가 발생했습니다.' });
      }

      if (!foundUser) {
        return res
          .status(404)
          .json({ ok: false, message: '해당 사용자를 찾을 수 없습니다.' });
      }

      db.get(
        `SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?`,
        [viewerId, targetUserId],
        (err2, exists) => {
          if (err2) {
            console.error(err2);
            return res.status(500).json({
              ok: false,
              message: '팔로우 상태 확인 중 DB 오류가 발생했습니다.',
            });
          }

          applyFollowState(targetUserId, viewerId, !exists, (toggleErr, result) => {
            if (toggleErr) {
              console.error(toggleErr);
              return res.status(500).json({
                ok: false,
                message: '팔로우 처리 중 오류가 발생했습니다.',
              });
            }

            return res.json({
              ok: true,
              following: result.following,
              followerCount: result.followerCount,
            });
          });
        }
      );
    }
  );
});

router.post('/follow/:userId', authRequired, (req, res) => {
  const targetUserId = parseInt(req.params.userId, 10);
  const viewerId = req.user.id;

  if (Number.isNaN(targetUserId)) {
    return res.status(400).json({ ok: false, message: '잘못된 요청입니다.' });
  }

  if (targetUserId === viewerId) {
    return res
      .status(400)
      .json({ ok: false, message: '자기 자신을 팔로우할 수 없습니다.' });
  }

  db.get('SELECT id FROM users WHERE id = ?', [targetUserId], (err, userRow) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        ok: false,
        message: '사용자 조회 중 오류가 발생했습니다.',
      });
    }

    if (!userRow) {
      return res
        .status(404)
        .json({ ok: false, message: '해당 사용자를 찾을 수 없습니다.' });
    }

    applyFollowState(targetUserId, viewerId, true, (stateErr, result) => {
      if (stateErr) {
        console.error(stateErr);
        return res.status(500).json({
          ok: false,
          message: '팔로우 처리 중 오류가 발생했습니다.',
        });
      }

      return res.json({ ok: true, ...result });
    });
  });
});

router.delete('/follow/:userId', authRequired, (req, res) => {
  const targetUserId = parseInt(req.params.userId, 10);
  const viewerId = req.user.id;

  if (Number.isNaN(targetUserId)) {
    return res.status(400).json({ ok: false, message: '잘못된 요청입니다.' });
  }

  if (targetUserId === viewerId) {
    return res
      .status(400)
      .json({ ok: false, message: '자기 자신을 팔로우할 수 없습니다.' });
  }

  db.get('SELECT id FROM users WHERE id = ?', [targetUserId], (err, userRow) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        ok: false,
        message: '사용자 조회 중 오류가 발생했습니다.',
      });
    }

    if (!userRow) {
      return res
        .status(404)
        .json({ ok: false, message: '해당 사용자를 찾을 수 없습니다.' });
    }

    applyFollowState(targetUserId, viewerId, false, (stateErr, result) => {
      if (stateErr) {
        console.error(stateErr);
        return res.status(500).json({
          ok: false,
          message: '언팔로우 처리 중 오류가 발생했습니다.',
        });
      }

      return res.json({ ok: true, ...result });
    });
  });
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
