const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const sanitizeHtml = require('sanitize-html');
const sharp = require('sharp');

const RENDER_VERSION = 'feed-image-poc-v4';
const CACHE_DIR = path.join(__dirname, '..', 'tmp', 'feed-image-cache');

const TEMPLATE_CONFIG = {
  paper01: {
    key: 'paper01',
    filePath: path.join(
      __dirname,
      '..',
      'public',
      'img',
      'feed-templates-v2',
      'paper-source-01.jpg'
    ),
  },
  paper02: {
    key: 'paper02',
    filePath: path.join(
      __dirname,
      '..',
      'public',
      'img',
      'feed-templates-v2',
      'paper-source-02.jpg'
    ),
  },
};

const LAYOUT_PRESETS = {
  short: {
    topPct: 0.472,
    leftPct: 0.373,
    widthPct: 0.385,
    bottomPct: 0.162,
    fontSizeRatio: 0.032,
    lineHeightRatio: 1.13,
    maxLines: 4,
    centerIfShort: true,
  },
  medium: {
    topPct: 0.462,
    leftPct: 0.354,
    widthPct: 0.41,
    bottomPct: 0.126,
    fontSizeRatio: 0.0295,
    lineHeightRatio: 1.12,
    maxLines: 8,
    centerIfShort: false,
  },
  long: {
    topPct: 0.448,
    leftPct: 0.322,
    widthPct: 0.452,
    bottomPct: 0.102,
    fontSizeRatio: 0.0275,
    lineHeightRatio: 1.11,
    maxLines: 12,
    centerIfShort: false,
  },
  xlong: {
    topPct: 0.438,
    leftPct: 0.299,
    widthPct: 0.488,
    bottomPct: 0.088,
    fontSizeRatio: 0.0255,
    lineHeightRatio: 1.1,
    maxLines: 15,
    centerIfShort: false,
  },
};

const TEXT_COLOR = '#473f36';
const TEXT_FONT_WEIGHT = 600;
const SVG_FONT_FAMILY =
  "'Noto Serif KR','Nanum Myeongjo','Apple SD Gothic Neo','Malgun Gothic','Times New Roman',serif";
const inFlightRenders = new Map();
const templateMetaCache = new Map();

function normalizeTemplateKey(input) {
  const key = String(input || 'paper01').trim().toLowerCase();
  if (TEMPLATE_CONFIG[key]) return key;
  return 'paper01';
}

function normalizeScale(input) {
  const parsed = Number.parseInt(input, 10);
  return parsed === 2 ? 2 : 1;
}

function decodeBasicEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizePostText(raw) {
  const withLineBreaks = String(raw || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|h[1-6]|li)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ');

  const stripped = sanitizeHtml(withLineBreaks, {
    allowedTags: [],
    allowedAttributes: {},
  });

  return decodeBasicEntities(stripped)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\u200b/g, '')
    .trim();
}

function selectLengthPreset(textLength) {
  if (textLength <= 30) return 'short';
  if (textLength <= 90) return 'medium';
  if (textLength <= 190) return 'long';
  return 'xlong';
}

function isCjkChar(ch) {
  return /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af\u3040-\u30ff\u3400-\u9fff]/.test(
    ch
  );
}

function estimateTextWidthPx(text, fontSizePx) {
  const str = String(text || '');
  let width = 0;

  for (const ch of str) {
    if (/\s/.test(ch)) {
      width += fontSizePx * 0.34;
      continue;
    }
    if (isCjkChar(ch)) {
      width += fontSizePx * 0.98;
      continue;
    }
    if (/[A-Z]/.test(ch)) {
      width += fontSizePx * 0.64;
      continue;
    }
    if (/[a-z]/.test(ch)) {
      width += fontSizePx * 0.54;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      width += fontSizePx * 0.56;
      continue;
    }
    if (/[.,:;'"`~!?()[\]{}|/\\-]/.test(ch)) {
      width += fontSizePx * 0.34;
      continue;
    }
    width += fontSizePx * 0.75;
  }

  return width;
}

function splitWordByWidth(word, maxWidthPx, fontSizePx) {
  const chunks = [];
  let current = '';

  for (const ch of Array.from(String(word || ''))) {
    const next = `${current}${ch}`;
    if (current && estimateTextWidthPx(next, fontSizePx) > maxWidthPx) {
      chunks.push(current);
      current = ch;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks.length ? chunks : [''];
}

function wrapSingleParagraph(paragraph, maxWidthPx, fontSizePx) {
  const normalized = String(paragraph || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [''];

  const words = normalized.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (estimateTextWidthPx(candidate, fontSizePx) <= maxWidthPx) {
      currentLine = candidate;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = '';
    }

    if (estimateTextWidthPx(word, fontSizePx) <= maxWidthPx) {
      currentLine = word;
      continue;
    }

    const chunks = splitWordByWidth(word, maxWidthPx, fontSizePx);
    if (chunks.length === 1) {
      currentLine = chunks[0];
      continue;
    }

    lines.push(...chunks.slice(0, -1));
    currentLine = chunks[chunks.length - 1];
  }

  if (currentLine) lines.push(currentLine);
  return lines.length ? lines : [''];
}

function clampLineWithEllipsis(line, maxWidthPx, fontSizePx) {
  const text = String(line || '');
  const ellipsis = '…';
  if (estimateTextWidthPx(text, fontSizePx) <= maxWidthPx) return text;

  let result = '';
  for (const ch of Array.from(text)) {
    const next = `${result}${ch}`;
    if (estimateTextWidthPx(`${next}${ellipsis}`, fontSizePx) > maxWidthPx) break;
    result = next;
  }

  return `${result}${ellipsis}`;
}

function layoutTextLines(text, maxWidthPx, fontSizePx, maxLines) {
  const paragraphs = String(text || '')
    .split('\n')
    .map((line) => line.trim());

  const lines = [];

  paragraphs.forEach((paragraph, index) => {
    const wrapped = wrapSingleParagraph(paragraph, maxWidthPx, fontSizePx);
    lines.push(...wrapped);
    if (index < paragraphs.length - 1) {
      lines.push('');
    }
  });

  while (lines.length > 1 && !lines[lines.length - 1]) {
    lines.pop();
  }

  if (lines.length <= maxLines) return lines;

  const truncated = lines.slice(0, maxLines);
  truncated[maxLines - 1] = clampLineWithEllipsis(
    truncated[maxLines - 1],
    maxWidthPx,
    fontSizePx
  );
  return truncated;
}

function escapeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function getTemplateMetadata(filePath) {
  if (templateMetaCache.has(filePath)) {
    return templateMetaCache.get(filePath);
  }

  const metadata = await sharp(filePath).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  if (!width || !height) {
    throw new Error(`invalid template metadata: ${filePath}`);
  }

  const value = { width, height };
  templateMetaCache.set(filePath, value);
  return value;
}

function buildCacheHash({ post, templateKey, scale }) {
  const payload = JSON.stringify({
    render_version: RENDER_VERSION,
    template: templateKey,
    scale,
    post_id: post?.id,
    title: post?.title || '',
    content: post?.content || '',
    created_at: post?.created_at || '',
  });

  return crypto.createHash('sha1').update(payload).digest('hex');
}

function buildSvgTextOverlay({
  width,
  height,
  lines,
  preset,
  fontSizePx,
  lineHeightPx,
}) {
  const boxX = Math.round(width * preset.leftPct);
  const boxY = Math.round(height * preset.topPct);
  const boxWidth = Math.round(width * preset.widthPct);
  const boxHeight = Math.max(
    0,
    height - boxY - Math.round(height * preset.bottomPct)
  );

  const rawTextBlockHeight = lineHeightPx * Math.max(lines.length, 1);
  const shouldCenter =
    !!preset.centerIfShort && lines.filter(Boolean).length > 0 && lines.length <= 3;

  const topOffset = shouldCenter
    ? Math.max(0, (boxHeight - rawTextBlockHeight) / 2)
    : 0;

  const firstBaselineY = boxY + topOffset + fontSizePx;
  const tspans = lines
    .map((line, index) => {
      const y = firstBaselineY + index * lineHeightPx;
      const safeText = line ? escapeXml(line) : ' ';
      return `<tspan x="${boxX}" y="${Math.round(y * 100) / 100}">${safeText}</tspan>`;
    })
    .join('');

  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="feed-text-box">
      <rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" />
    </clipPath>
  </defs>
  <g clip-path="url(#feed-text-box)">
    <text
      fill="${TEXT_COLOR}"
      font-family="${SVG_FONT_FAMILY}"
      font-size="${Math.round(fontSizePx * 100) / 100}"
      font-weight="${TEXT_FONT_WEIGHT}"
      letter-spacing="0"
      text-rendering="optimizeLegibility"
    >
      ${tspans}
    </text>
  </g>
</svg>
  `.trim();
}

async function renderFeedImageBuffer({
  post,
  templateKey = 'paper01',
  scale = 1,
}) {
  const template = TEMPLATE_CONFIG[templateKey] || TEMPLATE_CONFIG.paper01;
  const { width, height } = await getTemplateMetadata(template.filePath);
  const outputWidth = scale === 2 ? width * 2 : width;
  const outputHeight = scale === 2 ? height * 2 : height;

  const text =
    normalizePostText(post?.content) ||
    normalizePostText(post?.title) ||
    ' ';
  const presetKey = selectLengthPreset(text.length);
  const preset = LAYOUT_PRESETS[presetKey];
  const minFontSizePx = scale === 2 ? 20 : 12;
  const fontSizePx = Math.max(minFontSizePx, outputWidth * preset.fontSizeRatio);
  const lineHeightPx = fontSizePx * preset.lineHeightRatio;
  const maxTextWidthPx = Math.max(20, outputWidth * preset.widthPct);
  const lines = layoutTextLines(text, maxTextWidthPx, fontSizePx, preset.maxLines);

  const svgOverlay = buildSvgTextOverlay({
    width: outputWidth,
    height: outputHeight,
    lines,
    preset,
    fontSizePx,
    lineHeightPx,
  });

  const imageBuffer = await sharp(template.filePath)
    .resize(outputWidth, outputHeight, {
      fit: 'fill',
      kernel: sharp.kernel.lanczos3,
    })
    .composite([
      {
        input: Buffer.from(svgOverlay),
        top: 0,
        left: 0,
      },
    ])
    .webp({
      quality: 92,
      effort: 4,
    })
    .toBuffer();

  return {
    buffer: imageBuffer,
    layout: presetKey,
  };
}

async function loadCachedBuffer(cachePath) {
  try {
    const buffer = await fs.readFile(cachePath);
    if (buffer && buffer.length > 0) {
      return buffer;
    }
    return null;
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function renderFeedCardImage({ post, templateKey, scale }) {
  const normalizedTemplate = normalizeTemplateKey(templateKey);
  const normalizedScale = normalizeScale(scale);
  const cacheHash = buildCacheHash({
    post,
    templateKey: normalizedTemplate,
    scale: normalizedScale,
  });
  const cachePath = path.join(CACHE_DIR, `${cacheHash}.webp`);
  const etag = `"feed-image-${cacheHash}"`;

  const cachedBuffer = await loadCachedBuffer(cachePath);
  if (cachedBuffer) {
    return {
      buffer: cachedBuffer,
      etag,
      contentType: 'image/webp',
      cacheHit: true,
      template: normalizedTemplate,
      scale: normalizedScale,
    };
  }

  const inflightKey = cacheHash;
  if (inFlightRenders.has(inflightKey)) {
    return inFlightRenders.get(inflightKey);
  }

  const renderPromise = (async () => {
    const rendered = await renderFeedImageBuffer({
      post,
      templateKey: normalizedTemplate,
      scale: normalizedScale,
    });

    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(cachePath, rendered.buffer);
    } catch (writeError) {
      console.error('[feed-image] cache write failed:', writeError);
    }

    return {
      buffer: rendered.buffer,
      etag,
      contentType: 'image/webp',
      cacheHit: false,
      layout: rendered.layout,
      template: normalizedTemplate,
      scale: normalizedScale,
    };
  })().finally(() => {
    inFlightRenders.delete(inflightKey);
  });

  inFlightRenders.set(inflightKey, renderPromise);
  return renderPromise;
}

module.exports = {
  renderFeedCardImage,
  normalizeScale,
  normalizeTemplateKey,
};
