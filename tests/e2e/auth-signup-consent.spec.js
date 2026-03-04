const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const REPO_ROOT = process.cwd();
const DB_PATH = process.env.DB_PATH
  ? path.resolve(REPO_ROOT, process.env.DB_PATH)
  : path.join(REPO_ROOT, 'tmp', 'e2e_playwright.sqlite');

const TOKEN_SECRET = 'devsecret';
const TOKEN_ALGORITHM = 'HS256';
const TOKEN_ISSUER = 'glsoop';
const TOKEN_AUDIENCE = 'glsoop-client';

const TEST_USER_ID_BASE = 970000;

const dbRun = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });

const dbGet = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });

const dbAll = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows || []);
    });
  });

const waitForFile = async (filePath, timeoutMs = 10000) => {
  const start = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const buildAuthToken = (userId) =>
  jwt.sign(
    {
      id: userId,
      name: `Consent User ${userId}`,
      nickname: `consent_${userId}`,
      email: `consent-test-${userId}@glsoop.test`,
      isAdmin: false,
      isVerified: true,
    },
    TOKEN_SECRET,
    {
      algorithm: TOKEN_ALGORITHM,
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      expiresIn: '1h',
    }
  );

const cleanupConsentTestData = async () => {
  const db = new sqlite3.Database(DB_PATH);
  const pendingRows = await dbAll(
    db,
    `SELECT id FROM pending_signups WHERE email LIKE 'consent-test-%@glsoop.test'`
  );
  const pendingIds = pendingRows.map((row) => row.id).filter(Boolean);

  for (const pendingId of pendingIds) {
    await dbRun(db, 'DELETE FROM pending_otp_verifications WHERE pending_id = ?', [pendingId]);
  }

  await dbRun(db, `DELETE FROM pending_signups WHERE email LIKE 'consent-test-%@glsoop.test'`);
  await dbRun(db, 'DELETE FROM user_consent_events WHERE user_id >= ?', [TEST_USER_ID_BASE]);
  await dbRun(db, 'DELETE FROM users WHERE id >= ?', [TEST_USER_ID_BASE]);
  await new Promise((resolve) => db.close(resolve));
};

const getLegalVersions = async (request) => {
  const res = await request.get('/api/runtime-config');
  expect(res.status()).toBe(200);
  const payload = await res.json();
  expect(payload.ok).toBe(true);
  expect(payload.legal).toBeTruthy();
  return payload.legal.versions;
};

const buildSignupPayload = (versions, overrides = {}) => ({
  name: '동의 테스트 사용자',
  nickname: 'consent_tester',
  email: `consent-test-${Date.now()}-${Math.floor(Math.random() * 1000)}@glsoop.test`,
  pw: 'Pass1234',
  age_confirmed: true,
  terms_agreed: true,
  privacy_agreed: true,
  marketing_email_opt_in: false,
  terms_version: versions.terms,
  privacy_version: versions.privacy,
  marketing_version: versions.marketing,
  ...overrides,
});

test.describe('Signup consent policy', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'Shared DB setup: run once on desktop project'
    );
  });

  test.beforeAll(async () => {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    await waitForFile(DB_PATH, 20000);
  });

  test.beforeEach(async () => {
    await cleanupConsentTestData();
  });

  test('returns AUTH_SIGNUP_AGE_REQUIRED when age consent is missing', async ({ request }) => {
    const versions = await getLegalVersions(request);
    const response = await request.post('/api/signup', {
      data: buildSignupPayload(versions, {
        age_confirmed: false,
      }),
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe('AUTH_SIGNUP_AGE_REQUIRED');
    expect(body.field_errors).toMatchObject({
      age_confirmed: expect.any(String),
    });
  });

  test('returns AUTH_SIGNUP_REQUIRED_CONSENTS when terms/privacy consent is missing', async ({
    request,
  }) => {
    const versions = await getLegalVersions(request);
    const response = await request.post('/api/signup', {
      data: buildSignupPayload(versions, {
        terms_agreed: false,
        privacy_agreed: false,
      }),
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe('AUTH_SIGNUP_REQUIRED_CONSENTS');
    expect(body.field_errors).toMatchObject({
      terms_agreed: expect.any(String),
      privacy_agreed: expect.any(String),
    });
  });

  test('returns AUTH_SIGNUP_LEGAL_VERSION_MISMATCH when legal versions are stale', async ({ request }) => {
    const versions = await getLegalVersions(request);
    const response = await request.post('/api/signup', {
      data: buildSignupPayload(versions, {
        terms_version: 'stale-terms-version',
      }),
    });

    expect(response.status()).toBe(409);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe('AUTH_SIGNUP_LEGAL_VERSION_MISMATCH');
    expect(body.field_errors).toMatchObject({
      terms_version: expect.any(String),
    });
  });

  test('stores consent metadata into pending_signups on successful signup', async ({ request }) => {
    const versions = await getLegalVersions(request);
    const payload = buildSignupPayload(versions, {
      marketing_email_opt_in: true,
    });

    const response = await request.post('/api/signup', { data: payload });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(typeof body.pending_id).toBe('number');

    const db = new sqlite3.Database(DB_PATH);
    const pendingRow = await dbGet(
      db,
      `SELECT
         age_confirmed,
         terms_version,
         privacy_version,
         marketing_version,
         marketing_email_opt_in,
         consent_ip_hash,
         consent_user_agent,
         consent_recorded_at
       FROM pending_signups
       WHERE id = ?`,
      [body.pending_id]
    );
    await new Promise((resolve) => db.close(resolve));

    expect(pendingRow).toBeTruthy();
    expect(Number(pendingRow.age_confirmed)).toBe(1);
    expect(Number(pendingRow.marketing_email_opt_in)).toBe(1);
    expect(pendingRow.terms_version).toBe(versions.terms);
    expect(pendingRow.privacy_version).toBe(versions.privacy);
    expect(pendingRow.marketing_version).toBe(versions.marketing);
    expect(typeof pendingRow.consent_ip_hash).toBe('string');
    expect(pendingRow.consent_ip_hash.length).toBeGreaterThan(10);
    expect(typeof pendingRow.consent_user_agent).toBe('string');
    expect(pendingRow.consent_user_agent.length).toBeGreaterThan(0);
    expect(typeof pendingRow.consent_recorded_at).toBe('string');
  });

  test('creates consent events on verify-email and applies marketing opt-in to user', async ({
    request,
  }) => {
    const versions = await getLegalVersions(request);
    const db = new sqlite3.Database(DB_PATH);

    const pendingEmail = `consent-test-verify-${Date.now()}@glsoop.test`;
    const otpCode = '314159';
    const otpHash = await bcrypt.hash(otpCode, 10);

    const pendingInsert = await dbRun(
      db,
      `INSERT INTO pending_signups (
         name,
         nickname,
         email,
         pw_hash,
         expires_at,
         age_confirmed,
         terms_version,
         privacy_version,
         marketing_version,
         marketing_email_opt_in,
         consent_ip_hash,
         consent_user_agent,
         consent_recorded_at
       )
       VALUES (?, ?, ?, ?, datetime('now', '+1 day'), ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        'Verify Consent User',
        'verify_consent_user',
        pendingEmail,
        'hashed_pw',
        1,
        versions.terms,
        versions.privacy,
        versions.marketing,
        1,
        'seeded_ip_hash',
        'seeded-user-agent',
      ]
    );

    const pendingId = pendingInsert.lastID;

    await dbRun(
      db,
      `INSERT INTO pending_otp_verifications (pending_id, code_hash, expires_at, attempts)
       VALUES (?, ?, datetime('now', '+10 minutes'), 0)`,
      [pendingId, otpHash]
    );

    await new Promise((resolve) => db.close(resolve));

    const response = await request.post('/api/verify-email', {
      data: {
        pending_id: pendingId,
        verification_code: otpCode,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);

    const checkDb = new sqlite3.Database(DB_PATH);
    const userRow = await dbGet(
      checkDb,
      `SELECT marketing_email_opt_in FROM users WHERE id = ?`,
      [body.user_id]
    );
    const events = await dbAll(
      checkDb,
      `SELECT consent_type, consent_version, is_granted, source
       FROM user_consent_events
       WHERE user_id = ?
       ORDER BY consent_type ASC`,
      [body.user_id]
    );
    await new Promise((resolve) => checkDb.close(resolve));

    expect(Number(userRow.marketing_email_opt_in)).toBe(1);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          consent_type: 'marketing',
          consent_version: versions.marketing,
          is_granted: 1,
          source: 'signup',
        }),
        expect.objectContaining({
          consent_type: 'privacy',
          consent_version: versions.privacy,
          is_granted: 1,
          source: 'signup',
        }),
        expect.objectContaining({
          consent_type: 'terms',
          consent_version: versions.terms,
          is_granted: 1,
          source: 'signup',
        }),
      ])
    );
  });

  test('records marketing consent event when /api/me updates marketing opt-in', async ({ request }) => {
    const versions = await getLegalVersions(request);
    const userId = TEST_USER_ID_BASE + 7;
    const passwordHash = await bcrypt.hash('Pass1234', 10);
    const db = new sqlite3.Database(DB_PATH);

    await dbRun(
      db,
      `INSERT INTO users (id, name, nickname, email, pw, is_admin, is_verified, marketing_email_opt_in)
       VALUES (?, ?, ?, ?, ?, 0, 1, 0)`,
      [
        userId,
        'Consent Update User',
        'consent_update_user',
        `consent-test-update-${Date.now()}@glsoop.test`,
        passwordHash,
      ]
    );
    await new Promise((resolve) => db.close(resolve));

    const token = buildAuthToken(userId);
    const response = await request.put('/api/me', {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-auth-legacy-now': '2026-02-27T00:00:00+09:00',
      },
      data: {
        marketing_email_opt_in: true,
        marketing_version: versions.marketing,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);

    const checkDb = new sqlite3.Database(DB_PATH);
    const updatedUser = await dbGet(
      checkDb,
      `SELECT marketing_email_opt_in, marketing_opt_in_updated_at
       FROM users
       WHERE id = ?`,
      [userId]
    );
    const eventRow = await dbGet(
      checkDb,
      `SELECT consent_type, consent_version, is_granted, source
       FROM user_consent_events
       WHERE user_id = ? AND consent_type = 'marketing'
       ORDER BY id DESC
       LIMIT 1`,
      [userId]
    );
    await new Promise((resolve) => checkDb.close(resolve));

    expect(Number(updatedUser.marketing_email_opt_in)).toBe(1);
    expect(typeof updatedUser.marketing_opt_in_updated_at).toBe('string');
    expect(eventRow).toMatchObject({
      consent_type: 'marketing',
      consent_version: versions.marketing,
      is_granted: 1,
      source: 'mypage',
    });
  });
});
