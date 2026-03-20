(function attachReadingMode(global) {
  const CATEGORY_MAP = new Set(['short', 'poem', 'essay']);
  const ALIGNMENT_MAP = new Set(['auto', 'left', 'center']);

  const PRESET_MAP = {
    serif: {
      key: 'serif',
      name: '고요한 책장',
      description: '명조 톤과 넉넉한 여백으로 차분하게 읽히는 분위기',
      className: 'is-preset-serif',
    },
    sans: {
      key: 'sans',
      name: '담백한 기록',
      description: '고딕 톤으로 깔끔하고 또렷하게 읽히는 분위기',
      className: 'is-preset-sans',
    },
    hand: {
      key: 'hand',
      name: '새벽 메모',
      description: '손글씨 느낌으로 가까운 메모처럼 읽히는 분위기',
      className: 'is-preset-hand',
    },
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeCategory(category) {
    const normalized = String(category || '').trim().toLowerCase();
    return CATEGORY_MAP.has(normalized) ? normalized : 'short';
  }

  function normalizeFontKey(fontKey) {
    const normalized = String(fontKey || '').trim().toLowerCase();
    return PRESET_MAP[normalized] ? normalized : 'serif';
  }

  function normalizeAlignment(alignment) {
    const normalized = String(alignment || '').trim().toLowerCase();
    return ALIGNMENT_MAP.has(normalized) ? normalized : 'auto';
  }

  function decodeHtmlToText(value) {
    const raw = String(value || '').replace(/<!--FONT:[\s\S]*?-->/g, '');
    if (!raw.trim()) return '';

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(raw, 'text/html');
      const blockTexts = [];

      Array.from(doc.body.childNodes || []).forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = String(node.textContent || '').trim();
          if (text) blockTexts.push(text);
          return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) return;

        if (node.tagName === 'P' || node.tagName === 'DIV' || node.tagName === 'LI' || node.tagName === 'BLOCKQUOTE') {
          const html = node.innerHTML.replace(/<br\s*\/?>/gi, '\n');
          const text = html.replace(/<[^>]+>/g, '').replace(/\u00a0/g, ' ');
          blockTexts.push(text);
          return;
        }

        const fallback = String(node.textContent || '').trim();
        if (fallback) blockTexts.push(fallback);
      });

      return blockTexts
        .join('\n')
        .replace(/\r/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    } catch (_error) {
      return raw.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  function detectCategoryFromText(text) {
    const normalized = String(text || '').replace(/\r/g, '').trim();
    if (!normalized) {
      return {
        category: 'short',
        reason: '텍스트가 짧아 한 구절처럼 보입니다.',
      };
    }

    const lines = normalized.split('\n');
    const nonEmptyLines = lines.map((line) => line.trim()).filter(Boolean);
    const chars = normalized.replace(/\s+/g, '').length;
    const avgLineLength = nonEmptyLines.length
      ? nonEmptyLines.reduce((sum, line) => sum + line.length, 0) / nonEmptyLines.length
      : chars;
    const lineBreakRatio = normalized.length ? (lines.length - 1) / normalized.length : 0;
    const paragraphCount = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean).length;

    if (chars <= 68 && nonEmptyLines.length <= 4) {
      return {
        category: 'short',
        reason: '짧은 문장이 중심이라 한 구절 형태에 가깝습니다.',
      };
    }

    if (
      nonEmptyLines.length >= 4 &&
      avgLineLength <= 20 &&
      (lineBreakRatio >= 0.04 || paragraphCount >= 2)
    ) {
      return {
        category: 'poem',
        reason: '줄바꿈 비율이 높아 운문처럼 읽힙니다.',
      };
    }

    return {
      category: 'essay',
      reason: '문단 중심 구조라 산문으로 읽히는 편이 자연스럽습니다.',
    };
  }

  function buildParagraphHtml(text) {
    return String(text || '')
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  function sentenceSplit(paragraph) {
    const source = String(paragraph || '').trim();
    if (!source) return [];
    const parts = source.match(/[^.!?]+[.!?]?/g);
    if (!parts || parts.length === 1) return [source];
    return parts.map((item) => item.trim()).filter(Boolean);
  }

  function splitEssayPages(text) {
    const rawParagraphs = String(text || '')
      .split(/\n{2,}/)
      .map((item) => item.trim())
      .filter(Boolean);
    const paragraphs = [];

    rawParagraphs.forEach((paragraph) => {
      if (paragraph.length <= 140) {
        paragraphs.push(paragraph);
        return;
      }
      const sentences = sentenceSplit(paragraph);
      if (sentences.length <= 1) {
        paragraphs.push(paragraph);
        return;
      }
      let chunk = '';
      sentences.forEach((sentence) => {
        const candidate = chunk ? `${chunk} ${sentence}` : sentence;
        if (candidate.length > 120 && chunk) {
          paragraphs.push(chunk);
          chunk = sentence;
        } else {
          chunk = candidate;
        }
      });
      if (chunk) paragraphs.push(chunk);
    });

    const pages = [];
    let current = [];
    let currentChars = 0;

    paragraphs.forEach((paragraph, index) => {
      const limit = pages.length === 0 ? 118 : 150;
      const paragraphWeight = paragraph.length + (current.length ? 10 : 0);
      const shouldPush =
        current.length > 0 && (currentChars + paragraphWeight > limit || current.length >= 2);

      if (shouldPush) {
        pages.push(current.slice());
        current = [];
        currentChars = 0;
      }

      current.push(paragraph);
      currentChars += paragraphWeight;

      if (index === paragraphs.length - 1 && current.length) {
        pages.push(current.slice());
      }
    });

    if (!pages.length) {
      pages.push([String(text || '').trim()]);
    }

    return pages
      .map((items) => items.filter(Boolean))
      .filter((items) => items.length)
      .map((items, index, all) => {
        const pageText = items.join('\n\n');
        return {
          index,
          plainText: pageText,
          contentHtml: buildParagraphHtml(pageText),
          densityScore: Math.min(1, pageText.length / 155),
          lineCount: pageText.split('\n').filter(Boolean).length,
          isLast: index === all.length - 1,
        };
      });
  }

  function splitPoemPages(text) {
    const stanzas = String(text || '')
      .split(/\n{2,}/)
      .map((stanza) =>
        stanza
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
      )
      .filter((stanza) => stanza.length);

    const pages = [];
    let currentLines = [];
    let currentChars = 0;

    const pushCurrent = () => {
      if (!currentLines.length) return;
      const pageText = currentLines.join('\n');
      pages.push({
        index: pages.length,
        plainText: pageText,
        contentHtml: `<p>${escapeHtml(pageText).replace(/\n/g, '<br>')}</p>`,
        densityScore: Math.min(1, currentLines.length / 10),
        lineCount: currentLines.length,
      });
      currentLines = [];
      currentChars = 0;
    };

    stanzas.forEach((stanza, stanzaIndex) => {
      const stanzaChars = stanza.join('').length;
      const additionalLines = stanza.length + (currentLines.length ? 1 : 0);
      const shouldPush =
        currentLines.length > 0 &&
        (currentLines.length + additionalLines > 10 || currentChars + stanzaChars > 116);

      if (shouldPush) {
        pushCurrent();
      }

      if (currentLines.length) {
        currentLines.push('');
      }

      stanza.forEach((line) => {
        if (currentLines.length >= 11) {
          pushCurrent();
        }
        currentLines.push(line);
        currentChars += line.length;
      });

      if (stanzaIndex === stanzas.length - 1) {
        pushCurrent();
      }
    });

    if (!pages.length) {
      const fallbackText = String(text || '').trim();
      pages.push({
        index: 0,
        plainText: fallbackText,
        contentHtml: `<p>${escapeHtml(fallbackText).replace(/\n/g, '<br>')}</p>`,
        densityScore: 0.4,
        lineCount: fallbackText.split('\n').filter(Boolean).length,
      });
    }

    return pages;
  }

  function splitShortPages(text) {
    const lines = String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const pages = [];
    let current = [];

    lines.forEach((line) => {
      const currentChars = current.join('').length;
      const nextChars = currentChars + line.length;
      if (current.length >= 4 || (current.length > 0 && nextChars > 72)) {
        const pageText = current.join('\n');
        pages.push({
          index: pages.length,
          plainText: pageText,
          contentHtml: `<p>${escapeHtml(pageText).replace(/\n/g, '<br>')}</p>`,
          densityScore: Math.min(1, current.length / 4),
          lineCount: current.length,
        });
        current = [];
      }
      current.push(line);
    });

    if (current.length) {
      const pageText = current.join('\n');
      pages.push({
        index: pages.length,
        plainText: pageText,
        contentHtml: `<p>${escapeHtml(pageText).replace(/\n/g, '<br>')}</p>`,
        densityScore: Math.min(1, current.length / 4),
        lineCount: current.length,
      });
    }

    if (!pages.length) {
      const fallbackText = String(text || '').trim();
      pages.push({
        index: 0,
        plainText: fallbackText,
        contentHtml: `<p>${escapeHtml(fallbackText).replace(/\n/g, '<br>')}</p>`,
        densityScore: 0.3,
        lineCount: fallbackText ? 1 : 0,
      });
    }

    return pages;
  }

  function splitIntoPages(options = {}) {
    const title = String(options.title || '').trim();
    const text = String(options.plainText || options.text || '').replace(/\r/g, '').trim();
    const category = normalizeCategory(options.category);
    const fontKey = normalizeFontKey(options.fontKey);
    const recommendedAlign = resolveRecommendedAlignment(category, text);
    const alignmentMode = normalizeAlignment(options.alignment);
    const effectiveAlign = alignmentMode === 'auto' ? recommendedAlign : alignmentMode;
    let pages = [];

    if (category === 'essay') {
      pages = splitEssayPages(text);
    } else if (category === 'poem') {
      pages = splitPoemPages(text);
    } else {
      pages = splitShortPages(text);
    }

    return pages.map((page, index, all) => ({
      ...page,
      id: `page-${index + 1}`,
      title: category === 'short' ? '' : index === 0 ? title : '',
      pageNumber: index + 1,
      totalPages: all.length,
      fontKey,
      category,
      align: effectiveAlign,
      alignmentMode,
      recommendedAlign,
      layoutMode: category,
      isLast: index === all.length - 1,
      isFirst: index === 0,
    }));
  }

  function analyzeReading(options = {}) {
    const plainText = String(options.plainText || '').trim();
    const recommended = detectCategoryFromText(plainText);
    const activeCategory = normalizeCategory(options.category || recommended.category);
    const recommendedAlign = resolveRecommendedAlignment(activeCategory, plainText);
    const alignmentMode = normalizeAlignment(options.alignment);
    const pages = splitIntoPages({
      title: options.title,
      plainText,
      category: activeCategory,
      fontKey: options.fontKey,
      alignment: alignmentMode,
    });

    const messages = [];

    if (recommended.category !== activeCategory) {
      messages.push(`자동 감지는 ${labelForCategory(recommended.category)}에 더 가깝게 보고 있어요.`);
    } else if (activeCategory === 'short' && pages[0]?.lineCount <= 3) {
      messages.push('여백이 좋아서 한 구절처럼 편하게 읽혀요.');
    } else if (activeCategory === 'poem') {
      messages.push('줄바꿈 리듬이 살아 있어서 운문처럼 잘 보이고 있어요.');
    } else {
      messages.push(`이 글은 ${pages.length}장의 카드로 나뉘어 차분하게 읽힐 수 있어요.`);
    }

    const densePage = pages.find((page) => page.densityScore >= 0.88);
    if (densePage) {
      messages.push(`${densePage.pageNumber}페이지가 조금 빽빽해 보여요. 문단을 한 번 나누면 더 편하게 읽혀요.`);
    }

    const firstSentence = plainText.match(/[^.!?]+[.!?]?/);
    if (firstSentence && firstSentence[0].trim().length >= 58) {
      messages.push('첫 문장이 조금 길어요. 앞부분을 나누면 첫 장이 더 가볍게 시작돼요.');
    }

    return {
      recommendedCategory: recommended.category,
      recommendedReason: recommended.reason,
      recommendedAlign,
      alignment: alignmentMode === 'auto' ? recommendedAlign : alignmentMode,
      alignmentMode,
      category: activeCategory,
      pages,
      feedback: Array.from(new Set(messages)).slice(0, 3),
    };
  }

  function resolveRecommendedAlignment(category, text = '') {
    const normalizedCategory = normalizeCategory(category);
    if (normalizedCategory === 'short') return 'center';
    if (normalizedCategory === 'essay') return 'left';

    const lines = String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length <= 2) return 'center';
    return 'left';
  }

  function labelForCategory(category) {
    if (category === 'poem') return '운문';
    if (category === 'essay') return '산문';
    return '한 구절';
  }

  function getPreset(fontKey) {
    return PRESET_MAP[normalizeFontKey(fontKey)];
  }

  global.GlsReadingMode = {
    analyzeReading,
    decodeHtmlToText,
    detectCategoryFromText,
    getPreset,
    labelForCategory,
    normalizeCategory,
    normalizeAlignment,
    normalizeFontKey,
    resolveRecommendedAlignment,
    splitIntoPages,
  };
})(window);
