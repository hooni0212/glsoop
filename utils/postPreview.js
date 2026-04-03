const HTML_BREAK_RE = /<br\s*\/?>/gi;
const HTML_BLOCK_END_RE = /<\/(p|div|section|article|li|h1|h2|h3|h4|h5|h6|blockquote)>/gi;
const HTML_LIST_ITEM_RE = /<li[^>]*>/gi;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const HTML_TAG_RE = /<[^>]+>/g;

const ENTITY_MAP = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
};

function decodeHtmlEntities(value) {
  return String(value || '').replace(/&([a-zA-Z0-9#]+);/g, (match, entity) => {
    if (ENTITY_MAP[entity]) {
      return ENTITY_MAP[entity];
    }

    if (/^#x[0-9a-f]+$/i.test(entity)) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (/^#[0-9]+$/.test(entity)) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return match;
  });
}

function normalizePostPreviewText(input) {
  if (typeof input !== 'string') return '';

  const trimmed = input.trim();
  if (!trimmed) return '';

  const withBreaks = trimmed
    .replace(HTML_COMMENT_RE, '')
    .replace(HTML_BREAK_RE, '\n')
    .replace(HTML_BLOCK_END_RE, '\n')
    .replace(HTML_LIST_ITEM_RE, '- ');

  const withoutTags = withBreaks.replace(HTML_TAG_RE, ' ');
  const decoded = decodeHtmlEntities(withoutTags)
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/[ \t]{2,}/g, ' ');

  return decoded.trim();
}

function buildPostExcerpt(input, maxLength = 100) {
  const normalized = normalizePostPreviewText(input);
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

module.exports = {
  normalizePostPreviewText,
  buildPostExcerpt,
};
