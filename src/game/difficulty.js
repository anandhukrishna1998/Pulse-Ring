import { createLevelRng } from '../math/prng.js';
import { normalizeAngle, TWO_PI } from './geometry.js';

export const SPEED_CAP = 3.30;
export const MIN_ARC_WIDTH = 0.46;

const BASE_ARC_WIDTHS = [1.36, 1.26, 1.16, 1.08, 1.00];

function normalizeLevel(level) {
  return Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
}

/**
 * Determine concentric ring count for a given level.
 * @param {number} level
 * @returns {number}
 */
export function getRingCount(level) {
  const lvl = normalizeLevel(level);
  if (lvl <= 5) return 2;
  if (lvl <= 12) return 3;
  return 4;
}

/**
 * Compute smooth, monotonically increasing outer-ring angular speed (rad/s) below SPEED_CAP.
 * @param {number} level
 * @returns {number}
 */
export function getBaseAngularSpeed(level) {
  const lvl = normalizeLevel(level);
  if (lvl === 1) return 1.55;
  if (lvl === 2) return 1.62;
  if (lvl <= 5) {
    return 1.62 * Math.pow(1.04, lvl - 2);
  }
  const speedAt5 = 1.62 * Math.pow(1.04, 3);
  return SPEED_CAP - (SPEED_CAP - speedAt5) * Math.exp(-0.052 * (lvl - 5));
}

/**
 * Compute target arc width (radians) for a level and ring index, floored at MIN_ARC_WIDTH.
 * @param {number} level
 * @param {number} [ringIndex=0]
 * @returns {number}
 */
export function getArcWidth(level, ringIndex = 0) {
  const lvl = normalizeLevel(level);
  const idx = Number.isFinite(ringIndex) ? Math.max(0, Math.floor(ringIndex)) : 0;
  const outerWidth = lvl <= 5
    ? BASE_ARC_WIDTHS[lvl - 1]
    : MIN_ARC_WIDTH + (1.00 - MIN_ARC_WIDTH) * Math.exp(-0.095 * (lvl - 5));
  return Math.max(MIN_ARC_WIDTH, outerWidth - 0.04 * idx);
}

/**
 * Evaluate drifting center and breathing arc width for a ring at a given elapsed time.
 * @param {object} ring
 * @param {number} elapsed
 * @returns {{ arcCenter: number, arcWidth: number }}
 */
export function computeRingArcAtTime(ring, elapsed) {
  const t = Number.isFinite(elapsed) ? elapsed : 0;
  const driftAmp = ring.driftAmplitude || 0;
  const driftFreq = ring.driftFrequency || 0;
  const driftPhase = ring.driftPhase || 0;
  const breatheAmp = ring.breatheAmplitude || 0;

  const driftOffset = driftAmp > 0
    ? driftAmp * Math.sin(t * driftFreq + driftPhase)
    : 0;
  const arcCenter = normalizeAngle(ring.baseArcCenter + driftOffset);

  const breatheFreq = driftFreq > 0 ? driftFreq * 1.25 : 0.6;
  const arcWidth = breatheAmp > 0
    ? Math.max(
        MIN_ARC_WIDTH,
        ring.baseArcWidth * (1 + breatheAmp * Math.sin(t * breatheFreq + driftPhase))
      )
    : ring.baseArcWidth;

  return { arcCenter, arcWidth };
}

function computeRadiusRatios(ringCount) {
  if (ringCount <= 1) return [0.94];
  const maxRadius = 0.94;
  const minRadius = ringCount === 2 ? 0.56 : ringCount === 3 ? 0.45 : 0.38;
  const step = (maxRadius - minRadius) / (ringCount - 1);
  return Array.from({ length: ringCount }, (_, index) => maxRadius - step * index);
}

/**
 * Generate a deterministic level definition from (mode, level, seedKey).
 * @param {number} level
 * @param {{ mode?: 'endless' | 'daily', seedKey?: string }} [options]
 */
export function generateLevel(level, options = {}) {
  const lvl = normalizeLevel(level);
  const { mode = 'endless', seedKey = '' } = options ?? {};
  const rng = createLevelRng(mode, lvl, seedKey);
  const ringCount = getRingCount(lvl);
  const baseSpeed = getBaseAngularSpeed(lvl);
  const radiusRatios = computeRadiusRatios(ringCount);

  const rings = radiusRatios.map((radiusRatio, index) => {
    const angularSpeed = baseSpeed * (1 + 0.07 * index);
    const direction = lvl <= 2 ? 1 : (index % 2 === 0 ? 1 : -1);
    const baseArcCenter = normalizeAngle(rng() * TWO_PI);
    const baseArcWidth = getArcWidth(lvl, index);

    const isOuterDriftRing = lvl >= 6 && (index === 0 || (ringCount >= 4 && index === 1));
    let driftAmplitude = 0;
    let driftFrequency = 0;
    let driftPhase = 0;
    let breatheAmplitude = 0;

    if (isOuterDriftRing) {
      if (index === 0) {
        driftAmplitude = 0.24 + rng() * 0.14;
        driftFrequency = 0.45 + rng() * 0.25;
        driftPhase = rng() * TWO_PI;
        breatheAmplitude = 0.08;
      } else {
        driftAmplitude = 0.16 + rng() * 0.08;
        driftFrequency = 0.40 + rng() * 0.20;
        driftPhase = rng() * TWO_PI;
      }
    }

    const leadLag = 0.2 + rng() * 0.4;
    const orbStartAngle = normalizeAngle(baseArcCenter + Math.PI - direction * leadLag);

    const ring = {
      index,
      radiusRatio,
      angularSpeed,
      direction,
      baseArcCenter,
      arcCenter: baseArcCenter,
      baseArcWidth,
      arcWidth: baseArcWidth,
      driftAmplitude,
      driftFrequency,
      driftPhase,
      breatheAmplitude,
      orbStartAngle
    };

    const initialArc = computeRingArcAtTime(ring, 0);
    ring.arcCenter = initialArc.arcCenter;
    ring.arcWidth = initialArc.arcWidth;

    return ring;
  });

  return {
    level: lvl,
    ringCount,
    rings
  };
}
