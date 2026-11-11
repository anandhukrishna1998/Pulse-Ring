import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fnv1a32, createSeededRng, getDailyDateKey, createLevelRng } from '../src/math/prng.js';

describe('prng', () => {
  it('produces identical sequence for identical seeds and diverges for different seeds', () => {
    const a1 = createSeededRng('pulse-ring:2026-11-11:level:1');
    const a2 = createSeededRng('pulse-ring:2026-11-11:level:1');
    const b = createSeededRng('pulse-ring:2026-11-12:level:1');

    const seqA1 = Array.from({ length: 8 }, () => a1());
    const seqA2 = Array.from({ length: 8 }, () => a2());
    const seqB = Array.from({ length: 8 }, () => b());

    assert.deepEqual(seqA1, seqA2);
    assert.notDeepEqual(seqA1, seqB);
    for (const n of seqA1) {
      assert.ok(n >= 0 && n < 1, `Expected [0,1), got ${n}`);
    }
  });

  it('formats UTC YYYY-MM-DD daily date keys deterministically', () => {
    assert.equal(getDailyDateKey(new Date('2026-11-11T23:55:00Z')), '2026-11-11');
    assert.equal(getDailyDateKey(new Date('2026-01-05T00:10:00Z')), '2026-01-05');
  });

  it('derives independent deterministic level streams per (mode, level, seedKey)', () => {
    assert.equal(typeof fnv1a32('pulse'), 'number');
    const r1 = createLevelRng('daily', 4, '2026-11-11');
    const r2 = createLevelRng('daily', 4, '2026-11-11');
    const r3 = createLevelRng('daily', 5, '2026-11-11');
    assert.equal(r1(), r2());
    assert.notEqual(r1(), r3());
  });

  it('computes unsigned 32-bit FNV-1a hashes and separates mode and seedKey streams', () => {
    const emptyHash = fnv1a32('');
    assert.equal(emptyHash, 2166136261);
    const pulseHash = fnv1a32('pulse');
    assert.ok(Number.isInteger(pulseHash) && pulseHash >= 0 && pulseHash <= 0xffffffff);

    const daily = createLevelRng('daily', 3, '2026-11-11');
    const endless = createLevelRng('endless', 3, '2026-11-11');
    const otherSeed = createLevelRng('endless', 3, 'other-seed');
    const dSeq = Array.from({ length: 4 }, () => daily());
    const eSeq = Array.from({ length: 4 }, () => endless());
    const oSeq = Array.from({ length: 4 }, () => otherSeed());
    assert.notDeepEqual(dSeq, eSeq);
    assert.notDeepEqual(eSeq, oSeq);
  });

  it('defaults getDailyDateKey to current UTC date in YYYY-MM-DD format', () => {
    const todayKey = getDailyDateKey();
    assert.match(todayKey, /^\d{4}-\d{2}-\d{2}$/);
  });
});
