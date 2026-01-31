const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data', 'test');
const dbPath = path.join(dataDir, 'users.db');
const outboxPath = path.join(dataDir, 'outbox.jsonl');
const port = 3100;
const baseUrl = `http://localhost:${port}`;
const email = 'dummy@example.com';

function logPass(message) {
  console.log(`PASS: ${message}`);
}

function logFail(message) {
  console.error(`FAIL: ${message}`);
}

function ensureCleanFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function waitForServer(url, timeoutMs = 15000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const res = await fetch(url, { method: 'GET' });
        if (res.ok) return resolve();
      } catch (error) {
        // ignore until timeout
      }
      if (Date.now() - startedAt > timeoutMs) {
        return reject(new Error('Server did not become ready in time'));
      }
      setTimeout(attempt, 500);
    };
    attempt();
  });
}

function openDb() {
  return new sqlite3.Database(dbPath);
}

function runDb(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function getDb(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function readLastOutboxEntry(filePath) {
  const content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) return null;
  const lines = content.split('\n').filter(Boolean);
  if (lines.length === 0) return null;
  return JSON.parse(lines[lines.length - 1]);
}

async function main() {
  ensureCleanFile(outboxPath);
  ensureCleanFile(dbPath);

  const serverEnv = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(port),
    BASE_URL: baseUrl,
    DB_PATH: dbPath,
    JWT_SECRET: process.env.JWT_SECRET || 'dev_only_test_secret',
    GMAIL_USER: process.env.GMAIL_USER || 'test@example.com',
    GMAIL_PASS: process.env.GMAIL_PASS || 'test',
    MAIL_TRANSPORT: 'outbox',
    MAIL_OUTBOX_PATH: outboxPath,
    CORS_ALLOWED_HOSTS: 'localhost,127.0.0.1',
  };

  const server = spawn('node', ['server.js'], {
    cwd: rootDir,
    env: serverEnv,
    stdio: 'inherit',
  });

  try {
    await waitForServer(baseUrl);
    logPass('server started');

    const db = openDb();
    const hashed = await bcrypt.hash('TempPass123!', 10);
    await runDb(
      db,
      `INSERT INTO users (name, nickname, email, pw, is_admin, is_verified)
       VALUES (?, ?, ?, ?, 0, 1)`,
      ['테스트유저', 'dummy', email, hashed]
    );
    logPass('dummy user inserted');

    const requestRes = await fetch(`${baseUrl}/api/password-reset-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (!requestRes.ok) {
      throw new Error('password-reset-request failed');
    }
    logPass('password-reset-request responded');

    if (!fs.existsSync(outboxPath)) {
      throw new Error('outbox file not created');
    }

    const entry = readLastOutboxEntry(outboxPath);
    if (!entry?.token) {
      throw new Error('token missing from outbox');
    }
    logPass('token extracted from outbox');

    const resetRes = await fetch(`${baseUrl}/api/password-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: entry.token, newPw: 'NewPass123!' }),
    });
    const resetBody = await resetRes.json();
    if (!resetBody.ok) {
      throw new Error('password-reset failed');
    }
    logPass('password-reset succeeded');

    const updated = await getDb(
      db,
      'SELECT pw, reset_token, reset_expires FROM users WHERE email = ?',
      [email]
    );

    if (updated.reset_token || updated.reset_expires) {
      throw new Error('reset token not cleared');
    }
    const pwMatches = await bcrypt.compare('NewPass123!', updated.pw);
    if (!pwMatches) {
      throw new Error('password hash not updated');
    }
    logPass('reset token cleared and password updated');

    db.close();
  } finally {
    server.kill('SIGINT');
    if (fs.existsSync(outboxPath)) {
      fs.unlinkSync(outboxPath);
    }
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  }
}

main()
  .then(() => {
    console.log('PASS: password reset outbox e2e completed');
    process.exit(0);
  })
  .catch((error) => {
    logFail(error.message || 'unexpected error');
    process.exit(1);
  });
