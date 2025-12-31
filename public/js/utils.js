// public/js/utils.js
// 글숲 프론트 공통 유틸 함수 모음
// - 글귀 카드 폰트 자동 조절
// - 이메일 마스킹
// - HTML 이스케이프(XSS 방지)
// - 날짜 포맷 (서버 UTC → 한국 시간 기준 문자열)
// - 본문에 심어둔 폰트 메타 태그 파싱

/**
 * 글 길이에 따라 quote-card 안 폰트 크기 자동 조절
 * - el.innerText(순수 텍스트) 길이를 기준으로 폰트 크기를 줄여줌
 * - 너무 긴 글이 들어가도 카드 안에 예쁘게 들어가도록 하는 역할
 *
 * @param {HTMLElement} el - 폰트 크기를 조절할 요소(.quote-card 등)
 */
function autoAdjustQuoteFont(el) {
  if (!el) return;

  // HTML 태그를 제외한 순수 텍스트만 사용
  const text = el.innerText.trim();
  const len = text.length; // 글자 수

  // 기본 폰트 크기(rem)
  let fontSize = 1.6;

  // 글자 수 구간별로 폰트 크기 조정
  if (len > 140) {
    fontSize = 1.1;
  } else if (len > 100) {
    fontSize = 1.2;
  } else if (len > 70) {
    fontSize = 1.3;
  } else if (len > 40) {
    fontSize = 1.4;
  } else {
    fontSize = 1.6;
  }

  // 너무 작아지지 않게 최소값 보정
  if (fontSize < 1.1) fontSize = 1.1;

  // 실제 스타일 반영
  el.style.fontSize = fontSize + 'rem';

  // 줄간 간격도 폰트 크기에 맞춰 살짝 키워줌 (최대 2.0)
  el.style.lineHeight = Math.min(fontSize + 0.4, 2.0);
}

/**
 * 이메일 마스킹: 앞 3글자만 노출 + 나머지는 * 처리
 *
 * 예)
 *   "abcdef@naver.com" → "abc***"
 *   "ab@naver.com"     → "ab"
 *   "a@naver.com"      → "a"
 *
 * - 도메인(@ 뒤)는 표시하지 않고, 로컬 파트(앞부분)만 처리
 * - 이메일이 없거나 형식이 이상해도 최대한 안전하게 처리
 *
 * @param {string} email - 전체 이메일 문자열
 * @returns {string} 마스킹된 이메일(또는 빈 문자열)
 */
function maskEmail(email) {
  if (!email) return '';

  // @ 앞부분만 사용
  const atIndex = email.indexOf('@');
  const localPart = atIndex === -1 ? email : email.slice(0, atIndex);
  const len = localPart.length;

  if (len === 0) return '';

  // 최소 3글자까지는 원문 표시
  const visibleLen = Math.min(3, len);
  const visible = localPart.slice(0, visibleLen);

  // 나머지는 *로 채우기
  const hiddenCount = len - visibleLen;
  const stars = hiddenCount > 0 ? '*'.repeat(hiddenCount) : '';

  return visible + stars;
}

/**
 * HTML 이스케이프 (XSS 방지용)
 * - 사용자가 입력한 문자열을 그대로 innerHTML 등에 넣으면 위험하므로
 *   특별한 문자(태그/속성에 쓰이는 문자)를 HTML 엔티티로 치환
 *
 *   &  → &amp;
 *   <  → &lt;
 *   >  → &gt;
 *   "  → &quot;
 *   '  → &#039;
 *
 * @param {string} str - 원본 문자열
 * @returns {string} HTML에서 안전하게 쓸 수 있도록 치환된 문자열
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * DB/서버에서 온 날짜를 한국 시간 기준 "YYYY-MM-DD HH:MM"으로 포맷하는 함수
 *
 * - ISO 문자열(예: "2025-11-29T11:26:00.000Z")도 처리
 * - SQLite CURRENT_TIMESTAMP ("2025-11-29 11:26:00")도 "UTC 시각"이라고 가정해서 처리
 *   → Date.UTC(...)로 UTC 기준 타임스탬프 생성 후
 *     new Date(utcMs)로 만든 Date에서 getHours() 등을 호출하면
 *     브라우저 로컬 시간대(KST)로 자동 변환됨
 *
 * @param {string|Date|number} value - 날짜 값(문자열, Date 객체, timestamp)
 * @returns {string} "YYYY-MM-DD HH:MM" 형식의 문자열
 */
function formatKoreanDateTime(value) {
  if (!value) return '';

  let date;

  if (typeof value === 'string') {
    // 1) ISO 형식: "2025-11-29T11:26:00.000Z" 같은 형태
    //   - 대략 T 또는 Z가 들어가면 Date 생성자에게 그대로 맡김
    if (value.includes('T') || value.endsWith('Z') || value.match(/\dZ$/)) {
      date = new Date(value);
    } else {
      // 2) "YYYY-MM-DD HH:MM[:SS]" 형식 → "UTC"라고 가정해서 직접 파싱
      const m = value.match(
        /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/
      );
      if (m) {
        const year = Number(m[1]);
        const month = Number(m[2]) - 1; // JS Date의 month는 0~11
        const day = Number(m[3]);
        const hour = Number(m[4]);
        const minute = Number(m[5]);
        const second = m[6] ? Number(m[6]) : 0;

        // ✅ UTC 기준 timestamp 생성
        const utcMs = Date.UTC(year, month, day, hour, minute, second);

        // 이 Date 인스턴스를 브라우저에서 읽으면 로컬 시간대(KST)로 보임
        date = new Date(utcMs);
      } else {
        // 형식이 예측 불가능하면 마지막으로 Date 생성자에 그대로 맡김
        date = new Date(value);
      }
    }
  } else {
    // Date 객체나 숫자(timestamp)인 경우도 그대로 Date로 래핑
    date = new Date(value);
  }

  // Date 생성에 실패했을 때(Invalid Date)는 원본 문자열을 그대로 반환
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  // 각 구성 요소 추출 + 2자리 포맷
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');

  return `${y}-${m}-${d} ${h}:${min}`;
}

/**
 * 글 content 맨 앞에 숨겨 둔 폰트 메타 태그를 파싱하는 함수
 *
 * - 에디터에서 글을 저장할 때 content 맨 앞에
 *     <!--FONT:serif-->
 *   또는
 *     <!--FONT:sans-->
 *   또는
 *     <!--FONT:hand-->
 *   이런 형식으로 폰트 정보를 심어둘 수 있음.
 *
 * - 이 함수는:
 *   1) 문자열 첫 부분에서 저 메타 태그를 찾아서 제거한 cleanHtml을 돌려주고
 *   2) fontKey('serif' | 'sans' | 'hand')를 별도로 넘겨줌
 *
 * @param {string} html - 원본 HTML 문자열 (메타 태그 포함 가능)
 * @returns {{cleanHtml: string, fontKey: ('serif'|'sans'|'hand'|null)}}
 */
function extractFontFromContent(html) {
  if (!html) {
    return { cleanHtml: '', fontKey: null };
  }

  const str = String(html);
// 1) <!--FONT:...--> 형태 우선 파싱 (선행 공백 허용)
const commentMatch = str.match(/^\s*<!--FONT:(serif|sans|hand)-->/);

// 2) 숨겨둔 <span class="gls-font-meta" data-font="...">...</span> 백업 메타도 파싱
//    - 일부 CDN/옵션에서 HTML 주석이 제거될 수 있어 보조 수단으로 사용
//    - aria-hidden, style 등 추가 속성은 존재할 수도 있으니 data-font만 확실히 체크
const spanMatch = str.match(
  /^\s*<span[^>]*class=["']?gls-font-meta[^>]*data-font=["'](serif|sans|hand)["'][^>]*><\/span>/
);

// 우선순위: 주석 메타 > span 메타
const metaMatch = commentMatch || spanMatch;

if (!metaMatch) {
  return { cleanHtml : str, fontKey: null};
}

  // metaMatch[0] : 전체 매칭 문자열 ("<!--FONT:serif-->" 또는 "<span ...>")
  // metaMatch[1] : 캡처된 fontKey ("serif" 등)
  const cleanHtml = str.replace(metaMatch[0], '').trim();
  const fontKey = metaMatch[1];

  return { cleanHtml, fontKey };
}


/**
 * 해시태그를 공통 HTML 버튼으로 만들어 주는 함수
 * - post.hashtags가 문자열("힐링, 위로")이든
 *   배열(["힐링", "위로"])이든 둘 다 처리
 * - 인덱스 해시태그 검색 로직을 위해
 *   클래스: hashtag-pill gls-tag-btn
 *   data-tag: 사람이 읽는 텍스트 그대로
 */
function buildHashtagHtml(source) {
  if (!source) return '';

  let tags = [];

  // 1) post 객체인 경우: { hashtags: ... } 형태
  if (typeof source === 'object' && !Array.isArray(source)) {
    if (!source.hashtags) return '';
    source = source.hashtags;
  }

  // 2) 배열 형태인 경우 (예: ["사랑", "위로"])
  if (Array.isArray(source)) {
    tags = source
      .map((t) => String(t).trim())
      .filter((t) => t.length > 0);
  }
  // 3) 문자열 형태인 경우 (예: "사랑, 위로, 힐링")
  else if (typeof source === 'string') {
    tags = source
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  } else {
    return '';
  }

  if (!tags.length) return '';

  const pills = tags
    .map((tag) => {
      const safeTag = escapeHtml(tag);
      return `
        <button
          type="button"
          class="hashtag-pill gls-tag-btn"
          data-tag="${safeTag}"
        >
          #${safeTag}
        </button>
      `;
    })
    .join('');

  return `
    <div class="gls-mt-2 gls-text-start gls-card-hashtags">
      ${pills}
    </div>
  `;
}

/**
 * 글 본문 HTML sanitize (XSS 방지)
 * - DOMPurify가 로드되어 있으면 허용 리스트 기반으로 정화
 * - 로드되어 있지 않으면(예외) 최후의 안전장치로 escape 처리
 */
function sanitizePostHtml(html) {
  const raw = String(html || '');

  if (typeof DOMPurify === 'undefined' || !DOMPurify?.sanitize) {
    return escapeHtml(raw);
  }

  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      'p','br','span','strong','em','u','s',
      'blockquote','pre','code','ul','ol','li',
      'h1','h2','h3','a','div'
    ],
    ALLOWED_ATTR: ['class', 'href', 'target', 'rel'],
    ALLOW_DATA_ATTR: false,

    // 방어 강화(정책 불일치/예상치 못한 태그 대비)
    FORBID_ATTR: ['style'],
    FORBID_TAGS: ['style','script','iframe','object','embed','form','input','button'],

    // 링크 스킴 제한(기본보다 더 확실하게)
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):)/i,
  });
}

// =============================================================================
// Modal helper (Bootstrap-first) — window.glsModal shim
// -----------------------------------------------------------------------------
// 배경:
// - 일부 페이지/스크립트(post.js, bookmarks.js, mypage.js 등)가
//   window.glsModal.open/close를 호출하는데, 특정 페이지에서 header.js가 로드되지
//   않거나 실행이 끊기면 모달이 "조용히" 안 뜨는 문제가 발생할 수 있음.
// - 프로젝트에서 Bootstrap 모달을 다시 사용하기로 했다면, 공용으로 항상 로드되는
//   utils.js에서 glsModal을 Bootstrap으로 래핑해 두면 가장 안전함.
//
// 동작:
// - Bootstrap(bundle) 로드 시: bootstrap.Modal.getOrCreateInstance(...).show()/hide()
// - Bootstrap 미로드 시: 최소한의 class/display 토글만 수행(완전한 대체는 아님)
(function bootstrapGlsModalShim() {
  if (window.glsModal && typeof window.glsModal.open === 'function') return;

  const getBootstrapModal = () => {
    const b = window.bootstrap;
    return b && b.Modal ? b.Modal : null;
  };

  const open = (modalEl, options = {}) => {
    if (!modalEl) return;
    const Modal = getBootstrapModal();
    if (Modal) {
      Modal.getOrCreateInstance(modalEl, options).show();
      return;
    }

    // Fallback (Bootstrap JS가 없을 때): 완벽하진 않지만 "안 보이는" 문제는 방지
    modalEl.classList.add('show');
    modalEl.style.display = 'block';
    modalEl.removeAttribute('aria-hidden');
    modalEl.setAttribute('aria-modal', 'true');
    document.body.classList.add('modal-open');
  };

  const close = (modalEl) => {
    if (!modalEl) return;
    const Modal = getBootstrapModal();
    if (Modal) {
      const inst = Modal.getInstance(modalEl);
      if (inst) inst.hide();
      return;
    }

    modalEl.classList.remove('show');
    modalEl.style.display = 'none';
    modalEl.setAttribute('aria-hidden', 'true');
    modalEl.removeAttribute('aria-modal');
    document.body.classList.remove('modal-open');
  };

  window.glsModal = { open, close, __glsBootstrapShim: true };
})();
