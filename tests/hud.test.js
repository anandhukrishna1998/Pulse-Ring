import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHudController } from '../src/ui/hud.js';

function createFakeElement(id = '') {
  const listeners = new Map();
  const classes = new Set();
  const attrs = new Map();
  return {
    id,
    textContent: '',
    hidden: false,
    disabled: false,
    dataset: {},
    focused: false,
    blurred: false,
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, force) => (force === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (force ? classes.add(c) : classes.delete(c))),
      contains: (c) => classes.has(c)
    },
    setAttribute: (k, v) => attrs.set(k, String(v)),
    getAttribute: (k) => attrs.get(k) ?? null,
    addEventListener: (ev, fn) => {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(fn);
    },
    removeEventListener: (ev, fn) => {
      if (!listeners.has(ev)) return;
      listeners.set(ev, listeners.get(ev).filter((f) => f !== fn));
    },
    dispatch(ev, eventObj = {}) {
      let stopped = false;
      let prevented = false;
      const evt = {
        target: this,
        detail: 0,
        preventDefault() { prevented = true; },
        stopPropagation() { stopped = true; },
        ...eventObj
      };
      for (const fn of listeners.get(ev) || []) {
        fn(evt);
      }
      return { stopped, prevented, event: evt };
    },
    listenerCount: (ev) => (listeners.get(ev) || []).length,
    focus() { this.focused = true; },
    blur() { this.blurred = true; },
    closest: () => null
  };
}

function createFakeDoc() {
  const ids = [
    'hud-level', 'hud-streak', 'hud-best',
    'btn-daily', 'btn-mute', 'btn-theme', 'btn-rules',
    'rules-popover', 'btn-rules-close',
    'footer-hint', 'footer-status', 'daily-share-wrap', 'daily-share-summary', 'btn-share-daily',
    'sr-announcer'
  ];
  const map = new Map(ids.map((id) => [id, createFakeElement(id)]));
  map.get('rules-popover').hidden = true;
  map.get('footer-status').hidden = true;
  map.get('daily-share-wrap').hidden = true;

  const docListeners = new Map();
  return {
    documentElement: createFakeElement('html'),
    activeElement: null,
    getElementById: (id) => map.get(id) ?? null,
    addEventListener: (ev, fn) => {
      if (!docListeners.has(ev)) docListeners.set(ev, []);
      docListeners.get(ev).push(fn);
    },
    removeEventListener: (ev, fn) => {
      if (!docListeners.has(ev)) return;
      docListeners.set(ev, docListeners.get(ev).filter((f) => f !== fn));
    },
    dispatchDoc(ev, eventObj = {}) {
      let prevented = false;
      const evt = {
        preventDefault() { prevented = true; },
        ...eventObj
      };
      for (const fn of docListeners.get(ev) || []) {
        fn(evt);
      }
      return { prevented, event: evt };
    },
    docListenerCount: (ev) => (docListeners.get(ev) || []).length
  };
}

describe('hud controller', () => {
  it('syncs padded stats, theme/mute/daily ARIA attributes, hint fade, and Daily share strip', () => {
    const doc = createFakeDoc();
    let paused = false;
    const hud = createHudController({
      doc,
      onToggleDaily: () => {},
      onToggleMute: () => {},
      onToggleTheme: () => {},
      onPauseChange: (p) => { paused = p; },
      onShareDaily: async () => true
    });

    hud.sync({
      mode: 'endless',
      phase: 'playing',
      level: 4,
      streak: 12,
      bestLevel: 9,
      bestStreak: 18,
      hasSnappedOnce: false,
      dailyKey: '2026-11-11',
      dailyStats: { bestLevel: 1, bestStreak: 0, lastLevel: 1, lastStreak: 0, lastPerfects: 0, runsCount: 0 }
    }, { theme: 'dark', muted: false });

    assert.equal(doc.getElementById('hud-level').textContent, '04');
    assert.equal(doc.getElementById('hud-streak').textContent, '12');
    assert.equal(doc.getElementById('hud-best').textContent, '18');
    assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
    assert.equal(doc.getElementById('btn-daily').getAttribute('aria-pressed'), 'false');
    assert.equal(doc.getElementById('btn-mute').getAttribute('aria-pressed'), 'false');
    assert.equal(doc.getElementById('btn-theme').getAttribute('aria-pressed'), 'false');
    assert.equal(doc.getElementById('footer-hint').classList.contains('is-hidden'), false);
    assert.equal(doc.getElementById('footer-status').hidden, true);
    assert.equal(doc.getElementById('daily-share-wrap').hidden, true);

    hud.sync({
      mode: 'daily',
      phase: 'missed',
      level: 3,
      streak: 0,
      bestLevel: 3,
      bestStreak: 7,
      hasSnappedOnce: true,
      dailyKey: '2026-11-11',
      dailyStats: { bestLevel: 3, bestStreak: 7, lastLevel: 3, lastStreak: 7, lastPerfects: 2, runsCount: 1 }
    }, { theme: 'light', muted: true });

    assert.equal(doc.documentElement.getAttribute('data-theme'), 'light');
    assert.equal(doc.getElementById('btn-daily').getAttribute('aria-pressed'), 'true');
    assert.equal(doc.getElementById('btn-mute').getAttribute('aria-pressed'), 'true');
    assert.equal(doc.getElementById('btn-theme').getAttribute('aria-pressed'), 'true');
    assert.equal(doc.getElementById('footer-hint').classList.contains('is-hidden'), true);
    assert.equal(doc.getElementById('footer-status').hidden, true);
    assert.equal(doc.getElementById('daily-share-wrap').hidden, false);
    assert.equal(doc.getElementById('daily-share-summary').textContent, 'Daily run · Level 03 · Streak 07');

    hud.openRules();
    assert.equal(paused, true);
    assert.equal(hud.isRulesOpen(), true);
    assert.equal(doc.getElementById('rules-popover').hidden, false);
    assert.equal(doc.getElementById('btn-rules').getAttribute('aria-expanded'), 'true');
    assert.equal(doc.getElementById('btn-rules-close').focused, true);

    doc.dispatchDoc('keydown', { key: 'Escape' });
    assert.equal(paused, false);
    assert.equal(hud.isRulesOpen(), false);
    assert.equal(doc.getElementById('rules-popover').hidden, true);
    assert.equal(doc.getElementById('btn-rules').getAttribute('aria-expanded'), 'false');
    assert.equal(doc.getElementById('btn-rules').focused, true);
    hud.destroy();
  });

  it('blurs HUD toggle buttons on pointer clicks while preserving focus on keyboard activation', () => {
    const doc = createFakeDoc();
    let dailyCount = 0;
    let muteCount = 0;
    let themeCount = 0;
    const hud = createHudController({
      doc,
      onToggleDaily: () => { dailyCount += 1; },
      onToggleMute: () => { muteCount += 1; },
      onToggleTheme: () => { themeCount += 1; },
      onPauseChange: () => {},
      onShareDaily: async () => true
    });

    const btnDaily = doc.getElementById('btn-daily');
    const btnMute = doc.getElementById('btn-mute');
    const btnTheme = doc.getElementById('btn-theme');

    // Keyboard activation (detail === 0) must NOT blur
    btnDaily.dispatch('click', { detail: 0 });
    btnMute.dispatch('click', { detail: 0 });
    btnTheme.dispatch('click', { detail: 0 });
    assert.equal(dailyCount, 1);
    assert.equal(muteCount, 1);
    assert.equal(themeCount, 1);
    assert.equal(btnDaily.blurred, false);
    assert.equal(btnMute.blurred, false);
    assert.equal(btnTheme.blurred, false);

    // Pointer activation (detail > 0) MUST blur and stop propagation
    const resDaily = btnDaily.dispatch('click', { detail: 1 });
    const resMute = btnMute.dispatch('click', { detail: 1 });
    const resTheme = btnTheme.dispatch('click', { detail: 1 });
    assert.equal(dailyCount, 2);
    assert.equal(muteCount, 2);
    assert.equal(themeCount, 2);
    assert.equal(btnDaily.blurred, true);
    assert.equal(btnMute.blurred, true);
    assert.equal(btnTheme.blurred, true);
    assert.equal(resDaily.stopped, true);
    assert.equal(resMute.stopped, true);
    assert.equal(resTheme.stopped, true);

    hud.destroy();
  });

  it('handles Endless miss status, Daily share copy feedback, and fallback on clipboard failure', async () => {
    const doc = createFakeDoc();
    let shareOutcome = true;
    let shareCalls = 0;
    const hud = createHudController({
      doc,
      onToggleDaily: () => {},
      onToggleMute: () => {},
      onToggleTheme: () => {},
      onPauseChange: () => {},
      onShareDaily: async () => {
        shareCalls += 1;
        return shareOutcome;
      }
    });

    // Endless miss displays retry prompt
    hud.sync({
      mode: 'endless',
      phase: 'missed',
      level: 5,
      streak: 0,
      bestLevel: 5,
      bestStreak: 10,
      hasSnappedOnce: true,
      dailyKey: '2026-11-11',
      dailyStats: { bestLevel: 1, bestStreak: 0, lastLevel: 1, lastStreak: 0, lastPerfects: 0, runsCount: 0 }
    }, { theme: 'dark', muted: false });

    assert.equal(doc.getElementById('footer-status').hidden, false);
    assert.equal(
      doc.getElementById('footer-status').textContent,
      'Missed — tap anywhere or press Space to retry'
    );
    assert.equal(doc.getElementById('daily-share-wrap').hidden, true);
    assert.equal(doc.getElementById('footer-hint').classList.contains('is-hidden'), true);

    // Switch to Daily missed and share successfully
    hud.sync({
      mode: 'daily',
      phase: 'missed',
      level: 2,
      streak: 0,
      bestLevel: 2,
      bestStreak: 4,
      hasSnappedOnce: true,
      dailyKey: '2026-11-11',
      dailyStats: { bestLevel: 2, bestStreak: 4, lastLevel: 2, lastStreak: 4, lastPerfects: 1, runsCount: 1 }
    }, { theme: 'dark', muted: false });

    const shareBtn = doc.getElementById('btn-share-daily');
    const clickRes = shareBtn.dispatch('click', { detail: 1 });
    assert.equal(clickRes.stopped, true);
    assert.equal(shareBtn.blurred, true);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(shareCalls, 1);
    assert.equal(shareBtn.textContent, 'Copied!');
    assert.equal(doc.getElementById('sr-announcer').textContent, 'Daily result copied to clipboard.');

    // Subsequent sync while still missed preserves "Copied!" feedback
    hud.sync({
      mode: 'daily',
      phase: 'missed',
      level: 2,
      streak: 0,
      bestLevel: 2,
      bestStreak: 4,
      hasSnappedOnce: true,
      dailyKey: '2026-11-11',
      dailyStats: { bestLevel: 2, bestStreak: 4, lastLevel: 2, lastStreak: 4, lastPerfects: 1, runsCount: 1 }
    }, { theme: 'dark', muted: false });
    assert.equal(shareBtn.textContent, 'Copied!');

    // Fallback feedback when share fails
    shareOutcome = false;
    shareBtn.dispatch('click', { detail: 0 });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(shareCalls, 2);
    assert.equal(shareBtn.textContent, 'Copy Manually');
    assert.match(doc.getElementById('sr-announcer').textContent, /clipboard unavailable/i);

    // Leaving Daily missed resets share button label cleanly
    hud.sync({
      mode: 'daily',
      phase: 'playing',
      level: 1,
      streak: 0,
      bestLevel: 2,
      bestStreak: 4,
      hasSnappedOnce: true,
      dailyKey: '2026-11-11',
      dailyStats: { bestLevel: 2, bestStreak: 4, lastLevel: 2, lastStreak: 4, lastPerfects: 1, runsCount: 1 }
    }, { theme: 'dark', muted: false });
    assert.equal(shareBtn.textContent, 'Share Result');
    assert.equal(doc.getElementById('daily-share-wrap').hidden, true);

    hud.destroy();
  });

  it('closes rules popover on outside click, close button, and button toggle, and cleans up listeners on destroy', () => {
    const doc = createFakeDoc();
    const pauseEvents = [];
    const hud = createHudController({
      doc,
      onToggleDaily: () => {},
      onToggleMute: () => {},
      onToggleTheme: () => {},
      onPauseChange: (p) => pauseEvents.push(p),
      onShareDaily: async () => true
    });

    const btnRules = doc.getElementById('btn-rules');
    const btnClose = doc.getElementById('btn-rules-close');
    const popover = doc.getElementById('rules-popover');

    // Pointer click on ? opens rules and blurs button
    btnRules.dispatch('click', { detail: 1 });
    assert.equal(hud.isRulesOpen(), true);
    assert.equal(btnRules.blurred, true);
    assert.deepEqual(pauseEvents, [true]);

    // Clicking inside popover does NOT close it
    const insideTarget = createFakeElement('rules-inner');
    insideTarget.closest = (sel) => (sel === '#rules-popover' ? popover : null);
    doc.dispatchDoc('click', { target: insideTarget });
    assert.equal(hud.isRulesOpen(), true);

    // Clicking outside popover closes it without re-focusing #btn-rules
    btnRules.focused = false;
    const outsideTarget = createFakeElement('arena');
    doc.dispatchDoc('click', { target: outsideTarget });
    assert.equal(hud.isRulesOpen(), false);
    assert.equal(btnRules.focused, false);
    assert.deepEqual(pauseEvents, [true, false]);

    // Re-open and close via keyboard on #btn-rules-close -> restores focus to #btn-rules
    btnRules.dispatch('click', { detail: 0 });
    assert.equal(hud.isRulesOpen(), true);
    btnClose.dispatch('click', { detail: 0 });
    assert.equal(hud.isRulesOpen(), false);
    assert.equal(btnRules.focused, true);

    // Tab trap keeps focus on #btn-rules-close when dialog is open
    hud.openRules();
    btnClose.focused = false;
    doc.activeElement = btnClose;
    const tabRes = doc.dispatchDoc('keydown', { key: 'Tab' });
    assert.equal(tabRes.prevented, true);
    assert.equal(btnClose.focused, true);

    // Destroy removes listeners cleanly
    hud.destroy();
    assert.equal(doc.docListenerCount('keydown'), 0);
    assert.equal(doc.docListenerCount('click'), 0);
    assert.equal(btnRules.listenerCount('click'), 0);
  });

  it('ships semantic HTML shell and CSS theme system with zero external URLs and all required landmarks/IDs', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../styles/main.css', import.meta.url), 'utf8');

    assert.equal(/https?:\/\//i.test(html), false);
    assert.equal(/https?:\/\//i.test(css), false);
    assert.match(html, /href="\.\/styles\/main\.css"/);
    assert.match(html, /src="\.\/src\/main\.js"/);
    assert.match(html, /localStorage\.getItem\('pulse-ring:theme'\)/);
    assert.match(html, /prefers-color-scheme:\s*dark/);
    assert.match(html, /documentElement\.dataset\.theme/);

    const requiredIds = [
      'hud-level', 'hud-streak', 'hud-best',
      'btn-daily', 'btn-mute', 'btn-theme', 'btn-rules',
      'rules-popover', 'btn-rules-close', 'arena',
      'footer-hint', 'footer-status', 'daily-share-wrap',
      'daily-share-summary', 'btn-share-daily', 'sr-announcer'
    ];
    for (const id of requiredIds) {
      assert.ok(html.includes(`id="${id}"`), `Missing id="${id}" in index.html`);
    }

    assert.match(html, /<header class="hud"/);
    assert.match(html, /<main class="stage"/);
    assert.match(html, /<footer class="footer-bar"/);
    assert.match(html, /<canvas[\s\S]*id="arena"[\s\S]*tabindex="0"[\s\S]*role="application"/);
    assert.match(html, /id="btn-rules"[\s\S]*aria-expanded="false"[\s\S]*aria-controls="rules-popover"/);
    assert.match(html, /id="rules-popover"[\s\S]*role="dialog"[\s\S]*hidden/);

    assert.match(css, /100dvh/);
    assert.match(css, /env\(safe-area-inset-top/);
    assert.match(css, /touch-action:\s*none/);
    assert.match(css, /min-width:\s*44px/);
    assert.match(css, /min-height:\s*44px/);
    assert.match(css, /tabular-nums/);
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
    assert.match(css, /#0F1117/);
    assert.match(css, /#F6F4EF/);
    assert.match(css, /#F59E0B/);
    assert.match(css, /#92400E/);
  });
});
