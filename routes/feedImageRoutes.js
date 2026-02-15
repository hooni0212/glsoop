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

module.exports = router;
