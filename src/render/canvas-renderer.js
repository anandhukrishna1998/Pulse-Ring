const SNAP_DURATION = 0.14;
const LEVEL_CLEAR_DURATION = 0.26;
const PERFECT_RATIO = 0.28;
const TWO_PI = Math.PI * 2;
const FONT_FAMILY =
  '"Avenir Next", "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", system-ui, -apple-system, sans-serif';

export const THEME_PALETTES = Object.freeze({
  dark: Object.freeze({
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
  }),
  light: Object.freeze({
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
  })
});

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function easeOutCubic(t) {
  const inv = 1 - clamp01(t);
  return 1 - inv * inv * inv;
}

function polarX(cx, radius, angle) {
  return cx + Math.cos(angle) * radius;
}

function polarY(cy, radius, angle) {
  return cy + Math.sin(angle) * radius;
}

/**
 * Create a DPR-aware 2D Canvas renderer for Pulse Ring.
 * @param {HTMLCanvasElement | null} canvas
 * @param {{ theme?: 'dark' | 'light', reducedMotion?: boolean }} [options]
 */
export function createCanvasRenderer(canvas, options = {}) {
  const ctx =
    canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;

  let theme = options?.theme === 'light' ? 'light' : 'dark';
  let reducedMotion = Boolean(options?.reducedMotion);
  let cssW =
    Number.isFinite(canvas?.clientWidth) && canvas.clientWidth > 0 ? canvas.clientWidth : 0;
  let cssH =
    Number.isFinite(canvas?.clientHeight) && canvas.clientHeight > 0 ? canvas.clientHeight : 0;
  let safeDpr = 1;

  function applyTransform() {
    if (ctx && typeof ctx.setTransform === 'function') {
      ctx.setTransform(safeDpr, 0, 0, safeDpr, 0, 0);
    }
  }

  function resize(width, height, dpr = 1) {
    cssW = Number.isFinite(width) && width > 0 ? width : 0;
    cssH = Number.isFinite(height) && height > 0 ? height : 0;
    safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;

    if (canvas) {
      canvas.width = Math.round(cssW * safeDpr);
      canvas.height = Math.round(cssH * safeDpr);
    }
    applyTransform();
  }

  function setTheme(nextTheme) {
    theme = nextTheme === 'light' ? 'light' : 'dark';
  }

  function setReducedMotion(reduced) {
    reducedMotion = Boolean(reduced);
  }

  function drawBackground(palette, cx, cy) {
    const gradRadius = Math.max(1, Math.hypot(cx, cy));
    if (typeof ctx.createRadialGradient === 'function') {
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, gradRadius);
      if (grad && typeof grad.addColorStop === 'function') {
        grad.addColorStop(0, palette.bgGlow);
        grad.addColorStop(0.72, palette.bgGround);
        grad.addColorStop(1, palette.bgGround);
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = palette.bgGround;
      }
    } else {
      ctx.fillStyle = palette.bgGround;
    }
    ctx.fillRect(0, 0, cssW, cssH);
  }

  function drawRings(palette, cx, cy, maxRadius, scale, rings, activeRingIndex, phase, missElapsed) {
    const clearedWidth = Math.max(1, 1.25 * scale);
    const idleWidth = Math.max(1.25, 1.5 * scale);
    const activeWidth = Math.max(1.75, 2.2 * scale);

    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i];
      if (!ring || !Number.isFinite(ring.radiusRatio) || ring.radiusRatio <= 0) continue;

      const r = ring.radiusRatio * maxRadius;
      const isCleared = i < activeRingIndex;
      const isActive = i === activeRingIndex && phase !== 'level_clear';

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TWO_PI);

      if (isActive) {
        ctx.strokeStyle = palette.ringActive;
        ctx.lineWidth = activeWidth;
      } else if (isCleared) {
        ctx.strokeStyle = palette.ringCleared;
        ctx.lineWidth = clearedWidth;
      } else {
        ctx.strokeStyle = palette.ringIdle;
        ctx.lineWidth = idleWidth;
      }
      ctx.stroke();

      if (isActive && phase === 'missed') {
        const missAlpha = reducedMotion
          ? 0.55
          : 0.5 + 0.25 * Math.sin((missElapsed || 0) * 7);
        ctx.save();
        ctx.globalAlpha = clamp01(missAlpha);
        ctx.strokeStyle = palette.miss;
        ctx.lineWidth = activeWidth * 1.9;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, TWO_PI);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawTargetArc(palette, cx, cy, maxRadius, scale, activeRing, phase) {
    if (!activeRing || phase === 'level_clear') return;
    if (!Number.isFinite(activeRing.radiusRatio) || activeRing.radiusRatio <= 0) return;

    const r = activeRing.radiusRatio * maxRadius;
    const center = Number.isFinite(activeRing.arcCenter) ? activeRing.arcCenter : 0;
    const width = Number.isFinite(activeRing.arcWidth) ? Math.max(0.02, activeRing.arcWidth) : 0.8;
    const halfArc = width / 2;
    const perfectHalf = halfArc * PERFECT_RATIO;

    const targetStroke = Math.max(4.5, 6.2 * scale);
    const perfectStroke = Math.max(2.1, 2.8 * scale);
    const arcAlpha = phase === 'missed' ? 0.65 : 1;

    ctx.save();
    ctx.globalAlpha = arcAlpha;
    ctx.lineCap = 'round';

    // Target arc with subtle ambient glow
    ctx.save();
    ctx.strokeStyle = palette.arcTarget;
    ctx.lineWidth = targetStroke;
    ctx.shadowColor = palette.arcTarget;
    ctx.shadowBlur = reducedMotion ? 3 : Math.max(6, 12 * scale);
    ctx.beginPath();
    ctx.arc(cx, cy, r, center - halfArc, center + halfArc);
    ctx.stroke();
    ctx.restore();

    // Inner PERFECT sweet-spot band
    ctx.strokeStyle = palette.arcPerfect;
    ctx.lineWidth = perfectStroke;
    ctx.beginPath();
    ctx.arc(cx, cy, r, center - perfectHalf, center + perfectHalf);
    ctx.stroke();

    // Center notch ticks straddling the sweet-spot midpoint
    const cosA = Math.cos(center);
    const sinA = Math.sin(center);
    const innerGap = targetStroke * 0.52;
    const outerReach = targetStroke * 1.18;
    ctx.lineWidth = Math.max(1.4, 1.8 * scale);

    ctx.beginPath();
    ctx.moveTo(cx + cosA * Math.max(2, r - outerReach), cy + sinA * Math.max(2, r - outerReach));
    ctx.lineTo(cx + cosA * Math.max(2, r - innerGap), cy + sinA * Math.max(2, r - innerGap));
    ctx.moveTo(cx + cosA * (r + innerGap), cy + sinA * (r + innerGap));
    ctx.lineTo(cx + cosA * (r + outerReach), cy + sinA * (r + outerReach));
    ctx.stroke();

    ctx.restore();
  }

  function drawRipples(palette, cx, cy, maxRadius, scale, orbRadius, ripples) {
    if (!Array.isArray(ripples) || ripples.length === 0) return;

    for (const ripple of ripples) {
      if (!ripple) continue;
      const duration = Number.isFinite(ripple.duration) && ripple.duration > 0 ? ripple.duration : 0.4;
      const t = clamp01((ripple.age || 0) / duration);
      if (t >= 1) continue;

      const ease = easeOutCubic(t);
      const fade = 1 - t;
      const ringRadius = Number.isFinite(ripple.radiusRatio) ? ripple.radiusRatio * maxRadius : 0;
      const angle = Number.isFinite(ripple.angle) ? ripple.angle : 0;
      const sx = polarX(cx, ringRadius, angle);
      const sy = polarY(cy, ringRadius, angle);

      if (ripple.type === 'hit') {
        ctx.save();
        ctx.strokeStyle = palette.arcTarget;
        ctx.lineWidth = Math.max(1.5, 2.2 * scale);
        if (reducedMotion) {
          ctx.globalAlpha = 0.55 * fade;
          ctx.beginPath();
          ctx.arc(sx, sy, orbRadius * 1.9, 0, TWO_PI);
          ctx.stroke();
        } else {
          const radius = orbRadius + maxRadius * 0.18 * ease;
          ctx.globalAlpha = 0.78 * fade;
          ctx.beginPath();
          ctx.arc(sx, sy, radius, 0, TWO_PI);
          ctx.stroke();
        }
        ctx.restore();
      } else if (ripple.type === 'perfect') {
        ctx.save();
        if (reducedMotion) {
          ctx.strokeStyle = palette.arcPerfect;
          ctx.lineWidth = Math.max(1.8, 2.4 * scale);
          ctx.globalAlpha = 0.6 * fade;
          ctx.beginPath();
          ctx.arc(sx, sy, orbRadius * 2.1, 0, TWO_PI);
          ctx.stroke();

          ctx.strokeStyle = palette.arcTarget;
          ctx.lineWidth = Math.max(1.4, 1.8 * scale);
          ctx.globalAlpha = 0.4 * fade;
          ctx.beginPath();
          ctx.arc(sx, sy, orbRadius * 2.8, 0, TWO_PI);
          ctx.stroke();
        } else {
          // Primary crisp wave
          const r1 = orbRadius + maxRadius * 0.28 * ease;
          ctx.strokeStyle = palette.arcPerfect;
          ctx.lineWidth = Math.max(1.8, 2.5 * scale);
          ctx.globalAlpha = 0.88 * fade;
          ctx.beginPath();
          ctx.arc(sx, sy, r1, 0, TWO_PI);
          ctx.stroke();

          // Secondary harmonic wave
          const t2 = clamp01((t - 0.14) / 0.86);
          if (t2 > 0) {
            const ease2 = easeOutCubic(t2);
            const r2 = orbRadius * 0.9 + maxRadius * 0.22 * ease2;
            ctx.strokeStyle = palette.arcTarget;
            ctx.lineWidth = Math.max(1.4, 1.9 * scale);
            ctx.globalAlpha = 0.72 * (1 - t2);
            ctx.beginPath();
            ctx.arc(sx, sy, r2, 0, TWO_PI);
            ctx.stroke();
          }
        }
        ctx.restore();
      } else if (ripple.type === 'level_clear') {
        ctx.save();
        if (reducedMotion) {
          ctx.globalAlpha = 0.22 * fade;
          ctx.fillStyle = palette.arcTarget;
          ctx.beginPath();
          ctx.arc(cx, cy, maxRadius * 0.45, 0, TWO_PI);
          ctx.fill();
        } else {
          const startR = maxRadius * 0.18;
          const endR = maxRadius * 1.06;
          const bloomR = startR + (endR - startR) * ease;

          ctx.globalAlpha = 0.12 * fade;
          ctx.fillStyle = palette.arcTarget;
          ctx.beginPath();
          ctx.arc(cx, cy, bloomR, 0, TWO_PI);
          ctx.fill();

          ctx.globalAlpha = 0.78 * fade;
          ctx.strokeStyle = palette.arcTarget;
          ctx.lineWidth = Math.max(1.8, 2.8 * scale);
          ctx.beginPath();
          ctx.arc(cx, cy, bloomR, 0, TWO_PI);
          ctx.stroke();
        }
        ctx.restore();
      } else if (ripple.type === 'miss') {
        ctx.save();
        ctx.strokeStyle = palette.miss;
        if (reducedMotion) {
          ctx.globalAlpha = 0.45 * fade;
          ctx.lineWidth = Math.max(2, 3 * scale);
          ctx.beginPath();
          ctx.arc(cx, cy, ringRadius, 0, TWO_PI);
          ctx.stroke();
        } else {
          const pulseR = ringRadius + maxRadius * 0.055 * ease;
          ctx.globalAlpha = 0.68 * fade;
          ctx.lineWidth = Math.max(1.6, 2.4 * scale);
          ctx.beginPath();
          ctx.arc(cx, cy, pulseR, 0, TWO_PI);
          ctx.stroke();

          ctx.globalAlpha = 0.65 * fade;
          ctx.lineWidth = Math.max(1.4, 2 * scale);
          ctx.beginPath();
          ctx.arc(sx, sy, orbRadius + maxRadius * 0.12 * ease, 0, TWO_PI);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  function resolveOrbPosition(state, coreRadius, maxRadius) {
    const rings = Array.isArray(state?.rings) ? state.rings : [];
    const activeRingIndex = Number.isFinite(state?.activeRingIndex) ? state.activeRingIndex : 0;
    const phase = state?.phase ?? 'playing';
    const orbAngle = Number.isFinite(state?.orbAngle) ? state.orbAngle : 0;
    const phaseTimer = Number.isFinite(state?.phaseTimer) ? state.phaseTimer : 0;

    if (phase === 'snapping') {
      const fromRatio = Number.isFinite(state?.snapFromRadiusRatio) ? state.snapFromRadiusRatio : 0;
      const toRatio = Number.isFinite(state?.snapToRadiusRatio) ? state.snapToRadiusRatio : 0;
      const rawProgress = clamp01(1 - Math.max(0, phaseTimer) / SNAP_DURATION);
      const eased = reducedMotion ? 1 : easeOutCubic(rawProgress);
      return {
        visible: true,
        alpha: 1,
        angle: orbAngle,
        radiusRatio: fromRatio + (toRatio - fromRatio) * eased
      };
    }

    if (phase === 'level_clear') {
      if (reducedMotion) {
        return { visible: false, alpha: 0, angle: orbAngle, radiusRatio: 0 };
      }
      const fromRatio = Number.isFinite(state?.snapFromRadiusRatio) ? state.snapFromRadiusRatio : 0;
      const coreRatio = maxRadius > 0 ? coreRadius / maxRadius : 0;
      const rawProgress = clamp01(1 - Math.max(0, phaseTimer) / LEVEL_CLEAR_DURATION);
      const eased = easeOutCubic(rawProgress);
      return {
        visible: rawProgress < 1,
        alpha: 1 - eased,
        angle: orbAngle,
        radiusRatio: fromRatio + (coreRatio - fromRatio) * eased
      };
    }

    const activeRing = rings[activeRingIndex];
    if (!activeRing || !Number.isFinite(activeRing.radiusRatio)) {
      return { visible: false, alpha: 0, angle: orbAngle, radiusRatio: 0 };
    }
    return {
      visible: true,
      alpha: 1,
      angle: orbAngle,
      radiusRatio: activeRing.radiusRatio
    };
  }

  function drawOrbAndTrail(palette, cx, cy, maxRadius, orbRadius, orbPos, trail) {
    if (!orbPos.visible || orbPos.alpha <= 0) return;

    const orbR = orbPos.radiusRatio * maxRadius;
    const orbX = polarX(cx, orbR, orbPos.angle);
    const orbY = polarY(cy, orbR, orbPos.angle);

    // Tapered motion trail (omitted under reduced motion)
    if (!reducedMotion && Array.isArray(trail) && trail.length > 0 && orbPos.alpha >= 0.99) {
      const count = trail.length;
      ctx.save();
      ctx.strokeStyle = palette.orb;
      ctx.fillStyle = palette.orb;
      ctx.lineCap = 'round';

      if (count === 1) {
        const sample = trail[0];
        if (sample && Number.isFinite(sample.radiusRatio) && Number.isFinite(sample.angle)) {
          const sr = sample.radiusRatio * maxRadius;
          const sx = polarX(cx, sr, sample.angle);
          const sy = polarY(cy, sr, sample.angle);
          ctx.globalAlpha = 0.25;
          ctx.lineWidth = orbRadius * 1.1;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(orbX, orbY);
          ctx.stroke();
        }
      } else {
        for (let i = 0; i < count; i++) {
          const current = trail[i];
          const next = i < count - 1 ? trail[i + 1] : null;
          if (!current || !Number.isFinite(current.radiusRatio) || !Number.isFinite(current.angle)) {
            continue;
          }
          const t = (i + 1) / count;
          const cr = current.radiusRatio * maxRadius;
          const x1 = polarX(cx, cr, current.angle);
          const y1 = polarY(cy, cr, current.angle);

          let x2 = orbX;
          let y2 = orbY;
          if (next && Number.isFinite(next.radiusRatio) && Number.isFinite(next.angle)) {
            const nr = next.radiusRatio * maxRadius;
            x2 = polarX(cx, nr, next.angle);
            y2 = polarY(cy, nr, next.angle);
          }

          ctx.globalAlpha = 0.04 + 0.42 * t * t;
          ctx.lineWidth = Math.max(1, orbRadius * (0.35 + 1.35 * t));
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = clamp01(orbPos.alpha);

    // Clean static soft orb halo
    ctx.save();
    ctx.globalAlpha = clamp01(orbPos.alpha) * 0.24;
    ctx.fillStyle = palette.orb;
    ctx.beginPath();
    ctx.arc(orbX, orbY, orbRadius * 2.15, 0, TWO_PI);
    ctx.fill();
    ctx.restore();

    // Orb body
    ctx.fillStyle = palette.orb;
    ctx.beginPath();
    ctx.arc(orbX, orbY, orbRadius, 0, TWO_PI);
    ctx.fill();

    // Crisp bright center core
    ctx.fillStyle = palette.orbCore;
    ctx.beginPath();
    ctx.arc(orbX, orbY, orbRadius * 0.44, 0, TWO_PI);
    ctx.fill();

    ctx.restore();
  }

  function drawCoreCounter(palette, cx, cy, coreRadius, scale, ringsCount, activeRingIndex, phase) {
    const remaining = Math.max(0, ringsCount - activeRingIndex);
    const isLevelClear = phase === 'level_clear';
    const isMissed = phase === 'missed';

    ctx.save();

    // Central core circle fill
    ctx.fillStyle = palette.bgGlow;
    ctx.beginPath();
    ctx.arc(cx, cy, coreRadius, 0, TWO_PI);
    ctx.fill();

    if (isLevelClear) {
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = palette.arcTarget;
      ctx.beginPath();
      ctx.arc(cx, cy, coreRadius, 0, TWO_PI);
      ctx.fill();
      ctx.restore();
    }

    // Core border with amber glow on level_clear
    ctx.save();
    ctx.lineWidth = Math.max(1.2, 1.5 * scale);
    if (isLevelClear) {
      ctx.strokeStyle = palette.arcTarget;
      ctx.shadowColor = palette.arcTarget;
      ctx.shadowBlur = reducedMotion ? 4 : Math.max(8, 16 * scale);
    } else if (isMissed) {
      ctx.strokeStyle = palette.miss;
      ctx.globalAlpha = 0.72;
    } else {
      ctx.strokeStyle = palette.ringIdle;
    }
    ctx.beginPath();
    ctx.arc(cx, cy, coreRadius, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();

    // Bold tabular remaining-rings numeral
    const fontSize = Math.max(12, Math.round(coreRadius * 0.78));
    ctx.font = `700 ${fontSize}px ${FONT_FAMILY}`;
    if ('fontVariantNumeric' in ctx) {
      ctx.fontVariantNumeric = 'tabular-nums';
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (isLevelClear) {
      ctx.fillStyle = palette.arcTarget;
      ctx.shadowColor = palette.arcTarget;
      ctx.shadowBlur = reducedMotion ? 2 : Math.max(6, 10 * scale);
    } else if (isMissed) {
      ctx.fillStyle = palette.miss;
    } else {
      ctx.fillStyle = palette.textPrimary;
    }

    ctx.fillText(String(remaining), cx, cy + fontSize * 0.03);
    ctx.restore();
  }

  function render(state = {}) {
    if (!ctx || cssW <= 0 || cssH <= 0) return;

    applyTransform();

    const palette = THEME_PALETTES[theme];
    const cx = cssW / 2;
    const cy = cssH / 2;
    const maxRadius = Math.max(24, Math.min(cssW, cssH) * 0.41);
    const scale = maxRadius / 200;
    const coreRadius = Math.max(10, Math.min(44, maxRadius * 0.185));
    const orbRadius = Math.max(5.5, maxRadius * 0.036);

    const rings = Array.isArray(state?.rings) ? state.rings : [];
    const activeRingIndex = Number.isFinite(state?.activeRingIndex) ? state.activeRingIndex : 0;
    const phase = state?.phase ?? 'playing';
    const missElapsed = Number.isFinite(state?.missElapsed) ? state.missElapsed : 0;
    const ripples = Array.isArray(state?.ripples) ? state.ripples : [];
    const trail = Array.isArray(state?.trail) ? state.trail : [];

    drawBackground(palette, cx, cy);
    drawRings(palette, cx, cy, maxRadius, scale, rings, activeRingIndex, phase, missElapsed);
    drawTargetArc(palette, cx, cy, maxRadius, scale, rings[activeRingIndex], phase);
    drawRipples(palette, cx, cy, maxRadius, scale, orbRadius, ripples);

    const orbPos = resolveOrbPosition(state, coreRadius, maxRadius);
    drawOrbAndTrail(palette, cx, cy, maxRadius, orbRadius, orbPos, trail);

    drawCoreCounter(palette, cx, cy, coreRadius, scale, rings.length, activeRingIndex, phase);
  }

  return {
    resize,
    setTheme,
    setReducedMotion,
    render
  };
}
