import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPEED_CAP,
  MIN_ARC_WIDTH,
  getRingCount,
  getBaseAngularSpeed,
  getArcWidth,
  generateLevel,
  computeRingArcAtTime
} from '../src/game/difficulty.js';
import { TWO_PI, shortestSignedAngleDiff } from '../src/game/geometry.js';

describe('difficulty progression', () => {
  it('assigns ring counts smoothly across progression tiers', () => {
    assert.equal(getRingCount(1), 2);
    assert.equal(getRingCount(2), 2);
    assert.equal(getRingCount(5), 2);
    assert.equal(getRingCount(6), 3);
    assert.equal(getRingCount(10), 3);
    assert.equal(getRingCount(11), 3);
    assert.equal(getRingCount(12), 3);
    assert.equal(getRingCount(13), 4);
    assert.equal(getRingCount(30), 4);
  });

  it('scales +4% per level across levels 3-5 and caps asymptotically below SPEED_CAP', () => {
    const s1 = getBaseAngularSpeed(1);
    const s2 = getBaseAngularSpeed(2);
    const s3 = getBaseAngularSpeed(3);
    const s4 = getBaseAngularSpeed(4);
    const s5 = getBaseAngularSpeed(5);
    const s6 = getBaseAngularSpeed(6);

    assert.equal(s1, 1.55);
    assert.equal(s2, 1.62);
    assert.ok(Math.abs(s3 / s2 - 1.04) < 1e-6);
    assert.ok(Math.abs(s4 / s3 - 1.04) < 1e-6);
    assert.ok(Math.abs(s5 / s4 - 1.04) < 1e-6);
    assert.ok(s6 > s5 && s6 - s5 < 0.1, `L5->L6 speed step ${s6 - s5} should stay smooth`);

    let prev = s1;
    for (let lvl = 2; lvl <= 120; lvl++) {
      const s = getBaseAngularSpeed(lvl);
      assert.ok(s > prev, `Level ${lvl} speed ${s} should exceed ${prev}`);
      assert.ok(s < SPEED_CAP, `Level ${lvl} speed ${s} must stay under cap ${SPEED_CAP}`);
      prev = s;
    }
  });

  it('keeps arc width above MIN_ARC_WIDTH even at extreme levels', () => {
    assert.equal(getArcWidth(1, 0), 1.36);
    assert.equal(getArcWidth(5, 0), 1.0);
    assert.ok(getArcWidth(1, 0) > getArcWidth(2, 0));
    assert.ok(getArcWidth(5, 0) > getArcWidth(5, 1));
    assert.ok(getArcWidth(6, 0) < getArcWidth(5, 0));
    assert.ok(getArcWidth(100, 3) >= MIN_ARC_WIDTH);
  });

  it('sets same direction on L1-2, alternating spin on L3+, and outer drift/breathing on L6+', () => {
    const l1 = generateLevel(1, { mode: 'daily', seedKey: '2026-11-11' });
    assert.deepEqual(l1.rings.map((r) => r.direction), [1, 1]);
    assert.equal(l1.rings[0].driftAmplitude, 0);

    const l2 = generateLevel(2, { mode: 'daily', seedKey: '2026-11-11' });
    assert.deepEqual(l2.rings.map((r) => r.direction), [1, 1]);
    assert.equal(l2.rings[0].driftAmplitude, 0);

    const l3 = generateLevel(3, { mode: 'daily', seedKey: '2026-11-11' });
    assert.notEqual(l3.rings[0].direction, l3.rings[1].direction);
    assert.equal(l3.rings[0].driftAmplitude, 0);

    const l7 = generateLevel(7, { mode: 'daily', seedKey: '2026-11-11' });
    assert.equal(l7.rings.length, 3);
    assert.ok(l7.rings[0].driftAmplitude > 0);
    assert.ok(l7.rings[0].breatheAmplitude > 0);
    assert.equal(l7.rings[2].driftAmplitude, 0);

    const shifted = computeRingArcAtTime(l7.rings[0], 1.25);
    assert.notEqual(shifted.arcCenter, l7.rings[0].baseArcCenter);
    assert.ok(shifted.arcCenter >= 0 && shifted.arcCenter < TWO_PI);
    assert.ok(shifted.arcWidth >= MIN_ARC_WIDTH);

    const l13 = generateLevel(13, { mode: 'daily', seedKey: '2026-11-11' });
    assert.equal(l13.ringCount, 4);
    assert.equal(l13.rings.length, 4);
    assert.deepEqual(l13.rings.map((r) => r.direction), [1, -1, 1, -1]);
    assert.equal(l13.rings[3].driftAmplitude, 0);
  });

  it('computes descending radiusRatio in [0.38, 0.94] and inner ring speed offset', () => {
    for (const lvl of [1, 6, 13]) {
      const generated = generateLevel(lvl, { mode: 'endless', seedKey: 'runner' });
      const baseSpeed = getBaseAngularSpeed(lvl);
      for (let i = 0; i < generated.rings.length; i++) {
        const ring = generated.rings[i];
        assert.equal(ring.index, i);
        assert.ok(ring.radiusRatio >= 0.38 && ring.radiusRatio <= 0.94);
        if (i > 0) {
          assert.ok(ring.radiusRatio < generated.rings[i - 1].radiusRatio);
        }
        assert.ok(Math.abs(ring.angularSpeed - baseSpeed * (1 + 0.07 * i)) < 1e-12);
      }
    }
  });

  it('generates identical daily levels for the same date and keeps orb lead-in fair', () => {
    const a = generateLevel(6, { mode: 'daily', seedKey: '2026-11-11' });
    const b = generateLevel(6, { mode: 'daily', seedKey: '2026-11-11' });
    const otherDate = generateLevel(6, { mode: 'daily', seedKey: '2026-11-12' });
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, otherDate);

    for (let lvl = 1; lvl <= 20; lvl++) {
      const generated = generateLevel(lvl, { mode: 'daily', seedKey: '2026-11-11' });
      for (const ring of generated.rings) {
        const leadDiff = Math.abs(shortestSignedAngleDiff(ring.orbStartAngle, ring.baseArcCenter));
        assert.ok(leadDiff >= ring.baseArcWidth, `Orb start too close to arc on level ${lvl} ring ${ring.index}`);
        assert.ok(ring.orbStartAngle >= 0 && ring.orbStartAngle < TWO_PI);
        assert.ok(ring.baseArcCenter >= 0 && ring.baseArcCenter < TWO_PI);
      }
    }
  });

  it('handles default options, steady rings in computeRingArcAtTime, and level lower bounds safely', () => {
    const defaultA = generateLevel(1);
    const defaultB = generateLevel(1, { mode: 'endless', seedKey: '' });
    assert.deepEqual(defaultA, defaultB);

    const steady = computeRingArcAtTime(defaultA.rings[0], 3.5);
    assert.equal(steady.arcCenter, defaultA.rings[0].baseArcCenter);
    assert.equal(steady.arcWidth, defaultA.rings[0].baseArcWidth);

    assert.equal(getRingCount(0), 2);
    assert.equal(getRingCount(Number.NaN), 2);
    assert.equal(getBaseAngularSpeed(Number.NaN), 1.55);
    assert.equal(getArcWidth(Number.NaN), 1.36);
    assert.equal(generateLevel(Number.NaN).level, 1);
  });
});
