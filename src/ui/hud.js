const SHARE_FEEDBACK_MS = 2000;
const DEFAULT_HINT_TEXT = 'Tap anywhere or press Space to snap inward';
const ENDLESS_MISS_TEXT = 'Missed — tap anywhere or press Space to retry';

function pad2(value) {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
  return String(safe).padStart(2, '0');
}

function setText(el, text) {
  if (el && el.textContent !== text) {
    el.textContent = text;
  }
}

function setAttr(el, name, value) {
  if (el && typeof el.setAttribute === 'function' && el.getAttribute?.(name) !== value) {
    el.setAttribute(name, value);
  }
}

function isInsideElement(container, target) {
  if (!container || !target) return false;
  if (target === container) return true;
  if (typeof container.contains === 'function' && container.contains(target)) {
    return true;
  }
  if (container.id && typeof target.closest === 'function') {
    return Boolean(target.closest(`#${container.id}`));
  }
  return false;
}

function stopPropagation(e) {
  e?.stopPropagation?.();
}

function stopAndBlurPointer(e, btn) {
  e?.stopPropagation?.();
  if (e && e.detail > 0 && btn && typeof btn.blur === 'function') {
    btn.blur();
  }
}

/**
 * Create the accessible DOM HUD controller.
 * @param {{
 *   doc?: Document,
 *   onToggleDaily: () => void,
 *   onToggleMute: () => void,
 *   onToggleTheme: () => void,
 *   onPauseChange: (paused: boolean) => void,
 *   onShareDaily: () => Promise<boolean> | boolean
 * }} options
 */
export function createHudController(options = {}) {
  const doc = options?.doc ?? (typeof document !== 'undefined' ? document : null);
  const onToggleDaily = typeof options?.onToggleDaily === 'function' ? options.onToggleDaily : () => {};
  const onToggleMute = typeof options?.onToggleMute === 'function' ? options.onToggleMute : () => {};
  const onToggleTheme = typeof options?.onToggleTheme === 'function' ? options.onToggleTheme : () => {};
  const onPauseChange = typeof options?.onPauseChange === 'function' ? options.onPauseChange : () => {};
  const onShareDaily = typeof options?.onShareDaily === 'function' ? options.onShareDaily : () => false;

  const byId = (id) => (doc && typeof doc.getElementById === 'function' ? doc.getElementById(id) : null);

  const hudLevel = byId('hud-level');
  const hudStreak = byId('hud-streak');
  const hudBest = byId('hud-best');
  const btnDaily = byId('btn-daily');
  const btnMute = byId('btn-mute');
  const btnTheme = byId('btn-theme');
  const btnRules = byId('btn-rules');
  const rulesPopover = byId('rules-popover');
  const btnRulesClose = byId('btn-rules-close');
  const footerHint = byId('footer-hint');
  const footerStatus = byId('footer-status');
  const dailyShareWrap = byId('daily-share-wrap');
  const dailyShareSummary = byId('daily-share-summary');
  const btnShareDaily = byId('btn-share-daily');
  const srAnnouncer = byId('sr-announcer');

  let rulesOpen = false;
  let destroyed = false;
  let sharePending = false;
  let shareFeedbackActive = false;
  let shareFeedbackTimer = null;

  const listeners = [];

  function listen(target, eventName, handler) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(eventName, handler);
    listeners.push([target, eventName, handler]);
  }

  function clearShareFeedback() {
    if (shareFeedbackTimer !== null) {
      clearTimeout(shareFeedbackTimer);
      shareFeedbackTimer = null;
    }
    shareFeedbackActive = false;
    if (btnShareDaily?.dataset) {
      delete btnShareDaily.dataset.state;
    }
  }

  function announce(message) {
    if (!srAnnouncer) return;
    const text = message == null ? '' : String(message);
    srAnnouncer.textContent = text;
  }

  function openRules() {
    if (rulesOpen) return;
    rulesOpen = true;
    if (rulesPopover) {
      rulesPopover.hidden = false;
    }
    setAttr(btnRules, 'aria-expanded', 'true');
    onPauseChange(true);
    if (btnRulesClose && typeof btnRulesClose.focus === 'function') {
      btnRulesClose.focus();
    }
  }

  function closeRules({ restoreFocus = true } = {}) {
    if (!rulesOpen) return;
    rulesOpen = false;
    if (rulesPopover) {
      rulesPopover.hidden = true;
    }
    setAttr(btnRules, 'aria-expanded', 'false');
    onPauseChange(false);
    if (restoreFocus && btnRules && typeof btnRules.focus === 'function') {
      btnRules.focus();
    }
  }

  function isRulesOpen() {
    return rulesOpen;
  }

  function sync(snapshot = {}, prefs = {}) {
    const mode = snapshot?.mode === 'daily' ? 'daily' : 'endless';
    const isDaily = mode === 'daily';
    const phase = snapshot?.phase ?? 'playing';
    const isMissed = phase === 'missed';
    const theme = prefs?.theme === 'light' ? 'light' : 'dark';
    const muted = Boolean(prefs?.muted);

    setText(hudLevel, pad2(snapshot?.level ?? 1));
    setText(hudStreak, pad2(snapshot?.streak ?? 0));
    setText(hudBest, pad2(snapshot?.bestStreak ?? 0));

    if (doc?.documentElement) {
      setAttr(doc.documentElement, 'data-theme', theme);
      if (doc.documentElement.dataset) {
        doc.documentElement.dataset.theme = theme;
      }
    }

    setAttr(btnDaily, 'aria-pressed', isDaily ? 'true' : 'false');
    setAttr(
      btnDaily,
      'aria-label',
      isDaily ? 'Switch to Endless mode (D)' : 'Switch to Daily Challenge mode (D)'
    );

    setAttr(btnMute, 'aria-pressed', muted ? 'true' : 'false');
    setAttr(btnMute, 'aria-label', muted ? 'Unmute audio (M)' : 'Mute audio (M)');

    setAttr(btnTheme, 'aria-pressed', theme === 'light' ? 'true' : 'false');
    setAttr(
      btnTheme,
      'aria-label',
      theme === 'light' ? 'Switch to dark theme (T)' : 'Switch to light theme (T)'
    );
    if (btnTheme?.dataset) {
      btnTheme.dataset.theme = theme;
    }

    const hideHint = Boolean(snapshot?.hasSnappedOnce) || isMissed;
    if (footerHint) {
      if (!footerHint.textContent) {
        footerHint.textContent = DEFAULT_HINT_TEXT;
      }
      footerHint.classList?.toggle?.('is-hidden', hideHint);
      setAttr(footerHint, 'aria-hidden', hideHint ? 'true' : 'false');
    }

    if (isDaily && isMissed) {
      if (footerStatus) {
        footerStatus.hidden = true;
        setText(footerStatus, '');
      }
      if (dailyShareWrap) {
        dailyShareWrap.hidden = false;
      }
      const summaryLevel = pad2(snapshot?.dailyStats?.lastLevel ?? snapshot?.level ?? 1);
      const summaryStreak = pad2(snapshot?.dailyStats?.lastStreak ?? snapshot?.runBestStreak ?? 0);
      setText(dailyShareSummary, `Daily run · Level ${summaryLevel} · Streak ${summaryStreak}`);
      if (!shareFeedbackActive) {
        setText(btnShareDaily, 'Share Result');
      }
    } else if (!isDaily && isMissed) {
      clearShareFeedback();
      setText(btnShareDaily, 'Share Result');
      if (dailyShareWrap) {
        dailyShareWrap.hidden = true;
      }
      if (footerStatus) {
        footerStatus.hidden = false;
        setText(footerStatus, ENDLESS_MISS_TEXT);
      }
    } else {
      clearShareFeedback();
      setText(btnShareDaily, 'Share Result');
      if (dailyShareWrap) {
        dailyShareWrap.hidden = true;
      }
      if (footerStatus) {
        footerStatus.hidden = true;
        setText(footerStatus, '');
      }
    }
  }

  function handleDailyClick(e) {
    stopAndBlurPointer(e, btnDaily);
    onToggleDaily();
  }

  function handleMuteClick(e) {
    stopAndBlurPointer(e, btnMute);
    onToggleMute();
  }

  function handleThemeClick(e) {
    stopAndBlurPointer(e, btnTheme);
    onToggleTheme();
  }

  function handleRulesBtnClick(e) {
    const isPointer = Boolean(e && e.detail > 0);
    stopAndBlurPointer(e, btnRules);
    if (rulesOpen) {
      closeRules({ restoreFocus: !isPointer });
    } else {
      openRules();
    }
  }

  function handleRulesCloseClick(e) {
    const isPointer = Boolean(e && e.detail > 0);
    stopAndBlurPointer(e, btnRulesClose);
    closeRules({ restoreFocus: !isPointer });
  }

  async function handleShareClick(e) {
    stopAndBlurPointer(e, btnShareDaily);
    if (sharePending) return;
    sharePending = true;

    let copied = false;
    try {
      copied = Boolean(await onShareDaily());
    } catch {
      copied = false;
    } finally {
      sharePending = false;
    }

    if (destroyed) return;

    clearShareFeedback();
    shareFeedbackActive = true;

    if (copied) {
      setText(btnShareDaily, 'Copied!');
      if (btnShareDaily?.dataset) {
        btnShareDaily.dataset.state = 'copied';
      }
      announce('Daily result copied to clipboard.');
    } else {
      setText(btnShareDaily, 'Copy Manually');
      if (btnShareDaily?.dataset) {
        btnShareDaily.dataset.state = 'fallback';
      }
      announce('Clipboard unavailable. Select the summary text to copy.');
    }

    shareFeedbackTimer = setTimeout(() => {
      shareFeedbackTimer = null;
      shareFeedbackActive = false;
      if (btnShareDaily?.dataset) {
        delete btnShareDaily.dataset.state;
      }
      setText(btnShareDaily, 'Share Result');
    }, SHARE_FEEDBACK_MS);
  }

  function handleDocKeydown(e) {
    if (!rulesOpen) return;
    if (e?.key === 'Escape') {
      e.preventDefault?.();
      closeRules({ restoreFocus: true });
      return;
    }
    if (e?.key === 'Tab' && btnRulesClose && typeof btnRulesClose.focus === 'function') {
      e.preventDefault?.();
      btnRulesClose.focus();
    }
  }

  function handleDocClick(e) {
    if (!rulesOpen) return;
    const target = e?.target;
    if (isInsideElement(rulesPopover, target) || isInsideElement(btnRules, target)) {
      return;
    }
    closeRules({ restoreFocus: false });
  }

  listen(btnDaily, 'pointerdown', stopPropagation);
  listen(btnDaily, 'click', handleDailyClick);

  listen(btnMute, 'pointerdown', stopPropagation);
  listen(btnMute, 'click', handleMuteClick);

  listen(btnTheme, 'pointerdown', stopPropagation);
  listen(btnTheme, 'click', handleThemeClick);

  listen(btnRules, 'pointerdown', stopPropagation);
  listen(btnRules, 'click', handleRulesBtnClick);

  listen(btnRulesClose, 'pointerdown', stopPropagation);
  listen(btnRulesClose, 'click', handleRulesCloseClick);

  listen(rulesPopover, 'pointerdown', stopPropagation);
  listen(rulesPopover, 'click', stopPropagation);

  listen(dailyShareWrap, 'pointerdown', stopPropagation);
  listen(dailyShareWrap, 'click', stopPropagation);

  listen(btnShareDaily, 'pointerdown', stopPropagation);
  listen(btnShareDaily, 'click', handleShareClick);

  listen(doc, 'keydown', handleDocKeydown);
  listen(doc, 'click', handleDocClick);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearShareFeedback();
    for (const [target, eventName, handler] of listeners) {
      target.removeEventListener?.(eventName, handler);
    }
    listeners.length = 0;
  }

  return {
    sync,
    announce,
    openRules,
    closeRules,
    isRulesOpen,
    destroy
  };
}
