import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TWO_PI, normalizeAngle, shortestSignedAngleDiff, evaluateSnap } from '../src/game/geometry.js';

describe('geometry', () => {
  it('normalizes negative and overflow angles into [0, 2pi)', () => {
    assert.ok(Math.abs(normalizeAngle(-Math.PI / 2) - 1.5 * Math.PI) < 1e-9);
    assert.ok(Math.abs(normalizeAngle(TWO_PI + 0.4) - 0.4) < 1e-9);
    assert.equal(normalizeAngle(TWO_PI), 0);
  });

  it('computes shortest signed angular difference across the 0 / 2pi seam', () => {
    const diffA = shortestSignedAngleDiff(0.05, TWO_PI - 0.05);
    assert.ok(Math.abs(diffA - 0.1) < 1e-9);

    const diffB = shortestSignedAngleDiff(TWO_PI - 0.05, 0.05);
    assert.ok(Math.abs(diffB + 0.1) < 1e-9);
  });

  it('evaluates perfect, hit, and miss accurately across the 0 / 2pi wrap boundary', () => {
    const perfect = evaluateSnap(TWO_PI - 0.04, 0.02, 0.8, 0.28);
    assert.equal(perfect.outcome, 'perfect');

    const hit = evaluateSnap(TWO_PI - 0.28, 0.02, 0.8, 0.28);
    assert.equal(hit.outcome, 'hit');

    const miss = evaluateSnap(TWO_PI - 0.55, 0.02, 0.8, 0.28);
    assert.equal(miss.outcome, 'miss');
  });

  it('keeps normalized edge angles strictly in [0, 2pi) without -0 and diffs in [-pi, pi)', () => {
    assert.ok(Object.is(normalizeAngle(-0), 0));
    assert.ok(Object.is(normalizeAngle(0), 0));
    assert.equal(normalizeAngle(-1e-17), 0);
    assert.ok(normalizeAngle(-3 * TWO_PI + 0.25) >= 0);
    assert.ok(normalizeAngle(-3 * TWO_PI + 0.25) < TWO_PI);

    const opposite = shortestSignedAngleDiff(Math.PI, 0);
    assert.ok(opposite >= -Math.PI && opposite < Math.PI);
    assert.ok(Math.abs(opposite + Math.PI) < 1e-12);
  });

  it('returns delta, signedDelta, and respects default perfectRatio and edgeTolerance', () => {
    const defaultPerfect = evaluateSnap(0.1, 0.02, 0.8);
    assert.equal(defaultPerfect.outcome, 'perfect');
    assert.ok(Math.abs(defaultPerfect.signedDelta - 0.08) < 1e-9);
    assert.ok(Math.abs(defaultPerfect.delta - 0.08) < 1e-9);

    const strictMiss = evaluateSnap(0.43, 0.02, 0.8);
    assert.equal(strictMiss.outcome, 'miss');

    const tolerantHit = evaluateSnap(0.43, 0.02, 0.8, 0.28, 0.02);
    assert.equal(tolerantHit.outcome, 'hit');
  });
});
