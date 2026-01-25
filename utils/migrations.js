const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const SCHEMA_MIGRATIONS_FILE = '0001_create_schema_migrations.sql';
const BASELINE_FILENAME = 'baseline_legacy';
const BASELINE_CHECKSUM = 'legacy';

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });

const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });

const exec = (sql) =>
  new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });

const checksumFor = (content) =>
  crypto.createHash('sha256').update(content).digest('hex');

const listMigrationFiles = async () => {
  try {
    const entries = await fs.promises.readdir(MIGRATIONS_DIR);
    return entries
      .filter((entry) => entry.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};

const ensureSchemaMigrations = async (files) => {
  if (!files.includes(SCHEMA_MIGRATIONS_FILE)) {
    throw new Error(
      `[migrations] missing ${SCHEMA_MIGRATIONS_FILE}; cannot initialize schema_migrations.`
    );
  }

  const schemaPath = path.join(MIGRATIONS_DIR, SCHEMA_MIGRATIONS_FILE);
  const schemaSql = await fs.promises.readFile(schemaPath, 'utf8');
  await exec(schemaSql);
};

const isLegacySchema = async () => {
  const row = await get(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('schema_migrations', 'sqlite_sequence') LIMIT 1;"
  );
  return Boolean(row?.name);
};

const ensureBaselineLegacy = async () => {
  const existingBaseline = await get(
    'SELECT 1 as present FROM schema_migrations WHERE filename = ? LIMIT 1;',
    [BASELINE_FILENAME]
  );
  if (existingBaseline?.present) {
    return true;
  }

  const countRow = await get('SELECT COUNT(*) as count FROM schema_migrations;');
  if (countRow?.count > 0) {
    return false;
  }

  const legacy = await isLegacySchema();
  if (!legacy) {
    return false;
  }

  await run(
    'INSERT OR IGNORE INTO schema_migrations (filename, checksum) VALUES (?, ?)',
    [BASELINE_FILENAME, BASELINE_CHECKSUM]
  );
  console.log('[migrations] legacy schema detected; baseline applied.');
  return true;
};

const runMigrations = async () => {
  const files = await listMigrationFiles();
  await ensureSchemaMigrations(files);
  const baselineLegacy = await ensureBaselineLegacy();
  if (files.length === 0) {
    console.log('[migrations] no migrations found.');
    return;
  }

  let appliedCount = 0;

  for (const filename of files) {
    if (baselineLegacy && filename === '0002_initial_schema.sql') {
      console.log(`[migrations] skip ${filename} (legacy baseline)`);
      continue;
    }

    const fullPath = path.join(MIGRATIONS_DIR, filename);
    const contents = await fs.promises.readFile(fullPath, 'utf8');
    const checksum = checksumFor(contents);

    const existing = await get(
      'SELECT filename, checksum FROM schema_migrations WHERE filename = ?',
      [filename]
    );

    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(
          `[migrations] checksum mismatch for ${filename}: expected ${existing.checksum}, got ${checksum}`
        );
      }
      console.log(`[migrations] skip ${filename}`);
      continue;
    }

    console.log(`[migrations] apply ${filename}`);
    try {
      await run('BEGIN IMMEDIATE;');
      await exec(contents);
      await run(
        'INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)',
        [filename, checksum]
      );
      await run('COMMIT;');
      appliedCount += 1;
    } catch (error) {
      try {
        await run('ROLLBACK;');
      } catch (rollbackError) {
        console.error('[migrations] rollback failed:', rollbackError);
      }
      throw error;
    }
  }

  if (appliedCount === 0) {
    console.log('[migrations] 0 migrations to apply.');
  } else {
    console.log(`[migrations] ${appliedCount} migrations applied.`);
  }

  const integrity = await get('PRAGMA integrity_check;');
  if (integrity?.integrity_check) {
    console.log(`[migrations] integrity_check: ${integrity.integrity_check}`);
  }
};

module.exports = { runMigrations };
