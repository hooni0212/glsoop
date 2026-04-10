(function attachFeedLayoutEditor(global) {
  const DEFAULT_LAYOUT = {
    layout_version: 1,
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

  const SAFE_AREA = {
    left: 0.26,
    top: 0.2,
    right: 0.82,
    bottom: 0.9,
  };

  const SNAP_CENTER_THRESHOLD = 0.018;
  const MIN_BOX_SIZE = 0.06;
  const LAYOUT_KEYS = ['title_box', 'text_box'];

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function round(value, precision) {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
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

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeLayoutBox(rawBox, fallbackBox) {
    if (!rawBox || typeof rawBox !== 'object' || Array.isArray(rawBox)) {
      return deepClone(fallbackBox);
    }

    const wRaw = toFiniteNumber(rawBox.w);
    const hRaw = toFiniteNumber(rawBox.h);
    const xRaw = toFiniteNumber(rawBox.x);
    const yRaw = toFiniteNumber(rawBox.y);

    const w = clamp(wRaw != null ? wRaw : fallbackBox.w, MIN_BOX_SIZE, 1);
    const h = clamp(hRaw != null ? hRaw : fallbackBox.h, MIN_BOX_SIZE, 1);
    const x = clamp(xRaw != null ? xRaw : fallbackBox.x, 0, Math.max(0, 1 - w));
    const y = clamp(yRaw != null ? yRaw : fallbackBox.y, 0, Math.max(0, 1 - h));

    const alignRaw = typeof rawBox.align === 'string' ? rawBox.align.trim().toLowerCase() : '';
    const align = alignRaw === 'left' || alignRaw === 'center' || alignRaw === 'right'
      ? alignRaw
      : fallbackBox.align;

    const fontScaleRaw = toFiniteNumber(rawBox.font_scale);
    const lineHeightRaw = toFiniteNumber(rawBox.line_height);

    return {
      x: round(x, 4),
      y: round(y, 4),
      w: round(w, 4),
      h: round(h, 4),
      align,
      font_scale:
        fontScaleRaw != null && fontScaleRaw > 0
          ? round(clamp(fontScaleRaw, 0.7, 1.7), 3)
          : fallbackBox.font_scale,
      line_height:
        lineHeightRaw != null && lineHeightRaw > 0
          ? round(clamp(lineHeightRaw, 1, 2), 3)
          : fallbackBox.line_height,
    };
  }

  function parseLayout(rawLayout) {
    if (rawLayout == null) {
      return deepClone(DEFAULT_LAYOUT);
    }

    let parsed = rawLayout;
    if (typeof parsed === 'string') {
      const trimmed = parsed.trim();
      if (!trimmed) {
        return deepClone(DEFAULT_LAYOUT);
      }
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
    if (version === 2 && parsed.base && typeof parsed.base === 'object' && !Array.isArray(parsed.base)) {
      parsed = {
        layout_version: 1,
        title_box: parsed.base.title_box,
        text_box: parsed.base.text_box,
      };
    }

    const textBox = normalizeLayoutBox(parsed.text_box, DEFAULT_LAYOUT.text_box);
    if (!textBox) return null;

    const titleBox = normalizeLayoutBox(parsed.title_box, DEFAULT_LAYOUT.title_box);

    return {
      layout_version: 1,
      title_box: titleBox,
      text_box: textBox,
    };
  }

  class FeedLayoutEditor {
    constructor(options = {}) {
      this.onChange = typeof options.onChange === 'function' ? options.onChange : null;
      this.layout = parseLayout(options.initialLayout) || parseLayout(null);
      this.enabled = false;
      this.mounted = false;
      this.dragState = null;
      this.shiftPressed = false;
      this.rafId = 0;

      this.mountEl = null;
      this.imageShellEl = null;
      this.overlayEl = null;
      this.centerGuideEl = null;
      this.boxEls = {
        title_box: null,
        text_box: null,
      };
      this.titleTextEl = null;
      this.bodyTextEl = null;

      this.boundOnPointerDown = (event) => this.onPointerDown(event);
      this.boundOnPointerMove = (event) => this.onPointerMove(event);
      this.boundOnPointerUp = (event) => this.onPointerUp(event);
      this.boundOnWindowKeyDown = (event) => this.onWindowKeyDown(event);
      this.boundOnWindowKeyUp = (event) => this.onWindowKeyUp(event);
      this.boundOnResize = () => this.requestRender();
    }

    mount(mountEl) {
      if (!mountEl) return false;

      const imageShellEl = mountEl.querySelector('.feed-rendered-image-shell');
      const imageEl = imageShellEl?.querySelector('.feed-rendered-card-image');
      if (!imageShellEl || !imageEl) {
        return false;
      }

      if (this.overlayEl && this.overlayEl.parentElement !== imageShellEl) {
        this.overlayEl.remove();
      }

      if (!this.overlayEl || this.overlayEl.parentElement !== imageShellEl) {
        this.overlayEl = document.createElement('div');
        this.overlayEl.className = 'gls-layout-editor-overlay';
        this.overlayEl.innerHTML = `
          <div class="gls-layout-center-guide" aria-hidden="true"></div>
          <div class="gls-layout-box gls-layout-box--title" data-layout-key="title_box" role="button" tabindex="-1" aria-label="제목 텍스트 박스 위치">
            <div class="gls-layout-box__label">제목 박스</div>
            <div class="gls-layout-box__title">제목</div>
            <span class="gls-layout-box__warning" hidden>안전 영역 밖</span>
          </div>
          <div class="gls-layout-box gls-layout-box--body" data-layout-key="text_box" role="button" tabindex="-1" aria-label="본문 텍스트 박스 위치">
            <div class="gls-layout-box__label">본문 박스</div>
            <div class="gls-layout-box__body">본문</div>
            <span class="gls-layout-box__warning" hidden>안전 영역 밖</span>
          </div>
        `;
        imageShellEl.appendChild(this.overlayEl);
      }

      this.mountEl = mountEl;
      this.imageShellEl = imageShellEl;
      this.centerGuideEl = this.overlayEl.querySelector('.gls-layout-center-guide');
      this.boxEls.title_box = this.overlayEl.querySelector('.gls-layout-box[data-layout-key="title_box"]');
      this.boxEls.text_box = this.overlayEl.querySelector('.gls-layout-box[data-layout-key="text_box"]');
      this.titleTextEl = this.boxEls.title_box?.querySelector('.gls-layout-box__title') || null;
      this.bodyTextEl = this.boxEls.text_box?.querySelector('.gls-layout-box__body') || null;

      LAYOUT_KEYS.forEach((key) => {
        const boxEl = this.boxEls[key];
        if (!boxEl) return;
        if (boxEl.dataset.boundLayoutDrag === '1') return;
        boxEl.dataset.boundLayoutDrag = '1';
        boxEl.addEventListener('pointerdown', this.boundOnPointerDown);
      });

      if (!this.mounted) {
        window.addEventListener('pointermove', this.boundOnPointerMove);
        window.addEventListener('pointerup', this.boundOnPointerUp);
        window.addEventListener('resize', this.boundOnResize, { passive: true });
        window.addEventListener('keydown', this.boundOnWindowKeyDown);
        window.addEventListener('keyup', this.boundOnWindowKeyUp);
      }

      this.mounted = true;
      this.requestRender();
      return true;
    }

    destroy() {
      if (!this.mounted) return;

      window.removeEventListener('pointermove', this.boundOnPointerMove);
      window.removeEventListener('pointerup', this.boundOnPointerUp);
      window.removeEventListener('resize', this.boundOnResize);
      window.removeEventListener('keydown', this.boundOnWindowKeyDown);
      window.removeEventListener('keyup', this.boundOnWindowKeyUp);

      LAYOUT_KEYS.forEach((key) => {
        const boxEl = this.boxEls[key];
        if (boxEl) {
          boxEl.removeEventListener('pointerdown', this.boundOnPointerDown);
        }
      });

      if (this.overlayEl) {
        this.overlayEl.remove();
      }

      if (this.rafId) {
        window.cancelAnimationFrame(this.rafId);
      }

      this.mounted = false;
      this.dragState = null;
      this.mountEl = null;
      this.imageShellEl = null;
      this.overlayEl = null;
      this.centerGuideEl = null;
      this.boxEls = { title_box: null, text_box: null };
      this.titleTextEl = null;
      this.bodyTextEl = null;
      this.rafId = 0;
    }

    setEnabled(nextEnabled) {
      this.enabled = Boolean(nextEnabled);
      if (this.overlayEl) {
        this.overlayEl.classList.toggle('is-enabled', this.enabled);
      }
      if (!this.enabled) {
        this.dragState = null;
      }
      this.requestRender();
    }

    isEnabled() {
      return this.enabled;
    }

    setPreviewText({ title = '', body = '' } = {}) {
      if (this.titleTextEl) {
        this.titleTextEl.textContent = title || '제목';
      }
      if (this.bodyTextEl) {
        this.bodyTextEl.textContent = body || '본문';
      }
    }

    setLayout(rawLayout) {
      const next = parseLayout(rawLayout);
      if (!next) return false;
      this.layout = next;
      this.requestRender();
      return true;
    }

    getLayout() {
      return parseLayout(this.layout) || deepClone(DEFAULT_LAYOUT);
    }

    resetLayout() {
      this.layout = deepClone(DEFAULT_LAYOUT);
      this.requestRender();
      this.emitChange('reset');
    }

    onWindowKeyDown(event) {
      if (event.key === 'Shift') {
        this.shiftPressed = true;
      }
      if (event.key === 'Escape' && this.enabled) {
        this.setEnabled(false);
        this.emitChange('escape');
      }
    }

    onWindowKeyUp(event) {
      if (event.key === 'Shift') {
        this.shiftPressed = false;
      }
    }

    onPointerDown(event) {
      if (!this.enabled || !this.overlayEl) return;
      if (event.button !== 0) return;

      const targetBox = event.currentTarget?.closest?.('.gls-layout-box[data-layout-key]') || event.currentTarget;
      const boxKey = targetBox?.dataset?.layoutKey;
      if (!LAYOUT_KEYS.includes(boxKey)) return;

      const rect = this.overlayEl.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const box = this.layout[boxKey];
      this.dragState = {
        pointerId: event.pointerId,
        key: boxKey,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: box.x,
        startY: box.y,
        width: box.w,
        height: box.h,
      };

      targetBox.classList.add('is-dragging');
      if (typeof targetBox.setPointerCapture === 'function') {
        try {
          targetBox.setPointerCapture(event.pointerId);
        } catch (_error) {
          // ignore
        }
      }

      event.preventDefault();
    }

    onPointerMove(event) {
      if (!this.dragState || !this.overlayEl) return;
      if (event.pointerId !== this.dragState.pointerId) return;

      const rect = this.overlayEl.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const deltaX = (event.clientX - this.dragState.startClientX) / rect.width;
      const deltaY = (event.clientY - this.dragState.startClientY) / rect.height;

      const width = this.dragState.width;
      const height = this.dragState.height;
      let nextX = this.dragState.startX + deltaX;
      let nextY = this.dragState.startY + deltaY;

      nextX = clamp(nextX, 0, Math.max(0, 1 - width));
      nextY = clamp(nextY, 0, Math.max(0, 1 - height));

      if (!this.shiftPressed) {
        const centerX = nextX + width / 2;
        if (Math.abs(centerX - 0.5) <= SNAP_CENTER_THRESHOLD) {
          nextX = clamp(0.5 - width / 2, 0, Math.max(0, 1 - width));
        }
      }

      const boxKey = this.dragState.key;
      this.layout[boxKey].x = round(nextX, 4);
      this.layout[boxKey].y = round(nextY, 4);
      this.requestRender();
      this.emitChange('drag');
      event.preventDefault();
    }

    onPointerUp(event) {
      if (!this.dragState) return;
      if (event.pointerId !== this.dragState.pointerId) return;

      const boxEl = this.boxEls[this.dragState.key];
      if (boxEl) {
        boxEl.classList.remove('is-dragging');
      }
      this.dragState = null;
      this.emitChange('drag_end');
    }

    isOutsideSafeAreaForBox(key) {
      const box = this.layout?.[key];
      if (!box) return false;

      const left = box.x;
      const top = box.y;
      const right = box.x + box.w;
      const bottom = box.y + box.h;

      return (
        left < SAFE_AREA.left ||
        top < SAFE_AREA.top ||
        right > SAFE_AREA.right ||
        bottom > SAFE_AREA.bottom
      );
    }

    isOutsideSafeArea() {
      return LAYOUT_KEYS.some((key) => this.isOutsideSafeAreaForBox(key));
    }

    requestRender() {
      if (!this.overlayEl) return;
      if (this.rafId) return;

      this.rafId = window.requestAnimationFrame(() => {
        this.rafId = 0;

        LAYOUT_KEYS.forEach((key) => {
          const box = this.layout[key];
          const boxEl = this.boxEls[key];
          if (!box || !boxEl) return;

          boxEl.style.left = `${round(box.x * 100, 4)}%`;
          boxEl.style.top = `${round(box.y * 100, 4)}%`;
          boxEl.style.width = `${round(box.w * 100, 4)}%`;
          boxEl.style.height = `${round(box.h * 100, 4)}%`;
          boxEl.style.setProperty('--gls-layout-align', box.align || 'center');
          boxEl.style.setProperty('--gls-layout-font-scale', String(box.font_scale || 1));
          boxEl.style.setProperty('--gls-layout-line-height', String(box.line_height || 1.15));

          const outside = this.isOutsideSafeAreaForBox(key);
          boxEl.classList.toggle('is-outside-safe-area', outside);
          const warningEl = boxEl.querySelector('.gls-layout-box__warning');
          if (warningEl) {
            warningEl.hidden = !outside;
          }
        });

        this.overlayEl.classList.toggle('is-outside-safe-area', this.isOutsideSafeArea());
      });
    }

    emitChange(reason) {
      if (typeof this.onChange !== 'function') return;
      this.onChange({
        reason,
        layout: this.getLayout(),
        enabled: this.enabled,
        outsideSafeArea: this.isOutsideSafeArea(),
      });
    }
  }

  global.GlsFeedLayoutEditor = FeedLayoutEditor;
})(window);
