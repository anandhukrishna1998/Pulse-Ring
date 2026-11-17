import { createLevelRng } from '../math/prng.js';
import { normalizeAngle, TWO_PI } from './geometry.js';

export const SPEED_CAP = 5.25;
export const MIN_ARC_WIDTH = 0.32;

const BASE_ARC_WIDTHS = [1.36, 1.22, 1.10, 1.00, 0.92, 0.84];

function normalizeLevel(level) {
  return Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
}

function getHighLevelProgress(lvl, halfLife = 20) {
  if (lvl <= 2) return 0;
  const x = lvl - 2;
  return x / (x + halfLife);
}

/**
 * Determine concentric ring count for a given level.
 * @param {number} level
 * @returns {number}
 */
export function getRingCount(level) {
  const lvl = normalizeLevel(level);
  if (lvl <= 2) return 2;
  if (lvl <= 6) return 3;
  return 4;
}

/**
 * Compute smooth, monotonically increasing outer-ring angular speed (rad/s) below SPEED_CAP.
 * Escalates briskly from Level 2 onward (+6.5% to +8% per level in early game, then hyperbolic ramp to SPEED_CAP).
 * @param {number} level
 * @returns {number}
 */
export function getBaseAngularSpeed(level) {
  const lvl = normalizeLevel(level);
  if (lvl === 1) return 1.55;
  if (lvl === 2) return 1.68;
  if (lvl <= 6) {
    return 1.68 * Math.pow(1.065, lvl - 2);
  }
  const speedAt6 = 1.68 * Math.pow(1.065, 4);
  const curvedX = Math.pow(lvl - 6, 1.15);
  const ramp = curvedX / (curvedX + 28);
  return speedAt6 + (SPEED_CAP - speedAt6) * ramp;
}

/**
 * Compute per-ring inward angular speed step factor (scales smoothly from +7% to +14% per inner ring).
 * @param {number} level
 * @returns {number}
 */
export function getInnerSpeedFactor(level) {
  const lvl = normalizeLevel(level);
  return 0.07 + 0.07 * getHighLevelProgress(lvl, 20);
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
  const outerWidth = lvl <= 6
    ? BASE_ARC_WIDTHS[lvl - 1]
    : MIN_ARC_WIDTH + (0.84 - MIN_ARC_WIDTH) * (18 / (18 + (lvl - 6)));
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
  const innerSpeedFactor = getInnerSpeedFactor(lvl);
  const radiusRatios = computeRadiusRatios(ringCount);
  const highProgress = getHighLevelProgress(lvl, 20);
  const firstDirection = lvl <= 10 ? 1 : (rng() < 0.5 ? 1 : -1);

  const rings = radiusRatios.map((radiusRatio, index) => {
    const angularSpeed = baseSpeed * (1 + innerSpeedFactor * index);
    const direction = lvl <= 2 ? 1 : (index % 2 === 0 ? firstDirection : -firstDirection);
    const baseArcCenter = normalizeAngle(rng() * TWO_PI);
    const baseArcWidth = getArcWidth(lvl, index);

    const driftingRingCap =
      lvl < 4 ? 0
        : lvl < 7 ? 1
          : lvl < 12 ? 2
            : lvl < 18 ? 3
              : ringCount;
    const isDriftRing = index < driftingRingCap;
    let driftAmplitude = 0;
    let driftFrequency = 0;
    let driftPhase = 0;
    let breatheAmplitude = 0;

    if (isDriftRing) {
      const ringDamping = Math.max(0.55, 1 - 0.14 * index);
      if (index === 0) {
        driftAmplitude = (0.24 + rng() * 0.14) * (1 + 0.50 * highProgress);
        driftFrequency = (0.45 + rng() * 0.25) * (1 + 1.05 * highProgress);
        driftPhase = rng() * TWO_PI;
        breatheAmplitude = 0.08 + 0.08 * highProgress;
      } else {
        driftAmplitude = (0.16 + rng() * 0.08) * ringDamping * (1 + 0.45 * highProgress);
        driftFrequency = (0.40 + rng() * 0.20) * (1 + 0.95 * highProgress);
        driftPhase = rng() * TWO_PI;
        breatheAmplitude = 0.06 + 0.06 * highProgress;
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
