import { createRequire } from 'module';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.find((arg) => arg.startsWith('--limit-user='));
const limitUser = limitArg ? Number(limitArg.split('=')[1]) : null;

if (!process.env.DB_PATH) {
  console.error('[phase3 migrate] DB_PATH must be set to avoid touching live data.');
  process.exit(1);
}

const require = createRequire(import.meta.url);
const db = require('../db');

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

async function tableExists(name) {
  const row = await getAsync(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
    [name]
  );
  return Boolean(row?.name);
}

async function main() {
  const hasLegacyAchievements = await tableExists('achievements');
  const hasLegacyUserAchievements = await tableExists('user_achievements');
  if (!hasLegacyAchievements || !hasLegacyUserAchievements) {
    console.log('[phase3 migrate] legacy tables not found; skipping.');
    return;
  }

  const campaignId = await ensureAchievementCampaign();
  const templates = await allAsync(
    "SELECT id, code FROM quest_templates WHERE template_kind = 'achievement' AND code IS NOT NULL"
  );
  const templateMap = new Map();
  templates.forEach((row) => templateMap.set(row.code, row.id));
  if (templateMap.size === 0) {
    console.error('[phase3 migrate] no achievement templates found. Run phase3 seed first.');
    process.exit(1);
  }

  const userQuery = `
    SELECT ua.user_id, a.code, ua.progress_value, ua.unlocked_at
    FROM user_achievements ua
    JOIN achievements a ON a.id = ua.achievement_id
    ORDER BY ua.user_id ASC
    ${limitUser ? 'LIMIT ?' : ''}
  `;

  const rows = await allAsync(userQuery, limitUser ? [limitUser] : []);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  if (!dryRun) {
    await runAsync('BEGIN IMMEDIATE;');
  }

  try {
    for (const row of rows) {
      const templateId = templateMap.get(row.code);
      if (!templateId) {
        skipped += 1;
        continue;
      }

      if (dryRun) {
        const existing = await getAsync(
          `SELECT progress, completed_at FROM user_quest_state
           WHERE user_id = ? AND campaign_id = ? AND template_id = ? AND reset_key = ?`,
          [row.user_id, campaignId, templateId, 'permanent']
        );
        if (!existing) {
          inserted += 1;
        } else if ((row.progress_value || 0) > (existing.progress || 0) || (!existing.completed_at && row.unlocked_at)) {
          updated += 1;
        } else {
          skipped += 1;
        }
        continue;
      }

      await runAsync(
        `INSERT OR IGNORE INTO user_quest_state
          (user_id, campaign_id, template_id, progress, reset_key, completed_at)
         VALUES (?, ?, ?, ?, ?, ?)` ,
        [
          row.user_id,
          campaignId,
          templateId,
          row.progress_value || 0,
          'permanent',
          row.unlocked_at || null,
        ]
      );

      const result = await runAsync(
        `UPDATE user_quest_state
         SET progress = MAX(progress, ?),
             completed_at = COALESCE(completed_at, ?)
         WHERE user_id = ? AND campaign_id = ? AND template_id = ? AND reset_key = ?`,
        [
          row.progress_value || 0,
          row.unlocked_at || null,
          row.user_id,
          campaignId,
          templateId,
          'permanent',
        ]
      );

      if (result.changes > 0) {
        updated += 1;
      } else {
        inserted += 1;
      }
    }

    if (!dryRun) {
      await runAsync('COMMIT;');
    }
  } catch (error) {
    if (!dryRun) {
      await runAsync('ROLLBACK;');
    }
    throw error;
  }

  console.log('[phase3 migrate] templates:', templateMap.size);
  console.log('[phase3 migrate] rows scanned:', rows.length);
  console.log('[phase3 migrate] inserted:', inserted, 'updated:', updated, 'skipped:', skipped);
  if (dryRun) {
    console.log('[phase3 migrate] dry-run mode: no writes performed.');
  }
}

main().catch((error) => {
  console.error('[phase3 migrate] failed:', error);
  process.exit(1);
});
