const express = require('express');

const db = require('../db');
const {
  normalizeScale,
  normalizeTemplateKey,
  renderFeedCardImage,
} = require('../utils/feedImageRenderer');

const router = express.Router();
const PREVIEW_LAYOUT_ALIGN = new Set(['left', 'center', 'right']);

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

function parsePreviewLayoutBox({
  query = {},
  baseKey = '',
  required = false,
}) {
  const keyPrefix = baseKey ? `layout_${baseKey}_` : 'layout_';
  const xKey = `${keyPrefix}x`;
  const yKey = `${keyPrefix}y`;
  const wKey = `${keyPrefix}w`;
  const hKey = `${keyPrefix}h`;
  const alignKey = `${keyPrefix}align`;
  const fontScaleKey = `${keyPrefix}font_scale`;
  const lineHeightKey = `${keyPrefix}line_height`;

  const xRaw = query[xKey];
  const yRaw = query[yKey];
  const wRaw = query[wKey];
  const hRaw = query[hKey];

  const hasAny =
    [xRaw, yRaw, wRaw, hRaw, query[alignKey], query[fontScaleKey], query[lineHeightKey]]
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
    if (fontScale == null || fontScale <= 0) {
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
    if (lineHeight == null || lineHeight <= 0) {
      return { error: true };
    }
    box.line_height = roundLayoutNumber(lineHeight, 3);
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
  });
  const titleBoxResult = parsePreviewLayoutBox({
    query,
    baseKey: 'title',
    required: false,
  });

  if (textBoxResult.error || titleBoxResult.error) {
    return { provided: true, error: true };
  }

  if (!textBoxResult.provided && !titleBoxResult.provided) {
    return { provided: false, value: null };
  }

  if (!textBoxResult.provided) {
    return { provided: true, error: true };
  }

  const layoutPayload = {
    layout_version: 1,
    text_box: textBoxResult.value,
  };
  if (titleBoxResult.provided) {
    layoutPayload.title_box = titleBoxResult.value;
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
      renderMode: 'feed',
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
