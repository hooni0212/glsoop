const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const sanitizeHtml = require('sanitize-html');
const sharp = require('sharp');

const RENDER_VERSION = 'feed-image-poc-v9';
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
  oneLine: {
    topPct: 0.34,
    leftPct: 0.29,
    widthPct: 0.42,
    bottomPct: 0.34,
    fontSizeRatio: 0.041,
    lineHeightRatio: 1.14,
    maxLines: 2,
    textAlign: 'center',
    verticalAlign: 'center',
  },
  short: {
    topPct: 0.364,
    leftPct: 0.336,
    widthPct: 0.424,
    bottomPct: 0.29,
    fontSizeRatio: 0.035,
    lineHeightRatio: 1.15,
    maxLines: 5,
    textAlign: 'center',
    verticalAlign: 'center',
  },
  medium: {
    topPct: 0.462,
    leftPct: 0.354,
    widthPct: 0.41,
    bottomPct: 0.126,
    fontSizeRatio: 0.0325,
    lineHeightRatio: 1.13,
    maxLines: 8,
    textAlign: 'left',
    verticalAlign: 'top',
  },
  long: {
    topPct: 0.448,
    leftPct: 0.322,
    widthPct: 0.452,
    bottomPct: 0.102,
    fontSizeRatio: 0.03,
    lineHeightRatio: 1.12,
    maxLines: 12,
    textAlign: 'left',
    verticalAlign: 'top',
  },
  xlong: {
    topPct: 0.438,
    leftPct: 0.299,
    widthPct: 0.488,
    bottomPct: 0.088,
    fontSizeRatio: 0.0275,
    lineHeightRatio: 1.11,
    maxLines: 15,
    textAlign: 'left',
    verticalAlign: 'top',
  },
};

const TEXT_COLOR = '#473f36';
const TEXT_FONT_WEIGHT = 600;
const SVG_FONT_FAMILY =
  "'Noto Serif KR','Nanum Myeongjo','Apple SD Gothic Neo','Malgun Gothic','Times New Roman',serif";
const SHARE_LOGO_TEXT = '글숲';
const SHARE_SIGNATURE_OPACITY = 0.74;
const SHARE_LAYOUT_PRESETS = {
  oneLine: {
    fontSizeRatio: 0.041,
    lineHeightRatio: 1.14,
    title: {
      leftPct: 0.29,
      topPct: 0.24,
      widthPct: 0.42,
      heightPct: 0.125,
      textAlign: 'center',
      verticalAlign: 'top',
      maxLines: 2,
    },
    body: {
      leftPct: 0.29,
      topPct: 0.34,
      widthPct: 0.42,
      heightPct: 0.32,
      textAlign: 'center',
      verticalAlign: 'center',
      maxLines: 4,
    },
  },
  short: {
    fontSizeRatio: 0.035,
    lineHeightRatio: 1.15,
    title: {
      leftPct: 0.336,
      topPct: 0.256,
      widthPct: 0.424,
      heightPct: 0.122,
      textAlign: 'center',
      verticalAlign: 'top',
      maxLines: 2,
    },
    body: {
      leftPct: 0.336,
      topPct: 0.364,
      widthPct: 0.424,
      heightPct: 0.346,
      textAlign: 'center',
      verticalAlign: 'center',
      maxLines: 6,
    },
  },
  medium: {
    fontSizeRatio: 0.0325,
    lineHeightRatio: 1.13,
    title: {
      leftPct: 0.354,
      topPct: 0.268,
      widthPct: 0.41,
      heightPct: 0.12,
      textAlign: 'left',
      verticalAlign: 'top',
      maxLines: 2,
    },
    body: {
      leftPct: 0.354,
      topPct: 0.462,
      widthPct: 0.41,
      heightPct: 0.412,
      textAlign: 'left',
      verticalAlign: 'top',
      maxLines: 8,
    },
  },
  long: {
    fontSizeRatio: 0.03,
    lineHeightRatio: 1.12,
    title: {
      leftPct: 0.322,
      topPct: 0.262,
      widthPct: 0.452,
      heightPct: 0.124,
      textAlign: 'left',
      verticalAlign: 'top',
      maxLines: 2,
    },
    body: {
      leftPct: 0.322,
      topPct: 0.448,
      widthPct: 0.452,
      heightPct: 0.45,
      textAlign: 'left',
      verticalAlign: 'top',
      maxLines: 11,
    },
  },
  xlong: {
    fontSizeRatio: 0.0275,
    lineHeightRatio: 1.11,
    title: {
      leftPct: 0.299,
      topPct: 0.258,
      widthPct: 0.488,
      heightPct: 0.128,
      textAlign: 'left',
      verticalAlign: 'top',
      maxLines: 2,
    },
    body: {
      leftPct: 0.299,
      topPct: 0.438,
      widthPct: 0.488,
      heightPct: 0.474,
      textAlign: 'left',
      verticalAlign: 'top',
      maxLines: 13,
    },
  },
};
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

function normalizeRenderMode(input) {
  return String(input || '').trim().toLowerCase() === 'share' ? 'share' : 'feed';
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
  if (textLength <= 20) return 'oneLine';
  if (textLength <= 70) return 'short';
  if (textLength <= 170) return 'medium';
  if (textLength <= 260) return 'long';
  return 'xlong';
}

function selectShareLayoutPreset(text) {
  const source = String(text || '').trim();
  if (!source) return 'short';

  const lines = source
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const compactLength = source.replace(/\s+/g, '').length;

  if (lines.length <= 1 && compactLength <= 20) return 'oneLine';
  if (compactLength <= 70) return 'short';
  if (compactLength <= 170) return 'medium';
  if (compactLength <= 260) return 'long';
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

function buildCacheHash({ post, templateKey, scale, renderMode }) {
  const payload = JSON.stringify({
    render_version: RENDER_VERSION,
    template: templateKey,
    scale,
    render_mode: normalizeRenderMode(renderMode),
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
  const shouldCenter = preset.verticalAlign === 'center';
  const isCenterText = preset.textAlign === 'center';
  const textX = isCenterText ? boxX + boxWidth / 2 : boxX;
  const textAnchor = isCenterText ? 'middle' : 'start';

  const topOffset = shouldCenter
    ? Math.max(0, (boxHeight - rawTextBlockHeight) / 2)
    : 0;

  const firstBaselineY = boxY + topOffset + fontSizePx;
  const tspans = lines
    .map((line, index) => {
      const y = firstBaselineY + index * lineHeightPx;
      const safeText = line ? escapeXml(line) : ' ';
      return `<tspan x="${Math.round(textX * 100) / 100}" y="${Math.round(y * 100) / 100}">${safeText}</tspan>`;
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
      text-anchor="${textAnchor}"
      letter-spacing="0"
      text-rendering="optimizeLegibility"
    >
      ${tspans}
    </text>
  </g>
</svg>
  `.trim();
}

function resolveBoxFromPreset(width, height, boxPreset) {
  const boxX = Math.round(width * boxPreset.leftPct);
  const boxY = Math.round(height * boxPreset.topPct);
  const boxWidth = Math.round(width * boxPreset.widthPct);
  const boxHeight = Math.round(height * boxPreset.heightPct);
  return {
    x: boxX,
    y: boxY,
    width: boxWidth,
    height: boxHeight,
  };
}

function resolveFittedMaxLines(boxHeightPx, lineHeightPx, presetMaxLines) {
  const fitted = Math.max(1, Math.floor(boxHeightPx / Math.max(1, lineHeightPx)));
  const normalizedPreset = Math.max(1, Number(presetMaxLines) || 1);
  return Math.max(1, Math.min(fitted, normalizedPreset));
}

function buildSvgTextGroup({
  clipId,
  box,
  lines,
  textAlign = 'left',
  verticalAlign = 'top',
  fontSizePx,
  lineHeightPx,
  color = TEXT_COLOR,
  fontFamily = SVG_FONT_FAMILY,
  fontWeight = TEXT_FONT_WEIGHT,
}) {
  const safeLines = Array.isArray(lines) && lines.length > 0 ? lines : [' '];
  const rawTextBlockHeight = lineHeightPx * safeLines.length;
  const shouldCenter = verticalAlign === 'center';
  const isCenterText = textAlign === 'center';
  const textX = isCenterText ? box.x + box.width / 2 : box.x;
  const textAnchor = isCenterText ? 'middle' : 'start';
  const topOffset = shouldCenter
    ? Math.max(0, (box.height - rawTextBlockHeight) / 2)
    : 0;
  const firstBaselineY = box.y + topOffset + fontSizePx;

  const tspans = safeLines
    .map((line, index) => {
      const y = firstBaselineY + index * lineHeightPx;
      const safeText = line ? escapeXml(line) : ' ';
      return `<tspan x="${Math.round(textX * 100) / 100}" y="${Math.round(y * 100) / 100}">${safeText}</tspan>`;
    })
    .join('');

  return {
    defs: `<clipPath id="${clipId}"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" /></clipPath>`,
    group: `
  <g clip-path="url(#${clipId})">
    <text
      fill="${color}"
      font-family="${fontFamily}"
      font-size="${Math.round(fontSizePx * 100) / 100}"
      font-weight="${fontWeight}"
      text-anchor="${textAnchor}"
      letter-spacing="0"
      text-rendering="optimizeLegibility"
    >
      ${tspans}
    </text>
  </g>
    `.trim(),
  };
}

function buildSvgBrandSignature({ width, height }) {
  const safeBottomGap = Math.max(24, Math.round(height * 0.035));
  const fontSizePx = Math.max(15, Math.round(width * 0.025));
  const textX = Math.round(width / 2);
  const textY = Math.round(height - safeBottomGap);

  return `
  <g aria-label="brand-signature">
    <text
      x="${textX}"
      y="${textY}"
      fill="rgba(71, 63, 54, ${SHARE_SIGNATURE_OPACITY})"
      font-family="${SVG_FONT_FAMILY}"
      font-size="${fontSizePx}"
      font-weight="500"
      letter-spacing="0.04em"
      text-anchor="middle"
      text-rendering="optimizeLegibility"
    >${SHARE_LOGO_TEXT}</text>
  </g>
  `.trim();
}

function buildSvgShareOverlay({
  width,
  height,
  titleLines,
  bodyLines,
  layoutPreset,
  fontSizePx,
  lineHeightPx,
}) {
  const titleBox = resolveBoxFromPreset(width, height, layoutPreset.title);
  const bodyBox = resolveBoxFromPreset(width, height, layoutPreset.body);

  const titleGroup = buildSvgTextGroup({
    clipId: 'share-title-box',
    box: titleBox,
    lines: titleLines,
    textAlign: layoutPreset.title.textAlign,
    verticalAlign: layoutPreset.title.verticalAlign,
    fontSizePx,
    lineHeightPx,
  });

  const bodyGroup = buildSvgTextGroup({
    clipId: 'share-body-box',
    box: bodyBox,
    lines: bodyLines,
    textAlign: layoutPreset.body.textAlign,
    verticalAlign: layoutPreset.body.verticalAlign,
    fontSizePx,
    lineHeightPx,
  });

  const brandSignature = buildSvgBrandSignature({ width, height });

  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    ${titleGroup.defs}
    ${bodyGroup.defs}
  </defs>
  ${bodyGroup.group}
  ${titleGroup.group}
  ${brandSignature}
</svg>
  `.trim();
}

async function renderFeedModeImageBuffer({
  post,
  template,
  outputWidth,
  outputHeight,
  scale,
}) {
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
  const nonEmptyLineCount = lines.filter((line) => String(line || '').trim().length > 0).length;
  const effectivePreset =
    nonEmptyLineCount <= 1
      ? {
          ...preset,
          topPct: 0.34,
          leftPct: 0.26,
          widthPct: 0.48,
          bottomPct: 0.34,
          textAlign: 'center',
          verticalAlign: 'center',
        }
      : preset;

  const svgOverlay = buildSvgTextOverlay({
    width: outputWidth,
    height: outputHeight,
    lines,
    preset: effectivePreset,
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

async function renderShareModeImageBuffer({
  post,
  template,
  outputWidth,
  outputHeight,
  scale,
}) {
  const titleText = normalizePostText(post?.title) || '제목 없음';
  const bodyText = normalizePostText(post?.content) || titleText || ' ';
  const layoutKey = selectShareLayoutPreset(bodyText);
  const layoutPreset = SHARE_LAYOUT_PRESETS[layoutKey] || SHARE_LAYOUT_PRESETS.medium;
  const minFontSizePx = scale === 2 ? 20 : 12;
  const fontSizePx = Math.max(minFontSizePx, outputWidth * layoutPreset.fontSizeRatio);
  const lineHeightPx = fontSizePx * layoutPreset.lineHeightRatio;

  const titleBox = resolveBoxFromPreset(outputWidth, outputHeight, layoutPreset.title);
  const bodyBox = resolveBoxFromPreset(outputWidth, outputHeight, layoutPreset.body);
  const titleMaxLines = resolveFittedMaxLines(
    titleBox.height,
    lineHeightPx,
    layoutPreset.title.maxLines
  );
  const bodyMaxLines = resolveFittedMaxLines(
    bodyBox.height,
    lineHeightPx,
    layoutPreset.body.maxLines
  );

  const titleLines = layoutTextLines(
    titleText,
    Math.max(20, titleBox.width),
    fontSizePx,
    titleMaxLines
  );
  const bodyLines = layoutTextLines(
    bodyText,
    Math.max(20, bodyBox.width),
    fontSizePx,
    bodyMaxLines
  );

  const svgOverlay = buildSvgShareOverlay({
    width: outputWidth,
    height: outputHeight,
    titleLines,
    bodyLines,
    layoutPreset,
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
    layout: `share-${layoutKey}`,
  };
}

async function renderFeedImageBuffer({
  post,
  templateKey = 'paper01',
  scale = 1,
  renderMode = 'feed',
}) {
  const template = TEMPLATE_CONFIG[templateKey] || TEMPLATE_CONFIG.paper01;
  const { width, height } = await getTemplateMetadata(template.filePath);
  const outputWidth = scale === 2 ? width * 2 : width;
  const outputHeight = scale === 2 ? height * 2 : height;
  const normalizedMode = normalizeRenderMode(renderMode);

  if (normalizedMode === 'share') {
    return renderShareModeImageBuffer({
      post,
      template,
      outputWidth,
      outputHeight,
      scale,
    });
  }

  return renderFeedModeImageBuffer({
    post,
    template,
    outputWidth,
    outputHeight,
    scale,
  });
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

async function renderFeedCardImage({ post, templateKey, scale, renderMode = 'feed' }) {
  const normalizedTemplate = normalizeTemplateKey(templateKey);
  const normalizedScale = normalizeScale(scale);
  const normalizedRenderMode = normalizeRenderMode(renderMode);
  const cacheHash = buildCacheHash({
    post,
    templateKey: normalizedTemplate,
    scale: normalizedScale,
    renderMode: normalizedRenderMode,
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
      renderMode: normalizedRenderMode,
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
