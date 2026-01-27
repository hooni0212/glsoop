import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import bcrypt from 'bcrypt';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const dbPath = path.join(repoRoot, 'tmp', 'phase3_verify.sqlite');
const reportPath = path.join(repoRoot, 'reports', 'phase3-verify.md');

const results = [];
const evidence = [];

function formatStatus(pass) {
  return pass ? 'O' : 'X';
}

function recordResult(id, title, pass, detail, hint) {
  results.push({ id, title, pass, detail, hint });
}

function getDb() {
  return require('../db');
}

function dbRun(sql, params = []) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

async function resetDbFile() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath);
  }
}

async function runMigrations() {
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'development';
  const { runMigrations } = require('../utils/migrations');
  await runMigrations();
}

async function seedUsers() {
  const password = 'Passw0rd!';
  const hash = await bcrypt.hash(password, 10);
  await dbRun(
    `INSERT INTO users (name, nickname, email, pw, is_admin, is_verified, level, xp)
     VALUES (?, ?, ?, ?, 1, 1, 1, 0)`,
    ['Admin', 'admin', 'admin@example.com', hash]
  );
  await dbRun(
    `INSERT INTO users (name, nickname, email, pw, is_admin, is_verified, level, xp)
     VALUES (?, ?, ?, ?, 0, 1, 1, 0)`,
    ['UserA', 'usera', 'usera@example.com', hash]
  );
  await dbRun(
    `INSERT INTO users (name, nickname, email, pw, is_admin, is_verified, level, xp)
     VALUES (?, ?, ?, ?, 0, 1, 1, 0)`,
    ['UserB', 'userb', 'userb@example.com', hash]
  );
}

async function runBackfill() {
  const env = { ...process.env, DB_PATH: dbPath };
  const output = execSync('node scripts/backfill-permanent-quests.mjs', {
    cwd: repoRoot,
    env,
  }).toString();
  evidence.push({ title: 'backfill output', detail: output.trim() });
}

async function main() {
  await resetDbFile();
  await runMigrations();

  // (1) runtime should not import legacy JSON
  try {
    execSync('rg -n "legacy-achievements.json" server.js utils routes public', {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    recordResult(
      1,
      '런타임 코드에서 legacy-achievements.json 참조 없음',
      false,
      'runtime 참조가 발견되었습니다.',
      'runtime 모듈에서 legacy-achievements.json 참조를 제거하세요.'
    );
  } catch (error) {
    recordResult(1, '런타임 코드에서 legacy-achievements.json 참조 없음', true, 'no matches', '-');
  }

  // (2) legacy templates seeded via migrations
  try {
    const legacyPath = path.join(repoRoot, 'docs', 'legacy-achievements.json');
    const legacyList = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
    const codes = legacyList.map((item) => item.legacy_key);
    const placeholders = codes.map(() => '?').join(',');
    const templateCount = await dbGet(
      `SELECT COUNT(*) as cnt FROM quest_templates
       WHERE template_kind = 'achievement' AND code IN (${placeholders})`,
      codes
    );
    const campaign = await dbGet(
      "SELECT id FROM quest_campaigns WHERE campaign_type = 'permanent' AND name = '업적' LIMIT 1"
    );
    const campaignCount = await dbGet(
      `SELECT COUNT(*) as cnt
       FROM quest_campaign_items qci
       JOIN quest_templates qt ON qt.id = qci.template_id
       WHERE qci.campaign_id = ? AND qt.code IN (${placeholders})`,
      [campaign?.id, ...codes]
    );
    const pass = (templateCount?.cnt || 0) === codes.length && (campaignCount?.cnt || 0) === codes.length;
    recordResult(
      2,
      'Phase3 마이그레이션: legacy 업적 템플릿 시드',
      pass,
      `templates=${templateCount?.cnt || 0}, campaign_items=${campaignCount?.cnt || 0}`,
      '0006_seed_legacy_achievements.sql 시드 로직 확인'
    );
  } catch (error) {
    recordResult(2, 'Phase3 마이그레이션: legacy 업적 템플릿 시드', false, error.message, '마이그레이션/JSON 목록 확인');
  }

  // (3) backfill idempotency
  try {
    await seedUsers();
    await runBackfill();

    const campaign = await dbGet(
      "SELECT id FROM quest_campaigns WHERE campaign_type = 'permanent' AND name = '업적' LIMIT 1"
    );
    const templateCountRow = await dbGet(
      `SELECT COUNT(*) as cnt
       FROM quest_campaign_items qci
       JOIN quest_templates qt ON qt.id = qci.template_id
       WHERE qci.campaign_id = ?`,
      [campaign?.id]
    );
    const userCountRow = await dbGet('SELECT COUNT(*) as cnt FROM users');

    const expected = (templateCountRow?.cnt || 0) * (userCountRow?.cnt || 0);

    const firstCount = await dbGet(
      `SELECT COUNT(*) as cnt FROM user_quest_state WHERE campaign_id = ? AND reset_key = 'permanent'`,
      [campaign?.id]
    );

    await runBackfill();

    const secondCount = await dbGet(
      `SELECT COUNT(*) as cnt FROM user_quest_state WHERE campaign_id = ? AND reset_key = 'permanent'`,
      [campaign?.id]
    );

    const pass = (firstCount?.cnt || 0) === expected && (secondCount?.cnt || 0) === expected;
    recordResult(
      3,
      'Backfill: 영구 캠페인 사용자 할당 + 재실행 안전',
      pass,
      `expected=${expected}, first=${firstCount?.cnt || 0}, second=${secondCount?.cnt || 0}`,
      'scripts/backfill-permanent-quests.mjs 로직 확인'
    );
  } catch (error) {
    recordResult(3, 'Backfill: 영구 캠페인 사용자 할당 + 재실행 안전', false, error.message, 'backfill 스크립트 실행 확인');
  }

  const allPass = results.every((r) => r.pass);

  const commitHash = (() => {
    try {
      return execSync('git rev-parse HEAD', { cwd: repoRoot }).toString().trim();
    } catch (error) {
      return 'unknown';
    }
  })();

  const lines = [];
  lines.push('# Phase3 Verify Report');
  lines.push('');
  lines.push(`- DB_PATH: ${dbPath}`);
  lines.push(`- Commit: ${commitHash}`);
  lines.push(`- Node: ${process.version}`);
  lines.push('');
  lines.push('| # | 항목 | 결과 | 증거 요약 | 수정 포인트 |');
  lines.push('| --- | --- | --- | --- | --- |');
  results.forEach((r) => {
    lines.push(`| ${r.id} | ${r.title} | ${formatStatus(r.pass)} | ${r.detail || ''} | ${r.pass ? '-' : r.hint || ''} |`);
  });

  if (evidence.length) {
    lines.push('');
    lines.push('## Evidence Logs');
    evidence.slice(0, 10).forEach((entry) => {
      lines.push(`- ${entry.title}: ${String(entry.detail).trim()}`);
    });
  }

  fs.writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');

  console.log('Phase3 Verify Result');
  results.forEach((r) => {
    console.log(`${r.id}) ${r.title} ${formatStatus(r.pass)}`);
  });
  console.log(`=> ${allPass ? 'ALL PASS' : 'FAIL'}`);

  process.exit(allPass ? 0 : 1);
}

main();
