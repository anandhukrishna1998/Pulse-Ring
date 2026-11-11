import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasRenderer, THEME_PALETTES } from '../src/render/canvas-renderer.js';
import { createGameController, SNAP_DURATION, LEVEL_CLEAR_DURATION } from '../src/game/state.js';

function createMockContext() {
  const ops = [];
  const state = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    globalAlpha: 1,
    shadowColor: '',
    shadowBlur: 0,
    font: '',
    fontVariantNumeric: '',
    textAlign: 'start',
    textBaseline: 'alphabetic'
  };
  const stack = [];
  return {
    ops,
    get fillStyle() { return state.fillStyle; },
    set fillStyle(v) { state.fillStyle = v; },
    get strokeStyle() { return state.strokeStyle; },
    set strokeStyle(v) { state.strokeStyle = v; },
    get lineWidth() { return state.lineWidth; },
    set lineWidth(v) { state.lineWidth = v; },
    get lineCap() { return state.lineCap; },
    set lineCap(v) { state.lineCap = v; },
    get globalAlpha() { return state.globalAlpha; },
    set globalAlpha(v) { state.globalAlpha = v; },
    get shadowColor() { return state.shadowColor; },
    set shadowColor(v) { state.shadowColor = v; },
    get shadowBlur() { return state.shadowBlur; },
    set shadowBlur(v) { state.shadowBlur = v; },
    get font() { return state.font; },
    set font(v) { state.font = v; },
    get fontVariantNumeric() { return state.fontVariantNumeric; },
    set fontVariantNumeric(v) { state.fontVariantNumeric = v; },
    get textAlign() { return state.textAlign; },
    set textAlign(v) { state.textAlign = v; },
    get textBaseline() { return state.textBaseline; },
    set textBaseline(v) { state.textBaseline = v; },
    save() {
      stack.push({ ...state });
    },
    restore() {
      const prev = stack.pop();
      if (prev) Object.assign(state, prev);
    },
    setTransform(a, b, c, d, e, f) {
      ops.push({ op: 'setTransform', args: [a, b, c, d, e, f] });
    },
    createRadialGradient() {
      const stops = [];
      return {
        stops,
        addColorStop(offset, color) {
          stops.push([offset, color]);
        }
      };
    },
    fillRect(x, y, w, h) {
      ops.push({ op: 'fillRect', args: [x, y, w, h], fillStyle: state.fillStyle, alpha: state.globalAlpha });
    },
    beginPath() {
      ops.push({ op: 'beginPath' });
    },
    arc(x, y, r, start, end) {
      ops.push({ op: 'arc', x, y, r, start, end });
    },
    moveTo(x, y) {
      ops.push({ op: 'moveTo', x, y });
    },
    lineTo(x, y) {
      ops.push({ op: 'lineTo', x, y });
    },
    stroke() {
      ops.push({
        op: 'stroke',
        strokeStyle: state.strokeStyle,
        lineWidth: state.lineWidth,
        lineCap: state.lineCap,
        alpha: state.globalAlpha,
        shadowBlur: state.shadowBlur,
        shadowColor: state.shadowColor
      });
    },
    fill() {
      ops.push({
        op: 'fill',
        fillStyle: state.fillStyle,
        alpha: state.globalAlpha
      });
    },
    fillText(text, x, y) {
      ops.push({
        op: 'fillText',
        text,
        x,
        y,
        fillStyle: state.fillStyle,
        font: state.font,
        shadowColor: state.shadowColor
      });
    }
  };
}

function createMockCanvas(ctx) {
  return {
    width: 0,
    height: 0,
    clientWidth: 0,
    clientHeight: 0,
    getContext: (type) => (type === '2d' ? ctx : null)
  };
}

describe('canvas-renderer', () => {
  it('exposes exact THEME_PALETTES and performs exact DPR scaling with non-accumulating transforms', () => {
    assert.deepEqual(THEME_PALETTES.dark, {
      bgGround: '#0F1117',
      bgGlow: '#161B26',
      ringActive: '#CBD5E1',
      ringIdle: 'rgba(203, 213, 225, 0.22)',
      ringCleared: 'rgba(203, 213, 225, 0.10)',
      arcTarget: '#F59E0B',
      arcPerfect: '#FDE68A',
      orb: '#FB7185',
      orbCore: '#FFF1F2',
      miss: '#F87171',
      textPrimary: '#E2E8F0',
      textMuted: '#94A3B8'
    });
    assert.deepEqual(THEME_PALETTES.light, {
      bgGround: '#F6F4EF',
      bgGlow: '#FFFFFF',
      ringActive: '#2B2E38',
      ringIdle: 'rgba(43, 46, 56, 0.18)',
      ringCleared: 'rgba(43, 46, 56, 0.09)',
      arcTarget: '#D97706',
      arcPerfect: '#92400E',
      orb: '#E11D48',
      orbCore: '#FFFFFF',
      miss: '#DC2626',
      textPrimary: '#1E2028',
      textMuted: '#525766'
    });

    const ctx = createMockContext();
    const canvas = createMockCanvas(ctx);
    const renderer = createCanvasRenderer(canvas);

    renderer.resize(375.4, 500.2, 2);
    assert.equal(canvas.width, Math.round(375.4 * 2));
    assert.equal(canvas.height, Math.round(500.2 * 2));
    assert.deepEqual(ctx.ops.at(-1), { op: 'setTransform', args: [2, 0, 0, 2, 0, 0] });

    // Invalid DPR values fall back safely to 1
    for (const invalidDpr of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      renderer.resize(300, 400, invalidDpr);
      assert.equal(canvas.width, 300);
      assert.equal(canvas.height, 400);
      assert.deepEqual(ctx.ops.at(-1), { op: 'setTransform', args: [1, 0, 0, 1, 0, 0] });
    }

    // Every render resets transform via setTransform without accumulating
    renderer.resize(400, 400, 3);
    ctx.ops.length = 0;
    const game = createGameController();
    renderer.render(game.getSnapshot());
    const transforms = ctx.ops.filter((o) => o.op === 'setTransform');
    assert.equal(transforms.length, 1);
    assert.deepEqual(transforms[0].args, [3, 0, 0, 3, 0, 0]);
  });

  it('renders ring hierarchy, target/perfect arcs, snap glide vs reduced motion, trail suppression, ripples, and core counter without mutating state', () => {
    const ctx = createMockContext();
    const canvas = createMockCanvas(ctx);
    const renderer = createCanvasRenderer(canvas, { theme: 'dark', reducedMotion: false });
    renderer.resize(500, 500, 1);

    const state = {
      phase: 'snapping',
      activeRingIndex: 1,
      orbAngle: 0,
      phaseTimer: SNAP_DURATION * 0.5,
      snapFromRadiusRatio: 0.94,
      snapToRadiusRatio: 0.56,
      missElapsed: 0,
      rings: [
        { radiusRatio: 0.94, arcCenter: 1.0, arcWidth: 1.2 },
        { radiusRatio: 0.56, arcCenter: 2.0, arcWidth: 1.0 },
        { radiusRatio: 0.38, arcCenter: 0.5, arcWidth: 0.8 }
      ],
      trail: [
        { angle: -0.2, radiusRatio: 0.94 },
        { angle: -0.1, radiusRatio: 0.80 }
      ],
      ripples: [
        { type: 'hit', angle: 0.2, radiusRatio: 0.94, age: 0.1, duration: 0.36 },
        { type: 'perfect', angle: 0, radiusRatio: 0.94, age: 0.12, duration: 0.48 }
      ]
    };
    const frozenSnapshot = JSON.stringify(state);

    renderer.render(state);
    assert.equal(JSON.stringify(state), frozenSnapshot);

    // Ring hierarchy strokes: cleared (0), active (1), idle (2), plus target & perfect arcs
    const strokes = ctx.ops.filter((o) => o.op === 'stroke');
    assert.ok(strokes.some((s) => s.strokeStyle === THEME_PALETTES.dark.ringCleared));
    assert.ok(strokes.some((s) => s.strokeStyle === THEME_PALETTES.dark.ringActive));
    assert.ok(strokes.some((s) => s.strokeStyle === THEME_PALETTES.dark.ringIdle));
    assert.ok(strokes.some((s) => s.strokeStyle === THEME_PALETTES.dark.arcTarget));
    assert.ok(strokes.some((s) => s.strokeStyle === THEME_PALETTES.dark.arcPerfect));

    // Core counter displays remaining rings (3 - 1 = 2)
    const texts = ctx.ops.filter((o) => o.op === 'fillText');
    assert.equal(texts.length, 1);
    assert.equal(texts[0].text, '2');
    assert.equal(texts[0].fillStyle, THEME_PALETTES.dark.textPrimary);

    // Ease-out at t=0.5 -> eased = 1 - 0.5^3 = 0.875
    const maxRadius = Math.max(24, 500 * 0.41);
    const expectedEasedRatio = 0.94 + (0.56 - 0.94) * 0.875;
    const expectedOrbX = 250 + expectedEasedRatio * maxRadius;
    const orbCoreFills = ctx.ops.filter((o) => o.op === 'fill' && o.fillStyle === THEME_PALETTES.dark.orbCore);
    assert.equal(orbCoreFills.length, 1);
    const orbCoreArc = ctx.ops[ctx.ops.lastIndexOf(orbCoreFills[0]) - 1];
    assert.ok(Math.abs(orbCoreArc.x - expectedOrbX) < 1e-6);

    // Motion trail moveTo calls present when reducedMotion === false (2 center notch ticks + 2 trail segments)
    const moveTosNormal = ctx.ops.filter((o) => o.op === 'moveTo').length;
    assert.equal(moveTosNormal, 4);

    // Single-sample trail branch renders cleanly
    ctx.ops.length = 0;
    renderer.render({ ...state, trail: [{ angle: -0.1, radiusRatio: 0.8 }] });
    assert.equal(ctx.ops.filter((o) => o.op === 'moveTo').length, 3);

    // Switch to reducedMotion === true: orb jumps directly to snapToRadiusRatio & trails omitted
    ctx.ops.length = 0;
    renderer.setReducedMotion(true);
    renderer.render(state);
    const orbCoreFillsRM = ctx.ops.filter((o) => o.op === 'fill' && o.fillStyle === THEME_PALETTES.dark.orbCore);
    const orbCoreArcRM = ctx.ops[ctx.ops.lastIndexOf(orbCoreFillsRM[0]) - 1];
    const expectedJumpX = 250 + 0.56 * maxRadius;
    assert.ok(Math.abs(orbCoreArcRM.x - expectedJumpX) < 1e-6);
    assert.equal(ctx.ops.filter((o) => o.op === 'moveTo').length, 2);

    // Light theme & level_clear amber core glow + counter 0 (note: light bgGlow & orbCore are both #FFFFFF)
    ctx.ops.length = 0;
    renderer.setTheme('light');
    renderer.render({
      ...state,
      phase: 'level_clear',
      phaseTimer: LEVEL_CLEAR_DURATION * 0.5,
      activeRingIndex: 3,
      ripples: [{ type: 'level_clear', angle: 0, radiusRatio: 0.38, age: 0.05, duration: 0.5 }],
      trail: []
    });
    const clearText = ctx.ops.find((o) => o.op === 'fillText');
    assert.equal(clearText.text, '0');
    assert.equal(clearText.fillStyle, THEME_PALETTES.light.arcTarget);
    // Reduced motion hides level_clear gliding orb (no orb body fill with palette.orb)
    assert.equal(
      ctx.ops.filter((o) => o.op === 'fill' && o.fillStyle === THEME_PALETTES.light.orb).length,
      0
    );

    // Normal motion glides orb during level_clear & renders miss highlight/ripple in missed phase
    ctx.ops.length = 0;
    renderer.setReducedMotion(false);
    renderer.render({
      ...state,
      phase: 'level_clear',
      phaseTimer: LEVEL_CLEAR_DURATION * 0.5,
      activeRingIndex: 3,
      ripples: [{ type: 'level_clear', angle: 0, radiusRatio: 0.38, age: 0.05, duration: 0.5 }],
      trail: []
    });
    assert.equal(
      ctx.ops.filter((o) => o.op === 'fill' && o.fillStyle === THEME_PALETTES.light.orb).length,
      2
    );

    ctx.ops.length = 0;
    renderer.render({
      ...state,
      phase: 'missed',
      missElapsed: 0.1,
      ripples: [{ type: 'miss', angle: 1.5, radiusRatio: 0.56, age: 0.1, duration: 0.4 }],
      trail: []
    });
    assert.ok(ctx.ops.some((o) => o.op === 'stroke' && o.strokeStyle === THEME_PALETTES.light.miss));
    assert.equal(ctx.ops.find((o) => o.op === 'fillText').fillStyle, THEME_PALETTES.light.miss);
  });

  it('handles null canvas, missing 2d context, zero size, and tiny viewport maxRadius clamp safely', () => {
    const nullRenderer = createCanvasRenderer(null);
    nullRenderer.resize(400, 400, 2);
    nullRenderer.setTheme('light');
    nullRenderer.setReducedMotion(true);
    nullRenderer.render({ rings: [] });

    const noCtxRenderer = createCanvasRenderer({ getContext: () => null });
    noCtxRenderer.resize(200, 200, 1);
    noCtxRenderer.render({ rings: [] });

    const ctx = createMockContext();
    const zeroRenderer = createCanvasRenderer(createMockCanvas(ctx));
    zeroRenderer.resize(0, 0, 1);
    zeroRenderer.render({ rings: [] });
    assert.equal(ctx.ops.filter((o) => o.op === 'fillRect').length, 0);

    // Tiny viewport clamps maxRadius to 24
    zeroRenderer.resize(40, 40, 1);
    zeroRenderer.render({
      phase: 'playing',
      activeRingIndex: 0,
      orbAngle: 0,
      rings: [{ radiusRatio: 0.94, arcCenter: 0, arcWidth: 1.0 }],
      ripples: [],
      trail: []
    });
    const ringArc = ctx.ops.find((o) => o.op === 'arc' && Math.abs(o.r - 0.94 * 24) < 1e-6);
    assert.ok(ringArc, 'Expected outer ring radius to use clamped maxRadius = 24');
  });
});
