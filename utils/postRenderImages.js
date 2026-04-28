const {
  getFeedCardImageManifest,
  normalizeScale,
  normalizeTemplateKey,
} = require('./feedImageRenderer');

const DEFAULT_TEMPLATE = 'paper01';
const DEFAULT_SCALE = 2;
const DEFAULT_PAGE_CAP = 24;

function parseLayoutJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function extractTemplateKeyFromLayout(raw) {
  const layout = parseLayoutJson(raw);
  return normalizeTemplateKey(layout?.canvas?.presetId);
}

function resolveTemplateKeyForPost(post, templateKey) {
  if (templateKey !== undefined) return normalizeTemplateKey(templateKey);
  return extractTemplateKeyFromLayout(post?.layout_json);
}

function buildBaseFeedImageUrl(postId, { templateKey = DEFAULT_TEMPLATE, scale = DEFAULT_SCALE, version = '' } = {}) {
  if (postId == null || postId === '') return '';

  const params = new URLSearchParams();
  params.set('template', normalizeTemplateKey(templateKey));
  params.set('scale', String(normalizeScale(scale)));
  if (version) {
    params.set('v', String(version));
  }

  return `/api/feed-images/post/${encodeURIComponent(String(postId))}?${params.toString()}`;
}

function buildPagedFeedImageUrl(
  postId,
  { templateKey = DEFAULT_TEMPLATE, scale = DEFAULT_SCALE, version = '', page = 1 } = {}
) {
  const baseUrl = buildBaseFeedImageUrl(postId, {
    templateKey,
    scale,
    version,
  });
  if (!baseUrl) return '';

  const normalizedPage = Math.max(1, Number.parseInt(page, 10) || 1);
  if (normalizedPage === 1) return baseUrl;

  const [pathname, rawQuery = ''] = baseUrl.split('?');
  const params = new URLSearchParams(rawQuery);
  params.set('page', String(normalizedPage));
  return `${pathname}?${params.toString()}`;
}

async function buildPostRenderImagesMeta(
  post,
  options = {}
) {
  const {
    templateKey,
    scale = DEFAULT_SCALE,
    includeNestedPages = false,
  } = options;
  const resolvedTemplateKey = resolveTemplateKeyForPost(post, templateKey);

  if (!post || post.id == null || post.id === '') {
    return {
      image_url: '',
      primary_image: '',
      images: [],
      has_multiple: false,
      render_images: {
        primary_image: '',
        images: [],
        has_multiple: false,
        page_count: 0,
        page_cap: DEFAULT_PAGE_CAP,
        is_truncated: false,
        template: resolvedTemplateKey,
        scale: normalizeScale(scale),
        version: '',
        ...(includeNestedPages ? { pages: [] } : {}),
      },
    };
  }

  const manifest = await getFeedCardImageManifest({
    post,
    templateKey: resolvedTemplateKey,
    scale,
  });
  const pageCount = Math.max(1, Number(manifest?.pageCount) || 1);
  const version = manifest?.version || '';
  const primaryImage = buildPagedFeedImageUrl(post.id, {
    templateKey: resolvedTemplateKey,
    scale,
    version,
    page: 1,
  });
  const images = Array.from({ length: pageCount }, (_item, index) =>
    buildPagedFeedImageUrl(post.id, {
      templateKey: resolvedTemplateKey,
      scale,
      version,
      page: index + 1,
    })
  );
  const hasMultiple = pageCount > 1;
  const nested = {
    primary_image: primaryImage,
    images,
    has_multiple: hasMultiple,
    page_count: pageCount,
    page_cap: manifest?.pageCap || DEFAULT_PAGE_CAP,
    is_truncated: Boolean(manifest?.isTruncated),
    template: manifest?.template || resolvedTemplateKey,
    scale: manifest?.scale || normalizeScale(scale),
    version,
  };

  if (includeNestedPages) {
    nested.pages = images;
  }

  return {
    image_url: primaryImage,
    primary_image: primaryImage,
    images,
    has_multiple: hasMultiple,
    render_images: nested,
  };
}

async function decoratePostWithRenderImages(post, options = {}) {
  if (!post) return post;
  const renderImages = await buildPostRenderImagesMeta(post, options);
  return {
    ...post,
    ...renderImages,
  };
}

async function decoratePostRowsWithRenderImages(rows, options = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return Promise.all(rows.map((row) => decoratePostWithRenderImages(row, options)));
}

module.exports = {
  buildPostRenderImagesMeta,
  decoratePostRowsWithRenderImages,
  decoratePostWithRenderImages,
};
