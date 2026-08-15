// public/js/editor.js
// 글쓰기(에디터) 페이지 스크립트
// - 로그인 확인
// - Quill 에디터 초기화 + 글자 수 제한(200자)
// - 해시태그 입력 → 칩(Chip) UI 관리
// - 미리보기 카드(제목/본문/폰트/태그) 실시간 반영
// - 새 글 작성 / 기존 글 수정(POST / PUT) 처리

document.addEventListener('DOMContentLoaded', async () => {
  const DRAFT_KEY_PREFIX = 'glsoop:editor:drafts:v2';
  const LEGACY_DRAFT_KEY_PREFIX = 'glsoop:editor:draft:v1';
  const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const DRAFT_SAVE_DEBOUNCE_MS = 900;
  const PREVIEW_SESSION_DEBOUNCE_MS = 450;
  const CONTENT_PAGE_MAX_CHARS = 1000;

  // 해시태그 칩용 내부 리스트
  // ex) ['힐링', '위로']
  let hashtagList = [];
  let draftSaveTimer = null;
  let hasUnsavedChanges = false;
  let baselineStateSignature = '';
  let isProgrammaticUpdate = false;
  let isNavigatingAfterSave = false;
  let isSaving = false;
  let previewSessionTimer = null;
  let previewSessionRequestSeq = 0;
  let previewImageLoadSeq = 0;
  let previewSessionAbortController = null;
  let layoutEditor = null;
  let layoutEditEnabled = false;
  let manualLayoutState = null;
  let previewPageIndex = 0;
  let previewSessionImages = [];
  let previewSessionPageCount = 1;
  let previewSessionTruncated = false;
  let previewCreatedAt = new Date().toISOString();
  let previewOverlayText = { title: '제목', body: '본문' };
  let selectedBackgroundTemplate = 'paper01';
  let loadedContentPages = [];

  const trackEvent = (eventName, properties = {}, options = {}) => {
    if (!window.glsoopAnalytics || typeof window.glsoopAnalytics.trackEvent !== 'function') {
      return;
    }
    window.glsoopAnalytics.trackEvent(eventName, properties, options);
  };

  const buildLoginRedirect = () => {
    const nextPath = `${window.location.pathname}${window.location.search || ''}`;
    const query = new URLSearchParams();
    query.set('next', nextPath);
    query.set('from', 'editor');
    return `/html/login.html?${query.toString()}`;
  };

  const redirectToLogin = (reason) => {
    trackEvent(
      'editor_auth_redirect',
      {
        reason: reason || null,
        next_path: `${window.location.pathname}${window.location.search || ''}`,
      },
      { useBeacon: true }
    );
    window.location.href = buildLoginRedirect();
  };

  const openEditorAuthGate = (reason) => {
    trackEvent(
      'editor_auth_gate_shown',
      {
        reason: reason || null,
        next_path: `${window.location.pathname}${window.location.search || ''}`,
      },
      { useBeacon: true }
    );

    if (window.glsoopAuthGateModal && typeof window.glsoopAuthGateModal.open === 'function') {
      window.glsoopAuthGateModal.open({
        title: '로그인 후 글을 남길 수 있어요',
        message: '글쓰기는 로그인한 회원만 이용할 수 있는 기능입니다.',
        description: '로그인하면 오늘의 문장을 저장하고, 이어서 수정하거나 다시 꺼내볼 수 있습니다.',
        source: 'editor',
        nextPath: `${window.location.pathname}${window.location.search || ''}`,
        backBehavior: 'history',
      });
      return true;
    }
    return false;
  };

  const pageParams = new URLSearchParams(window.location.search);
  const postId = pageParams.get('postId');
  const requestedDraftId = String(pageParams.get('draftId') || '').replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 120);
  const generatedDraftId =
    typeof window.crypto?.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const draftId = postId ? `edit-${postId}` : requestedDraftId || generatedDraftId;
  if (!postId && !requestedDraftId) {
    pageParams.set('draftId', draftId);
    window.history.replaceState(null, '', `${window.location.pathname}?${pageParams.toString()}`);
  }
  const writingEventContext = !postId && pageParams.get('campaignKey') && pageParams.get('campaignPromptKey')
    ? {
        eventKey: pageParams.get('campaignKey'),
        promptKey: pageParams.get('campaignPromptKey'),
        promptDay: pageParams.get('promptDay'),
        promptTitle: pageParams.get('promptTitle') || '',
        promptBody: pageParams.get('promptBody') || '',
        promptCategory: pageParams.get('promptCategory') || '',
        promptTags: pageParams.get('promptTags') || '',
        promptSource: pageParams.get('promptSource') || '',
      }
    : null;
  let isEditMode = Boolean(postId);
  let draftStorageKey = null;
  let legacyDraftStorageKey = null;
  let authNamespace = null;

  // 1. 로그인 상태 확인
  try {
    // 브라우저 캐시 사용 금지: 304 방지
    const res = await fetch('/api/me', { cache: 'no-store' });

    // 진짜 로그아웃 상태
    if (res.status === 401) {
      if (!openEditorAuthGate('unauthorized')) {
        alert('로그인이 필요한 기능입니다.');
        redirectToLogin('unauthorized');
      }
      return;
    }

    // 그 외의 이상한 상태(500, 304 등)도 일단 에러로 처리
    if (!res.ok) {
      console.error('로그인 확인 실패:', res.status, res.statusText);
      if (!openEditorAuthGate(`status_${res.status}`)) {
        alert('로그인 상태를 확인하는 중 오류가 발생했습니다.');
        redirectToLogin(`status_${res.status}`);
      }
      return;
    }

    const me = await res.json().catch(() => ({}));
    if (!me.ok) {
      redirectToLogin('invalid_session');
      return;
    }
    const userId = Number(me.id);
    authNamespace = Number.isInteger(userId) && userId > 0
      ? `user:${userId}`
      : `email:${String(me.email || 'session').trim().toLowerCase()}`;
    draftStorageKey = isEditMode
      ? `${DRAFT_KEY_PREFIX}:${authNamespace}:edit:${postId}`
      : `${DRAFT_KEY_PREFIX}:${authNamespace}:create:${draftId}`;
    legacyDraftStorageKey = isEditMode
      ? `${LEGACY_DRAFT_KEY_PREFIX}:edit:${postId}`
      : `${LEGACY_DRAFT_KEY_PREFIX}:new`;
  } catch (e) {
    console.error(e);
    if (!openEditorAuthGate('network_error')) {
      alert('로그인 상태를 확인하는 중 오류가 발생했습니다.');
      redirectToLogin('network_error');
    }
    return;
  }


  // 2. Quill 에디터 초기화
  const quill = new Quill('#editor', {
    theme: 'snow',
    placeholder: '여기에 오늘의 문장을 적어 보세요.', // 에디터 안 안내 문구
    modules: {
      // 툴바 구성
      toolbar: [
        [{ header: [1, 2, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        [
          { align: '' },
          { align: 'center' },
          { align: 'right' },
          { align: 'justify' },
        ],
        ['blockquote'],
        ['clean'],
      ],
    },
    // ✅ 정렬 정보도 포맷으로 저장되도록 formats 지정
    formats: [
      'header',
      'bold',
      'italic',
      'underline',
      'strike',
      'list',
      'bullet',
      'blockquote',
      'align', // ⬅ 이 줄 덕분에 ql-align-* 클래스가 실제 포맷으로 반영됨
    ],
  });

  // DOM 요소들 가져오기
  const titleInput = document.getElementById('postTitle');      // 제목 입력
  const saveBtn = document.getElementById('saveBtn');           // 저장 버튼
  const hashtagsInput = document.getElementById('postHashtags'); // ✅ 해시태그 입력 인풋

  // ✅ 미리보기 요소
  const previewFeedCardMountEl = document.getElementById('previewFeedCardMount');
  const layoutEditToggleBtn = document.getElementById('layoutEditToggleBtn');
  const layoutResetBtn = document.getElementById('layoutResetBtn');
  const layoutResetAllBtn = document.getElementById('layoutResetAllBtn');
  const layoutPageStatusEl = document.getElementById('layoutPageStatus');
  const layoutSafeAreaHintEl = document.getElementById('layoutSafeAreaHint');
  const previewSessionErrorEl = document.getElementById('previewSessionError');
  const previewCarouselControlsEl = document.getElementById('previewCarouselControls');
  const previewCarouselPrevBtn = document.getElementById('previewCarouselPrevBtn');
  const previewCarouselNextBtn = document.getElementById('previewCarouselNextBtn');
  const previewCarouselCurrentPageEl = document.getElementById('previewCarouselCurrentPage');
  const previewCarouselTotalPagesEl = document.getElementById('previewCarouselTotalPages');
  const previewTruncatedNoticeEl = document.getElementById('previewTruncatedNotice');
  const backgroundTemplateButtons = Array.from(
    document.querySelectorAll('[data-background-template]')
  );

  // ✅ 남은 글자 수 표시 요소 (에디터 박스 오른쪽 아래)
  const charCounterEl = document.getElementById('charCounter');

  // ✅ 폰트 선택 요소 (select)
  const fontSelectEl = document.getElementById('fontSelect');
  const categorySelectEl = document.getElementById('categorySelect');

  // 에디터 상단 에러 영역 (Bootstrap alert 등)
  const editorAlertEl = document.getElementById('editorAlert');
  const editorWritingCampaignEl = document.getElementById('editorWritingCampaign');

  // 폰트 키 → 실제 font-family 매핑
  const FONT_MAP = {
    serif: "'Nanum Myeongjo','Noto Serif KR',serif",
    sans: "'Noto Sans KR',system-ui,-apple-system,BlinkMacSystemFont,sans-serif",
    hand: "'Nanum Pen Script',cursive",
  };

  // 폰트 키 → 사용자에게 보여줄 라벨
  const FONT_LABEL_MAP = {
    serif: '감성 명조체',
    sans: '담백한 고딕체',
    hand: '손글씨 느낌',
  };

  function normalizeEditorContentPage(raw) {
    return String(raw || '').replace(/\r\n?/g, '\n').trim();
  }

  function normalizeEditorContentSignature(raw) {
    return normalizeEditorContentPage(raw).replace(/\s+/g, ' ').trim();
  }

  function countCompactEditorChars(raw) {
    return Array.from(String(raw || '').replace(/\s/g, '')).length;
  }

  function normalizeLoadedContentPages(rawPages) {
    if (!Array.isArray(rawPages)) return [];
    const pages = rawPages.map(normalizeEditorContentPage);
    while (pages.length > 1 && !pages[pages.length - 1]) {
      pages.pop();
    }
    return pages.some(Boolean) ? pages : [];
  }

  function buildEditorContentPagesForSave(plainText) {
    const normalizedPlainText = normalizeEditorContentPage(plainText);
    if (!normalizedPlainText) return [];

    const currentSignature = normalizeEditorContentSignature(normalizedPlainText);
    const loadedPages = normalizeLoadedContentPages(loadedContentPages);
    if (loadedPages.length > 0) {
      const loadedSignature = normalizeEditorContentSignature(loadedPages.join('\n\n'));
      if (loadedSignature && loadedSignature === currentSignature) {
        return loadedPages;
      }

      if (countCompactEditorChars(normalizedPlainText) <= CONTENT_PAGE_MAX_CHARS) {
        return [normalizedPlainText];
      }
    }

    return [];
  }

  function hasChangedLoadedPageText(plainText) {
    const loadedPages = normalizeLoadedContentPages(loadedContentPages);
    if (!loadedPages.length) return false;
    const loadedSignature = normalizeEditorContentSignature(loadedPages.join('\n\n'));
    const currentSignature = normalizeEditorContentSignature(plainText);
    return Boolean(loadedSignature && currentSignature && loadedSignature !== currentSignature);
  }

  function normalizeTemplateKey(value) {
    return value === 'paper02' ? 'paper02' : 'paper01';
  }

  function extractTemplateFromLayout(raw) {
    let parsed = raw;
    if (typeof parsed === 'string') {
      const trimmed = parsed.trim();
      if (!trimmed) return 'paper01';
      try {
        parsed = JSON.parse(trimmed);
      } catch (_error) {
        return 'paper01';
      }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return 'paper01';
    }
    return normalizeTemplateKey(parsed.canvas?.presetId);
  }

  const LAYOUT_UNIT_NORMALIZED = 'normalized';
  const LAYOUT_BOX_KEYS = ['title_box', 'text_box', 'footer_box'];
  const EDITABLE_LAYOUT_BOX_KEYS = ['title_box', 'text_box'];
  const LAYOUT_FIELD_KEYS = [
    'x',
    'y',
    'w',
    'h',
    'align',
    'font_scale',
    'line_height',
    'letter_spacing',
  ];
  const LAYOUT_FONT_SCALE_RANGE = { min: 0.7, max: 2.0 };
  const LAYOUT_LINE_HEIGHT_RANGE = { min: 1.0, max: 2.2 };
  const LAYOUT_LETTER_SPACING_RANGE = { min: -0.04, max: 0.08 };
  const DEFAULT_LAYOUT_BOXES = {
    title_box: {
      x: 0.336,
      y: 0.256,
      w: 0.424,
      h: 0.122,
      align: 'center',
      font_scale: 1,
      line_height: 1.15,
    },
    text_box: {
      x: 0.336,
      y: 0.364,
      w: 0.424,
      h: 0.346,
      align: 'center',
      font_scale: 1,
      line_height: 1.15,
    },
  };

  function cloneLayout(layout) {
    if (!layout || typeof layout !== 'object') return null;
    try {
      return JSON.parse(JSON.stringify(layout));
    } catch (_error) {
      return null;
    }
  }

  function roundLayoutNumber(value, precision = 4) {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
  }

  function buildDefaultLayout() {
    return {
      layout_version: 1,
      unit: LAYOUT_UNIT_NORMALIZED,
      canvas: {
        presetId: normalizeTemplateKey(selectedBackgroundTemplate),
      },
      title_box: cloneLayout(DEFAULT_LAYOUT_BOXES.title_box),
      text_box: cloneLayout(DEFAULT_LAYOUT_BOXES.text_box),
    };
  }

  function buildDefaultLayoutState() {
    return {
      layout_version: 2,
      unit: LAYOUT_UNIT_NORMALIZED,
      canvas: {
        presetId: normalizeTemplateKey(selectedBackgroundTemplate),
      },
      base: {
        title_box: cloneLayout(DEFAULT_LAYOUT_BOXES.title_box),
        text_box: cloneLayout(DEFAULT_LAYOUT_BOXES.text_box),
      },
      pages: [],
    };
  }

  function toLayoutNumber(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value.trim());
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function normalizeLayoutBox(boxRaw, { required = false, partial = false } = {}) {
    if (boxRaw == null) {
      return partial ? null : required ? null : null;
    }
    if (!boxRaw || typeof boxRaw !== 'object' || Array.isArray(boxRaw)) {
      return null;
    }

    const normalized = {};
    let hasAny = false;

    const assignNumber = (key, { min = 0, max = 1, precision = 4, positive = false } = {}) => {
      if (boxRaw[key] === undefined) {
        return;
      }
      const value = toLayoutNumber(boxRaw[key]);
      if (value == null) {
        throw new Error('invalid_number');
      }
      if (positive ? value <= 0 || value > max : value < min || value > max) {
        throw new Error('invalid_range');
      }
      normalized[key] = roundLayoutNumber(value, precision);
      hasAny = true;
    };

    try {
      if (partial) {
        assignNumber('x');
        assignNumber('y');
        assignNumber('w', { max: 1, positive: true });
        assignNumber('h', { max: 1, positive: true });
      } else {
        const x = toLayoutNumber(boxRaw.x);
        const y = toLayoutNumber(boxRaw.y);
        const w = toLayoutNumber(boxRaw.w);
        const h = toLayoutNumber(boxRaw.h);
        if (x == null || y == null || w == null || h == null) {
          return null;
        }
        if (x < 0 || x > 1 || y < 0 || y > 1 || w <= 0 || w > 1 || h <= 0 || h > 1) {
          return null;
        }
        normalized.x = roundLayoutNumber(x, 4);
        normalized.y = roundLayoutNumber(y, 4);
        normalized.w = roundLayoutNumber(w, 4);
        normalized.h = roundLayoutNumber(h, 4);
        hasAny = true;
      }
    } catch (_error) {
      return null;
    }

    if (typeof boxRaw.align === 'string') {
      const alignRaw = boxRaw.align.trim().toLowerCase();
      if (alignRaw) {
        if (alignRaw !== 'left' && alignRaw !== 'center' && alignRaw !== 'right') {
          return null;
        }
        normalized.align = alignRaw;
        hasAny = true;
      }
    } else if (!partial) {
      normalized.align = 'center';
    }

    if (boxRaw.font_scale !== undefined) {
      const fontScale = toLayoutNumber(boxRaw.font_scale);
      if (
        fontScale == null ||
        fontScale < LAYOUT_FONT_SCALE_RANGE.min ||
        fontScale > LAYOUT_FONT_SCALE_RANGE.max
      ) {
        return null;
      }
      normalized.font_scale = roundLayoutNumber(fontScale, 3);
      hasAny = true;
    } else if (!partial) {
      normalized.font_scale = 1;
    }

    if (boxRaw.line_height !== undefined) {
      const lineHeight = toLayoutNumber(boxRaw.line_height);
      if (
        lineHeight == null ||
        lineHeight < LAYOUT_LINE_HEIGHT_RANGE.min ||
        lineHeight > LAYOUT_LINE_HEIGHT_RANGE.max
      ) {
        return null;
      }
      normalized.line_height = roundLayoutNumber(lineHeight, 3);
      hasAny = true;
    } else if (!partial) {
      normalized.line_height = 1.15;
    }

    if (boxRaw.letter_spacing !== undefined) {
      const letterSpacing = toLayoutNumber(boxRaw.letter_spacing);
      if (
        letterSpacing == null ||
        letterSpacing < LAYOUT_LETTER_SPACING_RANGE.min ||
        letterSpacing > LAYOUT_LETTER_SPACING_RANGE.max
      ) {
        return null;
      }
      normalized.letter_spacing = roundLayoutNumber(letterSpacing, 3);
      hasAny = true;
    }

    return partial ? (hasAny ? normalized : null) : normalized;
  }

  function mergeLayoutBoxes(baseBox, overrideBox) {
    if (!baseBox) return null;
    return normalizeLayoutBox(
      {
        ...baseBox,
        ...(overrideBox || {}),
      },
      { required: true }
    );
  }

  function normalizePageOverride(pageRaw, baseLayout) {
    if (pageRaw == null) return null;
    if (!pageRaw || typeof pageRaw !== 'object' || Array.isArray(pageRaw)) {
      return null;
    }

    const normalized = {};
    LAYOUT_BOX_KEYS.forEach((boxKey) => {
      if (!Object.prototype.hasOwnProperty.call(pageRaw, boxKey) || pageRaw[boxKey] == null) {
        return;
      }
      const override = normalizeLayoutBox(pageRaw[boxKey], { partial: true });
      if (!override) {
        throw new Error('invalid_page_override');
      }
      const baseBox = baseLayout?.[boxKey] || null;
      if (!baseBox || !mergeLayoutBoxes(baseBox, override)) {
        throw new Error('invalid_page_override');
      }
      normalized[boxKey] = override;
    });

    return Object.keys(normalized).length > 0 ? normalized : null;
  }

  function trimLayoutPages(pages) {
    const nextPages = Array.isArray(pages) ? pages.map((page) => (page ? cloneLayout(page) : null)) : [];
    while (nextPages.length > 0 && !nextPages[nextPages.length - 1]) {
      nextPages.pop();
    }
    return nextPages;
  }

  function parseLayoutJson(raw) {
    if (raw == null) return null;
    let parsed = raw;
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

    const version =
      parsed.layout_version === undefined
        ? 1
        : Number.parseInt(parsed.layout_version, 10);

    if (version === 1) {
      const textBox = normalizeLayoutBox(parsed.text_box, { required: true });
      if (!textBox) return null;
      const titleBox =
        normalizeLayoutBox(parsed.title_box, { required: false }) ||
        cloneLayout(DEFAULT_LAYOUT_BOXES.title_box);
      const footerBox = normalizeLayoutBox(parsed.footer_box, { required: false });

      const state = buildDefaultLayoutState();
      state.canvas = {
        presetId: normalizeTemplateKey(parsed.canvas?.presetId),
      };
      state.base.text_box = textBox;
      state.base.title_box = titleBox;
      if (footerBox) {
        state.base.footer_box = footerBox;
      }
      return state;
    }

    if (version !== 2) {
      return null;
    }

    const baseRaw = parsed.base;
    if (!baseRaw || typeof baseRaw !== 'object' || Array.isArray(baseRaw)) {
      return null;
    }

    const baseTextBox = normalizeLayoutBox(baseRaw.text_box, { required: true });
    if (!baseTextBox) return null;
    const baseTitleBox =
      normalizeLayoutBox(baseRaw.title_box, { required: false }) ||
      cloneLayout(DEFAULT_LAYOUT_BOXES.title_box);
    const baseFooterBox = normalizeLayoutBox(baseRaw.footer_box, { required: false });

    const normalized = {
      layout_version: 2,
      unit: LAYOUT_UNIT_NORMALIZED,
      canvas: {
        presetId: normalizeTemplateKey(parsed.canvas?.presetId),
      },
      base: {
        text_box: baseTextBox,
        title_box: baseTitleBox,
      },
      pages: [],
    };
    if (baseFooterBox) {
      normalized.base.footer_box = baseFooterBox;
    }

    const rawPages = parsed.pages === undefined || parsed.pages === null ? [] : parsed.pages;
    if (!Array.isArray(rawPages)) {
      return null;
    }

    try {
      normalized.pages = trimLayoutPages(
        rawPages.map((pageRaw) => normalizePageOverride(pageRaw, normalized.base))
      );
    } catch (_error) {
      return null;
    }

    return normalized;
  }

  function buildLayoutPayloadForSave(layoutState) {
    const templateKey = normalizeTemplateKey(selectedBackgroundTemplate);
    if (!layoutState && templateKey === 'paper01') return null;
    const parsed = parseLayoutJson(layoutState || buildDefaultLayoutState());
    if (!parsed) return null;
    return {
      layout_version: 2,
      unit: LAYOUT_UNIT_NORMALIZED,
      canvas: {
        presetId: templateKey,
      },
      base: cloneLayout(parsed.base),
      pages: trimLayoutPages(parsed.pages),
    };
  }

  function getResolvedLayoutForPage(layoutState, pageIndex = 0) {
    const parsed = parseLayoutJson(layoutState);
    if (!parsed) return buildDefaultLayout();

    const safePageIndex = Math.max(0, Number.parseInt(pageIndex, 10) || 0);
    const pageOverride =
      Array.isArray(parsed.pages) && safePageIndex < parsed.pages.length
        ? parsed.pages[safePageIndex]
        : null;

    const resolved = {
      layout_version: 1,
      unit: LAYOUT_UNIT_NORMALIZED,
      title_box: mergeLayoutBoxes(parsed.base.title_box, pageOverride?.title_box),
      text_box: mergeLayoutBoxes(parsed.base.text_box, pageOverride?.text_box),
    };
    if (parsed.base.footer_box) {
      resolved.footer_box = mergeLayoutBoxes(parsed.base.footer_box, pageOverride?.footer_box);
    }
    return resolved;
  }

  function diffLayoutBox(baseBox, nextBox) {
    if (!baseBox || !nextBox) return null;
    const diff = {};
    LAYOUT_FIELD_KEYS.forEach((key) => {
      if (nextBox[key] === undefined) return;
      if (baseBox[key] !== nextBox[key]) {
        diff[key] = nextBox[key];
      }
    });
    return Object.keys(diff).length > 0 ? diff : null;
  }

  function hasLayoutTitleBox(layoutState) {
    if (!layoutState) return false;
    const resolved = getResolvedLayoutForPage(layoutState, 0);
    const titleBox = resolved?.title_box;
    return !!(
      titleBox &&
      Number.isFinite(Number(titleBox.x)) &&
      Number.isFinite(Number(titleBox.y)) &&
      Number.isFinite(Number(titleBox.w)) &&
      Number.isFinite(Number(titleBox.h))
    );
  }

  function hasCurrentPageOverride(layoutState, pageIndex = 0) {
    const parsed = parseLayoutJson(layoutState);
    if (!parsed || !Array.isArray(parsed.pages)) return false;
    const safePageIndex = Math.max(0, Number.parseInt(pageIndex, 10) || 0);
    const pageOverride = parsed.pages[safePageIndex];
    return !!(pageOverride && Object.keys(pageOverride).length > 0);
  }

  function applyResolvedLayoutToPage(layoutState, pageIndex, resolvedLayout) {
    const parsed = parseLayoutJson(layoutState) || buildDefaultLayoutState();
    const nextState = cloneLayout(parsed) || buildDefaultLayoutState();
    const safePageIndex = Math.max(0, Number.parseInt(pageIndex, 10) || 0);
    const nextPages = Array.isArray(nextState.pages) ? [...nextState.pages] : [];
    const nextPageOverride = nextPages[safePageIndex] ? cloneLayout(nextPages[safePageIndex]) : {};

    EDITABLE_LAYOUT_BOX_KEYS.forEach((boxKey) => {
      const baseBox = nextState.base?.[boxKey] || null;
      const resolvedBox = resolvedLayout?.[boxKey] || null;
      const diff = diffLayoutBox(baseBox, resolvedBox);
      if (diff) {
        nextPageOverride[boxKey] = diff;
      } else {
        delete nextPageOverride[boxKey];
      }
    });

    nextPages[safePageIndex] =
      Object.keys(nextPageOverride).length > 0 ? nextPageOverride : null;
    nextState.pages = trimLayoutPages(nextPages);
    return parseLayoutJson(nextState) || buildDefaultLayoutState();
  }

  function resetCurrentLayoutPage(layoutState, pageIndex) {
    const parsed = parseLayoutJson(layoutState) || buildDefaultLayoutState();
    const nextState = cloneLayout(parsed) || buildDefaultLayoutState();
    const safePageIndex = Math.max(0, Number.parseInt(pageIndex, 10) || 0);
    const nextPages = Array.isArray(nextState.pages) ? [...nextState.pages] : [];
    nextPages[safePageIndex] = null;
    nextState.pages = trimLayoutPages(nextPages);
    return parseLayoutJson(nextState) || buildDefaultLayoutState();
  }

  function resetAllLayoutPages() {
    return buildDefaultLayoutState();
  }

  function syncBackgroundTemplateButtons() {
    backgroundTemplateButtons.forEach((button) => {
      const isActive =
        normalizeTemplateKey(button.dataset.backgroundTemplate) === selectedBackgroundTemplate;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function applyBackgroundTemplate(
    templateKey,
    { markDirty = false, refreshPreview = true } = {}
  ) {
    const nextTemplate = normalizeTemplateKey(templateKey);
    selectedBackgroundTemplate = nextTemplate;

    if (manualLayoutState) {
      const parsed = parseLayoutJson(manualLayoutState) || buildDefaultLayoutState();
      manualLayoutState = {
        ...parsed,
        canvas: {
          presetId: nextTemplate,
        },
      };
    }

    syncBackgroundTemplateButtons();
    if (refreshPreview) {
      updatePreview();
    }
    if (markDirty) {
      onEditorUserMutation('background_change');
    }
  }

  /**
   * ✅ 에디터 + 미리보기 카드에 폰트 적용
   * - select에서 폰트 변경 시 호출
   * - quill.root와 미리보기 quote-card의 클래스에 반영
   */
  function applyEditorFont(fontKey) {
    const key = FONT_MAP[fontKey] ? fontKey : 'serif';
    const fontFamily = FONT_MAP[key];

    // 1) Quill 에디터 내부 텍스트 폰트 변경
    if (quill && quill.root) {
      quill.root.style.fontFamily = fontFamily;
    }

    // 폰트 라벨 등 미리보기 메타도 갱신
    updatePreviewMeta();
  }

  // 폰트 선택 변경 시 적용
  if (fontSelectEl) {
    fontSelectEl.addEventListener('change', (e) => {
      applyEditorFont(e.target.value);
      onEditorUserMutation('font_change');
    });

    // 페이지 처음 열릴 때 select의 기본값대로 폰트 적용
    applyEditorFont(fontSelectEl.value || 'serif');
  } else {
    // 혹시라도 요소 못 찾았을 때를 대비한 기본 적용
    applyEditorFont('serif');
  }

  // 필수 요소 확인
  if (!titleInput || !saveBtn) {
    console.error('postTitle 또는 saveBtn 요소를 찾을 수 없습니다.');
    return;
  }

  if (layoutEditToggleBtn) {
    layoutEditToggleBtn.addEventListener('click', () => {
      setLayoutEditMode(!layoutEditEnabled);
      updatePreview();
    });
  }

  if (layoutResetBtn) {
    layoutResetBtn.addEventListener('click', () => {
      manualLayoutState = resetCurrentLayoutPage(manualLayoutState, previewPageIndex);
      updateLayoutSafeAreaHint(false);
      updatePreview();
      onEditorUserMutation('layout_page_reset');
    });
  }

  if (layoutResetAllBtn) {
    layoutResetAllBtn.addEventListener('click', () => {
      manualLayoutState = resetAllLayoutPages();
      updateLayoutSafeAreaHint(false);
      updatePreview();
      onEditorUserMutation('layout_reset_all');
    });
  }

  if (previewCarouselPrevBtn) {
    previewCarouselPrevBtn.addEventListener('click', () => {
      if (previewPageIndex <= 0) return;
      previewPageIndex -= 1;
      const previewCard = previewFeedCardMountEl?.querySelector('.gls-post-card');
      if (previewCard) {
        applyEditorPreviewPage(previewCard, previewSessionImages[previewPageIndex] || '');
        syncEditorLayoutEditor(previewCard);
      } else {
        syncPreviewCarouselUi();
      }
    });
  }

  if (previewCarouselNextBtn) {
    previewCarouselNextBtn.addEventListener('click', () => {
      if (previewPageIndex >= previewSessionImages.length - 1) return;
      previewPageIndex += 1;
      const previewCard = previewFeedCardMountEl?.querySelector('.gls-post-card');
      if (previewCard) {
        applyEditorPreviewPage(previewCard, previewSessionImages[previewPageIndex] || '');
        syncEditorLayoutEditor(previewCard);
      } else {
        syncPreviewCarouselUi();
      }
    });
  }

  backgroundTemplateButtons.forEach((button) => {
    button.addEventListener('click', () => {
      applyBackgroundTemplate(button.dataset.backgroundTemplate, { markDirty: true });
    });
  });

  updateLayoutToggleUi();
  updateLayoutSafeAreaHint(false);
  syncBackgroundTemplateButtons();

  /* -----------------------
     해시태그 칩 유틸 함수들
  ------------------------ */

  // 해시태그 칩들을 담을 컨테이너 (인풋 아래에 붙임)
  let hashtagChipContainer = null;
  if (hashtagsInput) {
    hashtagChipContainer = document.createElement('div');
    hashtagChipContainer.id = 'hashtagChips';
    hashtagChipContainer.className = 'gls-flex gls-flex-wrap';
    // 인풋 바로 아래에 붙이기
    hashtagsInput.insertAdjacentElement('afterend', hashtagChipContainer);
  }

  /**
   * 입력된 태그 문자열을 정규화
   * - 앞뒤 공백 제거 후, 해시태그(#)가 필수인 경우 처리
   * - requireHash가 true일 때는 '#'으로 시작하고 1글자 이상이어야 인식
   * - 허용되지 않으면 '' 반환
   */
  function normalizeTag(raw, requireHash = true) {
    if (!raw) return '';
    let t = String(raw).trim();
    if (!t) return '';

    if (requireHash) {
      if (!t.startsWith('#')) return '';
      t = t.slice(1);
      if (!t.trim()) return '';
    } else {
      if (t.startsWith('#')) {
        t = t.slice(1);
      }
    }

    return t;
  }

  /**
   * 내부 리스트(hashtagList)를 기반으로
   * 해시태그 입력 인풋의 값을 동기화
   * - "#힐링 #위로" 형식으로 채워줌
   */
  function syncHashtagInputFromList() {
    if (!hashtagsInput) return;
    if (!hashtagList.length) {
      // 칩이 없으면 기존 값 그대로 유지 (사용자가 직접 쓴 것 남겨두기)
      return;
    }
    const value = hashtagList.map((t) => '#' + t).join(' ');
    hashtagsInput.value = value;
  }

  /**
   * hashtagList를 기반으로 칩 UI 렌더링
   * - 각 태그마다 "칩 + X 버튼" 추가
   */
  function renderHashtagChips() {
    if (!hashtagChipContainer) return;

    if (!hashtagList.length) {
      hashtagChipContainer.innerHTML = '';
      return;
    }

    hashtagChipContainer.innerHTML = hashtagList
      .map(
        (t) => `
        <span class="hashtag-chip">
          #${escapeHtml(t)}
          <button type="button" class="hashtag-chip-remove" data-tag="${escapeHtml(
            t
          )}">×</button>
        </span>
      `
      )
      .join('');

    // 각 칩의 X 버튼(삭제 버튼)에 이벤트 등록
    hashtagChipContainer
      .querySelectorAll('.hashtag-chip-remove')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const tag = btn.getAttribute('data-tag');
          if (!tag) return;
          // 리스트에서 해당 태그 제거
          hashtagList = hashtagList.filter((t) => t !== tag);
          syncHashtagInputFromList();
          renderHashtagChips();
          updatePreviewMeta();
          onEditorUserMutation('hashtag_remove');
        });
      });
  }

  /**
   * 새 태그 추가
   * - 정규화하고, 중복 아니면 리스트에 push
   * - 인풋 및 칩 UI 동기화
   */
  function addTag(raw, { requireHash = true, markDirty = true } = {}) {
    const t = normalizeTag(raw, requireHash);
    if (!t) return false;
    if (hashtagList.includes(t)) return false; // 중복 태그 방지
    hashtagList.push(t);
    syncHashtagInputFromList();
    renderHashtagChips();
    updatePreviewMeta();
    if (markDirty) {
      onEditorUserMutation('hashtag_add');
    }
    return true;
  }

  /**
   * 해시태그 인풋의 텍스트를 hashtagList로 파싱
   * - 공백/쉼표 기준으로 split
   * - normalizeTag 후 중복 제거
   */
  function parseHashtagInputToList(requireHash = true) {
    if (!hashtagsInput) return;
    const raw = hashtagsInput.value || '';
    if (!raw.trim()) {
      hashtagList = [];
      renderHashtagChips();
      updatePreviewMeta();
      return;
    }

    const tokens = raw
      .split(/[,\s]+/)
      .map((t) => normalizeTag(t, requireHash))
      .filter((t) => t.length > 0);

    // 중복 제거를 위해 Set 사용
    hashtagList = Array.from(new Set(tokens));
    syncHashtagInputFromList();
    renderHashtagChips();
    updatePreviewMeta();
  }

  function commitHashtagInput({ requireHash = true, clearInput = false } = {}) {
    if (!hashtagsInput) return;
    const raw = hashtagsInput.value || '';
    if (!raw.trim()) return;

    const tokens = raw.split(/[,\s]+/).filter(Boolean);
    let added = false;

    tokens.forEach((token) => {
      added = addTag(token, { requireHash }) || added;
    });

    if (!added) {
      // 유효한 태그가 없었으면 입력값만 정리
      if (clearInput) hashtagsInput.value = '';
      return;
    }

    if (clearInput) {
      hashtagsInput.value = '';
    } else {
      syncHashtagInputFromList();
    }
  }

  // 인풋에서 Enter/스페이스/쉼표/Tab을 누를 때 태그 추가 시도
  if (hashtagsInput) {
    let isComposingTag = false;

    hashtagsInput.addEventListener('compositionstart', () => {
      isComposingTag = true;
    });

    hashtagsInput.addEventListener('compositionend', () => {
      isComposingTag = false;
    });

    hashtagsInput.addEventListener('keydown', (e) => {
      if (isComposingTag) return;
      if (['Enter', ' ', ',', 'Tab'].includes(e.key)) {
        const val = hashtagsInput.value;
        const parts = val.split(/[,\s]+/);
        const last = parts[parts.length - 1];
        if (last && last.trim().length > 0) {
          e.preventDefault(); // 기본 줄바꿈 등 막기
          commitHashtagInput({ clearInput: true });
        }
      }
    });

    // 포커스를 잃을 때 인풋 전체를 파싱해서 리스트/칩 반영
    hashtagsInput.addEventListener('blur', () => {
      commitHashtagInput({ clearInput: true });
    });
  }

  /**
   * ✅ 현재 글자 수 업데이트 함수
   */
  function updateCharCounter(currentLength) {
    if (!charCounterEl) return;
    charCounterEl.textContent = `${Math.max(0, Number(currentLength) || 0)}자`;
    charCounterEl.classList.remove('text-danger');
    charCounterEl.classList.add('gls-text-muted');
  }

  /**
   * 미리보기 하단 폰트/태그 메타 영역 업데이트
   * - 폰트 셀렉트 값 기준으로 폰트 라벨 표시
   * - hashtagList 또는 인풋값을 기반으로 태그 표시
   */
  function updatePreviewMeta() {
    // 공용 카드 미리보기에서는 별도 메타 텍스트를 렌더링하지 않음.
    if (!previewFeedCardMountEl) return;

    const fontKey = fontSelectEl ? fontSelectEl.value || 'serif' : 'serif';
    const fontLabel = FONT_LABEL_MAP[fontKey] || '감성 명조체';

    let tagsText = '';
    if (hashtagList.length > 0) {
      tagsText = hashtagList.map((t) => `#${t}`).join(' ');
    } else if (hashtagsInput && hashtagsInput.value.trim()) {
      tagsText = hashtagsInput.value.trim();
    }

    previewFeedCardMountEl.dataset.previewFontLabel = fontLabel;
    previewFeedCardMountEl.dataset.previewTags = tagsText;
  }

  /**
   * ✅ 미리보기 전체 업데이트
   * - 제목, 본문, 폰트, 태그 모두 반영
   */
  function updatePreview() {
    const title = titleInput.value.trim();
    const contentHtml = quill.root.innerHTML.trim();
    const plainText = quill.getText().trim();
    previewOverlayText = {
      title: title || '제목',
      body: plainText || '본문',
    };

    if (previewFeedCardMountEl && typeof buildStandardPostCardHTML === 'function') {
      const previewPost = buildEditorPreviewPost({
        title,
        contentHtml,
        plainText,
      });
      const previewCard = ensureEditorPreviewCard(previewPost);
      syncEditorPreviewCardMeta(previewCard, previewPost);
      ensureEditorLayoutEditor(previewCard, previewPost, plainText);
      requestEditorPreviewSession(previewPost);
    }

    // 하단 메타 갱신
    updatePreviewMeta();
  }

  function buildEditorPreviewPost({ title, contentHtml, plainText }) {
    const selectedFontKey = fontSelectEl ? fontSelectEl.value || 'serif' : 'serif';
    const selectedCategory = categorySelectEl ? categorySelectEl.value || 'short' : 'short';
    const emptyBodyPlaceholder =
      '여기에 오늘의 문장을 적어 보시면, 이 카드에서 바로 미리 볼 수 있어요.';
    const normalizedContent = plainText
      ? contentHtml
      : `<p>${emptyBodyPlaceholder}</p>`;
    const contentWithFontMeta = `<!--FONT:${selectedFontKey}-->${normalizedContent}`;

    return {
      id: 'editor-preview',
      author_name: '나',
      title: title || '여기에 글 제목이 미리 보여요',
      content: contentWithFontMeta,
      hashtags: hashtagList.join(', '),
      category: selectedCategory,
      created_at: previewCreatedAt,
      like_count: 0,
      user_liked: 0,
      layout_json: buildLayoutPayloadForSave(manualLayoutState),
    };
  }

  function normalizePreviewImageUrls(payload) {
    if (Array.isArray(payload?.images) && payload.images.length > 0) {
      return payload.images.map((value) => String(value || '').trim()).filter(Boolean);
    }
    if (Array.isArray(payload?.render_images?.images) && payload.render_images.images.length > 0) {
      return payload.render_images.images.map((value) => String(value || '').trim()).filter(Boolean);
    }
    const primaryImage =
      typeof payload?.primary_image === 'string' && payload.primary_image.trim()
        ? payload.primary_image.trim()
        : typeof payload?.image_url === 'string' && payload.image_url.trim()
          ? payload.image_url.trim()
          : '';
    return primaryImage ? [primaryImage] : [];
  }

  function setPreviewSessionError(message = '') {
    if (!previewSessionErrorEl) return;
    if (message) {
      previewSessionErrorEl.textContent = message;
      previewSessionErrorEl.classList.remove('gls-hidden');
      return;
    }
    previewSessionErrorEl.textContent = '';
    previewSessionErrorEl.classList.add('gls-hidden');
  }

  function syncPreviewCarouselUi() {
    const totalPages = Math.max(1, previewSessionPageCount || previewSessionImages.length || 1);
    const currentPage = Math.max(1, Math.min(previewPageIndex + 1, totalPages));
    const canNavigate = totalPages > 1;

    if (previewCarouselCurrentPageEl) {
      previewCarouselCurrentPageEl.textContent = String(currentPage);
    }
    if (previewCarouselTotalPagesEl) {
      previewCarouselTotalPagesEl.textContent = String(totalPages);
    }
    if (previewCarouselControlsEl) {
      previewCarouselControlsEl.classList.toggle('gls-hidden', totalPages <= 1);
    }
    if (previewCarouselPrevBtn) {
      previewCarouselPrevBtn.disabled = !canNavigate || currentPage <= 1;
    }
    if (previewCarouselNextBtn) {
      previewCarouselNextBtn.disabled = !canNavigate || currentPage >= totalPages;
    }
    if (previewTruncatedNoticeEl) {
      previewTruncatedNoticeEl.classList.toggle('gls-hidden', !previewSessionTruncated);
    }
    if (layoutPageStatusEl) {
      const overrideLabel = hasCurrentPageOverride(manualLayoutState, previewPageIndex)
        ? ' · 이 페이지 조정됨'
        : '';
      layoutPageStatusEl.textContent = `${currentPage} / ${totalPages} 페이지${overrideLabel}`;
    }
    if (layoutResetBtn) {
      layoutResetBtn.disabled = !manualLayoutState;
    }
    if (layoutResetAllBtn) {
      layoutResetAllBtn.disabled = !manualLayoutState;
    }
  }

  function ensureEditorPreviewCard(previewPost) {
    const renderedImageSrc =
      previewSessionImages[Math.max(0, previewPageIndex)] ||
      'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=';
    let previewCard = previewFeedCardMountEl.querySelector('.gls-post-card');
    if (previewCard) {
      const imageEl = previewCard.querySelector('.feed-rendered-card-image');
      if (imageEl && renderedImageSrc) {
        imageEl.setAttribute('src', renderedImageSrc);
      }
      return previewCard;
    }

    previewFeedCardMountEl.innerHTML = buildStandardPostCardHTML(previewPost, {
      showMoreButton: false,
      showEngagementActions: false,
      contentExpanded: true,
      cardClickable: false,
      cardExtraClass: 'editor-preview-feed-card',
      renderedImageSrc,
    });

    previewCard = previewFeedCardMountEl.querySelector('.gls-post-card');
    if (previewCard && typeof enhanceStandardPostCard === 'function') {
      enhanceStandardPostCard(previewCard, previewPost, {});
    }
    return previewCard;
  }

  function updateLayoutToggleUi() {
    if (!layoutEditToggleBtn) return;
    layoutEditToggleBtn.setAttribute('aria-pressed', layoutEditEnabled ? 'true' : 'false');
    layoutEditToggleBtn.textContent = `레이아웃 편집: ${layoutEditEnabled ? 'ON' : 'OFF'}`;
    previewFeedCardMountEl?.classList.toggle('is-layout-editing', layoutEditEnabled);
    syncPreviewCarouselUi();
  }

  function updateLayoutSafeAreaHint(shouldShow) {
    if (!layoutSafeAreaHintEl) return;
    layoutSafeAreaHintEl.hidden = !shouldShow;
  }

  function getLayoutWarningState() {
    if (!layoutEditEnabled || !layoutEditor || !layoutEditor.isEnabled()) {
      return false;
    }
    return !!layoutEditor.isOutsideSafeArea();
  }

  function syncEditorLayoutEditor(previewCard) {
    if (!layoutEditor || !previewCard) return;
    layoutEditor.mount(previewCard);
    layoutEditor.setLayout(getResolvedLayoutForPage(manualLayoutState, previewPageIndex));
    layoutEditor.setEnabled(layoutEditEnabled);
    layoutEditor.setPreviewText(previewOverlayText);
    updateLayoutSafeAreaHint(getLayoutWarningState());
    syncPreviewCarouselUi();
  }

  function ensureEditorLayoutEditor(previewCard, previewPost, plainText = '') {
    if (!previewCard || typeof window.GlsFeedLayoutEditor !== 'function') return;

    if (!layoutEditor) {
      layoutEditor = new window.GlsFeedLayoutEditor({
        onChange: ({ reason, layout, outsideSafeArea, enabled }) => {
          if (reason === 'escape') {
            layoutEditEnabled = false;
            updateLayoutToggleUi();
            updateLayoutSafeAreaHint(false);
            return;
          }

          if (!enabled) return;
          if (layout && reason === 'drag') {
            manualLayoutState = applyResolvedLayoutToPage(
              manualLayoutState,
              previewPageIndex,
              layout
            );
            updateLayoutSafeAreaHint(Boolean(outsideSafeArea));
            updatePreview();
            onEditorUserMutation('layout_drag');
          }
        },
      });
    }

    const mounted = layoutEditor.mount(previewCard);
    if (!mounted) return;
    previewOverlayText = {
      title: previewPost?.title || '제목',
      body: plainText || '본문',
    };
    syncEditorLayoutEditor(previewCard);
  }

  function setLayoutEditMode(nextEnabled) {
    layoutEditEnabled = Boolean(nextEnabled);
    if (layoutEditEnabled) {
      if (!manualLayoutState) {
        manualLayoutState = buildDefaultLayoutState();
      }
    }
    if (layoutEditor) {
      const previewCard = previewFeedCardMountEl?.querySelector('.gls-post-card');
      if (previewCard) {
        syncEditorLayoutEditor(previewCard);
      } else {
        layoutEditor.setEnabled(layoutEditEnabled);
      }
    }
    updateLayoutToggleUi();
    updateLayoutSafeAreaHint(getLayoutWarningState());
    const previewCard = previewFeedCardMountEl?.querySelector('.gls-post-card');
    if (previewCard) {
      applyEditorPreviewPage(previewCard, previewSessionImages[previewPageIndex] || '');
    }
  }

  function syncEditorPreviewCardMeta(previewCard, previewPost) {
    if (!previewCard) return;

    const titleEl = previewCard.querySelector('.card-title');
    if (titleEl) {
      titleEl.textContent = previewPost.title || '';
      const shouldHideTitle = hasLayoutTitleBox(manualLayoutState);
      titleEl.classList.toggle('gls-hidden', shouldHideTitle);
    }

    const categoryHtml = renderCategoryBadge(previewPost);
    const hashtagHtml = buildHashtagHtml(previewPost);
    let metaEl = previewCard.querySelector('.post-bottom-meta');

    if (categoryHtml || hashtagHtml) {
      const metaInnerHtml = `${
        categoryHtml ? `<div class="post-category-row">${categoryHtml}</div>` : ''
      }${hashtagHtml || ''}`;
      if (!metaEl) {
        metaEl = document.createElement('div');
        metaEl.className = 'post-bottom-meta';
        const bodyEl = previewCard.querySelector('.card-body');
        if (bodyEl) {
          bodyEl.appendChild(metaEl);
        }
      }
      if (metaEl) {
        metaEl.innerHTML = metaInnerHtml;
      }
    } else if (metaEl) {
      metaEl.remove();
    }

    const extracted = extractContentWithFont(previewPost);
    const fallbackEl = previewCard.querySelector('[data-feed-render-fallback]');
    if (fallbackEl) {
      fallbackEl.innerHTML = sanitizePostHtml(extracted.cleanHtml || '');
    }
  }

  function applyEditorPreviewPage(previewCard, previewImageUrl) {
    if (!previewCard || !previewImageUrl) return;

    const imageEl = previewCard.querySelector('.feed-rendered-card-image');
    const fallbackEl = previewCard.querySelector('[data-feed-render-fallback]');
    const imageShellEl = previewCard.querySelector('.feed-rendered-image-shell');
    if (!imageEl) return;

    const currentSrc = imageEl.getAttribute('src') || '';
    if (currentSrc === previewImageUrl) {
      syncEditorLayoutEditor(previewCard);
      syncPreviewCarouselUi();
      return;
    }

    const requestSeq = ++previewImageLoadSeq;
    const loader = new Image();
    loader.decoding = 'async';
    if (imageShellEl) {
      imageShellEl.classList.add('is-preview-loading');
    }

    loader.onload = () => {
      if (requestSeq !== previewImageLoadSeq) return;
      imageEl.src = previewImageUrl;
      imageEl.classList.remove('is-hidden');
      imageEl.removeAttribute('hidden');
      if (fallbackEl) {
        fallbackEl.hidden = true;
        fallbackEl.classList.remove('is-active');
      }
      if (imageShellEl) {
        imageShellEl.classList.remove('is-preview-loading');
      }
      if (layoutEditor) {
        syncEditorLayoutEditor(previewCard);
      }
      syncPreviewCarouselUi();
    };

    loader.onerror = () => {
      if (requestSeq !== previewImageLoadSeq) return;
      if (fallbackEl) {
        imageEl.classList.add('is-hidden');
        imageEl.setAttribute('hidden', '');
        fallbackEl.hidden = false;
        fallbackEl.classList.add('is-active');
      }
      if (imageShellEl) {
        imageShellEl.classList.remove('is-preview-loading');
      }
      setPreviewSessionError('미리보기 이미지를 불러오지 못했어요. 저장은 계속할 수 있습니다.');
      updateLayoutSafeAreaHint(false);
      syncPreviewCarouselUi();
    };

    loader.src = previewImageUrl;
  }

  function requestEditorPreviewSession(previewPost) {
    if (!previewFeedCardMountEl) return;

    if (previewSessionTimer) {
      clearTimeout(previewSessionTimer);
    }

    const layoutForPreview = buildLayoutPayloadForSave(manualLayoutState);
    const previewContentPages = buildEditorContentPagesForSave(quill.getText().trim());
    const requestSeq = ++previewSessionRequestSeq;

    previewSessionTimer = window.setTimeout(async () => {
      if (previewSessionAbortController) {
        previewSessionAbortController.abort();
      }
      previewSessionAbortController = new AbortController();

      try {
        setPreviewSessionError('');

        const response = await fetch('/api/feed-images/preview/sessions', {
          method: 'POST',
          signal: previewSessionAbortController.signal,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: previewPost.title,
            content: previewPost.content,
            content_format: 'html',
            ...(previewContentPages.length > 0 ? { content_pages: previewContentPages } : {}),
            category: previewPost.category,
            template: normalizeTemplateKey(selectedBackgroundTemplate),
            scale: 1,
            layout_json: layoutForPreview,
            created_at: previewPost.created_at,
          }),
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.message || '미리보기 세션 생성에 실패했습니다.');
        }
        if (requestSeq !== previewSessionRequestSeq) return;

        previewSessionImages = normalizePreviewImageUrls(payload);
        previewSessionPageCount = Math.max(
          1,
          Number.parseInt(String(payload?.render_images?.page_count || previewSessionImages.length || 1), 10) || 1
        );
        previewSessionTruncated = Boolean(payload?.render_images?.is_truncated);
        if (!previewSessionImages.length) {
          throw new Error('미리보기 이미지가 비어 있습니다.');
        }
        previewPageIndex = Math.max(0, Math.min(previewPageIndex, previewSessionImages.length - 1));

        const previewCard = ensureEditorPreviewCard(previewPost);
        syncEditorPreviewCardMeta(previewCard, previewPost);
        ensureEditorLayoutEditor(previewCard, previewPost, quill.getText().trim());
        applyEditorPreviewPage(previewCard, previewSessionImages[previewPageIndex] || previewSessionImages[0]);
      } catch (error) {
        if (requestSeq !== previewSessionRequestSeq) return;
        if (error?.name === 'AbortError') return;
        console.error('[editor] preview session failed:', error);
        previewSessionImages = [];
        previewSessionPageCount = 1;
        previewSessionTruncated = false;
        setPreviewSessionError(error?.message || '미리보기를 준비하지 못했습니다. 저장은 계속할 수 있어요.');
        syncPreviewCarouselUi();
      }
    }, PREVIEW_SESSION_DEBOUNCE_MS);
  }

  function buildEditorStateSnapshot() {
    const title = titleInput ? titleInput.value.trim() : '';
    const contentHtml = quill && quill.root ? quill.root.innerHTML.trim() : '';
    const category = categorySelectEl ? categorySelectEl.value || '' : '';
    const fontKey = fontSelectEl ? fontSelectEl.value || 'serif' : 'serif';
    const hashtags = Array.isArray(hashtagList) ? [...hashtagList] : [];
    const layoutJson = buildLayoutPayloadForSave(manualLayoutState);
    return {
      title,
      content_html: contentHtml,
      category,
      font_key: fontKey,
      hashtags,
      layout_json: layoutJson,
    };
  }

  function buildEditorStateSignature(state) {
    if (!state || typeof state !== 'object') return '';
    return JSON.stringify({
      title: state.title || '',
      content_html: state.content_html || '',
      category: state.category || '',
      font_key: state.font_key || 'serif',
      hashtags: Array.isArray(state.hashtags) ? state.hashtags : [],
      layout_json:
        state.layout_json && typeof state.layout_json === 'object'
          ? state.layout_json
          : null,
    });
  }

  function isMeaningfulDraftState(state) {
    if (!state || typeof state !== 'object') return false;
    if (typeof state.title === 'string' && state.title.trim().length > 0) return true;
    if (typeof state.content_html === 'string') {
      const plain = state.content_html.replace(/<[^>]+>/g, ' ').trim();
      if (plain.length > 0) return true;
    }
    if (Array.isArray(state.hashtags) && state.hashtags.length > 0) return true;
    if (typeof state.category === 'string' && state.category.trim().length > 0) return true;
    if (state.layout_json && typeof state.layout_json === 'object') return true;
    return false;
  }

  function dismissEditorNotice() {
    const noticeRegion = document.getElementById('editorNoticeRegion');
    if (!noticeRegion) return;
    noticeRegion.innerHTML = '';
  }

  function renderDraftRestoreNotice(draftPayload) {
    const noticeRegion = document.getElementById('editorNoticeRegion');
    if (!noticeRegion) return;

    const savedAtLabel = draftPayload.saved_at
      ? (typeof formatKoreanDateTime === 'function'
          ? formatKoreanDateTime(draftPayload.saved_at)
          : String(draftPayload.saved_at))
      : '방금 전';

    noticeRegion.innerHTML = `
      <div class="editor-notice" role="status">
        <div class="editor-notice__title">저장된 임시 초안이 있습니다.</div>
        <div class="editor-notice__desc">
          마지막 임시 저장: <strong>${escapeHtml(savedAtLabel)}</strong>
        </div>
        <div class="editor-notice__actions">
          <button type="button" class="gls-btn gls-btn-primary gls-btn-sm" id="restoreEditorDraftBtn">
            초안 복구
          </button>
          <button type="button" class="gls-btn gls-btn-secondary gls-btn-sm" id="discardEditorDraftBtn">
            초안 삭제
          </button>
        </div>
      </div>
    `;
  }

  function clearEditorDraft({ syncRemote = true } = {}) {
    try {
      if (draftStorageKey) localStorage.removeItem(draftStorageKey);
      if (legacyDraftStorageKey) localStorage.removeItem(legacyDraftStorageKey);
    } catch (error) {
      // storage 접근 제한 환경은 무시
    }
    if (syncRemote) {
      void deleteRemoteDraft();
    }
  }

  async function deleteRemoteDraft() {
    try {
      await fetch(`/api/drafts/${encodeURIComponent(draftId)}`, {
        method: 'DELETE',
        cache: 'no-store',
        keepalive: true,
      });
    } catch {
      // 로컬 초안 삭제는 이미 끝났으므로 네트워크 오류는 다음 동기화까지 무시한다.
    }
  }

  function normalizeRemoteDraftPayload(remoteDraft) {
    const stored = remoteDraft?.state;
    if (!stored || typeof stored !== 'object') return null;
    if (stored.state && typeof stored.state === 'object') return stored;

    const escapeText = (value) => String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    return {
      version: 2,
      draft_id: remoteDraft.draft_key,
      auth_namespace: authNamespace,
      mode: stored.mode === 'edit' ? 'edit' : 'create',
      post_id: stored.postId || null,
      saved_at: new Date(Number(remoteDraft.client_updated_at_ms) || Date.now()).toISOString(),
      expires_at: remoteDraft.expires_at,
      writing_event_context: stored.questContext || null,
      state: {
        title: stored.title || '',
        content_html: escapeText(stored.body || ''),
        category: stored.category || '',
        font_key: stored.fontKey || 'serif',
        hashtags: Array.isArray(stored.hashtags) ? stored.hashtags : [],
        layout_json: stored.layoutJson || null,
      },
    };
  }

  async function readRemoteEditorDraftPayload() {
    try {
      const response = await fetch(`/api/drafts/${encodeURIComponent(draftId)}`, {
        cache: 'no-store',
      });
      if (response.status === 404) return null;
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) return null;
      return normalizeRemoteDraftPayload(payload.draft);
    } catch {
      return null;
    }
  }

  async function saveRemoteDraft(payload) {
    try {
      await fetch(`/api/drafts/${encodeURIComponent(draftId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        keepalive: true,
        body: JSON.stringify({
          client_type: 'web',
          client_updated_at_ms: Date.parse(payload.saved_at) || Date.now(),
          state: payload,
        }),
      });
    } catch {
      // 네트워크가 끊겨도 로컬 초안을 유지한다.
    }
  }

  function readEditorDraftPayload() {
    try {
      let raw = draftStorageKey ? localStorage.getItem(draftStorageKey) : null;
      let migratedLegacy = false;
      if (!raw && legacyDraftStorageKey) {
        raw = localStorage.getItem(legacyDraftStorageKey);
        migratedLegacy = Boolean(raw);
      }
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (!parsed.state || typeof parsed.state !== 'object') return null;
      if (parsed.expires_at && Date.parse(parsed.expires_at) <= Date.now()) {
        clearEditorDraft({ syncRemote: false });
        return null;
      }
      if (migratedLegacy && draftStorageKey) {
        const migrated = {
          ...parsed,
          version: 2,
          draft_id: draftId,
          auth_namespace: authNamespace,
          expires_at: new Date(Date.now() + DRAFT_TTL_MS).toISOString(),
        };
        localStorage.setItem(draftStorageKey, JSON.stringify(migrated));
        localStorage.removeItem(legacyDraftStorageKey);
        return migrated;
      }
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function applyEditorDraftState(state) {
    if (!state || typeof state !== 'object') return;

    isProgrammaticUpdate = true;
    try {
      if (titleInput) {
        titleInput.value = state.title || '';
      }

      const nextFontKey = state.font_key || 'serif';
      if (fontSelectEl && FONT_MAP[nextFontKey]) {
        fontSelectEl.value = nextFontKey;
      }
      applyEditorFont(nextFontKey);

      if (categorySelectEl) {
        const nextCategory = state.category || '';
        categorySelectEl.value = nextCategory;
      }

      if (quill && quill.root) {
        quill.root.innerHTML = sanitizePostHtml(state.content_html || '');
      }

      hashtagList = [];
      if (Array.isArray(state.hashtags)) {
        state.hashtags.forEach((tag) => addTag(tag, { requireHash: false, markDirty: false }));
      } else {
        renderHashtagChips();
      }

      const restoredLayout = parseLayoutJson(state.layout_json);
      manualLayoutState = restoredLayout ? cloneLayout(restoredLayout) : null;
      applyBackgroundTemplate(extractTemplateFromLayout(state.layout_json), {
        markDirty: false,
        refreshPreview: false,
      });
      if (layoutEditor) {
        const previewCard = previewFeedCardMountEl?.querySelector('.gls-post-card');
        if (previewCard) {
          syncEditorLayoutEditor(previewCard);
        }
      }

      const plainText = quill.getText().trim();
      updateCharCounter(plainText.length);
      updatePreview();
    } finally {
      isProgrammaticUpdate = false;
    }
  }

  function saveEditorDraftNow() {
    if (isProgrammaticUpdate || isNavigatingAfterSave || isSaving) {
      return;
    }

    const snapshot = buildEditorStateSnapshot();
    const signature = buildEditorStateSignature(snapshot);
    hasUnsavedChanges = signature !== baselineStateSignature;

    if (!hasUnsavedChanges || !isMeaningfulDraftState(snapshot)) {
      clearEditorDraft();
      return;
    }

    try {
      const payload = {
        version: 2,
        draft_id: draftId,
        auth_namespace: authNamespace,
        mode: isEditMode ? 'edit' : 'create',
        post_id: postId ? Number(postId) || null : null,
        saved_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + DRAFT_TTL_MS).toISOString(),
        writing_event_context: writingEventContext,
        state: snapshot,
      };
      localStorage.setItem(draftStorageKey, JSON.stringify(payload));
      void saveRemoteDraft(payload);
      pruneEditorDraftStorage();
    } catch (error) {
      // storage 접근 제한 환경은 무시
    }
  }

  function pruneEditorDraftStorage() {
    if (!authNamespace) return;
    const prefix = `${DRAFT_KEY_PREFIX}:${authNamespace}:`;
    const stored = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      try {
        const payload = JSON.parse(localStorage.getItem(key) || 'null');
        const savedAt = Date.parse(payload?.saved_at || '') || 0;
        const expiresAt = Date.parse(payload?.expires_at || '') || savedAt + DRAFT_TTL_MS;
        if (!payload?.state || !savedAt || expiresAt <= Date.now()) {
          localStorage.removeItem(key);
          index -= 1;
          continue;
        }
        stored.push({ key, savedAt });
      } catch (error) {
        localStorage.removeItem(key);
        index -= 1;
      }
    }
    stored
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(30)
      .forEach((item) => localStorage.removeItem(item.key));
  }

  function scheduleEditorDraftSave() {
    if (draftSaveTimer) {
      clearTimeout(draftSaveTimer);
    }
    draftSaveTimer = window.setTimeout(saveEditorDraftNow, DRAFT_SAVE_DEBOUNCE_MS);
  }

  function onEditorUserMutation(reason) {
    if (isProgrammaticUpdate || isSaving || isNavigatingAfterSave) {
      return;
    }
    const currentSignature = buildEditorStateSignature(buildEditorStateSnapshot());
    hasUnsavedChanges = currentSignature !== baselineStateSignature;
    if (!hasUnsavedChanges) {
      if (draftSaveTimer) {
        clearTimeout(draftSaveTimer);
        draftSaveTimer = null;
      }
      clearEditorDraft();
      return;
    }
    scheduleEditorDraftSave();
  }


  // 3. 수정 모드인지 확인 (URL ?postId=...)

  trackEvent('editor_open', {
    is_edit_mode: isEditMode,
    post_id: postId ? Number(postId) || null : null,
  });

  if (isEditMode) {
    // 수정 모드 → 기존 글 내용 불러오기
    try {
      const res = await fetch(`/api/posts/${postId}/edit`);
      const data = await res.json();

      if (!res.ok || !data.ok) {
        alert(data.message || '글 정보를 불러오지 못했습니다.');
        isEditMode = false; // 실패 시 새 글 모드로 전환
      } else {
        const post = data.post;
        loadedContentPages = normalizeLoadedContentPages(post.content_pages);
        // 제목/본문/폰트 세팅
        titleInput.value = post.title || '';

        // 글 내용에 숨겨진 폰트 메타 태그가 있으면 파싱해서 select/에디터에 반영
        const { cleanHtml, fontKey } = extractFontFromContent(post.content || '');
        const resolvedFontKey = fontKey || 'serif';

        if (fontSelectEl) {
          fontSelectEl.value = resolvedFontKey;
        }

        applyEditorFont(resolvedFontKey);
        quill.root.innerHTML = sanitizePostHtml(cleanHtml || '');

        if (categorySelectEl) {
          categorySelectEl.value = post.category || 'short';
        }

        // 서버에서 hashtags를 내려줄 경우, 인풋/칩에 반영
        if (hashtagsInput) {
          if (Array.isArray(post.hashtags)) {
            // 배열이면 그대로 normalize해서 리스트에 넣기
            hashtagList = [];
            post.hashtags.forEach((tag) => addTag(tag, { requireHash: false, markDirty: false }));
          } else if (post.hashtags) {
            // 문자열이면 인풋에 넣고, 파싱해서 칩 생성
            hashtagsInput.value = post.hashtags;
            parseHashtagInputToList(false);
          }
        }

        const loadedLayout = parseLayoutJson(post.layout_json);
        manualLayoutState = loadedLayout ? cloneLayout(loadedLayout) : null;
        applyBackgroundTemplate(extractTemplateFromLayout(post.layout_json), {
          markDirty: false,
          refreshPreview: false,
        });
        if (layoutEditor) {
          const previewCard = previewFeedCardMountEl?.querySelector('.gls-post-card');
          if (previewCard) {
            syncEditorLayoutEditor(previewCard);
          }
        }

        // 글자 수/미리보기 초기 상태 갱신
        const plainText = quill.getText().trim();
        updateCharCounter(plainText.length);
        updatePreview();
      }
    } catch (e) {
      console.error(e);
      alert('글 정보를 불러오는 중 오류가 발생했습니다.');
      isEditMode = false;
    }
  } else {
    loadedContentPages = [];
    // 새 글 모드 → 초기 미리보기 & 글자 수 표시
    if (writingEventContext) {
      if (categorySelectEl && ['poem', 'essay', 'short'].includes(writingEventContext.promptCategory)) {
        categorySelectEl.value = writingEventContext.promptCategory;
      }
      writingEventContext.promptTags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .forEach((tag) => addTag(tag, { requireHash: false, markDirty: false }));
      if (editorWritingCampaignEl) {
        editorWritingCampaignEl.innerHTML = `
          <p>${escapeHtml(`${writingEventContext.promptDay || '-'}일차 · ${writingEventContext.promptSource || '글쓰기 프로젝트'}`)}</p>
          <strong>${escapeHtml(writingEventContext.promptTitle)}</strong>
          <span>${escapeHtml(writingEventContext.promptBody)}</span>
        `;
        editorWritingCampaignEl.classList.remove('gls-hidden');
      }
      quill.root.dataset.placeholder = writingEventContext.promptBody || '이 글감에서 떠오른 문장을 적어 보세요.';
    }
    updateCharCounter(0); // 200/200
    updatePreview();
  }

  baselineStateSignature = buildEditorStateSignature(buildEditorStateSnapshot());
  hasUnsavedChanges = false;

  const localDraftPayload = readEditorDraftPayload();
  const remoteDraftPayload = await readRemoteEditorDraftPayload();
  const localSavedAt = Date.parse(localDraftPayload?.saved_at || '') || 0;
  const remoteSavedAt = Date.parse(remoteDraftPayload?.saved_at || '') || 0;
  const draftPayload = remoteSavedAt > localSavedAt ? remoteDraftPayload : localDraftPayload;
  if (draftPayload && remoteSavedAt > localSavedAt && draftStorageKey) {
    try {
      localStorage.setItem(draftStorageKey, JSON.stringify(draftPayload));
    } catch {
      // 로컬 저장소 접근이 막혀도 서버 초안 복구는 계속 제공한다.
    }
  }
  if (draftPayload && isMeaningfulDraftState(draftPayload.state)) {
    const draftSignature = buildEditorStateSignature(draftPayload.state);
    if (draftSignature && draftSignature !== baselineStateSignature) {
      renderDraftRestoreNotice(draftPayload);

      const restoreBtn = document.getElementById('restoreEditorDraftBtn');
      const discardBtn = document.getElementById('discardEditorDraftBtn');

      if (restoreBtn) {
        restoreBtn.addEventListener('click', () => {
          applyEditorDraftState(draftPayload.state);
          hasUnsavedChanges = true;
          scheduleEditorDraftSave();
          dismissEditorNotice();
          trackEvent('editor_draft_restored', {
            is_edit_mode: isEditMode,
            post_id: postId ? Number(postId) || null : null,
          });
        });
      }

      if (discardBtn) {
        discardBtn.addEventListener('click', () => {
          clearEditorDraft();
          dismissEditorNotice();
          trackEvent('editor_draft_discarded', {
            is_edit_mode: isEditMode,
            post_id: postId ? Number(postId) || null : null,
          });
        });
      }
    }
  }

  // ✅ 제목 입력 시마다 미리보기 갱신
  titleInput.addEventListener('input', () => {
    updatePreview();
    onEditorUserMutation('title_input');
  });

  if (categorySelectEl) {
    categorySelectEl.addEventListener('change', () => {
      updatePreview();
      onEditorUserMutation('category_change');
    });
  }

  // ✅ 본문 입력 시 글자 수/미리보기 갱신
  quill.on('text-change', (delta, oldDelta, source) => {
    const plainText = quill.getText().trim();
    updateCharCounter(plainText.length);
    updatePreview();
    if (source === 'user') {
      onEditorUserMutation('content_change');
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (!hasUnsavedChanges || isSaving || isNavigatingAfterSave) {
      return;
    }
    saveEditorDraftNow();
    event.preventDefault();
    event.returnValue = '';
  });

  // 4. 저장 버튼 클릭 시
  saveBtn.addEventListener('click', async () => {
    if (isSaving) {
      return;
    }

    const title = titleInput.value.trim();         // 제목(텍스트)
    const contentHtml = quill.root.innerHTML.trim(); // 본문(HTML)
    const selectedFontKey = fontSelectEl ? fontSelectEl.value || 'serif' : 'serif';
    const selectedCategory = categorySelectEl ? categorySelectEl.value : '';
    const fontMetaPrefix = `<!--FONT:${selectedFontKey}-->`;
    const contentWithFontMeta = fontMetaPrefix + contentHtml;
    const plainText = quill.getText().trim();      // 본문(plain text)
    const length = plainText.length;

    // 칩 → 인풋 동기화 한 번 더 (혹시 남아있는 텍스트 반영)
    syncHashtagInputFromList();
    const hashtagsRaw = hashtagsInput ? hashtagsInput.value.trim() : '';

    // 에러 영역 초기화
    if (editorAlertEl) {
      editorAlertEl.classList.add('gls-hidden');
      editorAlertEl.textContent = '';
    }

    // 간단한 검증들
    if (!plainText) {
      showEditorError('내용을 입력해주세요.');
      return;
    }

    if (!selectedCategory) {
      showEditorError('카테고리를 선택해주세요.');
      return;
    }

    const contentPagesForSave = buildEditorContentPagesForSave(plainText);
    if (hasChangedLoadedPageText(plainText) && contentPagesForSave.length === 0) {
      showEditorError('페이지가 있는 긴 글은 모바일 글쓰기에서 페이지별로 수정해주세요.');
      return;
    }

    trackEvent(isEditMode ? 'post_update_submit' : 'post_create_submit', {
      category: selectedCategory,
      content_length: length,
      hashtag_count: hashtagList.length,
      has_title: Boolean(title),
    });

    isSaving = true;
    const originalSaveBtnText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = isEditMode ? '수정 중...' : '저장 중...';

    try {
      let url = '/api/posts';
      let method = 'POST';

      // 수정 모드라면 PUT /api/posts/:id로 전송
      if (isEditMode && postId) {
        url = `/api/posts/${postId}`;
        method = 'PUT';
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content: contentWithFontMeta,
          content_format: 'html',
          ...(contentPagesForSave.length > 0 ? { content_pages: contentPagesForSave } : {}),
          hashtags: hashtagsRaw, // ✅ 서버로 해시태그 문자열 함께 전송
          category: selectedCategory,
          layout_json: buildLayoutPayloadForSave(manualLayoutState),
          ...(writingEventContext && !isEditMode
            ? {
                writing_event_context: {
                  event_key: writingEventContext.eventKey,
                  prompt_key: writingEventContext.promptKey,
                },
              }
            : {}),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        trackEvent(isEditMode ? 'post_update_error' : 'post_create_error', {
          status: res.status || null,
          has_message: Boolean(data && data.message),
        });
        showEditorError(data.message || '글 저장에 실패했습니다.');
        return;
      }

      trackEvent(
        isEditMode ? 'post_update_success' : 'post_create_success',
        {
          post_id: data.post_id || (postId ? Number(postId) || null : null),
          category: selectedCategory,
        },
        { useBeacon: true }
      );

      if (draftSaveTimer) {
        clearTimeout(draftSaveTimer);
        draftSaveTimer = null;
      }
      clearEditorDraft();
      baselineStateSignature = buildEditorStateSignature(buildEditorStateSnapshot());
      hasUnsavedChanges = false;
      isNavigatingAfterSave = true;

      // 성공 알림 후 마이페이지로 이동
      alert(isEditMode ? '글이 수정되었습니다!' : '글이 저장되었습니다!');
      window.location.href = '/html/mypage.html';
    } catch (e) {
      console.error(e);
      trackEvent(isEditMode ? 'post_update_error' : 'post_create_error', {
        reason: 'network_error',
      });
      showEditorError('글 저장 중 오류가 발생했습니다.');
    } finally {
      isSaving = false;
      saveBtn.disabled = false;
      saveBtn.textContent = originalSaveBtnText;
    }
  });

  /**
   * 에디터 상단 에러 표시 함수
   * - editorAlertEl이 있으면 거기에 보여주고
   * - 없으면 단순 alert로 대체
   */
  function showEditorError(msg) {
    if (!editorAlertEl) {
      alert(msg);
      return;
    }
    editorAlertEl.textContent = msg;
    editorAlertEl.classList.remove('gls-hidden');

    // 에러 영역이 보이도록 살짝 위로 스크롤
    window.scrollTo({ top: editorAlertEl.offsetTop - 140, behavior: 'smooth' });
  }
});
