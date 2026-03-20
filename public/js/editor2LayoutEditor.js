(function attachEditor2LayoutEditor(global) {
  const LAYOUT_VERSION = 1;
  const LAYOUT_UNIT = 'normalized';
  const BOX_IDS = ['title_box', 'text_box', 'footer_box'];
  const BOX_LABELS = {
    title_box: '제목 박스',
    text_box: '본문 박스',
    footer_box: '푸터 박스',
  };
  const BOX_STYLE_KEY = {
    title_box: 'title',
    text_box: 'body',
    footer_box: 'footer',
  };
  const ALLOWED_ALIGN = new Set(['left', 'center', 'right']);
  const SAFE_AREA_DEFAULT = {
    left: 0.26,
    top: 0.2,
    right: 0.82,
    bottom: 0.9,
  };
  const DEFAULT_MODEL = {
    layout_version: LAYOUT_VERSION,
    unit: LAYOUT_UNIT,
    canvas: {
      w: 1,
      h: 1,
      safe: SAFE_AREA_DEFAULT,
      presetId: 'paper01',
    },
    boxes: [
      {
        id: 'title_box',
        type: 'title',
        x: 0.336,
        y: 0.256,
        w: 0.424,
        h: 0.122,
        lock: false,
        hidden: false,
        styleId: 'title',
      },
      {
        id: 'text_box',
        type: 'body',
        x: 0.336,
        y: 0.364,
        w: 0.424,
        h: 0.346,
        lock: false,
        hidden: false,
        styleId: 'body',
      },
      {
        id: 'footer_box',
        type: 'footer',
        x: 0.78,
        y: 0.9,
        w: 0.16,
        h: 0.06,
        lock: false,
        hidden: false,
        styleId: 'footer',
      },
    ],
    styles: {
      title: {
        align: 'center',
        font_scale: 1,
        line_height: 1.15,
      },
      body: {
        align: 'center',
        font_scale: 1,
        line_height: 1.15,
      },
      footer: {
        align: 'right',
        font_scale: 1,
        line_height: 1.1,
      },
    },
  };

  const MIN_BOX_SIZE = 0.05;
  const SNAP_THRESHOLD = 0.016;

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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

  function round(value, precision) {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
  }

  function normalizeAlign(value, fallback) {
    const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (ALLOWED_ALIGN.has(raw)) return raw;
    return fallback;
  }

  function normalizeStyle(raw, fallback) {
    const next = {
      align: normalizeAlign(raw?.align, fallback.align),
      font_scale: fallback.font_scale,
      line_height: fallback.line_height,
    };
    const fontScale = toFiniteNumber(raw?.font_scale);
    if (fontScale != null && fontScale > 0) {
      next.font_scale = round(clamp(fontScale, 0.7, 2), 3);
    }
    const lineHeight = toFiniteNumber(raw?.line_height);
    if (lineHeight != null && lineHeight > 0) {
      next.line_height = round(clamp(lineHeight, 1, 2.2), 3);
    }
    return next;
  }

  function normalizeSafeArea(raw) {
    const fallback = SAFE_AREA_DEFAULT;
    const left = toFiniteNumber(raw?.left);
    const top = toFiniteNumber(raw?.top);
    const right = toFiniteNumber(raw?.right);
    const bottom = toFiniteNumber(raw?.bottom);

    const normalized = {
      left: clamp(left != null ? left : fallback.left, 0, 1),
      top: clamp(top != null ? top : fallback.top, 0, 1),
      right: clamp(right != null ? right : fallback.right, 0, 1),
      bottom: clamp(bottom != null ? bottom : fallback.bottom, 0, 1),
    };

    if (normalized.left > normalized.right) {
      const temp = normalized.left;
      normalized.left = normalized.right;
      normalized.right = temp;
    }
    if (normalized.top > normalized.bottom) {
      const temp = normalized.top;
      normalized.top = normalized.bottom;
      normalized.bottom = temp;
    }

    return normalized;
  }

  function getDefaultBox(id) {
    const found = DEFAULT_MODEL.boxes.find((box) => box.id === id);
    return found ? deepClone(found) : null;
  }

  function normalizeBox(raw, fallback) {
    if (!fallback) return null;
    const wRaw = toFiniteNumber(raw?.w);
    const hRaw = toFiniteNumber(raw?.h);
    const xRaw = toFiniteNumber(raw?.x);
    const yRaw = toFiniteNumber(raw?.y);

    const w = clamp(wRaw != null ? wRaw : fallback.w, MIN_BOX_SIZE, 1);
    const h = clamp(hRaw != null ? hRaw : fallback.h, MIN_BOX_SIZE, 1);
    const x = clamp(xRaw != null ? xRaw : fallback.x, 0, Math.max(0, 1 - w));
    const y = clamp(yRaw != null ? yRaw : fallback.y, 0, Math.max(0, 1 - h));

    return {
      ...fallback,
      x: round(x, 4),
      y: round(y, 4),
      w: round(w, 4),
      h: round(h, 4),
      lock: Boolean(raw?.lock ?? fallback.lock),
      hidden: Boolean(raw?.hidden ?? fallback.hidden),
      styleId: fallback.styleId,
    };
  }

  function buildModelFromLayoutJson(rawLayout) {
    if (rawLayout == null) return null;

    let parsed = rawLayout;
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

    if (!parsed.text_box) {
      return null;
    }

    const model = deepClone(DEFAULT_MODEL);
    const titleBox = normalizeBox(parsed.title_box, getDefaultBox('title_box'));
    const textBox = normalizeBox(parsed.text_box, getDefaultBox('text_box'));
    const footerBox = normalizeBox(parsed.footer_box, getDefaultBox('footer_box'));

    if (!textBox) return null;

    model.layout_version = LAYOUT_VERSION;
    model.unit = LAYOUT_UNIT;
    model.boxes = [titleBox, textBox, footerBox].filter(Boolean);

    model.styles.title = normalizeStyle(parsed.title_box, model.styles.title);
    model.styles.body = normalizeStyle(parsed.text_box, model.styles.body);
    model.styles.footer = normalizeStyle(parsed.footer_box, model.styles.footer);

    return model;
  }

  function normalizeModel(rawModel) {
    if (!rawModel || typeof rawModel !== 'object') {
      return deepClone(DEFAULT_MODEL);
    }

    const fromLayoutJson = buildModelFromLayoutJson(rawModel);
    if (fromLayoutJson) {
      return fromLayoutJson;
    }

    const next = deepClone(DEFAULT_MODEL);
    next.layout_version = LAYOUT_VERSION;
    next.unit = LAYOUT_UNIT;
    next.canvas = {
      w: 1,
      h: 1,
      safe: normalizeSafeArea(rawModel.canvas?.safe),
      presetId:
        typeof rawModel.canvas?.presetId === 'string' &&
        rawModel.canvas.presetId.trim()
          ? rawModel.canvas.presetId.trim()
          : DEFAULT_MODEL.canvas.presetId,
    };

    const rawBoxes = Array.isArray(rawModel.boxes) ? rawModel.boxes : [];
    const boxById = new Map(
      rawBoxes
        .filter((box) => box && typeof box === 'object' && typeof box.id === 'string')
        .map((box) => [box.id, box])
    );

    next.boxes = BOX_IDS.map((boxId) => {
      const fallback = getDefaultBox(boxId);
      const raw = boxById.get(boxId);
      return normalizeBox(raw, fallback);
    }).filter(Boolean);

    next.styles = {
      title: normalizeStyle(rawModel.styles?.title, DEFAULT_MODEL.styles.title),
      body: normalizeStyle(rawModel.styles?.body, DEFAULT_MODEL.styles.body),
      footer: normalizeStyle(rawModel.styles?.footer, DEFAULT_MODEL.styles.footer),
    };

    return next;
  }

  function findBox(model, boxId) {
    return model.boxes.find((box) => box.id === boxId) || null;
  }

  function getStyleKeyForBox(boxId) {
    return BOX_STYLE_KEY[boxId] || '';
  }

  function modelToLayoutJson(rawModel) {
    const model = normalizeModel(rawModel);
    const textBox = findBox(model, 'text_box');
    if (!textBox) return null;

    function toBoxPayload(box) {
      if (!box) return null;
      const styleKey = BOX_STYLE_KEY[box.id];
      const style = model.styles?.[styleKey] || {};
      return {
        x: round(box.x, 4),
        y: round(box.y, 4),
        w: round(box.w, 4),
        h: round(box.h, 4),
        align: normalizeAlign(style.align, 'center'),
        font_scale: round(toFiniteNumber(style.font_scale) || 1, 3),
        line_height: round(toFiniteNumber(style.line_height) || 1.15, 3),
      };
    }

    const payload = {
      layout_version: LAYOUT_VERSION,
      unit: LAYOUT_UNIT,
      text_box: toBoxPayload(textBox),
    };

    const titleBox = findBox(model, 'title_box');
    const footerBox = findBox(model, 'footer_box');

    if (titleBox) {
      payload.title_box = toBoxPayload(titleBox);
    }
    if (footerBox) {
      payload.footer_box = toBoxPayload(footerBox);
    }

    return payload;
  }

  function isBoxOutsideSafeArea(model, box) {
    if (!model || !box) return false;
    const safe = model.canvas?.safe || SAFE_AREA_DEFAULT;
    const left = box.x;
    const top = box.y;
    const right = box.x + box.w;
    const bottom = box.y + box.h;
    return (
      left < safe.left ||
      top < safe.top ||
      right > safe.right ||
      bottom > safe.bottom
    );
  }

  class Editor2LayoutEditor {
    constructor(options = {}) {
      this.onChange = typeof options.onChange === 'function' ? options.onChange : null;
      this.model = normalizeModel(options.initialModel || null);
      this.previewText = {
        title: '제목',
        body: '본문',
        footer: '글숲 · glsoop',
      };
      this.enabled = false;
      this.mountRoot = null;
      this.imageShell = null;
      this.overlay = null;
      this.safeAreaRect = null;
      this.verticalGuide = null;
      this.horizontalGuide = null;
      this.boxElements = new Map();
      this.activeBoxId = 'text_box';
      this.actionState = null;
      this.rafId = 0;
      this.mounted = false;
      this.snapState = {
        xCenter: false,
        yCenter: false,
      };

      this.boundPointerMove = (event) => this.onPointerMove(event);
      this.boundPointerUp = (event) => this.onPointerUp(event);
      this.boundOverlayKeydown = (event) => this.onOverlayKeydown(event);
      this.boundWindowResize = () => this.requestRender();
    }

    mount(previewCardEl) {
      if (!previewCardEl) return false;
      const imageShell = previewCardEl.querySelector('.feed-rendered-image-shell');
      const imageEl = imageShell?.querySelector('.feed-rendered-card-image');
      if (!imageShell || !imageEl) return false;

      if (this.overlay && this.overlay.parentElement !== imageShell) {
        this.overlay.remove();
        this.overlay = null;
      }

      if (!this.overlay) {
        this.overlay = this.buildOverlayElement();
        imageShell.appendChild(this.overlay);
      }

      this.mountRoot = previewCardEl;
      this.imageShell = imageShell;

      if (!this.mounted) {
        window.addEventListener('pointermove', this.boundPointerMove);
        window.addEventListener('pointerup', this.boundPointerUp);
        window.addEventListener('resize', this.boundWindowResize, { passive: true });
        this.mounted = true;
      }

      if (this.overlay.dataset.keybound !== '1') {
        this.overlay.addEventListener('keydown', this.boundOverlayKeydown);
        this.overlay.dataset.keybound = '1';
      }

      this.requestRender();
      return true;
    }

    destroy() {
      window.removeEventListener('pointermove', this.boundPointerMove);
      window.removeEventListener('pointerup', this.boundPointerUp);
      window.removeEventListener('resize', this.boundWindowResize);
      if (this.overlay) {
        this.overlay.removeEventListener('keydown', this.boundOverlayKeydown);
        this.overlay.remove();
      }
      if (this.rafId) {
        window.cancelAnimationFrame(this.rafId);
      }
      this.overlay = null;
      this.safeAreaRect = null;
      this.verticalGuide = null;
      this.horizontalGuide = null;
      this.boxElements.clear();
      this.mountRoot = null;
      this.imageShell = null;
      this.actionState = null;
      this.rafId = 0;
      this.mounted = false;
    }

    buildOverlayElement() {
      const overlay = document.createElement('div');
      overlay.className = 'editor2-layout-overlay';
      overlay.tabIndex = 0;
      overlay.setAttribute('role', 'application');
      overlay.setAttribute('aria-label', '레이아웃 편집 오버레이');

      overlay.innerHTML = `
        <div class="editor2-layout-safe-area" aria-hidden="true"></div>
        <div class="editor2-layout-guide editor2-layout-guide--vertical" aria-hidden="true"></div>
        <div class="editor2-layout-guide editor2-layout-guide--horizontal" aria-hidden="true"></div>
      `;

      this.safeAreaRect = overlay.querySelector('.editor2-layout-safe-area');
      this.verticalGuide = overlay.querySelector('.editor2-layout-guide--vertical');
      this.horizontalGuide = overlay.querySelector('.editor2-layout-guide--horizontal');

      BOX_IDS.forEach((boxId) => {
        const boxEl = document.createElement('div');
        boxEl.className = `editor2-layout-box editor2-layout-box--${boxId}`;
        boxEl.dataset.boxId = boxId;
        boxEl.innerHTML = `
          <div class="editor2-layout-box__chip">
            <span class="editor2-layout-box__label">${BOX_LABELS[boxId]}</span>
          </div>
          <div class="editor2-layout-box__text" data-role="preview-text"></div>
          <button type="button" class="editor2-layout-box__handle editor2-layout-box__handle--nw" data-resize-handle="nw" aria-label="왼쪽 위 리사이즈"></button>
          <button type="button" class="editor2-layout-box__handle editor2-layout-box__handle--n" data-resize-handle="n" aria-label="위쪽 리사이즈"></button>
          <button type="button" class="editor2-layout-box__handle editor2-layout-box__handle--ne" data-resize-handle="ne" aria-label="오른쪽 위 리사이즈"></button>
          <button type="button" class="editor2-layout-box__handle editor2-layout-box__handle--e" data-resize-handle="e" aria-label="오른쪽 리사이즈"></button>
          <button type="button" class="editor2-layout-box__handle editor2-layout-box__handle--se" data-resize-handle="se" aria-label="오른쪽 아래 리사이즈"></button>
          <button type="button" class="editor2-layout-box__handle editor2-layout-box__handle--s" data-resize-handle="s" aria-label="아래 리사이즈"></button>
          <button type="button" class="editor2-layout-box__handle editor2-layout-box__handle--sw" data-resize-handle="sw" aria-label="왼쪽 아래 리사이즈"></button>
          <button type="button" class="editor2-layout-box__handle editor2-layout-box__handle--w" data-resize-handle="w" aria-label="왼쪽 리사이즈"></button>
        `;

        boxEl.addEventListener('pointerdown', (event) => this.onPointerDown(event));
        boxEl.addEventListener('click', () => this.selectBox(boxId, { emit: true }));
        this.boxElements.set(boxId, boxEl);
        overlay.appendChild(boxEl);
      });

      return overlay;
    }

    setEnabled(enabled) {
      this.enabled = Boolean(enabled);
      if (this.overlay) {
        this.overlay.classList.toggle('is-enabled', this.enabled);
      }
      if (!this.enabled) {
        this.actionState = null;
      }
      this.requestRender();
    }

    isEnabled() {
      return this.enabled;
    }

    setPreviewText(text = {}) {
      this.previewText = {
        title: text.title || '제목',
        body: text.body || '본문',
        footer: text.footer || '글숲 · glsoop',
      };
      this.requestRender();
    }

    setModel(rawModel, options = {}) {
      this.model = normalizeModel(rawModel);
      if (!findBox(this.model, this.activeBoxId)) {
        this.activeBoxId = 'text_box';
      }
      this.requestRender();
      if (options.emit) {
        this.emitChange(options.reason || 'model_set', false);
      }
    }

    getModel() {
      return normalizeModel(this.model);
    }

    getLayoutJson() {
      return modelToLayoutJson(this.model);
    }

    getBoxStyle(boxId) {
      const styleKey = getStyleKeyForBox(boxId);
      if (!styleKey) return null;
      const rawStyle = this.model.styles?.[styleKey];
      if (!rawStyle) return null;
      return deepClone(rawStyle);
    }

    setBoxStyle(boxId, patch = {}, options = {}) {
      const styleKey = getStyleKeyForBox(boxId);
      if (!styleKey) return false;
      const current = this.model.styles?.[styleKey] || DEFAULT_MODEL.styles[styleKey];
      const merged = { ...current, ...(patch || {}) };
      this.model.styles[styleKey] = normalizeStyle(merged, DEFAULT_MODEL.styles[styleKey]);
      this.requestRender();
      if (options.emit !== false) {
        this.emitChange(options.reason || 'style_change', Boolean(options.userInitiated));
      }
      return true;
    }

    selectBox(boxId, options = {}) {
      if (!BOX_IDS.includes(boxId)) return;
      this.activeBoxId = boxId;
      this.requestRender();
      if (options.emit) {
        this.emitChange('select', false);
      }
      if (this.overlay) {
        this.overlay.focus({ preventScroll: true });
      }
    }

    setBoxLock(boxId, locked, options = {}) {
      const box = findBox(this.model, boxId);
      if (!box) return;
      box.lock = Boolean(locked);
      if (box.lock && this.actionState && this.actionState.boxId === boxId) {
        this.actionState = null;
      }
      this.requestRender();
      if (options.emit !== false) {
        this.emitChange('lock_toggle', Boolean(options.userInitiated));
      }
    }

    setBoxHidden(boxId, hidden, options = {}) {
      const box = findBox(this.model, boxId);
      if (!box) return;
      box.hidden = Boolean(hidden);
      if (box.hidden && this.actionState && this.actionState.boxId === boxId) {
        this.actionState = null;
      }
      if (box.hidden && this.activeBoxId === boxId) {
        this.activeBoxId = 'text_box';
      }
      this.requestRender();
      if (options.emit !== false) {
        this.emitChange('hidden_toggle', Boolean(options.userInitiated));
      }
    }

    onPointerDown(event) {
      if (!this.enabled || event.button !== 0 || !this.overlay) return;

      const boxEl = event.currentTarget?.closest('.editor2-layout-box');
      const boxId = boxEl?.dataset?.boxId;
      if (!BOX_IDS.includes(boxId)) return;

      const box = findBox(this.model, boxId);
      if (!box || box.lock || box.hidden) return;

      const overlayRect = this.overlay.getBoundingClientRect();
      if (!overlayRect.width || !overlayRect.height) return;

      const handleEl = event.target?.closest?.('[data-resize-handle]');
      const handle = handleEl?.dataset?.resizeHandle || '';
      const type = handle ? 'resize' : 'drag';

      this.selectBox(boxId, { emit: false });
      this.actionState = {
        pointerId: event.pointerId,
        type,
        boxId,
        handle,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startBox: {
          x: box.x,
          y: box.y,
          w: box.w,
          h: box.h,
        },
      };

      boxEl.classList.add('is-dragging');
      if (typeof boxEl.setPointerCapture === 'function') {
        try {
          boxEl.setPointerCapture(event.pointerId);
        } catch (_error) {
          // no-op
        }
      }

      this.overlay.focus({ preventScroll: true });
      event.preventDefault();
    }

    onPointerMove(event) {
      if (!this.actionState || !this.overlay) return;
      if (event.pointerId !== this.actionState.pointerId) return;

      const box = findBox(this.model, this.actionState.boxId);
      if (!box) return;

      const rect = this.overlay.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const dx = (event.clientX - this.actionState.startClientX) / rect.width;
      const dy = (event.clientY - this.actionState.startClientY) / rect.height;
      const shiftPressed = event.shiftKey;

      if (this.actionState.type === 'drag') {
        this.applyDrag(box, dx, dy, shiftPressed);
      } else {
        this.applyResize(box, dx, dy, this.actionState.handle, shiftPressed);
      }

      this.requestRender();
      this.emitChange(this.actionState.type === 'drag' ? 'drag' : 'resize', true);
      event.preventDefault();
    }

    onPointerUp(event) {
      if (!this.actionState) return;
      if (event.pointerId !== this.actionState.pointerId) return;

      const boxEl = this.boxElements.get(this.actionState.boxId);
      if (boxEl) {
        boxEl.classList.remove('is-dragging');
      }
      const reason = this.actionState.type === 'drag' ? 'drag_end' : 'resize_end';
      this.actionState = null;
      this.snapState = { xCenter: false, yCenter: false };
      this.requestRender();
      this.emitChange(reason, true);
    }

    applyDrag(box, dx, dy, disableSnap) {
      const start = this.actionState?.startBox;
      if (!start) return;

      let nextX = start.x + dx;
      let nextY = start.y + dy;

      nextX = clamp(nextX, 0, Math.max(0, 1 - box.w));
      nextY = clamp(nextY, 0, Math.max(0, 1 - box.h));

      const snapped = this.applySnaps({
        x: nextX,
        y: nextY,
        w: box.w,
        h: box.h,
        disableSnap,
      });

      box.x = round(clamp(snapped.x, 0, Math.max(0, 1 - box.w)), 4);
      box.y = round(clamp(snapped.y, 0, Math.max(0, 1 - box.h)), 4);
    }

    applyResize(box, dx, dy, handle, disableSnap) {
      const start = this.actionState?.startBox;
      if (!start) return;

      let left = start.x;
      let top = start.y;
      let right = start.x + start.w;
      let bottom = start.y + start.h;

      if (handle.includes('w')) left = start.x + dx;
      if (handle.includes('e')) right = start.x + start.w + dx;
      if (handle.includes('n')) top = start.y + dy;
      if (handle.includes('s')) bottom = start.y + start.h + dy;

      left = clamp(left, 0, 1);
      top = clamp(top, 0, 1);
      right = clamp(right, 0, 1);
      bottom = clamp(bottom, 0, 1);

      if (right - left < MIN_BOX_SIZE) {
        if (handle.includes('w')) {
          left = right - MIN_BOX_SIZE;
        } else {
          right = left + MIN_BOX_SIZE;
        }
      }
      if (bottom - top < MIN_BOX_SIZE) {
        if (handle.includes('n')) {
          top = bottom - MIN_BOX_SIZE;
        } else {
          bottom = top + MIN_BOX_SIZE;
        }
      }

      left = clamp(left, 0, 1 - MIN_BOX_SIZE);
      top = clamp(top, 0, 1 - MIN_BOX_SIZE);
      right = clamp(right, left + MIN_BOX_SIZE, 1);
      bottom = clamp(bottom, top + MIN_BOX_SIZE, 1);

      const snapped = this.applySnaps({
        x: left,
        y: top,
        w: right - left,
        h: bottom - top,
        disableSnap,
      });

      box.x = round(clamp(snapped.x, 0, 1 - MIN_BOX_SIZE), 4);
      box.y = round(clamp(snapped.y, 0, 1 - MIN_BOX_SIZE), 4);
      box.w = round(clamp(snapped.w, MIN_BOX_SIZE, 1 - box.x), 4);
      box.h = round(clamp(snapped.h, MIN_BOX_SIZE, 1 - box.y), 4);
    }

    applySnaps({ x, y, w, h, disableSnap }) {
      let nextX = x;
      let nextY = y;
      this.snapState = { xCenter: false, yCenter: false };
      if (disableSnap) {
        return { x: nextX, y: nextY, w, h };
      }

      const centerX = nextX + w / 2;
      const centerY = nextY + h / 2;
      const safe = this.model.canvas?.safe || SAFE_AREA_DEFAULT;

      if (Math.abs(centerX - 0.5) <= SNAP_THRESHOLD) {
        nextX = clamp(0.5 - w / 2, 0, Math.max(0, 1 - w));
        this.snapState.xCenter = true;
      }
      if (Math.abs(centerY - 0.5) <= SNAP_THRESHOLD) {
        nextY = clamp(0.5 - h / 2, 0, Math.max(0, 1 - h));
        this.snapState.yCenter = true;
      }

      const left = nextX;
      const right = nextX + w;
      const top = nextY;
      const bottom = nextY + h;

      if (Math.abs(left - safe.left) <= SNAP_THRESHOLD) {
        nextX = clamp(safe.left, 0, Math.max(0, 1 - w));
      } else if (Math.abs(right - safe.right) <= SNAP_THRESHOLD) {
        nextX = clamp(safe.right - w, 0, Math.max(0, 1 - w));
      }

      if (Math.abs(top - safe.top) <= SNAP_THRESHOLD) {
        nextY = clamp(safe.top, 0, Math.max(0, 1 - h));
      } else if (Math.abs(bottom - safe.bottom) <= SNAP_THRESHOLD) {
        nextY = clamp(safe.bottom - h, 0, Math.max(0, 1 - h));
      }

      return { x: nextX, y: nextY, w, h };
    }

    onOverlayKeydown(event) {
      if (!this.enabled || !this.overlay) return;
      if (!BOX_IDS.includes(this.activeBoxId)) return;

      const key = event.key;
      if (
        key !== 'ArrowLeft' &&
        key !== 'ArrowRight' &&
        key !== 'ArrowUp' &&
        key !== 'ArrowDown'
      ) {
        return;
      }

      const box = findBox(this.model, this.activeBoxId);
      if (!box || box.lock || box.hidden) return;

      const rect = this.overlay.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const stepPx = event.shiftKey ? 10 : 1;
      const stepX = stepPx / rect.width;
      const stepY = stepPx / rect.height;

      if (key === 'ArrowLeft') box.x = clamp(box.x - stepX, 0, Math.max(0, 1 - box.w));
      if (key === 'ArrowRight') box.x = clamp(box.x + stepX, 0, Math.max(0, 1 - box.w));
      if (key === 'ArrowUp') box.y = clamp(box.y - stepY, 0, Math.max(0, 1 - box.h));
      if (key === 'ArrowDown') box.y = clamp(box.y + stepY, 0, Math.max(0, 1 - box.h));

      box.x = round(box.x, 4);
      box.y = round(box.y, 4);
      this.requestRender();
      this.emitChange('nudge', true);
      event.preventDefault();
    }

    getSafeAreaWarnings() {
      const map = {};
      this.model.boxes.forEach((box) => {
        map[box.id] = isBoxOutsideSafeArea(this.model, box);
      });
      return map;
    }

    isOutsideSafeArea() {
      return this.model.boxes.some((box) => isBoxOutsideSafeArea(this.model, box));
    }

    requestRender() {
      if (!this.overlay || this.rafId) return;
      this.rafId = window.requestAnimationFrame(() => {
        this.rafId = 0;
        this.render();
      });
    }

    render() {
      if (!this.overlay) return;

      this.overlay.classList.toggle('is-enabled', this.enabled);

      const safe = this.model.canvas?.safe || SAFE_AREA_DEFAULT;
      if (this.safeAreaRect) {
        this.safeAreaRect.style.left = `${round(safe.left * 100, 4)}%`;
        this.safeAreaRect.style.top = `${round(safe.top * 100, 4)}%`;
        this.safeAreaRect.style.width = `${round((safe.right - safe.left) * 100, 4)}%`;
        this.safeAreaRect.style.height = `${round((safe.bottom - safe.top) * 100, 4)}%`;
      }

      if (this.verticalGuide) {
        this.verticalGuide.classList.toggle('is-active', this.snapState.xCenter && this.enabled);
      }
      if (this.horizontalGuide) {
        this.horizontalGuide.classList.toggle('is-active', this.snapState.yCenter && this.enabled);
      }

      this.model.boxes.forEach((box) => {
        const boxEl = this.boxElements.get(box.id);
        if (!boxEl) return;

        boxEl.style.left = `${round(box.x * 100, 4)}%`;
        boxEl.style.top = `${round(box.y * 100, 4)}%`;
        boxEl.style.width = `${round(box.w * 100, 4)}%`;
        boxEl.style.height = `${round(box.h * 100, 4)}%`;
        boxEl.classList.toggle('is-hidden', box.hidden);
        boxEl.classList.toggle('is-locked', box.lock);
        boxEl.classList.toggle('is-active', this.activeBoxId === box.id);

        const outside = isBoxOutsideSafeArea(this.model, box);
        boxEl.classList.toggle('is-outside-safe-area', outside);

        const previewTextEl = boxEl.querySelector('[data-role="preview-text"]');
        const styleKey = getStyleKeyForBox(box.id);
        const style = styleKey ? this.model.styles?.[styleKey] || {} : {};
        if (previewTextEl) {
          if (box.id === 'title_box') previewTextEl.textContent = this.previewText.title;
          if (box.id === 'text_box') previewTextEl.textContent = this.previewText.body;
          if (box.id === 'footer_box') previewTextEl.textContent = this.previewText.footer;
          const align = normalizeAlign(style.align, 'center');
          const scale = toFiniteNumber(style.font_scale) || 1;
          const lineHeight = toFiniteNumber(style.line_height) || 1.15;
          const baseFontPx = box.id === 'title_box' ? 12 : box.id === 'footer_box' ? 10 : 11;
          previewTextEl.style.textAlign = align;
          previewTextEl.style.fontSize = `${round(baseFontPx * scale, 2)}px`;
          previewTextEl.style.lineHeight = String(round(lineHeight, 2));
        }
      });
    }

    emitChange(reason, userInitiated) {
      if (typeof this.onChange !== 'function') return;
      this.onChange({
        reason,
        userInitiated: Boolean(userInitiated),
        model: this.getModel(),
        layout_json: this.getLayoutJson(),
        warnings: this.getSafeAreaWarnings(),
        outsideSafeArea: this.isOutsideSafeArea(),
        activeBoxId: this.activeBoxId,
      });
    }
  }

  global.GlsEditor2LayoutModel = {
    createDefaultModel: () => normalizeModel(null),
    normalizeModel,
    modelFromLayoutJson: buildModelFromLayoutJson,
    layoutJsonFromModel: modelToLayoutJson,
  };

  global.GlsEditor2LayoutEditor = Editor2LayoutEditor;
})(window);
