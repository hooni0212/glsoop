document.addEventListener('DOMContentLoaded', async () => {
  const MAX_CONTENT_LENGTH = 200;
  const EDIT_AUTOSAVE_DEBOUNCE_MS = 1200;
  const DRAFT_SAVE_DEBOUNCE_MS = 1000;
  const PREVIEW_IMAGE_DEBOUNCE_MS = 200;
  const DRAFT_PREFIX = 'glsoop:editor2:draft';
  const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const LAYOUT_VERSION = 1;
  const LAYOUT_UNIT = 'normalized';

  const FONT_MAP = {
    serif: "'Nanum Myeongjo','Noto Serif KR',serif",
    sans: "'Noto Sans KR',system-ui,-apple-system,BlinkMacSystemFont,sans-serif",
    hand: "'Nanum Pen Script',cursive",
  };

  const FONT_LABEL_MAP = {
    serif: '감성 명조체',
    sans: '담백한 고딕체',
    hand: '손글씨 느낌',
  };

  const CUSTOM_LAYOUT_REASONS = new Set([
    'drag',
    'drag_end',
    'resize',
    'resize_end',
    'nudge',
    'style_change',
  ]);

  const postTitleEl = document.getElementById('postTitle');
  const saveBtn = document.getElementById('saveBtn');
  const discardDraftBtn = document.getElementById('discardDraftBtn');
  const hashtagsInput = document.getElementById('postHashtags');
  const fontSelectEl = document.getElementById('fontSelect');
  const categorySelectEl = document.getElementById('categorySelect');
  const charCounterEl = document.getElementById('charCounter');
  const previewMountEl = document.getElementById('previewFeedCardMount');
  const alertEl = document.getElementById('editor2Alert');
  const noticeRegionEl = document.getElementById('editor2NoticeRegion');
  const layoutToggleBtn = document.getElementById('layoutEditToggleBtn');
  const layoutResetBtn = document.getElementById('layoutResetBtn');
  const layoutPanelEl = document.getElementById('layoutPanel');
  const safeAreaHintEl = document.getElementById('layoutSafeAreaHint');
  const saveStatusEl = document.getElementById('editor2SaveStatus');
  const saveStatusTimeEl = document.getElementById('editor2SaveStatusTime');
  const lockTitleEl = document.getElementById('layoutLockTitle');
  const lockBodyEl = document.getElementById('layoutLockBody');
  const lockFooterEl = document.getElementById('layoutLockFooter');
  const hideTitleEl = document.getElementById('layoutHideTitle');
  const hideBodyEl = document.getElementById('layoutHideBody');
  const hideFooterEl = document.getElementById('layoutHideFooter');
  const fontScaleTitleEl = document.getElementById('layoutFontScaleTitle');
  const fontScaleBodyEl = document.getElementById('layoutFontScaleBody');
  const fontScaleFooterEl = document.getElementById('layoutFontScaleFooter');
  const fontScaleTitleValueEl = document.getElementById('layoutFontScaleTitleValue');
  const fontScaleBodyValueEl = document.getElementById('layoutFontScaleBodyValue');
  const fontScaleFooterValueEl = document.getElementById('layoutFontScaleFooterValue');

  if (
    !postTitleEl ||
    !saveBtn ||
    !hashtagsInput ||
    !fontSelectEl ||
    !categorySelectEl ||
    !previewMountEl ||
    !window.Quill
  ) {
    return;
  }

  let me = null;
  let postId = new URLSearchParams(window.location.search).get('postId');
  let isEditMode = Boolean(postId);
  let isSaving = false;
  let queuedAutosave = false;
  let isProgrammaticUpdate = false;
  let previewImageTimer = null;
  let previewImageSeq = 0;
  let autosaveTimer = null;
  let draftSaveTimer = null;
  let hashtagList = [];
  let baselineSignature = '';
  let hasUnsavedChanges = false;
  let layoutEditEnabled = false;
  let layoutTouched = false;
  let currentUserToken = 'anon';
  let activeDraftKey = '';
  let layoutModel = window.GlsEditor2LayoutModel
    ? window.GlsEditor2LayoutModel.createDefaultModel()
    : null;
  let layoutEditor = null;
  let currentPreviewCard = null;

  const quill = new Quill('#editor', {
    theme: 'snow',
    placeholder: '여기에 오늘의 문장을 적어 보세요.',
    modules: {
      toolbar: [
        [{ header: [1, 2, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        [{ align: '' }, { align: 'center' }, { align: 'right' }, { align: 'justify' }],
        ['blockquote'],
        ['clean'],
      ],
    },
    formats: [
      'header',
      'bold',
      'italic',
      'underline',
      'strike',
      'list',
      'bullet',
      'blockquote',
      'align',
    ],
  });

  let hashtagChipContainer = document.createElement('div');
  hashtagChipContainer.id = 'editor2HashtagChips';
  hashtagChipContainer.className = 'gls-flex gls-flex-wrap';
  hashtagsInput.insertAdjacentElement('afterend', hashtagChipContainer);

  function trackEvent(eventName, properties = {}, options = {}) {
    if (!window.glsoopAnalytics || typeof window.glsoopAnalytics.trackEvent !== 'function') return;
    window.glsoopAnalytics.trackEvent(eventName, properties, options);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function buildLoginRedirect() {
    const nextPath = `${window.location.pathname}${window.location.search || ''}`;
    const query = new URLSearchParams();
    query.set('next', nextPath);
    query.set('from', 'editor2');
    return `/html/login.html?${query.toString()}`;
  }

  function redirectToLogin(reason) {
    trackEvent(
      'editor2_auth_redirect',
      {
        reason: reason || null,
        next_path: `${window.location.pathname}${window.location.search || ''}`,
      },
      { useBeacon: true }
    );
    window.location.href = buildLoginRedirect();
  }

  function resolveUserToken(user) {
    const id = Number.parseInt(user?.id, 10);
    if (Number.isInteger(id) && id > 0) return String(id);
    return 'anon';
  }

  function buildDraftKey(mode, userToken, nextPostId = null) {
    if (mode === 'edit') {
      return `${DRAFT_PREFIX}:edit:${nextPostId}:u:${userToken}`;
    }
    return `${DRAFT_PREFIX}:create:u:${userToken}`;
  }

  function setSaveStatus(state, timestamp = null) {
    if (!saveStatusEl) return;
    saveStatusEl.classList.remove('is-saving', 'is-error', 'is-local');
    if (state === 'saving') {
      saveStatusEl.classList.add('is-saving');
      saveStatusEl.textContent = 'Saving...';
    } else if (state === 'error') {
      saveStatusEl.classList.add('is-error');
      saveStatusEl.textContent = 'Error';
    } else if (state === 'local') {
      saveStatusEl.classList.add('is-local');
      saveStatusEl.textContent = 'Saved locally';
    } else {
      saveStatusEl.textContent = 'Saved';
    }

    if (!saveStatusTimeEl) return;
    if (!timestamp) {
      saveStatusTimeEl.textContent = '';
      return;
    }
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      saveStatusTimeEl.textContent = '';
      return;
    }
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    saveStatusTimeEl.textContent = `${hh}:${mm}`;
  }

  function showEditorError(message) {
    if (!alertEl) {
      alert(message);
      return;
    }
    alertEl.textContent = message;
    alertEl.classList.remove('gls-hidden');
    window.scrollTo({ top: Math.max(0, alertEl.offsetTop - 120), behavior: 'smooth' });
  }

  function hideEditorError() {
    if (!alertEl) return;
    alertEl.classList.add('gls-hidden');
    alertEl.textContent = '';
  }

  function normalizeTag(raw, requireHash = true) {
    if (!raw) return '';
    let tag = String(raw).trim();
    if (!tag) return '';
    if (requireHash) {
      if (!tag.startsWith('#')) return '';
      tag = tag.slice(1);
    } else if (tag.startsWith('#')) {
      tag = tag.slice(1);
    }
    return tag.trim();
  }

  function syncHashtagInputFromList() {
    if (!hashtagList.length) return;
    hashtagsInput.value = hashtagList.map((tag) => `#${tag}`).join(' ');
  }

  function renderHashtagChips() {
    if (!hashtagChipContainer) return;
    if (!hashtagList.length) {
      hashtagChipContainer.innerHTML = '';
      return;
    }
    hashtagChipContainer.innerHTML = hashtagList
      .map(
        (tag) => `
          <span class="hashtag-chip">
            #${escapeHtml(tag)}
            <button type="button" class="hashtag-chip-remove" data-tag="${escapeHtml(tag)}">×</button>
          </span>
        `
      )
      .join('');

    hashtagChipContainer.querySelectorAll('.hashtag-chip-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tag = btn.getAttribute('data-tag');
        if (!tag) return;
        hashtagList = hashtagList.filter((item) => item !== tag);
        syncHashtagInputFromList();
        renderHashtagChips();
        handleEditorMutation('hashtag_remove');
      });
    });
  }

  function addTag(raw, options = {}) {
    const normalized = normalizeTag(raw, options.requireHash !== false);
    if (!normalized) return false;
    if (hashtagList.includes(normalized)) return false;
    hashtagList.push(normalized);
    syncHashtagInputFromList();
    renderHashtagChips();
    if (options.markDirty !== false) {
      handleEditorMutation('hashtag_add');
    }
    return true;
  }

  function commitHashtagInput(options = {}) {
    const raw = hashtagsInput.value || '';
    if (!raw.trim()) return;
    const tokens = raw.split(/[,\s]+/).filter(Boolean);
    let added = false;
    tokens.forEach((token) => {
      added = addTag(token, { requireHash: options.requireHash !== false }) || added;
    });
    if (options.clearInput !== false) {
      hashtagsInput.value = '';
    } else if (added) {
      syncHashtagInputFromList();
    }
  }

  function parseHashtagInputToList(requireHash = true) {
    const raw = hashtagsInput.value || '';
    if (!raw.trim()) {
      hashtagList = [];
      renderHashtagChips();
      return;
    }
    const tokens = raw
      .split(/[,\s]+/)
      .map((token) => normalizeTag(token, requireHash))
      .filter(Boolean);
    hashtagList = Array.from(new Set(tokens));
    syncHashtagInputFromList();
    renderHashtagChips();
  }

  function applyEditorFont(fontKey) {
    const key = FONT_MAP[fontKey] ? fontKey : 'serif';
    if (quill && quill.root) {
      quill.root.style.fontFamily = FONT_MAP[key];
    }
  }

  function updateCharCounter(currentLength) {
    if (!charCounterEl) return;
    const remaining = Math.max(0, MAX_CONTENT_LENGTH - currentLength);
    charCounterEl.textContent = `${remaining}/${MAX_CONTENT_LENGTH}`;
    if (remaining <= 30) {
      charCounterEl.classList.remove('gls-text-muted');
      charCounterEl.classList.add('text-danger');
    } else {
      charCounterEl.classList.remove('text-danger');
      charCounterEl.classList.add('gls-text-muted');
    }
  }

  function buildDefaultLayoutModel() {
    if (!window.GlsEditor2LayoutModel) return null;
    return window.GlsEditor2LayoutModel.createDefaultModel();
  }

  function loadModelFromLayout(layoutRaw) {
    if (!window.GlsEditor2LayoutModel) return { model: null, custom: false };
    const model = window.GlsEditor2LayoutModel.modelFromLayoutJson(layoutRaw);
    if (model) {
      return {
        model: window.GlsEditor2LayoutModel.normalizeModel(model),
        custom: true,
      };
    }
    return {
      model: buildDefaultLayoutModel(),
      custom: false,
    };
  }

  function getPreviewLayoutPayload() {
    if (!window.GlsEditor2LayoutModel || !layoutModel) return null;
    if (!layoutEditEnabled && !layoutTouched) return null;
    return window.GlsEditor2LayoutModel.layoutJsonFromModel(layoutModel);
  }

  function getLayoutForSave() {
    if (!window.GlsEditor2LayoutModel || !layoutModel) return null;
    if (!layoutTouched) return null;
    const payload = window.GlsEditor2LayoutModel.layoutJsonFromModel(layoutModel);
    if (!payload) return null;
    return {
      layout_version: LAYOUT_VERSION,
      unit: LAYOUT_UNIT,
      text_box: payload.text_box,
      title_box: payload.title_box,
      footer_box: payload.footer_box,
    };
  }

  function appendLayoutParams(params, layout) {
    if (!layout || typeof layout !== 'object' || !layout.text_box) return;

    const appendBox = (box, prefix = '') => {
      if (!box || typeof box !== 'object') return;
      const key = prefix ? `layout_${prefix}_` : 'layout_';
      ['x', 'y', 'w', 'h'].forEach((field) => {
        const value = Number(box[field]);
        if (Number.isFinite(value)) {
          params.set(`${key}${field}`, String(value));
        }
      });
      if (typeof box.align === 'string' && box.align.trim()) {
        params.set(`${key}align`, box.align.trim());
      }
      if (Number.isFinite(Number(box.font_scale))) {
        params.set(`${key}font_scale`, String(Number(box.font_scale)));
      }
      if (Number.isFinite(Number(box.line_height))) {
        params.set(`${key}line_height`, String(Number(box.line_height)));
      }
    };

    appendBox(layout.text_box, '');
    appendBox(layout.title_box, 'title');
    appendBox(layout.footer_box, 'footer');
  }

  function buildPreviewRenderedImageUrl({ title, content, category, layout }) {
    const params = new URLSearchParams();
    params.set('title', title || '');
    params.set('content', content || '');
    params.set('category', category || 'short');
    params.set('template', 'paper01');
    params.set('scale', '1');
    appendLayoutParams(params, layout);
    return `/api/feed-images/preview?${params.toString()}`;
  }

  function buildPreviewPost({ title, contentHtml, plainText }) {
    const fontKey = fontSelectEl.value || 'serif';
    const category = categorySelectEl.value || 'short';
    const normalizedContent = plainText
      ? contentHtml
      : '<p>여기에 오늘의 문장을 적어 보시면, 이 카드에서 바로 미리 볼 수 있어요.</p>';

    return {
      id: 'editor2-preview',
      author_name: '나',
      title: title || '여기에 글 제목이 미리 보여요',
      content: `<!--FONT:${fontKey}-->${normalizedContent}`,
      hashtags: hashtagList.join(', '),
      category,
      created_at: new Date().toISOString(),
      like_count: 0,
      user_liked: 0,
    };
  }

  function ensurePreviewCard(previewPost, imageUrl) {
    let previewCard = previewMountEl.querySelector('.gls-post-card');
    if (previewCard) return previewCard;

    previewMountEl.innerHTML = buildStandardPostCardHTML(previewPost, {
      showMoreButton: false,
      showEngagementActions: false,
      contentExpanded: true,
      cardClickable: false,
      cardExtraClass: 'editor-preview-feed-card',
      renderedImageSrc: imageUrl,
    });

    previewCard = previewMountEl.querySelector('.gls-post-card');
    if (previewCard && typeof enhanceStandardPostCard === 'function') {
      enhanceStandardPostCard(previewCard, previewPost, {});
    }
    return previewCard;
  }

  function syncPreviewCardMeta(previewCard, previewPost, plainText) {
    if (!previewCard) return;

    const titleEl = previewCard.querySelector('.card-title');
    const hideCardTitle = Boolean(layoutEditEnabled || layoutTouched);
    if (titleEl) {
      titleEl.textContent = previewPost.title || '';
      titleEl.classList.toggle('gls-hidden', hideCardTitle);
    }

    const categoryHtml = renderCategoryBadge(previewPost);
    const hashtagHtml = buildHashtagHtml(previewPost);
    let metaEl = previewCard.querySelector('.post-bottom-meta');
    if (categoryHtml || hashtagHtml) {
      const metaInnerHtml = `${categoryHtml ? `<div class="post-category-row">${categoryHtml}</div>` : ''}${hashtagHtml || ''}`;
      if (!metaEl) {
        metaEl = document.createElement('div');
        metaEl.className = 'post-bottom-meta';
        const bodyEl = previewCard.querySelector('.card-body');
        if (bodyEl) bodyEl.appendChild(metaEl);
      }
      if (metaEl) metaEl.innerHTML = metaInnerHtml;
    } else if (metaEl) {
      metaEl.remove();
    }

    const extracted = extractContentWithFont(previewPost);
    const fallbackEl = previewCard.querySelector('[data-feed-render-fallback]');
    if (fallbackEl) {
      fallbackEl.innerHTML = sanitizePostHtml(extracted.cleanHtml || '');
    }

    ensureLayoutEditor(previewCard, previewPost, plainText);
  }

  function updateLayoutToggleUi() {
    if (!layoutToggleBtn) return;
    layoutToggleBtn.setAttribute('aria-pressed', layoutEditEnabled ? 'true' : 'false');
    layoutToggleBtn.textContent = `레이아웃 편집: ${layoutEditEnabled ? 'ON' : 'OFF'}`;
    if (layoutPanelEl) {
      layoutPanelEl.hidden = !layoutEditEnabled;
    }
  }

  function updateSafeAreaHint(shouldShow) {
    if (!safeAreaHintEl) return;
    safeAreaHintEl.hidden = !shouldShow;
  }

  function syncLayoutPanelFromModel() {
    if (!layoutModel) return;
    const findBox = (id) => layoutModel.boxes.find((box) => box.id === id) || null;
    const getStyle = (id) => {
      if (id === 'title_box') return layoutModel.styles?.title || null;
      if (id === 'text_box') return layoutModel.styles?.body || null;
      if (id === 'footer_box') return layoutModel.styles?.footer || null;
      return null;
    };
    const syncScaleControl = (inputEl, valueEl, style) => {
      if (!inputEl && !valueEl) return;
      const raw = Number(style?.font_scale);
      const resolved = Number.isFinite(raw) ? Math.max(0.7, Math.min(1.7, raw)) : 1;
      if (inputEl) {
        inputEl.value = resolved.toFixed(2);
      }
      if (valueEl) {
        valueEl.textContent = `${resolved.toFixed(2)}x`;
      }
    };

    const title = findBox('title_box');
    const body = findBox('text_box');
    const footer = findBox('footer_box');

    if (lockTitleEl) lockTitleEl.checked = Boolean(title?.lock);
    if (lockBodyEl) lockBodyEl.checked = Boolean(body?.lock);
    if (lockFooterEl) lockFooterEl.checked = Boolean(footer?.lock);
    if (hideTitleEl) hideTitleEl.checked = Boolean(title?.hidden);
    if (hideBodyEl) hideBodyEl.checked = Boolean(body?.hidden);
    if (hideFooterEl) hideFooterEl.checked = Boolean(footer?.hidden);

    syncScaleControl(fontScaleTitleEl, fontScaleTitleValueEl, getStyle('title_box'));
    syncScaleControl(fontScaleBodyEl, fontScaleBodyValueEl, getStyle('text_box'));
    syncScaleControl(fontScaleFooterEl, fontScaleFooterValueEl, getStyle('footer_box'));
  }

  function ensureLayoutEditor(previewCard, previewPost, plainText) {
    if (!previewCard || !window.GlsEditor2LayoutEditor || !layoutModel) return;

    if (!layoutEditor) {
      layoutEditor = new window.GlsEditor2LayoutEditor({
        initialModel: layoutModel,
        onChange: (event) => {
          layoutModel = event.model;
          syncLayoutPanelFromModel();
          updateSafeAreaHint(Boolean(event.outsideSafeArea));

          if (event.userInitiated && CUSTOM_LAYOUT_REASONS.has(event.reason)) {
            layoutTouched = true;
          }
          if (event.userInitiated) {
            updatePreview();
            handleEditorMutation(`layout_${event.reason}`, { skipPreview: true });
          }
        },
      });
    }

    const mounted = layoutEditor.mount(previewCard);
    if (!mounted) return;

    layoutEditor.setModel(layoutModel, { emit: false });
    layoutEditor.setEnabled(layoutEditEnabled);
    layoutEditor.setPreviewText({
      title: previewPost?.title || '제목',
      body: plainText || '본문',
      footer: '글숲 · glsoop',
    });
    updateSafeAreaHint(layoutEditor.isOutsideSafeArea());
    syncLayoutPanelFromModel();
  }

  function schedulePreviewImageUpdate(previewCard, imageUrl) {
    if (!previewCard || !imageUrl) return;
    const imageEl = previewCard.querySelector('.feed-rendered-card-image');
    const fallbackEl = previewCard.querySelector('[data-feed-render-fallback]');
    const imageShell = previewCard.querySelector('.feed-rendered-image-shell');
    if (!imageEl) return;

    const currentSrc = imageEl.getAttribute('src') || '';
    if (currentSrc === imageUrl) return;

    if (previewImageTimer) {
      clearTimeout(previewImageTimer);
    }

    const seq = ++previewImageSeq;
    previewImageTimer = window.setTimeout(() => {
      const loader = new Image();
      loader.decoding = 'async';
      if (imageShell) imageShell.classList.add('is-preview-loading');

      loader.onload = () => {
        if (seq !== previewImageSeq) return;
        imageEl.src = imageUrl;
        imageEl.classList.remove('is-hidden');
        imageEl.removeAttribute('hidden');
        if (fallbackEl) {
          fallbackEl.hidden = true;
          fallbackEl.classList.remove('is-active');
        }
        if (imageShell) imageShell.classList.remove('is-preview-loading');
        if (layoutEditor) {
          layoutEditor.mount(previewCard);
          layoutEditor.setModel(layoutModel, { emit: false });
          layoutEditor.setEnabled(layoutEditEnabled);
          updateSafeAreaHint(layoutEditor.isOutsideSafeArea());
        }
      };

      loader.onerror = () => {
        if (seq !== previewImageSeq) return;
        if (fallbackEl) {
          imageEl.classList.add('is-hidden');
          imageEl.setAttribute('hidden', '');
          fallbackEl.hidden = false;
          fallbackEl.classList.add('is-active');
        }
        if (imageShell) imageShell.classList.remove('is-preview-loading');
        updateSafeAreaHint(false);
      };

      loader.src = imageUrl;
    }, PREVIEW_IMAGE_DEBOUNCE_MS);
  }

  function updatePreview() {
    if (!previewMountEl) return;

    const title = postTitleEl.value.trim();
    const contentHtml = quill.root.innerHTML.trim();
    const plainText = quill.getText().trim();
    const previewPost = buildPreviewPost({ title, contentHtml, plainText });
    const previewLayout = getPreviewLayoutPayload();
    const previewImageUrl = buildPreviewRenderedImageUrl({
      title: previewPost.title,
      content: previewPost.content,
      category: previewPost.category,
      layout: previewLayout,
    });

    currentPreviewCard = ensurePreviewCard(previewPost, previewImageUrl);
    syncPreviewCardMeta(currentPreviewCard, previewPost, plainText);
    schedulePreviewImageUpdate(currentPreviewCard, previewImageUrl);

    previewMountEl.dataset.previewFontLabel = FONT_LABEL_MAP[fontSelectEl.value || 'serif'] || '감성 명조체';
    previewMountEl.dataset.previewTags = hashtagList.map((tag) => `#${tag}`).join(' ');
  }

  function buildStateSnapshot() {
    return {
      title: postTitleEl.value.trim(),
      content_html: quill.root.innerHTML.trim(),
      category: categorySelectEl.value || '',
      font_key: fontSelectEl.value || 'serif',
      hashtags: [...hashtagList],
      layout_model: layoutModel ? clone(layoutModel) : null,
      layout_custom: Boolean(layoutTouched),
    };
  }

  function buildStateSignature(state) {
    if (!state || typeof state !== 'object') return '';
    const layoutJson = state.layout_custom && state.layout_model && window.GlsEditor2LayoutModel
      ? window.GlsEditor2LayoutModel.layoutJsonFromModel(state.layout_model)
      : null;
    return JSON.stringify({
      title: state.title || '',
      content_html: state.content_html || '',
      category: state.category || '',
      font_key: state.font_key || 'serif',
      hashtags: Array.isArray(state.hashtags) ? state.hashtags : [],
      layout_custom: Boolean(state.layout_custom),
      layout_json: layoutJson || null,
    });
  }

  function isMeaningfulSnapshot(state) {
    if (!state || typeof state !== 'object') return false;
    if (typeof state.title === 'string' && state.title.trim()) return true;
    if (typeof state.content_html === 'string') {
      const plain = state.content_html.replace(/<[^>]+>/g, ' ').trim();
      if (plain) return true;
    }
    if (Array.isArray(state.hashtags) && state.hashtags.length) return true;
    if (typeof state.category === 'string' && state.category.trim()) return true;
    if (state.layout_custom) return true;
    return false;
  }

  function readDraftPayload(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const payload = JSON.parse(raw);
      if (!payload || typeof payload !== 'object') return null;
      if (!payload.state || typeof payload.state !== 'object') return null;
      return payload;
    } catch (_error) {
      return null;
    }
  }

  function clearDraft(key = activeDraftKey) {
    try {
      localStorage.removeItem(key);
    } catch (_error) {
      // no-op
    }
  }

  function clearAutosaveRetryNotice() {
    if (!noticeRegionEl) return;
    const retryEl = noticeRegionEl.querySelector('[data-editor2-autosave-retry]');
    if (retryEl) {
      retryEl.remove();
    }
  }

  function renderAutosaveRetryNotice(message) {
    if (!noticeRegionEl) return;
    clearAutosaveRetryNotice();
    const wrapper = document.createElement('div');
    wrapper.className = 'editor-notice';
    wrapper.setAttribute('data-editor2-autosave-retry', '1');
    wrapper.innerHTML = `
      <div class="editor-notice__title">자동 저장에 실패했습니다.</div>
      <div class="editor-notice__desc">${escapeHtml(message || '네트워크 상태를 확인한 뒤 다시 시도해주세요.')}</div>
      <div class="editor-notice__actions">
        <button type="button" class="gls-btn gls-btn-primary gls-btn-sm" id="editor2RetrySaveBtn">다시 저장</button>
      </div>
    `;
    noticeRegionEl.appendChild(wrapper);

    const retryBtn = wrapper.querySelector('#editor2RetrySaveBtn');
    if (retryBtn) {
      retryBtn.addEventListener('click', async () => {
        retryBtn.disabled = true;
        await savePostEdit({ source: 'retry' });
      });
    }
  }

  function purgeEditor2Drafts() {
    const now = Date.now();
    const prefix = `${DRAFT_PREFIX}:`;
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          keys.push(key);
        }
      }
    } catch (_error) {
      return;
    }

    keys.forEach((key) => {
      const payload = readDraftPayload(key);
      const keyToken = key.split(':u:')[1] || '';
      const isOtherUserDraft = keyToken && keyToken !== currentUserToken;
      const savedAt = payload?.saved_at ? new Date(payload.saved_at).getTime() : NaN;
      const isExpired = Number.isFinite(savedAt) ? now - savedAt > DRAFT_TTL_MS : true;
      const payloadUser = payload?.user_token ? String(payload.user_token) : '';
      const payloadUserMismatch = payloadUser && payloadUser !== currentUserToken;

      if (isOtherUserDraft || payloadUserMismatch || isExpired || !payload) {
        clearDraft(key);
      }
    });
  }

  function saveDraftNow() {
    if (isSaving || isProgrammaticUpdate || !activeDraftKey) return;
    const snapshot = buildStateSnapshot();
    if (!isMeaningfulSnapshot(snapshot)) {
      clearDraft();
      return;
    }
    try {
      localStorage.setItem(
        activeDraftKey,
        JSON.stringify({
          version: 1,
          mode: isEditMode ? 'edit' : 'create',
          post_id: isEditMode ? Number(postId) || null : null,
          user_token: currentUserToken,
          saved_at: new Date().toISOString(),
          state: snapshot,
        })
      );
      setSaveStatus('local', new Date().toISOString());
    } catch (_error) {
      // no-op
    }
  }

  function scheduleDraftSave() {
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    draftSaveTimer = window.setTimeout(saveDraftNow, DRAFT_SAVE_DEBOUNCE_MS);
  }

  function applyDraftState(state) {
    if (!state || typeof state !== 'object') return;
    isProgrammaticUpdate = true;
    try {
      postTitleEl.value = state.title || '';
      fontSelectEl.value = FONT_MAP[state.font_key] ? state.font_key : 'serif';
      applyEditorFont(fontSelectEl.value || 'serif');
      categorySelectEl.value = state.category || '';
      quill.root.innerHTML = sanitizePostHtml(state.content_html || '');

      hashtagList = [];
      if (Array.isArray(state.hashtags)) {
        state.hashtags.forEach((tag) => addTag(tag, { requireHash: false, markDirty: false }));
      }
      renderHashtagChips();

      if (state.layout_model && window.GlsEditor2LayoutModel) {
        layoutModel = window.GlsEditor2LayoutModel.normalizeModel(state.layout_model);
      } else {
        layoutModel = buildDefaultLayoutModel();
      }
      layoutTouched = Boolean(state.layout_custom);
      if (layoutEditor && layoutModel) {
        layoutEditor.setModel(layoutModel, { emit: false });
      }

      updateCharCounter(quill.getText().trim().length);
      updatePreview();
      syncLayoutPanelFromModel();
    } finally {
      isProgrammaticUpdate = false;
    }
  }

  function renderDraftRestoreNotice(payload) {
    if (!noticeRegionEl || !payload) return;
    const savedAtLabel = payload.saved_at
      ? (typeof formatKoreanDateTime === 'function'
          ? formatKoreanDateTime(payload.saved_at)
          : String(payload.saved_at))
      : '방금 전';

    noticeRegionEl.innerHTML = `
      <div class="editor-notice" role="status">
        <div class="editor-notice__title">저장된 editor2 초안이 있습니다.</div>
        <div class="editor-notice__desc">
          마지막 저장: <strong>${escapeHtml(savedAtLabel)}</strong>
        </div>
        <div class="editor-notice__actions">
          <button type="button" class="gls-btn gls-btn-primary gls-btn-sm" id="restoreEditor2DraftBtn">초안 복구</button>
          <button type="button" class="gls-btn gls-btn-secondary gls-btn-sm" id="discardEditor2DraftBtn">초안 삭제</button>
        </div>
      </div>
    `;

    const restoreBtn = document.getElementById('restoreEditor2DraftBtn');
    const discardBtn = document.getElementById('discardEditor2DraftBtn');

    if (restoreBtn) {
      restoreBtn.addEventListener('click', () => {
        applyDraftState(payload.state);
        hasUnsavedChanges = true;
        scheduleDraftSave();
        noticeRegionEl.innerHTML = '';
        setSaveStatus('local', payload.saved_at || new Date().toISOString());
        trackEvent('editor2_draft_restored', {
          is_edit_mode: isEditMode,
          post_id: postId ? Number(postId) || null : null,
        });
      });
    }

    if (discardBtn) {
      discardBtn.addEventListener('click', () => {
        clearDraft();
        noticeRegionEl.innerHTML = '';
        trackEvent('editor2_draft_discarded', {
          is_edit_mode: isEditMode,
          post_id: postId ? Number(postId) || null : null,
        });
      });
    }
  }

  function buildPayloadForServer() {
    const title = postTitleEl.value.trim();
    const contentHtml = quill.root.innerHTML.trim();
    const plainText = quill.getText().trim();
    const fontKey = fontSelectEl.value || 'serif';
    const category = categorySelectEl.value || '';
    const hashtagsRaw = hashtagList.map((tag) => `#${tag}`).join(' ');

    return {
      title,
      content_html: contentHtml,
      content_with_font: `<!--FONT:${fontKey}-->${contentHtml}`,
      plain_text: plainText,
      category,
      hashtags: hashtagsRaw,
      layout_json: getLayoutForSave(),
    };
  }

  function validatePayload(payload) {
    if (!payload.title) return '제목을 입력해주세요.';
    if (!payload.plain_text) return '내용을 입력해주세요.';
    if (!payload.category) return '카테고리를 선택해주세요.';
    if (payload.plain_text.length > MAX_CONTENT_LENGTH) {
      return `본문은 최대 ${MAX_CONTENT_LENGTH}자까지 입력할 수 있어요.`;
    }
    return '';
  }

  async function savePostEdit({ source = 'autosave' } = {}) {
    if (!isEditMode || !postId) return false;
    if (isSaving) {
      queuedAutosave = true;
      return false;
    }

    const payload = buildPayloadForServer();
    const validationError = validatePayload(payload);
    if (validationError) {
      if (source === 'manual') {
        showEditorError(validationError);
        setSaveStatus('error');
      } else {
        scheduleDraftSave();
        setSaveStatus('local', new Date().toISOString());
      }
      return false;
    }

    hideEditorError();
    isSaving = true;
    setSaveStatus('saving');

    try {
      const response = await fetch(`/api/posts/${postId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: payload.title,
          content: payload.content_with_font,
          hashtags: payload.hashtags,
          category: payload.category,
          layout_json: payload.layout_json,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || '글 저장에 실패했습니다.');
      }

      baselineSignature = buildStateSignature(buildStateSnapshot());
      hasUnsavedChanges = false;
      clearDraft();
      setSaveStatus('saved', new Date().toISOString());

      clearAutosaveRetryNotice();

      if (source === 'manual') {
        alert('글이 저장되었습니다.');
      }
      return true;
    } catch (error) {
      console.error('[editor2] edit save failed:', error);
      setSaveStatus('error');
      scheduleDraftSave();
      if (source === 'manual') {
        showEditorError(error.message || '글 저장 중 오류가 발생했습니다.');
      } else {
        renderAutosaveRetryNotice(error.message || '자동 저장 실패');
      }
      return false;
    } finally {
      isSaving = false;
      if (queuedAutosave) {
        queuedAutosave = false;
        scheduleAutosave();
      }
    }
  }

  async function savePostCreate() {
    const payload = buildPayloadForServer();
    const validationError = validatePayload(payload);
    if (validationError) {
      showEditorError(validationError);
      setSaveStatus('error');
      return false;
    }

    hideEditorError();
    isSaving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중...';
    setSaveStatus('saving');

    try {
      const response = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: payload.title,
          content: payload.content_with_font,
          hashtags: payload.hashtags,
          category: payload.category,
          layout_json: payload.layout_json,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || '글 저장에 실패했습니다.');
      }

      clearDraft();
      setSaveStatus('saved', new Date().toISOString());
      const createdPostId = Number.parseInt(data.post_id, 10);
      if (Number.isInteger(createdPostId) && createdPostId > 0) {
        window.location.replace(`/html/editor2.html?postId=${encodeURIComponent(createdPostId)}`);
        return true;
      }

      alert('글이 저장되었습니다.');
      return true;
    } catch (error) {
      console.error('[editor2] create save failed:', error);
      showEditorError(error.message || '글 저장 중 오류가 발생했습니다.');
      setSaveStatus('error');
      scheduleDraftSave();
      return false;
    } finally {
      isSaving = false;
      saveBtn.disabled = false;
      saveBtn.textContent = isEditMode ? '지금 저장' : '저장하기';
    }
  }

  function scheduleAutosave() {
    if (!isEditMode || !postId) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => {
      savePostEdit({ source: 'autosave' });
    }, EDIT_AUTOSAVE_DEBOUNCE_MS);
    setSaveStatus('saving');
  }

  function handleEditorMutation(_reason, options = {}) {
    if (!options.skipPreview) {
      updatePreview();
    }
    if (isProgrammaticUpdate || isSaving) return;

    const signature = buildStateSignature(buildStateSnapshot());
    hasUnsavedChanges = signature !== baselineSignature;
    if (!hasUnsavedChanges) {
      if (draftSaveTimer) {
        clearTimeout(draftSaveTimer);
        draftSaveTimer = null;
      }
      clearDraft();
      if (isEditMode) {
        setSaveStatus('saved', new Date().toISOString());
      } else {
        setSaveStatus('local', new Date().toISOString());
      }
      return;
    }

    if (isEditMode && postId) {
      scheduleAutosave();
      return;
    }

    scheduleDraftSave();
  }

  function setLayoutEditMode(enabled) {
    layoutEditEnabled = Boolean(enabled);
    updateLayoutToggleUi();
    if (layoutEditor) {
      layoutEditor.setEnabled(layoutEditEnabled);
      updateSafeAreaHint(layoutEditor.isOutsideSafeArea());
      if (layoutEditEnabled) {
        layoutEditor.selectBox('text_box');
      }
    } else {
      updateSafeAreaHint(false);
    }
    updatePreview();
  }

  function initializeLockHideBindings() {
    const bindToggle = (el, boxId, type) => {
      if (!el) return;
      el.addEventListener('change', () => {
        if (!layoutEditor) return;
        if (type === 'lock') {
          layoutEditor.setBoxLock(boxId, el.checked, { userInitiated: true });
        } else {
          layoutEditor.setBoxHidden(boxId, el.checked, { userInitiated: true });
        }
        layoutModel = layoutEditor.getModel();
        updatePreview();
        handleEditorMutation(`layout_${type}`, { skipPreview: true });
      });
    };

    bindToggle(lockTitleEl, 'title_box', 'lock');
    bindToggle(lockBodyEl, 'text_box', 'lock');
    bindToggle(lockFooterEl, 'footer_box', 'lock');
    bindToggle(hideTitleEl, 'title_box', 'hide');
    bindToggle(hideBodyEl, 'text_box', 'hide');
    bindToggle(hideFooterEl, 'footer_box', 'hide');

    const bindFontScale = (inputEl, valueEl, boxId) => {
      if (!inputEl) return;

      const applyScale = () => {
        if (!layoutEditor) return;
        const raw = Number.parseFloat(inputEl.value);
        if (!Number.isFinite(raw)) return;
        const clamped = Math.max(0.7, Math.min(1.7, raw));
        if (valueEl) {
          valueEl.textContent = `${clamped.toFixed(2)}x`;
        }
        layoutEditor.setBoxStyle(
          boxId,
          { font_scale: clamped },
          { userInitiated: true, reason: 'style_change' }
        );
        layoutModel = layoutEditor.getModel();
        layoutTouched = true;
        updatePreview();
        handleEditorMutation('layout_style', { skipPreview: true });
      };

      inputEl.addEventListener('input', applyScale);
      inputEl.addEventListener('change', applyScale);
    };

    bindFontScale(fontScaleTitleEl, fontScaleTitleValueEl, 'title_box');
    bindFontScale(fontScaleBodyEl, fontScaleBodyValueEl, 'text_box');
    bindFontScale(fontScaleFooterEl, fontScaleFooterValueEl, 'footer_box');
  }

  function cleanupTimers() {
    if (previewImageTimer) clearTimeout(previewImageTimer);
    if (autosaveTimer) clearTimeout(autosaveTimer);
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    previewImageTimer = null;
    autosaveTimer = null;
    draftSaveTimer = null;
  }

  async function ensureAuthenticatedUser() {
    try {
      const response = await fetch('/api/me', { cache: 'no-store' });
      if (response.status === 401) {
        alert('로그인이 필요한 기능입니다.');
        redirectToLogin('unauthorized');
        return false;
      }
      if (!response.ok) {
        redirectToLogin(`status_${response.status}`);
        return false;
      }
      const data = await response.json();
      if (!data || !data.ok) {
        redirectToLogin('invalid_me_response');
        return false;
      }
      me = data;
      currentUserToken = resolveUserToken(me);
      activeDraftKey = buildDraftKey(isEditMode ? 'edit' : 'create', currentUserToken, postId);
      return true;
    } catch (error) {
      console.error('[editor2] auth check failed:', error);
      redirectToLogin('network_error');
      return false;
    }
  }

  async function loadEditPost() {
    if (!isEditMode || !postId) return true;
    try {
      const response = await fetch(`/api/posts/${postId}/edit`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.post) {
        throw new Error(data.message || '글 정보를 불러오지 못했습니다.');
      }

      const post = data.post;
      isProgrammaticUpdate = true;
      try {
        postTitleEl.value = post.title || '';
        const { cleanHtml, fontKey } = extractFontFromContent(post.content || '');
        fontSelectEl.value = FONT_MAP[fontKey] ? fontKey : 'serif';
        applyEditorFont(fontSelectEl.value || 'serif');
        quill.root.innerHTML = sanitizePostHtml(cleanHtml || '');
        categorySelectEl.value = post.category || 'short';

        hashtagList = [];
        if (Array.isArray(post.hashtags)) {
          post.hashtags.forEach((tag) => addTag(tag, { requireHash: false, markDirty: false }));
        } else if (post.hashtags) {
          hashtagsInput.value = post.hashtags;
          parseHashtagInputToList(false);
        } else {
          renderHashtagChips();
        }

        const layoutLoad = loadModelFromLayout(post.layout_json);
        layoutModel = layoutLoad.model || buildDefaultLayoutModel();
        layoutTouched = Boolean(layoutLoad.custom);
      } finally {
        isProgrammaticUpdate = false;
      }

      updateCharCounter(quill.getText().trim().length);
      updatePreview();
      syncLayoutPanelFromModel();
      return true;
    } catch (error) {
      console.error('[editor2] edit load failed:', error);
      alert(error.message || '글 정보를 불러오는 중 오류가 발생했습니다.');
      isEditMode = false;
      postId = null;
      activeDraftKey = buildDraftKey('create', currentUserToken);
      layoutModel = buildDefaultLayoutModel();
      layoutTouched = false;
      return false;
    }
  }

  function bindInputEvents() {
    if (layoutToggleBtn) {
      layoutToggleBtn.addEventListener('click', () => {
        setLayoutEditMode(!layoutEditEnabled);
        handleEditorMutation('layout_toggle', { skipPreview: true });
      });
    }

    if (layoutResetBtn) {
      layoutResetBtn.addEventListener('click', () => {
        layoutModel = buildDefaultLayoutModel();
        layoutTouched = false;
        if (layoutEditor && layoutModel) {
          layoutEditor.setModel(layoutModel, { emit: false });
          layoutEditor.setEnabled(layoutEditEnabled);
          updateSafeAreaHint(layoutEditor.isOutsideSafeArea());
        }
        syncLayoutPanelFromModel();
        updatePreview();
        handleEditorMutation('layout_reset', { skipPreview: true });
      });
    }

    if (discardDraftBtn) {
      discardDraftBtn.addEventListener('click', () => {
        clearDraft();
        if (noticeRegionEl) noticeRegionEl.innerHTML = '';
        setSaveStatus('local', new Date().toISOString());
      });
    }

    postTitleEl.addEventListener('input', () => handleEditorMutation('title_input'));
    fontSelectEl.addEventListener('change', () => {
      applyEditorFont(fontSelectEl.value || 'serif');
      handleEditorMutation('font_change');
    });
    categorySelectEl.addEventListener('change', () => handleEditorMutation('category_change'));

    let isComposingTag = false;
    hashtagsInput.addEventListener('compositionstart', () => {
      isComposingTag = true;
    });
    hashtagsInput.addEventListener('compositionend', () => {
      isComposingTag = false;
    });
    hashtagsInput.addEventListener('keydown', (event) => {
      if (isComposingTag) return;
      if (['Enter', ' ', ',', 'Tab'].includes(event.key)) {
        const value = hashtagsInput.value;
        const parts = value.split(/[,\s]+/);
        const last = parts[parts.length - 1];
        if (last && last.trim().length) {
          event.preventDefault();
          commitHashtagInput({ clearInput: true });
        }
      }
    });
    hashtagsInput.addEventListener('blur', () => {
      commitHashtagInput({ clearInput: true });
    });

    let isAdjusting = false;
    quill.on('text-change', (delta, oldDelta, source) => {
      if (isAdjusting) return;
      if (source !== 'user') {
        const plain = quill.getText().trim();
        updateCharCounter(plain.length);
        updatePreview();
        return;
      }

      const plain = quill.getText().trim();
      const length = plain.length;
      if (length > MAX_CONTENT_LENGTH) {
        alert(`본문은 최대 ${MAX_CONTENT_LENGTH}자까지 입력할 수 있어요.`);
        isAdjusting = true;
        quill.setContents(oldDelta);
        isAdjusting = false;
        const nextPlain = quill.getText().trim();
        updateCharCounter(nextPlain.length);
        updatePreview();
        return;
      }

      updateCharCounter(length);
      handleEditorMutation('content_change');
    });

    saveBtn.addEventListener('click', async () => {
      if (isSaving) return;
      if (isEditMode && postId) {
        await savePostEdit({ source: 'manual' });
      } else {
        await savePostCreate();
      }
    });

    window.addEventListener('beforeunload', (event) => {
      if (!hasUnsavedChanges || isSaving) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  const authenticated = await ensureAuthenticatedUser();
  if (!authenticated) return;

  applyEditorFont(fontSelectEl.value || 'serif');
  updateLayoutToggleUi();
  updateSafeAreaHint(false);
  purgeEditor2Drafts();
  bindInputEvents();

  const editLoadOk = await loadEditPost();
  if (!editLoadOk) {
    saveBtn.textContent = '저장하기';
  } else if (isEditMode && postId) {
    saveBtn.textContent = '지금 저장';
  } else {
    saveBtn.textContent = '저장하기';
  }

  if (!isEditMode) {
    updateCharCounter(0);
    layoutModel = layoutModel || buildDefaultLayoutModel();
    layoutTouched = false;
    updatePreview();
  }

  initializeLockHideBindings();
  baselineSignature = buildStateSignature(buildStateSnapshot());
  hasUnsavedChanges = false;

  const draftPayload = readDraftPayload(activeDraftKey);
  if (draftPayload && isMeaningfulSnapshot(draftPayload.state)) {
    const draftSignature = buildStateSignature(draftPayload.state);
    if (draftSignature && draftSignature !== baselineSignature) {
      renderDraftRestoreNotice(draftPayload);
    }
  }

  trackEvent('editor2_open', {
    is_edit_mode: isEditMode,
    post_id: postId ? Number(postId) || null : null,
  });

  setSaveStatus(isEditMode ? 'saved' : 'local', new Date().toISOString());

  window.addEventListener('pagehide', () => {
    cleanupTimers();
    if (layoutEditor && typeof layoutEditor.destroy === 'function') {
      layoutEditor.destroy();
    }
  });
});
