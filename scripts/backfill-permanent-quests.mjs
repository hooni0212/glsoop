import { createRequire } from 'module';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.find((arg) => arg.startsWith('--limit-user='));
const limitUser = limitArg ? Number(limitArg.split('=')[1]) : null;

if (!process.env.DB_PATH) {
  console.error('[backfill] DB_PATH must be set to avoid touching live data.');
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

async function fetchPermanentTemplates() {
  return allAsync(
    `SELECT qc.id AS campaign_id, qc.name AS campaign_name, qt.id, qt.name, qt.condition_type,
            qt.category, qt.target_value, qt.reward_xp, qt.template_kind
     FROM quest_campaigns qc
     JOIN quest_campaign_items qci ON qci.campaign_id = qc.id
     JOIN quest_templates qt ON qt.id = qci.template_id
     WHERE LOWER(qc.campaign_type) = 'permanent' AND qt.is_active = 1
     ORDER BY qc.id ASC, qci.sort_order ASC, qt.id ASC`
  );
}

async function fetchUsers() {
  const rows = await allAsync(
    `SELECT id FROM users ORDER BY id ASC ${limitUser ? 'LIMIT ?' : ''}`,
    limitUser ? [limitUser] : []
  );
  return rows.map((row) => row.id);
}

async function computeUserMetrics(userId) {
  const [postCount, postCountsByCat, likesGiven, likesReceived, bookmarksGiven, bookmarksReceived, userRow] = await Promise.all([
    getAsync('SELECT COUNT(*) AS cnt FROM posts WHERE user_id = ?', [userId]),
    allAsync('SELECT category, COUNT(*) AS cnt FROM posts WHERE user_id = ? GROUP BY category', [userId]),
    getAsync('SELECT COUNT(*) AS cnt FROM likes WHERE user_id = ?', [userId]),
    getAsync(
      `SELECT COUNT(*) AS cnt
       FROM likes l
       JOIN posts p ON p.id = l.post_id
       WHERE p.user_id = ?`,
      [userId]
    ),
    getAsync(
      `SELECT COUNT(*) AS cnt
       FROM bookmark_items bi
       JOIN bookmark_lists bl ON bl.id = bi.list_id
       WHERE bl.user_id = ?`,
      [userId]
    ),
    getAsync(
      `SELECT COUNT(*) AS cnt
       FROM bookmark_items bi
       JOIN posts p ON p.id = bi.post_id
       WHERE p.user_id = ?`,
      [userId]
    ),
    getAsync('SELECT streak_days FROM users WHERE id = ?', [userId]),
  ]);

  const catMap = {};
  (postCountsByCat || []).forEach((row) => {
    catMap[row.category || ''] = row.cnt;
  });

  return {
    postCount: postCount?.cnt || 0,
    postCountByCategory: catMap,
    likesGiven: likesGiven?.cnt || 0,
    likesReceived: likesReceived?.cnt || 0,
    bookmarksGiven: bookmarksGiven?.cnt || 0,
    bookmarksReceived: bookmarksReceived?.cnt || 0,
    streakDays: userRow?.streak_days || 0,
  };
}

function calculateProgress(template, metrics) {
  switch (template.condition_type) {
    case 'POST_COUNT_TOTAL':
      return metrics.postCount;
    case 'POST_COUNT_BY_CATEGORY':
      return metrics.postCountByCategory[template.category || ''] || 0;
    case 'LIKE_GIVEN':
      return metrics.likesGiven;
    case 'LIKE_RECEIVED':
      return metrics.likesReceived;
    case 'BOOKMARK_GIVEN':
      return metrics.bookmarksGiven;
    case 'BOOKMARK_RECEIVED':
      return metrics.bookmarksReceived;
    case 'STREAK_DAYS':
      return metrics.streakDays;
    default:
      return 0;
  }
}

async function fetchExistingStates(userId, campaignIds) {
  if (campaignIds.length === 0) return new Map();
  const placeholders = campaignIds.map(() => '?').join(',');
  const rows = await allAsync(
    `SELECT id, campaign_id, template_id, progress, completed_at
     FROM user_quest_state
     WHERE user_id = ? AND reset_key = 'permanent' AND campaign_id IN (${placeholders})`,
    [userId, ...campaignIds]
  );
  const map = new Map();
  rows.forEach((row) => {
    map.set(`${row.campaign_id}:${row.template_id}`, row);
  });
  return map;
}

async function main() {
  const templates = await fetchPermanentTemplates();
  if (templates.length === 0) {
    console.log('[backfill] no permanent campaign templates found.');
    return;
  }

  const campaignIds = [...new Set(templates.map((row) => row.campaign_id))];
  const users = await fetchUsers();

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const userId of users) {
    const metrics = await computeUserMetrics(userId);
    const existingStates = await fetchExistingStates(userId, campaignIds);

    if (!dryRun) {
      await runAsync('BEGIN IMMEDIATE;');
    }

    try {
      for (const template of templates) {
        const progressValue = calculateProgress(template, metrics);
        const key = `${template.campaign_id}:${template.id}`;
        const existing = existingStates.get(key);
        const targetValue = template.target_value || 0;
        const completed = progressValue >= targetValue;

        if (!existing) {
          if (!dryRun) {
            await runAsync(
              `INSERT INTO user_quest_state
                (user_id, campaign_id, template_id, progress, reset_key, completed_at)
               VALUES (?, ?, ?, ?, 'permanent', ?)`,
              [userId, template.campaign_id, template.id, progressValue, completed ? new Date().toISOString() : null]
            );
          }
          created += 1;
          continue;
        }

        const existingProgress = existing.progress || 0;
        const shouldUpdateProgress = progressValue > existingProgress;
        const shouldUpdateComplete = completed && !existing.completed_at;

        if (!shouldUpdateProgress && !shouldUpdateComplete) {
          skipped += 1;
          continue;
        }

        if (!dryRun) {
          await runAsync(
            `UPDATE user_quest_state
             SET progress = ?,
                 completed_at = COALESCE(completed_at, ?)
             WHERE id = ?`,
            [Math.max(existingProgress, progressValue), completed ? new Date().toISOString() : null, existing.id]
          );
        }
        updated += 1;
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
  }

  console.log('[backfill] users processed:', users.length);
  console.log('[backfill] templates scanned:', templates.length);
  console.log('[backfill] created:', created, 'updated:', updated, 'skipped:', skipped);
  if (dryRun) {
    console.log('[backfill] dry-run mode: no writes performed.');
  }
}

main().catch((error) => {
  console.error('[backfill] failed:', error);
  process.exit(1);
});
