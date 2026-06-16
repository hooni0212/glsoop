// routes/postRoutes.js
// - 글 CRUD, 피드, 추천, 좋아요, 해시태그 필터 관련 API 집합

// ================== 1. 글 작성/수정/삭제 ==================
// POST   /api/posts
// PUT    /api/posts/:id
// DELETE /api/posts/:id

// ================== 2. 내 글 / 공감한 글 ==================
// GET /api/posts/my
// GET /api/posts/liked

// ================== 3. 피드 & 관련 글 ==================
// GET /api/posts/feed
// GET /api/posts/:id/related

// ================== 4. 글 상세 & 좋아요 ==================
// GET  /api/posts/:id           (공개 상세)
// GET  /api/posts/:id/edit      (편집용 조회 - 작성자 전용)
// POST /api/posts/:id/toggle-like

const express = require('express');

const db = require('../db');
const { authRequired, authOptional } = require('../middleware/auth');
const { saveHashtagsForPostFromInput } = require('../utils/hashtags');
const { handlePostCreated, handleLikeAdded } = require('../utils/growth-service');
const { completePromptPostQuest, QuestContextError } = require('../utils/questService');
const { ACTIVITY_TYPES, createActivityEvent } = require('../utils/activityEvents');
const { logUxEvent } = require('../utils/uxEvents');
const { sanitizeForStorage } = require('../utils/sanitize');
const { buildPublicDisplayName, normalizePublicPostAuthor } = require('../utils/accountLifecycle');
const { normalizeUtcDateTime } = require('../utils/dateTime');
const {
  decoratePostRowsWithRenderImages,
  decoratePostWithRenderImages,
} = require('../utils/postRenderImages');
const { normalizeTemplateKey } = require('../utils/feedImageRenderer');
const {
  appendViewerBlockedAuthorCondition,
  createSafetyReport,
  getActiveUserSummary,
  getPostSafetySummary,
  isSafetyValidationError,
  parseSafetyRequestPayload,
} = require('../utils/safety');
const {
  buildWritingEventContext,
  getWritingEventDefinition,
} = require('../utils/dailyWritingCampaign');

const ALLOWED_CATEGORIES = ['poem', 'essay', 'short'];
const ALLOWED_VISIBILITIES = ['public', 'followers', 'unlisted', 'private'];
const ALLOWED_COMMENT_POLICIES = ['everyone', 'logged_in', 'followers', 'author_only', 'closed'];
const ALLOWED_LAYOUT_ALIGN = new Set(['left', 'center', 'right']);
const LAYOUT_UNIT_NORMALIZED = 'normalized';
const LAYOUT_VALIDATION_ERROR_MESSAGE = '레이아웃 데이터가 올바르지 않습니다.';
const LAYOUT_FONT_SCALE_RANGE = { min: 0.7, max: 2.0 };
const LAYOUT_LINE_HEIGHT_RANGE = { min: 1.0, max: 2.2 };
const LAYOUT_LETTER_SPACING_RANGE = { min: -0.04, max: 0.08 };
const CONTENT_PAGE_MAX_COUNT = 8;
const CONTENT_PAGE_MAX_CHARS = 1000;
const CONTENT_PAGE_MAX_TOTAL_CHARS = 8000;
const FONT_META_REGEX = /<!--\s*FONT:(serif|sans|hand)\s*-->/i;
const DEFAULT_LAYOUT_TITLE_BOX = {
  x: 0.336,
  y: 0.256,
  w: 0.424,
  h: 0.122,
  align: 'center',
  font_scale: 1,
  line_height: 1.15,
};
const CATEGORY_SQL =
  "CASE WHEN p.category IN ('poem','essay','short') THEN p.category ELSE 'short' END";
const VISIBILITY_SQL = "COALESCE(p.visibility, 'public')";
const COMMENT_POLICY_SQL = "COALESCE(p.comment_policy, 'logged_in')";

const DEFAULT_GENRES = [
  { slug: 'poem', name: '시', group_name: 'genre', description: '짧고 밀도 있는 시를 모아 읽어요.', sort_order: 10 },
  { slug: 'essay', name: '에세이', group_name: 'genre', description: '생각과 이야기가 담긴 산문을 읽어요.', sort_order: 20 },
  { slug: 'short', name: '짧은글', group_name: 'genre', description: '한 화면 안에서 읽기 좋은 글이에요.', sort_order: 30 },
  { slug: 'comfort', name: '위로', group_name: 'mood', description: '마음을 다독이는 글이에요.', sort_order: 40 },
  { slug: 'dawn', name: '새벽', group_name: 'mood', description: '조용한 시간대의 감성을 담은 글이에요.', sort_order: 50 },
  { slug: 'relay', name: '릴레이', group_name: 'participation', description: '이어쓰기와 협업 글을 모아요.', sort_order: 60 },
];

function parseCategory(input) {
  const value = typeof input === 'string' ? input.trim() : '';
  return ALLOWED_CATEGORIES.includes(value) ? value : null;
}

function coalesceCategory(input) {
  return parseCategory(input) || 'short';
}

function requireValidCategory(input, res) {
  const parsed = parseCategory(input);
  if (!parsed) {
    if (res) {
      res.status(400).json({
        ok: false,
        message: '카테고리를 선택해주세요. (시/에세이/짧은 구절)',
      });
    }
    return null;
  }
  return parsed;
}

function normalizeVisibility(input) {
  const value = typeof input === 'string' ? input.trim().toLowerCase() : '';
  return ALLOWED_VISIBILITIES.includes(value) ? value : 'public';
}

function normalizeCommentPolicy(input) {
  const value = typeof input === 'string' ? input.trim().toLowerCase() : '';
  return ALLOWED_COMMENT_POLICIES.includes(value) ? value : 'logged_in';
}

function parseGenreSlug(input) {
  const value = typeof input === 'string' ? input.trim().toLowerCase() : '';
  return value.replace(/[^a-z0-9_-]/g, '').slice(0, 40);
}

function appendFeedVisibilityCondition(conditions, params, userId, feedType) {
  if (feedType === 'following' && userId) {
    conditions.push(`${VISIBILITY_SQL} IN ('public', 'followers')`);
    return;
  }

  conditions.push(`${VISIBILITY_SQL} = 'public'`);
}

async function canViewerReadPost({ viewerId, post }) {
  if (!post) return false;
  const visibility = normalizeVisibility(post.visibility);
  const authorId = Number(post.author_id || post.user_id);
  const userId = Number(viewerId || 0);

  if (visibility === 'public' || visibility === 'unlisted') return true;
  if (userId && userId === authorId) return true;
  if (visibility === 'private') return false;
  if (visibility === 'followers' && userId) {
    const follow = await dbGetAsync(
      'SELECT 1 AS present FROM follows WHERE follower_id = ? AND followee_id = ? LIMIT 1',
      [userId, authorId]
    );
    return Boolean(follow?.present);
  }

  return false;
}

async function canViewerCommentOnPost({ viewerId, post }) {
  if (!viewerId || !post) return false;
  const readable = await canViewerReadPost({ viewerId, post });
  if (!readable) return false;

  const policy = normalizeCommentPolicy(post.comment_policy);
  const authorId = Number(post.author_id || post.user_id);
  const userId = Number(viewerId);

  if (policy === 'closed') return false;
  if (policy === 'author_only') return userId === authorId;
  if (policy === 'followers') {
    if (userId === authorId) return true;
    const follow = await dbGetAsync(
      'SELECT 1 AS present FROM follows WHERE follower_id = ? AND followee_id = ? LIMIT 1',
      [userId, authorId]
    );
    return Boolean(follow?.present);
  }

  return true;
}

function parsePagination(query = {}) {
  let limit = parseInt(query.limit, 10);
  let offset = parseInt(query.offset, 10);

  if (Number.isNaN(limit) || limit <= 0 || limit > 50) {
    limit = 20;
  }
  if (Number.isNaN(offset) || offset < 0) {
    offset = 0;
  }

  return { limit, offset };
}

function normalizeRecommendationSeed(value) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.abs(parsed) % 1000000;
}

function parseExcludedPostIds(value) {
  const rawValues = (Array.isArray(value) ? value : [value])
    .flatMap((raw) => String(raw || '').split(','));
  const ids = [];
  const seen = new Set();

  for (const raw of rawValues) {
    const parsed = parseId(raw);
    if (!parsed || seen.has(parsed)) continue;
    seen.add(parsed);
    ids.push(parsed);
    if (ids.length >= 100) break;
  }

  return ids;
}

function buildFeedOrderClause(sort, seed = 0) {
  if (sort === 'popular') {
    return 'ORDER BY like_count DESC, p.created_at DESC';
  }

  if (sort === 'recommended') {
    const safeSeed = normalizeRecommendationSeed(seed);
    const seedOffset = (safeSeed * 7919 + 104729) % 1000000;
    const jitter = `ABS(((p.id * 1103515245 + ${seedOffset}) % 9973)) / 9973.0`;
    const ageSeconds = "(strftime('%s', 'now') - strftime('%s', p.created_at))";
    const recencyBoost = `
      CASE
        WHEN ${ageSeconds} BETWEEN 0 AND 604800
          THEN (604800 - ${ageSeconds}) / 86400.0
        ELSE 0
      END
    `;

    return `
      ORDER BY
        (
          IFNULL(lc.like_count, 0) * 10
          + ${recencyBoost}
          + (${jitter}) * 4
        ) DESC,
        p.created_at DESC,
        p.id DESC
    `;
  }

  return 'ORDER BY p.created_at DESC';
}

function parseId(value) {
  const num = parseInt(value, 10);
  return Number.isNaN(num) ? null : num;
}

async function normalizePublicPostRows(rows, options = {}) {
  const normalizedRows = Array.isArray(rows)
    ? rows.map((row) => {
        const normalizedRow = normalizePublicPostAuthor(row);
        if (!normalizedRow) return normalizedRow;
        return {
          ...normalizedRow,
          author_profile_cosmetics: buildAuthorProfileCosmetics(normalizedRow),
        };
      })
    : [];
  return decoratePostRowsWithRenderImages(normalizedRows, options);
}

async function normalizePublicPostRow(row, options = {}) {
  if (!row) return row;
  const normalizedRow = normalizePublicPostAuthor(row);
  return decoratePostWithRenderImages(
    {
      ...normalizedRow,
      author_profile_cosmetics: buildAuthorProfileCosmetics(normalizedRow),
    },
    options
  );
}

function buildAuthorProfileCosmetics(row = {}) {
  if (!row) row = {};

  if (hasOwn(row, 'author_id') && row.author_id == null) {
    return {
      primary_badge: null,
      profile_background: null,
      showcase_badges: [],
      header_stickers: [],
    };
  }

  const key = typeof row.author_primary_badge_key === 'string'
    ? row.author_primary_badge_key.trim()
    : '';
  const backgroundKey =
    typeof row.author_profile_background_key === 'string'
      ? row.author_profile_background_key.trim()
      : '';

  return {
    primary_badge: key
      ? {
          key,
          type: 'badge',
          name: row.author_primary_badge_name || key,
          icon_emoji: row.author_primary_badge_icon_emoji || null,
          rarity: row.author_primary_badge_rarity || 'common',
          season: row.author_primary_badge_season || null,
          meta: null,
        }
      : null,
    profile_background: backgroundKey
      ? {
          key: backgroundKey,
          type: 'background',
          name: row.author_profile_background_name || backgroundKey,
          icon_emoji: row.author_profile_background_icon_emoji || null,
          rarity: row.author_profile_background_rarity || 'common',
          season: row.author_profile_background_season || null,
          meta: parseJsonObject(row.author_profile_background_meta_json),
        }
      : null,
    showcase_badges: [],
    header_stickers: [],
  };
}

function parseJsonObject(raw) {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function toFiniteNumber(value) {
  const num =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : NaN;
  return Number.isFinite(num) ? num : null;
}

function normalizeLayoutNumber(value, precision = 4) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function normalizeLayoutBox(raw, { required = false, allowLetterSpacing = false } = {}) {
  if (raw === undefined || raw === null || raw === '') {
    return required ? null : null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const x = toFiniteNumber(raw.x);
  const y = toFiniteNumber(raw.y);
  const w = toFiniteNumber(raw.w);
  const h = toFiniteNumber(raw.h);

  if (x == null || y == null || w == null || h == null) {
    return null;
  }

  if (x < 0 || x > 1 || y < 0 || y > 1 || w <= 0 || w > 1 || h <= 0 || h > 1) {
    return null;
  }

  const normalized = {
    x: normalizeLayoutNumber(x),
    y: normalizeLayoutNumber(y),
    w: normalizeLayoutNumber(w),
    h: normalizeLayoutNumber(h),
  };

  if (typeof raw.align === 'string') {
    const align = raw.align.trim().toLowerCase();
    if (ALLOWED_LAYOUT_ALIGN.has(align)) {
      normalized.align = align;
    } else if (align) {
      return null;
    }
  }

  if (raw.font_scale !== undefined) {
    const fontScale = toFiniteNumber(raw.font_scale);
    if (
      fontScale == null ||
      fontScale < LAYOUT_FONT_SCALE_RANGE.min ||
      fontScale > LAYOUT_FONT_SCALE_RANGE.max
    ) {
      return null;
    }
    normalized.font_scale = normalizeLayoutNumber(fontScale, 3);
  }

  if (raw.line_height !== undefined) {
    const lineHeight = toFiniteNumber(raw.line_height);
    if (
      lineHeight == null ||
      lineHeight < LAYOUT_LINE_HEIGHT_RANGE.min ||
      lineHeight > LAYOUT_LINE_HEIGHT_RANGE.max
    ) {
      return null;
    }
    normalized.line_height = normalizeLayoutNumber(lineHeight, 3);
  }

  if (allowLetterSpacing && raw.letter_spacing !== undefined) {
    const letterSpacing = toFiniteNumber(raw.letter_spacing);
    if (
      letterSpacing == null ||
      letterSpacing < LAYOUT_LETTER_SPACING_RANGE.min ||
      letterSpacing > LAYOUT_LETTER_SPACING_RANGE.max
    ) {
      return null;
    }
    normalized.letter_spacing = normalizeLayoutNumber(letterSpacing, 3);
  }

  return normalized;
}

function normalizeLayoutOverrideBox(raw, { allowLetterSpacing = false } = {}) {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const normalized = {};
  let hasAny = false;

  if (raw.x !== undefined) {
    const x = toFiniteNumber(raw.x);
    if (x == null || x < 0 || x > 1) {
      return null;
    }
    normalized.x = normalizeLayoutNumber(x);
    hasAny = true;
  }

  if (raw.y !== undefined) {
    const y = toFiniteNumber(raw.y);
    if (y == null || y < 0 || y > 1) {
      return null;
    }
    normalized.y = normalizeLayoutNumber(y);
    hasAny = true;
  }

  if (raw.w !== undefined) {
    const w = toFiniteNumber(raw.w);
    if (w == null || w <= 0 || w > 1) {
      return null;
    }
    normalized.w = normalizeLayoutNumber(w);
    hasAny = true;
  }

  if (raw.h !== undefined) {
    const h = toFiniteNumber(raw.h);
    if (h == null || h <= 0 || h > 1) {
      return null;
    }
    normalized.h = normalizeLayoutNumber(h);
    hasAny = true;
  }

  if (raw.align !== undefined) {
    const align =
      typeof raw.align === 'string' ? raw.align.trim().toLowerCase() : '';
    if (!align || !ALLOWED_LAYOUT_ALIGN.has(align)) {
      return null;
    }
    normalized.align = align;
    hasAny = true;
  }

  if (raw.font_scale !== undefined) {
    const fontScale = toFiniteNumber(raw.font_scale);
    if (
      fontScale == null ||
      fontScale < LAYOUT_FONT_SCALE_RANGE.min ||
      fontScale > LAYOUT_FONT_SCALE_RANGE.max
    ) {
      return null;
    }
    normalized.font_scale = normalizeLayoutNumber(fontScale, 3);
    hasAny = true;
  }

  if (raw.line_height !== undefined) {
    const lineHeight = toFiniteNumber(raw.line_height);
    if (
      lineHeight == null ||
      lineHeight < LAYOUT_LINE_HEIGHT_RANGE.min ||
      lineHeight > LAYOUT_LINE_HEIGHT_RANGE.max
    ) {
      return null;
    }
    normalized.line_height = normalizeLayoutNumber(lineHeight, 3);
    hasAny = true;
  }

  if (allowLetterSpacing && raw.letter_spacing !== undefined) {
    const letterSpacing = toFiniteNumber(raw.letter_spacing);
    if (
      letterSpacing == null ||
      letterSpacing < LAYOUT_LETTER_SPACING_RANGE.min ||
      letterSpacing > LAYOUT_LETTER_SPACING_RANGE.max
    ) {
      return null;
    }
    normalized.letter_spacing = normalizeLayoutNumber(letterSpacing, 3);
    hasAny = true;
  }

  return hasAny ? normalized : null;
}

function resolveLayoutBoxFromBase(baseBox, overrideBox, { allowLetterSpacing = false } = {}) {
  if (!baseBox) return null;
  const merged = overrideBox ? { ...baseBox, ...overrideBox } : { ...baseBox };
  return normalizeLayoutBox(merged, {
    required: true,
    allowLetterSpacing,
  });
}

function normalizeLayoutCanvas(raw) {
  const canvas = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw.canvas : null;
  return {
    presetId: normalizeTemplateKey(canvas?.presetId),
  };
}

function normalizeLayoutPayload(raw) {
  let payload = raw;

  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) {
      return { ok: true, value: null };
    }
    try {
      payload = JSON.parse(trimmed);
    } catch (_error) {
      return { ok: false };
    }
  }

  if (payload == null) {
    return { ok: true, value: null };
  }

  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false };
  }

  const layoutVersion = Number.parseInt(payload.layout_version, 10);
  if (layoutVersion !== 1 && layoutVersion !== 2) {
    return { ok: false };
  }

  const layoutUnit = hasOwn(payload, 'unit')
    ? String(payload.unit || '').trim().toLowerCase()
    : LAYOUT_UNIT_NORMALIZED;
  if (layoutUnit !== LAYOUT_UNIT_NORMALIZED) {
    return { ok: false };
  }

  if (layoutVersion === 1) {
    const textBox = normalizeLayoutBox(payload.text_box, {
      required: true,
      allowLetterSpacing: true,
    });
    if (!textBox) {
      return { ok: false };
    }

    let titleBox = null;
    if (hasOwn(payload, 'title_box')) {
      titleBox = normalizeLayoutBox(payload.title_box, {
        required: false,
        allowLetterSpacing: true,
      });
      if (payload.title_box != null && !titleBox) {
        return { ok: false };
      }
    }

    let footerBox = null;
    if (hasOwn(payload, 'footer_box')) {
      footerBox = normalizeLayoutBox(payload.footer_box, { required: false });
      if (payload.footer_box != null && !footerBox) {
        return { ok: false };
      }
    }

    const normalized = {
      layout_version: 1,
      unit: LAYOUT_UNIT_NORMALIZED,
      canvas: normalizeLayoutCanvas(payload),
      text_box: textBox,
      title_box: titleBox || { ...DEFAULT_LAYOUT_TITLE_BOX },
    };
    if (footerBox) {
      normalized.footer_box = footerBox;
    }

    return {
      ok: true,
      value: JSON.stringify(normalized),
    };
  }

  const baseRaw = payload.base;
  if (!baseRaw || typeof baseRaw !== 'object' || Array.isArray(baseRaw)) {
    return { ok: false };
  }

  const baseTextBox = normalizeLayoutBox(baseRaw.text_box, {
    required: true,
    allowLetterSpacing: true,
  });
  if (!baseTextBox) {
    return { ok: false };
  }

  let baseTitleBox = null;
  if (hasOwn(baseRaw, 'title_box')) {
    baseTitleBox = normalizeLayoutBox(baseRaw.title_box, {
      required: false,
      allowLetterSpacing: true,
    });
    if (baseRaw.title_box != null && !baseTitleBox) {
      return { ok: false };
    }
  }
  if (!baseTitleBox) {
    baseTitleBox = { ...DEFAULT_LAYOUT_TITLE_BOX };
  }

  let baseFooterBox = null;
  if (hasOwn(baseRaw, 'footer_box')) {
    baseFooterBox = normalizeLayoutBox(baseRaw.footer_box, {
      required: false,
      allowLetterSpacing: false,
    });
    if (baseRaw.footer_box != null && !baseFooterBox) {
      return { ok: false };
    }
  }

  const rawPages = payload.pages === undefined || payload.pages === null ? [] : payload.pages;
  if (!Array.isArray(rawPages)) {
    return { ok: false };
  }

  const normalizedPages = [];
  for (const pageRaw of rawPages) {
    if (pageRaw == null) {
      normalizedPages.push(null);
      continue;
    }
    if (!pageRaw || typeof pageRaw !== 'object' || Array.isArray(pageRaw)) {
      return { ok: false };
    }

    const normalizedPage = {};

    if (hasOwn(pageRaw, 'text_box') && pageRaw.text_box != null) {
      const textOverride = normalizeLayoutOverrideBox(pageRaw.text_box, {
        allowLetterSpacing: true,
      });
      if (!textOverride) {
        return { ok: false };
      }
      if (
        !resolveLayoutBoxFromBase(baseTextBox, textOverride, {
          allowLetterSpacing: true,
        })
      ) {
        return { ok: false };
      }
      normalizedPage.text_box = textOverride;
    }

    if (hasOwn(pageRaw, 'title_box') && pageRaw.title_box != null) {
      const titleOverride = normalizeLayoutOverrideBox(pageRaw.title_box, {
        allowLetterSpacing: true,
      });
      if (!titleOverride) {
        return { ok: false };
      }
      if (
        !resolveLayoutBoxFromBase(baseTitleBox, titleOverride, {
          allowLetterSpacing: true,
        })
      ) {
        return { ok: false };
      }
      normalizedPage.title_box = titleOverride;
    }

    if (hasOwn(pageRaw, 'footer_box') && pageRaw.footer_box != null) {
      const footerOverride = normalizeLayoutOverrideBox(pageRaw.footer_box, {
        allowLetterSpacing: false,
      });
      if (!footerOverride) {
        return { ok: false };
      }
      if (
        !resolveLayoutBoxFromBase(baseFooterBox, footerOverride, {
          allowLetterSpacing: false,
        })
      ) {
        return { ok: false };
      }
      normalizedPage.footer_box = footerOverride;
    }

    normalizedPages.push(Object.keys(normalizedPage).length > 0 ? normalizedPage : null);
  }

  const normalized = {
    layout_version: 2,
    unit: LAYOUT_UNIT_NORMALIZED,
    canvas: normalizeLayoutCanvas(payload),
    base: {
      text_box: baseTextBox,
      title_box: baseTitleBox,
    },
    pages: normalizedPages,
  };
  if (baseFooterBox) {
    normalized.base.footer_box = baseFooterBox;
  }

  return {
    ok: true,
    value: JSON.stringify(normalized),
  };
}

function parseLayoutInputFromBody(body = {}) {
  const hasLayoutJson = hasOwn(body, 'layout_json');
  const hasLayout = hasOwn(body, 'layout');

  if (!hasLayoutJson && !hasLayout) {
    // layout_json이 없으면 기존 자동 preset 렌더링을 그대로 유지한다.
    return { provided: false, value: null };
  }

  const raw = hasLayoutJson ? body.layout_json : body.layout;
  const normalized = normalizeLayoutPayload(raw);

  if (!normalized.ok) {
    return { provided: true, error: true };
  }

  return {
    provided: true,
    value: normalized.value,
  };
}

function normalizeManualContentPage(raw) {
  return String(raw ?? '').replace(/\r\n?/g, '\n').trim();
}

function countCompactContentChars(value) {
  return Array.from(String(value || '').replace(/\s/g, '')).length;
}

function extractFontMeta(raw) {
  const match = String(raw || '').match(FONT_META_REGEX);
  return match?.[1] ? `<!--FONT:${match[1].toLowerCase()}-->` : '';
}

function parseContentPagesInput(body = {}) {
  if (!hasOwn(body, 'content_pages')) {
    return { provided: false, pages: null, storageValue: null, flattenedContent: null };
  }

  if (!Array.isArray(body.content_pages)) {
    return { provided: true, error: 'content_pages는 배열이어야 합니다.' };
  }

  if (body.content_pages.some((page) => typeof page !== 'string')) {
    return { provided: true, error: 'content_pages는 문자열 배열이어야 합니다.' };
  }

  const pages = body.content_pages
    .slice(0, CONTENT_PAGE_MAX_COUNT + 1)
    .map(normalizeManualContentPage);

  while (pages.length > 1 && !pages[pages.length - 1]) {
    pages.pop();
  }

  if (pages.length < 1 || !pages.some(Boolean)) {
    return { provided: true, error: '페이지 본문을 한 장 이상 입력해주세요.' };
  }

  if (pages.length > CONTENT_PAGE_MAX_COUNT) {
    return { provided: true, error: `페이지는 최대 ${CONTENT_PAGE_MAX_COUNT}장까지 작성할 수 있습니다.` };
  }

  const pageTooLong = pages.some(
    (page) => countCompactContentChars(page) > CONTENT_PAGE_MAX_CHARS
  );
  if (pageTooLong) {
    return { provided: true, error: `한 페이지는 최대 ${CONTENT_PAGE_MAX_CHARS}자까지 작성할 수 있습니다.` };
  }

  const totalChars = countCompactContentChars(pages.join(''));
  if (totalChars > CONTENT_PAGE_MAX_TOTAL_CHARS) {
    return { provided: true, error: `전체 본문은 최대 ${CONTENT_PAGE_MAX_TOTAL_CHARS}자까지 작성할 수 있습니다.` };
  }

  const safePages = pages.map((page) => sanitizeForStorage(page));
  return {
    provided: true,
    pages: safePages,
    storageValue: JSON.stringify(safePages),
    flattenedContent: pages.join('\n\n'),
  };
}

function parseStoredContentPages(raw) {
  if (!raw) return [];
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (_error) {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((page) => String(page ?? '')).slice(0, CONTENT_PAGE_MAX_COUNT);
}

function extractTagsFromQuery(query = {}) {
  if (query.tags) {
    const tags = String(query.tags)
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    return { tags, tagCount: tags.length };
  }

  if (query.tag) {
    const tag = String(query.tag).trim().toLowerCase();
    return tag ? { tags: [tag], tagCount: 1 } : { tags: [], tagCount: 0 };
  }

  return { tags: [], tagCount: 0 };
}

function getOptionalUserId(req) {
  return req.user?.id || null;
}

const dbGetAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });

const dbAllAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });

const dbRunAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });

const saveHashtagsAsync = (postId, hashtags) =>
  new Promise((resolve) => {
    saveHashtagsForPostFromInput(postId, hashtags, (err) => {
      resolve(err || null);
    });
  });

function normalizeContextText(value, maxLength = 160) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function parseWritingEventContext(body = {}) {
  const raw =
    body.writing_event_context ||
    body.writingEventContext ||
    body.campaign_context ||
    body.campaignContext ||
    null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const eventKey = normalizeContextText(raw.event_key ?? raw.eventKey ?? raw.campaign_key ?? raw.campaignKey);
  const promptKey = normalizeContextText(raw.prompt_key ?? raw.promptKey ?? raw.campaignPromptKey);
  if (!eventKey || !promptKey) return null;

  const event = getWritingEventDefinition(eventKey);
  if (!event) {
    const error = new Error('유효하지 않은 글쓰기 이벤트입니다.');
    error.status = 400;
    error.code = 'INVALID_WRITING_EVENT';
    throw error;
  }

  const context = buildWritingEventContext(eventKey, promptKey);
  if (!context) {
    const error = new Error('유효하지 않은 글쓰기 이벤트 주제입니다.');
    error.status = 400;
    error.code = 'INVALID_WRITING_EVENT_PROMPT';
    throw error;
  }

  return context;
}

async function saveWritingEventContextForPost(postId, userId, context) {
  if (!postId || !userId || !context) return null;

  await dbRunAsync(
    `
      INSERT INTO post_writing_event_contexts (
        post_id,
        user_id,
        event_key,
        event_title,
        prompt_key,
        prompt_day,
        prompt_title,
        prompt_body,
        source
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(post_id) DO UPDATE SET
        event_key = excluded.event_key,
        event_title = excluded.event_title,
        prompt_key = excluded.prompt_key,
        prompt_day = excluded.prompt_day,
        prompt_title = excluded.prompt_title,
        prompt_body = excluded.prompt_body,
        source = excluded.source,
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      postId,
      userId,
      context.eventKey,
      context.eventTitle,
      context.promptKey,
      context.promptDay,
      context.promptTitle,
      context.promptBody,
      context.source,
    ]
  );

  return context;
}

async function rollbackQuietly() {
  try {
    await dbRunAsync('ROLLBACK;');
  } catch (error) {
    console.error('post transaction rollback failed:', error);
  }
}

async function logPostActivationEvents(userId, postId) {
  await logUxEvent({
    user_id: userId,
    event_name: 'post_create_success',
    source: 'server_post',
    properties: { post_id: postId },
  });

  const firstPost = await dbGetAsync(
    `
      SELECT id, created_at
      FROM posts
      WHERE user_id = ?
      ORDER BY datetime(created_at) ASC, id ASC
      LIMIT 1
    `,
    [userId]
  );

  if (!firstPost || Number(firstPost.id) !== Number(postId)) {
    return;
  }

  const verifyEvent = await dbGetAsync(
    `
      SELECT created_at
      FROM ux_events
      WHERE user_id = ? AND event_name = 'verify_email_success'
      ORDER BY datetime(created_at) ASC, id ASC
      LIMIT 1
    `,
    [userId]
  );

  if (!verifyEvent?.created_at || !firstPost.created_at) {
    return;
  }

  const diff = await dbGetAsync(
    `SELECT ((julianday(?) - julianday(?)) * 24.0) AS diff_hours`,
    [firstPost.created_at, verifyEvent.created_at]
  );

  const hoursFromVerify = Number(diff?.diff_hours);
  if (!Number.isFinite(hoursFromVerify)) return;
  if (hoursFromVerify < 0 || hoursFromVerify > 24) return;

  await logUxEvent({
    user_id: userId,
    event_name: 'first_post_created_24h',
    source: 'server_post',
    properties: {
      post_id: postId,
      hours_from_verify: Number(hoursFromVerify.toFixed(2)),
    },
  });
}

function normalizeNotificationPostTitle(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

async function notifyFollowersAboutNewPost({ authorId, postId, title, visibility }) {
  const normalizedVisibility = normalizeVisibility(visibility);
  if (!postId || !['public', 'followers'].includes(normalizedVisibility)) {
    return { notified: 0 };
  }

  const author = await dbGetAsync(
    `
    SELECT nickname, COALESCE(account_status, 'active') AS account_status
    FROM users
    WHERE id = ?
    LIMIT 1
    `,
    [authorId]
  );
  const authorName = buildPublicDisplayName(author?.nickname, author?.account_status);
  const postTitle = normalizeNotificationPostTitle(title);
  const followers = await dbAllAsync(
    `
    SELECT f.follower_id
    FROM follows f
    INNER JOIN users u ON u.id = f.follower_id
    WHERE f.followee_id = ?
      AND f.follower_id != ?
      AND COALESCE(u.account_status, 'active') = 'active'
    ORDER BY f.created_at ASC, f.follower_id ASC
    `,
    [authorId, authorId]
  );

  let notified = 0;
  for (const follower of followers || []) {
    const activity = await createActivityEvent({
      recipientUserId: follower.follower_id,
      actorUserId: authorId,
      eventType: ACTIVITY_TYPES.SYSTEM,
      postId,
      title: `${authorName}님이 새 글을 올렸어요.`,
      body: postTitle
        ? `${authorName}님이 「${postTitle}」을 남겼어요.`
        : '팔로잉한 작가의 새 글이 올라왔어요.',
      meta: {
        notification_type: 'following_new_post',
        target_path: `/posts/${postId}`,
        post_title: postTitle,
        visibility: normalizedVisibility,
      },
      uniqueKey: `following_new_post:${postId}:${follower.follower_id}`,
    });

    if (activity?.id) notified += 1;
  }

  return { notified };
}

const router = express.Router();

// 9-1) 글 작성
router.post('/posts', authRequired, async (req, res) => {
  const { title, content, hashtags, category } = req.body;
  const userId = req.user.id;
  const normalizedCategory = requireValidCategory(category, res);
  const visibility = normalizeVisibility(req.body?.visibility);
  const commentPolicy = normalizeCommentPolicy(req.body?.comment_policy);
  const layoutInput = parseLayoutInputFromBody(req.body);
  const contentPagesInput = parseContentPagesInput(req.body);
  const questContext = req.body?.quest_context || null;
  let writingEventContext = null;

  if (!normalizedCategory) return;
  if (contentPagesInput.error) {
    return res.status(400).json({
      ok: false,
      message: contentPagesInput.error,
    });
  }
  if (layoutInput.error) {
    return res.status(400).json({
      ok: false,
      message: LAYOUT_VALIDATION_ERROR_MESSAGE,
    });
  }
  try {
    writingEventContext = parseWritingEventContext(req.body);
  } catch (contextError) {
    return res.status(contextError.status || 400).json({
      ok: false,
      code: contextError.code || 'INVALID_WRITING_EVENT_CONTEXT',
      message: contextError.message || '글쓰기 이벤트 정보가 올바르지 않습니다.',
    });
  }

  const contentForStorage = contentPagesInput.provided
    ? `${extractFontMeta(content)}${contentPagesInput.flattenedContent || ''}`
    : content;

  if (!title || !contentForStorage) {
    return res
      .status(400)
      .json({ ok: false, message: '제목과 내용을 모두 입력하세요.' });
  }

  const safeContent = sanitizeForStorage(contentForStorage);
  let newPostId = null;
  let questCompletion = null;
  let tagErr = null;

  try {
    await dbRunAsync('BEGIN IMMEDIATE;');
    const insertResult = await dbRunAsync(
      `
        INSERT INTO posts (user_id, title, content, content_pages, category, layout_json, visibility, comment_policy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        userId,
        title,
        safeContent,
        contentPagesInput.provided ? contentPagesInput.storageValue : null,
        normalizedCategory,
        layoutInput.provided ? layoutInput.value : null,
        visibility,
        commentPolicy,
      ]
    );
    newPostId = insertResult?.lastID || null;
    tagErr = await saveHashtagsAsync(newPostId, hashtags);

    if (questContext) {
      questCompletion = await completePromptPostQuest(userId, newPostId, questContext);
    }
    await saveWritingEventContextForPost(newPostId, userId, writingEventContext);

    await dbRunAsync('COMMIT;');
  } catch (err) {
    await rollbackQuietly();
    if (err instanceof QuestContextError) {
      return res.status(err.status).json({
        ok: false,
        code: err.code,
        message: err.message,
      });
    }
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, message: '글 저장 중 DB 오류가 발생했습니다.' });
  }

  try {
    await handlePostCreated(userId, newPostId);
    await logPostActivationEvents(userId, newPostId);
  } catch (growthErr) {
    console.error('post growth/activation 처리 실패:', growthErr);
  }

  try {
    await notifyFollowersAboutNewPost({
      authorId: userId,
      postId: newPostId,
      title,
      visibility,
    });
  } catch (notificationErr) {
    console.error('following new post notification 처리 실패:', notificationErr);
  }

  return res.json({
    ok: true,
    message: tagErr
      ? '글은 저장되었지만, 해시태그 저장 중 오류가 발생했습니다.'
      : '글이 저장되었습니다.',
    post_id: newPostId,
    ...(questCompletion ? { quest_completion: questCompletion } : {}),
  });
});

// 9-2) 글 수정
router.put('/posts/:id', authRequired, (req, res) => {
  const postId = req.params.id;
  const { title, content, hashtags, category } = req.body;
  const userId = req.user.id;
  const isAdmin = !!req.user.isAdmin;
  const normalizedCategory = requireValidCategory(category, res);
  const visibility = normalizeVisibility(req.body?.visibility);
  const commentPolicy = normalizeCommentPolicy(req.body?.comment_policy);
  const layoutInput = parseLayoutInputFromBody(req.body);
  const contentPagesInput = parseContentPagesInput(req.body);

  if (!normalizedCategory) return;
  if (contentPagesInput.error) {
    return res.status(400).json({
      ok: false,
      message: contentPagesInput.error,
    });
  }
  if (layoutInput.error) {
    return res.status(400).json({
      ok: false,
      message: LAYOUT_VALIDATION_ERROR_MESSAGE,
    });
  }

  const contentForStorage = contentPagesInput.provided
    ? `${extractFontMeta(content)}${contentPagesInput.flattenedContent || ''}`
    : content;

  if (!title || !contentForStorage) {
    return res
      .status(400)
      .json({ ok: false, message: '제목과 내용을 모두 입력하세요.' });
  }

  const safeContent = sanitizeForStorage(contentForStorage);

  // 수정 권한 확인(작성자 또는 관리자만 허용)
  db.get('SELECT user_id FROM posts WHERE id = ?', [postId], (err, row) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ ok: false, message: '글 조회 중 DB 오류가 발생했습니다.' });
    }

    if (!row) {
      return res
        .status(404)
        .json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });
    }

    if (!isAdmin && row.user_id !== userId) {
      return res
        .status(403)
        .json({ ok: false, message: '이 글을 수정할 권한이 없습니다.' });
    }

    // 본문 갱신 후 해시태그 매핑을 재작성
    const updateFields = [
      'title = ?',
      'content = ?',
      'content_pages = ?',
      'category = ?',
      'visibility = ?',
      'comment_policy = ?',
      'visibility_updated_at = CURRENT_TIMESTAMP',
      'comment_policy_updated_at = CURRENT_TIMESTAMP',
    ];
    const updateParams = [
      title,
      safeContent,
      contentPagesInput.provided ? contentPagesInput.storageValue : null,
      normalizedCategory,
      visibility,
      commentPolicy,
    ];
    if (layoutInput.provided) {
      updateFields.push('layout_json = ?');
      updateParams.push(layoutInput.value);
    }
    updateParams.push(postId);

    db.run(
      `UPDATE posts SET ${updateFields.join(', ')} WHERE id = ?`,
      updateParams,
      function (err2) {
        if (err2) {
          console.error(err2);
          return res
            .status(500)
            .json({ ok: false, message: '글 수정 중 DB 오류가 발생했습니다.' });
        }

        saveHashtagsForPostFromInput(postId, hashtags, (tagErr) => {
          if (tagErr) {
            console.error('해시태그 갱신 중 오류:', tagErr);
            return res.json({
              ok: true,
              message:
                '글은 수정되었지만, 해시태그 저장 중 오류가 발생했습니다.',
            });
          }

          return res.json({
            ok: true,
            message: '글이 수정되었습니다.',
          });
        });
      }
    );
  });
});

router.patch('/posts/:id/settings', authRequired, (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;
  const isAdmin = !!req.user.isAdmin;
  const visibility = normalizeVisibility(req.body?.visibility);
  const commentPolicy = normalizeCommentPolicy(req.body?.comment_policy);

  db.get('SELECT user_id FROM posts WHERE id = ?', [postId], (err, row) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ ok: false, message: '글 조회 중 DB 오류가 발생했습니다.' });
    }

    if (!row) {
      return res
        .status(404)
        .json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });
    }

    if (!isAdmin && row.user_id !== userId) {
      return res
        .status(403)
        .json({ ok: false, message: '이 글의 설정을 수정할 권한이 없습니다.' });
    }

    db.run(
      `
      UPDATE posts
      SET visibility = ?,
          comment_policy = ?,
          visibility_updated_at = CURRENT_TIMESTAMP,
          comment_policy_updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [visibility, commentPolicy, postId],
      (updateErr) => {
        if (updateErr) {
          console.error(updateErr);
          return res.status(500).json({
            ok: false,
            message: '글 설정 변경 중 DB 오류가 발생했습니다.',
          });
        }

        return res.json({
          ok: true,
          message: '글 설정이 변경되었습니다.',
          visibility,
          comment_policy: commentPolicy,
        });
      }
    );
  });
});

// 9-3) 내가 쓴 글 목록
router.get('/posts/my', authRequired, (req, res) => {
  const userId = req.user.id;

  db.all(
    `
    SELECT
      p.id,
      p.title,
      p.content,
      p.layout_json,
      p.content_pages,
      ${CATEGORY_SQL} AS category,
      ${VISIBILITY_SQL} AS visibility,
      ${COMMENT_POLICY_SQL} AS comment_policy,
      p.created_at,
      p.user_id                AS author_id,
      u.name                   AS author_name,
      u.nickname               AS author_nickname,
      u.email                  AS author_email,
      u.profile_photo_url      AS author_profile_photo_url,
      u.profile_photo_thumbnail_url AS author_profile_photo_thumbnail_url,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM likes l2
          WHERE l2.post_id = p.id
            AND l2.user_id = ?
        ) THEN 1
        ELSE 0
      END AS user_liked
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
    `,
    [userId, userId],
    async (err, rows) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({
            ok: false,
            message: '글 목록 조회 중 DB 오류가 발생했습니다.',
          });
      }

      try {
        const posts = await normalizePublicPostRows(rows);
        return res.json({
          ok: true,
          message: '내 글 목록을 불러왔습니다.',
          posts,
        });
      } catch (normalizeError) {
        console.error(normalizeError);
        return res.status(500).json({
          ok: false,
          message: '글 목록 가공 중 오류가 발생했습니다.',
        });
      }
    }
  );
});


// 9-4) 내가 공감한 글 목록
router.get('/posts/liked', authRequired, (req, res) => {
  const userId = req.user.id;

  db.all(
    `
    SELECT
      p.id,
      p.title,
      p.content,
      p.layout_json,
      p.content_pages,
      ${CATEGORY_SQL} AS category,
      ${VISIBILITY_SQL} AS visibility,
      ${COMMENT_POLICY_SQL} AS comment_policy,
      p.created_at,
      p.user_id                AS author_id,
      u.name                   AS author_name,
      u.nickname               AS author_nickname,
      u.email                  AS author_email,
      u.profile_photo_url      AS author_profile_photo_url,
      u.profile_photo_thumbnail_url AS author_profile_photo_thumbnail_url,
      COALESCE(u.account_status, 'active') AS author_account_status,
      -- 해당 글의 총 공감 수
      (SELECT COUNT(*) FROM likes l2 WHERE l2.post_id = p.id) AS like_count,
      -- "내가 공감한 글" 목록이니까 항상 공감한 상태
      1 AS user_liked
    FROM posts p
    INNER JOIN likes l ON l.post_id = p.id
    JOIN users u ON p.user_id = u.id
    WHERE l.user_id = ?
      AND (
        ${VISIBILITY_SQL} IN ('public', 'unlisted')
        OR p.user_id = ?
        OR (
          ${VISIBILITY_SQL} = 'followers'
          AND EXISTS (
            SELECT 1
            FROM follows f
            WHERE f.follower_id = ?
              AND f.followee_id = p.user_id
          )
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM user_blocks ub
        WHERE ub.blocker_id = ?
          AND ub.blocked_user_id = p.user_id
      )
    ORDER BY l.created_at DESC
    `,
    [userId, userId, userId, userId],
    async (err, rows) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({
            ok: false,
            message: '공감한 글 목록 조회 중 DB 오류가 발생했습니다.',
          });
      }

      try {
        const posts = await normalizePublicPostRows(rows);
        return res.json({
          ok: true,
          message: '공감한 글 목록을 불러왔습니다.',
          posts,
        });
      } catch (normalizeError) {
        console.error(normalizeError);
        return res.status(500).json({
          ok: false,
          message: '글 목록 가공 중 오류가 발생했습니다.',
        });
      }
    }
  );
});

function handleFeedRequest(req, res) {
  const userId = getOptionalUserId(req);
  const { limit, offset } = parsePagination(req.query);

  const sortParam = String(req.query.sort || 'latest').trim().toLowerCase();
  const sort = ['popular', 'recommended'].includes(sortParam) ? sortParam : 'latest';
  const recommendationSeed = normalizeRecommendationSeed(req.query.seed);
  const excludedPostIds = parseExcludedPostIds(req.query.exclude_ids);

  const typeParam = String(req.query.type || 'all');
  const feedType = typeParam === 'following' ? 'following' : 'all';

  const genre = parseGenreSlug(req.query.genre);
  const categoryParam = String(req.query.category || '').trim();
  const category = parseCategory(categoryParam) || parseCategory(genre);

  const extracted = extractTagsFromQuery(req.query);
  const genreAsTag = genre && !parseCategory(genre) ? genre : '';
  const tags = genreAsTag
    ? Array.from(new Set([...extracted.tags, genreAsTag]))
    : extracted.tags;
  const tagCount = tags.length;

  if (feedType === 'following' && !userId) {
    return res.status(401).json({
      ok: false,
      message: '로그인이 필요한 요청입니다.',
      posts: [],
      has_more: false,
      context: {
        feed_type: feedType,
        sort,
        following_count: 0,
        tags,
        category: category || null,
        genre: genre || null,
      },
    });
  }

  const runQuery = (followingCount = null) => {
    const params = [];

    const selectClause = `
      SELECT
        p.id,
        p.title,
        p.content,
        p.layout_json,
        p.content_pages,
        p.created_at,
        ${CATEGORY_SQL} AS category,
        ${VISIBILITY_SQL} AS visibility,
        ${COMMENT_POLICY_SQL} AS comment_policy,
        u.id       AS author_id,
        u.name     AS author_name,
        u.nickname AS author_nickname,
        u.email    AS author_email,
        u.profile_photo_url AS author_profile_photo_url,
        u.profile_photo_thumbnail_url AS author_profile_photo_thumbnail_url,
        COALESCE(u.account_status, 'active') AS author_account_status,
        ci.key AS author_primary_badge_key,
        ci.name AS author_primary_badge_name,
	        ci.icon_emoji AS author_primary_badge_icon_emoji,
	        COALESCE(ci.rarity, 'common') AS author_primary_badge_rarity,
	        ci.season AS author_primary_badge_season,
	        pbi.key AS author_profile_background_key,
	        pbi.name AS author_profile_background_name,
	        pbi.icon_emoji AS author_profile_background_icon_emoji,
	        COALESCE(pbi.rarity, 'common') AS author_profile_background_rarity,
	        pbi.season AS author_profile_background_season,
	        pbi.meta_json AS author_profile_background_meta_json,
	        IFNULL(lc.like_count, 0) AS like_count,
        ${
          userId
            ? 'CASE WHEN my.user_id IS NULL THEN 0 ELSE 1 END'
            : '0'
        } AS user_liked,
        GROUP_CONCAT(DISTINCT h.name) AS hashtags
    `;

    const joins = [
      'FROM posts p',
	      'JOIN users u ON p.user_id = u.id',
	      'LEFT JOIN user_profile_cosmetics upc ON upc.user_id = u.id',
	      "LEFT JOIN cosmetic_items ci ON ci.key = upc.primary_badge_key AND ci.type = 'badge' AND ci.is_active = 1",
	      'LEFT JOIN profile_background_items pbi ON pbi.key = upc.profile_background_key AND pbi.is_active = 1',
	      'LEFT JOIN post_hashtags ph ON ph.post_id = p.id',
      'LEFT JOIN hashtags h ON h.id = ph.hashtag_id',
      'LEFT JOIN (SELECT post_id, COUNT(*) AS like_count FROM likes GROUP BY post_id) lc ON lc.post_id = p.id',
    ];

    if (userId) {
      joins.push('LEFT JOIN likes my ON my.post_id = p.id AND my.user_id = ?');
      params.push(userId);
    }

    const conditions = [];

    appendViewerBlockedAuthorCondition(conditions, params, userId, 'p.user_id');
    appendFeedVisibilityCondition(conditions, params, userId, feedType);

    if (tagCount > 0) {
      const placeholders = tags.map(() => '?').join(', ');
      conditions.push(`p.id IN (
          SELECT ph2.post_id
          FROM post_hashtags ph2
          JOIN hashtags h2 ON h2.id = ph2.hashtag_id
          WHERE h2.name IN (${placeholders})
          GROUP BY ph2.post_id
          HAVING COUNT(DISTINCT h2.name) = ?
        )`);
      params.push(...tags, tagCount);
    }

    if (feedType === 'following') {
      conditions.push(
        'p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)'
      );
      params.push(userId);
    }

    if (category) {
      conditions.push('p.category = ?');
      params.push(category);
    }

    if (excludedPostIds.length > 0) {
      conditions.push(`p.id NOT IN (${excludedPostIds.map(() => '?').join(', ')})`);
      params.push(...excludedPostIds);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const orderClause = buildFeedOrderClause(sort, recommendationSeed);

    const sql = `
      ${selectClause}
      ${joins.join('\n')}
      ${whereClause}
      GROUP BY p.id
      ${orderClause}
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);

    db.all(sql, params, async (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({
          ok: false,
          message: '피드 조회 중 DB 오류가 발생했습니다.',
        });
      }

      try {
        const posts = await normalizePublicPostRows(rows);
        return res.json({
          ok: true,
          message: '피드를 불러왔습니다.',
          posts,
          has_more: rows.length === limit,
          context: {
            feed_type: feedType,
            sort,
            recommendation_seed: sort === 'recommended' ? recommendationSeed : null,
            excluded_post_ids: excludedPostIds,
            following_count: followingCount,
            tags,
            category: category || null,
            genre: genre || null,
          },
        });
      } catch (normalizeError) {
        console.error(normalizeError);
        return res.status(500).json({
          ok: false,
          message: '피드 응답 가공 중 오류가 발생했습니다.',
        });
      }
    });
  };

  if (feedType === 'following') {
    db.get(
      'SELECT COUNT(*) AS cnt FROM follows WHERE follower_id = ?',
      [userId],
      (err, row) => {
        if (err) {
          console.error(err);
          return res.status(500).json({
            ok: false,
            message: '팔로잉 정보를 확인하는 중 오류가 발생했습니다.',
          });
        }

        runQuery(row?.cnt || 0);
      }
    );
  } else {
    runQuery(null);
  }
}

// 9-5) 피드 조회 (전체 + 해시태그 필터 + 좋아요 여부)
router.get('/posts/feed', authOptional, handleFeedRequest);
router.get('/posts', authOptional, handleFeedRequest);
router.get('/feed/immersive', authOptional, handleFeedRequest);

router.get('/genres', authOptional, async (req, res) => {
  try {
    const rows = await dbAllAsync(
      `
      SELECT slug, name, group_name, description, sort_order
      FROM genres
      WHERE is_active = 1
      ORDER BY sort_order ASC, id ASC
      `
    );
    const genres = rows.length > 0 ? rows : DEFAULT_GENRES;
    return res.json({ ok: true, genres });
  } catch (error) {
    console.error('[genres/list] failed:', error);
    return res.json({ ok: true, genres: DEFAULT_GENRES });
  }
});

router.post('/feed-events', authOptional, async (req, res) => {
  const userId = getOptionalUserId(req);
  const postId = parseId(req.body?.post_id || req.body?.postId);
  const eventType = String(req.body?.event_type || req.body?.eventType || '').trim().slice(0, 40);
  const surface = String(req.body?.surface || '').trim().slice(0, 40) || 'unknown';
  const genre = parseGenreSlug(req.body?.genre || req.body?.genre_slug);
  const dwellMsRaw = Number.parseInt(req.body?.dwell_ms || req.body?.dwellMs, 10);
  const dwellMs = Number.isFinite(dwellMsRaw) && dwellMsRaw >= 0 ? dwellMsRaw : null;

  if (!eventType) {
    return res.status(400).json({ ok: false, message: 'event_type이 필요합니다.' });
  }

  try {
    await dbRunAsync(
      `
      INSERT INTO feed_events (user_id, post_id, event_type, surface, genre_slug, dwell_ms)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [userId, postId, eventType, surface, genre || null, dwellMs]
    );
    return res.json({ ok: true, message: '피드 이벤트를 기록했습니다.' });
  } catch (error) {
    console.error('[feed-events/create] failed:', error);
    return res.status(500).json({ ok: false, message: '피드 이벤트 기록에 실패했습니다.' });
  }
});

// 9-6) 관련 글 추천
router.get('/posts/:id/related', authOptional, (req, res) => {
  const postId = parseInt(req.params.id, 10);
  if (!postId) {
    return res
      .status(400)
      .json({ ok: false, message: '잘못된 글 ID입니다.' });
  }

  const limit = parseInt(req.query.limit, 10) || 6;

  // 🔹 0) 현재 로그인한 사용자 ID 추출 (없으면 null)
  const userId = getOptionalUserId(req);

  // 기준 글의 작성자/태그 정보를 가져와 관련 글 매칭에 사용
  db.get(
    `
    SELECT
      p.id,
      p.user_id AS author_id,
      p.created_at,
      GROUP_CONCAT(DISTINCT h.name) AS hashtags
    FROM posts p
    LEFT JOIN post_hashtags ph ON ph.post_id = p.id
    LEFT JOIN hashtags h ON h.id = ph.hashtag_id
    WHERE p.id = ?
    GROUP BY p.id
    `,
    [postId],
    (err, current) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '기준 글 조회 중 DB 오류가 발생했습니다.' });
      }

      if (!current) {
        return res
          .status(404)
          .json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });
      }

      if (userId) {
        db.get(
          'SELECT 1 AS present FROM user_blocks WHERE blocker_id = ? AND blocked_user_id = ? LIMIT 1',
          [userId, current.author_id],
          (blockErr, blockRow) => {
            if (blockErr) {
              console.error(blockErr);
              return res.status(500).json({
                ok: false,
                message: '관련 글을 불러오는 중 오류가 발생했습니다.',
              });
            }

            if (blockRow?.present) {
              return res.status(404).json({
                ok: false,
                message: '해당 글을 찾을 수 없습니다.',
              });
            }

            return loadRelatedCandidates();
          }
        );
        return;
      }

      return loadRelatedCandidates();

      function loadRelatedCandidates() {

      const currentTags = current.hashtags
        ? current.hashtags
            .split(',')
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean)
        : [];

      const CANDIDATE_LIMIT = 100;

      // 🔹 1) 후보 글들 + like_count + (이 유저가 눌렀는지 user_liked)까지 한 번에 가져오기
      db.all(
        `
        SELECT
          p.id,
          p.title,
          p.content,
          p.layout_json,
          p.content_pages,
          ${CATEGORY_SQL} AS category,
          ${VISIBILITY_SQL} AS visibility,
          ${COMMENT_POLICY_SQL} AS comment_policy,
          p.created_at,
          u.id       AS author_id,
          u.name     AS author_name,
          u.nickname AS author_nickname,
          u.email    AS author_email,
          u.profile_photo_url AS author_profile_photo_url,
          u.profile_photo_thumbnail_url AS author_profile_photo_thumbnail_url,
          COALESCE(u.account_status, 'active') AS author_account_status,
          ci.key AS author_primary_badge_key,
          ci.name AS author_primary_badge_name,
	          ci.icon_emoji AS author_primary_badge_icon_emoji,
	          COALESCE(ci.rarity, 'common') AS author_primary_badge_rarity,
	          ci.season AS author_primary_badge_season,
	          pbi.key AS author_profile_background_key,
	          pbi.name AS author_profile_background_name,
	          pbi.icon_emoji AS author_profile_background_icon_emoji,
	          COALESCE(pbi.rarity, 'common') AS author_profile_background_rarity,
	          pbi.season AS author_profile_background_season,
	          pbi.meta_json AS author_profile_background_meta_json,
	          IFNULL(l.like_count, 0) AS like_count,
          -- ✅ 이 유저가 누른 좋아요 여부
          CASE
            WHEN my.user_id IS NULL THEN 0
            ELSE 1
          END AS user_liked,
          GROUP_CONCAT(DISTINCT h.name) AS hashtags
        FROM posts p
        JOIN users u ON p.user_id = u.id
        LEFT JOIN user_profile_cosmetics upc ON upc.user_id = u.id
	        LEFT JOIN cosmetic_items ci
	          ON ci.key = upc.primary_badge_key
	         AND ci.type = 'badge'
	         AND ci.is_active = 1
	        LEFT JOIN profile_background_items pbi
	          ON pbi.key = upc.profile_background_key
	         AND pbi.is_active = 1
	        -- 전체 좋아요 개수 집계
        LEFT JOIN (
          SELECT post_id, COUNT(*) AS like_count
          FROM likes
          GROUP BY post_id
        ) l ON l.post_id = p.id
        -- 현재 로그인한 유저가 누른 좋아요만 따로 조인
        LEFT JOIN likes my
          ON my.post_id = p.id
         AND my.user_id = ?
        LEFT JOIN post_hashtags ph ON ph.post_id = p.id
        LEFT JOIN hashtags h ON h.id = ph.hashtag_id
        WHERE p.id != ?
          AND ${VISIBILITY_SQL} = 'public'
          ${
            userId
              ? `AND NOT EXISTS (
                  SELECT 1
                  FROM user_blocks ub
                  WHERE ub.blocker_id = ?
                    AND ub.blocked_user_id = p.user_id
                )`
              : ''
          }
        GROUP BY p.id
        ORDER BY p.created_at DESC
        LIMIT ?
        `,
        // 파라미터 순서: 1) userId (my.user_id = ?)
        //              2) postId (p.id != ?)
        //              3) CANDIDATE_LIMIT (LIMIT ?)
        userId ? [userId, postId, userId, CANDIDATE_LIMIT] : [userId, postId, CANDIDATE_LIMIT],
        async (err2, rows) => {
          if (err2) {
            console.error(err2);
            return res.status(500).json({
              ok: false,
              message: '관련 글을 불러오는 중 DB 오류가 발생했습니다.',
            });
          }

          if (!rows || rows.length === 0) {
            return res.json({
              ok: true,
              message: '관련 글이 없습니다.',
              posts: [],
            });
          }

          const now = Date.now();
          const ONE_DAY = 1000 * 60 * 60 * 24;

          // 해시태그 겹침 + 같은 작가 + 최신순을 가중치로 점수 계산
          const scored = rows.map((p) => {
            const postTags = (p.hashtags || '')
              .split(',')
              .map((t) => t.trim().toLowerCase())
              .filter(Boolean);

            const overlapCount = postTags.filter((t) =>
              currentTags.includes(t)
            ).length;

            const sameAuthor = p.author_id === current.author_id ? 1 : 0;

            const createdTime = new Date(p.created_at).getTime();
            let recencyScore = 0;
            if (!isNaN(createdTime)) {
              const daysAgo = (now - createdTime) / ONE_DAY;
              recencyScore = Math.max(0, 7 - daysAgo);
            }

            const likeCount = p.like_count || 0;

            const score =
              overlapCount * 3 +
              sameAuthor * 2 +
              likeCount * 1 +
              recencyScore * 1;

            return { ...p, _score: score };
          });

          scored.sort((a, b) => b._score - a._score);

          const finalPosts = scored.slice(0, limit).map((p) => {
            const copy = { ...p };
            delete copy._score;
            return copy;
          });

          try {
            const posts = await normalizePublicPostRows(finalPosts);
            return res.json({
                ok: true,
                message: '관련 글을 불러왔습니다.',
                posts,
              });
          } catch (normalizeError) {
            console.error(normalizeError);
            return res.status(500).json({
              ok: false,
              message: '관련 글 응답 가공 중 오류가 발생했습니다.',
            });
          }
        }
      );
      }
    }
  );
});

// ⚠️ 공개 상세(/posts/:id)보다 위에 둔다.
// 9-7) 글 상세 조회 (편집용)  ✅ URL 변경: /posts/:id  -> /posts/:id/edit
router.get('/posts/:id/edit', authRequired, (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;

  db.get(
    `
    SELECT
      p.id,
      p.title,
      p.content,
      p.layout_json,
      p.content_pages,
      ${CATEGORY_SQL} AS category,
      ${VISIBILITY_SQL} AS visibility,
      ${COMMENT_POLICY_SQL} AS comment_policy,
      p.created_at,
      GROUP_CONCAT(DISTINCT h.name) AS hashtags
    FROM posts p
    LEFT JOIN post_hashtags ph ON ph.post_id = p.id
    LEFT JOIN hashtags h ON h.id = ph.hashtag_id
    WHERE p.id = ? AND p.user_id = ?
    GROUP BY p.id
    `,
    [postId, userId],
    (err, row) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '글 조회 중 DB 오류가 발생했습니다.' });
      }

      if (!row) {
        return res
          .status(404)
          .json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });
      }

      const tags = row.hashtags
        ? row.hashtags.split(',').filter((t) => t && t.length > 0)
        : [];

      return res.json({
        ok: true,
        message: '편집용 글 정보를 불러왔습니다.',
        post: {
          id: row.id,
          title: row.title,
          content: row.content,
          content_pages: parseStoredContentPages(row.content_pages),
          layout_json: row.layout_json || null,
          category: row.category,
          visibility: normalizeVisibility(row.visibility),
          comment_policy: normalizeCommentPolicy(row.comment_policy),
          created_at: normalizeUtcDateTime(row.created_at),
          hashtags: tags,
        },
      });
    }
  );
});


// 9-8) 글 삭제
router.delete('/posts/:id', authRequired, (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;
  const isAdmin = !!req.user.isAdmin;

  db.get('SELECT user_id FROM posts WHERE id = ?', [postId], (err, row) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ ok: false, message: '글 조회 중 DB 오류가 발생했습니다.' });
    }

    if (!row) {
      return res
        .status(404)
        .json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });
    }

    if (!isAdmin && row.user_id !== userId) {
      return res
        .status(403)
        .json({ ok: false, message: '이 글을 삭제할 권한이 없습니다.' });
    }

    db.run('DELETE FROM posts WHERE id = ?', [postId], function (err2) {
      if (err2) {
        console.error(err2);
        return res
          .status(500)
          .json({ ok: false, message: '글 삭제 중 DB 오류가 발생했습니다.' });
      }

      if (this.changes === 0) {
        return res
          .status(404)
          .json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });
      }

      return res.json({ ok: true, message: '글이 삭제되었습니다.' });
    });
  });
});

// 9-9) 좋아요 토글
// - 이미 누른 경우 삭제, 아니면 추가 후 현재 좋아요 수 반환
router.post('/posts/:id/toggle-like', authRequired, (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;

  db.get('SELECT user_id, title FROM posts WHERE id = ?', [postId], (postErr, post) => {
    if (postErr) {
      console.error(postErr);
      return res.status(500).json({
        ok: false,
        message: '글 조회 중 오류가 발생했습니다.',
      });
    }
    if (!post) {
      return res.status(404).json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });
    }

    db.get(
      'SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?',
      [userId, postId],
      (err, row) => {
        if (err) {
          console.error(err);
          return res.status(500).json({
            ok: false,
            message: '좋아요 상태 확인 중 DB 오류가 발생했습니다.',
          });
        }

        if (row) {
          db.run(
            'DELETE FROM likes WHERE user_id = ? AND post_id = ?',
            [userId, postId],
            function (err2) {
              if (err2) {
                console.error(err2);
                return res.status(500).json({
                  ok: false,
                  message: '좋아요 취소 중 DB 오류가 발생했습니다.',
                });
              }

              db.get(
                'SELECT COUNT(*) AS cnt FROM likes WHERE post_id = ?',
                [postId],
                (err3, row2) => {
                  if (err3) {
                    console.error(err3);
                    return res.status(500).json({
                      ok: false,
                      message: '좋아요 수 조회 중 DB 오류가 발생했습니다.',
                    });
                  }

                  return res.json({
                    ok: true,
                    message: '좋아요 상태가 업데이트되었습니다.',
                    liked: false,
                    like_count: row2.cnt || 0,
                  });
                }
              );
            }
          );
        } else {
          db.run(
            'INSERT INTO likes (user_id, post_id) VALUES (?, ?)',
            [userId, postId],
            function (err2) {
              if (err2) {
                console.error(err2);
                return res.status(500).json({
                  ok: false,
                  message: '좋아요 추가 중 DB 오류가 발생했습니다.',
                });
              }

              db.get(
                'SELECT COUNT(*) AS cnt FROM likes WHERE post_id = ?',
                [postId],
                async (err3, row2) => {
                  if (err3) {
                    console.error(err3);
                    return res.status(500).json({
                      ok: false,
                      message: '좋아요 수 조회 중 DB 오류가 발생했습니다.',
                    });
                  }

                  try {
                    await handleLikeAdded(userId, post.user_id, postId);
                  } catch (growthErr) {
                    console.error('like growth 처리 실패:', growthErr);
                  }

                  try {
                    await createActivityEvent({
                      recipientUserId: post.user_id,
                      actorUserId: userId,
                      eventType: ACTIVITY_TYPES.POST_LIKED,
                      postId,
                      postTitle: post.title,
                      uniqueKey: `post_liked:${postId}:${userId}`,
                    });
                  } catch (activityErr) {
                    console.error('like activity 처리 실패:', activityErr);
                  }

                  return res.json({
                    ok: true,
                    message: '좋아요 상태가 업데이트되었습니다.',
                    liked: true,
                    like_count: row2.cnt || 0,
                  });
                }
              );
            }
          );
        }
      }
    );
  });
});

router.post('/posts/:id/report', authRequired, async (req, res) => {
  const postId = parseId(req.params.id);
  const reporterId = req.user.id;

  if (!postId) {
    return res.status(400).json({ ok: false, message: '잘못된 글 ID입니다.' });
  }

  try {
    const post = await getPostSafetySummary(postId);
    if (!post) {
      return res.status(404).json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });
    }

    const author = await getActiveUserSummary(post.author_id);
    if (!author) {
      return res.status(404).json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });
    }

    const payload = parseSafetyRequestPayload(req.body, {
      defaultReasonCode: 'other',
    });
    const report = await createSafetyReport({
      reporterId,
      targetType: 'post',
      targetPostId: postId,
      targetUserId: post.author_id,
      reasonCode: payload.reasonCode,
      detail: payload.detail,
    });

    return res.json({
      ok: true,
      message:
        '신고가 접수되었습니다. 운영팀이 검토 후 24시간 내 조치합니다. 위반 시 콘텐츠 삭제 및 계정 제재가 이루어질 수 있습니다.',
      report_id: report?.id || null,
      status: report?.status || 'queued',
    });
  } catch (error) {
    if (isSafetyValidationError(error)) {
      return res.status(400).json({
        ok: false,
        message: error.message,
      });
    }
    console.error('[posts/report] failed:', error);
    return res.status(500).json({
      ok: false,
      message: '게시글 신고를 접수하지 못했어요. 잠시 후 다시 시도해주세요.',
    });
  }
});

// 9-10) 공개 글 상세 조회 (좋아요 개수 + 내가 눌렀는지 여부까지)
// - ✅ 표준:  GET /api/posts/:id
function handlePublicPostDetail(req, res) {
  const postId = parseInt(req.params.id, 10);
  if (!postId) {
    return res
      .status(400)
      .json({ ok: false, message: '잘못된 글 ID입니다.' });
  }

  // 로그인 유저(있으면 user_liked 계산)
  const userId = getOptionalUserId(req);
  const detailConditions = ['p.id = ?'];
  const detailParams = [postId];
  appendViewerBlockedAuthorCondition(detailConditions, detailParams, userId, 'p.user_id');

  const baseSelect = `
    SELECT
      p.id,
      p.title,
      p.content,
      p.layout_json,
      p.content_pages,
      ${CATEGORY_SQL} AS category,
      ${VISIBILITY_SQL} AS visibility,
      ${COMMENT_POLICY_SQL} AS comment_policy,
      p.created_at,
      u.id       AS author_id,
      u.name     AS author_name,
      u.nickname AS author_nickname,
      u.email    AS author_email,
      u.profile_photo_url AS author_profile_photo_url,
      u.profile_photo_thumbnail_url AS author_profile_photo_thumbnail_url,
      COALESCE(u.account_status, 'active') AS author_account_status,
      ci.key AS author_primary_badge_key,
      ci.name AS author_primary_badge_name,
	      ci.icon_emoji AS author_primary_badge_icon_emoji,
	      COALESCE(ci.rarity, 'common') AS author_primary_badge_rarity,
	      ci.season AS author_primary_badge_season,
	      pbi.key AS author_profile_background_key,
	      pbi.name AS author_profile_background_name,
	      pbi.icon_emoji AS author_profile_background_icon_emoji,
	      COALESCE(pbi.rarity, 'common') AS author_profile_background_rarity,
	      pbi.season AS author_profile_background_season,
	      pbi.meta_json AS author_profile_background_meta_json,
	      IFNULL(l.like_count, 0) AS like_count,
      GROUP_CONCAT(DISTINCT h.name) AS hashtags
    FROM posts p
    JOIN users u ON p.user_id = u.id
    LEFT JOIN user_profile_cosmetics upc ON upc.user_id = u.id
	    LEFT JOIN cosmetic_items ci
	      ON ci.key = upc.primary_badge_key
	     AND ci.type = 'badge'
	     AND ci.is_active = 1
	    LEFT JOIN profile_background_items pbi
	      ON pbi.key = upc.profile_background_key
	     AND pbi.is_active = 1
	    LEFT JOIN (
      SELECT post_id, COUNT(*) AS like_count
      FROM likes
      GROUP BY post_id
    ) l ON l.post_id = p.id
    LEFT JOIN post_hashtags ph ON ph.post_id = p.id
    LEFT JOIN hashtags h ON h.id = ph.hashtag_id
    WHERE ${detailConditions.join(' AND ')}
    GROUP BY p.id
  `;

  let sql;
  let params;

  if (userId) {
    sql = `
      SELECT sub.*,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM likes l2
            WHERE l2.post_id = sub.id AND l2.user_id = ?
          ) THEN 1 ELSE 0
        END AS user_liked
      FROM (${baseSelect}) AS sub
    `;
    params = [userId, ...detailParams];
  } else {
    sql = `
      SELECT sub.*, 0 AS user_liked
      FROM (${baseSelect}) AS sub
    `;
    params = detailParams;
  }

  db.get(sql, params, async (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        ok: false,
        message: '글 상세 조회 중 DB 오류가 발생했습니다.',
      });
    }

    if (!row) {
      return res.status(404).json({
        ok: false,
        message: '해당 글을 찾을 수 없습니다.',
      });
    }

    const canRead = await canViewerReadPost({ viewerId: userId, post: row });
    if (!canRead) {
      return res.status(403).json({
        ok: false,
        code: 'POST_VISIBILITY_RESTRICTED',
        message: '이 글을 볼 수 있는 권한이 없습니다.',
      });
    }
    const canComment = await canViewerCommentOnPost({ viewerId: userId, post: row });

    const hashtags = row.hashtags
      ? row.hashtags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    try {
      const normalizedRow = await normalizePublicPostRow(row, {
        includeNestedPages: true,
      });

      return res.json({
        ok: true,
        message: '글 상세 정보를 불러왔습니다.',
        post: {
          id: normalizedRow.id,
          title: normalizedRow.title,
          content: normalizedRow.content,
          layout_json: normalizedRow.layout_json || null,
          category: normalizedRow.category,
          visibility: normalizeVisibility(normalizedRow.visibility),
          comment_policy: normalizeCommentPolicy(normalizedRow.comment_policy),
          created_at: normalizedRow.created_at,
          author_id: normalizedRow.author_id,
          author_display_name: normalizedRow.author_display_name,
          author_name: normalizedRow.author_name,
          author_nickname: normalizedRow.author_nickname,
          author_email: normalizedRow.author_email,
          author_profile_photo_url: normalizedRow.author_profile_photo_url || null,
          author_profile_photo_thumbnail_url:
            normalizedRow.author_profile_photo_thumbnail_url || null,
          author_profile_cosmetics: normalizedRow.author_profile_cosmetics,
          author_primary_badge_key: normalizedRow.author_primary_badge_key || null,
          author_primary_badge_name: normalizedRow.author_primary_badge_name || null,
          author_primary_badge_icon_emoji: normalizedRow.author_primary_badge_icon_emoji || null,
          author_primary_badge_rarity: normalizedRow.author_primary_badge_rarity || null,
          author_primary_badge_season: normalizedRow.author_primary_badge_season || null,
          like_count: normalizedRow.like_count,
          user_liked: normalizedRow.user_liked ? 1 : 0,
          hashtags,
          image_url: normalizedRow.image_url,
          primary_image: normalizedRow.primary_image,
          images: normalizedRow.images,
          has_multiple: normalizedRow.has_multiple,
          render_images: normalizedRow.render_images,
          viewer: {
            can_read: true,
            can_comment: canComment,
            is_author: Boolean(userId && Number(userId) === Number(normalizedRow.author_id)),
            visibility_reason: normalizeVisibility(normalizedRow.visibility),
          },
        },
      });
    } catch (normalizeError) {
      console.error(normalizeError);
      return res.status(500).json({
        ok: false,
        message: '글 상세 응답 가공 중 오류가 발생했습니다.',
      });
    }
  });
}


// ✅ 표준 공개 상세
router.get('/posts/:id', authOptional, handlePublicPostDetail);

module.exports = router;
