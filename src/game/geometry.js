export const TWO_PI = Math.PI * 2;

/**
 * Wrap any angle in radians into [0, 2π).
 * @param {number} angle
 * @returns {number}
 */
export function normalizeAngle(angle) {
  const wrapped = ((angle % TWO_PI) + TWO_PI) % TWO_PI;
  if (wrapped >= TWO_PI || wrapped === 0) {
    return 0;
  }
  return wrapped;
}

/**
 * Compute shortest signed angular difference (a - b) in [-π, π).
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function shortestSignedAngleDiff(a, b) {
  const diff = normalizeAngle(a - b + Math.PI) - Math.PI;
  return diff === 0 ? 0 : diff;
}

/**
 * Evaluate orb snap precision against a target arc across the 0 / 2π seam.
 * @param {number} orbAngle
 * @param {number} arcCenter
 * @param {number} arcWidth
 * @param {number} [perfectRatio=0.28]
 * @param {number} [edgeTolerance=0]
 * @returns {{ outcome: 'perfect' | 'hit' | 'miss', delta: number, signedDelta: number }}
 */
export function evaluateSnap(
  orbAngle,
  arcCenter,
  arcWidth,
  perfectRatio = 0.28,
  edgeTolerance = 0
) {
  const signedDelta = shortestSignedAngleDiff(orbAngle, arcCenter);
  const delta = Math.abs(signedDelta);
  const halfArc = arcWidth / 2;

  let outcome = 'miss';
  if (delta <= halfArc * perfectRatio) {
    outcome = 'perfect';
  } else if (delta <= halfArc + edgeTolerance) {
    outcome = 'hit';
  }

  return { outcome, delta, signedDelta };
}
