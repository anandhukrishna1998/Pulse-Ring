import { MAX_DT, createGameController } from './game/state.js';
import { createStorage } from './game/storage.js';
import { createAudioSynth } from './audio/synth.js';
import { createHudController } from './ui/hud.js';
import { createCanvasRenderer } from './render/canvas-renderer.js';

function isEditableTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  if (typeof target.closest === 'function') {
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
  }
  return false;
}

function isInteractiveControl(el) {
  if (!el) return false;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  if (typeof el.getAttribute === 'function' && el.getAttribute('role') === 'dialog') {
    return true;
  }
  if (typeof el.closest === 'function') {
    return Boolean(el.closest('button, [role="dialog"], a, input, textarea, select'));
  }
  return false;
}

function getSafeDpr(win) {
  const raw = win?.devicePixelRatio;
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

function measureStageSize(stageEl, canvas) {
  const target = stageEl || canvas;
  if (!target) {
    return { width: 0, height: 0 };
  }
  if (typeof target.getBoundingClientRect === 'function') {
    const rect = target.getBoundingClientRect();
    const width = Number.isFinite(rect?.width) ? rect.width : 0;
    const height = Number.isFinite(rect?.height) ? rect.height : 0;
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }
  const clientW = Number.isFinite(target.clientWidth) ? target.clientWidth : 0;
  const clientH = Number.isFinite(target.clientHeight) ? target.clientHeight : 0;
  return {
    width: clientW > 0 ? clientW : 0,
    height: clientH > 0 ? clientH : 0
  };
}

/**
 * Bootstrap the Pulse Ring application, wiring rendering, audio, storage, HUD, input, and loop.
 * @param {object} [options]
 */
export function bootstrapPulseRing(options = {}) {
  const doc = options?.doc ?? (typeof document !== 'undefined' ? document : null);
  const win = options?.win ?? (typeof window !== 'undefined' ? window : null);
  const nav =
    options?.navigator ??
    win?.navigator ??
    (typeof navigator !== 'undefined' ? navigator : null);

  let storageImpl;
  if (!options?.storage && options?.win) {
    try {
      if ('localStorage' in options.win) {
        storageImpl = options.win.localStorage;
      }
    } catch {
      storageImpl = null;
    }
  }
  const storage = options?.storage ?? createStorage(storageImpl);

  let prefersDark = true;
  try {
    if (win && typeof win.matchMedia === 'function') {
      prefersDark = Boolean(win.matchMedia('(prefers-color-scheme: dark)')?.matches);
    }
  } catch {
    prefersDark = true;
  }

  let theme = storage.getTheme(prefersDark);
  let muted = storage.getMuted();

  if (doc?.documentElement) {
    doc.documentElement.setAttribute?.('data-theme', theme);
    if (doc.documentElement.dataset) {
      doc.documentElement.dataset.theme = theme;
    }
  }

  let reducedMotionQuery = null;
  let reducedMotion = false;
  try {
    if (win && typeof win.matchMedia === 'function') {
      reducedMotionQuery = win.matchMedia('(prefers-reduced-motion: reduce)');
      reducedMotion = Boolean(reducedMotionQuery?.matches);
    }
  } catch {
    reducedMotionQuery = null;
    reducedMotion = false;
  }

  const controller =
    options?.controller ??
    createGameController({
      storage,
      dateKeyProvider: options?.dateKeyProvider,
      endlessSeed: options?.endlessSeed
    });

  const synth = options?.synth ?? createAudioSynth({ muted, navigator: nav });
  synth.setMuted(muted);

  const SILENT_WAV_DATA_URI =
    'data:audio/wav;base64,UklGRkQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
  let htmlAudioPrimed = false;

  function primeLegacyHtmlAudio() {
    if (htmlAudioPrimed || synth.isMuted()) return;
    if (nav && 'audioSession' in nav) return;
    if (typeof win?.Audio !== 'function') return;
    htmlAudioPrimed = true;
    try {
      const primer = new win.Audio(SILENT_WAV_DATA_URI);
      primer.muted = false;
      primer.volume = 0.01;
      primer.playsInline = true;
      primer.setAttribute?.('playsinline', '');
      const playPromise = primer.play?.();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          htmlAudioPrimed = false;
        });
      }
    } catch {
      htmlAudioPrimed = false;
    }
  }

  const canvas = options?.canvas ?? doc?.getElementById?.('arena') ?? null;
  const stageEl = options?.stage ?? doc?.querySelector?.('.stage') ?? canvas?.parentElement ?? canvas;

  const renderer =
    options?.renderer ??
    createCanvasRenderer(canvas, {
      theme,
      reducedMotion
    });
  renderer.setTheme(theme);
  renderer.setReducedMotion(reducedMotion);

  let tabPaused = Boolean(doc?.hidden);
  let rulesPaused = false;
  let lastTimestamp = null;
  let rafId = null;
  let destroyed = false;
  let attemptCount = 0;
  let lastClearWasPerfect = false;

  let lastCssWidth = 0;
  let lastCssHeight = 0;
  let lastDpr = getSafeDpr(win);
  let lastVvWidth = 0;
  let lastVvHeight = 0;

  const listeners = [];

  function listen(target, eventName, handler, eventOptions) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(eventName, handler, eventOptions);
    listeners.push([target, eventName, handler, eventOptions]);
  }

  function syncPausedState() {
    const paused = tabPaused || rulesPaused;
    controller.setPaused(paused);
    lastTimestamp = null;
  }

  function getViewportDimensions() {
    const vv = win?.visualViewport;
    const width =
      Number.isFinite(vv?.width) && vv.width > 0
        ? Math.round(vv.width)
        : Number.isFinite(win?.innerWidth) && win.innerWidth > 0
          ? Math.round(win.innerWidth)
          : 0;
    const height =
      Number.isFinite(vv?.height) && vv.height > 0
        ? Math.round(vv.height)
        : Number.isFinite(win?.innerHeight) && win.innerHeight > 0
          ? Math.round(win.innerHeight)
          : 0;
    return { width, height };
  }

  function syncViewportSize() {
    const { width, height } = getViewportDimensions();
    lastVvWidth = width;
    lastVvHeight = height;

    if (typeof doc?.documentElement?.style?.setProperty === 'function') {
      if (height > 0) {
        doc.documentElement.style.setProperty('--app-height', `${height}px`);
      }
      if (width > 0) {
        doc.documentElement.style.setProperty('--app-width', `${width}px`);
      }
    }

    if (typeof win?.scrollTo === 'function') {
      try {
        win.scrollTo(0, 0);
      } catch {
        // Ignore restricted scroll environments
      }
    }
  }

  function syncCanvasSize(explicitWidth, explicitHeight) {
    const measured =
      Number.isFinite(explicitWidth) && explicitWidth > 0 && Number.isFinite(explicitHeight) && explicitHeight > 0
        ? { width: explicitWidth, height: explicitHeight }
        : measureStageSize(stageEl, canvas);

    const dpr = getSafeDpr(win);
    if (measured.width <= 0 || measured.height <= 0) {
      lastDpr = dpr;
      return false;
    }

    if (measured.width !== lastCssWidth || measured.height !== lastCssHeight || dpr !== lastDpr) {
      lastCssWidth = measured.width;
      lastCssHeight = measured.height;
      lastDpr = dpr;
      renderer.resize(lastCssWidth, lastCssHeight, lastDpr);
      return true;
    }
    return false;
  }

  function syncDprIfChanged() {
    const { width, height } = getViewportDimensions();
    if (width > 0 && height > 0 && (width !== lastVvWidth || height !== lastVvHeight)) {
      syncViewportSize();
      syncCanvasSize();
      return;
    }
    const currentDpr = getSafeDpr(win);
    if (currentDpr !== lastDpr && lastCssWidth > 0 && lastCssHeight > 0) {
      lastDpr = currentDpr;
      renderer.resize(lastCssWidth, lastCssHeight, lastDpr);
    }
  }

  async function copyShareText() {
    const text = controller.formatDailyShareText();
    if (nav?.clipboard && typeof nav.clipboard.writeText === 'function') {
      try {
        await nav.clipboard.writeText(text);
        return true;
      } catch {
        // Fall through to read-only textarea execCommand copy fallback
      }
    }

    if (doc && typeof doc.createElement === 'function' && doc.body && typeof doc.execCommand === 'function') {
      let textarea = null;
      let copied = false;
      const prevFocused = doc.activeElement;
      try {
        textarea = doc.createElement('textarea');
        textarea.value = text;
        textarea.readOnly = true;
        textarea.setAttribute?.('readonly', '');
        textarea.setAttribute?.('aria-hidden', 'true');
        if (textarea.style) {
          textarea.style.position = 'fixed';
          textarea.style.top = '-9999px';
          textarea.style.left = '-9999px';
          textarea.style.opacity = '0';
        }
        doc.body.appendChild(textarea);
        textarea.focus?.({ preventScroll: true });
        textarea.select?.();
        textarea.setSelectionRange?.(0, text.length);
        copied = Boolean(doc.execCommand('copy'));
      } catch {
        copied = false;
      } finally {
        if (textarea && textarea.parentNode) {
          textarea.parentNode.removeChild(textarea);
        }
        if (prevFocused && typeof prevFocused.focus === 'function' && prevFocused !== doc.body) {
          try {
            prevFocused.focus({ preventScroll: true });
          } catch {
            prevFocused.focus();
          }
        }
      }
      if (copied) {
        return true;
      }
    }

    if (typeof win?.prompt === 'function') {
      try {
        win.prompt('Copy your PULSE RING Daily result:', text);
      } catch {
        // Ignore prompt errors in restricted environments
      }
      lastTimestamp = null;
    }

    return false;
  }

  let hud = null;

  function toggleDailyMode() {
    const nextMode = controller.state.mode === 'daily' ? 'endless' : 'daily';
    lastClearWasPerfect = false;
    controller.setMode(nextMode);
    const snap = controller.getSnapshot();
    hud.sync(snap, { theme, muted });
    renderer.render(snap);
    if (nextMode === 'daily') {
      hud.announce(`Daily Challenge mode, ${snap.dailyKey}, level 1.`);
    } else {
      hud.announce(`Endless mode, level ${snap.level}.`);
    }
  }

  function toggleMute() {
    muted = !muted;
    storage.setMuted(muted);
    synth.setMuted(muted);
    if (!muted) {
      primeLegacyHtmlAudio();
      synth.unlock();
    }
    hud.sync(controller.getSnapshot(), { theme, muted });
    hud.announce(muted ? 'Audio muted.' : 'Audio unmuted.');
  }

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    storage.setTheme(theme);
    renderer.setTheme(theme);
    const snap = controller.getSnapshot();
    hud.sync(snap, { theme, muted });
    renderer.render(snap);
    hud.announce(theme === 'light' ? 'Light theme enabled.' : 'Dark theme enabled.');
  }

  hud =
    options?.hud ??
    createHudController({
      doc,
      onToggleDaily: toggleDailyMode,
      onToggleMute: toggleMute,
      onToggleTheme: toggleTheme,
      onPauseChange: (paused) => {
        rulesPaused = Boolean(paused);
        syncPausedState();
      },
      onShareDaily: copyShareText
    });

  function handleGameAction() {
    if (hud.isRulesOpen()) {
      return;
    }

    primeLegacyHtmlAudio();
    synth.unlock();
    const res = controller.triggerAction();
    if (!res || res.action === 'ignored') {
      return;
    }

    const snap = controller.getSnapshot();

    if (res.action === 'hit' || res.action === 'perfect') {
      const streakIndex = Math.max(0, (res.streak || 1) - 1);
      synth.playSnap(streakIndex, res.action === 'perfect');
      if (res.levelClear) {
        lastClearWasPerfect = res.action === 'perfect';
        synth.playLevelClear(res.level);
      } else if (res.action === 'perfect') {
        const remaining = Math.max(0, snap.rings.length - snap.activeRingIndex);
        hud.announce(
          `Perfect snap, streak ${res.streak}, ${remaining} remaining on level ${res.level}.`
        );
      }
    } else if (res.action === 'miss') {
      lastClearWasPerfect = false;
      attemptCount += 1;
      synth.playMiss();
      if (snap.mode === 'daily') {
        hud.announce(
          `Daily run ended on level ${res.level}, streak ${snap.dailyStats.lastStreak}. Attempt ${attemptCount}.`
        );
      } else {
        hud.announce(
          `Missed on level ${res.level}. Tap anywhere or press Space to retry. Attempt ${attemptCount}.`
        );
      }
    } else if (res.action === 'retry') {
      lastClearWasPerfect = false;
      attemptCount += 1;
      hud.announce(
        snap.mode === 'daily'
          ? `Daily run restarted at level ${res.level}. Attempt ${attemptCount}.`
          : `Retrying level ${res.level}. Attempt ${attemptCount}.`
      );
    }

    hud.sync(snap, { theme, muted });
    renderer.render(snap);
  }

  function handleArenaPointerDown(e) {
    if (e?.pointerType === 'mouse' && e.button !== 0) {
      return;
    }
    if (e?.isPrimary === false) {
      return;
    }
    if (hud.isRulesOpen()) {
      return;
    }
    handleGameAction();
  }

  function handleKeyDown(e) {
    if (!e || e.repeat || e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }
    if (isEditableTarget(e.target) || isEditableTarget(doc?.activeElement)) {
      return;
    }

    const isSpace = e.code === 'Space' || e.key === ' ';
    const isEnter = e.code === 'Enter' || e.key === 'Enter';
    if (isSpace || isEnter) {
      if (hud.isRulesOpen()) {
        return;
      }
      if (isInteractiveControl(e.target) || isInteractiveControl(doc?.activeElement)) {
        return;
      }
      e.preventDefault?.();
      handleGameAction();
      return;
    }

    if (e.key === 'Escape' || e.code === 'Escape') {
      if (hud.isRulesOpen()) {
        e.preventDefault?.();
        hud.closeRules({ restoreFocus: true });
      }
      return;
    }

    const key = typeof e.key === 'string' ? e.key : '';
    const lowerKey = key.toLowerCase();

    if (key === '?' || lowerKey === 'h' || (!key && e.code === 'KeyH')) {
      e.preventDefault?.();
      if (hud.isRulesOpen()) {
        hud.closeRules({ restoreFocus: true });
      } else {
        hud.openRules();
      }
      return;
    }

    if (lowerKey === 'm' || (!key && e.code === 'KeyM')) {
      toggleMute();
      return;
    }

    if (lowerKey === 't' || (!key && e.code === 'KeyT')) {
      toggleTheme();
      return;
    }

    if (lowerKey === 'd' || (!key && e.code === 'KeyD')) {
      toggleDailyMode();
    }
  }

  function handleVisibilityChange() {
    tabPaused = Boolean(doc?.hidden);
    syncPausedState();
    if (!tabPaused) {
      lastTimestamp = null;
    }
  }

  function handleWindowBlur() {
    lastTimestamp = null;
  }

  function handleWindowFocus() {
    lastTimestamp = null;
  }

  function handleWindowResize() {
    syncViewportSize();
    if (syncCanvasSize()) {
      renderer.render(controller.getSnapshot());
    }
  }

  function handleGestureAudioUnlock() {
    if (synth.isMuted()) return;
    primeLegacyHtmlAudio();
    synth.unlock({ force: true });
  }

  function handleReducedMotionChange(event) {
    reducedMotion = Boolean(event?.matches);
    renderer.setReducedMotion(reducedMotion);
    renderer.render(controller.getSnapshot());
  }

  listen(canvas, 'pointerdown', handleArenaPointerDown);
  listen(doc, 'touchend', handleGestureAudioUnlock, { passive: true });
  listen(doc, 'click', handleGestureAudioUnlock);
  listen(doc, 'keydown', handleKeyDown);
  listen(doc, 'visibilitychange', handleVisibilityChange);
  listen(win, 'blur', handleWindowBlur);
  listen(win, 'focus', handleWindowFocus);
  listen(win, 'resize', handleWindowResize);
  listen(win, 'orientationchange', handleWindowResize);
  listen(win, 'pageshow', handleWindowResize);
  listen(win?.visualViewport, 'resize', handleWindowResize);
  listen(win?.visualViewport, 'scroll', handleWindowResize);

  let resizeObserver = null;
  const ResizeObserverCtor = win?.ResizeObserver ?? globalThis.ResizeObserver;
  if (typeof ResizeObserverCtor === 'function' && stageEl) {
    resizeObserver = new ResizeObserverCtor((entries) => {
      const entry = entries?.[0];
      const width = entry?.contentRect?.width;
      const height = entry?.contentRect?.height;
      if (syncCanvasSize(width, height)) {
        renderer.render(controller.getSnapshot());
      }
    });
    resizeObserver.observe(stageEl);
  }

  let detachReducedMotion = null;
  if (reducedMotionQuery) {
    if (typeof reducedMotionQuery.addEventListener === 'function') {
      reducedMotionQuery.addEventListener('change', handleReducedMotionChange);
      detachReducedMotion = () => {
        reducedMotionQuery.removeEventListener('change', handleReducedMotionChange);
      };
    } else if (typeof reducedMotionQuery.addListener === 'function') {
      reducedMotionQuery.addListener(handleReducedMotionChange);
      detachReducedMotion = () => {
        reducedMotionQuery.removeListener(handleReducedMotionChange);
      };
    }
  }

  const reqFrame =
    typeof win?.requestAnimationFrame === 'function'
      ? (cb) => win.requestAnimationFrame(cb)
      : typeof globalThis.requestAnimationFrame === 'function'
        ? (cb) => globalThis.requestAnimationFrame(cb)
        : (cb) => setTimeout(() => cb(Date.now()), 16);

  const cancelFrame =
    typeof win?.cancelAnimationFrame === 'function'
      ? (id) => win.cancelAnimationFrame(id)
      : typeof globalThis.cancelAnimationFrame === 'function'
        ? (id) => globalThis.cancelAnimationFrame(id)
        : (id) => clearTimeout(id);

  function getFallbackNow() {
    if (typeof win?.performance?.now === 'function') return win.performance.now();
    if (typeof performance?.now === 'function') return performance.now();
    return Date.now();
  }

  function onFrame(now) {
    if (destroyed) return;

    syncDprIfChanged();
    const timestamp = Number.isFinite(now) ? now : getFallbackNow();

    if (controller.state.paused) {
      lastTimestamp = null;
    } else if (lastTimestamp === null) {
      lastTimestamp = timestamp;
    } else {
      const rawDt = Math.max(0, (timestamp - lastTimestamp) / 1000);
      const dt = Math.min(MAX_DT, rawDt);
      lastTimestamp = timestamp;

      if (dt > 0) {
        const prevPhase = controller.state.phase;
        const prevLevel = controller.state.level;
        controller.step(dt);
        const nextPhase = controller.state.phase;
        const nextLevel = controller.state.level;

        if (prevPhase !== nextPhase || prevLevel !== nextLevel) {
          const snap = controller.getSnapshot();
          hud.sync(snap, { theme, muted });
          if (prevLevel !== nextLevel) {
            const prefix = lastClearWasPerfect ? 'Perfect finish! ' : '';
            lastClearWasPerfect = false;
            hud.announce(
              `${prefix}Level ${nextLevel} started, ${snap.rings.length} rings, streak ${snap.streak}.`
            );
          }
        }
      }
    }

    renderer.render(controller.getSnapshot());
    rafId = reqFrame(onFrame);
  }

  syncViewportSize();
  syncCanvasSize();
  syncPausedState();
  const initialSnapshot = controller.getSnapshot();
  hud.sync(initialSnapshot, { theme, muted });
  renderer.render(initialSnapshot);
  rafId = reqFrame(onFrame);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (rafId !== null) {
      cancelFrame(rafId);
      rafId = null;
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (detachReducedMotion) {
      detachReducedMotion();
      detachReducedMotion = null;
    }
    for (const [target, eventName, handler, eventOptions] of listeners) {
      target.removeEventListener?.(eventName, handler, eventOptions);
    }
    listeners.length = 0;
    hud.destroy();
  }

  return {
    controller,
    storage,
    synth,
    renderer,
    hud,
    destroy
  };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener?.(
      'DOMContentLoaded',
      () => {
        if (document.getElementById?.('arena')) {
          bootstrapPulseRing();
        }
      },
      { once: true }
    );
  } else if (document.getElementById?.('arena')) {
    bootstrapPulseRing();
  }
}
