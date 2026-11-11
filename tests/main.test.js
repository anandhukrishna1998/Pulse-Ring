import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapPulseRing } from '../src/main.js';
import { MISS_RETRY_COOLDOWN } from '../src/game/state.js';

function createMockContext() {
  const ops = [];
  return {
    ops,
    save() {},
    restore() {},
    setTransform() {},
    createRadialGradient() {
      return { addColorStop() {} };
    },
    fillRect() {},
    beginPath() {},
    arc() {},
    moveTo(x, y) {
      ops.push({ op: 'moveTo', x, y });
    },
    lineTo() {},
    stroke() {},
    fill() {},
    fillText() {}
  };
}

function createFakeElement(id = '', tagName = 'DIV') {
  const listeners = new Map();
  const classes = new Set();
  const attrs = new Map();
  return {
    id,
    tagName,
    textContent: '',
    value: '',
    readOnly: false,
    hidden: false,
    disabled: false,
    dataset: {},
    style: {},
    focused: false,
    blurred: false,
    parentNode: null,
    children: [],
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, force) =>
        force === undefined
          ? classes.has(c)
            ? classes.delete(c)
            : classes.add(c)
          : force
            ? classes.add(c)
            : classes.delete(c),
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
    select() {},
    setSelectionRange() {},
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
    },
    removeChild(child) {
      child.parentNode = null;
      this.children = this.children.filter((c) => c !== child);
    },
    closest(selector) {
      if (selector.includes('button') && tagName === 'BUTTON') return this;
      if (selector.includes('[role="dialog"]') && attrs.get('role') === 'dialog') return this;
      return null;
    }
  };
}

function createFakeEnv({ prefersDark = true, reducedMotion = false, dpr = 2 } = {}) {
  const ctx = createMockContext();
  const canvas = createFakeElement('arena', 'CANVAS');
  canvas.width = 0;
  canvas.height = 0;
  canvas.clientWidth = 0;
  canvas.clientHeight = 0;
  canvas.getContext = (type) => (type === '2d' ? ctx : null);
  canvas.setAttribute('role', 'application');

  const ids = new Map([
    ['hud-level', createFakeElement('hud-level', 'SPAN')],
    ['hud-streak', createFakeElement('hud-streak', 'SPAN')],
    ['hud-best', createFakeElement('hud-best', 'SPAN')],
    ['btn-daily', createFakeElement('btn-daily', 'BUTTON')],
    ['btn-mute', createFakeElement('btn-mute', 'BUTTON')],
    ['btn-theme', createFakeElement('btn-theme', 'BUTTON')],
    ['btn-rules', createFakeElement('btn-rules', 'BUTTON')],
    ['rules-popover', createFakeElement('rules-popover', 'DIV')],
    ['btn-rules-close', createFakeElement('btn-rules-close', 'BUTTON')],
    ['footer-hint', createFakeElement('footer-hint', 'P')],
    ['footer-status', createFakeElement('footer-status', 'P')],
    ['daily-share-wrap', createFakeElement('daily-share-wrap', 'DIV')],
    ['daily-share-summary', createFakeElement('daily-share-summary', 'SPAN')],
    ['btn-share-daily', createFakeElement('btn-share-daily', 'BUTTON')],
    ['sr-announcer', createFakeElement('sr-announcer', 'DIV')],
    ['arena', canvas]
  ]);
  ids.get('rules-popover').hidden = true;
  ids.get('rules-popover').setAttribute('role', 'dialog');
  ids.get('footer-status').hidden = true;
  ids.get('daily-share-wrap').hidden = true;

  const stage = createFakeElement('stage', 'MAIN');
  let stageRect = { width: 800, height: 600 };
  stage.getBoundingClientRect = () => stageRect;

  const docListeners = new Map();
  const body = createFakeElement('body', 'BODY');
  const createdElements = [];
  const doc = {
    hidden: false,
    activeElement: body,
    documentElement: createFakeElement('html', 'HTML'),
    body,
    execCommandResult: true,
    execCommands: [],
    createdElements,
    getElementById: (id) => ids.get(id) ?? null,
    querySelector: (sel) => (sel === '.stage' ? stage : null),
    createElement(tag) {
      const el = createFakeElement('', tag.toUpperCase());
      createdElements.push(el);
      return el;
    },
    execCommand(cmd) {
      this.execCommands.push(cmd);
      return this.execCommandResult;
    },
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
        target: this.activeElement,
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

  const winListeners = new Map();
  const mqListeners = new Map();
  const rafQueue = new Map();
  let nextRafId = 1;
  let roCallback = null;

  class FakeResizeObserver {
    constructor(cb) {
      roCallback = cb;
      this.disconnected = false;
    }
    observe() {}
    disconnect() { this.disconnected = true; }
  }

  let currentDpr = dpr;
  let currentReduced = reducedMotion;
  const storageMap = new Map();

  const win = {
    get devicePixelRatio() { return currentDpr; },
    set devicePixelRatio(v) { currentDpr = v; },
    localStorage: {
      getItem: (k) => storageMap.get(k) ?? null,
      setItem: (k, v) => storageMap.set(k, String(v))
    },
    ResizeObserver: FakeResizeObserver,
    performance: { now: () => 0 },
    matchMedia(query) {
      if (query.includes('prefers-color-scheme: dark')) {
        return { matches: prefersDark };
      }
      if (query.includes('prefers-reduced-motion: reduce')) {
        return {
          get matches() { return currentReduced; },
          addEventListener(ev, fn) {
            if (!mqListeners.has(ev)) mqListeners.set(ev, []);
            mqListeners.get(ev).push(fn);
          },
          removeEventListener(ev, fn) {
            if (!mqListeners.has(ev)) return;
            mqListeners.set(ev, mqListeners.get(ev).filter((f) => f !== fn));
          }
        };
      }
      return { matches: false };
    },
    requestAnimationFrame(cb) {
      const id = nextRafId++;
      rafQueue.set(id, cb);
      return id;
    },
    cancelAnimationFrame(id) {
      rafQueue.delete(id);
    },
    addEventListener(ev, fn) {
      if (!winListeners.has(ev)) winListeners.set(ev, []);
      winListeners.get(ev).push(fn);
    },
    removeEventListener(ev, fn) {
      if (!winListeners.has(ev)) return;
      winListeners.set(ev, winListeners.get(ev).filter((f) => f !== fn));
    },
    dispatchWin(ev, obj = {}) {
      for (const fn of winListeners.get(ev) || []) fn(obj);
    },
    winListenerCount: (ev) => (winListeners.get(ev) || []).length,
    prompts: [],
    prompt(message, defaultText) {
      this.prompts.push([message, defaultText]);
      return defaultText;
    },
    navigator: {
      clipboard: {
        written: [],
        shouldFail: false,
        async writeText(text) {
          if (this.shouldFail) throw new Error('denied');
          this.written.push(text);
        }
      }
    }
  };

  function flushRaf(timestamp) {
    const entries = [...rafQueue.entries()];
    rafQueue.clear();
    for (const [, cb] of entries) {
      cb(timestamp);
    }
  }

  function triggerResize(width, height) {
    stageRect = { width, height };
    roCallback?.([{ contentRect: { width, height } }]);
  }

  function triggerReducedMotion(matches) {
    currentReduced = matches;
    for (const fn of mqListeners.get('change') || []) {
      fn({ matches });
    }
  }

  return {
    ctx,
    canvas,
    doc,
    win,
    ids,
    stage,
    storageMap,
    flushRaf,
    triggerResize,
    triggerReducedMotion,
    mqListenerCount: (ev) => (mqListeners.get(ev) || []).length
  };
}

describe('main bootstrap integration', () => {
  it('wires preferences, audio unlock on unmute/gesture, input guards, DPR resize, dt clamping, visibility pause, and clipboard fallbacks', async () => {
    const env = createFakeEnv({ prefersDark: false, reducedMotion: false, dpr: 2 });
    const audioCalls = [];
    const mockSynth = {
      muted: false,
      setMuted(m) {
        this.muted = m;
        audioCalls.push(['setMuted', m]);
      },
      isMuted() { return this.muted; },
      unlock() {
        audioCalls.push(['unlock', this.muted]);
      },
      playSnap(idx, perfect) {
        audioCalls.push(['playSnap', idx, perfect]);
      },
      playLevelClear(lvl) {
        audioCalls.push(['playLevelClear', lvl]);
      },
      playMiss() {
        audioCalls.push(['playMiss']);
      }
    };

    const app = bootstrapPulseRing({
      doc: env.doc,
      win: env.win,
      synth: mockSynth,
      dateKeyProvider: () => '2026-11-11',
      endlessSeed: 'bootstrap-test'
    });

    // Initial light preference from prefers-color-scheme: dark === false
    assert.equal(env.doc.documentElement.dataset.theme, 'light');
    assert.equal(env.canvas.width, 1600);
    assert.equal(env.canvas.height, 1200);

    // Non-primary mouse button and non-primary pointer ignored
    env.canvas.dispatch('pointerdown', { pointerType: 'mouse', button: 2 });
    env.canvas.dispatch('pointerdown', { pointerType: 'touch', isPrimary: false });
    assert.equal(audioCalls.filter((c) => c[0] === 'unlock').length, 0);

    // Align orb to arcCenter and press Space on document body -> unlocks & snaps PERFECT
    app.controller.state.orbAngle = app.controller.state.rings[0].arcCenter;
    const spaceRes = env.doc.dispatchDoc('keydown', { key: ' ', code: 'Space', target: env.doc.body });
    assert.equal(spaceRes.prevented, true);
    assert.deepEqual(audioCalls[1], ['unlock', false]);
    assert.deepEqual(audioCalls[2], ['playSnap', 1, true]);
    assert.equal(env.ids.get('hud-streak').textContent, '02');

    // Space & Enter when focused on a HUD button or inside dialog do NOT snap
    env.doc.activeElement = env.ids.get('btn-mute');
    const prevPhase = app.controller.state.phase;
    const btnSpace = env.doc.dispatchDoc('keydown', { key: ' ', code: 'Space', target: env.ids.get('btn-mute') });
    const btnEnter = env.doc.dispatchDoc('keydown', { key: 'Enter', code: 'Enter', target: env.ids.get('btn-mute') });
    assert.equal(btnSpace.prevented, false);
    assert.equal(btnEnter.prevented, false);
    assert.equal(app.controller.state.phase, prevPhase);
    env.doc.activeElement = env.doc.body;

    // Repeat & modifier keys ignored
    env.doc.dispatchDoc('keydown', { key: 'm', code: 'KeyM', repeat: true });
    assert.equal(mockSynth.muted, false);
    env.doc.dispatchDoc('keydown', { key: 'm', code: 'KeyM', ctrlKey: true });
    assert.equal(mockSynth.muted, false);
    env.doc.dispatchDoc('keydown', { key: 'm', code: 'KeyM', metaKey: true });
    assert.equal(mockSynth.muted, false);

    // Editable target ignores shortcuts
    const inputEl = createFakeElement('inp', 'INPUT');
    env.doc.dispatchDoc('keydown', { key: 't', code: 'KeyT', target: inputEl });
    assert.equal(env.doc.documentElement.dataset.theme, 'light');

    // M toggles mute on -> then off, and unmuting calls setMuted(false) BEFORE unlock()
    audioCalls.length = 0;
    env.doc.dispatchDoc('keydown', { key: 'm', code: 'KeyM', target: env.doc.body });
    assert.equal(mockSynth.muted, true);
    assert.equal(env.ids.get('sr-announcer').textContent, 'Audio muted.');
    env.doc.dispatchDoc('keydown', { key: 'M', code: 'KeyM', target: env.doc.body });
    assert.equal(mockSynth.muted, false);
    assert.deepEqual(audioCalls, [['setMuted', true], ['setMuted', false], ['unlock', false]]);
    assert.equal(env.ids.get('sr-announcer').textContent, 'Audio unmuted.');

    // T toggles theme
    env.doc.dispatchDoc('keydown', { key: 't', code: 'KeyT', target: env.doc.body });
    assert.equal(env.doc.documentElement.dataset.theme, 'dark');

    // ? opens rules and pauses game; pointerdown & Enter on arena while rules open do NOT snap
    const qRes = env.doc.dispatchDoc('keydown', { key: '?', code: 'Slash', shiftKey: true, target: env.doc.body });
    assert.equal(qRes.prevented, true);
    assert.equal(app.hud.isRulesOpen(), true);
    assert.equal(app.controller.state.paused, true);

    const pausedAngle = app.controller.state.orbAngle;
    env.flushRaf(100);
    env.flushRaf(116);
    assert.equal(app.controller.state.orbAngle, pausedAngle);

    const callsDuringRulesSnap = audioCalls.length;
    env.canvas.dispatch('pointerdown', { pointerType: 'touch', button: 0 });
    env.doc.dispatchDoc('keydown', { key: 'Enter', code: 'Enter', target: env.doc.body });
    assert.equal(app.controller.state.phase, 'snapping');
    assert.equal(audioCalls.length, callsDuringRulesSnap);

    // H closes rules with focus restored to #btn-rules
    env.doc.dispatchDoc('keydown', { key: 'h', code: 'KeyH', target: env.doc.body });
    assert.equal(app.hud.isRulesOpen(), false);
    assert.equal(app.controller.state.paused, false);
    assert.equal(env.ids.get('btn-rules').focused, true);

    // RAF dt clamping after pause/resume + huge jump clamped to 0.05s
    env.flushRaf(1000);
    env.flushRaf(6000); // 5000ms jump -> clamped to 0.05s -> still snapping
    assert.equal(app.controller.state.phase, 'snapping');
    env.flushRaf(6050);
    env.flushRaf(6100);
    assert.equal(app.controller.state.phase, 'playing');
    assert.equal(app.controller.state.activeRingIndex, 1);

    // Rules open guard also blocks pointerdown, Space, and Enter during 'playing' phase without calling synth.unlock()
    env.doc.dispatchDoc('keydown', { key: '?', code: 'Slash', shiftKey: true, target: env.doc.body });
    assert.equal(app.hud.isRulesOpen(), true);
    const callsDuringRulesPlaying = audioCalls.length;
    env.canvas.dispatch('pointerdown', { pointerType: 'touch', button: 0 });
    env.doc.dispatchDoc('keydown', { key: ' ', code: 'Space', target: env.doc.body });
    env.doc.dispatchDoc('keydown', { key: 'Enter', code: 'Enter', target: env.doc.body });
    assert.equal(app.controller.state.phase, 'playing');
    assert.equal(audioCalls.length, callsDuringRulesPlaying);
    env.doc.dispatchDoc('keydown', { key: 'h', code: 'KeyH', target: env.doc.body });
    assert.equal(app.hud.isRulesOpen(), false);

    // Complete level 1 -> level_clear -> transitions to level 2 in RAF & updates HUD
    app.controller.state.orbAngle = app.controller.state.rings[1].arcCenter;
    env.canvas.dispatch('pointerdown', { pointerType: 'mouse', button: 0 });
    assert.equal(app.controller.state.phase, 'level_clear');
    assert.ok(audioCalls.some((c) => c[0] === 'playLevelClear' && c[1] === 1));
    for (let t = 6150; t <= 6450; t += 50) {
      env.flushRaf(t);
    }
    assert.equal(app.controller.state.level, 2);
    assert.equal(env.ids.get('hud-level').textContent, '02');
    assert.match(env.ids.get('sr-announcer').textContent, /Level 2 started/);

    // visibilitychange pauses on hidden and resets timestamp on return; blur/focus resets timestamp
    env.doc.hidden = true;
    env.doc.dispatchDoc('visibilitychange');
    assert.equal(app.controller.state.paused, true);
    const angleBeforeHide = app.controller.state.orbAngle;
    env.flushRaf(10000);
    assert.equal(app.controller.state.orbAngle, angleBeforeHide);

    env.doc.hidden = false;
    env.doc.dispatchDoc('visibilitychange');
    assert.equal(app.controller.state.paused, false);
    env.flushRaf(20000);
    assert.equal(app.controller.state.orbAngle, angleBeforeHide);

    env.win.dispatchWin('blur');
    env.flushRaf(25000);
    assert.equal(app.controller.state.orbAngle, angleBeforeHide);

    // ResizeObserver & DPR change & window resize fallback & reduced motion media query
    env.win.devicePixelRatio = 3;
    env.triggerResize(500, 700);
    assert.equal(env.canvas.width, 1500);
    assert.equal(env.canvas.height, 2100);
    env.win.devicePixelRatio = 2;
    env.win.dispatchWin('resize');
    assert.equal(env.canvas.width, 1000);
    assert.equal(env.canvas.height, 1400);

    // Build trail samples under normal motion (>2 moveTo ops), then switch reduced-motion ON (trail suppressed -> 2 notch moveTos only)
    env.ctx.ops.length = 0;
    env.flushRaf(25050);
    env.flushRaf(25070);
    const moveTosWithTrail = env.ctx.ops.filter((o) => o.op === 'moveTo').length;
    assert.ok(moveTosWithTrail > 2);

    env.ctx.ops.length = 0;
    env.triggerReducedMotion(true);
    const moveTosReduced = env.ctx.ops.filter((o) => o.op === 'moveTo').length;
    assert.equal(moveTosReduced, 2);

    // Daily mode toggle (D), miss, unique sr-announcer, and 3-tier Share clipboard fallback
    env.doc.dispatchDoc('keydown', { key: 'd', code: 'KeyD', target: env.doc.body });
    assert.equal(app.controller.state.mode, 'daily');
    assert.match(env.ids.get('sr-announcer').textContent, /2026-11-11/);

    app.controller.state.orbAngle = app.controller.state.rings[0].arcCenter + Math.PI;
    env.canvas.dispatch('pointerdown', { pointerType: 'touch', button: 0 });
    assert.equal(app.controller.state.phase, 'missed');
    const missMsg1 = env.ids.get('sr-announcer').textContent;
    assert.match(missMsg1, /^Daily run ended on level 1, streak 0\. Attempt 1\.$/);

    // Tier 1: navigator.clipboard.writeText succeeds (must NOT invoke execCommand or win.prompt)
    const shareBtn = env.ids.get('btn-share-daily');
    shareBtn.dispatch('click', { detail: 1 });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(env.win.navigator.clipboard.written.length, 1);
    assert.match(env.win.navigator.clipboard.written[0], /PULSE RING · Daily 2026-11-11/);
    assert.equal(env.doc.execCommands.length, 0);
    assert.equal(env.win.prompts.length, 0);
    assert.equal(shareBtn.textContent, 'Copied!');

    // Tier 2: read-only textarea + execCommand('copy') succeeds & restores focus (must NOT invoke win.prompt)
    env.win.navigator.clipboard.shouldFail = true;
    const prevFocusTarget = env.ids.get('btn-daily');
    prevFocusTarget.focused = false;
    env.doc.activeElement = prevFocusTarget;
    shareBtn.dispatch('click', { detail: 0 });
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(env.doc.execCommands, ['copy']);
    assert.equal(env.doc.createdElements.at(-1).readOnly, true);
    assert.equal(env.doc.createdElements.at(-1).parentNode, null);
    assert.equal(prevFocusTarget.focused, true);
    assert.equal(env.win.prompts.length, 0);
    assert.equal(shareBtn.textContent, 'Copied!');
    env.doc.activeElement = env.doc.body;

    // Bounce guard ignores tap before MISS_RETRY_COOLDOWN (0.16s), then 4x 0.05s steps unlock retry
    app.controller.step(0.05);
    env.canvas.dispatch('pointerdown', { pointerType: 'touch', button: 0 });
    assert.equal(app.controller.state.phase, 'missed');

    for (let i = 0; i < 4; i++) {
      app.controller.step(0.05);
    }
    assert.ok(app.controller.state.missElapsed >= MISS_RETRY_COOLDOWN);
    env.canvas.dispatch('pointerdown', { pointerType: 'touch', button: 0 });
    assert.equal(app.controller.state.phase, 'playing');
    assert.equal(app.controller.state.level, 1);
    assert.match(env.ids.get('sr-announcer').textContent, /^Daily run restarted at level 1\. Attempt 2\.$/);

    // Advance RAF, trigger second miss, verify new miss announcement & Tier 3 win.prompt + lastTimestamp reset
    env.flushRaf(30000);
    env.flushRaf(30016);
    const missCallsBefore = audioCalls.filter((c) => c[0] === 'playMiss').length;
    app.controller.state.orbAngle = app.controller.state.rings[0].arcCenter + Math.PI;
    env.canvas.dispatch('pointerdown', { pointerType: 'touch', button: 0 });
    assert.equal(app.controller.state.phase, 'missed');
    assert.equal(audioCalls.filter((c) => c[0] === 'playMiss').length, missCallsBefore + 1);
    const missMsg2 = env.ids.get('sr-announcer').textContent;
    assert.match(missMsg2, /^Daily run ended on level 1, streak 0\. Attempt 3\.$/);
    assert.notEqual(missMsg1, missMsg2);

    env.doc.execCommandResult = false;
    shareBtn.dispatch('click', { detail: 0 });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(env.win.prompts.length, 1);
    assert.equal(env.win.prompts[0][0], 'Copy your PULSE RING Daily result:');
    assert.match(env.win.prompts[0][1], /PULSE RING · Daily 2026-11-11/);
    assert.equal(shareBtn.textContent, 'Copy Manually');

    const missElapsedBeforePrompt = app.controller.state.missElapsed;
    env.flushRaf(90000);
    assert.equal(app.controller.state.missElapsed, missElapsedBeforePrompt);

    // Cleanup removes all listeners
    app.destroy();
    assert.equal(env.doc.docListenerCount('keydown'), 0);
    assert.equal(env.doc.docListenerCount('visibilitychange'), 0);
    assert.equal(env.win.winListenerCount('resize'), 0);
    assert.equal(env.canvas.listenerCount('pointerdown'), 0);
    assert.equal(env.mqListenerCount('change'), 0);
  });

  it('routes Escape key in handleKeyDown when mocked options.hud is open and survives throwing win.localStorage getter', () => {
    const env = createFakeEnv({ prefersDark: true, reducedMotion: false, dpr: 1 });
    Object.defineProperty(env.win, 'localStorage', {
      get() {
        throw new Error('SecurityError');
      }
    });

    let rulesOpen = true;
    const closeCalls = [];
    const mockHud = {
      sync() {},
      announce() {},
      openRules() { rulesOpen = true; },
      closeRules(opts) {
        closeCalls.push(opts);
        rulesOpen = false;
      },
      isRulesOpen() { return rulesOpen; },
      destroy() {}
    };

    const app = bootstrapPulseRing({
      doc: env.doc,
      win: env.win,
      hud: mockHud
    });

    // Escape with key: 'Escape' closes rules and prevents default
    const escByKey = env.doc.dispatchDoc('keydown', { key: 'Escape', target: env.doc.body });
    assert.equal(escByKey.prevented, true);
    assert.deepEqual(closeCalls, [{ restoreFocus: true }]);
    assert.equal(rulesOpen, false);

    // Pressing Escape while already closed does NOT call closeRules redundantly or preventDefault
    const escWhenClosed = env.doc.dispatchDoc('keydown', { key: 'Escape', target: env.doc.body });
    assert.equal(escWhenClosed.prevented, false);
    assert.equal(closeCalls.length, 1);

    // Escape matched via code: 'Escape' when key is empty/non-standard
    rulesOpen = true;
    const escByCode = env.doc.dispatchDoc('keydown', { key: '', code: 'Escape', target: env.doc.body });
    assert.equal(escByCode.prevented, true);
    assert.deepEqual(closeCalls, [{ restoreFocus: true }, { restoreFocus: true }]);
    assert.equal(rulesOpen, false);

    app.destroy();
  });
});
