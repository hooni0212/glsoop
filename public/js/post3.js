document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const postId = params.get('postId');

  const titleEl = document.getElementById('post3Title');
  const descriptionEl = document.getElementById('post3Description');
  const categoryChipEl = document.getElementById('post3CategoryChip');
  const pageCountEl = document.getElementById('post3PageCount');
  const dateChipEl = document.getElementById('post3DateChip');
  const currentPageEl = document.getElementById('post3CurrentPage');
  const currentTotalEl = document.getElementById('post3CurrentTotal');
  const feedbackEl = document.getElementById('post3Feedback');
  const stageEl = document.getElementById('post3Stage');
  const thumbsEl = document.getElementById('post3Thumbs');
  const linearViewEl = document.getElementById('post3LinearView');
  const cardsViewEl = document.getElementById('post3CardsView');
  const prevBtn = document.getElementById('post3PrevBtn');
  const nextBtn = document.getElementById('post3NextBtn');
  const authorEl = document.getElementById('post3Author');
  const metaRowEl = document.getElementById('post3MetaRow');
  const tagsEl = document.getElementById('post3Tags');
  const likeBtn = document.getElementById('post3LikeBtn');
  const likeCountEl = document.getElementById('post3LikeCount');
  const bookmarkBtn = document.getElementById('post3BookmarkBtn');
  const shareBtn = document.getElementById('post3ShareBtn');
  const safetyBtn = document.getElementById('post3SafetyBtn');
  const legacyLinkEl = document.getElementById('post3LegacyLink');
  const proxyMountEl = document.getElementById('post3ProxyCardMount');
  const relatedHighlightEl = document.getElementById('post3RelatedHighlight');
  const relatedListEl = document.getElementById('post3RelatedList');
  const modeButtons = Array.from(document.querySelectorAll('[data-read-mode]'));

  if (!postId || !window.GlsReadingMode || !window.GlsCardRenderer || !stageEl) {
    if (stageEl) {
      stageEl.innerHTML = '<p class="gls-text-muted">글 정보를 찾을 수 없습니다.</p>';
    }
    return;
  }

  let post = null;
  let pages = [];
  let documentModel = null;
  let currentPageIndex = 0;
  let readMode = 'cards';
  let fontKey = 'serif';
  let alignmentMode = 'auto';
  let proxyCard = null;

  const DEFAULT_LAYOUT_BOXES = {
    title_box: { x: 0.336, y: 0.256, w: 0.424, h: 0.122, align: 'center', font_scale: 1, line_height: 1.15 },
    text_box: { x: 0.336, y: 0.364, w: 0.424, h: 0.346, align: 'center', font_scale: 1, line_height: 1.15 },
    footer_box: { x: 0.78, y: 0.9, w: 0.16, h: 0.06, align: 'right', font_scale: 1, line_height: 1.1 },
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function trackUxEvent(eventName, properties = {}, options = {}) {
    if (!window.glsoopAnalytics || typeof window.glsoopAnalytics.trackEvent !== 'function') return;
    window.glsoopAnalytics.trackEvent(eventName, properties, options);
  }

  function normalizeTemplateKey(value) {
    return value === 'paper02' ? 'paper02' : 'paper01';
  }

  function extractTemplateFromLayout(raw) {
    const layout = parseLayoutJson(raw);
    return normalizeTemplateKey(layout?.canvas?.presetId);
  }

  function buildPreviewImageUrl(page) {
    const query = new URLSearchParams();
    query.set('title', page?.title || '');
    query.set('content', page?.contentHtml || '');
    query.set('category', page?.category || 'short');
    query.set('template', extractTemplateFromLayout(post?.layout_json));
    query.set('scale', '2');
    const layout = buildLayoutPayload(page?.align || 'center', parseLayoutJson(post?.layout_json));
    query.set('layout_x', String(layout.text_box.x));
    query.set('layout_y', String(layout.text_box.y));
    query.set('layout_w', String(layout.text_box.w));
    query.set('layout_h', String(layout.text_box.h));
    query.set('layout_align', String(layout.text_box.align));
    query.set('layout_font_scale', String(layout.text_box.font_scale));
    query.set('layout_line_height', String(layout.text_box.line_height));
    query.set('layout_title_x', String(layout.title_box.x));
    query.set('layout_title_y', String(layout.title_box.y));
    query.set('layout_title_w', String(layout.title_box.w));
    query.set('layout_title_h', String(layout.title_box.h));
    query.set('layout_title_align', String(layout.title_box.align));
    query.set('layout_title_font_scale', String(layout.title_box.font_scale));
    query.set('layout_title_line_height', String(layout.title_box.line_height));
    query.set('layout_footer_x', String(layout.footer_box.x));
    query.set('layout_footer_y', String(layout.footer_box.y));
    query.set('layout_footer_w', String(layout.footer_box.w));
    query.set('layout_footer_h', String(layout.footer_box.h));
    query.set('layout_footer_align', String(layout.footer_box.align));
    query.set('layout_footer_font_scale', String(layout.footer_box.font_scale));
    query.set('layout_footer_line_height', String(layout.footer_box.line_height));
    return `/api/feed-images/preview?${query.toString()}`;
  }

  function parseLayoutJson(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    if (typeof raw !== 'string') return null;
    try {
      return JSON.parse(raw);
    } catch (_error) {
      return null;
    }
  }

  function buildLayoutPayload(alignment, existingLayout = null) {
    const layout = existingLayout && typeof existingLayout === 'object' ? existingLayout : {};
    return {
      layout_version: 1,
      unit: 'normalized',
      canvas: {
        presetId: normalizeTemplateKey(layout.canvas?.presetId),
      },
      title_box: {
        ...DEFAULT_LAYOUT_BOXES.title_box,
        ...(layout.title_box && typeof layout.title_box === 'object' ? layout.title_box : {}),
        align: 'center',
      },
      text_box: {
        ...DEFAULT_LAYOUT_BOXES.text_box,
        ...(layout.text_box && typeof layout.text_box === 'object' ? layout.text_box : {}),
        align: alignment,
      },
      footer_box: {
        ...DEFAULT_LAYOUT_BOXES.footer_box,
        ...(layout.footer_box && typeof layout.footer_box === 'object' ? layout.footer_box : {}),
        align: 'right',
      },
    };
  }

  function truncateText(value, maxLength = 34) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}…`;
  }

  function buildRelatedSnippet(rawContent, maxLength = 80) {
    const text = window.GlsReadingMode.decodeHtmlToText(rawContent || '');
    return truncateText(text, maxLength);
  }

  function buildParagraphHtml(text) {
    return String(text || '')
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  function normalizeManualContentPages(rawPages) {
    if (!Array.isArray(rawPages)) return [];
    const pages = rawPages
      .map((page) => {
        const decoded = window.GlsReadingMode.decodeHtmlToText(page || '');
        return String(decoded || page || '').replace(/\r/g, '').trim();
      })
      .slice(0, 24);

    while (pages.length > 1 && !pages[pages.length - 1]) {
      pages.pop();
    }

    return pages.some(Boolean) ? pages : [];
  }

  function buildManualDocumentModel({
    title,
    contentPages,
    category,
    fontKey,
    alignment,
  }) {
    const normalizedCategory = window.GlsReadingMode.normalizeCategory(category || 'short');
    const alignmentMode = window.GlsReadingMode.normalizeAlignment(alignment || 'auto');
    const joinedText = contentPages.join('\n\n');
    const recommendedAlign = window.GlsReadingMode.resolveRecommendedAlignment(
      normalizedCategory,
      joinedText
    );
    const effectiveAlign = alignmentMode === 'auto' ? recommendedAlign : alignmentMode;
    const totalPages = Math.max(1, contentPages.length);
    const manualPages = contentPages.map((pageText, index) => {
      const lines = pageText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      return {
        index,
        plainText: pageText,
        contentHtml: buildParagraphHtml(pageText) || '<p></p>',
        densityScore: Math.min(1, pageText.replace(/\s+/g, '').length / 155),
        lineCount: lines.length,
        id: `page-${index + 1}`,
        title: normalizedCategory === 'short' ? '' : index === 0 ? title : '',
        pageNumber: index + 1,
        totalPages,
        fontKey,
        category: normalizedCategory,
        align: effectiveAlign,
        alignmentMode,
        recommendedAlign,
        layoutMode: normalizedCategory,
        isLast: index === totalPages - 1,
        isFirst: index === 0,
      };
    });

    return {
      pages: manualPages,
      alignment: alignmentMode === 'auto' ? 'recommended' : alignmentMode,
      resolvedAlignment: effectiveAlign,
      recommendedAlignment: recommendedAlign,
      type: normalizedCategory === 'essay' ? 'prose' : normalizedCategory,
      category: normalizedCategory,
      fontKey,
      feedback: [
        totalPages > 1
          ? `작성 시 저장된 ${totalPages}장의 페이지 경계를 그대로 보여줘요.`
          : '작성 시 저장된 한 장 구성을 그대로 보여줘요.',
      ],
      recommendedCategory: normalizedCategory,
      recommendedReason: '저장된 페이지 경계를 우선합니다.',
    };
  }

  function buildPermalink(id) {
    return `${window.location.origin}/html/post3.html?postId=${encodeURIComponent(id)}`;
  }

  function downloadCurrentPageImage() {
    const page = pages[currentPageIndex];
    if (!page) return;
    const imageUrl = buildPreviewImageUrl(page);
    fetch(imageUrl, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`이미지 요청 실패: ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = `glsoop_post_${post?.id || 'card'}_${page.pageNumber}.webp`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(objectUrl);
      })
      .catch((error) => {
        console.error(error);
        alert('이미지 저장 중 오류가 발생했습니다.');
      });
  }

  function shareCurrentPage() {
    const permalink = buildPermalink(post?.id || postId);
    const shareData = {
      title: post?.title || '글숲 글',
      text: `글숲에서 ${currentPageIndex + 1}장째를 읽고 있어요.`,
      url: permalink,
    };

    if (navigator.share) {
      navigator.share(shareData).catch((error) => {
        if (error?.name !== 'AbortError') {
          console.error(error);
        }
      });
      return;
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(permalink)
        .then(() => alert('링크를 클립보드에 복사했습니다.'))
        .catch((error) => {
          console.error(error);
          window.prompt('아래 링크를 복사해 공유하세요.', permalink);
        });
      return;
    }

    window.prompt('아래 링크를 복사해 공유하세요.', permalink);
  }

  function isViewerLikelyLoggedIn() {
    const afterLoginNav = document.querySelector('.after-login');
    if (!afterLoginNav) return false;
    return !afterLoginNav.classList.contains('is-hidden');
  }

  function ensurePost3SafetyMenuModal() {
    if (document.getElementById('post3SafetyMenuModal')) return;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="modal fade" id="post3SafetyMenuModal" tabindex="-1" aria-labelledby="post3SafetyMenuLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content post-login-prompt-modal">
            <div class="modal-header">
              <div>
                <p class="post-login-prompt-modal__eyebrow gls-mb-1">MORE</p>
                <h5 class="modal-title" id="post3SafetyMenuLabel">더보기</h5>
              </div>
              <button type="button" class="gls-modal-close" data-gls-dismiss="modal" aria-label="닫기"></button>
            </div>
            <div class="modal-body post-login-prompt-modal__body">
              <p class="gls-mb-3" id="post3SafetyMenuDescription">
                공유, 게시글 신고, 작성자 차단, 커뮤니티 가이드라인 확인을 할 수 있습니다.
              </p>
              <div class="gls-flex gls-flex-col gls-gap-2">
                <button type="button" class="gls-btn gls-btn-secondary" id="post3SafetyShareBtn">공유하기</button>
                <button type="button" class="gls-btn gls-btn-secondary" id="post3SafetyReportBtn">게시글 신고</button>
                <button type="button" class="gls-btn gls-btn-secondary" id="post3SafetyBlockBtn">작성자 차단</button>
                <button type="button" class="gls-btn gls-btn-ghost" id="post3SafetyGuidelinesBtn">가이드라인 보기</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrapper.firstElementChild);

    const modalEl = document.getElementById('post3SafetyMenuModal');
    document.getElementById('post3SafetyShareBtn')?.addEventListener('click', () => {
      if (window.glsModal && modalEl) {
        window.glsModal.close(modalEl);
      }
      shareCurrentPage();
    });
    document.getElementById('post3SafetyReportBtn')?.addEventListener('click', async () => {
      if (window.glsModal && modalEl) {
        window.glsModal.close(modalEl);
      }
      await handlePost3Report();
    });
    document.getElementById('post3SafetyBlockBtn')?.addEventListener('click', async () => {
      if (window.glsModal && modalEl) {
        window.glsModal.close(modalEl);
      }
      await handlePost3BlockAuthor();
    });
    document.getElementById('post3SafetyGuidelinesBtn')?.addEventListener('click', async () => {
      if (window.glsModal && modalEl) {
        window.glsModal.close(modalEl);
      }
      await handlePost3Guidelines();
    });
  }

  function openPost3SafetyMenu() {
    ensurePost3SafetyMenuModal();
    const descriptionEl = document.getElementById('post3SafetyMenuDescription');
    const authorName = buildAuthorDisplay(post);
    if (descriptionEl) {
      descriptionEl.textContent = `${authorName}의 글을 공유하거나 신고하고 작성자를 차단할 수 있습니다.`;
    }
    const modalEl = document.getElementById('post3SafetyMenuModal');
    if (window.glsModal && modalEl) {
      window.glsModal.open(modalEl);
    }
  }

  function ensurePost3SafetyAccess(actionLabel) {
    if (isViewerLikelyLoggedIn()) {
      return true;
    }

    if (window.glsoopSafety && typeof window.glsoopSafety.openLoginGate === 'function') {
      window.glsoopSafety.openLoginGate({
        actionLabel,
        source: 'post3-safety',
      });
    } else if (typeof redirectToLoginWithNext === 'function') {
      redirectToLoginWithNext({
        alertMessage: `${actionLabel}은 로그인 후 이용할 수 있습니다.`,
        source: 'post3-safety',
      });
    } else {
      window.location.href = '/html/login.html';
    }
    return false;
  }

  async function handlePost3Guidelines() {
    try {
      if (window.glsoopSafety && typeof window.glsoopSafety.openGuidelines === 'function') {
        await window.glsoopSafety.openGuidelines();
        return;
      }
      window.open('/html/community-guidelines.html', '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error(error);
      alert('가이드라인을 열지 못했습니다.');
    }
  }

  async function handlePost3Report() {
    if (!post?.id) return;
    if (!ensurePost3SafetyAccess('게시글 신고')) return;

    try {
      const payload = await window.glsoopSafety?.openPrompt?.({
        targetType: 'post',
        eyebrow: 'REPORT POST',
        title: '게시글 신고',
        description: '문제가 되는 게시글이라면 사유를 선택해 신고해 주세요. 운영 검토 큐에 접수됩니다.',
        confirmLabel: '신고하기',
        detailPlaceholder: '기타 사유를 200자 이내로 적어주세요.',
      });

      if (!payload) return;

      await window.glsoopSafety.reportPost(post.id, {
        reason_code: payload.reasonCode,
        detail: payload.detail,
      });
      alert('게시글 신고가 운영 검토 큐에 접수되었습니다.');
    } catch (error) {
      console.error(error);
      if (window.glsoopSafety?.isAuthRequiredError?.(error)) {
        ensurePost3SafetyAccess('게시글 신고');
        return;
      }
      alert(error.message || '게시글 신고에 실패했습니다.');
    }
  }

  async function handlePost3BlockAuthor() {
    const authorId = post?.author_id || post?.user_id;
    if (!authorId) return;
    if (!ensurePost3SafetyAccess('작성자 차단')) return;

    try {
      const payload = await window.glsoopSafety?.openPrompt?.({
        targetType: 'user',
        eyebrow: 'BLOCK USER',
        title: '작성자 차단',
        description: `${buildAuthorDisplay(post)}을 차단하면 이 작성자의 글이 내 화면에서 숨겨집니다.`,
        confirmLabel: '차단하기',
        defaultReasonCode: 'harassment',
        detailPlaceholder: '기타 사유를 200자 이내로 적어주세요.',
      });

      if (!payload) return;

      await window.glsoopSafety.blockUser(authorId, {
        reason_code: payload.reasonCode,
        detail: payload.detail,
        context_post_id: post?.id || null,
      });
      alert('작성자를 차단했습니다. 이제 내 화면에서 이 작성자의 글과 프로필이 숨겨집니다.');
      window.location.href = '/explore';
    } catch (error) {
      console.error(error);
      if (window.glsoopSafety?.isAuthRequiredError?.(error)) {
        ensurePost3SafetyAccess('작성자 차단');
        return;
      }
      alert(error.message || '작성자 차단에 실패했습니다.');
    }
  }

  function syncActionState() {
    if (!proxyCard) return;
    const proxyLikeBtn = proxyCard.querySelector('.like-btn');
    const countEl = proxyLikeBtn?.querySelector('.like-count');
    const liked = proxyLikeBtn?.getAttribute('data-liked') === '1';
    likeBtn?.setAttribute('aria-pressed', liked ? 'true' : 'false');
    if (likeCountEl) likeCountEl.textContent = countEl ? String(countEl.textContent || '0') : '0';
  }

  function renderProxyCard() {
    if (!proxyMountEl || !post) return;
    proxyMountEl.innerHTML = buildStandardPostCardHTML(post, {
      showMoreButton: false,
      forceRenderedImage: true,
      cardClickable: false,
    });
    proxyCard = proxyMountEl.querySelector('.gls-post-card');
    if (proxyCard && typeof enhanceStandardPostCard === 'function') {
      enhanceStandardPostCard(proxyCard, post);
    }
    syncActionState();
  }

  function renderMeta() {
    if (titleEl) titleEl.textContent = post?.title || '제목 없는 글';
    if (legacyLinkEl) legacyLinkEl.href = `/html/post.html?postId=${encodeURIComponent(post?.id || postId)}`;
    if (authorEl) authorEl.textContent = buildAuthorDisplay(post);
    if (categoryChipEl) categoryChipEl.textContent = window.GlsReadingMode.labelForCategory(post?.category || 'short');
    if (pageCountEl) pageCountEl.textContent = String(pages.length || 1);
    if (currentPageEl) currentPageEl.textContent = String(currentPageIndex + 1);
    if (currentTotalEl) currentTotalEl.textContent = String(pages.length || 1);
    if (dateChipEl) {
      dateChipEl.textContent =
        typeof formatKoreanDateTime === 'function' ? formatKoreanDateTime(post?.created_at) : '방금 전';
    }

    if (descriptionEl) {
      descriptionEl.textContent = pages.length > 1
        ? `총 ${pages.length}장의 카드로 나뉘어 있어 한 장씩 넘기며 읽을 수 있어요.`
        : '한 장에 머무르는 여백 중심 읽기 시안입니다.';
    }

    if (metaRowEl) {
      const readTime = Math.max(1, Math.ceil(window.GlsReadingMode.decodeHtmlToText(post?.content || '').length / 120));
      metaRowEl.innerHTML = `
        <span class="post-chip-btn post-type-chip">${escapeHtml(window.GlsReadingMode.labelForCategory(post?.category || 'short'))}</span>
        <span class="post-chip-btn post-time-chip">${pages.length}장</span>
        <span class="post-chip-btn post-time-chip">${readTime}분 읽기</span>
      `;
    }

    if (tagsEl) {
      const tags = Array.isArray(post?.hashtags)
        ? post.hashtags
        : String(post?.hashtags || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
      tagsEl.innerHTML = tags.length
        ? tags
            .map((tag) => `<button type="button" class="post-tag-chip post-chip-btn" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`)
            .join('')
        : '<span class="post-chip-btn post-time-chip">태그 없음</span>';
      tagsEl.querySelectorAll('[data-tag]').forEach((button) => {
        button.addEventListener('click', () => {
          const tag = button.getAttribute('data-tag');
          if (!tag) return;
          window.location.href = `/explore?tag=${encodeURIComponent(tag)}`;
        });
      });
    }
  }

  function renderFeedback() {
    if (!feedbackEl) return;
    feedbackEl.innerHTML = (documentModel?.feedback || []).slice(0, 1)
      .map((item) => `<div>${escapeHtml(item)}</div>`)
      .join('');
  }

  function syncStageState() {
    if (currentPageEl) currentPageEl.textContent = String(currentPageIndex + 1);
    if (currentTotalEl) currentTotalEl.textContent = String(pages.length || 1);
    if (prevBtn) prevBtn.disabled = currentPageIndex <= 0;
    if (nextBtn) nextBtn.disabled = currentPageIndex >= pages.length - 1;
  }

  function renderCardsView() {
    if (!stageEl || !thumbsEl) return;

    stageEl.innerHTML = pages
      .map((page, index) => {
        return `
        <article class="post3-page${index === currentPageIndex ? ' is-active' : ''}" data-page-index="${index}">
          ${window.GlsCardRenderer.renderPage(page, {
            fontKey,
            frameClass: 'post3-page-frame',
            cardClass: 'post3-render-card',
            showBadge: true,
          })}
        </article>
      `;
      })
      .join('');

    thumbsEl.innerHTML = pages
      .map((page, index) => `
        <button type="button" class="post3-thumb${index === currentPageIndex ? ' is-active' : ''}" data-thumb-index="${index}" aria-label="${escapeHtml(`${page.pageNumber}장 보기`)}">
          <span class="post3-thumb__index">${page.pageNumber}장</span>
        </button>
      `)
      .join('');

    thumbsEl.querySelectorAll('[data-thumb-index]').forEach((button) => {
      button.addEventListener('click', () => {
        const nextIndex = Number.parseInt(button.dataset.thumbIndex, 10);
        if (!Number.isInteger(nextIndex)) return;
        currentPageIndex = nextIndex;
        renderCardsView();
        syncStageState();
      });
    });

    syncStageState();
  }

  function renderLinearView() {
    if (!linearViewEl) return;
    linearViewEl.innerHTML = pages
      .map((page) => {
        return `
        <article class="post3-linear-item">
          ${window.GlsCardRenderer.renderPage(page, {
            fontKey,
            frameClass: 'post3-page-frame',
            cardClass: 'post3-render-card',
            showBadge: true,
          })}
        </article>
      `;
      })
      .join('');
  }

  function renderReader() {
    const useCards = readMode === 'cards';
    cardsViewEl.hidden = !useCards;
    thumbsEl.hidden = !useCards;
    linearViewEl.hidden = useCards;

    modeButtons.forEach((button) => {
      button.classList.toggle('is-active', button.dataset.readMode === readMode);
    });

    if (useCards) {
      renderCardsView();
    } else {
      renderLinearView();
      syncStageState();
    }
  }

  async function loadPost() {
    try {
      const stored = localStorage.getItem('glsoop_lastPost');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && String(parsed.id) === String(postId)) {
          post = parsed;
        }
      }
    } catch (error) {
      console.warn('Failed to parse glsoop_lastPost', error);
    }

    try {
      const response = await fetch(`/api/posts/${encodeURIComponent(postId)}`);
      if (response.ok) {
        const data = await response.json();
        if (data.ok && data.post) {
          post = post ? { ...post, ...data.post } : data.post;
          localStorage.setItem('glsoop_lastPost', JSON.stringify(post));
        }
      }
    } catch (error) {
      console.warn('detail API 호출 실패(무시 가능)', error);
    }

    if (!post) {
      stageEl.innerHTML = '<p class="gls-text-muted">글을 불러오지 못했습니다.</p>';
      return false;
    }

    const extracted = extractFontFromContent(post.content || '');
    fontKey = window.GlsReadingMode.normalizeFontKey(extracted.fontKey || 'serif');
    const parsedLayout = parseLayoutJson(post.layout_json);
    const currentAlign = String(parsedLayout?.text_box?.align || '').trim().toLowerCase();
    alignmentMode = currentAlign === 'left' || currentAlign === 'center' ? currentAlign : 'auto';
    const manualContentPages = normalizeManualContentPages(post.content_pages);
    documentModel = manualContentPages.length
      ? buildManualDocumentModel({
          title: post.title || '',
          contentPages: manualContentPages,
          category: post.category || 'short',
          fontKey,
          alignment: alignmentMode,
        })
      : window.GlsCardRenderer.buildDocument({
          title: post.title || '',
          plainText: window.GlsReadingMode.decodeHtmlToText(extracted.cleanHtml || ''),
          category: post.category || 'short',
          fontKey,
          alignment: alignmentMode,
        });
    pages = Array.isArray(documentModel.pages) ? documentModel.pages : [];
    if (!pages.length) {
      documentModel = window.GlsCardRenderer.buildDocument({
        title: post.title || '',
        plainText: window.GlsReadingMode.decodeHtmlToText(post.content || ''),
        category: post.category || 'short',
        fontKey,
        alignment: alignmentMode,
      });
      pages = Array.isArray(documentModel.pages) ? documentModel.pages : [];
    }
    return true;
  }

  function cacheAndNavigateToDetail(nextPost) {
    if (!nextPost) return;
    try {
      localStorage.setItem('glsoop_lastPost', JSON.stringify(nextPost));
    } catch (error) {
      console.warn('failed to cache detail', error);
    }
    window.location.href = `/html/post3.html?postId=${encodeURIComponent(nextPost.id)}`;
  }

  async function loadRelatedPosts() {
    if (!post?.id || !relatedHighlightEl || !relatedListEl) return;

    try {
      const response = await fetch(`/api/posts/${encodeURIComponent(post.id)}/related?limit=8`);
      if (!response.ok) {
        throw new Error(`related ${response.status}`);
      }
      const data = await response.json();
      if (!data.ok) throw new Error('related failed');

      const items = (data.posts || []).filter((item) => String(item.id) !== String(post.id));
      if (!items.length) {
        relatedHighlightEl.innerHTML = '<p class="gls-text-muted gls-text-small gls-mb-0">아직 함께 읽어볼 만한 관련 글이 없습니다.</p>';
        relatedListEl.innerHTML = '';
        return;
      }

      const top = items[0];
      relatedHighlightEl.innerHTML = `
        <div class="post3-related-h-title">${escapeHtml(top.title || '')}</div>
        <p class="post3-related-h-snippet">${escapeHtml(buildRelatedSnippet(top.content || '', 96))}</p>
        <div class="post3-related-h-meta">
          <span>${escapeHtml(typeof formatKoreanDateTime === 'function' ? formatKoreanDateTime(top.created_at) : '')}</span>
          <span>♥ ${typeof top.like_count === 'number' ? top.like_count : 0}</span>
        </div>
      `;
      relatedHighlightEl.onclick = () => cacheAndNavigateToDetail(top);

      relatedListEl.innerHTML = items.slice(1, 7)
        .map((item) => `
          <div class="post3-related-item" data-related-id="${escapeHtml(String(item.id))}">
            <div class="post3-related-item-title">${escapeHtml(item.title || '')}</div>
            <p class="post3-related-item-snippet">${escapeHtml(buildRelatedSnippet(item.content || '', 70))}</p>
            <div class="post3-related-item-meta">
              <span>${escapeHtml(typeof formatKoreanDateTime === 'function' ? formatKoreanDateTime(item.created_at) : '')}</span>
              <span>♥ ${typeof item.like_count === 'number' ? item.like_count : 0}</span>
            </div>
          </div>
        `)
        .join('');

      relatedListEl.querySelectorAll('[data-related-id]').forEach((element) => {
        element.addEventListener('click', () => {
          const relatedId = element.getAttribute('data-related-id');
          const target = items.find((item) => String(item.id) === String(relatedId));
          if (target) cacheAndNavigateToDetail(target);
        });
      });
    } catch (error) {
      console.error(error);
      relatedHighlightEl.innerHTML = '<p class="gls-text-muted gls-text-small gls-mb-0">관련 글을 불러오는 중 오류가 발생했습니다.</p>';
      relatedListEl.innerHTML = '';
    }
  }

  modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const nextMode = button.dataset.readMode;
      if (!nextMode || nextMode === readMode) return;
      readMode = nextMode;
      trackUxEvent('post3_read_mode_change', { mode: readMode, post_id: Number(postId) || null });
      renderReader();
    });
  });

  prevBtn?.addEventListener('click', () => {
    currentPageIndex = Math.max(0, currentPageIndex - 1);
    renderCardsView();
  });

  nextBtn?.addEventListener('click', () => {
    currentPageIndex = Math.min(pages.length - 1, currentPageIndex + 1);
    renderCardsView();
  });

  likeBtn?.addEventListener('click', () => {
    trackUxEvent('post3_action_click', { action: 'like', post_id: Number(postId) || null });
    const proxyLikeBtn = proxyCard?.querySelector('.like-btn');
    if (!proxyLikeBtn) return;
    proxyLikeBtn.click();
    setTimeout(syncActionState, 0);
    setTimeout(syncActionState, 350);
  });

  bookmarkBtn?.addEventListener('click', () => {
    trackUxEvent('post3_action_click', { action: 'bookmark', post_id: Number(postId) || null });
    proxyCard?.querySelector('.post-bookmark-toggle')?.click();
  });

  shareBtn?.addEventListener('click', () => {
    trackUxEvent('post3_action_click', { action: 'share', post_id: Number(postId) || null });
    const wantsImageSave = window.confirm('확인을 누르면 현재 페이지 이미지를 저장하고, 취소를 누르면 링크를 공유합니다.');
    if (wantsImageSave) {
      downloadCurrentPageImage();
      return;
    }
    shareCurrentPage();
  });

  safetyBtn?.addEventListener('click', () => {
    trackUxEvent('post3_action_click', { action: 'safety', post_id: Number(postId) || null });
    openPost3SafetyMenu();
  });

  const loaded = await loadPost();
  if (!loaded) return;

  renderMeta();
  renderFeedback();
  renderProxyCard();
  renderReader();
  syncActionState();
  loadRelatedPosts();
});
