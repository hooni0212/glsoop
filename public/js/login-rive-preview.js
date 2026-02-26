// public/js/login-rive-preview.js
// 로그인 페이지 전체 배경 Rive + 상태머신 브릿지

(function initLoginRivePreview() {
  const canvas = document.getElementById('loginPreviewRiveCanvas');
  let statusBadge = document.getElementById('riveStatusBadge');
  const previewForm = document.getElementById('loginPreviewForm');
  const previewMessage = document.getElementById('loginPreviewMessage');

  if (!canvas) return;

  const params = new URLSearchParams(window.location.search);
  const debugMode = params.get('riveDebug') === '1';
  const autoRunInputDemo = params.get('riveDemo') === '1';
  const RIVE_SRC_CANDIDATES = [
    canvas.dataset.riveSrc || '',
    '/rive/glsoop_login.riv',
    '/rive/login-preview.riv',
  ].filter(Boolean);
  const RIVE_RUNTIME_CANDIDATES = [
    {
      scriptUrl: 'https://cdn.jsdelivr.net/npm/@rive-app/canvas@2.31.6',
      wasmUrl: 'https://cdn.jsdelivr.net/npm/@rive-app/canvas@2.31.6/rive.wasm',
    },
    {
      scriptUrl: 'https://unpkg.com/@rive-app/canvas@2.31.6/rive.js',
      wasmUrl: 'https://unpkg.com/@rive-app/canvas@2.31.6/rive.wasm',
    },
  ];

  const PLAYBACK_ANIMATIONS = ['idle', 'blink', 'left_leaf', 'right_leaf'];
  const STATE_MACHINE_CANDIDATES = ['SignInSquirrelMachin', 'SignInSquirrelMachine', 'State Machine 1'];

  const FOCUS_IDLE = 0;
  const FOCUS_ID = 1;
  const FOCUS_PW = 2;
  const FOCUS_SUBMIT = 3;

  const ENTRY_INTRO_MS = 920;
  const SUBMIT_ATTEMPT_WAIT_MS = 1200;

  const FALLING_ANIMATION_CANDIDATES = ['falling'];
  const FRAME_IN_ANIMATION_CANDIDATES = ['frame_in'];
  const ID_ACTION_ANIMATION_CANDIDATES = ['id_action'];
  const PW_ACTION_ANIMATION_CANDIDATES = ['pw_action'];

  const desiredState = {
    focusStep: FOCUS_IDLE,
    typingProgress: 0,
    blinkWeight: 1,
  };

  let riveInstance = null;
  let activeRiveSrc = null;
  let activeStateMachineName = null;
  let stateInputs = Object.create(null);
  let availableAnimations = new Set();
  let fallbackMode = 'none';
  let fallbackReason = '';
  let fallbackEventTracked = false;
  let introInProgress = false;
  let queuedFocusStep = null;
  let latestSubmitResult = 0;
  let submitAttemptCount = 0;
  let lastSubmitAttemptFocusStep = FOCUS_IDLE;
  let submitVisualPendingReset = false;

  let demoTimers = [];
  let entryIntroTimer = 0;
  let submitAttemptTimer = 0;
  let submitAttemptWaitPromise = null;

  const capability = {
    hasStateMachine: false,
    inputs: {
      focus: false,
      typing: false,
      blinkWeight: false,
      result: false,
      submitTrigger: false,
      pwAction: false,
    },
    animations: {
      falling: false,
      frameIn: false,
      idAction: false,
      pwAction: false,
    },
  };

  const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
  const clampFocus = (value) => Math.max(FOCUS_IDLE, Math.min(FOCUS_SUBMIT, Number(value) || 0));

  const stringifyError = (errorLike) => {
    if (!errorLike) return 'unknown error';
    if (typeof errorLike === 'string') return errorLike;
    if (typeof errorLike.message === 'string' && errorLike.message) return errorLike.message;
    try {
      return JSON.stringify(errorLike);
    } catch (error) {
      return String(errorLike);
    }
  };

  const trackRiveEvent = (eventName, properties = {}) => {
    if (!window.glsoopAnalytics || typeof window.glsoopAnalytics.trackEvent !== 'function') return;
    window.glsoopAnalytics.trackEvent(eventName, properties, { useBeacon: true });
  };

  const ensureStatusBadge = () => {
    if (statusBadge) return statusBadge;
    const screen = canvas.closest('.login-preview-screen');
    if (!screen) return null;
    statusBadge = document.createElement('p');
    statusBadge.id = 'riveStatusBadge';
    statusBadge.className = 'login-preview-status';
    statusBadge.setAttribute('role', 'status');
    statusBadge.setAttribute('aria-live', 'polite');
    statusBadge.hidden = true;
    screen.appendChild(statusBadge);
    return statusBadge;
  };

  const setStatus = (text, tone) => {
    if (!debugMode) {
      if (statusBadge) statusBadge.hidden = true;
      return;
    }
    const badge = ensureStatusBadge();
    if (!badge) return;
    badge.hidden = false;
    badge.textContent = text;
    badge.classList.remove('is-ready', 'is-error');
    if (tone === 'ready') badge.classList.add('is-ready');
    if (tone === 'error') badge.classList.add('is-error');
  };

  const updateCapabilityMap = () => {
    capability.hasStateMachine = Boolean(activeStateMachineName);
    capability.inputs.focus = Boolean(stateInputs.focus);
    capability.inputs.typing = Boolean(stateInputs.typing);
    capability.inputs.blinkWeight = Boolean(stateInputs.blinkWeight);
    capability.inputs.result = Boolean(stateInputs.result);
    capability.inputs.submitTrigger = Boolean(stateInputs.sumit || stateInputs.submit);
    capability.inputs.pwAction = Boolean(stateInputs.pw_action);

    capability.animations.falling = availableAnimations.has('falling');
    capability.animations.frameIn = availableAnimations.has('frame_in');
    capability.animations.idAction = availableAnimations.has('id_action');
    capability.animations.pwAction = availableAnimations.has('pw_action');
  };

  const setFallback = (mode, reason = '') => {
    fallbackMode = mode || 'unknown';
    fallbackReason = reason || '';

    if (!fallbackEventTracked) {
      fallbackEventTracked = true;
      trackRiveEvent('login_rive_fallback_entered', {
        mode: fallbackMode,
        reason: fallbackReason || null,
        src: activeRiveSrc || null,
      });
    }

    if (debugMode) {
      const reasonSuffix = fallbackReason ? ` (${fallbackReason})` : '';
      setStatus(`Rive fallback: ${fallbackMode}${reasonSuffix}`, 'error');
    }
  };

  const clearFallback = () => {
    fallbackMode = 'none';
    fallbackReason = '';
  };

  const clearDemoTimers = () => {
    if (!demoTimers.length) return;
    demoTimers.forEach((timerId) => window.clearTimeout(timerId));
    demoTimers = [];
  };

  const cleanupRive = () => {
    clearDemoTimers();
    if (entryIntroTimer) {
      window.clearTimeout(entryIntroTimer);
      entryIntroTimer = 0;
    }
    if (submitAttemptTimer) {
      window.clearTimeout(submitAttemptTimer);
      submitAttemptTimer = 0;
    }
    submitAttemptWaitPromise = null;

    introInProgress = false;
    queuedFocusStep = null;
    submitVisualPendingReset = false;

    if (riveInstance && typeof riveInstance.cleanup === 'function') {
      riveInstance.cleanup();
    }

    riveInstance = null;
    activeStateMachineName = null;
    stateInputs = Object.create(null);
    availableAnimations = new Set();
    updateCapabilityMap();
  };

  const scheduleDemoStep = (delayMs, callback) => {
    const timerId = window.setTimeout(() => {
      demoTimers = demoTimers.filter((id) => id !== timerId);
      callback();
    }, Math.max(0, Number(delayMs) || 0));
    demoTimers.push(timerId);
    return timerId;
  };

  const resizeSurface = () => {
    if (!riveInstance || typeof riveInstance.resizeDrawingSurfaceToCanvas !== 'function') return;
    riveInstance.resizeDrawingSurfaceToCanvas();
  };

  const loadScript = (src) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`script load failed: ${src}`));
    document.head.appendChild(script);
  });

  const ensureRiveRuntime = async () => {
    if (window.rive && typeof window.rive.Rive === 'function') {
      return RIVE_RUNTIME_CANDIDATES[0];
    }

    for (const candidate of RIVE_RUNTIME_CANDIDATES) {
      try {
        await loadScript(candidate.scriptUrl);
        if (window.rive && typeof window.rive.Rive === 'function') {
          return candidate;
        }
      } catch (error) {
        // Try next runtime candidate.
      }
    }

    return null;
  };

  const probeRiveSource = async (src) => {
    try {
      const headResponse = await fetch(src, { method: 'HEAD', cache: 'no-store' });
      if (headResponse.ok) {
        return true;
      }
      if (headResponse.status !== 405 && headResponse.status !== 501) {
        return false;
      }
    } catch (error) {
      // Fallback to GET check.
    }

    try {
      const getResponse = await fetch(src, { method: 'GET', cache: 'no-store' });
      return getResponse.ok;
    } catch (error) {
      return false;
    }
  };

  const resolveRiveSrc = async () => {
    for (const src of RIVE_SRC_CANDIDATES) {
      const reachable = await probeRiveSource(src);
      if (reachable) return src;
    }
    return null;
  };

  const discoverStateMachineNames = () => {
    const names = [];

    if (Array.isArray(riveInstance && riveInstance.stateMachineNames)) {
      names.push(...riveInstance.stateMachineNames);
    }

    const contents = riveInstance && riveInstance.contents;
    if (contents && Array.isArray(contents.artboards)) {
      for (const artboard of contents.artboards) {
        if (!artboard || !Array.isArray(artboard.stateMachines)) continue;
        for (const machine of artboard.stateMachines) {
          if (!machine) continue;
          if (typeof machine === 'string') names.push(machine);
          if (machine && typeof machine.name === 'string') names.push(machine.name);
        }
      }
    }

    return [...new Set(names)].filter(Boolean);
  };

  const discoverAnimationNames = () => {
    const names = [];

    if (Array.isArray(riveInstance && riveInstance.animationNames)) {
      names.push(...riveInstance.animationNames);
    }

    const contents = riveInstance && riveInstance.contents;
    if (contents && Array.isArray(contents.artboards)) {
      for (const artboard of contents.artboards) {
        if (!artboard || !Array.isArray(artboard.animations)) continue;
        names.push(...artboard.animations);
      }
    }

    return [...new Set(names)].filter(Boolean);
  };

  const getInput = (candidates) => {
    for (const name of candidates) {
      if (stateInputs[name]) return stateInputs[name];
    }
    return null;
  };

  const setInputNumber = (candidates, value) => {
    const input = getInput(candidates);
    if (!input) return false;
    input.value = Number(value) || 0;
    return true;
  };

  const setInputBoolean = (candidates, value) => {
    const input = getInput(candidates);
    if (!input) return false;
    input.value = Boolean(value);
    return true;
  };

  const fireInputTrigger = (candidates) => {
    const input = getInput(candidates);
    if (!input || typeof input.fire !== 'function') return false;
    input.fire();
    return true;
  };

  const playFirstAvailableAnimation = (nameCandidates) => {
    if (!riveInstance || typeof riveInstance.play !== 'function') return false;
    for (const name of nameCandidates) {
      if (!availableAnimations.has(name)) continue;
      try {
        riveInstance.play(name);
        return true;
      } catch (error) {
        // Try next animation candidate.
      }
    }
    return false;
  };

  const applyDesiredState = (options = {}) => {
    const force = Boolean(options.force);
    if (introInProgress && !force) return false;

    const focusStep = clampFocus(desiredState.focusStep);
    setInputNumber(['focus'], focusStep);
    setInputNumber(['typing'], clamp01(desiredState.typingProgress));
    setInputNumber(['blinkWeight'], clamp01(desiredState.blinkWeight));
    setInputBoolean(['pw_action'], focusStep === FOCUS_PW);

    return true;
  };

  const tryResetSubmitVisualOnRetry = (focusStep) => {
    if (!submitVisualPendingReset) return false;
    if (focusStep !== FOCUS_ID && focusStep !== FOCUS_PW) return false;

    // Submit 시도 후 재입력으로 복귀할 때는 해당 액션을 1회 실행해
    // 도토리/포즈 잔상을 정리한다.
    if (focusStep === FOCUS_ID) {
      playFirstAvailableAnimation(ID_ACTION_ANIMATION_CANDIDATES);
    } else {
      playFirstAvailableAnimation(PW_ACTION_ANIMATION_CANDIDATES);
    }
    latestSubmitResult = 0;
    setInputNumber(['result'], 0);
    submitVisualPendingReset = false;
    return true;
  };

  const setFocusStep = (step, options = {}) => {
    const force = Boolean(options.force);
    const clamped = clampFocus(step);

    desiredState.focusStep = clamped;

    if (introInProgress && !force) {
      queuedFocusStep = clamped;
      return false;
    }

    const applied = applyDesiredState({ force });
    if (applied) {
      tryResetSubmitVisualOnRetry(clamped);
    }
    return applied;
  };

  const setFocusTarget = (target) => {
    if (target === 'email') return setFocusStep(FOCUS_ID);
    if (target === 'pw' || target === 'password') return setFocusStep(FOCUS_PW);
    return setFocusStep(FOCUS_IDLE);
  };

  const beginSubmitAttempt = () => {
    setFocusStep(FOCUS_SUBMIT, { force: true });
    submitAttemptCount += 1;
    lastSubmitAttemptFocusStep = FOCUS_SUBMIT;
    submitVisualPendingReset = true;
    const firedSubmitTrigger = fireInputTrigger(['sumit', 'submit']);
    if (!firedSubmitTrigger) {
      // 상태머신 트리거가 없을 때만 애니메이션 단독 폴백을 사용한다.
      playFirstAvailableAnimation(FALLING_ANIMATION_CANDIDATES);
    }

    trackRiveEvent('login_rive_submit_attempt_started', {
      has_submit_trigger: capability.inputs.submitTrigger,
      submit_trigger_fired: Boolean(firedSubmitTrigger),
      has_falling_animation: capability.animations.falling,
      fallback_mode: fallbackMode,
    });

    return true;
  };

  const completeSubmitResult = (success) => {
    latestSubmitResult = success ? 1 : 0;
    setInputNumber(['result'], latestSubmitResult);

    trackRiveEvent('login_rive_submit_result_applied', {
      success: Boolean(success),
      has_result_input: capability.inputs.result,
      fallback_mode: fallbackMode,
    });

    return true;
  };

  const waitForSubmitAttempt = (waitMs = SUBMIT_ATTEMPT_WAIT_MS) => {
    const ms = Math.max(0, Number(waitMs) || SUBMIT_ATTEMPT_WAIT_MS);
    if (submitAttemptWaitPromise) {
      return submitAttemptWaitPromise;
    }

    submitAttemptWaitPromise = new Promise((resolve) => {
      submitAttemptTimer = window.setTimeout(() => {
        submitAttemptTimer = 0;
        submitAttemptWaitPromise = null;
        resolve(true);
      }, ms);
    });

    return submitAttemptWaitPromise;
  };

  const playSubmitAttemptAndWait = (waitMs = SUBMIT_ATTEMPT_WAIT_MS) => {
    beginSubmitAttempt();
    return waitForSubmitAttempt(waitMs);
  };

  const startEntryIntro = () => {
    if (entryIntroTimer) {
      window.clearTimeout(entryIntroTimer);
      entryIntroTimer = 0;
    }

    introInProgress = true;
    queuedFocusStep = null;

    desiredState.focusStep = FOCUS_IDLE;
    desiredState.typingProgress = 0;
    desiredState.blinkWeight = 1;
    applyDesiredState({ force: true });

    playFirstAvailableAnimation(FRAME_IN_ANIMATION_CANDIDATES);

    entryIntroTimer = window.setTimeout(() => {
      entryIntroTimer = 0;
      introInProgress = false;

      if (queuedFocusStep !== null) {
        const step = queuedFocusStep;
        queuedFocusStep = null;
        setFocusStep(step, { force: true });
      } else {
        applyDesiredState({ force: true });
      }
    }, ENTRY_INTRO_MS);
  };

  const runFocusSweep = (stepMs = 520) => {
    clearDemoTimers();

    const steps = [FOCUS_IDLE, FOCUS_ID, FOCUS_PW, FOCUS_SUBMIT, FOCUS_IDLE];
    steps.forEach((step, index) => {
      scheduleDemoStep(index * Math.max(80, Number(stepMs) || 520), () => {
        setFocusStep(step, { force: true });
      });
    });

    return true;
  };

  const previewAllAnimations = (stepMs = 760) => {
    clearDemoTimers();

    const timeline = [
      () => {
        setFocusStep(FOCUS_IDLE, { force: true });
        desiredState.typingProgress = 0;
        applyDesiredState({ force: true });
        completeSubmitResult(false);
        playFirstAvailableAnimation(FRAME_IN_ANIMATION_CANDIDATES);
      },
      () => {
        setFocusStep(FOCUS_ID, { force: true });
        desiredState.typingProgress = 0.4;
        applyDesiredState({ force: true });
        playFirstAvailableAnimation(ID_ACTION_ANIMATION_CANDIDATES);
      },
      () => {
        setFocusStep(FOCUS_PW, { force: true });
        desiredState.typingProgress = 0.9;
        applyDesiredState({ force: true });
        playFirstAvailableAnimation(PW_ACTION_ANIMATION_CANDIDATES);
      },
      () => {
        beginSubmitAttempt();
        completeSubmitResult(false);
      },
      () => {
        completeSubmitResult(true);
      },
      () => {
        setFocusStep(FOCUS_IDLE, { force: true });
        desiredState.typingProgress = 0;
        applyDesiredState({ force: true });
        completeSubmitResult(false);
      },
    ];

    timeline.forEach((step, index) => {
      scheduleDemoStep(index * Math.max(120, Number(stepMs) || 760), step);
    });

    return true;
  };

  const setupStateMachineBridge = () => {
    activeStateMachineName = null;
    stateInputs = Object.create(null);
    availableAnimations = new Set(discoverAnimationNames());

    const discoveredStateMachines = discoverStateMachineNames();
    const candidates = [...new Set([...STATE_MACHINE_CANDIDATES, ...discoveredStateMachines])].filter(Boolean);

    if (riveInstance && typeof riveInstance.stateMachineInputs === 'function') {
      for (const name of candidates) {
        if (typeof riveInstance.play === 'function') {
          try {
            riveInstance.play(name);
          } catch (error) {
            // Try next candidate.
          }
        }

        const inputs = riveInstance.stateMachineInputs(name);
        if (!Array.isArray(inputs) || !inputs.length) continue;

        activeStateMachineName = name;
        for (const input of inputs) {
          if (!input || !input.name) continue;
          stateInputs[input.name] = input;
        }
        break;
      }
    }

    if (!activeStateMachineName && discoveredStateMachines.length) {
      activeStateMachineName = discoveredStateMachines[0];
    }

    if (!Object.keys(stateInputs).length && typeof riveInstance?.play === 'function') {
      try {
        riveInstance.play(PLAYBACK_ANIMATIONS);
      } catch (error) {
        // Keep animation-only fallback.
      }
    }

    updateCapabilityMap();

    if (!capability.hasStateMachine) {
      setFallback('state_machine_missing', 'state-machine input unavailable');
    } else {
      clearFallback();
      setStatus(`Rive 상태머신 연결 완료 (${activeStateMachineName})`, 'ready');
    }

    applyDesiredState({ force: true });

    return capability.hasStateMachine || availableAnimations.size > 0;
  };

  const bridge = {
    beginSubmitAttempt() {
      return beginSubmitAttempt();
    },
    completeSubmitResult(success) {
      return completeSubmitResult(Boolean(success));
    },
    setFocusStep(step) {
      return setFocusStep(step);
    },
    setTypingProgress(progress) {
      desiredState.typingProgress = clamp01(progress);
      applyDesiredState();
      return true;
    },
    setBlinkWeight(weight) {
      desiredState.blinkWeight = clamp01(weight);
      applyDesiredState();
      return true;
    },

    // Legacy compatibility methods
    setFocus(target) {
      return setFocusTarget(target);
    },
    setFocusValue(value) {
      return setFocusStep(value);
    },
    playSubmit(success) {
      beginSubmitAttempt();
      completeSubmitResult(Boolean(success));
      return true;
    },
    pulseSubmit() {
      return beginSubmitAttempt();
    },
    playSubmitAttempt() {
      return beginSubmitAttempt();
    },
    playSubmitAttemptAndWait(waitMs) {
      return playSubmitAttemptAndWait(waitMs);
    },
    setSubmitResult(success) {
      return completeSubmitResult(Boolean(success));
    },

    playEntryIntro() {
      startEntryIntro();
      return true;
    },
    resetIdle() {
      queuedFocusStep = null;
      desiredState.focusStep = FOCUS_IDLE;
      desiredState.typingProgress = 0;
      desiredState.blinkWeight = 1;
      applyDesiredState({ force: true });
      completeSubmitResult(false);
      submitVisualPendingReset = false;
      return true;
    },
    runFocusSweep(stepMs) {
      return runFocusSweep(stepMs);
    },
    previewAllAnimations(stepMs) {
      return previewAllAnimations(stepMs);
    },
    getMeta() {
      return {
        ready: Boolean(riveInstance),
        src: activeRiveSrc,
        stateMachine: activeStateMachineName,
        inputNames: Object.keys(stateInputs),
        animationNames: [...availableAnimations],
        fallbackMode,
        fallbackReason,
        introInProgress,
        latestSubmitResult,
        submitAttemptCount,
        lastSubmitAttemptFocusStep,
        submitVisualPendingReset,
        desiredFocusStep: desiredState.focusStep,
        desiredTyping: desiredState.typingProgress,
        capability: {
          hasStateMachine: capability.hasStateMachine,
          inputs: { ...capability.inputs },
          animations: { ...capability.animations },
        },
      };
    },
  };

  window.glsoopLoginRive = bridge;

  const loadRiveBackground = async () => {
    setStatus('Rive runtime 확인 중', '');

    const runtimeCandidate = await ensureRiveRuntime();
    if (!runtimeCandidate || !window.rive || typeof window.rive.Rive !== 'function') {
      setFallback('runtime_unavailable', 'runtime load failed');
      return;
    }

    const resolvedSrc = await resolveRiveSrc();
    if (!resolvedSrc) {
      setFallback('file_unreachable', 'rive src unavailable');
      return;
    }

    activeRiveSrc = resolvedSrc;

    if (window.rive.RuntimeLoader && typeof window.rive.RuntimeLoader.setWasmUrl === 'function') {
      window.rive.RuntimeLoader.setWasmUrl(runtimeCandidate.wasmUrl);
    }

    cleanupRive();
    clearFallback();
    setStatus('Rive 로딩 중', '');

    let loadWatchdog = 0;

    try {
      loadWatchdog = window.setTimeout(() => {
        setFallback('load_timeout', 'rive load watchdog timeout');
      }, 6000);

      riveInstance = new window.rive.Rive({
        src: resolvedSrc,
        canvas,
        autoplay: true,
        stateMachines: STATE_MACHINE_CANDIDATES[0],
        fit: window.rive.Fit.Cover,
        alignment: window.rive.Alignment.Center,
        onLoad: () => {
          if (loadWatchdog) {
            window.clearTimeout(loadWatchdog);
            loadWatchdog = 0;
          }

          resizeSurface();

          const ready = setupStateMachineBridge();
          if (!ready) {
            setFallback('state_machine_missing', 'no playable state machine/animation');
            return;
          }

          if (fallbackMode === 'none') {
            startEntryIntro();
          }

          if (autoRunInputDemo) {
            previewAllAnimations();
          }
        },
        onLoadError: (errorLike) => {
          if (loadWatchdog) {
            window.clearTimeout(loadWatchdog);
            loadWatchdog = 0;
          }
          setFallback('load_error', stringifyError(errorLike));
          console.error('[Rive] load error:', errorLike);
        },
      });
    } catch (error) {
      if (loadWatchdog) {
        window.clearTimeout(loadWatchdog);
      }
      setFallback('init_error', stringifyError(error));
      console.error('[Rive] init error:', error);
    }
  };

  loadRiveBackground();

  window.addEventListener('resize', resizeSurface, { passive: true });
  window.addEventListener('pagehide', cleanupRive);

  const emailInput = document.getElementById('loginEmail');
  const pwInput = document.getElementById('loginPassword');

  if (document.activeElement === emailInput) {
    bridge.setFocus('email');
  } else if (document.activeElement === pwInput) {
    bridge.setFocus('password');
  }

  if (emailInput && emailInput.value) {
    bridge.setTypingProgress((emailInput.value.trim().length || 0) / 24);
  }

  if (previewForm && previewMessage) {
    previewForm.addEventListener('submit', (event) => {
      event.preventDefault();
      previewMessage.textContent = '이 페이지는 디자인 확인용이라 실제 로그인은 동작하지 않습니다.';
      previewMessage.classList.remove('gls-feedback--error');
      previewMessage.classList.add('gls-feedback--info');
      bridge.beginSubmitAttempt();
      bridge.completeSubmitResult(false);
    });
  }
})();
