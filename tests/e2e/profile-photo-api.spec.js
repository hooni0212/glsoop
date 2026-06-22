const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');

const E2E_JWT_SECRET = 'devsecret';
const E2E_JWT_ALGORITHM = 'HS256';
const E2E_JWT_ISSUER = 'glsoop';
const E2E_JWT_AUDIENCE = 'glsoop-client';

const FREE_USER_ID = 9921;
const PREMIUM_USER_ID = 9922;
const EXPIRED_USER_ID = 9923;

const REPO_ROOT = process.cwd();
const DB_PATH = process.env.DB_PATH
  ? path.resolve(REPO_ROOT, process.env.DB_PATH)
  : path.join(REPO_ROOT, 'tmp', 'e2e_playwright.sqlite');

const pngFixture = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);

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

const waitForFile = async (filePath, timeoutMs = 10000) => {
  const start = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const signAuthToken = ({ id, name, nickname, email }) =>
  jwt.sign(
    {
      id,
      name,
      nickname,
      email,
      isVerified: true,
    },
    E2E_JWT_SECRET,
    {
      algorithm: E2E_JWT_ALGORITHM,
      issuer: E2E_JWT_ISSUER,
      audience: E2E_JWT_AUDIENCE,
      expiresIn: '1h',
    }
  );

const authHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  'x-auth-legacy-now': '0',
});

const seedProfilePhotoFixtures = async () => {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);

  const db = new sqlite3.Database(DB_PATH);
  await dbRun(db, 'PRAGMA foreign_keys = OFF');

  for (const [id, name, nickname, email] of [
    [FREE_USER_ID, 'Free Profile', 'free_profile', 'free-profile@glsoop.test'],
    [
      PREMIUM_USER_ID,
      'Premium Profile',
      'premium_profile',
      'premium-profile@glsoop.test',
    ],
    [
      EXPIRED_USER_ID,
      'Expired Profile',
      'expired_profile',
      'expired-profile@glsoop.test',
    ],
  ]) {
    await dbRun(
      db,
      `
      INSERT OR REPLACE INTO users (
        id,
        name,
        nickname,
        email,
        pw,
        is_admin,
        is_verified,
        profile_photo_url,
        profile_photo_thumbnail_url,
        profile_photo_key,
        profile_photo_updated_at
      )
      VALUES (?, ?, ?, ?, ?, 0, 1, NULL, NULL, NULL, NULL)
      `,
      [id, name, nickname, email, 'password']
    );
  }

  await dbRun(db, 'DELETE FROM user_profile_photos WHERE user_id IN (?, ?, ?)', [
    FREE_USER_ID,
    PREMIUM_USER_ID,
    EXPIRED_USER_ID,
  ]);
  await dbRun(db, 'DELETE FROM user_entitlements WHERE user_id IN (?, ?, ?)', [
    FREE_USER_ID,
    PREMIUM_USER_ID,
    EXPIRED_USER_ID,
  ]);
  await dbRun(db, 'DELETE FROM user_entitlement_grants WHERE user_id IN (?, ?, ?)', [
    FREE_USER_ID,
    PREMIUM_USER_ID,
    EXPIRED_USER_ID,
  ]);
  await dbRun(
    db,
    `
    INSERT OR REPLACE INTO user_entitlement_grants (
      user_id,
      entitlement_key,
      source,
      status,
      starts_at,
      ends_at,
      meta_json
    )
    VALUES (?, 'premium:glsoop', 'admin', 'active', CURRENT_TIMESTAMP, NULL, '{}')
    `,
    [PREMIUM_USER_ID]
  );
  await dbRun(
    db,
    `
    INSERT OR REPLACE INTO user_entitlement_grants (
      user_id,
      entitlement_key,
      source,
      status,
      starts_at,
      ends_at,
      meta_json
    )
    VALUES (?, 'premium:glsoop', 'promo', 'active', datetime('now', '-2 days'), datetime('now', '-1 day'), '{}')
    `,
    [EXPIRED_USER_ID]
  );
  await dbRun(
    db,
    `UPDATE users
     SET profile_photo_url = '/uploads/profile-photos/9923/existing.webp',
         profile_photo_thumbnail_url = '/uploads/profile-photos/9923/existing-thumb.webp',
         profile_photo_key = 'profile-photos/9923/existing.webp',
         profile_photo_updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [EXPIRED_USER_ID]
  );

  await dbRun(db, 'PRAGMA foreign_keys = ON');
  await new Promise((resolve) => db.close(resolve));
};

test.describe('Profile Photo API', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'Shared DB setup: run once on desktop project'
    );
  });

  test.beforeAll(async () => {
    await seedProfilePhotoFixtures();
  });

  test('requires auth for profile photo status', async ({ request }) => {
    const response = await request.get('/api/me/profile-photo');
    expect(response.status()).toBe(401);
  });

  test('rejects upload without premium entitlement', async ({ request }) => {
    const token = signAuthToken({
      id: FREE_USER_ID,
      name: 'Free Profile',
      nickname: 'free_profile',
      email: 'free-profile@glsoop.test',
    });

    const response = await request.post('/api/me/profile-photo', {
      headers: authHeaders(token),
      multipart: {
        photo: {
          name: 'profile.png',
          mimeType: 'image/png',
          buffer: pngFixture,
        },
      },
    });

    expect(response.status()).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'PROFILE_PHOTO_PREMIUM_REQUIRED',
      entitlement_key: 'premium:glsoop',
    });
  });

  test('uploads, exposes, and deletes premium profile photo', async ({ request }) => {
    const token = signAuthToken({
      id: PREMIUM_USER_ID,
      name: 'Premium Profile',
      nickname: 'premium_profile',
      email: 'premium-profile@glsoop.test',
    });

    const statusBefore = await request.get('/api/me/profile-photo', {
      headers: authHeaders(token),
    });
    expect(statusBefore.status()).toBe(200);
    await expect(statusBefore.json()).resolves.toMatchObject({
      ok: true,
      can_upload: true,
      profile_photo: null,
    });

    const meBefore = await request.get('/api/me', {
      headers: authHeaders(token),
    });
    expect(meBefore.status()).toBe(200);
    await expect(meBefore.json()).resolves.toMatchObject({
      profile_photo_upload_allowed: true,
    });

    const uploadResponse = await request.post('/api/me/profile-photo', {
      headers: authHeaders(token),
      multipart: {
        photo: {
          name: 'profile.png',
          mimeType: 'image/png',
          buffer: pngFixture,
        },
      },
    });
    expect(uploadResponse.status()).toBe(200);
    const uploadPayload = await uploadResponse.json();
    expect(uploadPayload).toMatchObject({
      ok: true,
      profile_photo: {
        url: expect.stringContaining('/uploads/profile-photos/'),
        thumbnail_url: expect.stringContaining('/uploads/profile-photos/'),
      },
    });

    const profileResponse = await request.get(`/api/users/${PREMIUM_USER_ID}/profile`, {
      headers: authHeaders(token),
    });
    expect(profileResponse.status()).toBe(200);
    await expect(profileResponse.json()).resolves.toMatchObject({
      ok: true,
      user: {
        profile_photo_url: uploadPayload.profile_photo.url,
        profile_photo_thumbnail_url: uploadPayload.profile_photo.thumbnail_url,
      },
    });

    const deleteResponse = await request.delete('/api/me/profile-photo', {
      headers: authHeaders(token),
    });
    expect(deleteResponse.status()).toBe(200);
    await expect(deleteResponse.json()).resolves.toMatchObject({
      ok: true,
      profile_photo: null,
    });

    const statusAfter = await request.get('/api/me/profile-photo', {
      headers: authHeaders(token),
    });
    expect(statusAfter.status()).toBe(200);
    await expect(statusAfter.json()).resolves.toMatchObject({
      ok: true,
      can_upload: true,
      profile_photo: null,
    });
  });

  test('keeps the existing photo after premium expiry but blocks replacement', async ({
    request,
  }) => {
    const token = signAuthToken({
      id: EXPIRED_USER_ID,
      name: 'Expired Profile',
      nickname: 'expired_profile',
      email: 'expired-profile@glsoop.test',
    });

    const statusResponse = await request.get('/api/me/profile-photo', {
      headers: authHeaders(token),
    });
    expect(statusResponse.status()).toBe(200);
    await expect(statusResponse.json()).resolves.toMatchObject({
      ok: true,
      can_upload: false,
      profile_photo: {
        url: '/uploads/profile-photos/9923/existing.webp',
        thumbnail_url: '/uploads/profile-photos/9923/existing-thumb.webp',
      },
    });

    const meResponse = await request.get('/api/me', {
      headers: authHeaders(token),
    });
    expect(meResponse.status()).toBe(200);
    await expect(meResponse.json()).resolves.toMatchObject({
      profile_photo_upload_allowed: false,
      profile_photo_url: '/uploads/profile-photos/9923/existing.webp',
    });

    const replaceResponse = await request.post('/api/me/profile-photo', {
      headers: authHeaders(token),
      multipart: {
        photo: {
          name: 'replacement.png',
          mimeType: 'image/png',
          buffer: pngFixture,
        },
      },
    });
    expect(replaceResponse.status()).toBe(403);
    await expect(replaceResponse.json()).resolves.toMatchObject({
      code: 'PROFILE_PHOTO_PREMIUM_REQUIRED',
    });

    const profileResponse = await request.get(`/api/users/${EXPIRED_USER_ID}/profile`, {
      headers: authHeaders(token),
    });
    expect(profileResponse.status()).toBe(200);
    await expect(profileResponse.json()).resolves.toMatchObject({
      user: {
        profile_photo_url: '/uploads/profile-photos/9923/existing.webp',
      },
    });

    const deleteResponse = await request.delete('/api/me/profile-photo', {
      headers: authHeaders(token),
    });
    expect(deleteResponse.status()).toBe(200);
  });
});
