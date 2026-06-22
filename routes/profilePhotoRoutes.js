const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');

const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { hasActiveEntitlement } = require('../utils/entitlements');

const router = express.Router();

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const OUTPUT_SIZE = 512;
const THUMB_SIZE = 128;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_SHARP_FORMATS = new Set(['jpeg', 'png', 'webp']);

const maxUploadBytes = Math.max(
  1,
  Number.parseInt(process.env.PROFILE_PHOTO_MAX_BYTES || String(DEFAULT_MAX_BYTES), 10)
);
const uploadRoot = path.resolve(
  process.cwd(),
  process.env.PROFILE_PHOTO_UPLOAD_DIR || path.join('public', 'uploads', 'profile-photos')
);
const publicUploadRoot = '/uploads/profile-photos';
const premiumEntitlementKey =
  process.env.PROFILE_PHOTO_PREMIUM_ENTITLEMENT_KEY ||
  process.env.PHOTO_SAVE_PREMIUM_ENTITLEMENT_KEY ||
  'premium:glsoop';
const premiumRequired = process.env.PROFILE_PHOTO_UPLOAD_PREMIUM_REQUIRED !== 'false';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxUploadBytes,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error('UNSUPPORTED_PROFILE_PHOTO_TYPE'));
      return;
    }
    cb(null, true);
  },
}).single('photo');

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

function sendProfilePhotoError(res, status, code, message, extras = {}) {
  return res.status(status).json({ ok: false, code, message, ...extras });
}

function normalizeStoredUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function mapProfilePhoto(row) {
  const url = normalizeStoredUrl(row?.profile_photo_url || row?.public_url);
  if (!url) return null;

  return {
    url,
    thumbnail_url: normalizeStoredUrl(
      row?.profile_photo_thumbnail_url || row?.thumbnail_url
    ),
    updated_at: row?.profile_photo_updated_at || row?.updated_at || null,
  };
}

async function hasActivePremium(userId) {
  if (!premiumRequired) return true;
  return hasActiveEntitlement(userId, premiumEntitlementKey);
}

async function fetchCurrentProfilePhoto(userId) {
  return dbGet(
    `
    SELECT
      profile_photo_url,
      profile_photo_thumbnail_url,
      profile_photo_updated_at
    FROM users
    WHERE id = ?
    LIMIT 1
    `,
    [userId]
  );
}

function randomToken() {
  return crypto.randomBytes(10).toString('hex');
}

function makePublicPath(userId, filename) {
  return `${publicUploadRoot}/${encodeURIComponent(String(userId))}/${filename}`;
}

async function ensureUserUploadDir(userId) {
  const userDir = path.join(uploadRoot, String(userId));
  await fs.promises.mkdir(userDir, { recursive: true });
  return userDir;
}

async function unlinkIfPresent(relativeUrl) {
  const url = normalizeStoredUrl(relativeUrl);
  if (!url || !url.startsWith(publicUploadRoot)) return;

  const relativePath = url.slice(publicUploadRoot.length).replace(/^\/+/, '');
  if (!relativePath || relativePath.includes('..')) return;

  const targetPath = path.join(uploadRoot, relativePath);
  try {
    await fs.promises.unlink(targetPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[profile-photo] failed to remove file:', targetPath, error.message);
    }
  }
}

async function processProfilePhoto(file) {
  if (!file?.buffer || !Buffer.isBuffer(file.buffer)) {
    const error = new Error('PROFILE_PHOTO_REQUIRED');
    error.code = 'PROFILE_PHOTO_REQUIRED';
    throw error;
  }

  const image = sharp(file.buffer, {
    failOn: 'warning',
    limitInputPixels: 24_000_000,
  }).rotate();
  const metadata = await image.metadata();

  if (!metadata?.width || !metadata?.height || !ALLOWED_SHARP_FORMATS.has(metadata.format)) {
    const error = new Error('UNSUPPORTED_PROFILE_PHOTO_TYPE');
    error.code = 'UNSUPPORTED_PROFILE_PHOTO_TYPE';
    throw error;
  }

  const basePipeline = sharp(file.buffer, {
    failOn: 'warning',
    limitInputPixels: 24_000_000,
  }).rotate();

  const imageBuffer = await basePipeline
    .clone()
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'cover', position: 'centre' })
    .webp({ quality: 84 })
    .toBuffer();
  const thumbnailBuffer = await basePipeline
    .clone()
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover', position: 'centre' })
    .webp({ quality: 80 })
    .toBuffer();

  return {
    imageBuffer,
    thumbnailBuffer,
    width: OUTPUT_SIZE,
    height: OUTPUT_SIZE,
    mimeType: 'image/webp',
  };
}

function handleUpload(req, res, next) {
  upload(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return sendProfilePhotoError(
        res,
        413,
        'PROFILE_PHOTO_TOO_LARGE',
        '프로필 사진은 5MB 이하로 업로드해주세요.',
        { max_bytes: maxUploadBytes }
      );
    }

    if (error.message === 'UNSUPPORTED_PROFILE_PHOTO_TYPE') {
      return sendProfilePhotoError(
        res,
        400,
        'PROFILE_PHOTO_UNSUPPORTED_TYPE',
        'JPG, PNG, WebP 이미지만 사용할 수 있습니다.'
      );
    }

    console.error('[profile-photo] upload failed:', error);
    return sendProfilePhotoError(
      res,
      400,
      'PROFILE_PHOTO_UPLOAD_FAILED',
      '프로필 사진 업로드 요청을 처리하지 못했습니다.'
    );
  });
}

router.get('/me/profile-photo', authRequired, async (req, res) => {
  try {
    const [profileRow, canUpload] = await Promise.all([
      fetchCurrentProfilePhoto(req.user.id),
      hasActivePremium(req.user.id),
    ]);

    return res.json({
      ok: true,
      message: '프로필 사진 정보를 불러왔습니다.',
      profile_photo: mapProfilePhoto(profileRow),
      can_upload: canUpload,
      entitlement_key: premiumEntitlementKey,
      max_bytes: maxUploadBytes,
      allowed_content_types: Array.from(ALLOWED_MIME_TYPES),
    });
  } catch (error) {
    console.error('[profile-photo] status failed:', error);
    return sendProfilePhotoError(
      res,
      500,
      'PROFILE_PHOTO_STATUS_FAILED',
      '프로필 사진 정보를 불러오지 못했습니다.'
    );
  }
});

router.post('/me/profile-photo', authRequired, handleUpload, async (req, res) => {
  const userId = req.user.id;

  try {
    const canUpload = await hasActivePremium(userId);
    if (!canUpload) {
      return sendProfilePhotoError(
        res,
        403,
        'PROFILE_PHOTO_PREMIUM_REQUIRED',
        '프로필 사진 업로드는 프리미엄에서 사용할 수 있습니다.',
        { entitlement_key: premiumEntitlementKey }
      );
    }

    if (!req.file) {
      return sendProfilePhotoError(
        res,
        400,
        'PROFILE_PHOTO_REQUIRED',
        '업로드할 프로필 사진을 선택해주세요.'
      );
    }

    const processed = await processProfilePhoto(req.file);
    const userDir = await ensureUserUploadDir(userId);
    const token = `${Date.now()}-${randomToken()}`;
    const imageFile = `${token}.webp`;
    const thumbFile = `${token}-thumb.webp`;
    const imagePath = path.join(userDir, imageFile);
    const thumbPath = path.join(userDir, thumbFile);
    const publicUrl = makePublicPath(userId, imageFile);
    const thumbnailUrl = makePublicPath(userId, thumbFile);
    const storageKey = `profile-photos/${userId}/${imageFile}`;

    await Promise.all([
      fs.promises.writeFile(imagePath, processed.imageBuffer),
      fs.promises.writeFile(thumbPath, processed.thumbnailBuffer),
    ]);

    const savepointName = `profile_photo_upload_${randomToken()}`;
    await dbRun(`SAVEPOINT ${savepointName}`);
    try {
      await dbRun(
        `
        UPDATE user_profile_photos
        SET status = 'replaced',
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
          AND status = 'active'
        `,
        [userId]
      );
      const insertResult = await dbRun(
        `
        INSERT INTO user_profile_photos (
          user_id,
          storage_key,
          public_url,
          thumbnail_url,
          width,
          height,
          mime_type,
          byte_size,
          status,
          moderation_status,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 'unreviewed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
        [
          userId,
          storageKey,
          publicUrl,
          thumbnailUrl,
          processed.width,
          processed.height,
          processed.mimeType,
          processed.imageBuffer.length,
        ]
      );
      await dbRun(
        `
        UPDATE users
        SET profile_photo_url = ?,
            profile_photo_thumbnail_url = ?,
            profile_photo_key = ?,
            profile_photo_updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [publicUrl, thumbnailUrl, storageKey, userId]
      );
      await dbRun(`RELEASE ${savepointName}`);

      return res.json({
        ok: true,
        message: '프로필 사진을 저장했습니다.',
        profile_photo: {
          id: insertResult.lastID,
          url: publicUrl,
          thumbnail_url: thumbnailUrl,
          updated_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      await dbRun(`ROLLBACK TO ${savepointName}`).catch(() => {});
      await dbRun(`RELEASE ${savepointName}`).catch(() => {});
      await Promise.all([unlinkIfPresent(publicUrl), unlinkIfPresent(thumbnailUrl)]);
      throw error;
    }
  } catch (error) {
    if (error?.code === 'PROFILE_PHOTO_REQUIRED') {
      return sendProfilePhotoError(
        res,
        400,
        'PROFILE_PHOTO_REQUIRED',
        '업로드할 프로필 사진을 선택해주세요.'
      );
    }
    if (error?.code === 'UNSUPPORTED_PROFILE_PHOTO_TYPE') {
      return sendProfilePhotoError(
        res,
        400,
        'PROFILE_PHOTO_UNSUPPORTED_TYPE',
        'JPG, PNG, WebP 이미지만 사용할 수 있습니다.'
      );
    }

    console.error('[profile-photo] save failed:', error);
    return sendProfilePhotoError(
      res,
      500,
      'PROFILE_PHOTO_SAVE_FAILED',
      '프로필 사진을 저장하지 못했습니다.'
    );
  }
});

router.delete('/me/profile-photo', authRequired, async (req, res) => {
  const userId = req.user.id;

  try {
    const current = await fetchCurrentProfilePhoto(userId);

    const savepointName = `profile_photo_delete_${randomToken()}`;
    await dbRun(`SAVEPOINT ${savepointName}`);
    try {
      await dbRun(
        `
        UPDATE user_profile_photos
        SET status = 'deleted',
            deleted_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
          AND status = 'active'
        `,
        [userId]
      );
      await dbRun(
        `
        UPDATE users
        SET profile_photo_url = NULL,
            profile_photo_thumbnail_url = NULL,
            profile_photo_key = NULL,
            profile_photo_updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [userId]
      );
      await dbRun(`RELEASE ${savepointName}`);
    } catch (error) {
      await dbRun(`ROLLBACK TO ${savepointName}`).catch(() => {});
      await dbRun(`RELEASE ${savepointName}`).catch(() => {});
      throw error;
    }

    await Promise.all([
      unlinkIfPresent(current?.profile_photo_url),
      unlinkIfPresent(current?.profile_photo_thumbnail_url),
    ]);

    return res.json({
      ok: true,
      message: '프로필 사진을 삭제했습니다.',
      profile_photo: null,
    });
  } catch (error) {
    console.error('[profile-photo] delete failed:', error);
    return sendProfilePhotoError(
      res,
      500,
      'PROFILE_PHOTO_DELETE_FAILED',
      '프로필 사진을 삭제하지 못했습니다.'
    );
  }
});

module.exports = router;
