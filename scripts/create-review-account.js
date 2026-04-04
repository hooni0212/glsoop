const path = require('path');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();

function parseArgs(argv) {
  const parsed = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const eqIndex = token.indexOf('=');
    if (eqIndex >= 0) {
      parsed[token.slice(2, eqIndex)] = token.slice(eqIndex + 1);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = next;
    i += 1;
  }

  return parsed;
}

function printUsage() {
  const lines = [
    'Usage:',
    '  node scripts/create-review-account.js --db data/live/users.db --email review@glsoop.com --password "StrongPass123!" [--name "App Review"] [--nickname review_ios] [--admin]',
    '',
    'Notes:',
    '  - --db or DB_PATH is required to avoid editing the wrong database.',
    '  - Existing users with the same email are updated in-place.',
    '  - The account is forced to is_verified=1 and account_status=active when those columns exist.',
  ];
  console.log(lines.join('\n'));
}

function openDb(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(db);
    });
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve(this);
    });
  });
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows || []);
    });
  });
}

function closeDb(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function getUserColumns(db) {
  const rows = await dbAll(db, 'PRAGMA table_info(users)');
  return new Set(rows.map((row) => row.name));
}

function toBooleanFlag(value) {
  if (value === true) return 1;
  if (typeof value !== 'string') return 0;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase()) ? 1 : 0;
}

async function createOrUpdateReviewAccount({
  db,
  email,
  password,
  name,
  nickname,
  isAdmin,
}) {
  const columns = await getUserColumns(db);
  if (!columns.has('email') || !columns.has('pw')) {
    throw new Error('users table is missing required auth columns.');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await dbGet(db, 'SELECT id FROM users WHERE email = ?', [normalizedEmail]);

  const insertValues = {
    name,
    nickname,
    email: normalizedEmail,
    pw: passwordHash,
    is_admin: isAdmin,
    is_verified: 1,
    verification_token: null,
    verification_expires: null,
    reset_token: null,
    reset_expires: null,
    level: 1,
    xp: 0,
    streak_days: 0,
    max_streak_days: 0,
    remember_login_enabled: 0,
    marketing_email_opt_in: 0,
    marketing_opt_in_updated_at: new Date().toISOString(),
    account_status: 'active',
    deactivated_at: null,
    scheduled_purge_at: null,
  };

  if (!existing) {
    const entries = Object.entries(insertValues).filter(([key]) => columns.has(key));
    const sql = `
      INSERT INTO users (${entries.map(([key]) => key).join(', ')})
      VALUES (${entries.map(() => '?').join(', ')})
    `;
    const result = await dbRun(
      db,
      sql,
      entries.map(([, value]) => value)
    );
    return { action: 'created', userId: result.lastID };
  }

  const updateValues = {
    name,
    nickname,
    pw: passwordHash,
    is_admin: isAdmin,
    is_verified: 1,
    verification_token: null,
    verification_expires: null,
    reset_token: null,
    reset_expires: null,
    remember_login_enabled: 0,
    account_status: 'active',
    deactivated_at: null,
    scheduled_purge_at: null,
  };

  const entries = Object.entries(updateValues).filter(([key]) => columns.has(key));
  const sql = `
    UPDATE users
    SET ${entries.map(([key]) => `${key} = ?`).join(', ')}
    WHERE id = ?
  `;
  await dbRun(
    db,
    sql,
    [...entries.map(([, value]) => value), existing.id]
  );
  return { action: 'updated', userId: existing.id };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  const dbPath = args.db || process.env.DB_PATH;
  const email = typeof args.email === 'string' ? args.email.trim() : '';
  const password = typeof args.password === 'string' ? args.password : '';
  const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : 'App Review';
  const nickname =
    typeof args.nickname === 'string' && args.nickname.trim()
      ? args.nickname.trim()
      : 'review_ios';
  const isAdmin = toBooleanFlag(args.admin);

  if (!dbPath) {
    console.error('DB_PATH or --db is required.');
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (!email || !password) {
    console.error('--email and --password are required.');
    printUsage();
    process.exitCode = 1;
    return;
  }

  const resolvedDbPath = path.resolve(process.cwd(), dbPath);
  let db;

  try {
    db = await openDb(resolvedDbPath);
    const result = await createOrUpdateReviewAccount({
      db,
      email,
      password,
      name,
      nickname,
      isAdmin,
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          action: result.action,
          user_id: result.userId,
          email: email.trim().toLowerCase(),
          db_path: resolvedDbPath,
          reviewer_note: {
            email: email.trim().toLowerCase(),
            password,
            note:
              'Use this account in App Store Connect > App Review Information. Keep the account active and do not enable MFA, CAPTCHA, VPN-only access, or IP allowlists for review.',
          },
        },
        null,
        2
      )
    );
  } finally {
    if (db) {
      await closeDb(db);
    }
  }
}

main().catch((error) => {
  console.error('[create-review-account] failed:', error.message || error);
  process.exit(1);
});
