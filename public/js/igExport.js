// public/js/igExport.js
// - post 객체를 인스타용 PNG로 저장
// - 포맷 스위치: square(1080x1080) / feed45(1080x1350)
// - 스타일: photo-overlay(추천) / clean-card(기존 계열)
// - 정렬: post.content(Quill HTML) 내 ql-align-* 감지
// - 폰트: <!--FONT:serif|sans|hand--> 메타 감지(글숲 기존 방식 호환)
// - 배경: (A안) bgImageUrl(사진) 사용 추천. 없으면 그라디언트 프리셋 사용.

(() => {
  // ✅ 인스타 포맷 프리셋(스위치)
  const FORMATS = {
    square: { w: 1080, h: 1080 },
    feed45: { w: 1080, h: 1350 }, // ✅ 요즘 피드 권장(4:5)
  };

  // ✅ 기본 배경 프리셋(그라디언트)
  const BG_PRESETS = {
    forestMist:
      'radial-gradient(circle at top, #EAF7F1 0%, #D9F0E5 35%, #BFE3D3 100%)',
    dawnSky:
      'radial-gradient(circle at top, #EAF2FF 0%, #DDEBFF 45%, #CFE3FF 100%)',
    warmPaper:
      'radial-gradient(circle at top, #FFF7EA 0%, #F6EADB 55%, #EEDCC8 100%)',
    nightLake:
      'radial-gradient(circle at top, #1A2A3A 0%, #142230 55%, #0E1A26 100%)',
    monoInk:
      'radial-gradient(circle at top, #F4F4F4 0%, #E9E9E9 50%, #DADADA 100%)',

    // ✅ 추가 프리셋(네 UI 셀렉트에 맞춤)
    deepGreen:
      'radial-gradient(circle at top, #0E2A1E 0%, #0B2218 45%, #071A12 100%)',
    springLeaf:
      'radial-gradient(circle at top, #F1FFF6 0%, #DFF7E7 45%, #C6EED6 100%)',
    sunsetPeach:
      'radial-gradient(circle at top, #FFE8DF 0%, #FFD2C1 48%, #FFB7A1 100%)',
  };

  // ✅ 템플릿 기본값
  const DEFAULTS = {
    format: 'feed45', // 'square' | 'feed45'

    style: 'photo-overlay', // 'photo-overlay' | 'clean-card'
    bgKey: 'dawnSky',       // bgImageUrl 없을 때만 사용
    bgImageUrl: '',

    overlayOpacity: 0.35,   // 사진 위 어두운 막(0~1)
    frameInset: 70,
    showBrandText: true,

    watermarkText: 'www.glsoop.com',
    maxLen: 260,
    scale: 3,

    // ✅ Enter(문단) 간격만 따로 키우기 (Shift+Enter는 <br>로 촘촘)
    paragraphGap: 34,

    // ✅ 제목 배치: 워터마크 라인 오른쪽
    titlePlacement: 'bottom', // (지금은 bottom만 사용)
  };

  function injectStyleOnce() {
    if (document.getElementById('ig-export-style')) return;

    const style = document.createElement('style');
    style.id = 'ig-export-style';
    style.textContent = `
      .ig-export-host {
        position: fixed;
        left: -99999px;
        top: 0;
        z-index: 999999;
        pointer-events: none;
        opacity: 1;
      }

      .ig-export-root {
        position: relative;
        overflow: hidden;
        background: #111;
        font-synthesis: none;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }

      /* 배경 레이어 */
      .ig-bg {
        position: absolute;
        inset: 0;
        background-position: center;
        background-size: cover;
        background-repeat: no-repeat;
        transform: translateZ(0);
      }

      /* 사진 위 오버레이(어둡게) */
      .ig-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0,0,0,var(--ig-overlay-opacity, .35));
      }

      /* 메인 프레임 */
      .ig-frame {
        position: absolute;
        inset: var(--ig-frame-inset, 70px);
        border: 2px solid rgba(255,255,255,0.26);
        background: rgba(0,0,0,0.18);
        box-shadow: 0 20px 60px rgba(0,0,0,0.25);
        display: flex;
        flex-direction: column;
        padding: 64px 72px;
      }

      /* 상단 메타 */
      .ig-top {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 24px;
        color: rgba(255,255,255,0.92);
      }

      /* ✅ 로고 텍스트(느낌 개선) */
      .ig-brand {
        font-family: 'Nanum Pen Script', 'Nanum Myeongjo', serif;
        font-weight: 400;
        font-size: 44px;
        letter-spacing: -0.02em;
        opacity: 0.98;
        text-shadow: 0 6px 20px rgba(0,0,0,0.25);
      }

      .ig-meta {
        display: flex;
        gap: 14px;
        font-size: 22px;
        opacity: 0.9;
        white-space: nowrap;
      }
      .ig-meta .ig-author { font-weight: 500; }
      .ig-meta .ig-date { opacity: 0.85; }

      /* 본문 */
      .ig-body-wrap {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 34px 0 26px;
      }

      .ig-body {
        width: 100%;
        color: rgba(255,255,255,0.92);
        text-shadow: 0 2px 12px rgba(0,0,0,0.35);

        font-weight: 300;
        letter-spacing: 0.02em;
        line-height: 1.75;
        word-break: keep-all;
      }

      .ig-body.align-left { text-align: left; }
      .ig-body.align-center { text-align: center; }
      .ig-body.align-right { text-align: right; }

      /* (제목은 본문에서 제거하고 bottom에 배치) */
      .ig-title { display:none; }

      .ig-text { font-size: 30px; }

      /* ✅ Enter(문단) 간격만 margin으로 제어 */
      .ig-text p { margin: 0 0 var(--ig-paragraph-gap, 34px) 0; }
      .ig-text p:last-child { margin-bottom: 0; }

      /* 하단 */
      .ig-bottom {
        margin-top: 22px;
        color: rgba(255,255,255,0.88);
      }
      .ig-divider {
        height: 2px;
        background: rgba(255,255,255,0.20);
        margin: 0 0 18px 0;
      }

      /* ✅ 워터마크(좌) + 제목(우) 같은 라인 */
      .ig-bottom-row{
        display:flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 18px;
      }
      .ig-watermark {
        font-size: 22px;
        letter-spacing: 0.02em;
        opacity: 0.9;
      }
      .ig-bottom-title {
        font-size: 26px;
        font-weight: 600;
        letter-spacing: -0.01em;
        opacity: 0.92;
        text-align: right;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 58%;
      }

      /* clean-card */
      .ig-clean-frame {
        position: absolute;
        inset: 76px;
        border-radius: 72px;
        background: rgba(255,255,255,0.86);
        box-shadow: 0 30px 90px rgba(0,0,0,0.18);
        display: flex;
        flex-direction: column;
        padding: 70px 78px;
      }
      .ig-clean-top { color: rgba(20,30,40,0.9); }
      .ig-clean-body { color: rgba(20,30,40,0.85); text-shadow: none; font-weight: 600; }
      .ig-clean-bottom { color: rgba(20,30,40,0.55); }
      .ig-clean-divider { background: rgba(20,30,40,0.10); }

      .ig-clean-frame .ig-brand {
        font-family: 'Nanum Pen Script', 'Nanum Myeongjo', serif;
        text-shadow:none;
        color: rgba(20,30,40,0.92);
      }
      .ig-clean-frame .ig-bottom-title {
        color: rgba(20,30,40,0.82);
      }
    `;
    document.head.appendChild(style);
  }

  function formatDate(dt) {
    if (!dt) return '';
    try {
      const d = new Date(dt);
      if (Number.isNaN(d.getTime())) return String(dt);
      return d.toISOString().slice(0, 10);
    } catch {
      return String(dt);
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function extractFontKeyFromContent(rawHtml) {
    const m = String(rawHtml || '').match(/<!--\s*FONT:([a-zA-Z0-9_-]+)\s*-->/);
    const key = m?.[1]?.trim();
    if (!key) return '';
    if (key === 'serif' || key === 'sans' || key === 'hand') return key;
    return '';
  }

  function detectAlignFromContent(rawHtml) {
    const html = String(rawHtml || '');
    if (html.includes('ql-align-right')) return 'right';
    if (html.includes('ql-align-center')) return 'center';
    if (html.includes('ql-align-justify')) return 'center';
    return 'left';
  }

  function htmlToTextPreserveBreaks(html) {
    if (!html) return '';
    const tmp = document.createElement('div');

    let s = String(html);
    s = s.replace(/<\s*br\s*\/?>/gi, '\n');     // Shift+Enter
    s = s.replace(/<\/\s*p\s*>/gi, '\n\n');     // Enter(문단)
    s = s.replace(/<\/\s*div\s*>/gi, '\n');     // div 기반이면 줄바꿈
    tmp.innerHTML = s;

    return (tmp.textContent || tmp.innerText || '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function clampText(text, maxLen) {
    const t = String(text || '').trim();
    if (!t) return '';
    if (t.length <= maxLen) return t;
    return t.slice(0, maxLen).trim() + '…';
  }

  function renderBodyHtml(text) {
    const t = String(text || '').trim();
    if (!t) return '';

    const paras = t.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    return paras
      .map((para) => {
        const lines = para.split('\n');
        const html = lines.map(l => escapeHtml(l)).join('<br>');
        return `<p>${html}</p>`;
      })
      .join('');
  }

  function pickFontSizes(_title, body) {
    const bodyLen = (body || '').length;
    let textSize = 30;

    if (bodyLen > 240) textSize = 26;
    if (bodyLen > 320) textSize = 24;
    if (bodyLen < 120) textSize = 34;

    return { textSize };
  }

  function getFontFamily(fontKey) {
    if (fontKey === 'serif') return `'Nanum Myeongjo', 'Noto Serif KR', serif`;
    if (fontKey === 'hand') return `'Nanum Pen Script', 'Nanum Brush Script', cursive`;
    return `'Noto Sans KR', system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
  }

  function resolveFormat(format) {
    const key = format && FORMATS[format] ? format : DEFAULTS.format;
    return { key, ...(FORMATS[key] || FORMATS.feed45) };
  }

  function buildCard(post, opts) {
    const options = { ...DEFAULTS, ...(opts || {}) };
    const fmt = resolveFormat(options.format);

    const title = (post.title || '').trim();
    const rawHtml = post.content || '';
    const align = detectAlignFromContent(rawHtml);
    const fontKey = extractFontKeyFromContent(rawHtml);

    const author =
      (post.author_nickname && String(post.author_nickname).trim()) ||
      (post.author_name && String(post.author_name).trim()) ||
      '익명';

    const dateText = formatDate(post.created_at);

    const contentText = htmlToTextPreserveBreaks(rawHtml);
    const body = clampText(contentText, options.maxLen);

    const { textSize } = pickFontSizes(title, body);

    const root = document.createElement('div');
    root.className = 'ig-export-root';
    root.style.width = `${fmt.w}px`;
    root.style.height = `${fmt.h}px`;
    root.style.setProperty('--ig-overlay-opacity', String(options.overlayOpacity));
    root.style.setProperty('--ig-frame-inset', `${options.frameInset}px`);
    root.style.setProperty('--ig-paragraph-gap', `${options.paragraphGap}px`);
    root.style.fontFamily = getFontFamily(fontKey);

    // 배경
    const bg = document.createElement('div');
    bg.className = 'ig-bg';
    if (options.bgImageUrl) {
      bg.style.backgroundImage = `url("${options.bgImageUrl}")`;
    } else {
      bg.style.background = BG_PRESETS[options.bgKey] || BG_PRESETS.dawnSky;
    }
    root.appendChild(bg);

    if (options.style === 'photo-overlay') {
      const overlay = document.createElement('div');
      overlay.className = 'ig-overlay';
      root.appendChild(overlay);
    }

    const frame = document.createElement('div');
    frame.className = options.style === 'clean-card' ? 'ig-clean-frame' : 'ig-frame';

    const top = document.createElement('div');
    top.className = options.style === 'clean-card' ? 'ig-top ig-clean-top' : 'ig-top';
    top.innerHTML = `
      <div class="ig-brand" style="opacity:${options.showBrandText ? 0.98 : 0};">
        ${options.showBrandText ? '글숲' : ''}
      </div>
      <div class="ig-meta">
        <span class="ig-author">${escapeHtml(author)}</span>
        ${dateText ? `<span class="ig-date">${escapeHtml(dateText)}</span>` : ''}
      </div>
    `;

    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'ig-body-wrap';

    const bodyEl = document.createElement('div');
    bodyEl.className = `ig-body align-${align} ${options.style === 'clean-card' ? 'ig-clean-body' : ''}`;

    bodyEl.innerHTML = `
      <div class="ig-text" style="font-size:${textSize}px;">
        ${renderBodyHtml(body)}
      </div>
    `;
    bodyWrap.appendChild(bodyEl);

    const bottom = document.createElement('div');
    bottom.className = options.style === 'clean-card' ? 'ig-bottom ig-clean-bottom' : 'ig-bottom';
    bottom.innerHTML = `
      <div class="ig-divider ${options.style === 'clean-card' ? 'ig-clean-divider' : ''}"></div>
      <div class="ig-bottom-row">
        <div class="ig-watermark">${escapeHtml(options.watermarkText || '')}</div>
        <div class="ig-bottom-title">${escapeHtml(title || '')}</div>
      </div>
    `;

    frame.appendChild(top);
    frame.appendChild(bodyWrap);
    frame.appendChild(bottom);
    root.appendChild(frame);

    return { root, options, fmt };
  }

  async function waitForFonts() {
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    } catch {}
  }

  async function waitForBgImage(url) {
    if (!url) return;
    await new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = url;
    });
  }

  async function exportPostToInstagram(post, opts = {}) {
    if (!window.html2canvas) throw new Error('html2canvas not loaded');

    injectStyleOnce();

    const host = document.createElement('div');
    host.className = 'ig-export-host';
    document.body.appendChild(host);

    const { root, options, fmt } = buildCard(post, opts);

    host.style.width = `${fmt.w}px`;
    host.style.height = `${fmt.h}px`;
    host.appendChild(root);

    await waitForFonts();
    await waitForBgImage(options.bgImageUrl);
    await new Promise((r) => requestAnimationFrame(() => r()));

    const canvas = await window.html2canvas(root, {
      backgroundColor: null,
      scale: options.scale,
      useCORS: true,
      allowTaint: true,
      logging: false,
    });

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Failed to create PNG blob');

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const id = post?.id ? `post-${post.id}` : 'post';
    const tag = options.bgImageUrl ? 'photo' : (options.bgKey || 'bg');

    a.href = url;
    a.download = `glsoop_${id}_ig_${fmt.w}x${fmt.h}_${options.style}_${tag}.png`;

    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    host.remove();
  }

  window.exportPostToInstagram = exportPostToInstagram;
})();
