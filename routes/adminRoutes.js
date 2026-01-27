const express = require('express');
const db = require('../db');
const { authRequired, adminRequired } = require('../middleware/auth');
const { allAsync, getAsync, runAsync } = require('../utils/questService');

const router = express.Router();

async function ensureAchievementCampaign() {
  const existing = await getAsync(
    "SELECT id FROM quest_campaigns WHERE LOWER(campaign_type) = 'permanent' AND name = '업적' LIMIT 1"
  );
  if (existing) return existing.id;
  const result = await runAsync(
    `INSERT INTO quest_campaigns (name, description, campaign_type, is_active, priority)
     VALUES (?, ?, ?, ?, ?)`,
    ['업적', '업적 캠페인', 'permanent', 1, 1]
  );
  return result?.lastID || null;
}

async function getAchievementCampaignId() {
  const existing = await getAsync(
    "SELECT id FROM quest_campaigns WHERE LOWER(campaign_type) = 'permanent' AND name = '업적' LIMIT 1"
  );
  return existing?.id || null;
}

async function ensureCampaignItem(campaignId, templateId) {
  if (!campaignId || !templateId) return;
  const existing = await getAsync(
    'SELECT id FROM quest_campaign_items WHERE campaign_id = ? AND template_id = ? LIMIT 1',
    [campaignId, templateId]
  );
  if (existing) return;
  const orderRow = await getAsync(
    'SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM quest_campaign_items WHERE campaign_id = ?',
    [campaignId]
  );
  const nextOrder = (orderRow?.max_sort || 0) + 1;
  await runAsync(
    'INSERT INTO quest_campaign_items (campaign_id, template_id, sort_order) VALUES (?, ?, ?)',
    [campaignId, templateId, nextOrder]
  );
}

async function backfillAchievementTemplate(campaignId, templateId) {
  if (!campaignId || !templateId) return { changes: 0 };
  return runAsync(
    `INSERT OR IGNORE INTO user_quest_state
      (user_id, campaign_id, template_id, progress, reset_key)
     SELECT u.id, ?, ?, 0, 'permanent'
     FROM users u`,
    [campaignId, templateId]
  );
}

async function backfillAllAchievements(campaignId) {
  if (!campaignId) return { changes: 0 };
  return runAsync(
    `INSERT OR IGNORE INTO user_quest_state
      (user_id, campaign_id, template_id, progress, reset_key)
     SELECT u.id, ?, qci.template_id, 0, 'permanent'
     FROM users u
     JOIN quest_campaign_items qci ON qci.campaign_id = ?
     JOIN quest_templates qt ON qt.id = qci.template_id
     WHERE qt.template_kind = 'achievement' AND qt.is_active = 1`,
    [campaignId, campaignId]
  );
}

async function removeCampaignItem(campaignId, templateId) {
  if (!campaignId || !templateId) return;
  await runAsync(
    'DELETE FROM quest_campaign_items WHERE campaign_id = ? AND template_id = ?',
    [campaignId, templateId]
  );
}

// 모든 관리자 라우트에 인증/관리자 검증을 공통 적용
router.use(authRequired, adminRequired);

// 헬스 체크: admin 네임스페이스가 정상적으로 연결되었는지 확인
router.get('/', (req, res) => {
  res.json({ ok: true, message: 'admin api ready' });
});

router.get('/users', async (req, res) => {
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
    return res.json({
      ok: true,
      message: '회원 목록을 불러왔습니다.',
      users: rows,
      total: totalRow?.cnt || 0,
      page: Number(page),
      page_size: pageSize,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: '회원 목록 조회 중 오류가 발생했습니다.' });
  }
});

router.delete('/users/:id', (req, res) => {
  const targetUserId = req.params.id;
  db.serialize(() => {
    db.run('DELETE FROM user_quest_state WHERE user_id = ?', [targetUserId]);
    db.run('DELETE FROM user_achievements WHERE user_id = ?', [targetUserId]);
    db.run('DELETE FROM xp_log WHERE user_id = ?', [targetUserId]);
    db.run('DELETE FROM otp_verifications WHERE user_id = ?', [targetUserId]);
    db.run('DELETE FROM follows WHERE follower_id = ? OR followee_id = ?', [targetUserId, targetUserId]);
    db.run('DELETE FROM likes WHERE user_id = ?', [targetUserId]);
    db.run('DELETE FROM likes WHERE post_id IN (SELECT id FROM posts WHERE user_id = ?)', [targetUserId]);
    db.run('DELETE FROM bookmark_lists WHERE user_id = ?', [targetUserId]);
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

router.get('/posts', async (req, res) => {
  const {
    search = '',
    category = 'all',
    sort = 'recent',
    page = 1,
    range = 'all',
    limit = 48,
  } = req.query;
  const pageSize = Math.min(Math.max(Number(limit) || 48, 1), 200);
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
    sort === 'oldest' || sort === 'old'
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
    return res.json({
      ok: true,
      message: '글 목록을 불러왔습니다.',
      items: rows,
      total: totalRow?.cnt || 0,
      page: Number(page),
      page_size: pageSize,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: '글 목록 조회 중 오류가 발생했습니다.' });
  }
});

router.get('/posts/:id', async (req, res) => {
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

    return res.json({ ok: true, message: '글 정보를 불러왔습니다.', post: row });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: '글 조회 중 오류가 발생했습니다.' });
  }
});

router.delete('/posts/:id', (req, res) => {
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
router.get('/quest-templates', async (req, res) => {
  try {
    const rows = await allAsync('SELECT * FROM quest_templates ORDER BY id DESC');
    res.json({ ok: true, message: '템플릿 목록을 불러왔습니다.', items: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: '템플릿 조회 중 오류가 발생했습니다.' });
  }
});

router.post('/quest-templates', async (req, res) => {
  const {
    name,
    description,
    condition_type,
    category,
    target_value,
    reward_xp,
    is_active = 1,
    template_kind = 'quest',
    code = null,
    ui_json = null,
  } = req.body;
  if (!name || !condition_type || !target_value) {
    return res.status(400).json({ ok: false, message: '필수 입력이 누락되었습니다.' });
  }
  const normalizedTemplateKind = String(template_kind || 'quest').toLowerCase();
  try {
    const result = await runAsync(
      `INSERT INTO quest_templates (name, description, condition_type, category, target_value, reward_xp, is_active, template_kind, code, ui_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        description || '',
        condition_type,
        category || null,
        Number(target_value),
        Number(reward_xp) || 0,
        is_active ? 1 : 0,
        normalizedTemplateKind || 'quest',
        code,
        ui_json,
      ]
    );
    let campaignId = null;
    if (normalizedTemplateKind === 'achievement') {
      campaignId = await ensureAchievementCampaign();
      await ensureCampaignItem(campaignId, result?.lastID);
      await backfillAchievementTemplate(campaignId, result?.lastID);
    }
    res.json({
      ok: true,
      message: '템플릿이 생성되었습니다.',
      template_id: result?.lastID,
      campaign_id: campaignId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: '템플릿 생성 중 오류가 발생했습니다.' });
  }
});

router.put('/quest-templates/:id', async (req, res) => {
  const {
    name,
    description,
    condition_type,
    category,
    target_value,
    reward_xp,
    is_active = 1,
    template_kind = 'quest',
    code = null,
    ui_json = null,
  } = req.body;
  const templateId = req.params.id;
  const normalizedTemplateKind = String(template_kind || 'quest').toLowerCase();
  try {
    const previous = await getAsync(
      'SELECT template_kind FROM quest_templates WHERE id = ?',
      [templateId]
    );
    const previousKind = String(previous?.template_kind || 'quest').toLowerCase();
    await runAsync(
      `UPDATE quest_templates
       SET name=?, description=?, condition_type=?, category=?, target_value=?, reward_xp=?, is_active=?, template_kind=?, code=?, ui_json=?
       WHERE id=?`,
      [
        name,
        description || '',
        condition_type,
        category || null,
        Number(target_value),
        Number(reward_xp) || 0,
        is_active ? 1 : 0,
        normalizedTemplateKind || 'quest',
        code,
        ui_json,
        templateId,
      ]
    );
    if (normalizedTemplateKind === 'achievement') {
      const campaignId = await ensureAchievementCampaign();
      await ensureCampaignItem(campaignId, templateId);
      await backfillAchievementTemplate(campaignId, templateId);
    } else if (previousKind === 'achievement') {
      const campaignId = await getAchievementCampaignId();
      await removeCampaignItem(campaignId, templateId);
    }
    res.json({ ok: true, message: '템플릿이 수정되었습니다.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: '템플릿 수정 중 오류가 발생했습니다.' });
  }
});

router.delete('/quest-templates/:id', async (req, res) => {
  try {
    await runAsync('DELETE FROM quest_campaign_items WHERE template_id = ?', [req.params.id]);
    await runAsync('DELETE FROM quest_templates WHERE id = ?', [req.params.id]);
    res.json({ ok: true, message: '템플릿이 삭제되었습니다.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: '템플릿 삭제 중 오류가 발생했습니다.' });
  }
});

router.post('/quests/achievements/backfill', async (req, res) => {
  try {
    const campaignId = await ensureAchievementCampaign();
    const result = await backfillAllAchievements(campaignId);
    res.json({ ok: true, inserted: result?.changes || 0, campaign_id: campaignId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: '업적 backfill 중 오류가 발생했습니다.' });
  }
});

// Campaigns
router.get('/quest-campaigns', async (req, res) => {
  try {
    const campaigns = await allAsync('SELECT * FROM quest_campaigns ORDER BY priority DESC, id DESC');
    const items = await allAsync(
      `SELECT qci.*, qt.name AS template_name FROM quest_campaign_items qci
       JOIN quest_templates qt ON qt.id = qci.template_id`
    );
    res.json({
      ok: true,
      message: '캠페인 목록을 불러왔습니다.',
      items: campaigns,
      campaign_items: items,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: '캠페인 조회 중 오류가 발생했습니다.' });
  }
});

router.post('/quest-campaigns', async (req, res) => {
  const { name, description, campaign_type = 'event', start_at, end_at, is_active = 0, priority = 1 } = req.body;
  if (!name) return res.status(400).json({ ok: false, message: '캠페인 이름이 필요합니다.' });
  const normalizedCampaignType = String(campaign_type || 'event').toLowerCase();
  const allowedCampaignTypes = new Set(['permanent', 'daily', 'weekly', 'season', 'event']);
  if (!allowedCampaignTypes.has(normalizedCampaignType)) {
    return res.status(400).json({ ok: false, message: '허용되지 않는 campaign_type입니다.' });
  }
  try {
    await runAsync(
      `INSERT INTO quest_campaigns (name, description, campaign_type, start_at, end_at, is_active, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, description || '', normalizedCampaignType, start_at || null, end_at || null, is_active ? 1 : 0, Number(priority) || 1]
    );
    res.json({ ok: true, message: '캠페인이 생성되었습니다.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: '캠페인 생성 중 오류가 발생했습니다.' });
  }
});

router.put('/quest-campaigns/:id', async (req, res) => {
  const { name, description, campaign_type = 'event', start_at, end_at, is_active = 0, priority = 1 } = req.body;
  const campaignId = req.params.id;
  const normalizedCampaignType = String(campaign_type || 'event').toLowerCase();
  const allowedCampaignTypes = new Set(['permanent', 'daily', 'weekly', 'season', 'event']);
  if (!allowedCampaignTypes.has(normalizedCampaignType)) {
    return res.status(400).json({ ok: false, message: '허용되지 않는 campaign_type입니다.' });
  }
  try {
    await runAsync(
      `UPDATE quest_campaigns SET name=?, description=?, campaign_type=?, start_at=?, end_at=?, is_active=?, priority=? WHERE id=?`,
      [name, description || '', normalizedCampaignType, start_at || null, end_at || null, is_active ? 1 : 0, Number(priority) || 1, campaignId]
    );
    res.json({ ok: true, message: '캠페인이 수정되었습니다.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: '캠페인 수정 중 오류가 발생했습니다.' });
  }
});

router.delete('/quest-campaigns/:id', async (req, res) => {
  try {
    await runAsync('DELETE FROM user_quest_state WHERE campaign_id = ?', [req.params.id]);
    await runAsync('DELETE FROM quest_campaigns WHERE id = ?', [req.params.id]);
    res.json({ ok: true, message: '캠페인이 삭제되었습니다.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: '캠페인 삭제 중 오류가 발생했습니다.' });
  }
});

router.put('/quest-campaigns/:id/items', async (req, res) => {
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
    res.json({ ok: true, message: '캠페인 템플릿이 저장되었습니다.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: '캠페인 템플릿 저장 중 오류가 발생했습니다.' });
  }
});

// 네임스페이스 내부 미정의 라우트는 JSON 404로 안내
router.use((req, res) => {
  return res.status(404).json({ ok: false, message: `Unknown admin route: ${req.method} ${req.originalUrl}` });
});

module.exports = router;
