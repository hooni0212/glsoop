const sanitizeHtml = require('sanitize-html');

const FONT_META_REGEX = /<!--\s*FONT:(serif|sans|hand)\s*-->/i;

const SANITIZE_OPTIONS = {
  allowedTags: [
    'p',
    'br',
    'span',
    'strong',
    'em',
    'u',
    's',
    'blockquote',
    'pre',
    'code',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'a',
    'div',
  ],
  // 제한된 Quill 클래스를 allowlist하여 정렬/폰트 크기 등 기본 포맷을 유지한다.
  allowedClasses: {
    '*': [
      /^ql-align/, // ql-align-right, ql-align-center, ql-align-justify
      /^ql-indent/, // ql-indent-1 ... ql-indent-N
      /^ql-size/, // ql-size-small/large/huge
      /^ql-font/, // ql-font-serif 등
      /^ql-direction/,
    ],
  },
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    span: ['class'],
    p: ['class'],
    div: ['class'],
    code: ['class'],
    pre: ['class'],
    h1: ['class'],
    h2: ['class'],
    h3: ['class'],
    blockquote: ['class'],
    ul: ['class'],
    ol: ['class'],
    li: ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  // style 속성 및 이벤트 핸들러(on*)는 sanitize-html 기본 정책으로 제거된다.
  transformTags: {
    a: (tagName, attribs) => {
      const href = attribs.href || '';
      // javascript: 등 위험한 스킴 제거
      if (!href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('mailto:')) {
        delete attribs.href;
      }
      attribs.rel = 'noopener noreferrer';
      return { tagName, attribs };
    },
  },
  parser: {
    decodeEntities: true,
  },
};

function extractFontMeta(html = '') {
  const match = html.match(FONT_META_REGEX);
  if (!match) {
    return { meta: '', body: html };
  }

  const normalizedMeta = `<!--FONT:${match[1].toLowerCase()}-->`;
  const body = html.replace(FONT_META_REGEX, '');
  return { meta: normalizedMeta, body };
}

function sanitizePostContent(html = '') {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

function sanitizeForStorage(html = '') {
  const { meta, body } = extractFontMeta(html);
  const sanitizedBody = sanitizePostContent(body);
  return `${meta}${sanitizedBody}`;
}

module.exports = {
  sanitizePostContent,
  sanitizeForStorage,
};
