const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const PREVIEW_SESSION_TTL_MS = 30 * 60 * 1000;
const PREVIEW_SESSION_DIR = path.join(__dirname, '..', 'tmp', 'feed-preview-sessions');
const SESSION_ID_RE = /^[a-f0-9]{32}$/i;

function buildPreviewSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

function isValidSessionId(sessionId) {
  return SESSION_ID_RE.test(String(sessionId || '').trim());
}

function getPreviewSessionPath(sessionId) {
  if (!isValidSessionId(sessionId)) {
    throw new Error('invalid_preview_session_id');
  }
  return path.join(PREVIEW_SESSION_DIR, `${String(sessionId).trim().toLowerCase()}.json`);
}

async function ensurePreviewSessionDir() {
  await fs.mkdir(PREVIEW_SESSION_DIR, { recursive: true });
}

function buildPreviewSessionImageUrl(sessionId, { page = 1 } = {}) {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  return `/api/feed-images/preview/sessions/${encodeURIComponent(sessionId)}?page=${safePage}`;
}

function buildPreviewSessionRenderImages({
  sessionId,
  pageCount,
  pageCap,
  isTruncated,
  template,
  scale,
  version,
  expiresAt,
}) {
  const total = Math.max(1, Number.parseInt(pageCount, 10) || 1);
  const images = Array.from({ length: total }, (_item, index) =>
    buildPreviewSessionImageUrl(sessionId, { page: index + 1 })
  );
  const primaryImage = images[0] || buildPreviewSessionImageUrl(sessionId, { page: 1 });
  const hasMultiple = total > 1;

  return {
    image_url: primaryImage,
    primary_image: primaryImage,
    images,
    has_multiple: hasMultiple,
    render_images: {
      primary_image: primaryImage,
      images,
      has_multiple: hasMultiple,
      page_count: total,
      page_cap: Math.max(1, Number.parseInt(pageCap, 10) || 8),
      is_truncated: Boolean(isTruncated),
      template: template || 'paper01',
      scale: Number.parseInt(scale, 10) === 2 ? 2 : 1,
      version: version || '',
      preview_session_id: sessionId,
      expires_at: expiresAt,
    },
  };
}

function buildPreviewSessionResponse(session) {
  if (!session) return null;
  const renderImages = buildPreviewSessionRenderImages({
    sessionId: session.preview_session_id,
    pageCount: session.page_count,
    pageCap: session.page_cap,
    isTruncated: session.is_truncated,
    template: session.template,
    scale: session.scale,
    version: session.version,
    expiresAt: session.expires_at,
  });

  return {
    ok: true,
    preview_session_id: session.preview_session_id,
    expires_at: session.expires_at,
    ...renderImages,
  };
}

async function cleanupExpiredPreviewSessions() {
  await ensurePreviewSessionDir();

  let entries = [];
  try {
    entries = await fs.readdir(PREVIEW_SESSION_DIR, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }

  const now = Date.now();
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map(async (entry) => {
        const filePath = path.join(PREVIEW_SESSION_DIR, entry.name);
        try {
          const raw = await fs.readFile(filePath, 'utf8');
          const parsed = JSON.parse(raw);
          const expiresAtMs = new Date(parsed?.expires_at || '').getTime();
          if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
            await fs.unlink(filePath).catch(() => {});
          }
        } catch (_error) {
          await fs.unlink(filePath).catch(() => {});
        }
      })
  );
}

async function createPreviewSession({
  userId,
  post,
  template,
  scale,
  manifest,
}) {
  await cleanupExpiredPreviewSessions();
  await ensurePreviewSessionDir();

  const previewSessionId = buildPreviewSessionId();
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + PREVIEW_SESSION_TTL_MS).toISOString();
  const session = {
    preview_session_id: previewSessionId,
    user_id: String(userId),
    created_at: createdAt,
    expires_at: expiresAt,
    template: template || 'paper01',
    scale: Number.parseInt(scale, 10) === 2 ? 2 : 1,
    version: manifest?.version || '',
    page_count: Math.max(1, Number(manifest?.pageCount) || 1),
    page_cap: Math.max(1, Number(manifest?.pageCap) || 8),
    is_truncated: Boolean(manifest?.isTruncated),
    post: post || null,
  };

  const sessionPath = getPreviewSessionPath(previewSessionId);
  await fs.writeFile(sessionPath, JSON.stringify(session), 'utf8');
  return session;
}

async function readPreviewSession(sessionId) {
  const sessionPath = getPreviewSessionPath(sessionId);

  let raw;
  try {
    raw = await fs.readFile(sessionPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (_error) {
    await fs.unlink(sessionPath).catch(() => {});
    return null;
  }

  const expiresAtMs = new Date(parsed?.expires_at || '').getTime();
  if (!Number.isFinite(expiresAtMs)) {
    await fs.unlink(sessionPath).catch(() => {});
    return null;
  }

  if (expiresAtMs <= Date.now()) {
    await fs.unlink(sessionPath).catch(() => {});
    return { expired: true };
  }

  return parsed;
}

module.exports = {
  PREVIEW_SESSION_TTL_MS,
  buildPreviewSessionImageUrl,
  buildPreviewSessionRenderImages,
  buildPreviewSessionResponse,
  cleanupExpiredPreviewSessions,
  createPreviewSession,
  isValidSessionId,
  readPreviewSession,
};
