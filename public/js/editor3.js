document.addEventListener('DOMContentLoaded', async () => {
  const MAX_CONTENT_LENGTH = 200;
  const CONTENT_PAGE_MAX_CHARS = 1000;
  const EDIT_AUTOSAVE_DEBOUNCE_MS = 1200;
  const DRAFT_SAVE_DEBOUNCE_MS = 1000;
  const DRAFT_PREFIX = 'glsoop:editor3:draft';
  const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const FONT_MAP = {
    serif: "'Nanum Myeongjo','Noto Serif KR',serif",
    sans: "'Noto Sans KR',system-ui,-apple-system,BlinkMacSystemFont,sans-serif",
    hand: "'Nanum Pen Script',cursive",
  };

  const postTitleEl = document.getElementById('postTitle');
  const saveBtn = document.getElementById('saveBtn');
  const discardDraftBtn = document.getElementById('discardDraftBtn');
  const hashtagsInput = document.getElementById('postHashtags');
  const fontSelectEl = document.getElementById('fontSelect');
  const categorySelectEl = document.getElementById('categorySelect');
  const charCounterEl = document.getElementById('charCounter');
  const alertEl = document.getElementById('editor3Alert');
  const noticeRegionEl = document.getElementById('editor3NoticeRegion');
  const saveStatusEl = document.getElementById('editor3SaveStatus');
  const saveStatusTimeEl = document.getElementById('editor3SaveStatusTime');
  const detectedModeBadgeEl = document.getElementById('editor3DetectedModeBadge');
  const detectedModeNoteEl = document.getElementById('editor3DetectedModeNote');
  const presetNameEl = document.getElementById('editor3PresetName');
  const alignHelpEl = document.getElementById('editor3AlignHelp');
  const feedbackListEl = document.getElementById('editor3FeedbackList');
  const pageCountEl = document.getElementById('editor3PageCount');
  const currentPageEl = document.getElementById('editor3CurrentPage');
  const currentTotalEl = document.getElementById('editor3CurrentTotal');
  const previewCarouselEl = document.getElementById('editor3PreviewCarousel');
  const previewThumbsEl = document.getElementById('editor3PreviewThumbs');
  const prevPageBtn = document.getElementById('editor3PrevPageBtn');
  const nextPageBtn = document.getElementById('editor3NextPageBtn');
  const modeButtons = Array.from(document.querySelectorAll('[data-mode-value]'));
  const presetButtons = Array.from(document.querySelectorAll('[data-preset-key]'));
  const alignButtons = Array.from(document.querySelectorAll('[data-align-value]'));
  const backgroundButtons = Array.from(document.querySelectorAll('[data-background-template]'));
  const openPostLinkEl = document.getElementById('editor3OpenPostLink');
  const previewCardShellEl = document.querySelector('.editor3-preview-card');

  if (
    !postTitleEl ||
    !saveBtn ||
    !hashtagsInput ||
    !fontSelectEl ||
    !categorySelectEl ||
    !window.Quill ||
    !window.GlsReadingMode ||
    !window.GlsCardRenderer
  ) {
    return;
  }

  const quill = new Quill('#editor', {
    theme: 'snow',
    placeholder: '여기에 오늘의 문장을 적어 보세요.',
    modules: {
      toolbar: [
        [{ header: [2, false] }],
        ['bold', 'italic'],
        [{ align: '' }, { align: 'center' }],
        ['clean'],
      ],
    },
    formats: ['header', 'bold', 'italic', 'align'],
  });

  let hashtagList = [];
  let me = null;
  let postId = new URLSearchParams(window.location.search).get('postId');
  let isEditMode = Boolean(postId);
  let isSaving = false;
  let queuedAutosave = false;
  let isProgrammaticUpdate = false;
  let autosaveTimer = null;
  let draftSaveTimer = null;
  let currentPreviewIndex = 0;
  let currentUserToken = 'anon';
  let activeDraftKey = '';
  let baselineSignature = '';
  let hasUnsavedChanges = false;
  let modeSelection = isEditMode ? 'manual' : 'auto';
  let alignmentSelection = 'auto';
  let selectedTemplate = 'paper01';
  let currentAnalysis = null;
  let preservedLayoutJson = null;

  const DEFAULT_LAYOUT_BOXES = {
    title_box: { x: 0.336, y: 0.256, w: 0.424, h: 0.122, align: 'center', font_scale: 1, line_height: 1.15 },
    text_box: { x: 0.336, y: 0.364, w: 0.424, h: 0.346, align: 'center', font_scale: 1, line_height: 1.15 },
    footer_box: { x: 0.78, y: 0.9, w: 0.16, h: 0.06, align: 'right', font_scale: 1, line_height: 1.1 },
  };

  const hashtagChipContainer = document.createElement('div');
  hashtagChipContainer.id = 'editor3HashtagChips';
  hashtagChipContainer.className = 'gls-flex gls-flex-wrap';
  hashtagsInput.insertAdjacentElement('afterend', hashtagChipContainer);

  function trackEvent(eventName, properties = {}, options = {}) {
    if (!window.glsoopAnalytics || typeof window.glsoopAnalytics.trackEvent !== 'function') return;
    window.glsoopAnalytics.trackEvent(eventName, properties, options);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function countCompactContentChars(value) {
    return Array.from(String(value || '').replace(/\s/g, '')).length;
  }

  function resolveUserToken(user) {
    const id = Number.parseInt(user?.id, 10);
    if (Number.isInteger(id) && id > 0) return String(id);
    return 'anon';
  }

  function buildLoginRedirect() {
    const nextPath = `${window.location.pathname}${window.location.search || ''}`;
    const query = new URLSearchParams();
    query.set('next', nextPath);
    query.set('from', 'editor3');
    return `/html/login.html?${query.toString()}`;
  }

  function redirectToLogin(reason) {
    trackEvent(
      'editor3_auth_redirect',
      {
        reason: reason || null,
        next_path: `${window.location.pathname}${window.location.search || ''}`,
      },
      { useBeacon: true }
    );
    window.location.href = buildLoginRedirect();
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

  function updateOpenPostLink() {
    if (!openPostLinkEl) return;
    const canOpen = Number.isInteger(Number(postId)) && Number(postId) > 0;
    if (!canOpen) {
      openPostLinkEl.href = '#';
      openPostLinkEl.classList.add('is-disabled');
      openPostLinkEl.setAttribute('aria-disabled', 'true');
      return;
    }
    openPostLinkEl.href = `/html/post3.html?postId=${encodeURIComponent(postId)}`;
    openPostLinkEl.classList.remove('is-disabled');
    openPostLinkEl.setAttribute('aria-disabled', 'false');
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
    if (!normalized || hashtagList.includes(normalized)) return false;
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
    fontSelectEl.value = key;
    if (quill && quill.root) {
      quill.root.style.fontFamily = FONT_MAP[key];
    }
    if (previewCardShellEl) {
      previewCardShellEl.classList.remove('is-preset-serif', 'is-preset-sans', 'is-preset-hand');
    const preset = window.GlsReadingMode.getPreset(key);
    if (preset?.className) previewCardShellEl.classList.add(preset.className);
    if (presetNameEl) {
      if (key === 'sans') presetNameEl.textContent = '고딕';
      else if (key === 'hand') presetNameEl.textContent = '손글씨';
      else presetNameEl.textContent = '명조';
    }
    }
    presetButtons.forEach((button) => {
      button.classList.toggle('is-active', button.dataset.presetKey === key);
    });
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

  function parseLayoutJson(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return clone(raw);
    if (typeof raw !== 'string') return null;
    try {
      return JSON.parse(raw);
    } catch (_error) {
      return null;
    }
  }

  function normalizeTemplateKey(value) {
    return value === 'paper02' ? 'paper02' : 'paper01';
  }

  function extractTemplateFromLayout(layoutJson) {
    const parsed = parseLayoutJson(layoutJson);
    return normalizeTemplateKey(parsed?.canvas?.presetId);
  }

  function applyBackgroundTemplate(templateKey) {
    selectedTemplate = normalizeTemplateKey(templateKey);
    backgroundButtons.forEach((button) => {
      const active = button.dataset.backgroundTemplate === selectedTemplate;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function getSelectedAlignmentMode() {
    return window.GlsReadingMode.normalizeAlignment(alignmentSelection || 'auto');
  }

  function resolveEffectiveAlignment(category, plainText) {
    const recommended = window.GlsReadingMode.resolveRecommendedAlignment(category, plainText);
    return getSelectedAlignmentMode() === 'auto' ? recommended : getSelectedAlignmentMode();
  }

  function buildLayoutPayload(alignment, existingLayout = null) {
    const layout = existingLayout && typeof existingLayout === 'object' ? clone(existingLayout) : {};
    const next = {
      layout_version: 1,
      unit: 'normalized',
      canvas: {
        presetId: normalizeTemplateKey(selectedTemplate || layout.canvas?.presetId),
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
    return next;
  }

  function getSelectedCategory() {
    return window.GlsReadingMode.normalizeCategory(categorySelectEl.value || 'short');
  }

  function getPlainText() {
    return quill.getText().replace(/\r/g, '').trim();
  }

  function truncateText(value, maxLength = 38) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}…`;
  }

  function syncModeUi(recommendedCategory) {
    modeButtons.forEach((button) => {
      const modeValue = button.dataset.modeValue;
      const isActive =
        (modeSelection === 'auto' && modeValue === 'auto') ||
        (modeSelection === 'manual' && modeValue === getSelectedCategory());
      button.classList.toggle('is-active', isActive);
      if (modeValue !== 'auto') {
        button.dataset.recommended = modeValue === recommendedCategory ? 'true' : 'false';
      }
    });
  }

  function renderFeedback(feedback) {
    if (!feedbackListEl) return;
    const items = feedback && feedback.length ? feedback.slice(0, 1) : ['카드 호흡과 여백은 글이 들어오는 즉시 바로 다듬어집니다.'];
    feedbackListEl.innerHTML = items
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join('');
  }

  function renderPreviewPages(pages) {
    if (!previewCarouselEl || !previewThumbsEl) return;

    if (!Array.isArray(pages) || !pages.length) {
      previewCarouselEl.innerHTML = '';
      previewThumbsEl.innerHTML = '';
      return;
    }

    currentPreviewIndex = Math.min(Math.max(currentPreviewIndex, 0), pages.length - 1);

    previewCarouselEl.innerHTML = pages
      .map((page, index) => {
        return `
          <article class="editor3-page${index === currentPreviewIndex ? ' is-active' : ''}" data-preview-page="${index}">
            ${window.GlsCardRenderer.renderPage(page, {
              fontKey: fontSelectEl.value || page?.fontKey || 'serif',
              template: selectedTemplate,
              frameClass: 'editor3-page-frame',
              cardClass: 'editor3-render-card',
              showBadge: true,
            })}
          </article>
        `;
      })
      .join('');

    previewThumbsEl.innerHTML = pages
      .map((page, index) => {
        return `
          <button type="button" class="editor3-thumb${index === currentPreviewIndex ? ' is-active' : ''}" data-thumb-index="${index}" aria-label="${escapeHtml(`${page.pageNumber}장 보기`)}">
            <span class="editor3-thumb__index">${page.pageNumber}장</span>
          </button>
        `;
      })
      .join('');

    previewThumbsEl.querySelectorAll('[data-thumb-index]').forEach((button) => {
      button.addEventListener('click', () => {
        const nextIndex = Number.parseInt(button.dataset.thumbIndex, 10);
        if (!Number.isInteger(nextIndex)) return;
        currentPreviewIndex = nextIndex;
        renderPreviewPages(pages);
        syncPreviewMeta(pages);
      });
    });
  }

  function syncPreviewMeta(pages) {
    const total = Array.isArray(pages) && pages.length ? pages.length : 1;
    if (pageCountEl) pageCountEl.textContent = String(total);
    if (currentPageEl) currentPageEl.textContent = String(Math.min(currentPreviewIndex + 1, total));
    if (currentTotalEl) currentTotalEl.textContent = String(total);
    if (prevPageBtn) prevPageBtn.disabled = total <= 1 || currentPreviewIndex <= 0;
    if (nextPageBtn) nextPageBtn.disabled = total <= 1 || currentPreviewIndex >= total - 1;
  }

  function buildStateSnapshot() {
    const title = postTitleEl.value.trim();
    const plainText = getPlainText();
    const category = getSelectedCategory();
    return {
      title,
      content_html: quill.root.innerHTML.trim(),
      category,
      font_key: fontSelectEl.value || 'serif',
      hashtags: [...hashtagList],
      mode_selection: modeSelection,
      alignment_selection: getSelectedAlignmentMode(),
      background_template: selectedTemplate,
      layout_json: buildLayoutPayload(resolveEffectiveAlignment(category, plainText), preservedLayoutJson),
    };
  }

  function buildStateSignature(state) {
    if (!state || typeof state !== 'object') return '';
    return JSON.stringify({
      title: state.title || '',
      content_html: state.content_html || '',
      category: state.category || '',
      font_key: state.font_key || 'serif',
      hashtags: Array.isArray(state.hashtags) ? state.hashtags : [],
      mode_selection: state.mode_selection || 'auto',
      alignment_selection: state.alignment_selection || 'auto',
      background_template: normalizeTemplateKey(state.background_template || extractTemplateFromLayout(state.layout_json)),
      layout_json: state.layout_json || null,
    });
  }

  function isMeaningfulSnapshot(state) {
    if (!state || typeof state !== 'object') return false;
    if (typeof state.title === 'string' && state.title.trim()) return true;
    if (typeof state.content_html === 'string') {
      const plain = window.GlsReadingMode.decodeHtmlToText(state.content_html || '');
      if (plain) return true;
    }
    if (Array.isArray(state.hashtags) && state.hashtags.length) return true;
    if (normalizeTemplateKey(state.background_template || extractTemplateFromLayout(state.layout_json)) !== 'paper01') return true;
    return false;
  }

  function readDraftPayload(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const payload = JSON.parse(raw);
      if (!payload || typeof payload !== 'object' || !payload.state) return null;
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

  function purgeDrafts() {
    const now = Date.now();
    const prefix = `${DRAFT_PREFIX}:`;
    const keys = [];

    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) keys.push(key);
      }
    } catch (_error) {
      return;
    }

    keys.forEach((key) => {
      const payload = readDraftPayload(key);
      const savedAt = payload?.saved_at ? new Date(payload.saved_at).getTime() : NaN;
      const isExpired = Number.isFinite(savedAt) ? now - savedAt > DRAFT_TTL_MS : true;
      const payloadUser = payload?.user_token ? String(payload.user_token) : '';
      if (!payload || isExpired || (payloadUser && payloadUser !== currentUserToken)) {
        clearDraft(key);
      }
    });
  }

  function applyDraftState(state) {
    if (!state || typeof state !== 'object') return;
    isProgrammaticUpdate = true;
    try {
      postTitleEl.value = state.title || '';
      quill.root.innerHTML = sanitizePostHtml(state.content_html || '');
      hashtagList = [];
      if (Array.isArray(state.hashtags)) {
        state.hashtags.forEach((tag) => addTag(tag, { requireHash: false, markDirty: false }));
      }
      renderHashtagChips();
      modeSelection = state.mode_selection === 'manual' ? 'manual' : 'auto';
      alignmentSelection = window.GlsReadingMode.normalizeAlignment(state.alignment_selection || 'auto');
      categorySelectEl.value = window.GlsReadingMode.normalizeCategory(state.category || 'short');
      fontSelectEl.value = window.GlsReadingMode.normalizeFontKey(state.font_key || 'serif');
      preservedLayoutJson = state.layout_json ? clone(state.layout_json) : preservedLayoutJson;
      applyBackgroundTemplate(state.background_template || extractTemplateFromLayout(preservedLayoutJson));
      applyEditorFont(fontSelectEl.value || 'serif');
      updateCharCounter(getPlainText().length);
      updatePreview();
    } finally {
      isProgrammaticUpdate = false;
    }
  }

  function renderDraftRestoreNotice(payload) {
    if (!noticeRegionEl || !payload) return;
    const savedAtLabel = payload.saved_at
      ? (typeof formatKoreanDateTime === 'function' ? formatKoreanDateTime(payload.saved_at) : String(payload.saved_at))
      : '방금 전';

    noticeRegionEl.innerHTML = `
      <div class="editor-notice" role="status">
        <div class="editor-notice__title">저장된 시안 초안이 있습니다.</div>
        <div class="editor-notice__desc">마지막 저장: <strong>${escapeHtml(savedAtLabel)}</strong></div>
        <div class="editor-notice__actions">
          <button type="button" class="gls-btn gls-btn-primary gls-btn-sm" id="restoreEditor3DraftBtn">초안 복구</button>
          <button type="button" class="gls-btn gls-btn-secondary gls-btn-sm" id="discardEditor3DraftBtn">초안 삭제</button>
        </div>
      </div>
    `;

    const restoreBtn = document.getElementById('restoreEditor3DraftBtn');
    const discardBtn = document.getElementById('discardEditor3DraftBtn');

    if (restoreBtn) {
      restoreBtn.addEventListener('click', () => {
        applyDraftState(payload.state);
        hasUnsavedChanges = true;
        scheduleDraftSave();
        noticeRegionEl.innerHTML = '';
        setSaveStatus('local', payload.saved_at || new Date().toISOString());
      });
    }

    if (discardBtn) {
      discardBtn.addEventListener('click', () => {
        clearDraft();
        noticeRegionEl.innerHTML = '';
      });
    }
  }

  function updatePreview() {
    const title = postTitleEl.value.trim();
    const plainText = getPlainText();
    const recommended = window.GlsReadingMode.detectCategoryFromText(plainText);

    if (modeSelection === 'auto') {
      categorySelectEl.value = recommended.category;
    }

    currentAnalysis = window.GlsCardRenderer.buildDocument({
      title,
      plainText,
      category: getSelectedCategory(),
      fontKey: fontSelectEl.value || 'serif',
      alignment: getSelectedAlignmentMode(),
    });

    if (detectedModeBadgeEl) {
      const prefix = modeSelection === 'auto' ? '자동 감지' : '직접 선택';
      detectedModeBadgeEl.textContent = `${prefix}: ${window.GlsReadingMode.labelForCategory(getSelectedCategory())}`;
    }
    if (detectedModeNoteEl) {
      detectedModeNoteEl.textContent = currentAnalysis?.recommendedReason || '글을 입력하면 추천 모드를 안내해드릴게요.';
    }
    if (alignHelpEl) {
      const recommendedAlignLabel = currentAnalysis?.recommendedAlignment === 'center' ? '가운데' : '왼쪽';
      const activeAlign = currentAnalysis?.resolvedAlignment === 'center' ? '가운데' : '왼쪽';
      alignHelpEl.textContent = getSelectedAlignmentMode() === 'auto'
        ? `현재 글에는 ${recommendedAlignLabel} 정렬을 추천하고 있어요.`
        : `지금은 ${activeAlign} 정렬로 고정해서 보고 있어요.`;
    }
    alignButtons.forEach((button) => {
      button.classList.toggle('is-active', button.dataset.alignValue === getSelectedAlignmentMode());
    });

    syncModeUi(currentAnalysis?.recommendedCategory || recommended.category);
    renderFeedback(currentAnalysis?.feedback || []);
    renderPreviewPages(currentAnalysis?.pages || []);
    syncPreviewMeta(currentAnalysis?.pages || []);
  }

  function buildPayloadForServer() {
    const title = postTitleEl.value.trim();
    const contentHtml = quill.root.innerHTML.trim();
    const plainText = getPlainText();
    const fontKey = fontSelectEl.value || 'serif';
    const category = getSelectedCategory();
    const layoutJson = buildLayoutPayload(resolveEffectiveAlignment(category, plainText), preservedLayoutJson);
    const analyzedContentPages = Array.isArray(currentAnalysis?.pages)
      ? currentAnalysis.pages
          .map((page) => String(page?.plainText || '').replace(/\r/g, '').trim())
          .filter(Boolean)
      : [];
    const contentPages = analyzedContentPages.length > 0
      ? analyzedContentPages
      : plainText && countCompactContentChars(plainText) <= CONTENT_PAGE_MAX_CHARS
        ? [plainText.replace(/\r/g, '').trim()]
        : [];

    return {
      title,
      plain_text: plainText,
      content_html: contentHtml,
      content_with_font: `<!--FONT:${fontKey}-->${contentHtml}`,
      content_format: 'html',
      content_pages: contentPages,
      category,
      hashtags: hashtagList.map((tag) => `#${tag}`).join(' '),
      layout_json: layoutJson,
    };
  }

  function validatePayload(payload) {
    if (!payload.title) return '제목을 입력해주세요.';
    if (!payload.plain_text) return '내용을 입력해주세요.';
    if (!payload.category) return '글 유형을 선택해주세요.';
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
          content_format: payload.content_format,
          ...(payload.content_pages.length > 0 ? { content_pages: payload.content_pages } : {}),
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
      if (source === 'manual') alert('글이 저장되었습니다.');
      updateOpenPostLink();
      return true;
    } catch (error) {
      console.error('[editor3] edit save failed:', error);
      setSaveStatus('error');
      scheduleDraftSave();
      if (source === 'manual') {
        showEditorError(error.message || '글 저장 중 오류가 발생했습니다.');
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
          content_format: payload.content_format,
          ...(payload.content_pages.length > 0 ? { content_pages: payload.content_pages } : {}),
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
        window.location.replace(`/html/editor3.html?postId=${encodeURIComponent(createdPostId)}`);
        return true;
      }
      alert('글이 저장되었습니다.');
      return true;
    } catch (error) {
      console.error('[editor3] create save failed:', error);
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

  function handleEditorMutation(_reason) {
    updatePreview();
    if (isProgrammaticUpdate || isSaving) return;

    const signature = buildStateSignature(buildStateSnapshot());
    hasUnsavedChanges = signature !== baselineSignature;
    if (!hasUnsavedChanges) {
      if (draftSaveTimer) {
        clearTimeout(draftSaveTimer);
        draftSaveTimer = null;
      }
      clearDraft();
      setSaveStatus(isEditMode ? 'saved' : 'local', new Date().toISOString());
      return;
    }

    if (isEditMode && postId) {
      scheduleAutosave();
    } else {
      scheduleDraftSave();
    }
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
      console.error('[editor3] auth check failed:', error);
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
        fontSelectEl.value = window.GlsReadingMode.normalizeFontKey(fontKey || 'serif');
        applyEditorFont(fontSelectEl.value);
        quill.root.innerHTML = sanitizePostHtml(cleanHtml || '');
        categorySelectEl.value = window.GlsReadingMode.normalizeCategory(post.category || 'short');
        modeSelection = 'manual';
        const parsedLayout = parseLayoutJson(post.layout_json);
        applyBackgroundTemplate(extractTemplateFromLayout(parsedLayout));
        const currentAlign = String(parsedLayout?.text_box?.align || '').trim().toLowerCase();
        alignmentSelection = currentAlign === 'left' || currentAlign === 'center' ? currentAlign : 'auto';
        hashtagList = [];
        if (Array.isArray(post.hashtags)) {
          post.hashtags.forEach((tag) => addTag(tag, { requireHash: false, markDirty: false }));
        } else if (post.hashtags) {
          hashtagsInput.value = post.hashtags;
          parseHashtagInputToList(false);
        } else {
          renderHashtagChips();
        }
        preservedLayoutJson = parsedLayout;
      } finally {
        isProgrammaticUpdate = false;
      }

      updateCharCounter(getPlainText().length);
      updatePreview();
      return true;
    } catch (error) {
      console.error('[editor3] edit load failed:', error);
      alert(error.message || '글 정보를 불러오는 중 오류가 발생했습니다.');
      isEditMode = false;
      postId = null;
      activeDraftKey = buildDraftKey('create', currentUserToken);
      preservedLayoutJson = null;
      modeSelection = 'auto';
      return false;
    }
  }

  function bindInputEvents() {
    postTitleEl.addEventListener('input', () => handleEditorMutation('title_input'));

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

    modeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const nextMode = button.dataset.modeValue;
        if (!nextMode) return;
        if (nextMode === 'auto') {
          modeSelection = 'auto';
        } else {
          modeSelection = 'manual';
          categorySelectEl.value = window.GlsReadingMode.normalizeCategory(nextMode);
        }
        handleEditorMutation('mode_change');
      });
    });

    presetButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const nextPreset = button.dataset.presetKey;
        if (!nextPreset) return;
        fontSelectEl.value = window.GlsReadingMode.normalizeFontKey(nextPreset);
        applyEditorFont(fontSelectEl.value);
        handleEditorMutation('preset_change');
      });
    });

    alignButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const nextAlign = button.dataset.alignValue;
        if (!nextAlign) return;
        alignmentSelection = window.GlsReadingMode.normalizeAlignment(nextAlign);
        handleEditorMutation('alignment_change');
      });
    });

    backgroundButtons.forEach((button) => {
      button.addEventListener('click', () => {
        applyBackgroundTemplate(button.dataset.backgroundTemplate);
        handleEditorMutation('background_change');
      });
    });

    prevPageBtn?.addEventListener('click', () => {
      if (!currentAnalysis?.pages?.length) return;
      currentPreviewIndex = Math.max(0, currentPreviewIndex - 1);
      renderPreviewPages(currentAnalysis.pages);
      syncPreviewMeta(currentAnalysis.pages);
    });

    nextPageBtn?.addEventListener('click', () => {
      if (!currentAnalysis?.pages?.length) return;
      currentPreviewIndex = Math.min(currentAnalysis.pages.length - 1, currentPreviewIndex + 1);
      renderPreviewPages(currentAnalysis.pages);
      syncPreviewMeta(currentAnalysis.pages);
    });

    discardDraftBtn?.addEventListener('click', () => {
      clearDraft();
      if (noticeRegionEl) noticeRegionEl.innerHTML = '';
      setSaveStatus('local', new Date().toISOString());
    });

    let isAdjusting = false;
    quill.on('text-change', (delta, oldDelta, source) => {
      if (isAdjusting) return;
      if (source !== 'user') {
        updateCharCounter(getPlainText().length);
        updatePreview();
        return;
      }

      const length = getPlainText().length;
      if (length > MAX_CONTENT_LENGTH) {
        alert(`본문은 최대 ${MAX_CONTENT_LENGTH}자까지 입력할 수 있어요.`);
        isAdjusting = true;
        quill.setContents(oldDelta);
        isAdjusting = false;
        updateCharCounter(getPlainText().length);
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

    openPostLinkEl?.addEventListener('click', (event) => {
      if (openPostLinkEl.classList.contains('is-disabled')) {
        event.preventDefault();
      }
    });

    window.addEventListener('beforeunload', (event) => {
      if (!hasUnsavedChanges || isSaving) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  function cleanupTimers() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    autosaveTimer = null;
    draftSaveTimer = null;
  }

  const authenticated = await ensureAuthenticatedUser();
  if (!authenticated) return;

  purgeDrafts();
  bindInputEvents();
  applyEditorFont(fontSelectEl.value || 'serif');
  applyBackgroundTemplate(selectedTemplate);
  updateOpenPostLink();

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
    updatePreview();
  }

  baselineSignature = buildStateSignature(buildStateSnapshot());
  hasUnsavedChanges = false;

  const draftPayload = readDraftPayload(activeDraftKey);
  if (draftPayload && isMeaningfulSnapshot(draftPayload.state)) {
    const draftSignature = buildStateSignature(draftPayload.state);
    if (draftSignature && draftSignature !== baselineSignature) {
      renderDraftRestoreNotice(draftPayload);
    }
  }

  trackEvent('editor3_open', {
    is_edit_mode: isEditMode,
    post_id: postId ? Number(postId) || null : null,
  });

  setSaveStatus(isEditMode ? 'saved' : 'local', new Date().toISOString());

  window.addEventListener('pagehide', () => {
    cleanupTimers();
  });
});
