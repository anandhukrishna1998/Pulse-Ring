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
    assert.equal(getRingCount(3), 3);
    assert.equal(getRingCount(5), 3);
    assert.equal(getRingCount(6), 3);
    assert.equal(getRingCount(7), 4);
    assert.equal(getRingCount(10), 4);
    assert.equal(getRingCount(11), 4);
    assert.equal(getRingCount(12), 4);
    assert.equal(getRingCount(13), 4);
    assert.equal(getRingCount(30), 4);
  });

  it('scales briskly across early levels and caps asymptotically below SPEED_CAP', () => {
    const s1 = getBaseAngularSpeed(1);
    const s2 = getBaseAngularSpeed(2);
    const s3 = getBaseAngularSpeed(3);
    const s4 = getBaseAngularSpeed(4);
    const s5 = getBaseAngularSpeed(5);
    const s6 = getBaseAngularSpeed(6);

    assert.equal(s1, 1.55);
    assert.equal(s2, 1.68);
    assert.ok(Math.abs(s3 / s2 - 1.065) < 1e-6);
    assert.ok(Math.abs(s4 / s3 - 1.065) < 1e-6);
    assert.ok(Math.abs(s5 / s4 - 1.065) < 1e-6);
    assert.ok(s6 > s5 && s6 - s5 < 0.2, `L5->L6 speed step ${s6 - s5} should stay smooth`);

    let prev = s1;
    for (let lvl = 2; lvl <= 120; lvl++) {
      const s = getBaseAngularSpeed(lvl);
      assert.ok(s > prev, `Level ${lvl} speed ${s} should exceed ${prev}`);
      assert.ok(s < SPEED_CAP, `Level ${lvl} speed ${s} must stay under cap ${SPEED_CAP}`);
      prev = s;
    }
  });

  it('keeps arc width narrowing well into high levels and above MIN_ARC_WIDTH', () => {
    assert.equal(getArcWidth(1, 0), 1.36);
    assert.equal(getArcWidth(2, 0), 1.22);
    assert.equal(getArcWidth(6, 0), 0.84);
    assert.ok(getArcWidth(1, 0) > getArcWidth(2, 0));
    assert.ok(getArcWidth(2, 0) > getArcWidth(3, 0));
    assert.ok(getArcWidth(6, 0) > getArcWidth(7, 0));
    assert.ok(getArcWidth(15, 3) > getArcWidth(25, 3));
    assert.ok(getArcWidth(25, 3) > getArcWidth(40, 3));
    assert.ok(getArcWidth(40, 3) > getArcWidth(60, 3));
    assert.ok(getArcWidth(100, 3) >= MIN_ARC_WIDTH);
  });

  it('sets same direction on L1-2, alternating spin on L3+, and escalating drift/breathing on L4+', () => {
    const l1 = generateLevel(1, { mode: 'daily', seedKey: '2026-11-11' });
    assert.deepEqual(l1.rings.map((r) => r.direction), [1, 1]);
    assert.equal(l1.rings[0].driftAmplitude, 0);

    const l2 = generateLevel(2, { mode: 'daily', seedKey: '2026-11-11' });
    assert.deepEqual(l2.rings.map((r) => r.direction), [1, 1]);
    assert.equal(l2.rings[0].driftAmplitude, 0);

    const l3 = generateLevel(3, { mode: 'daily', seedKey: '2026-11-11' });
    assert.equal(l3.ringCount, 3);
    assert.notEqual(l3.rings[0].direction, l3.rings[1].direction);
    assert.equal(l3.rings[0].driftAmplitude, 0);

    const l5 = generateLevel(5, { mode: 'daily', seedKey: '2026-11-11' });
    assert.equal(l5.rings.length, 3);
    assert.ok(l5.rings[0].driftAmplitude > 0);
    assert.ok(l5.rings[0].breatheAmplitude > 0);
    assert.equal(l5.rings[2].driftAmplitude, 0);

    const l7 = generateLevel(7, { mode: 'daily', seedKey: '2026-11-11' });
    assert.equal(l7.ringCount, 4);
    assert.equal(l7.rings.length, 4);
    assert.ok(l7.rings[0].driftAmplitude > 0 && l7.rings[1].driftAmplitude > 0);
    assert.equal(l7.rings[3].driftAmplitude, 0);

    const shifted = computeRingArcAtTime(l7.rings[0], 1.25);
    assert.notEqual(shifted.arcCenter, l7.rings[0].baseArcCenter);
    assert.ok(shifted.arcCenter >= 0 && shifted.arcCenter < TWO_PI);
    assert.ok(shifted.arcWidth >= MIN_ARC_WIDTH);

    const l18 = generateLevel(18, { mode: 'daily', seedKey: '2026-11-11' });
    assert.ok(l18.rings.every((r) => r.driftAmplitude > 0 && r.breatheAmplitude > 0));

    // Across high levels (L11+), starting spin direction varies deterministically while inner rings still alternate
    const startDirs = new Set();
    for (let lvl = 11; lvl <= 25; lvl++) {
      const gen = generateLevel(lvl, { mode: 'daily', seedKey: '2026-11-11' });
      startDirs.add(gen.rings[0].direction);
      for (let i = 1; i < gen.rings.length; i++) {
        assert.notEqual(gen.rings[i].direction, gen.rings[i - 1].direction);
      }
    }
    assert.deepEqual([...startDirs].sort(), [-1, 1]);
  });

  it('computes descending radiusRatio in [0.38, 0.94], rising inner ring speed factor, and strong progression past L40', () => {
    let prevInnerFactor = 0;
    for (const lvl of [1, 6, 13, 30, 50]) {
      const generated = generateLevel(lvl, { mode: 'endless', seedKey: 'runner' });
      const baseSpeed = getBaseAngularSpeed(lvl);
      const innerFactor = generated.rings[1].angularSpeed / baseSpeed - 1;
      assert.ok(innerFactor >= prevInnerFactor);
      prevInnerFactor = innerFactor;

      for (let i = 0; i < generated.rings.length; i++) {
        const ring = generated.rings[i];
        assert.equal(ring.index, i);
        assert.ok(ring.radiusRatio >= 0.38 && ring.radiusRatio <= 0.94);
        if (i > 0) {
          assert.ok(ring.radiusRatio < generated.rings[i - 1].radiusRatio);
          assert.ok(ring.angularSpeed > generated.rings[i - 1].angularSpeed);
        }
        assert.ok(Math.abs(ring.angularSpeed - baseSpeed * (1 + innerFactor * i)) < 1e-12);
      }
    }
    assert.ok(prevInnerFactor > 0.11, `Expected strong inner-ring speed step at L50, got ${prevInnerFactor}`);

    // Ensure speed scales briskly into high levels (L20 -> L40 -> L80)
    const s20 = getBaseAngularSpeed(20);
    const s40 = getBaseAngularSpeed(40);
    const s80 = getBaseAngularSpeed(80);
    assert.ok(s40 >= 3.9, `Expected challenging speed >= 3.9 rad/s by L40, got ${s40}`);
    assert.ok(s40 - s20 >= 0.45, `Expected strong L20->L40 speed gain, got ${s40 - s20}`);
    assert.ok(s80 - s40 >= 0.45, `Expected strong L40->L80 speed gain, got ${s80 - s40}`);
    assert.ok(getArcWidth(80, 3) < getArcWidth(40, 3), 'Inner arc should continue narrowing past L40');
    assert.ok(getArcWidth(80, 3) < 0.36, 'High-level precision arcs should tighten below 0.36 rad');
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

  it('strictly validates difficulty progression across all levels 1 through 100', () => {
    let prevSpeed = 0;
    let prevOuterArc = Infinity;

    for (let lvl = 1; lvl <= 100; lvl++) {
      const rc = getRingCount(lvl);
      if (lvl <= 2) assert.equal(rc, 2, `L${lvl} expected 2 rings`);
      else if (lvl <= 6) assert.equal(rc, 3, `L${lvl} expected 3 rings`);
      else assert.equal(rc, 4, `L${lvl} expected 4 rings`);

      const speed = getBaseAngularSpeed(lvl);
      assert.ok(speed > prevSpeed, `L${lvl} speed ${speed} must strictly exceed previous ${prevSpeed}`);
      assert.ok(speed < SPEED_CAP, `L${lvl} speed ${speed} must stay below cap ${SPEED_CAP}`);
      prevSpeed = speed;

      const outerArc = getArcWidth(lvl, 0);
      assert.ok(outerArc < prevOuterArc, `L${lvl} outer arc ${outerArc} must narrow vs previous ${prevOuterArc}`);
      assert.ok(outerArc >= MIN_ARC_WIDTH, `L${lvl} outer arc ${outerArc} must stay above floor ${MIN_ARC_WIDTH}`);
      prevOuterArc = outerArc;

      for (let r = 0; r < rc; r++) {
        const arc = getArcWidth(lvl, r);
        assert.ok(arc >= MIN_ARC_WIDTH, `L${lvl} ring ${r} arc ${arc} must stay above floor ${MIN_ARC_WIDTH}`);
        if (r > 0) {
          assert.ok(arc < getArcWidth(lvl, r - 1), `L${lvl} ring ${r} arc must be tighter than ring ${r - 1}`);
        }
      }

      const levelDef = generateLevel(lvl, { mode: 'daily', seedKey: '2026-11-14' });
      assert.equal(levelDef.rings.length, rc);

      const expectedDriftRings = lvl < 4 ? 0 : lvl < 7 ? 1 : lvl < 12 ? 2 : lvl < 18 ? 3 : rc;
      const actualDriftRings = levelDef.rings.filter((r) => r.driftAmplitude > 0).length;
      assert.equal(actualDriftRings, expectedDriftRings, `L${lvl} expected ${expectedDriftRings} drift rings`);

      for (let r = 1; r < rc; r++) {
        if (lvl >= 3) {
          assert.notEqual(
            levelDef.rings[r].direction,
            levelDef.rings[r - 1].direction,
            `L${lvl} ring ${r} and ${r - 1} must alternate spin direction`
          );
        }
        assert.ok(
          levelDef.rings[r].angularSpeed > levelDef.rings[r - 1].angularSpeed,
          `L${lvl} ring ${r} angular speed must exceed ring ${r - 1}`
        );
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
