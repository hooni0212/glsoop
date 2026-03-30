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

let glsoopRuntimeConfigPromise = null;
const GLS_KST_TIME_ZONE = 'Asia/Seoul';
const GLS_SQLITE_UTC_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?$/;
const glsKoreanDateTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: GLS_KST_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  hourCycle: 'h23',
});

function getGlsoopRuntimeConfig() {
  if (glsoopRuntimeConfigPromise) return glsoopRuntimeConfigPromise;

  const fallback = { safe_area_guides: false };

  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    glsoopRuntimeConfigPromise = Promise.resolve(fallback);
    return glsoopRuntimeConfigPromise;
  }

  glsoopRuntimeConfigPromise = fetch('/api/runtime-config', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) return fallback;

      const payload = await response.json().catch(() => null);
      const safeAreaGuidesEnabled =
        payload?.ok === true && payload?.flags?.safe_area_guides === true;

      return {
        safe_area_guides: safeAreaGuidesEnabled,
      };
    })
    .catch(() => fallback);

  return glsoopRuntimeConfigPromise;
}

function parseGlsoopDateTime(value) {
  if (!value && value !== 0) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }

  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const sqliteMatch = trimmed.match(GLS_SQLITE_UTC_DATETIME_RE);
    if (sqliteMatch) {
      const [
        ,
        year,
        month,
        day,
        hour = '00',
        minute = '00',
        second = '00',
        fraction = '',
      ] = sqliteMatch;
      const millisecond = fraction
        ? Number(String(fraction).slice(0, 3).padEnd(3, '0'))
        : 0;
      return new Date(
        Date.UTC(
          Number(year),
          Number(month) - 1,
          Number(day),
          Number(hour),
          Number(minute),
          Number(second),
          millisecond
        )
      );
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getFormatterParts(formatter, date) {
  const parts = formatter.formatToParts(date);
  return parts.reduce((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});
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

  const date = parseGlsoopDateTime(value);
  if (!date) {
    return String(value);
  }

  const parts = getFormatterParts(glsKoreanDateTimeFormatter, date);

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
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

/**
 * 로그인 페이지 이동 URL 생성 (현재 경로를 next로 보존)
 * @param {Object} options
 * @param {string} options.source - 유입 출처 식별자
 * @param {string} options.nextPath - 명시적 next 경로(선택)
 * @returns {string}
 */
function buildLoginRedirectWithNext(options = {}) {
  const source = typeof options.source === 'string' ? options.source.trim() : '';
  const nextPathRaw =
    typeof options.nextPath === 'string' ? options.nextPath : `${window.location.pathname}${window.location.search || ''}`;
  const isSafeInternalPath =
    typeof nextPathRaw === 'string' &&
    nextPathRaw.startsWith('/') &&
    !nextPathRaw.startsWith('//') &&
    !nextPathRaw.startsWith('/\\');
  const nextPath = isSafeInternalPath ? nextPathRaw : '/';

  const query = new URLSearchParams();
  query.set('next', nextPath);
  if (source) {
    query.set('from', source);
  }
  return `/html/login.html?${query.toString()}`;
}

/**
 * 로그인 필요 시 안내 후 로그인 페이지로 이동
 * @param {Object} options
 * @param {string} options.alertMessage - 사용자 안내 문구(선택)
 * @param {string} options.source - 유입 출처 식별자
 * @param {string} options.nextPath - 명시적 next 경로(선택)
 */
function redirectToLoginWithNext(options = {}) {
  const alertMessage =
    typeof options.alertMessage === 'string' ? options.alertMessage : '';
  if (alertMessage) {
    if (window.glsoopUi && typeof window.glsoopUi.showPageNotice === 'function') {
      window.glsoopUi.showPageNotice(alertMessage, {
        type: 'error',
        autoHideMs: 2600,
      });
    } else {
      alert(alertMessage);
    }
  }
  window.location.href = buildLoginRedirectWithNext(options);
}

function ensureAuthGateModal() {
  let modalEl = document.getElementById('glsoopAuthGateModal');
  if (modalEl) return modalEl;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="modal fade" id="glsoopAuthGateModal" tabindex="-1" aria-labelledby="glsoopAuthGateModalLabel" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content gls-auth-gate-modal">
          <div class="modal-header">
            <div>
              <p class="gls-auth-gate-modal__eyebrow gls-mb-1">MEMBERS ONLY</p>
              <h5 class="modal-title" id="glsoopAuthGateModalLabel">로그인 후 이용할 수 있어요</h5>
            </div>
            <button type="button" class="gls-modal-close" data-gls-dismiss="modal" aria-label="닫기"></button>
          </div>
          <div class="modal-body gls-auth-gate-modal__body">
            <p class="gls-mb-2" id="glsoopAuthGateModalMessage">로그인한 회원만 이용할 수 있는 기능입니다.</p>
            <p class="gls-text-small gls-text-muted gls-mb-0" id="glsoopAuthGateModalDescription">
              로그인하면 더 많은 기능을 이용할 수 있습니다.
            </p>
          </div>
          <div class="modal-footer gls-auth-gate-modal__footer">
            <button type="button" class="gls-btn gls-btn-secondary" id="glsoopAuthGateBackBtn">돌아가기</button>
            <button type="button" class="gls-btn gls-btn-primary" id="glsoopAuthGateLoginBtn">로그인하기</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrapper.firstElementChild);
  modalEl = document.getElementById('glsoopAuthGateModal');
  return modalEl;
}

(function bootstrapAuthGateModal() {
  if (window.glsoopAuthGateModal && typeof window.glsoopAuthGateModal.open === 'function') return;

  let currentOptions = null;

  const close = () => {
    const modalEl = document.getElementById('glsoopAuthGateModal');
    if (!modalEl || !window.glsModal) return;
    window.glsModal.close(modalEl);
  };

  const open = (options = {}) => {
    const modalEl = ensureAuthGateModal();
    currentOptions = {
      title: typeof options.title === 'string' ? options.title : '로그인 후 이용할 수 있어요',
      message: typeof options.message === 'string'
        ? options.message
        : '로그인한 회원만 이용할 수 있는 기능입니다.',
      description: typeof options.description === 'string'
        ? options.description
        : '로그인하면 더 많은 기능을 이용할 수 있습니다.',
      source: typeof options.source === 'string' ? options.source : '',
      nextPath: typeof options.nextPath === 'string' ? options.nextPath : '',
      backBehavior: options.backBehavior === 'history' ? 'history' : 'close',
      onBack: typeof options.onBack === 'function' ? options.onBack : null,
      onLogin: typeof options.onLogin === 'function' ? options.onLogin : null,
    };

    const titleEl = document.getElementById('glsoopAuthGateModalLabel');
    const messageEl = document.getElementById('glsoopAuthGateModalMessage');
    const descriptionEl = document.getElementById('glsoopAuthGateModalDescription');
    if (titleEl) titleEl.textContent = currentOptions.title;
    if (messageEl) messageEl.textContent = currentOptions.message;
    if (descriptionEl) descriptionEl.textContent = currentOptions.description;

    const loginBtn = document.getElementById('glsoopAuthGateLoginBtn');
    if (loginBtn && loginBtn.dataset.bound !== '1') {
      loginBtn.dataset.bound = '1';
      loginBtn.addEventListener('click', () => {
        const active = currentOptions || {};
        if (typeof active.onLogin === 'function') {
          active.onLogin();
          return;
        }
        redirectToLoginWithNext({
          source: active.source || '',
          nextPath: active.nextPath || undefined,
          alertMessage: '',
        });
      });
    }

    const backBtn = document.getElementById('glsoopAuthGateBackBtn');
    if (backBtn && backBtn.dataset.bound !== '1') {
      backBtn.dataset.bound = '1';
      backBtn.addEventListener('click', () => {
        const active = currentOptions || {};
        close();
        if (typeof active.onBack === 'function') {
          active.onBack();
          return;
        }
        if (active.backBehavior === 'history') {
          if (window.history.length > 1) {
            window.history.back();
            return;
          }
        }
      });
    }

    if (window.glsModal) {
      window.glsModal.open(modalEl);
    }
  };

  window.glsoopAuthGateModal = { open, close };
})();

function ensureFormFeedbackElement(form, elementId) {
  if (!form || !elementId) return null;
  let el = document.getElementById(elementId);
  if (el) {
    if (!el.getAttribute('role')) {
      el.setAttribute('role', 'status');
    }
    if (!el.getAttribute('aria-live')) {
      el.setAttribute('aria-live', 'polite');
    }
    if (!el.getAttribute('aria-atomic')) {
      el.setAttribute('aria-atomic', 'true');
    }
    return el;
  }

  el = document.createElement('div');
  el.id = elementId;
  el.className = 'gls-feedback gls-feedback--info';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.setAttribute('tabindex', '-1');
  form.prepend(el);
  return el;
}

function clearFeedbackMessage(targetEl) {
  if (!targetEl) return;
  targetEl.textContent = '';
  targetEl.classList.remove('is-visible', 'gls-feedback--info', 'gls-feedback--success', 'gls-feedback--error');
  targetEl.classList.add('gls-feedback');
}

function setFeedbackMessage(targetEl, message, options = {}) {
  if (!targetEl) return;
  const type = typeof options.type === 'string' ? options.type : 'info';
  const focus = options.focus === true;
  const isError = type === 'error';

  targetEl.textContent = message || '';
  targetEl.classList.remove('gls-feedback--info', 'gls-feedback--success', 'gls-feedback--error');
  targetEl.classList.add('gls-feedback', 'is-visible');
  targetEl.setAttribute('role', isError ? 'alert' : 'status');
  targetEl.setAttribute('aria-live', isError ? 'assertive' : 'polite');
  targetEl.setAttribute('aria-atomic', 'true');
  if (type === 'success') {
    targetEl.classList.add('gls-feedback--success');
  } else if (type === 'error') {
    targetEl.classList.add('gls-feedback--error');
  } else {
    targetEl.classList.add('gls-feedback--info');
  }

  if (focus) {
    targetEl.focus({ preventScroll: true });
    if (typeof targetEl.scrollIntoView === 'function') {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

function showPageNotice(message, options = {}) {
  if (!message) return;
  const type = typeof options.type === 'string' ? options.type : 'info';
  const isError = type === 'error';
  const autoHideMs =
    typeof options.autoHideMs === 'number' && options.autoHideMs > 0
      ? options.autoHideMs
      : 2600;
  const noticeId = 'glsPageNotice';

  let noticeEl = document.getElementById(noticeId);
  if (!noticeEl) {
    noticeEl = document.createElement('div');
    noticeEl.id = noticeId;
    noticeEl.className = 'gls-page-notice';
    noticeEl.setAttribute('role', 'status');
    noticeEl.setAttribute('aria-live', 'polite');
    noticeEl.setAttribute('aria-atomic', 'true');
    document.body.appendChild(noticeEl);
  }

  noticeEl.textContent = message;
  noticeEl.setAttribute('role', isError ? 'alert' : 'status');
  noticeEl.setAttribute('aria-live', isError ? 'assertive' : 'polite');
  noticeEl.classList.remove('gls-page-notice--info', 'gls-page-notice--success', 'gls-page-notice--error');
  if (type === 'success') {
    noticeEl.classList.add('gls-page-notice--success');
  } else if (type === 'error') {
    noticeEl.classList.add('gls-page-notice--error');
  } else {
    noticeEl.classList.add('gls-page-notice--info');
  }

  if (noticeEl.__hideTimer) {
    clearTimeout(noticeEl.__hideTimer);
  }
  noticeEl.__hideTimer = setTimeout(() => {
    if (!noticeEl || !noticeEl.parentNode) return;
    noticeEl.parentNode.removeChild(noticeEl);
  }, autoHideMs);
}

window.glsoopUi = window.glsoopUi || {};
window.glsoopUi.ensureFormFeedbackElement = ensureFormFeedbackElement;
window.glsoopUi.clearFeedbackMessage = clearFeedbackMessage;
window.glsoopUi.setFeedbackMessage = setFeedbackMessage;
window.glsoopUi.showPageNotice = showPageNotice;

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
    modalEl.classList.add('is-flex-visible');
    modalEl.removeAttribute('hidden');
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
    modalEl.classList.remove('is-flex-visible');
    modalEl.setAttribute('hidden', '');
    modalEl.setAttribute('aria-hidden', 'true');
    modalEl.removeAttribute('aria-modal');
    document.body.classList.remove('modal-open');
  };

  window.glsModal = { open, close, __glsBootstrapShim: true };
})();
