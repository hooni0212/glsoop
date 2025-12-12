const express = require('express');
const db = require('../db');
const { authRequired, adminRequired } = require('../middleware/auth');
const { allAsync, getAsync, runAsync } = require('../utils/questService');

const router = express.Router();

router.get('/admin/users', authRequired, adminRequired, async (req, res) => {
  const { search = '', filter = 'all', sort = 'id', page = 1, adminOnly } = req.query;
  const pageSize = 20;
  const offset = (Number(page) - 1) * pageSize;
  const params = [];
  const where = [];

  if (search) {
    where.push('(name LIKE ? OR email LIKE ? OR nickname LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term);
  }
  if (filter === 'verified') {
    where.push('COALESCE(is_verified,0) = 1');
  } else if (filter === 'unverified') {
    where.push('COALESCE(is_verified,0) = 0');
  }
  if (adminOnly === 'true') {
    where.push('is_admin = 1');
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortColumn = ['id', 'name', 'email', 'is_verified'].includes(sort) ? sort : 'id';

  try {
    const totalRow = await getAsync(`SELECT COUNT(*) AS cnt FROM users ${whereClause}`, params);
    const rows = await allAsync(
      `SELECT id, name, email, nickname, is_admin, COALESCE(is_verified,0) AS is_verified
       FROM users ${whereClause}
       ORDER BY ${sortColumn} ASC
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    return res.json({ ok: true, users: rows, total: totalRow?.cnt || 0, page: Number(page), pageSize });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: '회원 목록 조회 중 오류가 발생했습니다.' });
  }
});

router.delete('/admin/users/:id', authRequired, adminRequired, (req, res) => {
  const targetUserId = req.params.id;
  db.serialize(() => {
    db.run('DELETE FROM likes WHERE user_id = ?', [targetUserId]);
    db.run('DELETE FROM likes WHERE post_id IN (SELECT id FROM posts WHERE user_id = ?)', [targetUserId]);
    db.run('DELETE FROM posts WHERE user_id = ?', [targetUserId]);
    db.run('DELETE FROM users WHERE id = ?', [targetUserId], function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ ok: false, message: '회원 삭제 중 오류가 발생했습니다.' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ ok: false, message: '해당 회원을 찾을 수 없습니다.' });
      }
      return res.json({ ok: true, message: '삭제되었습니다.' });
    });
  });
});

router.get('/admin/posts', authRequired, adminRequired, async (req, res) => {
  const {
    search = '',
    category = 'all',
    sort = 'recent',
    page = 1,
    range = 'all',
    limit = 20,
  } = req.query;
  const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 200);
  const offset = (Number(page) - 1) * pageSize;
  const where = [];
  const params = [];

  if (search) {
    where.push('(p.title LIKE ? OR u.name LIKE ? OR u.nickname LIKE ? OR u.email LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }
  if (category !== 'all') {
    where.push('p.category = ?');
    params.push(category);
  }
  if (range === '7') {
    where.push("p.created_at >= datetime('now', '-7 day')");
  } else if (range === '30') {
    where.push("p.created_at >= datetime('now', '-30 day')");
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortSql =
    sort === 'oldest'
      ? 'p.created_at ASC'
      : sort === 'likes'
      ? 'like_count DESC, p.created_at DESC'
      : 'p.created_at DESC';

  try {
    const totalRow = await getAsync(
      `SELECT COUNT(*) AS cnt FROM posts p JOIN users u ON u.id = p.user_id ${whereClause}`,
      params
    );
    const rows = await allAsync(
      `SELECT p.*, u.name AS author_name, u.nickname AS author_nickname, u.email AS author_email,
        (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count
       FROM posts p
       JOIN users u ON u.id = p.user_id
       ${whereClause}
       ORDER BY ${sortSql}
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    return res.json({ ok: true, posts: rows, total: totalRow?.cnt || 0, page: Number(page), pageSize });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: '글 목록 조회 중 오류가 발생했습니다.' });
  }
});

router.get('/admin/posts/:id', authRequired, adminRequired, async (req, res) => {
  const postId = req.params.id;
  try {
    const row = await getAsync(
      `SELECT p.*, u.name AS author_name, u.nickname AS author_nickname, u.email AS author_email,
        (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE p.id = ?
       LIMIT 1`,
      [postId]
    );

    if (!row) return res.status(404).json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });

    return res.json({ ok: true, post: row });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: '글 조회 중 오류가 발생했습니다.' });
  }
});

router.delete('/admin/posts/:id', authRequired, adminRequired, (req, res) => {
  const postId = req.params.id;
  db.serialize(() => {
    db.run('DELETE FROM likes WHERE post_id = ?', [postId]);
    db.run('DELETE FROM bookmark_items WHERE post_id = ?', [postId]);
    db.run('DELETE FROM posts WHERE id = ?', [postId], function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ ok: false, message: '글 삭제 중 오류가 발생했습니다.' });
      }
      if (this.changes === 0) return res.status(404).json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });
      return res.json({ ok: true, message: '삭제되었습니다.' });
    });
  });
});

// Quest templates CRUD
router.get('/admin/quest-templates', authRequired, adminRequired, async (req, res) => {
  try {
    const rows = await allAsync('SELECT * FROM quest_templates ORDER BY id DESC');
    res.json({ ok: true, templates: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: '템플릿 조회 중 오류가 발생했습니다.' });
  }
});

router.post('/admin/quest-templates', authRequired, adminRequired, async (req, res) => {
  const { name, description, condition_type, category, target_value, reward_xp, is_active = 1 } = req.body;
  if (!name || !condition_type || !target_value) {
    return res.status(400).json({ ok: false, message: '필수 입력이 누락되었습니다.' });
  }
  try {
    await runAsync(
      `INSERT INTO quest_templates (name, description, condition_type, category, target_value, reward_xp, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, description || '', condition_type, category || null, Number(target_value), Number(reward_xp) || 0, is_active ? 1 : 0]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: '템플릿 생성 중 오류가 발생했습니다.' });
  }
});

router.put('/admin/quest-templates/:id', authRequired, adminRequired, async (req, res) => {
  const { name, description, condition_type, category, target_value, reward_xp, is_active = 1 } = req.body;
  const templateId = req.params.id;
  try {
    await runAsync(
      `UPDATE quest_templates SET name=?, description=?, condition_type=?, category=?, target_value=?, reward_xp=?, is_active=? WHERE id=?`,
      [name, description || '', condition_type, category || null, Number(target_value), Number(reward_xp) || 0, is_active ? 1 : 0, templateId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: '템플릿 수정 중 오류가 발생했습니다.' });
  }
});

router.delete('/admin/quest-templates/:id', authRequired, adminRequired, async (req, res) => {
  try {
    await runAsync('DELETE FROM quest_templates WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: '템플릿 삭제 중 오류가 발생했습니다.' });
  }
});

// Campaigns
router.get('/admin/quest-campaigns', authRequired, adminRequired, async (req, res) => {
  try {
    const campaigns = await allAsync('SELECT * FROM quest_campaigns ORDER BY priority DESC, id DESC');
    const items = await allAsync(
      `SELECT qci.*, qt.name AS template_name FROM quest_campaign_items qci
       JOIN quest_templates qt ON qt.id = qci.template_id`
    );
    res.json({ ok: true, campaigns, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: '캠페인 조회 중 오류가 발생했습니다.' });
  }
});

router.post('/admin/quest-campaigns', authRequired, adminRequired, async (req, res) => {
  const { name, description, campaign_type = 'event', start_at, end_at, is_active = 0, priority = 1 } = req.body;
  if (!name) return res.status(400).json({ ok: false, message: '캠페인 이름이 필요합니다.' });
  try {
    await runAsync(
      `INSERT INTO quest_campaigns (name, description, campaign_type, start_at, end_at, is_active, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, description || '', campaign_type, start_at || null, end_at || null, is_active ? 1 : 0, Number(priority) || 1]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: '캠페인 생성 중 오류가 발생했습니다.' });
  }
});

router.put('/admin/quest-campaigns/:id', authRequired, adminRequired, async (req, res) => {
  const { name, description, campaign_type = 'event', start_at, end_at, is_active = 0, priority = 1 } = req.body;
  const campaignId = req.params.id;
  try {
    await runAsync(
      `UPDATE quest_campaigns SET name=?, description=?, campaign_type=?, start_at=?, end_at=?, is_active=?, priority=? WHERE id=?`,
      [name, description || '', campaign_type, start_at || null, end_at || null, is_active ? 1 : 0, Number(priority) || 1, campaignId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: '캠페인 수정 중 오류가 발생했습니다.' });
  }
});

router.delete('/admin/quest-campaigns/:id', authRequired, adminRequired, async (req, res) => {
  try {
    await runAsync('DELETE FROM quest_campaigns WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: '캠페인 삭제 중 오류가 발생했습니다.' });
  }
});

router.put('/admin/quest-campaigns/:id/items', authRequired, adminRequired, async (req, res) => {
  const { items } = req.body;
  const campaignId = req.params.id;
  if (!Array.isArray(items)) return res.status(400).json({ ok: false, message: 'items 배열이 필요합니다.' });
  try {
    await runAsync('DELETE FROM quest_campaign_items WHERE campaign_id = ?', [campaignId]);
    for (const item of items) {
      await runAsync(
        `INSERT INTO quest_campaign_items (campaign_id, template_id, sort_order) VALUES (?, ?, ?)` ,
        [campaignId, item.template_id, item.sort_order || 0]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: '캠페인 템플릿 저장 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
