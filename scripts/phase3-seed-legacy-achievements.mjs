import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

if (!process.env.DB_PATH) {
  console.error('[phase3 seed] DB_PATH must be set to avoid touching live data.');
  process.exit(1);
}

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const db = require('../db');
const legacyPath = path.join(repoRoot, 'docs', 'legacy-achievements.json');

const runAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

const getAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const allAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });

async function ensureAchievementCampaign() {
  const existing = await getAsync(
    "SELECT id FROM quest_campaigns WHERE LOWER(campaign_type) = 'permanent' AND name = '업적' LIMIT 1"
  );
  if (existing?.id) return existing.id;
  const result = await runAsync(
    `INSERT INTO quest_campaigns (name, description, campaign_type, is_active, priority)
     VALUES (?, ?, ?, ?, ?)`,
    ['업적', '업적 캠페인', 'permanent', 1, 1]
  );
  return result?.lastID || null;
}

async function upsertTemplate(entry) {
  const uiPayload = {
    ...(entry.ui_json || {}),
    legacy_key: entry.legacy_key,
    display_order: entry.display_order,
  };
  const existing = await getAsync('SELECT id FROM quest_templates WHERE code = ?', [entry.legacy_key]);
  if (existing?.id) {
    await runAsync(
      `UPDATE quest_templates
       SET name = ?, description = ?, condition_type = ?, category = ?, target_value = ?, reward_xp = ?,
           is_active = ?, template_kind = 'achievement', ui_json = ?
       WHERE id = ?`,
      [
        entry.title,
        entry.description,
        entry.condition_type,
        entry.category || null,
        entry.target_value || 0,
        entry.reward_xp || 0,
        entry.is_active ? 1 : 0,
        JSON.stringify(uiPayload),
        existing.id,
      ]
    );
    return existing.id;
  }

  const result = await runAsync(
    `INSERT INTO quest_templates
      (name, description, condition_type, category, target_value, reward_xp, is_active, template_kind, code, ui_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'achievement', ?, ?)`,
    [
      entry.title,
      entry.description,
      entry.condition_type,
      entry.category || null,
      entry.target_value || 0,
      entry.reward_xp || 0,
      entry.is_active ? 1 : 0,
      entry.legacy_key,
      JSON.stringify(uiPayload),
    ]
  );
  return result?.lastID || null;
}

async function ensureCampaignItem(campaignId, templateId, sortOrder) {
  const existing = await getAsync(
    'SELECT id FROM quest_campaign_items WHERE campaign_id = ? AND template_id = ? LIMIT 1',
    [campaignId, templateId]
  );
  if (existing) return;
  await runAsync(
    'INSERT INTO quest_campaign_items (campaign_id, template_id, sort_order) VALUES (?, ?, ?)',
    [campaignId, templateId, sortOrder]
  );
}

async function main() {
  const raw = fs.readFileSync(legacyPath, 'utf8');
  const list = JSON.parse(raw);
  const campaignId = await ensureAchievementCampaign();

  let created = 0;
  let updated = 0;

  for (const [index, entry] of list.entries()) {
    const existing = await getAsync('SELECT id FROM quest_templates WHERE code = ?', [entry.legacy_key]);
    const templateId = await upsertTemplate(entry);
    if (existing?.id) {
      updated += 1;
    } else {
      created += 1;
    }
    await ensureCampaignItem(campaignId, templateId, entry.display_order ?? index + 1);
  }

  const totalTemplates = await getAsync(
    "SELECT COUNT(*) as cnt FROM quest_templates WHERE template_kind = 'achievement'"
  );
  const campaignItems = await getAsync(
    'SELECT COUNT(*) as cnt FROM quest_campaign_items WHERE campaign_id = ?',
    [campaignId]
  );

  console.log('[phase3 seed] achievement templates:', totalTemplates?.cnt || 0);
  console.log('[phase3 seed] created:', created, 'updated:', updated);
  console.log('[phase3 seed] campaign items:', campaignItems?.cnt || 0);
}

main().catch((error) => {
  console.error('[phase3 seed] failed:', error);
  process.exit(1);
});
