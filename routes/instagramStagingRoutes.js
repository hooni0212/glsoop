const fs = require('fs');
const path = require('path');

const express = require('express');

const router = express.Router();

const DEFAULT_MAX_AGE_SECONDS = 48 * 60 * 60;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,128}$/;
const IMAGE_FILENAME_PATTERN = /^(?:0[1-9]|10)\.png$/;
const STAGING_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
  'Surrogate-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

const stagingRoot = path.resolve(
  process.cwd(),
  process.env.IG_UPLOAD_STAGING_DIR || '/var/lib/glsoop/ig-upload-staging'
);
const maxAgeSeconds = Number.parseInt(
  process.env.IG_UPLOAD_STAGING_MAX_AGE_SECONDS || String(DEFAULT_MAX_AGE_SECONDS),
  10
);

function isWithinRoot(targetPath) {
  const relative = path.relative(stagingRoot, targetPath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isExpired(stat) {
  if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0) return false;
  return Date.now() - stat.mtimeMs > maxAgeSeconds * 1000;
}

function buildImagePath(token, filename) {
  return path.resolve(stagingRoot, token, 'images', filename);
}

function setStagingHeaders(res, extraHeaders = {}) {
  res.set({
    ...STAGING_CACHE_HEADERS,
    ...extraHeaders,
  });
}

function sendStagingStatus(res, status) {
  setStagingHeaders(res);
  return res.sendStatus(status);
}

router.get('/ig-upload-staging/:token/images/:filename', async (req, res) => {
  const token = String(req.params.token || '');
  const filename = String(req.params.filename || '');

  if (!TOKEN_PATTERN.test(token) || !IMAGE_FILENAME_PATTERN.test(filename)) {
    return sendStagingStatus(res, 404);
  }

  const imagePath = buildImagePath(token, filename);
  if (!isWithinRoot(imagePath)) {
    return sendStagingStatus(res, 404);
  }

  let stat;
  try {
    stat = await fs.promises.stat(imagePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[ig-upload-staging] stat failed:', imagePath, error.message);
    }
    return sendStagingStatus(res, 404);
  }

  if (!stat.isFile()) {
    return sendStagingStatus(res, 404);
  }

  if (isExpired(stat)) {
    return sendStagingStatus(res, 410);
  }

  setStagingHeaders(res, {
    'Content-Type': 'image/png',
  });
  return res.sendFile(imagePath);
});

module.exports = router;
