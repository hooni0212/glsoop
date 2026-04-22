const express = require('express');

const db = require('../db');
const { authOptional, authRequired } = require('../middleware/auth');
const {
  getFeedCardImageManifest,
  normalizeImageFormat,
  normalizeScale,
  normalizeTemplateKey,
  normalizePostText,
  parsePostLayout,
  renderFeedCardImage,
} = require('../utils/feedImageRenderer');
const {
  buildPreviewSessionResponse,
  cleanupExpiredPreviewSessions,
  createPreviewSession,
  readPreviewSession,
} = require('../utils/feedPreviewSessions');

const router = express.Router();
const PREVIEW_LAYOUT_ALIGN = new Set(['left', 'center', 'right']);
const PREVIEW_CONTENT_FORMATS = new Set(['plain', 'html']);
const PREVIEW_CATEGORIES = new Set(['poem', 'essay', 'short']);
const LAYOUT_UNIT_NORMALIZED = 'normalized';
const PREVIEW_FONT_SCALE_RANGE = { min: 0.7, max: 2.0 };
const PREVIEW_LINE_HEIGHT_RANGE = { min: 1.0, max: 2.2 };
const PREVIEW_LETTER_SPACING_RANGE = { min: -0.04, max: 0.08 };

function dbGetAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function parsePostId(raw) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function parsePageNumber(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return 1;
  const parsed = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function pickPreviewText(raw, maxLen) {
  const value = String(raw || '').trim();
  if (!value) return '';
  return value.slice(0, maxLen);
}

function toFiniteQueryNumber(raw) {
  if (raw === undefined || raw === null) return null;
  const value = String(raw).trim();
  if (!value) return null;
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? num : null;
}

function roundLayoutNumber(value, precision = 4) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function parsePreviewCategory(raw) {
  const normalized = String(raw || '').trim().toLowerCase();
  if (!normalized || !PREVIEW_CATEGORIES.has(normalized)) {
    return 'short';
  }
  return normalized;
}

function parsePreviewContentFormat(raw) {
  const normalized = String(raw || '').trim().toLowerCase();
  if (!normalized) return 'plain';
  if (!PREVIEW_CONTENT_FORMATS.has(normalized)) return null;
  return normalized;
}

function parsePreviewCreatedAt(raw) {
  const value = String(raw || '').trim();
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function normalizePreviewDraftPost(body = {}) {
  const title = pickPreviewText(body.title, 120) || '미리보기 제목';
  const contentFormat = parsePreviewContentFormat(body.content_format);
  if (!contentFormat) {
    return {
      error: 'content_format은 plain 또는 html이어야 합니다.',
    };
  }

  const rawContent = typeof body.content === 'string' ? body.content : '';
  const content = contentFormat === 'html' ? normalizePostText(rawContent) : rawContent.trim();
  if (!content) {
    return {
      error: '미리보기 본문이 비어 있습니다.',
    };
  }

  let layoutJson = null;
  if (Object.prototype.hasOwnProperty.call(body, 'layout_json')) {
    const parsedLayout = parsePostLayout(body.layout_json);
    if (body.layout_json != null && !parsedLayout) {
      return {
        error: '미리보기 레이아웃 값이 올바르지 않습니다.',
      };
    }
    layoutJson = parsedLayout || null;
  }

  return {
    value: {
      id: 'preview',
      title,
      content,
      created_at: parsePreviewCreatedAt(body.created_at),
      category: parsePreviewCategory(body.category),
      layout_json: layoutJson,
    },
  };
}

function parsePreviewLayoutBox({
  query = {},
  baseKey = '',
  required = false,
  allowLetterSpacing = false,
}) {
  const keyPrefix = baseKey ? `layout_${baseKey}_` : 'layout_';
  const xKey = `${keyPrefix}x`;
  const yKey = `${keyPrefix}y`;
  const wKey = `${keyPrefix}w`;
  const hKey = `${keyPrefix}h`;
  const alignKey = `${keyPrefix}align`;
  const fontScaleKey = `${keyPrefix}font_scale`;
  const lineHeightKey = `${keyPrefix}line_height`;
  const letterSpacingKey = `${keyPrefix}letter_spacing`;

  const xRaw = query[xKey];
  const yRaw = query[yKey];
  const wRaw = query[wKey];
  const hRaw = query[hKey];

  const hasAny =
    [
      xRaw,
      yRaw,
      wRaw,
      hRaw,
      query[alignKey],
      query[fontScaleKey],
      query[lineHeightKey],
      query[letterSpacingKey],
    ]
      .some((value) => value !== undefined && value !== null && String(value).trim() !== '');

  if (!hasAny) {
    return required ? { error: true } : { provided: false, value: null };
  }

  if ([xRaw, yRaw, wRaw, hRaw].some((value) => value === undefined || value === null || String(value).trim() === '')) {
    return { error: true };
  }

  const x = toFiniteQueryNumber(xRaw);
  const y = toFiniteQueryNumber(yRaw);
  const w = toFiniteQueryNumber(wRaw);
  const h = toFiniteQueryNumber(hRaw);

  if (x == null || y == null || w == null || h == null) {
    return { error: true };
  }

  if (x < 0 || x > 1 || y < 0 || y > 1 || w <= 0 || w > 1 || h <= 0 || h > 1) {
    return { error: true };
  }

  const box = {
    x: roundLayoutNumber(x),
    y: roundLayoutNumber(y),
    w: roundLayoutNumber(w),
    h: roundLayoutNumber(h),
  };

  if (
    query[alignKey] !== undefined &&
    query[alignKey] !== null
  ) {
    const align = String(query[alignKey]).trim().toLowerCase();
    if (align) {
      if (!PREVIEW_LAYOUT_ALIGN.has(align)) {
        return { error: true };
      }
      box.align = align;
    }
  }

  if (
    query[fontScaleKey] !== undefined &&
    query[fontScaleKey] !== null &&
    String(query[fontScaleKey]).trim() !== ''
  ) {
    const fontScale = toFiniteQueryNumber(query[fontScaleKey]);
    if (
      fontScale == null ||
      fontScale < PREVIEW_FONT_SCALE_RANGE.min ||
      fontScale > PREVIEW_FONT_SCALE_RANGE.max
    ) {
      return { error: true };
    }
    box.font_scale = roundLayoutNumber(fontScale, 3);
  }

  if (
    query[lineHeightKey] !== undefined &&
    query[lineHeightKey] !== null &&
    String(query[lineHeightKey]).trim() !== ''
  ) {
    const lineHeight = toFiniteQueryNumber(query[lineHeightKey]);
    if (
      lineHeight == null ||
      lineHeight < PREVIEW_LINE_HEIGHT_RANGE.min ||
      lineHeight > PREVIEW_LINE_HEIGHT_RANGE.max
    ) {
      return { error: true };
    }
    box.line_height = roundLayoutNumber(lineHeight, 3);
  }

  if (
    allowLetterSpacing &&
    query[letterSpacingKey] !== undefined &&
    query[letterSpacingKey] !== null &&
    String(query[letterSpacingKey]).trim() !== ''
  ) {
    const letterSpacing = toFiniteQueryNumber(query[letterSpacingKey]);
    if (
      letterSpacing == null ||
      letterSpacing < PREVIEW_LETTER_SPACING_RANGE.min ||
      letterSpacing > PREVIEW_LETTER_SPACING_RANGE.max
    ) {
      return { error: true };
    }
    box.letter_spacing = roundLayoutNumber(letterSpacing, 3);
  }

  return {
    provided: true,
    value: box,
  };
}

function parsePreviewLayoutFromQuery(query = {}) {
  const textBoxResult = parsePreviewLayoutBox({
    query,
    baseKey: '',
    required: false,
    allowLetterSpacing: true,
  });
  const titleBoxResult = parsePreviewLayoutBox({
    query,
    baseKey: 'title',
    required: false,
    allowLetterSpacing: true,
  });
  const footerBoxResult = parsePreviewLayoutBox({
    query,
    baseKey: 'footer',
    required: false,
  });

  if (textBoxResult.error || titleBoxResult.error || footerBoxResult.error) {
    return { provided: true, error: true };
  }

  if (!textBoxResult.provided && !titleBoxResult.provided && !footerBoxResult.provided) {
    return { provided: false, value: null };
  }

  if (!textBoxResult.provided) {
    return { provided: true, error: true };
  }

  const layoutPayload = {
    layout_version: 1,
    unit: LAYOUT_UNIT_NORMALIZED,
    text_box: textBoxResult.value,
  };
  if (titleBoxResult.provided) {
    layoutPayload.title_box = titleBoxResult.value;
  }
  if (footerBoxResult.provided) {
    layoutPayload.footer_box = footerBoxResult.value;
  }

  return {
    provided: true,
    value: JSON.stringify(layoutPayload),
  };
}

router.get('/feed-images/post/:postId', async (req, res) => {
  const postId = parsePostId(req.params.postId);
  if (!postId) {
    return res.status(400).json({
      ok: false,
      message: '잘못된 글 ID입니다.',
    });
  }

  const template = normalizeTemplateKey(req.query.template);
  const scale = normalizeScale(req.query.scale);
  const imageFormat = normalizeImageFormat(req.query.format);
  const page = parsePageNumber(req.query.page);
  if (!page) {
    return res.status(400).json({
      ok: false,
      message: '잘못된 페이지 번호입니다.',
    });
  }

  try {
    const post = await dbGetAsync(
      `
      SELECT
        id,
        title,
        content,
        created_at,
        category,
        layout_json
      FROM posts
      WHERE id = ?
      LIMIT 1
      `,
      [postId]
    );

    if (!post) {
      return res.status(404).json({
        ok: false,
        message: '해당 글을 찾을 수 없습니다.',
      });
    }

    const manifest = await getFeedCardImageManifest({
      post,
      templateKey: template,
      scale,
    });
    if (page > manifest.pageCount) {
      return res.status(404).json({
        ok: false,
        message: '해당 이미지 페이지를 찾을 수 없습니다.',
      });
    }

    const rendered = await renderFeedCardImage({
      post,
      templateKey: template,
      scale,
      renderMode: 'feed',
      page,
      imageFormat,
    });

    res.set(
      'Cache-Control',
      'public, max-age=300, s-maxage=300, stale-while-revalidate=86400'
    );
    res.removeHeader('Pragma');
    res.removeHeader('Expires');
    res.set('ETag', rendered.etag);
    if (req.headers['if-none-match'] === rendered.etag) {
      return res.status(304).end();
    }

    res.set('Content-Type', rendered.contentType || 'image/webp');
    res.set('X-Feed-Image-Cache', rendered.cacheHit ? 'HIT' : 'MISS');
    res.set('X-Feed-Image-Template', rendered.template || template);
    res.set('X-Feed-Image-Scale', String(rendered.scale || scale));
    res.set('X-Feed-Image-Format', rendered.imageFormat || imageFormat);
    res.set('X-Feed-Image-Page', String(rendered.page || page));
    res.set('X-Feed-Image-Page-Count', String(manifest.pageCount));
    res.set('X-Feed-Image-Truncated', manifest.isTruncated ? '1' : '0');
    if (rendered.layout) {
      res.set('X-Feed-Image-Layout', rendered.layout);
    }

    return res.status(200).send(rendered.buffer);
  } catch (error) {
    console.error('[feed-image] render failed:', error);
    return res.status(500).json({
      ok: false,
      message: '피드 이미지 생성 중 오류가 발생했습니다.',
    });
  }
});

router.get('/feed-images/share/post/:postId', async (req, res) => {
  const postId = parsePostId(req.params.postId);
  if (!postId) {
    return res.status(400).json({
      ok: false,
      message: '잘못된 글 ID입니다.',
    });
  }

  const template = normalizeTemplateKey(req.query.template);
  const scale = normalizeScale(req.query.scale);
  const imageFormat = normalizeImageFormat(req.query.format);
  const page = parsePageNumber(req.query.page);
  if (!page) {
    return res.status(400).json({
      ok: false,
      message: '잘못된 페이지 번호입니다.',
    });
  }
  if (page > 1) {
    return res.status(404).json({
      ok: false,
      message: '공유 이미지는 첫 페이지 한 장만 지원합니다.',
    });
  }

  try {
    const post = await dbGetAsync(
      `
      SELECT
        id,
        title,
        content,
        created_at,
        category,
        layout_json
      FROM posts
      WHERE id = ?
      LIMIT 1
      `,
      [postId]
    );

    if (!post) {
      return res.status(404).json({
        ok: false,
        message: '해당 글을 찾을 수 없습니다.',
      });
    }

    const rendered = await renderFeedCardImage({
      post,
      templateKey: template,
      scale,
      renderMode: 'share',
      page: 1,
      imageFormat,
    });

    res.set(
      'Cache-Control',
      'public, max-age=300, s-maxage=300, stale-while-revalidate=86400'
    );
    res.removeHeader('Pragma');
    res.removeHeader('Expires');
    res.set('ETag', rendered.etag);
    if (req.headers['if-none-match'] === rendered.etag) {
      return res.status(304).end();
    }

    res.set('Content-Type', rendered.contentType || 'image/webp');
    res.set('X-Feed-Image-Cache', rendered.cacheHit ? 'HIT' : 'MISS');
    res.set('X-Feed-Image-Template', rendered.template || template);
    res.set('X-Feed-Image-Scale', String(rendered.scale || scale));
    res.set('X-Feed-Image-Format', rendered.imageFormat || imageFormat);
    res.set('X-Feed-Image-Page', '1');
    res.set('X-Feed-Image-Page-Count', '1');
    if (rendered.layout) {
      res.set('X-Feed-Image-Layout', rendered.layout);
    }

    return res.status(200).send(rendered.buffer);
  } catch (error) {
    console.error('[feed-image/share] render failed:', error);
    return res.status(500).json({
      ok: false,
      message: '공유 이미지 생성 중 오류가 발생했습니다.',
    });
  }
});

router.post('/feed-images/preview/sessions', authRequired, async (req, res) => {
  const template = normalizeTemplateKey(req.body?.template);
  const scale = normalizeScale(req.body?.scale);
  const previewDraft = normalizePreviewDraftPost(req.body || {});

  if (previewDraft.error) {
    return res.status(400).json({
      ok: false,
      message: previewDraft.error,
    });
  }

  try {
    const manifest = await getFeedCardImageManifest({
      post: previewDraft.value,
      templateKey: template,
      scale,
    });

    const session = await createPreviewSession({
      userId: req.user?.id,
      post: previewDraft.value,
      template,
      scale,
      manifest,
    });

    res.set('Cache-Control', 'no-store, max-age=0');
    res.removeHeader('Pragma');
    res.removeHeader('Expires');

    return res.status(200).json(buildPreviewSessionResponse(session));
  } catch (error) {
    console.error('[feed-image/preview-session] create failed:', error);
    return res.status(500).json({
      ok: false,
      message: '미리보기 세션 생성 중 오류가 발생했습니다.',
    });
  }
});

router.get('/feed-images/preview/sessions/:sessionId', authOptional, async (req, res) => {
  const page = parsePageNumber(req.query.page);
  if (!page) {
    return res.status(400).json({
      ok: false,
      message: '잘못된 페이지 번호입니다.',
    });
  }

  try {
    const session = await readPreviewSession(req.params.sessionId);
    cleanupExpiredPreviewSessions().catch((error) => {
      console.warn('[feed-image/preview-session] cleanup failed:', error);
    });
    if (!session) {
      return res.status(404).json({
        ok: false,
        message: '해당 미리보기 세션을 찾을 수 없습니다.',
      });
    }
    if (session.expired) {
      return res.status(410).json({
        ok: false,
        message: '미리보기 세션이 만료되었습니다.',
      });
    }
    if (req.user?.id && String(session.user_id) !== String(req.user.id)) {
      return res.status(404).json({
        ok: false,
        message: '해당 미리보기 세션을 찾을 수 없습니다.',
      });
    }
    if (page > Math.max(1, Number(session.page_count) || 1)) {
      return res.status(404).json({
        ok: false,
        message: '해당 이미지 페이지를 찾을 수 없습니다.',
      });
    }

    const rendered = await renderFeedCardImage({
      post: session.post,
      templateKey: session.template,
      scale: session.scale,
      renderMode: 'feed',
      page,
    });

    res.set('Cache-Control', 'no-store, max-age=0');
    res.removeHeader('Pragma');
    res.removeHeader('Expires');
    res.set('Content-Type', rendered.contentType || 'image/webp');
    res.set('X-Feed-Image-Cache', rendered.cacheHit ? 'HIT' : 'MISS');
    res.set('X-Feed-Image-Template', rendered.template || session.template || 'paper01');
    res.set('X-Feed-Image-Scale', String(rendered.scale || session.scale || 1));
    res.set('X-Feed-Image-Page', String(rendered.page || page));
    res.set('X-Feed-Image-Page-Count', String(session.page_count || 1));
    res.set('X-Feed-Image-Truncated', session.is_truncated ? '1' : '0');
    if (rendered.layout) {
      res.set('X-Feed-Image-Layout', rendered.layout);
    }

    return res.status(200).send(rendered.buffer);
  } catch (error) {
    console.error('[feed-image/preview-session] render failed:', error);
    return res.status(500).json({
      ok: false,
      message: '미리보기 이미지 생성 중 오류가 발생했습니다.',
    });
  }
});

router.get('/feed-images/preview', async (req, res) => {
  const template = normalizeTemplateKey(req.query.template);
  const scale = normalizeScale(req.query.scale);
  const previewLayout = parsePreviewLayoutFromQuery(req.query);

  if (previewLayout.error) {
    return res.status(400).json({
      ok: false,
      message: '미리보기 레이아웃 값이 올바르지 않습니다.',
    });
  }

  const title = pickPreviewText(req.query.title, 120) || '미리보기 제목';
  const content = pickPreviewText(req.query.content, 5000);
  const category = pickPreviewText(req.query.category, 16) || 'short';
  const createdAt =
    pickPreviewText(req.query.created_at, 64) || new Date().toISOString();

  if (!content) {
    return res.status(400).json({
      ok: false,
      message: '미리보기 본문이 비어 있습니다.',
    });
  }

  try {
    const rendered = await renderFeedCardImage({
      post: {
        id: 'preview',
        title,
        content,
        created_at: createdAt,
        category,
        layout_json: previewLayout.provided ? previewLayout.value : null,
      },
      templateKey: template,
      scale,
      renderMode: 'feed',
    });

    res.set('Cache-Control', 'no-store, max-age=0');
    res.removeHeader('Pragma');
    res.removeHeader('Expires');
    res.set('Content-Type', rendered.contentType || 'image/webp');
    res.set('X-Feed-Image-Template', rendered.template || template);
    res.set('X-Feed-Image-Scale', String(rendered.scale || scale));

    return res.status(200).send(rendered.buffer);
  } catch (error) {
    console.error('[feed-image/preview] render failed:', error);
    return res.status(500).json({
      ok: false,
      message: '미리보기 이미지 생성 중 오류가 발생했습니다.',
    });
  }
});

module.exports = router;
