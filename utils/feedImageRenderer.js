const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const sanitizeHtml = require('sanitize-html');
const sharp = require('sharp');

const RENDER_VERSION = 'feed-image-poc-v11';
const CACHE_DIR = path.join(__dirname, '..', 'tmp', 'feed-image-cache');
const FEED_IMAGE_PAGE_CAP = 8;

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

const FEED_TITLE_BOX_PRESETS = {
  oneLine: {
    leftPct: 0.29,
    topPct: 0.24,
    widthPct: 0.42,
    heightPct: 0.125,
    textAlign: 'center',
    verticalAlign: 'top',
    maxLines: 2,
  },
  short: {
    leftPct: 0.336,
    topPct: 0.256,
    widthPct: 0.424,
    heightPct: 0.122,
    textAlign: 'center',
    verticalAlign: 'top',
    maxLines: 2,
  },
  medium: {
    leftPct: 0.354,
    topPct: 0.268,
    widthPct: 0.41,
    heightPct: 0.12,
    textAlign: 'left',
    verticalAlign: 'top',
    maxLines: 2,
  },
  long: {
    leftPct: 0.322,
    topPct: 0.262,
    widthPct: 0.452,
    heightPct: 0.124,
    textAlign: 'left',
    verticalAlign: 'top',
    maxLines: 2,
  },
  xlong: {
    leftPct: 0.299,
    topPct: 0.258,
    widthPct: 0.488,
    heightPct: 0.128,
    textAlign: 'left',
    verticalAlign: 'top',
    maxLines: 2,
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

const CUSTOM_LAYOUT_ALIGN = new Set(['left', 'center', 'right']);
const LAYOUT_UNIT_NORMALIZED = 'normalized';
const CUSTOM_LAYOUT_MIN_BOX_SIZE = 0.06;
const CUSTOM_LAYOUT_FONT_SCALE_RANGE = { min: 0.7, max: 2.0 };
const CUSTOM_LAYOUT_LINE_HEIGHT_RANGE = { min: 1.0, max: 2.2 };
const CUSTOM_LAYOUT_LETTER_SPACING_RANGE = { min: -0.04, max: 0.08 };
const TEXT_CLIP_TOP_PADDING_RATIO = 0.08;
const TEXT_CLIP_BOTTOM_PADDING_RATIO = 0.14;
const inFlightRenders = new Map();
const templateMetaCache = new Map();

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function roundNumber(value, precision = 4) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function toFiniteNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

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

function parseLayoutBox(raw, { required = false, allowLetterSpacing = false } = {}) {
  if (raw == null) {
    return required ? null : null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const xRaw = toFiniteNumber(raw.x);
  const yRaw = toFiniteNumber(raw.y);
  const wRaw = toFiniteNumber(raw.w);
  const hRaw = toFiniteNumber(raw.h);

  if (xRaw == null || yRaw == null || wRaw == null || hRaw == null) {
    return null;
  }

  if (xRaw < 0 || xRaw > 1 || yRaw < 0 || yRaw > 1 || wRaw <= 0 || hRaw <= 0) {
    return null;
  }

  const normalizedW = clampNumber(wRaw, CUSTOM_LAYOUT_MIN_BOX_SIZE, 1);
  const normalizedH = clampNumber(hRaw, CUSTOM_LAYOUT_MIN_BOX_SIZE, 1);
  const normalizedX = clampNumber(xRaw, 0, Math.max(0, 1 - normalizedW));
  const normalizedY = clampNumber(yRaw, 0, Math.max(0, 1 - normalizedH));

  const normalized = {
    x: roundNumber(normalizedX, 4),
    y: roundNumber(normalizedY, 4),
    w: roundNumber(normalizedW, 4),
    h: roundNumber(normalizedH, 4),
  };

  if (typeof raw.align === 'string') {
    const align = raw.align.trim().toLowerCase();
    if (CUSTOM_LAYOUT_ALIGN.has(align)) {
      normalized.align = align;
    }
  }

  const fontScaleRaw = toFiniteNumber(raw.font_scale);
  if (fontScaleRaw != null && fontScaleRaw > 0) {
    normalized.font_scale = roundNumber(
      clampNumber(
        fontScaleRaw,
        CUSTOM_LAYOUT_FONT_SCALE_RANGE.min,
        CUSTOM_LAYOUT_FONT_SCALE_RANGE.max
      ),
      3
    );
  }

  const lineHeightRaw = toFiniteNumber(raw.line_height);
  if (lineHeightRaw != null && lineHeightRaw > 0) {
    normalized.line_height = roundNumber(
      clampNumber(
        lineHeightRaw,
        CUSTOM_LAYOUT_LINE_HEIGHT_RANGE.min,
        CUSTOM_LAYOUT_LINE_HEIGHT_RANGE.max
      ),
      3
    );
  }

  if (allowLetterSpacing && raw.letter_spacing !== undefined) {
    const letterSpacingRaw = toFiniteNumber(raw.letter_spacing);
    if (letterSpacingRaw != null) {
      normalized.letter_spacing = roundNumber(
        clampNumber(
          letterSpacingRaw,
          CUSTOM_LAYOUT_LETTER_SPACING_RANGE.min,
          CUSTOM_LAYOUT_LETTER_SPACING_RANGE.max
        ),
        3
      );
    }
  }

  return normalized;
}

function parseLayoutOverrideBox(raw, { allowLetterSpacing = false } = {}) {
  if (raw == null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const normalized = {};
  let hasAny = false;

  if (raw.x !== undefined) {
    const xRaw = toFiniteNumber(raw.x);
    if (xRaw == null || xRaw < 0 || xRaw > 1) {
      return null;
    }
    normalized.x = roundNumber(xRaw, 4);
    hasAny = true;
  }

  if (raw.y !== undefined) {
    const yRaw = toFiniteNumber(raw.y);
    if (yRaw == null || yRaw < 0 || yRaw > 1) {
      return null;
    }
    normalized.y = roundNumber(yRaw, 4);
    hasAny = true;
  }

  if (raw.w !== undefined) {
    const widthRaw = toFiniteNumber(raw.w);
    if (widthRaw == null || widthRaw <= 0 || widthRaw > 1) {
      return null;
    }
    normalized.w = roundNumber(widthRaw, 4);
    hasAny = true;
  }

  if (raw.h !== undefined) {
    const heightRaw = toFiniteNumber(raw.h);
    if (heightRaw == null || heightRaw <= 0 || heightRaw > 1) {
      return null;
    }
    normalized.h = roundNumber(heightRaw, 4);
    hasAny = true;
  }

  if (raw.align !== undefined) {
    const alignRaw =
      typeof raw.align === 'string' ? raw.align.trim().toLowerCase() : '';
    if (!alignRaw || !LAYOUT_ALIGN_VALUES.has(alignRaw)) {
      return null;
    }
    normalized.align = alignRaw;
    hasAny = true;
  }

  if (raw.font_scale !== undefined) {
    const fontScaleRaw = toFiniteNumber(raw.font_scale);
    if (fontScaleRaw == null) {
      return null;
    }
    normalized.font_scale = roundNumber(
      clampNumber(
        fontScaleRaw,
        CUSTOM_LAYOUT_FONT_SCALE_RANGE.min,
        CUSTOM_LAYOUT_FONT_SCALE_RANGE.max
      ),
      3
    );
    hasAny = true;
  }

  if (raw.line_height !== undefined) {
    const lineHeightRaw = toFiniteNumber(raw.line_height);
    if (lineHeightRaw == null) {
      return null;
    }
    normalized.line_height = roundNumber(
      clampNumber(
        lineHeightRaw,
        CUSTOM_LAYOUT_LINE_HEIGHT_RANGE.min,
        CUSTOM_LAYOUT_LINE_HEIGHT_RANGE.max
      ),
      3
    );
    hasAny = true;
  }

  if (allowLetterSpacing && raw.letter_spacing !== undefined) {
    const letterSpacingRaw = toFiniteNumber(raw.letter_spacing);
    if (letterSpacingRaw == null) {
      return null;
    }
    normalized.letter_spacing = roundNumber(
      clampNumber(
        letterSpacingRaw,
        CUSTOM_LAYOUT_LETTER_SPACING_RANGE.min,
        CUSTOM_LAYOUT_LETTER_SPACING_RANGE.max
      ),
      3
    );
    hasAny = true;
  }

  return hasAny ? normalized : null;
}

function resolveLayoutBoxWithOverride(baseBox, overrideBox, { allowLetterSpacing = false } = {}) {
  if (!baseBox) return null;
  if (!overrideBox) {
    return parseLayoutBox(baseBox, {
      required: true,
      allowLetterSpacing,
    });
  }
  return parseLayoutBox(
    {
      ...baseBox,
      ...overrideBox,
    },
    {
      required: true,
      allowLetterSpacing,
    }
  );
}

function resolvePostLayoutPage(parsedLayout, pageIndex = 0) {
  if (!parsedLayout) return null;

  if (Number.parseInt(parsedLayout.layout_version, 10) !== 2) {
    return {
      layout_version: 1,
      unit: LAYOUT_UNIT_NORMALIZED,
      text_box: parsedLayout.text_box,
      ...(parsedLayout.title_box ? { title_box: parsedLayout.title_box } : {}),
      ...(parsedLayout.footer_box ? { footer_box: parsedLayout.footer_box } : {}),
    };
  }

  const safePageIndex = Math.max(0, Number.parseInt(pageIndex, 10) || 0);
  const pageOverride =
    Array.isArray(parsedLayout.pages) && safePageIndex < parsedLayout.pages.length
      ? parsedLayout.pages[safePageIndex]
      : null;

  const resolved = {
    layout_version: 1,
    unit: LAYOUT_UNIT_NORMALIZED,
    text_box: resolveLayoutBoxWithOverride(parsedLayout.base?.text_box, pageOverride?.text_box, {
      allowLetterSpacing: true,
    }),
  };

  const titleBox = resolveLayoutBoxWithOverride(parsedLayout.base?.title_box, pageOverride?.title_box, {
    allowLetterSpacing: true,
  });
  if (titleBox) {
    resolved.title_box = titleBox;
  }

  const footerBox = resolveLayoutBoxWithOverride(parsedLayout.base?.footer_box, pageOverride?.footer_box, {
    allowLetterSpacing: false,
  });
  if (footerBox) {
    resolved.footer_box = footerBox;
  }

  return resolved;
}

function parsePostLayout(rawLayoutJson) {
  // `null` 반환은 "커스텀 레이아웃 미적용" 의미이며, 호출부는 legacy preset을 그대로 사용한다.
  if (rawLayoutJson == null) return null;

  let parsed = rawLayoutJson;
  if (typeof parsed === 'string') {
    const trimmed = parsed.trim();
    if (!trimmed) return null;
    try {
      parsed = JSON.parse(trimmed);
    } catch (_error) {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const version = Number.parseInt(parsed.layout_version, 10);
  if (version !== 1 && version !== 2) {
    return null;
  }

  const unit = Object.prototype.hasOwnProperty.call(parsed, 'unit')
    ? String(parsed.unit || '').trim().toLowerCase()
    : LAYOUT_UNIT_NORMALIZED;
  if (unit !== LAYOUT_UNIT_NORMALIZED) {
    return null;
  }

  if (version === 1) {
    const textBox = parseLayoutBox(parsed.text_box, {
      required: true,
      allowLetterSpacing: true,
    });
    if (!textBox) {
      return null;
    }

    let titleBox = null;
    if (Object.prototype.hasOwnProperty.call(parsed, 'title_box')) {
      titleBox = parseLayoutBox(parsed.title_box, {
        required: false,
        allowLetterSpacing: true,
      });
      if (parsed.title_box != null && !titleBox) {
        return null;
      }
    }

    let footerBox = null;
    if (Object.prototype.hasOwnProperty.call(parsed, 'footer_box')) {
      footerBox = parseLayoutBox(parsed.footer_box, { required: false });
      if (parsed.footer_box != null && !footerBox) {
        return null;
      }
    }

    const normalized = {
      layout_version: 1,
      unit: LAYOUT_UNIT_NORMALIZED,
      text_box: textBox,
    };
    if (titleBox) {
      normalized.title_box = titleBox;
    }
    if (footerBox) {
      normalized.footer_box = footerBox;
    }
    return normalized;
  }

  const base = parsed.base;
  if (!base || typeof base !== 'object' || Array.isArray(base)) {
    return null;
  }

  const baseTextBox = parseLayoutBox(base.text_box, {
    required: true,
    allowLetterSpacing: true,
  });
  if (!baseTextBox) {
    return null;
  }

  let baseTitleBox = null;
  if (Object.prototype.hasOwnProperty.call(base, 'title_box')) {
    baseTitleBox = parseLayoutBox(base.title_box, {
      required: false,
      allowLetterSpacing: true,
    });
    if (base.title_box != null && !baseTitleBox) {
      return null;
    }
  }

  let baseFooterBox = null;
  if (Object.prototype.hasOwnProperty.call(base, 'footer_box')) {
    baseFooterBox = parseLayoutBox(base.footer_box, {
      required: false,
      allowLetterSpacing: false,
    });
    if (base.footer_box != null && !baseFooterBox) {
      return null;
    }
  }

  const rawPages =
    parsed.pages === undefined || parsed.pages === null ? [] : parsed.pages;
  if (!Array.isArray(rawPages)) {
    return null;
  }

  const pages = [];
  for (const pageRaw of rawPages) {
    if (pageRaw == null) {
      pages.push(null);
      continue;
    }
    if (!pageRaw || typeof pageRaw !== 'object' || Array.isArray(pageRaw)) {
      return null;
    }

    const normalizedPage = {};

    if (Object.prototype.hasOwnProperty.call(pageRaw, 'text_box')) {
      if (pageRaw.text_box != null) {
        const textOverride = parseLayoutOverrideBox(pageRaw.text_box, {
          allowLetterSpacing: true,
        });
        if (!textOverride) {
          return null;
        }
        const resolvedText = resolveLayoutBoxWithOverride(baseTextBox, textOverride, {
          allowLetterSpacing: true,
        });
        if (!resolvedText) {
          return null;
        }
        normalizedPage.text_box = textOverride;
      }
    }

    if (Object.prototype.hasOwnProperty.call(pageRaw, 'title_box')) {
      if (pageRaw.title_box != null) {
        const titleOverride = parseLayoutOverrideBox(pageRaw.title_box, {
          allowLetterSpacing: true,
        });
        if (!titleOverride || !baseTitleBox) {
          return null;
        }
        const resolvedTitle = resolveLayoutBoxWithOverride(baseTitleBox, titleOverride, {
          allowLetterSpacing: true,
        });
        if (!resolvedTitle) {
          return null;
        }
        normalizedPage.title_box = titleOverride;
      }
    }

    if (Object.prototype.hasOwnProperty.call(pageRaw, 'footer_box')) {
      if (pageRaw.footer_box != null) {
        const footerOverride = parseLayoutOverrideBox(pageRaw.footer_box, {
          allowLetterSpacing: false,
        });
        if (!footerOverride || !baseFooterBox) {
          return null;
        }
        const resolvedFooter = resolveLayoutBoxWithOverride(baseFooterBox, footerOverride, {
          allowLetterSpacing: false,
        });
        if (!resolvedFooter) {
          return null;
        }
        normalizedPage.footer_box = footerOverride;
      }
    }

    pages.push(Object.keys(normalizedPage).length > 0 ? normalizedPage : null);
  }

  const normalized = {
    layout_version: 2,
    unit: LAYOUT_UNIT_NORMALIZED,
    base: {
      text_box: baseTextBox,
    },
    pages,
  };
  if (baseTitleBox) {
    normalized.base.title_box = baseTitleBox;
  }
  if (baseFooterBox) {
    normalized.base.footer_box = baseFooterBox;
  }

  return normalized;
}

function isCjkChar(ch) {
  return /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af\u3040-\u30ff\u3400-\u9fff]/.test(
    ch
  );
}

function estimateTextWidthPx(text, fontSizePx, letterSpacingEm = 0) {
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

  const charCount = Array.from(str).length;
  const letterSpacingPx = fontSizePx * Number(letterSpacingEm || 0);
  return width + Math.max(0, charCount - 1) * letterSpacingPx;
}

function splitWordByWidth(word, maxWidthPx, fontSizePx, letterSpacingEm = 0) {
  const chunks = [];
  let current = '';

  for (const ch of Array.from(String(word || ''))) {
    const next = `${current}${ch}`;
    if (current && estimateTextWidthPx(next, fontSizePx, letterSpacingEm) > maxWidthPx) {
      chunks.push(current);
      current = ch;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks.length ? chunks : [''];
}

function wrapSingleParagraph(paragraph, maxWidthPx, fontSizePx, letterSpacingEm = 0) {
  const normalized = String(paragraph || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [''];

  const words = normalized.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (estimateTextWidthPx(candidate, fontSizePx, letterSpacingEm) <= maxWidthPx) {
      currentLine = candidate;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = '';
    }

    if (estimateTextWidthPx(word, fontSizePx, letterSpacingEm) <= maxWidthPx) {
      currentLine = word;
      continue;
    }

    const chunks = splitWordByWidth(word, maxWidthPx, fontSizePx, letterSpacingEm);
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

function clampLineWithEllipsis(line, maxWidthPx, fontSizePx, letterSpacingEm = 0) {
  const text = String(line || '');
  const ellipsis = '…';
  if (estimateTextWidthPx(text, fontSizePx, letterSpacingEm) <= maxWidthPx) return text;

  let result = '';
  for (const ch of Array.from(text)) {
    const next = `${result}${ch}`;
    if (estimateTextWidthPx(`${next}${ellipsis}`, fontSizePx, letterSpacingEm) > maxWidthPx) break;
    result = next;
  }

  return `${result}${ellipsis}`;
}

function layoutAllTextLines(text, maxWidthPx, fontSizePx, letterSpacingEm = 0) {
  const paragraphs = String(text || '')
    .split('\n')
    .map((line) => line.trim());

  const lines = [];

  paragraphs.forEach((paragraph, index) => {
    const wrapped = wrapSingleParagraph(paragraph, maxWidthPx, fontSizePx, letterSpacingEm);
    lines.push(...wrapped);
    if (index < paragraphs.length - 1) {
      lines.push('');
    }
  });

  while (lines.length > 1 && !lines[lines.length - 1]) {
    lines.pop();
  }

  return lines.length ? lines : [''];
}

function layoutTextLines(text, maxWidthPx, fontSizePx, maxLines, letterSpacingEm = 0) {
  const lines = layoutAllTextLines(text, maxWidthPx, fontSizePx, letterSpacingEm);

  if (lines.length <= maxLines) return lines;

  const truncated = lines.slice(0, maxLines);
  truncated[maxLines - 1] = clampLineWithEllipsis(
    truncated[maxLines - 1],
    maxWidthPx,
    fontSizePx,
    letterSpacingEm
  );
  return truncated;
}

function paginateTextLines(lines, maxLinesPerPage, pageCap = FEED_IMAGE_PAGE_CAP) {
  const safeLines = Array.isArray(lines) && lines.length > 0 ? lines : [''];
  const pageLines = Math.max(1, Number(maxLinesPerPage) || 1);
  const pages = [];
  let cursor = 0;

  while (cursor < safeLines.length && pages.length < pageCap) {
    pages.push(safeLines.slice(cursor, cursor + pageLines));
    cursor += pageLines;
  }

  if (!pages.length) {
    pages.push(['']);
  }

  return {
    pages,
    pageCount: pages.length,
    isTruncated: cursor < safeLines.length,
    pageCap,
  };
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

function buildRenderVersion({ post, templateKey, scale, renderMode }) {
  const payload = JSON.stringify({
    render_version: RENDER_VERSION,
    template: templateKey,
    scale,
    render_mode: normalizeRenderMode(renderMode),
    post_id: post?.id,
    title: post?.title || '',
    content: post?.content || '',
    created_at: post?.created_at || '',
    layout_json: post?.layout_json || '',
  });

  return crypto.createHash('sha1').update(payload).digest('hex');
}

function buildCacheHash({ post, templateKey, scale, renderMode, page = 1 }) {
  const renderVersion = buildRenderVersion({ post, templateKey, scale, renderMode });
  const payload = JSON.stringify({
    render_version: renderVersion,
    page: Math.max(1, Number.parseInt(page, 10) || 1),
  });

  return crypto.createHash('sha1').update(payload).digest('hex');
}

function buildSvgTextOverlay({
  width,
  height,
  lines,
  box,
  fontSizePx,
  lineHeightPx,
  letterSpacingEm = 0,
  textAlign = 'left',
  verticalAlign = 'top',
  title = null,
  footerSignature = '',
}) {
  const safeBox = box || { x: 0, y: 0, width, height };
  const bodyGroup = buildSvgTextGroup({
    clipId: 'feed-text-box',
    box: safeBox,
    lines,
    textAlign,
    verticalAlign,
    fontSizePx,
    lineHeightPx,
    letterSpacingEm,
    clipPadTopPx: Math.round(safeBox.height * TEXT_CLIP_TOP_PADDING_RATIO),
    clipPadBottomPx: Math.round(safeBox.height * TEXT_CLIP_BOTTOM_PADDING_RATIO),
  });

  const defs = [bodyGroup.defs];
  const groups = [bodyGroup.group];

  if (title && title.box && Array.isArray(title.lines)) {
    const titleGroup = buildSvgTextGroup({
      clipId: 'feed-title-box',
      box: title.box,
      lines: title.lines,
      textAlign: title.textAlign || 'left',
      verticalAlign: title.verticalAlign || 'top',
      fontSizePx: title.fontSizePx || fontSizePx,
      lineHeightPx: title.lineHeightPx || lineHeightPx,
      letterSpacingEm: title.letterSpacingEm || 0,
      clipPadTopPx: Math.round((title.box.height || safeBox.height) * TEXT_CLIP_TOP_PADDING_RATIO),
      clipPadBottomPx: Math.round((title.box.height || safeBox.height) * TEXT_CLIP_BOTTOM_PADDING_RATIO),
    });
    defs.push(titleGroup.defs);
    groups.push(titleGroup.group);
  }

  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    ${defs.join('\n    ')}
  </defs>
  ${groups.join('\n  ')}
  ${footerSignature || ''}
</svg>
  `.trim();
}

function resolveFeedBoxFromPreset(width, height, preset) {
  const boxX = Math.round(width * preset.leftPct);
  const boxY = Math.round(height * preset.topPct);
  const boxWidth = Math.max(1, Math.round(width * preset.widthPct));
  const boxHeight = Math.max(1, height - boxY - Math.round(height * preset.bottomPct));
  return {
    x: boxX,
    y: boxY,
    width: boxWidth,
    height: boxHeight,
  };
}

function resolveBoxFromPreset(width, height, boxPreset) {
  const boxX = Math.round(width * boxPreset.leftPct);
  const boxY = Math.round(height * boxPreset.topPct);
  const boxWidth = Math.max(1, Math.round(width * boxPreset.widthPct));
  const boxHeight = Math.max(1, Math.round(height * boxPreset.heightPct));
  return {
    x: boxX,
    y: boxY,
    width: boxWidth,
    height: boxHeight,
  };
}

function resolveBoxFromNormalizedLayout(width, height, textBox = {}) {
  const normalizedW = clampNumber(
    toFiniteNumber(textBox.w) || CUSTOM_LAYOUT_MIN_BOX_SIZE,
    CUSTOM_LAYOUT_MIN_BOX_SIZE,
    1
  );
  const normalizedH = clampNumber(
    toFiniteNumber(textBox.h) || CUSTOM_LAYOUT_MIN_BOX_SIZE,
    CUSTOM_LAYOUT_MIN_BOX_SIZE,
    1
  );
  const normalizedX = clampNumber(
    toFiniteNumber(textBox.x) || 0,
    0,
    Math.max(0, 1 - normalizedW)
  );
  const normalizedY = clampNumber(
    toFiniteNumber(textBox.y) || 0,
    0,
    Math.max(0, 1 - normalizedH)
  );

  const box = {
    x: Math.round(width * normalizedX),
    y: Math.round(height * normalizedY),
    width: Math.max(1, Math.round(width * normalizedW)),
    height: Math.max(1, Math.round(height * normalizedH)),
  };

  if (box.x + box.width > width) {
    box.x = Math.max(0, width - box.width);
  }
  if (box.y + box.height > height) {
    box.y = Math.max(0, height - box.height);
  }

  return box;
}

function resolveFittedMaxLines(boxHeightPx, lineHeightPx, presetMaxLines) {
  const fitted = Math.max(1, Math.floor(boxHeightPx / Math.max(1, lineHeightPx)));
  const normalizedPreset = Math.max(1, Number(presetMaxLines) || 1);
  return Math.max(1, Math.min(fitted, normalizedPreset));
}

function resolveBodyPageMaxLines(boxHeightPx, lineHeightPx, presetMaxLines = null) {
  const fitted = Math.max(1, Math.floor(boxHeightPx / Math.max(1, lineHeightPx)));
  if (presetMaxLines == null) {
    return fitted;
  }
  return resolveFittedMaxLines(boxHeightPx, lineHeightPx, presetMaxLines);
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
  letterSpacingEm = 0,
  clipPadTopPx = 0,
  clipPadBottomPx = 0,
}) {
  const safeLines = Array.isArray(lines) && lines.length > 0 ? lines : [' '];
  const rawTextBlockHeight = lineHeightPx * safeLines.length;
  const shouldCenter = verticalAlign === 'center';
  const isCenterText = textAlign === 'center';
  const isRightText = textAlign === 'right';
  const textX = isCenterText ? box.x + box.width / 2 : isRightText ? box.x + box.width : box.x;
  const textAnchor = isCenterText ? 'middle' : isRightText ? 'end' : 'start';
  const topOffset = shouldCenter
    ? Math.max(0, (box.height - rawTextBlockHeight) / 2)
    : 0;
  const firstBaselineY = box.y + topOffset + fontSizePx;
  const clipY = Math.max(0, box.y - Math.max(0, clipPadTopPx));
  const clipHeight = Math.max(
    1,
    box.height + Math.max(0, clipPadTopPx) + Math.max(0, clipPadBottomPx)
  );

  const tspans = safeLines
    .map((line, index) => {
      const y = firstBaselineY + index * lineHeightPx;
      const safeText = line ? escapeXml(line) : ' ';
      return `<tspan x="${Math.round(textX * 100) / 100}" y="${Math.round(y * 100) / 100}">${safeText}</tspan>`;
    })
    .join('');

  return {
    defs: `<clipPath id="${clipId}"><rect x="${box.x}" y="${clipY}" width="${box.width}" height="${clipHeight}" /></clipPath>`,
    group: `
  <g clip-path="url(#${clipId})">
    <text
      fill="${color}"
      font-family="${fontFamily}"
      font-size="${Math.round(fontSizePx * 100) / 100}"
      font-weight="${fontWeight}"
      text-anchor="${textAnchor}"
      letter-spacing="${roundNumber(letterSpacingEm, 3)}em"
      text-rendering="optimizeLegibility"
    >
      ${tspans}
    </text>
  </g>
    `.trim(),
  };
}

function buildSvgBrandSignature({
  width,
  height,
  footerBox = null,
  textAlign = 'center',
  fontScale = 1,
  lineHeightRatio = 1.1,
}) {
  const normalizedScale = Number.isFinite(Number(fontScale)) && Number(fontScale) > 0
    ? Number(fontScale)
    : 1;
  const normalizedLineHeightRatio =
    Number.isFinite(Number(lineHeightRatio)) && Number(lineHeightRatio) > 0
      ? Number(lineHeightRatio)
      : 1.1;
  const baseFontSizePx = Math.max(15, Math.round(width * 0.025));
  const fontSizePx = Math.max(12, baseFontSizePx * normalizedScale);
  const lineHeightPx = fontSizePx * normalizedLineHeightRatio;

  let textAnchor = 'middle';
  let textX = Math.round(width / 2);
  let textY = Math.round(height - Math.max(24, Math.round(height * 0.035)));

  if (footerBox) {
    const align = String(textAlign || '').trim().toLowerCase();
    if (align === 'left') {
      textAnchor = 'start';
      textX = footerBox.x;
    } else if (align === 'right') {
      textAnchor = 'end';
      textX = footerBox.x + footerBox.width;
    } else {
      textAnchor = 'middle';
      textX = footerBox.x + footerBox.width / 2;
    }

    const topOffset = Math.max(0, (footerBox.height - lineHeightPx) / 2);
    const baseline = footerBox.y + topOffset + fontSizePx;
    const maxBaseline = footerBox.y + footerBox.height - 2;
    textY = Math.max(footerBox.y + fontSizePx, Math.min(baseline, maxBaseline));
  }

  return `
  <g aria-label="brand-signature">
    <text
      x="${textX}"
      y="${textY}"
      fill="rgba(71, 63, 54, ${SHARE_SIGNATURE_OPACITY})"
      font-family="${SVG_FONT_FAMILY}"
      font-size="${Math.round(fontSizePx * 100) / 100}"
      font-weight="500"
      letter-spacing="0.04em"
      text-anchor="${textAnchor}"
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
  bodyLetterSpacingEm = 0,
  titleBoxOverride = null,
  titleTextAlignOverride = '',
  titleFontSizeOverridePx = null,
  titleLineHeightOverridePx = null,
  titleLetterSpacingEm = 0,
  bodyBoxOverride = null,
  bodyTextAlignOverride = '',
  brandSignatureOverride = '',
}) {
  const titleBox = titleBoxOverride || resolveBoxFromPreset(width, height, layoutPreset.title);
  const bodyBox = bodyBoxOverride || resolveBoxFromPreset(width, height, layoutPreset.body);

  const titleGroup = buildSvgTextGroup({
    clipId: 'share-title-box',
    box: titleBox,
    lines: titleLines,
    textAlign: titleTextAlignOverride || layoutPreset.title.textAlign,
    verticalAlign: layoutPreset.title.verticalAlign,
    fontSizePx: titleFontSizeOverridePx || fontSizePx,
    lineHeightPx: titleLineHeightOverridePx || lineHeightPx,
    letterSpacingEm: titleLetterSpacingEm,
    clipPadTopPx: Math.round(titleBox.height * TEXT_CLIP_TOP_PADDING_RATIO),
    clipPadBottomPx: Math.round(titleBox.height * TEXT_CLIP_BOTTOM_PADDING_RATIO),
  });

  const bodyGroup = buildSvgTextGroup({
    clipId: 'share-body-box',
    box: bodyBox,
    lines: bodyLines,
    textAlign: bodyTextAlignOverride || layoutPreset.body.textAlign,
    verticalAlign: layoutPreset.body.verticalAlign,
    fontSizePx,
    lineHeightPx,
    letterSpacingEm: bodyLetterSpacingEm,
    clipPadTopPx: Math.round(bodyBox.height * TEXT_CLIP_TOP_PADDING_RATIO),
    clipPadBottomPx: Math.round(bodyBox.height * TEXT_CLIP_BOTTOM_PADDING_RATIO),
  });

  const brandSignature = brandSignatureOverride || buildSvgBrandSignature({ width, height });

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

function buildFeedModeRenderPlan({
  post,
  outputWidth,
  outputHeight,
  scale,
}) {
  const titleText = normalizePostText(post?.title) || '';
  const bodyText = normalizePostText(post?.content) || titleText || ' ';
  const presetKey = selectLengthPreset(bodyText.length);
  const preset = LAYOUT_PRESETS[presetKey];
  const parsedLayout = parsePostLayout(post?.layout_json);
  const firstPageLayout = resolvePostLayoutPage(parsedLayout, 0);
  const customBodyBox = firstPageLayout?.text_box || null;
  const customTitleBox = firstPageLayout?.title_box || null;
  const customFooterBox = firstPageLayout?.footer_box || null;
  const hasCustomBodyLayout = !!customBodyBox;
  const hasCustomTitleLayout = !!customTitleBox;
  const hasCustomFooterLayout = !!customFooterBox;
  const shouldRenderTitleInImage = hasCustomTitleLayout && Boolean(titleText);
  const bodyFontScale = customBodyBox?.font_scale || 1;
  const bodyLineHeightRatio = customBodyBox?.line_height || preset.lineHeightRatio;
  const bodyLetterSpacingEm = customBodyBox?.letter_spacing || 0;
  const minFontSizePx = scale === 2 ? 20 : 12;
  let effectivePreset = preset;
  let fontSizePx = Math.max(
    minFontSizePx,
    outputWidth * preset.fontSizeRatio * bodyFontScale
  );
  let lineHeightPx = fontSizePx * bodyLineHeightRatio;
  let box = hasCustomBodyLayout
    ? resolveBoxFromNormalizedLayout(outputWidth, outputHeight, customBodyBox)
    : resolveFeedBoxFromPreset(outputWidth, outputHeight, effectivePreset);
  let pageMaxLines = hasCustomBodyLayout
    ? resolveBodyPageMaxLines(box.height, lineHeightPx)
    : resolveBodyPageMaxLines(box.height, lineHeightPx, effectivePreset.maxLines);
  let allLines = layoutAllTextLines(
    bodyText,
    Math.max(20, box.width),
    fontSizePx,
    bodyLetterSpacingEm
  );

  if (!hasCustomBodyLayout) {
    const nonEmptyLineCount = allLines.filter(
      (line) => String(line || '').trim().length > 0
    ).length;
    if (nonEmptyLineCount <= 1) {
      effectivePreset = {
        ...preset,
        topPct: 0.34,
        leftPct: 0.26,
        widthPct: 0.48,
        bottomPct: 0.34,
        textAlign: 'center',
        verticalAlign: 'center',
      };
      fontSizePx = Math.max(
        minFontSizePx,
        outputWidth * effectivePreset.fontSizeRatio * bodyFontScale
      );
      lineHeightPx = fontSizePx * bodyLineHeightRatio;
      box = resolveFeedBoxFromPreset(outputWidth, outputHeight, effectivePreset);
      pageMaxLines = resolveBodyPageMaxLines(
        box.height,
        lineHeightPx,
        effectivePreset.maxLines
      );
      allLines = layoutAllTextLines(
        bodyText,
        Math.max(20, box.width),
        fontSizePx,
        bodyLetterSpacingEm
      );
    }
  }

  const pagination = hasCustomBodyLayout
    ? paginateTextLines(allLines, pageMaxLines, FEED_IMAGE_PAGE_CAP)
    : {
        pages: [
          layoutTextLines(
            bodyText,
            Math.max(20, box.width),
            fontSizePx,
            pageMaxLines,
            bodyLetterSpacingEm
          ),
        ],
        pageCount: 1,
        isTruncated: allLines.length > pageMaxLines,
        pageCap: FEED_IMAGE_PAGE_CAP,
      };

  return {
    pageCount: pagination.pageCount,
    pageCap: pagination.pageCap,
    isTruncated: pagination.isTruncated,
    pages: pagination.pages,
    parsedLayout,
    presetKey,
    preset,
    effectivePreset,
    titleText,
    shouldRenderTitleInImage,
    hasCustomBodyLayout,
    hasCustomFooterLayout,
    box,
    fontSizePx,
    lineHeightPx,
    minFontSizePx,
    bodyLineHeightRatio,
    bodyFontScale,
    bodyLetterSpacingEm,
    bodyFontSizeRatio: hasCustomBodyLayout
      ? preset.fontSizeRatio
      : effectivePreset.fontSizeRatio,
    textAlign: customBodyBox?.align || effectivePreset.textAlign,
    verticalAlign: effectivePreset.verticalAlign,
    layoutTag: `${hasCustomBodyLayout ? 'custom' : 'preset'}-${presetKey}${
      shouldRenderTitleInImage ? '-with-title' : ''
    }${hasCustomFooterLayout ? '-with-footer' : ''}`,
  };
}

async function renderFeedModePageBuffer({
  post,
  template,
  outputWidth,
  outputHeight,
  scale,
  page = 1,
}) {
  const plan = buildFeedModeRenderPlan({
    post,
    outputWidth,
    outputHeight,
    scale,
  });
  const normalizedPage = Math.max(1, Number.parseInt(page, 10) || 1);
  const pageIndex = Math.min(normalizedPage, plan.pageCount) - 1;
  const pageLines = plan.pages[pageIndex] || plan.pages[0] || [''];
  const resolvedPageLayout = resolvePostLayoutPage(plan.parsedLayout, pageIndex);
  const resolvedBodyLayout = resolvedPageLayout?.text_box || null;
  const bodyBox = resolvedBodyLayout
    ? resolveBoxFromNormalizedLayout(outputWidth, outputHeight, resolvedBodyLayout)
    : plan.box;
  const pageBodyFontScale = resolvedBodyLayout?.font_scale || plan.bodyFontScale || 1;
  const pageBodyLineHeightRatio =
    resolvedBodyLayout?.line_height || plan.bodyLineHeightRatio || 1.15;
  const pageBodyLetterSpacingEm =
    resolvedBodyLayout?.letter_spacing || plan.bodyLetterSpacingEm || 0;
  const pageFontSizePx = Math.max(
    plan.minFontSizePx,
    outputWidth * plan.bodyFontSizeRatio * pageBodyFontScale
  );
  const pageLineHeightPx = pageFontSizePx * pageBodyLineHeightRatio;

  let titleConfig = null;
  if (pageIndex === 0 && plan.shouldRenderTitleInImage) {
    const resolvedTitleLayout = resolvedPageLayout?.title_box || null;
    if (resolvedTitleLayout) {
      const titlePreset =
        FEED_TITLE_BOX_PRESETS[plan.presetKey] || FEED_TITLE_BOX_PRESETS.medium;
      const titleBox = resolveBoxFromNormalizedLayout(
        outputWidth,
        outputHeight,
        resolvedTitleLayout
      );
      const titleFontScale = resolvedTitleLayout?.font_scale || 1;
      const titleLineHeightRatio =
        resolvedTitleLayout?.line_height || pageBodyLineHeightRatio;
      const titleLetterSpacingEm = resolvedTitleLayout?.letter_spacing || 0;
      const titleBaseFontSize = Math.max(
        plan.minFontSizePx,
        outputWidth * plan.preset.fontSizeRatio * 0.9
      );
      const titleFontSizePx = Math.max(
        plan.minFontSizePx,
        titleBaseFontSize * titleFontScale
      );
      const titleLineHeightPx = titleFontSizePx * titleLineHeightRatio;
      const titleMaxLines = resolveFittedMaxLines(
        titleBox.height,
        titleLineHeightPx,
        titlePreset.maxLines || 2
      );
      const titleLines = layoutTextLines(
        plan.titleText,
        Math.max(20, titleBox.width),
        titleFontSizePx,
        titleMaxLines,
        titleLetterSpacingEm
      );

      titleConfig = {
        box: titleBox,
        lines: titleLines,
        textAlign: resolvedTitleLayout?.align || titlePreset.textAlign,
        verticalAlign: titlePreset.verticalAlign,
        fontSizePx: titleFontSizePx,
        lineHeightPx: titleLineHeightPx,
        letterSpacingEm: titleLetterSpacingEm,
      };
    }
  }

  let footerSignature = '';
  if (plan.hasCustomFooterLayout && resolvedPageLayout?.footer_box) {
    const footerBox = resolveBoxFromNormalizedLayout(
      outputWidth,
      outputHeight,
      resolvedPageLayout.footer_box
    );
    footerSignature = buildSvgBrandSignature({
      width: outputWidth,
      height: outputHeight,
      footerBox,
      textAlign: resolvedPageLayout.footer_box?.align || 'center',
      fontScale: resolvedPageLayout.footer_box?.font_scale || 1,
      lineHeightRatio: resolvedPageLayout.footer_box?.line_height || 1.1,
    });
  }

  const svgOverlay = buildSvgTextOverlay({
    width: outputWidth,
    height: outputHeight,
    lines: pageLines,
    box: bodyBox,
    fontSizePx: pageFontSizePx,
    lineHeightPx: pageLineHeightPx,
    letterSpacingEm: pageBodyLetterSpacingEm,
    textAlign: resolvedBodyLayout?.align || plan.textAlign,
    verticalAlign: plan.verticalAlign,
    title: titleConfig,
    footerSignature,
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
    layout: `${plan.layoutTag}-page-${pageIndex + 1}of${plan.pageCount}${
      plan.isTruncated ? '-truncated' : ''
    }`,
    manifest: {
      pageCount: plan.pageCount,
      pageCap: plan.pageCap,
      isTruncated: plan.isTruncated,
    },
  };
}

async function renderFeedModeImageBuffer({
  post,
  template,
  outputWidth,
  outputHeight,
  scale,
  page = 1,
}) {
  return renderFeedModePageBuffer({
    post,
    template,
    outputWidth,
    outputHeight,
    scale,
    page,
  });
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
  const parsedLayout = parsePostLayout(post?.layout_json);
  const customBodyBox = parsedLayout?.text_box || null;
  const customTitleBox = parsedLayout?.title_box || null;
  const customFooterBox = parsedLayout?.footer_box || null;
  const hasCustomBodyLayout = !!customBodyBox;
  const hasCustomTitleLayout = !!customTitleBox;
  const hasCustomFooterLayout = !!customFooterBox;
  const fontScale = customBodyBox?.font_scale || 1;
  const lineHeightRatio = customBodyBox?.line_height || layoutPreset.lineHeightRatio;
  const bodyLetterSpacingEm = customBodyBox?.letter_spacing || 0;
  const minFontSizePx = scale === 2 ? 20 : 12;
  const bodyFontSizePx = Math.max(
    minFontSizePx,
    outputWidth * layoutPreset.fontSizeRatio * fontScale
  );
  const bodyLineHeightPx = bodyFontSizePx * lineHeightRatio;
  const titleFontScale = customTitleBox?.font_scale || 1;
  const titleLineHeightRatio = customTitleBox?.line_height || lineHeightRatio;
  const titleLetterSpacingEm = customTitleBox?.letter_spacing || 0;
  const titleFontSizePx = Math.max(
    minFontSizePx,
    outputWidth * layoutPreset.fontSizeRatio * 0.9 * titleFontScale
  );
  const titleLineHeightPx = titleFontSizePx * titleLineHeightRatio;

  const titleBox = hasCustomTitleLayout
    ? resolveBoxFromNormalizedLayout(outputWidth, outputHeight, customTitleBox)
    : resolveBoxFromPreset(outputWidth, outputHeight, layoutPreset.title);
  const bodyBox = hasCustomBodyLayout
    ? resolveBoxFromNormalizedLayout(outputWidth, outputHeight, customBodyBox)
    : resolveBoxFromPreset(outputWidth, outputHeight, layoutPreset.body);
  const footerBox = hasCustomFooterLayout
    ? resolveBoxFromNormalizedLayout(outputWidth, outputHeight, customFooterBox)
    : null;
  const titleMaxLines = resolveFittedMaxLines(
    titleBox.height,
    titleLineHeightPx,
    layoutPreset.title.maxLines
  );
  const bodyMaxLines = resolveFittedMaxLines(
    bodyBox.height,
    bodyLineHeightPx,
    hasCustomBodyLayout ? Math.max(layoutPreset.body.maxLines, 24) : layoutPreset.body.maxLines
  );

  const titleLines = layoutTextLines(
    titleText,
    Math.max(20, titleBox.width),
    titleFontSizePx,
    titleMaxLines,
    titleLetterSpacingEm
  );
  const bodyLines = layoutTextLines(
    bodyText,
    Math.max(20, bodyBox.width),
    bodyFontSizePx,
    bodyMaxLines,
    bodyLetterSpacingEm
  );

  const brandSignatureOverride = hasCustomFooterLayout
    ? buildSvgBrandSignature({
      width: outputWidth,
      height: outputHeight,
      footerBox,
      textAlign: customFooterBox?.align || 'center',
      fontScale: customFooterBox?.font_scale || 1,
      lineHeightRatio: customFooterBox?.line_height || 1.1,
    })
    : '';

  const svgOverlay = buildSvgShareOverlay({
    width: outputWidth,
    height: outputHeight,
    titleLines,
    bodyLines,
    layoutPreset,
    fontSizePx: bodyFontSizePx,
    lineHeightPx: bodyLineHeightPx,
    bodyLetterSpacingEm,
    titleBoxOverride: hasCustomTitleLayout ? titleBox : null,
    titleTextAlignOverride: customTitleBox?.align || '',
    titleFontSizeOverridePx: titleFontSizePx,
    titleLineHeightOverridePx: titleLineHeightPx,
    titleLetterSpacingEm,
    bodyBoxOverride: hasCustomBodyLayout ? bodyBox : null,
    bodyTextAlignOverride: customBodyBox?.align || '',
    brandSignatureOverride,
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
    layout: `share-${layoutKey}${hasCustomBodyLayout ? '-custom-body' : ''}${hasCustomTitleLayout ? '-custom-title' : ''}${hasCustomFooterLayout ? '-custom-footer' : ''}`,
  };
}

async function renderFeedImageBuffer({
  post,
  templateKey = 'paper01',
  scale = 1,
  renderMode = 'feed',
  page = 1,
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
      page: 1,
    });
  }

  return renderFeedModeImageBuffer({
    post,
    template,
    outputWidth,
    outputHeight,
    scale,
    page,
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

async function getFeedCardImageManifest({
  post,
  templateKey = 'paper01',
  scale = 1,
}) {
  const normalizedTemplate = normalizeTemplateKey(templateKey);
  const normalizedScale = normalizeScale(scale);
  const template = TEMPLATE_CONFIG[normalizedTemplate] || TEMPLATE_CONFIG.paper01;
  const { width, height } = await getTemplateMetadata(template.filePath);
  const outputWidth = normalizedScale === 2 ? width * 2 : width;
  const outputHeight = normalizedScale === 2 ? height * 2 : height;
  const plan = buildFeedModeRenderPlan({
    post,
    outputWidth,
    outputHeight,
    scale: normalizedScale,
  });

  return {
    pageCount: plan.pageCount,
    pageCap: plan.pageCap,
    isTruncated: plan.isTruncated,
    template: normalizedTemplate,
    scale: normalizedScale,
    version: buildRenderVersion({
      post,
      templateKey: normalizedTemplate,
      scale: normalizedScale,
      renderMode: 'feed',
    }),
  };
}

async function renderFeedCardImage({
  post,
  templateKey,
  scale,
  renderMode = 'feed',
  page = 1,
}) {
  const normalizedTemplate = normalizeTemplateKey(templateKey);
  const normalizedScale = normalizeScale(scale);
  const normalizedRenderMode = normalizeRenderMode(renderMode);
  const normalizedPage = Math.max(1, Number.parseInt(page, 10) || 1);
  const cacheHash = buildCacheHash({
    post,
    templateKey: normalizedTemplate,
    scale: normalizedScale,
    renderMode: normalizedRenderMode,
    page: normalizedPage,
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
      page: normalizedPage,
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
      page: normalizedPage,
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
      page: normalizedPage,
      manifest: rendered.manifest || null,
    };
  })().finally(() => {
    inFlightRenders.delete(inflightKey);
  });

  inFlightRenders.set(inflightKey, renderPromise);
  return renderPromise;
}

module.exports = {
  buildRenderVersion,
  getFeedCardImageManifest,
  renderFeedCardImage,
  normalizeScale,
  normalizeTemplateKey,
  normalizePostText,
  parsePostLayout,
};
