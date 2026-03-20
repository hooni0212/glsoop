(function attachCardRenderer(global) {
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeType(category) {
    if (category === 'essay') return 'prose';
    if (category === 'poem') return 'poem';
    return 'short';
  }

  function normalizeAlignmentClass(value) {
    return value === 'left' ? 'left' : 'center';
  }

  function buildDocument(options = {}) {
    if (!global.GlsReadingMode) {
      return {
        pages: [],
        alignment: 'recommended',
        resolvedAlignment: 'center',
        recommendedAlignment: 'center',
        type: 'short',
        category: 'short',
        fontKey: 'serif',
        feedback: [],
      };
    }

    const analysis = global.GlsReadingMode.analyzeReading({
      title: options.title || '',
      plainText: options.plainText || '',
      category: options.category || 'short',
      fontKey: options.fontKey || 'serif',
      alignment: options.alignment || 'auto',
    });

    return {
      pages: Array.isArray(analysis.pages) ? analysis.pages : [],
      alignment: analysis.alignmentMode === 'auto' ? 'recommended' : analysis.alignmentMode,
      resolvedAlignment: analysis.alignment || analysis.recommendedAlign || 'center',
      recommendedAlignment: analysis.recommendedAlign || 'center',
      type: normalizeType(analysis.category),
      category: analysis.category || 'short',
      fontKey: global.GlsReadingMode.normalizeFontKey(options.fontKey || 'serif'),
      feedback: Array.isArray(analysis.feedback) ? analysis.feedback : [],
      recommendedCategory: analysis.recommendedCategory || analysis.category || 'short',
      recommendedReason: analysis.recommendedReason || '',
    };
  }

  function renderPage(page, options = {}) {
    const fontKey = options.fontKey || page?.fontKey || 'serif';
    const pageType = normalizeType(page?.category || options.category || 'short');
    const align = normalizeAlignmentClass(page?.align || options.alignment || 'center');
    const frameClass = options.frameClass ? ` ${options.frameClass}` : '';
    const cardClass = options.cardClass ? ` ${options.cardClass}` : '';
    const bodyHtml = page?.contentHtml || '<p></p>';
    const titleHtml = page?.title
      ? `<header class="gls-reading-card__header"><h3 class="gls-reading-card__title">${escapeHtml(page.title)}</h3></header>`
      : '';
    const badgeHtml = options.showBadge !== false
      ? `<div class="gls-reading-card__badge">${escapeHtml(`${page?.pageNumber || 1} / ${page?.totalPages || 1}`)}</div>`
      : '';

    return `
      <article class="gls-reading-card-frame${frameClass}">
        <section class="gls-reading-card${cardClass} is-font-${escapeHtml(fontKey)} is-type-${escapeHtml(pageType)} is-align-${escapeHtml(align)}">
          <div class="gls-reading-card__paper">
            <div class="gls-reading-card__wash"></div>
            <div class="gls-reading-card__inner">
              ${titleHtml}
              <div class="gls-reading-card__body">${bodyHtml}</div>
              ${badgeHtml}
            </div>
          </div>
        </section>
      </article>
    `;
  }

  global.GlsCardRenderer = {
    buildDocument,
    renderPage,
  };
})(window);
