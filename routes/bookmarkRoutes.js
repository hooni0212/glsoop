const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { handleBookmarkAdded } = require('../utils/growth');

const router = express.Router();

function normalizeListPayload(body = {}) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description =
    typeof body.description === 'string' ? body.description.trim() : '';
  return { name, description };
}

router.get('/bookmarks/lists', authRequired, (req, res) => {
  const userId = req.user.id;

  db.all(
    `SELECT l.*, (
       SELECT COUNT(*) FROM bookmark_items bi WHERE bi.list_id = l.id
     ) AS item_count
     FROM bookmark_lists l
     WHERE l.user_id = ?
     ORDER BY l.created_at DESC, l.id DESC`,
    [userId],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '북마크 폴더 조회 중 오류가 발생했습니다.' });
      }
      return res.json({
        ok: true,
        message: '북마크 폴더를 불러왔습니다.',
        lists: rows || [],
      });
    }
  );
});

router.post('/bookmarks/lists', authRequired, (req, res) => {
  const userId = req.user.id;
  const { name, description } = normalizeListPayload(req.body);

  if (!name || name.length > 80) {
    return res.status(400).json({
      ok: false,
      message: '폴더 이름을 입력해주세요. (1~80자)',
    });
  }

  db.run(
    `INSERT INTO bookmark_lists (user_id, name, description) VALUES (?, ?, ?)`,
    [userId, name, description || null],
    function (err) {
      if (err) {
        if (err.code === 'SQLITE_CONSTRAINT') {
          return res
            .status(400)
            .json({ ok: false, message: '같은 이름의 폴더가 이미 있습니다.' });
        }
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '폴더 생성 중 오류가 발생했습니다.' });
      }

      return res.json({
        ok: true,
        message: '북마크 폴더가 생성되었습니다.',
        list: {
          id: this.lastID,
          user_id: userId,
          name,
          description: description || null,
        },
      });
    }
  );
});

router.patch('/bookmarks/lists/:listId', authRequired, (req, res) => {
  const userId = req.user.id;
  const listId = parseInt(req.params.listId, 10);
  const { name, description } = normalizeListPayload(req.body);

  if (!listId) {
    return res
      .status(400)
      .json({ ok: false, message: '잘못된 폴더 ID입니다.' });
  }

  db.get(
    'SELECT * FROM bookmark_lists WHERE id = ?',
    [listId],
    (err, list) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '폴더 조회 중 오류가 발생했습니다.' });
      }
      if (!list) {
        return res
          .status(404)
          .json({ ok: false, message: '폴더를 찾을 수 없습니다.' });
      }
      if (list.user_id !== userId) {
        return res
          .status(403)
          .json({ ok: false, message: '폴더를 수정할 권한이 없습니다.' });
      }

      const nextName = name || list.name;
      const nextDesc =
        description !== undefined && description !== null
          ? description
          : list.description;

      if (!nextName || nextName.length > 80) {
        return res
          .status(400)
          .json({ ok: false, message: '폴더 이름을 입력해주세요. (1~80자)' });
      }

      db.run(
        'UPDATE bookmark_lists SET name = ?, description = ? WHERE id = ?',
        [nextName, nextDesc || null, listId],
        function (err2) {
          if (err2) {
            if (err2.code === 'SQLITE_CONSTRAINT') {
              return res.status(400).json({
                ok: false,
                message: '같은 이름의 폴더가 이미 있습니다.',
              });
            }
            console.error(err2);
            return res.status(500).json({
              ok: false,
              message: '폴더 수정 중 오류가 발생했습니다.',
            });
          }

          return res.json({
            ok: true,
            message: '북마크 폴더가 수정되었습니다.',
            list: { ...list, name: nextName, description: nextDesc || null },
          });
        }
      );
    }
  );
});

router.delete('/bookmarks/lists/:listId', authRequired, (req, res) => {
  const userId = req.user.id;
  const listId = parseInt(req.params.listId, 10);
  if (!listId) {
    return res
      .status(400)
      .json({ ok: false, message: '잘못된 폴더 ID입니다.' });
  }

  db.get(
    'SELECT user_id FROM bookmark_lists WHERE id = ?',
    [listId],
    (err, list) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '폴더 조회 중 오류가 발생했습니다.' });
      }
      if (!list) {
        return res
          .status(404)
          .json({ ok: false, message: '폴더를 찾을 수 없습니다.' });
      }
      if (list.user_id !== userId) {
        return res
          .status(403)
          .json({ ok: false, message: '폴더를 삭제할 권한이 없습니다.' });
      }

      db.run('DELETE FROM bookmark_items WHERE list_id = ?', [listId], (err2) => {
        if (err2) {
          console.error(err2);
          return res
            .status(500)
            .json({ ok: false, message: '폴더 삭제 중 오류가 발생했습니다.' });
        }

        db.run('DELETE FROM bookmark_lists WHERE id = ?', [listId], (err3) => {
          if (err3) {
            console.error(err3);
            return res.status(500).json({
              ok: false,
              message: '폴더 삭제 중 오류가 발생했습니다.',
            });
          }

          return res.json({ ok: true, message: '폴더가 삭제되었습니다.' });
        });
      });
    }
  );
});

router.post('/bookmarks/lists/:listId/items', authRequired, (req, res) => {
  const userId = req.user.id;
  const listId = parseInt(req.params.listId, 10);
  const postId = parseInt(req.body.postId, 10);

  if (!listId || !postId) {
    return res.status(400).json({ ok: false, message: '잘못된 요청입니다.' });
  }

  db.get(
    'SELECT user_id FROM bookmark_lists WHERE id = ?',
    [listId],
    (err, list) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '폴더 확인 중 오류가 발생했습니다.' });
      }
      if (!list) {
        return res
          .status(404)
          .json({ ok: false, message: '폴더를 찾을 수 없습니다.' });
      }
      if (list.user_id !== userId) {
        return res
          .status(403)
          .json({ ok: false, message: '이 폴더에 추가할 권한이 없습니다.' });
      }

      db.get('SELECT user_id FROM posts WHERE id = ?', [postId], (postErr, post) => {
        if (postErr) {
          console.error(postErr);
          return res.status(500).json({ ok: false, message: '글 정보를 불러오지 못했습니다.' });
        }
        if (!post) {
          return res
            .status(404)
            .json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });
        }

        db.run(
          'INSERT OR IGNORE INTO bookmark_items (list_id, post_id) VALUES (?, ?)',
          [listId, postId],
          function (err2) {
            if (err2) {
              console.error(err2);
              return res.status(500).json({
                ok: false,
                message: '북마크 추가 중 오류가 발생했습니다.',
              });
            }

            const inserted = this.changes > 0;
            if (inserted) {
              handleBookmarkAdded(userId, post.user_id, postId, inserted).catch((growthErr) =>
                console.error('bookmark growth 처리 실패:', growthErr)
              );
            }

            return res.json({ ok: true, message: '북마크가 추가되었습니다.' });
          }
        );
      });
    }
  );
});

router.delete(
  '/bookmarks/lists/:listId/items/:postId',
  authRequired,
  (req, res) => {
    const userId = req.user.id;
    const listId = parseInt(req.params.listId, 10);
    const postId = parseInt(req.params.postId, 10);

    if (!listId || !postId) {
      return res.status(400).json({ ok: false, message: '잘못된 요청입니다.' });
    }

    db.get(
      'SELECT user_id FROM bookmark_lists WHERE id = ?',
      [listId],
      (err, list) => {
        if (err) {
          console.error(err);
          return res
            .status(500)
            .json({ ok: false, message: '폴더 확인 중 오류가 발생했습니다.' });
        }
        if (!list) {
          return res
            .status(404)
            .json({ ok: false, message: '폴더를 찾을 수 없습니다.' });
        }
        if (list.user_id !== userId) {
          return res.status(403).json({
            ok: false,
            message: '이 폴더에서 삭제할 권한이 없습니다.',
          });
        }

        db.run(
          'DELETE FROM bookmark_items WHERE list_id = ? AND post_id = ?',
          [listId, postId],
          (err2) => {
            if (err2) {
              console.error(err2);
              return res.status(500).json({
                ok: false,
                message: '북마크 삭제 중 오류가 발생했습니다.',
              });
            }
            return res.json({ ok: true, message: '북마크가 삭제되었습니다.' });
          }
        );
      }
    );
  }
);

router.get('/bookmarks/lists/:listId/items', authRequired, (req, res) => {
  const userId = req.user.id;
  const listId = parseInt(req.params.listId, 10);
  const limit = parseInt(req.query.limit, 10) || 10;
  const offset = parseInt(req.query.offset, 10) || 0;

  if (!listId) {
    return res
      .status(400)
      .json({ ok: false, message: '잘못된 폴더 ID입니다.' });
  }

  db.get(
    'SELECT user_id FROM bookmark_lists WHERE id = ?',
    [listId],
    (err, list) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '폴더 조회 중 오류가 발생했습니다.' });
      }
      if (!list) {
        return res
          .status(404)
          .json({ ok: false, message: '폴더를 찾을 수 없습니다.' });
      }
      if (list.user_id !== userId) {
        return res
          .status(403)
          .json({ ok: false, message: '폴더 접근 권한이 없습니다.' });
      }

      const selectClause = `
        SELECT
          p.id,
          p.title,
          p.content,
          p.created_at,
          CASE
            WHEN p.category IN ('poem','essay','short') THEN p.category
            ELSE 'short'
          END AS category,
          u.id       AS author_id,
          u.name     AS author_name,
          u.nickname AS author_nickname,
          u.email    AS author_email,
          IFNULL(lc.like_count, 0) AS like_count,
          CASE WHEN my.user_id IS NULL THEN 0 ELSE 1 END AS user_liked,
          GROUP_CONCAT(DISTINCT h.name) AS hashtags
      `;

      const sql = `
        ${selectClause}
        FROM bookmark_items bi
        JOIN posts p ON p.id = bi.post_id
        JOIN users u ON p.user_id = u.id
        LEFT JOIN post_hashtags ph ON ph.post_id = p.id
        LEFT JOIN hashtags h ON h.id = ph.hashtag_id
        LEFT JOIN (SELECT post_id, COUNT(*) AS like_count FROM likes GROUP BY post_id) lc ON lc.post_id = p.id
        LEFT JOIN likes my ON my.post_id = p.id AND my.user_id = ?
        WHERE bi.list_id = ?
        GROUP BY p.id
        ORDER BY bi.created_at DESC
        LIMIT ? OFFSET ?
      `;

      db.all(sql, [userId, listId, limit, offset], (err2, rows) => {
        if (err2) {
          console.error(err2);
          return res.status(500).json({
            ok: false,
            message: '북마크 글을 가져오는 중 오류가 발생했습니다.',
          });
        }

        return res.json({
          ok: true,
          message: '북마크 글 목록을 불러왔습니다.',
          posts: rows || [],
          has_more: (rows || []).length === limit,
        });
      });
    }
  );
});

router.get('/posts/:postId/bookmarks', authRequired, (req, res) => {
  const userId = req.user.id;
  const postId = parseInt(req.params.postId, 10);
  if (!postId) {
    return res
      .status(400)
      .json({ ok: false, message: '잘못된 글 ID입니다.' });
  }

  db.all(
    `
    SELECT l.id, l.name, l.description,
      CASE WHEN bi.post_id IS NULL THEN 0 ELSE 1 END AS contains
    FROM bookmark_lists l
    LEFT JOIN bookmark_items bi ON bi.list_id = l.id AND bi.post_id = ?
    WHERE l.user_id = ?
    ORDER BY l.created_at DESC, l.id DESC
    `,
    [postId, userId],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '북마크 정보를 불러오지 못했습니다.' });
      }

      return res.json({
        ok: true,
        message: '북마크 정보를 불러왔습니다.',
        lists: rows || [],
      });
    }
  );
});

module.exports = router;
