const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data', 'test');
const dbPath = path.join(dataDir, 'signup-e2e.sqlite');
const outboxPath = path.join(dataDir, 'signup-outbox.jsonl');
const port = 3101;
const baseUrl = `http://localhost:${port}`;
const email = `signup-e2e-${Date.now()}@glsoop.test`;
const password = 'StrongPass123!';

function ensureCleanFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function waitForServer(url, timeoutMs = 15000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const res = await fetch(url, { method: 'GET' });
        if (res.ok) return resolve();
      } catch {}
      if (Date.now() - startedAt > timeoutMs) {
        return reject(new Error('Server did not become ready in time'));
      }
      setTimeout(attempt, 500);
    };
    attempt();
  });
}

function readOutboxEntries(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) return [];
  return content
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function extractOtp(entries, targetEmail) {
  const matched = [...entries]
    .reverse()
    .find((entry) => entry.type === 'signup_otp' && entry.to === targetEmail);
  return matched?.otpCode || '';
}

function extractCookieToken(setCookieHeader) {
  const matched = /token=([^;]+)/.exec(setCookieHeader || '');
  return matched ? decodeURIComponent(matched[1]) : '';
}

async function main() {
  ensureCleanFile(dbPath);
  ensureCleanFile(outboxPath);

  const serverEnv = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(port),
    BASE_URL: baseUrl,
    DB_PATH: dbPath,
    DB_AUTOINIT: 'false',
    JWT_SECRET: process.env.JWT_SECRET || 'dev_only_test_secret',
    GMAIL_USER: process.env.GMAIL_USER || 'test@example.com',
    GMAIL_PASS: process.env.GMAIL_PASS || 'test',
    MAIL_TRANSPORT: 'outbox',
    MAIL_OUTBOX_PATH: outboxPath,
    AUTH_SIGNUP_EMAIL_DRY_RUN: 'false',
    CORS_ALLOWED_HOSTS: 'localhost,127.0.0.1',
  };

  const server = spawn('node', ['server.js'], {
    cwd: rootDir,
    env: serverEnv,
    stdio: 'inherit',
  });

  try {
    await waitForServer(baseUrl);

    const runtimeRes = await fetch(`${baseUrl}/api/runtime-config`);
    if (!runtimeRes.ok) throw new Error('runtime-config failed');
    const runtimeBody = await runtimeRes.json();
    const legalVersions = runtimeBody?.legal?.versions;
    if (!legalVersions?.terms || !legalVersions?.privacy) {
      throw new Error('legal versions missing');
    }

    const signupRes = await fetch(`${baseUrl}/api/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '회원가입E2E',
        nickname: 'signup_e2e',
        email,
        pw: password,
        age_confirmed: true,
        terms_agreed: true,
        privacy_agreed: true,
        terms_version: legalVersions.terms,
        privacy_version: legalVersions.privacy,
      }),
    });
    const signupBody = await signupRes.json();
    if (!signupRes.ok || !signupBody?.ok || !signupBody?.pending_id) {
      throw new Error(`signup failed: ${JSON.stringify(signupBody)}`);
    }

    const otpCode = extractOtp(readOutboxEntries(outboxPath), email);
    if (!otpCode) throw new Error('signup otp not found in outbox');

    const verifyRes = await fetch(`${baseUrl}/api/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pending_id: signupBody.pending_id,
        verification_code: otpCode,
      }),
    });
    const verifyBody = await verifyRes.json();
    if (!verifyRes.ok || !verifyBody?.ok) {
      throw new Error(`verify-email failed: ${JSON.stringify(verifyBody)}`);
    }

    const loginRes = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, pw: password }),
    });
    const loginBody = await loginRes.json();
    if (!loginRes.ok || !loginBody?.ok || !loginBody?.token) {
      throw new Error(`login failed: ${JSON.stringify(loginBody)}`);
    }

    const cookieToken = extractCookieToken(loginRes.headers.get('set-cookie') || '');
    if (!cookieToken) throw new Error('cookie session token missing');

    const meRes = await fetch(`${baseUrl}/api/me`, {
      headers: {
        Authorization: `Bearer ${loginBody.token}`,
      },
    });
    const meBody = await meRes.json();
    if (!meRes.ok || !meBody?.ok) {
      throw new Error(`me failed: ${JSON.stringify(meBody)}`);
    }

    console.log('PASS: signup -> verify-email -> login -> /api/me completed');
  } finally {
    server.kill('SIGINT');
    if (fs.existsSync(outboxPath)) fs.unlinkSync(outboxPath);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('FAIL:', error.message || error);
    process.exit(1);
  });
