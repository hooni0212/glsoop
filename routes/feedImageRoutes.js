const express = require('express');

const db = require('../db');
const {
  normalizeScale,
  normalizeTemplateKey,
  renderFeedCardImage,
} = require('../utils/feedImageRenderer');

const router = express.Router();

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
        category
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
        category
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
