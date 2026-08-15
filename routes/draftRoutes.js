const express = require('express');
const { authRequired } = require('../middleware/auth');
const { allAsync, getAsync, runAsync } = require('../utils/questService');

const router = express.Router();
const MAX_DRAFTS = 30;
const MAX_STATE_BYTES = 64 * 1024;
const DRAFT_KEY_PATTERN = /^[a-zA-Z0-9:_-]{1,120}$/;

function normalizeClientType(value) {
  return value === 'web' || value === 'native' ? value : 'unknown';
}

function normalizeDraftKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  return DRAFT_KEY_PATTERN.test(key) ? key : null;
}

function parseStateJson(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_STATE_BYTES) return null;
  return { state: value, serialized };
}

function serializeDraft(row) {
  let state = {};
  try {
    state = JSON.parse(row.state_json);
  } catch {
    state = {};
  }
  return {
    id: row.draft_key,
    draft_key: row.draft_key,
    client_type: row.client_type,
    state,
    client_updated_at_ms: Number(row.client_updated_at_ms),
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
  };
}

async function cleanupExpiredDrafts(userId) {
  await runAsync('DELETE FROM user_drafts WHERE user_id = ? AND expires_at <= CURRENT_TIMESTAMP', [
    userId,
  ]);
}

router.get('/drafts', authRequired, async (req, res) => {
  try {
    await cleanupExpiredDrafts(req.user.id);
    const rows = await allAsync(
      `SELECT draft_key, client_type, state_json, client_updated_at_ms,
              created_at, updated_at, expires_at
       FROM user_drafts
       WHERE user_id = ?
       ORDER BY client_updated_at_ms DESC
       LIMIT ?`,
      [req.user.id, MAX_DRAFTS]
    );
    return res.json({ ok: true, drafts: rows.map(serializeDraft) });
  } catch (error) {
    console.error('[drafts/list] failed:', error);
    return res.status(500).json({ ok: false, code: 'DRAFT_LIST_FAILED', message: '초안을 불러오지 못했습니다.' });
  }
});

router.get('/drafts/:draftKey', authRequired, async (req, res) => {
  const draftKey = normalizeDraftKey(req.params.draftKey);
  if (!draftKey) {
    return res.status(400).json({ ok: false, code: 'INVALID_DRAFT_KEY', message: '초안 식별자가 올바르지 않습니다.' });
  }
  try {
    await cleanupExpiredDrafts(req.user.id);
    const row = await getAsync(
      `SELECT draft_key, client_type, state_json, client_updated_at_ms,
              created_at, updated_at, expires_at
       FROM user_drafts
       WHERE user_id = ? AND draft_key = ?`,
      [req.user.id, draftKey]
    );
    if (!row) {
      return res.status(404).json({ ok: false, code: 'DRAFT_NOT_FOUND', message: '저장된 초안이 없습니다.' });
    }
    return res.json({ ok: true, draft: serializeDraft(row) });
  } catch (error) {
    console.error('[drafts/get] failed:', error);
    return res.status(500).json({ ok: false, code: 'DRAFT_GET_FAILED', message: '초안을 불러오지 못했습니다.' });
  }
});

router.put('/drafts/:draftKey', authRequired, async (req, res) => {
  const draftKey = normalizeDraftKey(req.params.draftKey);
  const parsedState = parseStateJson(req.body?.state);
  const clientUpdatedAtMs = Number(req.body?.client_updated_at_ms);
  if (!draftKey || !parsedState || !Number.isSafeInteger(clientUpdatedAtMs) || clientUpdatedAtMs <= 0) {
    return res.status(400).json({ ok: false, code: 'INVALID_DRAFT', message: '초안 데이터가 올바르지 않습니다.' });
  }

  try {
    await runAsync(
      `INSERT INTO user_drafts (
         user_id, draft_key, client_type, state_json, client_updated_at_ms,
         created_at, updated_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, datetime('now', '+30 days'))
       ON CONFLICT(user_id, draft_key) DO UPDATE SET
         client_type = excluded.client_type,
         state_json = excluded.state_json,
         client_updated_at_ms = excluded.client_updated_at_ms,
         updated_at = CURRENT_TIMESTAMP,
         expires_at = datetime('now', '+30 days')
       WHERE excluded.client_updated_at_ms >= user_drafts.client_updated_at_ms`,
      [
        req.user.id,
        draftKey,
        normalizeClientType(req.body?.client_type),
        parsedState.serialized,
        clientUpdatedAtMs,
      ]
    );
    const row = await getAsync(
      `SELECT draft_key, client_type, state_json, client_updated_at_ms,
              created_at, updated_at, expires_at
       FROM user_drafts WHERE user_id = ? AND draft_key = ?`,
      [req.user.id, draftKey]
    );
    return res.json({ ok: true, draft: serializeDraft(row) });
  } catch (error) {
    console.error('[drafts/save] failed:', error);
    return res.status(500).json({ ok: false, code: 'DRAFT_SAVE_FAILED', message: '초안을 저장하지 못했습니다.' });
  }
});

router.delete('/drafts/:draftKey', authRequired, async (req, res) => {
  const draftKey = normalizeDraftKey(req.params.draftKey);
  if (!draftKey) {
    return res.status(400).json({ ok: false, code: 'INVALID_DRAFT_KEY', message: '초안 식별자가 올바르지 않습니다.' });
  }
  try {
    await runAsync('DELETE FROM user_drafts WHERE user_id = ? AND draft_key = ?', [req.user.id, draftKey]);
    return res.json({ ok: true });
  } catch (error) {
    console.error('[drafts/delete] failed:', error);
    return res.status(500).json({ ok: false, code: 'DRAFT_DELETE_FAILED', message: '초안을 삭제하지 못했습니다.' });
  }
});

router.delete('/drafts', authRequired, async (req, res) => {
  try {
    await runAsync('DELETE FROM user_drafts WHERE user_id = ?', [req.user.id]);
    return res.json({ ok: true });
  } catch (error) {
    console.error('[drafts/clear] failed:', error);
    return res.status(500).json({ ok: false, code: 'DRAFT_CLEAR_FAILED', message: '초안을 비우지 못했습니다.' });
  }
});

module.exports = router;
