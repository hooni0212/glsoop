// public/js/login.js
// 로그인 페이지 스크립트
// - 로그인 폼 submit 처리
// - /api/login 호출 후 결과에 따라 마이페이지로 이동

document.addEventListener('DOMContentLoaded', () => {
  // 로그인 폼 요소 가져오기
  const form = document.getElementById('loginForm');
  if (!form) return; // 폼이 없으면 아무 것도 하지 않음 (안전장치)
  const feedbackEl =
    (window.glsoopUi &&
      typeof window.glsoopUi.ensureFormFeedbackElement === 'function' &&
      window.glsoopUi.ensureFormFeedbackElement(form, 'loginMessage')) ||
    document.getElementById('loginMessage');
  const authUtils = window.glsoopAuthFormUtils || null;
  const loginRive = window.glsoopLoginRive || null;
  const params = new URLSearchParams(window.location.search);
  const nextUrl = params.get('next');
  const source = params.get('from');
  const emailFromQuery = (params.get('email') || '').trim();
  const rememberLoginModalEl = document.getElementById('rememberLoginModal');
  const rememberLoginConfirmBtn = document.getElementById('rememberLoginConfirmBtn');
  const authShell = document.querySelector('[data-auth-shell="1"]');
  const authSceneToggleBtn = document.getElementById('authSceneToggleBtn');
  const authSceneStage = document.getElementById('authSceneStage');
  const authSceneFamily = document.getElementById('authSceneFamily');
  const authSceneName = document.getElementById('authSceneName');
  const pageBody = document.body;
  const reducedMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canHover = window.matchMedia
    && window.matchMedia('(hover: hover)').matches;
  const LOGIN_SUCCESS_SPEED_SCALE = reducedMotion ? 1 : 1.12;
  const toSuccessDuration = (baseMs) =>
    (reducedMotion ? 0 : Math.round(baseMs * LOGIN_SUCCESS_SPEED_SCALE));
  const LOGIN_HOME_SIGNAL_MS = reducedMotion ? 0 : 220;
  const LOGIN_SUCCESS_EXPAND_MS = toSuccessDuration(780);
  const LOGIN_SUCCESS_HOLD_MS = toSuccessDuration(190);
  const LOGIN_SUCCESS_COLLAPSE_MS = toSuccessDuration(700);
  const LOGIN_SUCCESS_TRANSITION_MS =
    LOGIN_SUCCESS_EXPAND_MS + LOGIN_SUCCESS_HOLD_MS + LOGIN_SUCCESS_COLLAPSE_MS;
  const MIN_SUBMIT_VISUAL_MS = reducedMotion ? 0 : 900;
  const REMEMBER_MODAL_FALLBACK_MS = reducedMotion ? 12000 : 15000;
  const RIVE_FOCUS_IDLE = 0;
  const RIVE_FOCUS_EMAIL = 1;
  const RIVE_FOCUS_PASSWORD = 2;
  const isSafeInternalPath = (value) =>
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.startsWith('/\\');
  const safeNextUrl = isSafeInternalPath(nextUrl) ? nextUrl : null;
  const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
  const delay = (ms) => new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
  const setLoginRiveFocusStep = (step) => {
    if (!loginRive) return;
    if (typeof loginRive.setFocusStep === 'function') {
      loginRive.setFocusStep(step);
      return;
    }
    if (typeof loginRive.setFocus === 'function') {
      if (step === RIVE_FOCUS_EMAIL) {
        loginRive.setFocus('email');
        return;
      }
      if (step === RIVE_FOCUS_PASSWORD) {
        loginRive.setFocus('password');
        return;
      }
      loginRive.setFocus(null);
    }
  };
  const setLoginRiveTypingFromEmail = () => {
    if (!loginRive || typeof loginRive.setTypingProgress !== 'function' || !form.email) return;
    const normalized = clamp01((form.email.value || '').trim().length / 24);
    loginRive.setTypingProgress(normalized);
  };
  const syncLoginRiveFocusFromActiveElement = () => {
    if (document.activeElement === form.email) {
      setLoginRiveFocusStep(RIVE_FOCUS_EMAIL);
      return;
    }
    if (document.activeElement === form.pw) {
      setLoginRiveFocusStep(RIVE_FOCUS_PASSWORD);
      return;
    }
    setLoginRiveFocusStep(RIVE_FOCUS_IDLE);
  };
  const beginLoginRiveSubmitAttempt = () => {
    if (!loginRive) return;
    if (typeof loginRive.beginSubmitAttempt === 'function') {
      loginRive.beginSubmitAttempt();
      return;
    }
    if (typeof loginRive.playSubmitAttempt === 'function') {
      loginRive.playSubmitAttempt();
      return;
    }
    if (typeof loginRive.pulseSubmit === 'function') {
      loginRive.pulseSubmit();
    }
  };
  const playLoginRiveSubmitAttemptAndWait = async () => {
    if (!loginRive) return;
    if (typeof loginRive.playSubmitAttemptAndWait === 'function') {
      await loginRive.playSubmitAttemptAndWait();
      return;
    }
    beginLoginRiveSubmitAttempt();
    if (!reducedMotion) {
      await delay(900);
    }
  };
  const completeLoginRiveSubmitResult = (success) => {
    if (!loginRive) return;
    if (typeof loginRive.completeSubmitResult === 'function') {
      loginRive.completeSubmitResult(Boolean(success));
      return;
    }
    if (typeof loginRive.setSubmitResult === 'function') {
      loginRive.setSubmitResult(Boolean(success));
      return;
    }
    if (typeof loginRive.playSubmit === 'function') {
      loginRive.playSubmit(Boolean(success));
    }
  };
  let submitting = false;
  let submitAnimationInFlight = false;
  let submitTokenSequence = 0;
  let activeSubmitToken = 0;
  let redirectingAfterSuccess = false;
  let successSignalTimer = 0;
  let successTransitionTimer = 0;
  const motionState = {
    pointerX: 0.5,
    pointerY: 0.36,
    ambientWave: 0,
    ambientDrift: 0,
  };
  let activeSceneProfile = {
    tilt: 1,
    wind: 1,
    shift: 1,
    glow: 1,
    speed: 0.62,
    ambientAmp: 1,
  };
  let ambientRaf = 0;
  let authEventTimer = 0;
  let stopRetryCountdown = null;
  let pendingRememberRedirect = null;
  let rememberModalFallbackTimer = 0;
  const REMEMBER_NOTICE_ONCE_PER_DAY_KEY = 'glsoop.remember_notice_shown_date';
  const AUTH_SCENES = [
    {
      key: 'wind-tree',
      family: 'Wind Spire',
      name: 'Needle Crest',
      hue: 148,
      sat: '44%',
      accent: 172,
      profile: { tilt: 1.08, wind: 1.18, shift: 1.14, glow: 1.06, speed: 0.74, ambientAmp: 1.12 },
    },
    {
      key: 'paper-canopy',
      family: 'Paper Forest',
      name: 'Folded Canopy',
      hue: 146,
      sat: '36%',
      accent: 166,
      profile: { tilt: 0.94, wind: 0.9, shift: 0.92, glow: 0.94, speed: 0.58, ambientAmp: 0.92 },
    },
    {
      key: 'aurora-grove',
      family: 'Ribbon Night',
      name: 'Aurora Thread',
      hue: 162,
      sat: '42%',
      accent: 186,
      profile: { tilt: 1.08, wind: 1.04, shift: 1.08, glow: 1.16, speed: 0.82, ambientAmp: 1.16 },
    },
    {
      key: 'ink-mountain',
      family: 'Ink Ridge',
      name: 'Graphite Ridge',
      hue: 144,
      sat: '28%',
      accent: 170,
      profile: { tilt: 0.86, wind: 0.84, shift: 0.9, glow: 0.9, speed: 0.56, ambientAmp: 0.82 },
    },
    {
      key: 'petal-orbit',
      family: 'Petal Orbit',
      name: 'Orbit Bloom',
      hue: 152,
      sat: '40%',
      accent: 176,
      profile: { tilt: 1.12, wind: 1.1, shift: 1.2, glow: 1.2, speed: 0.86, ambientAmp: 1.2 },
    },
    {
      key: 'canyon-lantern',
      family: 'Canyon Lantern',
      name: 'Amber Rift',
      hue: 140,
      sat: '34%',
      accent: 166,
      profile: { tilt: 0.96, wind: 0.98, shift: 1.06, glow: 1.08, speed: 0.68, ambientAmp: 1.04 },
    },
    {
      key: 'crystal-lake',
      family: 'Crystal Lake',
      name: 'Prism Tide',
      hue: 158,
      sat: '40%',
      accent: 184,
      profile: { tilt: 0.98, wind: 0.92, shift: 1.04, glow: 1.12, speed: 0.78, ambientAmp: 1.08 },
    },
    {
      key: 'root-cathedral',
      family: 'Root Cathedral',
      name: 'Root Hall',
      hue: 138,
      sat: '34%',
      accent: 162,
      profile: { tilt: 0.96, wind: 0.94, shift: 1.02, glow: 0.98, speed: 0.64, ambientAmp: 0.96 },
    },
    {
      key: 'storm-glyph',
      family: 'Storm Glyph',
      name: 'Volt Circle',
      hue: 168,
      sat: '42%',
      accent: 192,
      profile: { tilt: 1.12, wind: 1.12, shift: 1.18, glow: 1.22, speed: 0.94, ambientAmp: 1.24 },
    },
    {
      key: 'moon-garden',
      family: 'Moon Garden',
      name: 'Luna Meadow',
      hue: 154,
      sat: '30%',
      accent: 174,
      profile: { tilt: 0.94, wind: 0.92, shift: 0.98, glow: 1.04, speed: 0.72, ambientAmp: 0.98 },
    },
  ];

  const critterMarkup = `
    <div class="auth-scene-story" aria-hidden="true">
      <span class="auth-scene-story-shadow"></span>
      <div class="auth-squirrel">
        <span class="auth-squirrel-tail"></span>
        <span class="auth-squirrel-body"></span>
        <span class="auth-squirrel-head"></span>
        <span class="auth-squirrel-ear auth-squirrel-ear--left"></span>
        <span class="auth-squirrel-ear auth-squirrel-ear--right"></span>
        <span class="auth-squirrel-eye"></span>
        <span class="auth-squirrel-paw auth-squirrel-paw--front"></span>
        <span class="auth-squirrel-paw auth-squirrel-paw--rear"></span>
        <span class="auth-squirrel-nut"></span>
      </div>
      <div class="auth-acorn">
        <span class="auth-acorn-cap"></span>
        <span class="auth-acorn-body"></span>
      </div>
      <span class="auth-scene-leaf auth-scene-leaf--1"></span>
      <span class="auth-scene-leaf auth-scene-leaf--2"></span>
      <span class="auth-scene-leaf auth-scene-leaf--3"></span>
    </div>
  `;

  const coreTreeMarkup = `
    <div class="auth-scene-core-tree" aria-hidden="true">
      <span class="auth-scene-core-tree__canopy auth-scene-core-tree__canopy--1"></span>
      <span class="auth-scene-core-tree__canopy auth-scene-core-tree__canopy--2"></span>
      <span class="auth-scene-core-tree__canopy auth-scene-core-tree__canopy--3"></span>
      <span class="auth-scene-core-tree__trunk"></span>
    </div>
    ${critterMarkup}
  `;

  const setAuthEvent = (eventName, holdMs = 1800) => {
    if (!authShell) return;
    authShell.dataset.authEvent = eventName || 'idle';
    if (authEventTimer) {
      window.clearTimeout(authEventTimer);
      authEventTimer = 0;
    }
    if (!holdMs || holdMs <= 0) return;
    authEventTimer = window.setTimeout(() => {
      if (authShell.dataset.authEvent === eventName) {
        authShell.dataset.authEvent = 'idle';
      }
      authEventTimer = 0;
    }, holdMs);
  };

  const buildSceneMarkup = (sceneKey) => {
    if (sceneKey === 'wind-tree') {
      return `
        <span class="auth-scene-glow"></span>
        <span class="auth-scene-mist auth-scene-mist--a"></span>
        <span class="auth-scene-mist auth-scene-mist--b"></span>
        <span class="auth-scene-gust auth-scene-gust--a"></span>
        <span class="auth-scene-gust auth-scene-gust--b"></span>
        <div class="auth-scene-tree">
          <span class="auth-scene-tree__canopy auth-scene-tree__canopy--1"></span>
          <span class="auth-scene-tree__canopy auth-scene-tree__canopy--2"></span>
          <span class="auth-scene-tree__canopy auth-scene-tree__canopy--3"></span>
          <span class="auth-scene-tree__trunk"></span>
        </div>
        <span class="auth-scene-ground"></span>
        ${coreTreeMarkup}
      `;
    }

    if (sceneKey === 'paper-canopy') {
      return `
        <span class="auth-scene-paper auth-scene-paper--back"></span>
        <span class="auth-scene-paper auth-scene-paper--mid"></span>
        <span class="auth-scene-paper auth-scene-paper--front"></span>
        <span class="auth-scene-ribbon auth-scene-ribbon--a"></span>
        <span class="auth-scene-ribbon auth-scene-ribbon--b"></span>
        <div class="auth-scene-paper-tree">
          <span class="auth-scene-paper-tree__leaf auth-scene-paper-tree__leaf--1"></span>
          <span class="auth-scene-paper-tree__leaf auth-scene-paper-tree__leaf--2"></span>
          <span class="auth-scene-paper-tree__leaf auth-scene-paper-tree__leaf--3"></span>
          <span class="auth-scene-paper-tree__stem"></span>
        </div>
        <span class="auth-scene-dust auth-scene-dust--1"></span>
        <span class="auth-scene-dust auth-scene-dust--2"></span>
        ${coreTreeMarkup}
      `;
    }

    if (sceneKey === 'aurora-grove') {
      return `
        <span class="auth-scene-aurora auth-scene-aurora--1"></span>
        <span class="auth-scene-aurora auth-scene-aurora--2"></span>
        <span class="auth-scene-aurora auth-scene-aurora--3"></span>
        <div class="auth-scene-line-tree">
          <span class="auth-scene-line-tree__trunk"></span>
          <span class="auth-scene-line-tree__branch auth-scene-line-tree__branch--1"></span>
          <span class="auth-scene-line-tree__branch auth-scene-line-tree__branch--2"></span>
          <span class="auth-scene-line-tree__branch auth-scene-line-tree__branch--3"></span>
        </div>
        <span class="auth-scene-firefly auth-scene-firefly--1"></span>
        <span class="auth-scene-firefly auth-scene-firefly--2"></span>
        <span class="auth-scene-firefly auth-scene-firefly--3"></span>
        ${coreTreeMarkup}
      `;
    }

    if (sceneKey === 'ink-mountain') {
      return `
        <span class="auth-scene-ridge auth-scene-ridge--back"></span>
        <span class="auth-scene-ridge auth-scene-ridge--mid"></span>
        <span class="auth-scene-ridge auth-scene-ridge--front"></span>
        <div class="auth-scene-spire-row">
          <span class="auth-scene-spire auth-scene-spire--1"></span>
          <span class="auth-scene-spire auth-scene-spire--2"></span>
          <span class="auth-scene-spire auth-scene-spire--3"></span>
          <span class="auth-scene-spire auth-scene-spire--4"></span>
        </div>
        <span class="auth-scene-rain auth-scene-rain--1"></span>
        <span class="auth-scene-rain auth-scene-rain--2"></span>
        ${coreTreeMarkup}
      `;
    }

    if (sceneKey === 'petal-orbit') {
      return `
        <span class="auth-scene-ring auth-scene-ring--1"></span>
        <span class="auth-scene-ring auth-scene-ring--2"></span>
        <span class="auth-scene-ring auth-scene-ring--3"></span>
        <div class="auth-scene-bloom">
          <span class="auth-scene-bloom__stem"></span>
          <span class="auth-scene-bloom__bud auth-scene-bloom__bud--1"></span>
          <span class="auth-scene-bloom__bud auth-scene-bloom__bud--2"></span>
          <span class="auth-scene-bloom__bud auth-scene-bloom__bud--3"></span>
        </div>
        <span class="auth-scene-spark auth-scene-spark--1"></span>
        <span class="auth-scene-spark auth-scene-spark--2"></span>
        ${coreTreeMarkup}
      `;
    }

    if (sceneKey === 'canyon-lantern') {
      return `
        <span class="auth-scene-canyon auth-scene-canyon--1"></span>
        <span class="auth-scene-canyon auth-scene-canyon--2"></span>
        <span class="auth-scene-canyon auth-scene-canyon--3"></span>
        <span class="auth-scene-canyon-path"></span>
        <span class="auth-scene-lantern auth-scene-lantern--1"></span>
        <span class="auth-scene-lantern auth-scene-lantern--2"></span>
        <span class="auth-scene-lantern auth-scene-lantern--3"></span>
        ${coreTreeMarkup}
      `;
    }

    if (sceneKey === 'crystal-lake') {
      return `
        <span class="auth-scene-lake-glow"></span>
        <span class="auth-scene-lake-ripple auth-scene-lake-ripple--1"></span>
        <span class="auth-scene-lake-ripple auth-scene-lake-ripple--2"></span>
        <span class="auth-scene-lake-ripple auth-scene-lake-ripple--3"></span>
        <span class="auth-scene-crystal auth-scene-crystal--1"></span>
        <span class="auth-scene-crystal auth-scene-crystal--2"></span>
        <span class="auth-scene-crystal auth-scene-crystal--3"></span>
        ${coreTreeMarkup}
      `;
    }

    if (sceneKey === 'root-cathedral') {
      return `
        <span class="auth-scene-root auth-scene-root--1"></span>
        <span class="auth-scene-root auth-scene-root--2"></span>
        <span class="auth-scene-root auth-scene-root--3"></span>
        <span class="auth-scene-root-trunk"></span>
        <span class="auth-scene-root-glow"></span>
        <span class="auth-scene-root-dot auth-scene-root-dot--1"></span>
        <span class="auth-scene-root-dot auth-scene-root-dot--2"></span>
        ${coreTreeMarkup}
      `;
    }

    if (sceneKey === 'storm-glyph') {
      return `
        <span class="auth-scene-storm-ring auth-scene-storm-ring--1"></span>
        <span class="auth-scene-storm-ring auth-scene-storm-ring--2"></span>
        <span class="auth-scene-storm-ring auth-scene-storm-ring--3"></span>
        <span class="auth-scene-bolt auth-scene-bolt--1"></span>
        <span class="auth-scene-bolt auth-scene-bolt--2"></span>
        <span class="auth-scene-bolt auth-scene-bolt--3"></span>
        <span class="auth-scene-core"></span>
        ${coreTreeMarkup}
      `;
    }

    return `
      <span class="auth-scene-moon-halo"></span>
      <span class="auth-scene-moon"></span>
      <span class="auth-scene-cloud auth-scene-cloud--1"></span>
      <span class="auth-scene-cloud auth-scene-cloud--2"></span>
      <div class="auth-scene-garden">
        <span class="auth-scene-garden__stem auth-scene-garden__stem--1"></span>
        <span class="auth-scene-garden__stem auth-scene-garden__stem--2"></span>
        <span class="auth-scene-garden__stem auth-scene-garden__stem--3"></span>
        <span class="auth-scene-garden__flower auth-scene-garden__flower--1"></span>
        <span class="auth-scene-garden__flower auth-scene-garden__flower--2"></span>
      </div>
      ${coreTreeMarkup}
    `;
  };

  const pickRandomIndex = (max) => {
    if (!Number.isInteger(max) || max <= 0) return 0;
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      const seed = new Uint32Array(1);
      window.crypto.getRandomValues(seed);
      return seed[0] % max;
    }
    return Math.floor(Math.random() * max);
  };

  const renderRandomAuthScene = () => {
    if (!authSceneStage) return null;
    const scene = AUTH_SCENES[pickRandomIndex(AUTH_SCENES.length)];
    if (!scene) return null;

    authSceneStage.className = `auth-tree-stage auth-scene-stage auth-scene-stage--${scene.key}`;
    authSceneStage.innerHTML = buildSceneMarkup(scene.key);
    authSceneStage.dataset.sceneKey = scene.key;

    if (authSceneFamily) authSceneFamily.textContent = scene.family;
    if (authSceneName) authSceneName.textContent = scene.name;
    if (authShell) authShell.dataset.authScene = scene.key;

    activeSceneProfile = {
      ...activeSceneProfile,
      ...scene.profile,
    };

    if (authShell) {
      authShell.style.setProperty('--auth-scene-h', String(scene.hue));
      authShell.style.setProperty('--auth-scene-s', scene.sat);
      authShell.style.setProperty('--auth-scene-a', String(scene.accent));
      authShell.style.setProperty('--auth-scene-energy', String(scene.profile.ambientAmp));
    }

    return scene;
  };

  const trackEvent = (eventName, properties = {}, options = {}) => {
    if (!window.glsoopAnalytics || typeof window.glsoopAnalytics.trackEvent !== 'function') {
      return;
    }
    window.glsoopAnalytics.trackEvent(eventName, properties, options);
  };

  const setFormMessage = (message, type = 'error', focus = false) => {
    if (!feedbackEl) return;
    if (window.glsoopUi && typeof window.glsoopUi.setFeedbackMessage === 'function') {
      window.glsoopUi.setFeedbackMessage(feedbackEl, message, { type, focus });
      return;
    }
    feedbackEl.textContent = message || '';
  };

  const clearFormMessage = () => {
    if (stopRetryCountdown) {
      stopRetryCountdown();
      stopRetryCountdown = null;
    }
    if (!feedbackEl) return;
    if (window.glsoopUi && typeof window.glsoopUi.clearFeedbackMessage === 'function') {
      window.glsoopUi.clearFeedbackMessage(feedbackEl);
      return;
    }
    feedbackEl.textContent = '';
  };

  const clearFieldErrors = () => {
    if (!authUtils || typeof authUtils.clearFieldErrors !== 'function') return;
    authUtils.clearFieldErrors(form);
  };

  const applyFieldErrors = (fieldErrors) => {
    if (!authUtils || typeof authUtils.applyFieldErrors !== 'function') return null;
    return authUtils.applyFieldErrors(form, fieldErrors || {});
  };

  const setAuthShellMotion = (x, y) => {
    if (!authShell) return;
    motionState.pointerX = Math.max(0, Math.min(1, x));
    motionState.pointerY = Math.max(0, Math.min(1, y));

    const { tilt, wind, shift, glow } = activeSceneProfile;
    const px = motionState.pointerX;
    const py = motionState.pointerY;
    const ambientWave = motionState.ambientWave;
    const ambientDrift = motionState.ambientDrift;

    authShell.style.setProperty('--auth-mouse-x', `${Math.round(px * 100)}%`);
    authShell.style.setProperty('--auth-mouse-y', `${Math.round(py * 100)}%`);

    const rotateY = ((px - 0.5) * 4.4 + ambientDrift * 0.82) * tilt;
    const rotateX = ((0.5 - py) * 3.6 + ambientWave * 0.64) * tilt;
    const shiftX = ((px - 0.5) * 18 + ambientDrift * 6.4) * shift;
    const shiftY = ((py - 0.5) * 12 + ambientWave * 3.4) * shift;
    const windAngle = ((px - 0.5) * 8.6 + ambientWave * 3.1) * wind;

    authShell.style.setProperty('--auth-rotate-y', `${rotateY.toFixed(2)}deg`);
    authShell.style.setProperty('--auth-rotate-x', `${rotateX.toFixed(2)}deg`);
    authShell.style.setProperty('--auth-shift-x', `${shiftX.toFixed(1)}px`);
    authShell.style.setProperty('--auth-shift-y', `${shiftY.toFixed(1)}px`);
    authShell.style.setProperty('--auth-wind-angle', `${windAngle.toFixed(2)}deg`);
    authShell.style.setProperty('--auth-wind-soft', `${(windAngle * 0.72).toFixed(2)}deg`);
    authShell.style.setProperty('--auth-wind-strong', `${(windAngle * 1.06).toFixed(2)}deg`);
    authShell.style.setProperty('--auth-wind-trunk', `${(windAngle * 0.4).toFixed(2)}deg`);
    authShell.style.setProperty('--auth-scene-wave', `${(ambientWave * wind * 1.8).toFixed(2)}deg`);
    authShell.style.setProperty('--auth-scene-drift', `${(ambientDrift * shift * 6.2).toFixed(2)}px`);
    authShell.style.setProperty('--auth-scene-glow', `${(0.48 + Math.abs(ambientWave) * 0.12) * glow}`);
  };

  const startAmbientSceneMotion = () => {
    if (!authShell || reducedMotion) return;
    if (ambientRaf) {
      window.cancelAnimationFrame(ambientRaf);
      ambientRaf = 0;
    }
    const phase = Math.random() * Math.PI * 2;

    const tick = (timestamp) => {
      const t = timestamp / 1000;
      const speed = activeSceneProfile.speed || 0.62;
      const amp = activeSceneProfile.ambientAmp || 1;
      motionState.ambientWave = Math.sin(t * speed + phase) * 1.08 * amp;
      motionState.ambientDrift = Math.cos(t * (speed * 0.76) + phase * 0.68) * 0.92 * amp;
      setAuthShellMotion(motionState.pointerX, motionState.pointerY);
      ambientRaf = window.requestAnimationFrame(tick);
    };

    ambientRaf = window.requestAnimationFrame(tick);
  };

  const bindAuthShellParallax = () => {
    if (!authShell || reducedMotion || !canHover) return;
    let raf = 0;
    let nextX = 0.5;
    let nextY = 0.36;

    const flush = () => {
      raf = 0;
      setAuthShellMotion(nextX, nextY);
    };

    const queue = (x, y) => {
      nextX = Math.min(1, Math.max(0, x));
      nextY = Math.min(1, Math.max(0, y));
      if (!raf) {
        raf = window.requestAnimationFrame(flush);
      }
    };

    authShell.addEventListener('pointermove', (event) => {
      const rect = authShell.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      authShell.dataset.authShellActive = '1';
      queue(
        (event.clientX - rect.left) / rect.width,
        (event.clientY - rect.top) / rect.height
      );
    });

    authShell.addEventListener('pointerleave', () => {
      delete authShell.dataset.authShellActive;
      queue(0.5, 0.36);
    });
  };

  const bindFormFieldState = () => {
    const inputs = form.querySelectorAll('.auth-field .gls-input');
    if (!inputs.length) return;

    const syncField = (inputEl) => {
      const field = inputEl.closest('.auth-field');
      if (!field) return;
      const active = document.activeElement === inputEl;
      const filled = Boolean((inputEl.value || '').trim());
      field.classList.toggle('is-active', active);
      field.classList.toggle('is-filled', filled);
    };

    const syncEngaged = () => {
      const focused = document.activeElement && form.contains(document.activeElement);
      form.classList.toggle('is-engaged', Boolean(focused));
    };

    inputs.forEach((inputEl) => {
      syncField(inputEl);
      inputEl.addEventListener('focus', () => {
        syncField(inputEl);
        syncEngaged();
        if (inputEl.name === 'email') {
          setLoginRiveFocusStep(RIVE_FOCUS_EMAIL);
          setLoginRiveTypingFromEmail();
        } else if (inputEl.name === 'pw') {
          setLoginRiveFocusStep(RIVE_FOCUS_PASSWORD);
        }
      });
      inputEl.addEventListener('blur', () => {
        syncField(inputEl);
        syncEngaged();
        window.requestAnimationFrame(syncLoginRiveFocusFromActiveElement);
        if (!authUtils) return;
        if (inputEl.name === 'email') {
          const value = (inputEl.value || '').trim();
          const valid = !value || authUtils.validateEmail(value);
          authUtils.setFieldInvalid(inputEl, !valid);
        }
      });
      inputEl.addEventListener('input', () => {
        syncField(inputEl);
        if (inputEl.name === 'email') {
          setLoginRiveTypingFromEmail();
          setLoginRiveFocusStep(RIVE_FOCUS_EMAIL);
        } else if (inputEl.name === 'pw') {
          setLoginRiveFocusStep(RIVE_FOCUS_PASSWORD);
        }
        if (!authUtils) return;
        authUtils.setFieldInvalid(inputEl, false);
      });
    });

    syncLoginRiveFocusFromActiveElement();
    setLoginRiveTypingFromEmail();
  };

  const isMobileViewport = () =>
    window.matchMedia
      ? window.matchMedia('(max-width: 768px)').matches
      : (window.innerWidth || 1024) <= 768;

  const applyAuthSceneCollapsed = (collapsed) => {
    if (!authShell) return;
    const next = collapsed ? 'true' : 'false';
    authShell.dataset.authSceneCollapsed = next;
    if (authSceneToggleBtn) {
      authSceneToggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      authSceneToggleBtn.textContent = collapsed ? '장면 펼치기' : '장면 접기';
    }
  };

  const bindAuthSceneCollapse = () => {
    if (!authShell || !authSceneToggleBtn) return;
    let wasMobile = isMobileViewport();
    applyAuthSceneCollapsed(wasMobile);

    authSceneToggleBtn.addEventListener('click', () => {
      const collapsed = authShell.dataset.authSceneCollapsed === 'true';
      applyAuthSceneCollapsed(!collapsed);
    });

    window.addEventListener(
      'resize',
      () => {
        const nowMobile = isMobileViewport();
        if (nowMobile === wasMobile) return;
        wasMobile = nowMobile;
        applyAuthSceneCollapsed(nowMobile);
      },
      { passive: true }
    );
  };

  const trackAuthFormVisible = () => {
    if (!form) return;
    if (typeof IntersectionObserver !== 'function') {
      trackEvent(
        'auth_form_visible',
        {
          mobile: isMobileViewport(),
          path: `${window.location.pathname}${window.location.search || ''}`,
        },
        { useBeacon: true }
      );
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.2);
        if (!visible) return;
        observer.disconnect();
        trackEvent(
          'auth_form_visible',
          {
            mobile: isMobileViewport(),
            path: `${window.location.pathname}${window.location.search || ''}`,
          },
          { useBeacon: true }
        );
      },
      { threshold: [0.2] }
    );

    observer.observe(form);
  };

  const triggerFormState = (stateClass) => {
    if (!stateClass) return;
    form.classList.remove('is-login-error', 'is-login-success');
    form.classList.add(stateClass);
    window.setTimeout(() => {
      form.classList.remove(stateClass);
    }, 700);
  };

  const transitionToPostLogin = (redirectTo, submitTrigger, options = {}) => {
    if (!redirectTo) return false;
    const pauseBeforeRedirect = Boolean(options.pauseBeforeRedirect);
    const onPaused = typeof options.onPaused === 'function' ? options.onPaused : null;

    if (successSignalTimer) {
      window.clearTimeout(successSignalTimer);
      successSignalTimer = 0;
    }

    if (successTransitionTimer) {
      window.clearTimeout(successTransitionTimer);
      successTransitionTimer = 0;
    }

    if (reducedMotion || !authShell || !pageBody) {
      if (pauseBeforeRedirect && onPaused) {
        onPaused(() => {
          window.location.href = redirectTo;
        });
        return true;
      }
      window.location.href = redirectTo;
      return false;
    }

    if (ambientRaf) {
      window.cancelAnimationFrame(ambientRaf);
      ambientRaf = 0;
    }

    const sourceAside = authShell.querySelector('.auth-aside');
    if (!sourceAside || typeof sourceAside.getBoundingClientRect !== 'function') {
      if (pauseBeforeRedirect && onPaused) {
        onPaused(() => {
          window.location.href = redirectTo;
        });
        return true;
      }
      window.location.href = redirectTo;
      return false;
    }

    const rect = sourceAside.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      if (pauseBeforeRedirect && onPaused) {
        onPaused(() => {
          window.location.href = redirectTo;
        });
        return true;
      }
      window.location.href = redirectTo;
      return false;
    }

    const triggerButton =
      (submitTrigger && typeof submitTrigger.classList !== 'undefined')
        ? submitTrigger
        : form.querySelector('button[type="submit"]');
    const homeAnchor = document.querySelector('.navbar-brand');
    const homeAnchorRect =
      homeAnchor && typeof homeAnchor.getBoundingClientRect === 'function'
        ? homeAnchor.getBoundingClientRect()
        : null;

    const overlay = document.createElement('div');
    overlay.className = 'login-success-portal-overlay';
    overlay.setAttribute('aria-hidden', 'true');

    const portal = document.createElement('div');
    portal.className = 'login-success-portal';
    portal.style.width = `${rect.width}px`;
    portal.style.height = `${rect.height}px`;

    const portalMistFar = document.createElement('span');
    portalMistFar.className = 'login-success-portal__mist login-success-portal__mist--far';
    portal.appendChild(portalMistFar);

    const portalMistNear = document.createElement('span');
    portalMistNear.className = 'login-success-portal__mist login-success-portal__mist--near';
    portal.appendChild(portalMistNear);

    const cloneAside = sourceAside.cloneNode(true);
    cloneAside.removeAttribute('id');
    cloneAside.querySelectorAll('[id]').forEach((node) => {
      node.removeAttribute('id');
    });
    portal.appendChild(cloneAside);
    overlay.appendChild(portal);

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || rect.width;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || rect.height;
    const targetX =
      homeAnchorRect && homeAnchorRect.width
        ? homeAnchorRect.left + homeAnchorRect.width * 0.5
        : viewportWidth * 0.5;
    const targetY =
      homeAnchorRect && homeAnchorRect.height
        ? homeAnchorRect.top + homeAnchorRect.height * 0.5
        : viewportHeight * 0.5;
    const coverScaleX = viewportWidth / rect.width;
    const coverScaleY = viewportHeight / rect.height;
    const overshootScaleX = coverScaleX * 1.085;
    const overshootScaleY = coverScaleY * 1.085;
    const overshootX = (viewportWidth - rect.width * overshootScaleX) / 2;
    const overshootY = (viewportHeight - rect.height * overshootScaleY) / 2;
    const midScaleX = Math.max(coverScaleX * 0.22, 0.08);
    const midScaleY = Math.max(coverScaleY * 0.22, 0.08);
    const midX = (viewportWidth - rect.width * midScaleX) / 2;
    const midY = (viewportHeight - rect.height * midScaleY) / 2;
    const finalScaleX = Math.max(coverScaleX * 0.0062, 0.0011);
    const finalScaleY = Math.max(coverScaleY * 0.0062, 0.0011);
    const finalX = targetX - (rect.width * finalScaleX * 0.5);
    const finalY = targetY - (rect.height * finalScaleY * 0.5);
    const startBorderRadius = window.getComputedStyle(sourceAside).borderRadius || '22px';
    const startTransform = `translate3d(${rect.left}px, ${rect.top}px, 0) scale3d(1, 1, 1)`;
    const overshootTransform = `translate3d(${overshootX}px, ${overshootY}px, 0) scale3d(${overshootScaleX}, ${overshootScaleY}, 1)`;
    const coverTransform = `translate3d(0px, 0px, 0) scale3d(${coverScaleX}, ${coverScaleY}, 1)`;
    const midTransform = `translate3d(${midX}px, ${midY}px, 0) scale3d(${midScaleX}, ${midScaleY}, 1)`;
    const vanishTransform = `translate3d(${finalX}px, ${finalY}px, 0) scale3d(${finalScaleX}, ${finalScaleY}, 1)`;

    form.classList.remove('is-submitting');
    form.classList.add('is-home-entry-signal');
    if (triggerButton) {
      triggerButton.classList.add('is-home-entry-signal');
      triggerButton.textContent = '숲으로 들어가는 중...';
    }
    pageBody.classList.add('is-login-entry-signaled');
    authShell.dataset.authEvent = 'login-success';
    authShell.dataset.authShellActive = '1';

    let didRedirect = false;
    const finalizeRedirect = () => {
      if (didRedirect) return;
      didRedirect = true;
      if (successTransitionTimer) {
        window.clearTimeout(successTransitionTimer);
        successTransitionTimer = 0;
      }
      window.location.href = redirectTo;
    };

    if (!pauseBeforeRedirect) {
      successTransitionTimer = window.setTimeout(
        finalizeRedirect,
        LOGIN_HOME_SIGNAL_MS + LOGIN_SUCCESS_TRANSITION_MS + 460
      );
    }

    const runPortalTransition = () => {
      if (didRedirect) return;

      pageBody.classList.add('is-login-transitioning');
      portal.style.transform = startTransform;
      portal.style.borderRadius = startBorderRadius;
      portal.style.opacity = '0.94';
      portal.style.filter = 'blur(10px) saturate(0.9) brightness(0.92)';
      pageBody.appendChild(overlay);
      window.setTimeout(() => {
        if (!didRedirect) {
          pageBody.classList.remove('is-login-entry-signaled');
        }
      }, toSuccessDuration(120));

      if (typeof portal.animate !== 'function') {
        if (pauseBeforeRedirect && onPaused) {
          onPaused(finalizeRedirect);
          return;
        }
        finalizeRedirect();
        return;
      }

      overlay.animate(
        [
          { opacity: 0 },
          { opacity: 1, offset: 0.64 },
          { opacity: 0.94 },
        ],
        {
          duration: toSuccessDuration(340),
          easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
          fill: 'forwards',
        }
      );

      const expandAnimation = portal.animate(
        [
          {
            transform: startTransform,
            borderRadius: startBorderRadius,
            opacity: 0.94,
            filter: 'blur(10px) saturate(0.9) brightness(0.92)',
          },
          {
            transform: overshootTransform,
            borderRadius: '0px',
            opacity: 1,
            filter: 'blur(2px) saturate(0.95) brightness(0.96)',
            offset: 0.62,
          },
          {
            transform: coverTransform,
            borderRadius: '0px',
            opacity: 1,
            filter: 'blur(0px) saturate(1) brightness(1)',
          },
        ],
        {
          duration: LOGIN_SUCCESS_EXPAND_MS,
          easing: 'cubic-bezier(0.18, 0.86, 0.24, 1)',
          fill: 'forwards',
        }
      );

      if (typeof portalMistFar.animate === 'function') {
        portalMistFar.animate(
          [
            {
              opacity: 0,
              transform: 'translate3d(-16%, 12%, 0) scale(1.06)',
            },
            {
              opacity: 0.34,
              transform: 'translate3d(8%, -4%, 0) scale(1.24)',
              offset: 0.48,
            },
            {
              opacity: 0.12,
              transform: 'translate3d(20%, -12%, 0) scale(1.42)',
            },
          ],
          {
            duration: LOGIN_SUCCESS_EXPAND_MS,
            easing: 'cubic-bezier(0.18, 0.86, 0.24, 1)',
            fill: 'forwards',
          }
        );
      }

      if (typeof portalMistNear.animate === 'function') {
        portalMistNear.animate(
          [
            {
              opacity: 0,
              transform: 'translate3d(12%, 6%, 0) scale(1.02)',
            },
            {
              opacity: 0.54,
              transform: 'translate3d(-8%, -8%, 0) scale(1.22)',
              offset: 0.44,
            },
            {
              opacity: 0.16,
              transform: 'translate3d(-16%, -14%, 0) scale(1.28)',
            },
          ],
          {
            duration: LOGIN_SUCCESS_EXPAND_MS,
            easing: 'cubic-bezier(0.18, 0.86, 0.24, 1)',
            fill: 'forwards',
          }
        );
      }

      const playCollapse = () => {
        const collapseAnimation = portal.animate(
          [
            {
              transform: coverTransform,
              borderRadius: '0px',
              opacity: 1,
              filter: 'blur(0px) saturate(1) brightness(1)',
            },
            {
              transform: midTransform,
              borderRadius: '0px',
              opacity: 0.92,
              filter: 'blur(0px) saturate(1) brightness(1)',
              offset: 0.56,
            },
            {
              transform: vanishTransform,
              borderRadius: '0px',
              opacity: 0.08,
              filter: 'blur(0px) saturate(1) brightness(1)',
            },
          ],
          {
            duration: LOGIN_SUCCESS_COLLAPSE_MS,
            easing: 'cubic-bezier(0.7, 0.01, 0.25, 1)',
            fill: 'forwards',
          }
        );

        if (typeof portalMistFar.animate === 'function') {
          portalMistFar.animate(
            [
              {
                opacity: 0.14,
                transform: 'translate3d(18%, -10%, 0) scale(1.32)',
              },
              {
                opacity: 0.42,
                transform: 'translate3d(-10%, 6%, 0) scale(1.04)',
                offset: 0.34,
              },
              {
                opacity: 0,
                transform: 'translate3d(6%, -2%, 0) scale(0.84)',
              },
            ],
            {
              duration: LOGIN_SUCCESS_COLLAPSE_MS,
              easing: 'cubic-bezier(0.7, 0.01, 0.25, 1)',
              fill: 'forwards',
            }
          );
        }

        if (typeof portalMistNear.animate === 'function') {
          portalMistNear.animate(
            [
              {
                opacity: 0.2,
                transform: 'translate3d(-18%, -10%, 0) scale(1.2)',
              },
              {
                opacity: 0.52,
                transform: 'translate3d(10%, 4%, 0) scale(1.08)',
                offset: 0.32,
              },
              {
                opacity: 0,
                transform: 'translate3d(-2%, -2%, 0) scale(0.76)',
              },
            ],
            {
              duration: LOGIN_SUCCESS_COLLAPSE_MS,
              easing: 'cubic-bezier(0.7, 0.01, 0.25, 1)',
              fill: 'forwards',
            }
          );
        }

        collapseAnimation.onfinish = finalizeRedirect;
        collapseAnimation.oncancel = finalizeRedirect;
      };

      const playHold = (afterHold) => {
        const holdAnimation = portal.animate(
          [
            {
              transform: coverTransform,
              borderRadius: '0px',
              opacity: 1,
              filter: 'blur(0px) saturate(1) brightness(1)',
            },
            {
              transform: coverTransform,
              borderRadius: '0px',
              opacity: 1,
              filter: 'blur(0px) saturate(1) brightness(1)',
            },
          ],
          {
            duration: LOGIN_SUCCESS_HOLD_MS,
            easing: 'linear',
            fill: 'forwards',
          }
        );
        holdAnimation.onfinish = afterHold;
        holdAnimation.oncancel = afterHold;
      };

      const pauseAndAwaitConfirm = () => {
        if (didRedirect) return;
        portal.style.transform = coverTransform;
        portal.style.borderRadius = '0px';
        portal.style.opacity = '1';
        portal.style.filter = 'blur(0px) saturate(1) brightness(1)';
        if (onPaused) {
          onPaused(finalizeRedirect);
        }
      };

      expandAnimation.onfinish = () => {
        if (pauseBeforeRedirect) {
          playHold(pauseAndAwaitConfirm);
          return;
        }
        playHold(playCollapse);
      };
      expandAnimation.oncancel = finalizeRedirect;
    };

    if (LOGIN_HOME_SIGNAL_MS > 0) {
      successSignalTimer = window.setTimeout(() => {
        successSignalTimer = 0;
        runPortalTransition();
      }, LOGIN_HOME_SIGNAL_MS);
    } else {
      runPortalTransition();
    }

    return true;
  };

  const startPostLoginRedirect = (redirectTo, submitTrigger, options = {}) => {
    redirectingAfterSuccess = transitionToPostLogin(redirectTo, submitTrigger, options);
  };

  const getLocalDateKey = () => {
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      return formatter.format(new Date());
    } catch (error) {
      const now = new Date();
      const yyyy = String(now.getFullYear());
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
  };

  const hasRememberNoticeShownToday = () => {
    try {
      return window.localStorage.getItem(REMEMBER_NOTICE_ONCE_PER_DAY_KEY) === getLocalDateKey();
    } catch (error) {
      return false;
    }
  };

  const markRememberNoticeShownToday = () => {
    try {
      window.localStorage.setItem(REMEMBER_NOTICE_ONCE_PER_DAY_KEY, getLocalDateKey());
    } catch (error) {
      // localStorage 사용 불가 환경에서도 로그인 흐름은 계속 진행
    }
  };

  const clearRememberFallbackTimer = () => {
    if (!rememberModalFallbackTimer) return;
    window.clearTimeout(rememberModalFallbackTimer);
    rememberModalFallbackTimer = 0;
  };

  const closeRememberLoginModal = () => {
    clearRememberFallbackTimer();
    if (!rememberLoginModalEl) return;
    rememberLoginModalEl.classList.remove('show', 'is-open', 'is-flex-visible');
    rememberLoginModalEl.setAttribute('aria-hidden', 'true');
    rememberLoginModalEl.removeAttribute('aria-modal');
    rememberLoginModalEl.setAttribute('hidden', '');
    document.body.classList.remove('gls-modal-open');
  };

  const openRememberLoginModal = (onConfirm) => {
    if (!rememberLoginModalEl || !rememberLoginConfirmBtn || typeof onConfirm !== 'function') return false;
    pendingRememberRedirect = () => {
      markRememberNoticeShownToday();
      onConfirm();
    };
    rememberLoginModalEl.removeAttribute('hidden');
    rememberLoginModalEl.classList.add('show', 'is-open', 'is-flex-visible');
    rememberLoginModalEl.setAttribute('aria-hidden', 'false');
    rememberLoginModalEl.setAttribute('aria-modal', 'true');
    document.body.classList.add('gls-modal-open');
    window.setTimeout(() => {
      rememberLoginConfirmBtn.focus();
    }, 0);

    rememberModalFallbackTimer = window.setTimeout(() => {
      if (typeof pendingRememberRedirect !== 'function') return;
      closeRememberLoginModal();
      const runRedirect = pendingRememberRedirect;
      pendingRememberRedirect = null;
      runRedirect();
    }, REMEMBER_MODAL_FALLBACK_MS);

    return true;
  };

  if (rememberLoginConfirmBtn) {
    rememberLoginConfirmBtn.addEventListener('click', (event) => {
      event.preventDefault();
      if (typeof pendingRememberRedirect !== 'function') return;
      closeRememberLoginModal();
      const runRedirect = pendingRememberRedirect;
      pendingRememberRedirect = null;
      runRedirect();
    });
  }

  const selectedScene = renderRandomAuthScene();
  setAuthShellMotion(motionState.pointerX, motionState.pointerY);
  bindAuthShellParallax();
  startAmbientSceneMotion();
  bindAuthSceneCollapse();
  bindFormFieldState();
  trackAuthFormVisible();
  trackEvent('login_view', {
    scene_key: selectedScene ? selectedScene.key : null,
  });

  window.addEventListener('pagehide', () => {
    if (ambientRaf) {
      window.cancelAnimationFrame(ambientRaf);
      ambientRaf = 0;
    }
    if (successSignalTimer) {
      window.clearTimeout(successSignalTimer);
      successSignalTimer = 0;
    }
    if (successTransitionTimer) {
      window.clearTimeout(successTransitionTimer);
      successTransitionTimer = 0;
    }
    clearRememberFallbackTimer();
  });

  if (emailFromQuery && form.email && !form.email.value) {
    form.email.value = emailFromQuery;
    const pwInput = form.querySelector('input[name="pw"]');
    if (pwInput) {
      pwInput.focus();
    }
    trackEvent('login_prefilled_from_query', {
      source: source || null,
    });
  }
  syncLoginRiveFocusFromActiveElement();
  setLoginRiveTypingFromEmail();

  // 폼 제출 이벤트 리스너 등록
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); // 기본 폼 제출(페이지 새로고침) 막기
    if (submitting || submitAnimationInFlight) return;
    const submitToken = ++submitTokenSequence;
    activeSubmitToken = submitToken;
    submitAnimationInFlight = true;
    const submitBtn = form.querySelector('button[type="submit"]');

    try {
      clearFormMessage();
      clearFieldErrors();

      trackEvent('login_submit_clicked', {
        has_next: Boolean(safeNextUrl),
        source: source || null,
      });

      // 폼 안의 input name="email", name="pw"에서 값 읽기
      const email = form.email.value.trim();
      const pw = form.pw.value.trim();

      // 이메일 또는 비밀번호가 비어 있으면 경고
      if (!email || !pw) {
        trackEvent('login_validation_error', {
          reason: 'required_fields_missing',
        });
        completeLoginRiveSubmitResult(false);
        setFormMessage('이메일과 비밀번호를 모두 입력하세요.', 'error', true);
        if (!email && form.email) {
          if (authUtils) authUtils.setFieldInvalid(form.email, true);
          form.email.focus();
        } else if (!pw && form.pw) {
          if (authUtils) authUtils.setFieldInvalid(form.pw, true);
          form.pw.focus();
        }
        return;
      }

      if (authUtils && !authUtils.validateEmail(email)) {
        trackEvent('login_validation_error', {
          reason: 'invalid_email_format',
        });
        completeLoginRiveSubmitResult(false);
        authUtils.setFieldInvalid(form.email, true);
        setFormMessage('이메일 형식을 확인해주세요.', 'error', true);
        if (form.email) form.email.focus();
        return;
      }

      submitting = true;
      form.classList.remove('is-login-error', 'is-login-success');
      form.classList.add('is-submitting');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.originalText = submitBtn.dataset.originalText || submitBtn.textContent;
        submitBtn.textContent = '로그인 중...';
      }

      const minVisualTimer = delay(MIN_SUBMIT_VISUAL_MS);
      const apiRequest = (async () => {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, pw }),
        });
        const data = await res.json().catch(() => ({}));
        return { res, data };
      })();

      const settled = await Promise.allSettled([apiRequest, minVisualTimer]);
      if (submitToken !== activeSubmitToken) return;

      const apiResult = settled[0];
      if (apiResult.status === 'rejected') {
        throw apiResult.reason;
      }

      const { res, data } = apiResult.value;

      // HTTP 응답도 OK이고, 응답 JSON의 ok도 true인 경우 "로그인 성공"으로 간주
      // 로그인 성공 후 이동
      if (res.ok && data.ok) {
        // 도토리 드롭은 로그인 성공(자격증명 유효)일 때만 실행하고,
        // 모션이 보이도록 짧게 대기한 뒤 전환한다.
        await playLoginRiveSubmitAttemptAndWait();
        if (submitToken !== activeSubmitToken) return;
        completeLoginRiveSubmitResult(true);
        form.classList.add('is-login-success');
        clearFieldErrors();
        setFormMessage(data.message || '로그인에 성공했습니다.', 'success');
        const redirectTo = safeNextUrl
          || (source === 'verify-email' ? '/html/editor.html' : '/html/mypage.html');
        // 안전장치: 내부 경로만 허용
        trackEvent(
          'login_success',
          {
            redirect_to: redirectTo,
            transition_ms: LOGIN_SUCCESS_TRANSITION_MS,
            min_visual_ms: MIN_SUBMIT_VISUAL_MS,
          },
          { useBeacon: true }
        );
        const rememberEnabled = Boolean(data && data.remember_me);
        const rememberNoticeRequired = Boolean(data && data.remember_notice_required);
        const isDefaultMypageRedirect = /^\/html\/mypage(?:\.html)?(?:$|\?)/.test(redirectTo);
        const shouldShowRememberNotice =
          rememberEnabled &&
          rememberNoticeRequired &&
          isDefaultMypageRedirect &&
          !hasRememberNoticeShownToday();

        if (shouldShowRememberNotice) {
          trackEvent('login_remember_notice_shown', {
            redirect_to: redirectTo,
            remember_me: rememberEnabled,
          });
          startPostLoginRedirect(redirectTo, submitBtn, {
            pauseBeforeRedirect: true,
            onPaused: (continueRedirect) => {
              if (!openRememberLoginModal(continueRedirect)) {
                continueRedirect();
              }
            },
          });
          return;
        }
        startPostLoginRedirect(redirectTo, submitBtn);
        return;
      }

      completeLoginRiveSubmitResult(false);
      triggerFormState('is-login-error');
      trackEvent('login_error', {
        status: res.status || null,
        has_message: Boolean(data && data.message),
        code: data && data.code ? data.code : null,
      });
      const errorMessage =
        authUtils && typeof authUtils.buildErrorMessage === 'function'
          ? authUtils.buildErrorMessage({
              code: data && data.code,
              message: data && data.message,
              retryAfter: null,
            })
          : data.message || '로그인에 실패했습니다.';
      const firstInvalid = applyFieldErrors(data && data.field_errors);
      setFormMessage(errorMessage, 'error', true);

      const retryAfter = Number(data && data.retry_after);
      if (authUtils && retryAfter > 0 && feedbackEl) {
        if (stopRetryCountdown) {
          stopRetryCountdown();
        }
        stopRetryCountdown = authUtils.startRetryCountdown(feedbackEl, retryAfter, (remaining) => {
          setFormMessage(
            `${errorMessage} (${remaining}초 후 재시도)`,
            'error',
            false
          );
        });
      }

      if (firstInvalid && typeof firstInvalid.focus === 'function') {
        firstInvalid.focus();
      } else if (authUtils && typeof authUtils.focusFirstInvalid === 'function') {
        authUtils.focusFirstInvalid(form);
      }
    } catch (err) {
      // 네트워크 에러 등 예외 처리
      console.error(err);
      completeLoginRiveSubmitResult(false);
      triggerFormState('is-login-error');
      trackEvent('login_error', {
        reason: 'network_error',
      });
      setFormMessage('로그인 중 오류가 발생했습니다.', 'error', true);
    } finally {
      if (submitToken !== activeSubmitToken) return;
      activeSubmitToken = 0;
      submitAnimationInFlight = false;

      if (redirectingAfterSuccess) return;
      submitting = false;
      form.classList.remove('is-submitting');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = submitBtn.dataset.originalText || '로그인';
      }
    }
  });
});
