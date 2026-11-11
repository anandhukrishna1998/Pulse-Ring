import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGameController,
  SNAP_DURATION,
  LEVEL_CLEAR_DURATION,
  MISS_RETRY_COOLDOWN,
  MAX_DT
} from '../src/game/state.js';
import { createStorage } from '../src/game/storage.js';
import { TWO_PI } from '../src/game/geometry.js';

function createMemoryStorage() {
  const map = new Map();
  return createStorage({
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v)
  });
}

describe('game state controller', () => {
  it('clamps large dt spikes and freezes simulation while paused', () => {
    const game = createGameController({
      storage: createMemoryStorage(),
      dateKeyProvider: () => '2026-11-11',
      endlessSeed: 'test-seed'
    });
    const startAngle = game.state.orbAngle;
    const speed = game.state.rings[0].angularSpeed;

    game.step(5.0); // huge tab-switch spike must clamp to MAX_DT
    const expectedDelta = speed * MAX_DT;
    assert.ok(Math.abs(game.state.orbAngle - startAngle - expectedDelta) < 1e-6);

    game.setPaused(true);
    const pausedAngle = game.state.orbAngle;
    game.step(0.05);
    assert.equal(game.state.orbAngle, pausedAngle);
    assert.equal(game.triggerAction().action, 'ignored');
  });

  it('awards +2 streak on PERFECT, +1 on HIT, advances level after last ring, and persists bests', () => {
    const store = createMemoryStorage();
    const game = createGameController({
      storage: store,
      dateKeyProvider: () => '2026-11-11',
      endlessSeed: 'test-seed'
    });

    // Align orb precisely to ring 0 arcCenter -> PERFECT
    game.state.orbAngle = game.state.rings[0].arcCenter;
    const res1 = game.triggerAction();
    assert.equal(res1.action, 'perfect');
    assert.equal(game.state.streak, 2);
    assert.equal(game.state.hasSnappedOnce, true);
    assert.equal(game.state.phase, 'snapping');
    assert.equal(game.triggerAction().action, 'ignored');

    // Advance past snap animation
    game.step(0.05);
    game.step(0.05);
    game.step(0.05);
    assert.equal(game.state.phase, 'playing');
    assert.equal(game.state.activeRingIndex, 1);

    // Align orb slightly off center (within halfArc, outside perfectRatio) -> HIT
    const r1 = game.state.rings[1];
    game.state.orbAngle = r1.arcCenter + r1.arcWidth * 0.35;
    const res2 = game.triggerAction();
    assert.equal(res2.action, 'hit');
    assert.equal(game.state.streak, 3);
    assert.equal(game.state.phase, 'level_clear');
    assert.equal(game.triggerAction().action, 'ignored');

    // Complete level clear transition
    for (let i = 0; i < 7; i++) game.step(0.05);
    assert.equal(game.state.level, 2);
    assert.equal(game.state.phase, 'playing');
    assert.equal(store.getEndlessStats().currentLevel, 2);
    assert.equal(store.getEndlessStats().bestStreak, 3);
  });

  it('misses gently, respects retry bounce cooldown, and instantly retries Endless level', () => {
    const store = createMemoryStorage();
    store.saveEndlessStats({ currentLevel: 3, bestLevel: 3, bestStreak: 5 });
    const game = createGameController({
      storage: store,
      dateKeyProvider: () => '2026-11-11',
      endlessSeed: 'test-seed'
    });
    assert.equal(game.state.level, 3);
    game.state.streak = 5;
    game.state.orbAngle = game.state.rings[0].arcCenter + Math.PI;
    const missRes = game.triggerAction();
    assert.equal(missRes.action, 'miss');
    assert.equal(game.state.phase, 'missed');
    assert.equal(game.state.streak, 0);

    // Immediate double-tap within bounce cooldown is ignored
    const earlyTap = game.triggerAction();
    assert.equal(earlyTap.action, 'ignored');

    // After cooldown, 1 tap retries level 3 instantly
    for (let i = 0; i < 4; i++) game.step(MISS_RETRY_COOLDOWN / 3);
    const retryRes = game.triggerAction();
    assert.equal(retryRes.action, 'retry');
    assert.equal(game.state.phase, 'playing');
    assert.equal(game.state.level, 3);
    assert.equal(game.state.activeRingIndex, 0);
  });

  it('tracks Daily run independently, restarts Daily at Level 1 after miss, and formats clean Share text', () => {
    const store = createMemoryStorage();
    const game = createGameController({
      storage: store,
      dateKeyProvider: () => '2026-11-11',
      endlessSeed: 'test-seed'
    });

    game.setMode('daily');
    assert.equal(game.state.mode, 'daily');
    assert.equal(game.state.level, 1);

    // Clear Level 1 in Daily
    game.state.orbAngle = game.state.rings[0].arcCenter;
    game.triggerAction();
    for (let i = 0; i < 4; i++) game.step(0.05);
    game.state.orbAngle = game.state.rings[1].arcCenter;
    game.triggerAction();
    for (let i = 0; i < 7; i++) game.step(0.05);
    assert.equal(game.state.level, 2);

    // Mid-run share text before any completed Daily run falls back to current run stats
    const midRunShare = game.formatDailyShareText();
    assert.equal(midRunShare, 'PULSE RING · Daily 2026-11-11\nLevel 02 · Streak 04 · 2 Perfects');

    // Miss on Level 2 -> Daily run ends and locks summary
    game.state.orbAngle = game.state.rings[0].arcCenter + Math.PI;
    game.triggerAction();
    assert.equal(game.state.phase, 'missed');
    const share = game.formatDailyShareText();
    assert.match(share, /PULSE RING · Daily 2026-11-11/);
    assert.match(share, /Level 02 · Streak 04 · 2 Perfects/);

    // Retry Daily restarts from Level 1
    for (let i = 0; i < 4; i++) game.step(0.05);
    game.triggerAction();
    assert.equal(game.state.level, 1);
    assert.equal(game.state.runPerfects, 0);
    assert.equal(game.state.runBestStreak, 0);
  });

  it('normalizes orbAngle on every step, caps trail at 16, and clears trail on retry and level transitions', () => {
    const game = createGameController({
      storage: createMemoryStorage(),
      dateKeyProvider: () => '2026-11-11',
      endlessSeed: 'test-seed'
    });

    // Place orb just before 2*PI so a single step crosses the seam
    game.state.orbAngle = TWO_PI - 0.01;
    for (let i = 0; i < 25; i++) {
      game.step(0.04);
      assert.ok(game.state.orbAngle >= 0 && game.state.orbAngle < TWO_PI);
    }
    assert.equal(game.state.trail.length, 16);

    // Miss and retry clears trail
    game.state.orbAngle = game.state.rings[0].arcCenter + Math.PI;
    game.triggerAction();
    for (let i = 0; i < 4; i++) game.step(0.05);
    game.triggerAction();
    assert.equal(game.state.trail.length, 0);

    // Build trail, clear level, and confirm trail clears on level_clear and new level transition
    for (let i = 0; i < 5; i++) game.step(0.04);
    assert.ok(game.state.trail.length > 0);
    game.state.orbAngle = game.state.rings[0].arcCenter;
    game.triggerAction();
    while (game.state.phase === 'snapping') game.step(0.05);
    game.state.orbAngle = game.state.rings[1].arcCenter;
    game.triggerAction();
    assert.equal(game.state.phase, 'level_clear');
    assert.equal(game.state.trail.length, 0);
    while (game.state.phase === 'level_clear') game.step(0.05);
    assert.equal(game.state.level, 2);
    assert.equal(game.state.phase, 'playing');
    assert.equal(game.state.trail.length, 0);
  });

  it('updates drifting rings on L6+, expires ripples, ignores invalid dt, and isolates snapshots', () => {
    const store = createMemoryStorage();
    store.saveEndlessStats({ currentLevel: 6, bestLevel: 6, bestStreak: 10 });
    const game = createGameController({
      storage: store,
      dateKeyProvider: () => '2026-11-11',
      endlessSeed: 'test-seed'
    });

    const initialCenter = game.state.rings[0].arcCenter;
    game.step(0);
    game.step(-0.1);
    game.step(Number.NaN);
    game.step(Number.POSITIVE_INFINITY);
    assert.equal(game.state.elapsed, 0);

    for (let i = 0; i < 10; i++) game.step(0.05);
    assert.notEqual(game.state.rings[0].arcCenter, initialCenter);

    // Trigger snap ripple and advance until it expires
    game.state.orbAngle = game.state.rings[0].arcCenter;
    game.triggerAction();
    assert.equal(game.state.ripples.length, 1);
    for (let i = 0; i < 15; i++) game.step(0.05);
    assert.equal(game.state.ripples.length, 0);

    // Snapshot has all required keys and does not expose mutable internal arrays
    const snap = game.getSnapshot();
    const expectedKeys = [
      'mode', 'phase', 'paused', 'level', 'streak', 'runBestStreak',
      'bestLevel', 'bestStreak', 'runPerfects', 'hasSnappedOnce',
      'activeRingIndex', 'orbAngle', 'rings', 'elapsed', 'phaseTimer',
      'missElapsed', 'snapFromRadiusRatio', 'snapToRadiusRatio',
      'ripples', 'trail', 'dailyKey', 'dailyStats'
    ];
    for (const key of expectedKeys) {
      assert.ok(key in snap, `Missing snapshot key: ${key}`);
    }
    snap.trail.push({ angle: 0, radiusRatio: 0.5 });
    assert.notEqual(snap.trail.length, game.state.trail.length);
  });

  it('falls back to current run stats if formatDailyShareText is called mid-run in a later run', () => {
    const store = createMemoryStorage();
    const game = createGameController({
      storage: store,
      dateKeyProvider: () => '2026-11-11',
      endlessSeed: 'test-seed'
    });

    game.setMode('daily');
    // Complete first Daily run with Level 1, 0 Perfects
    game.state.orbAngle = game.state.rings[0].arcCenter + Math.PI;
    game.triggerAction();
    assert.equal(game.formatDailyShareText(), 'PULSE RING · Daily 2026-11-11\nLevel 01 · Streak 00 · 0 Perfects');

    // Retry and make progress mid-run in second Daily run
    for (let i = 0; i < 4; i++) game.step(0.05);
    game.triggerAction();
    game.state.orbAngle = game.state.rings[0].arcCenter;
    game.triggerAction();
    assert.equal(game.formatDailyShareText(), 'PULSE RING · Daily 2026-11-11\nLevel 01 · Streak 02 · 1 Perfects');
  });

  it('switches cleanly between endless and daily modes, clears trail/ripples, and supports default options', () => {
    const store = createMemoryStorage();
    store.saveEndlessStats({ currentLevel: 4, bestLevel: 6, bestStreak: 12 });
    const game = createGameController({
      storage: store,
      dateKeyProvider: () => '2026-11-11',
      endlessSeed: 'test-seed'
    });

    assert.equal(SNAP_DURATION, 0.14);
    assert.equal(LEVEL_CLEAR_DURATION, 0.26);
    assert.equal(game.state.level, 4);
    assert.equal(game.state.bestLevel, 6);
    assert.equal(game.state.bestStreak, 12);

    game.step(0.04);
    game.state.orbAngle = game.state.rings[0].arcCenter;
    game.triggerAction();
    assert.ok(game.state.trail.length > 0);
    assert.ok(game.state.ripples.length > 0);

    // Switching to invalid mode or same mode does not reset state
    game.setMode('invalid');
    assert.equal(game.state.mode, 'endless');
    game.setMode('endless');
    assert.equal(game.state.level, 4);

    // Switch to daily -> resets trail/ripples and starts daily at Level 1
    game.setMode('daily');
    assert.equal(game.state.mode, 'daily');
    assert.equal(game.state.level, 1);
    assert.equal(game.state.trail.length, 0);
    assert.equal(game.state.ripples.length, 0);
    assert.equal(game.state.bestLevel, 1);
    assert.equal(game.state.bestStreak, 0);

    // Switch back to endless -> restores Endless level 4 and bests
    game.setMode('endless');
    assert.equal(game.state.mode, 'endless');
    assert.equal(game.state.level, 4);
    assert.equal(game.state.bestLevel, 6);
    assert.equal(game.state.bestStreak, 12);

    // Default options constructor works in Node without browser globals
    const defaultGame = createGameController();
    assert.match(defaultGame.state.dailyKey, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(defaultGame.state.mode, 'endless');
    assert.equal(defaultGame.state.level, 1);
  });

  it('persists level advancement immediately on level_clear across mode switches and reloads', () => {
    const store = createMemoryStorage();
    const game = createGameController({
      storage: store,
      dateKeyProvider: () => '2026-11-11',
      endlessSeed: 'test-seed'
    });

    // Snap through Level 1 rings in Endless to enter level_clear
    game.state.orbAngle = game.state.rings[0].arcCenter;
    game.triggerAction();
    while (game.state.phase === 'snapping') game.step(0.05);
    game.state.orbAngle = game.state.rings[1].arcCenter;
    game.triggerAction();

    assert.equal(game.state.phase, 'level_clear');
    assert.equal(game.state.level, 1);
    assert.equal(game.state.bestLevel, 2);
    assert.equal(store.getEndlessStats().currentLevel, 2);
    assert.equal(store.getEndlessStats().bestLevel, 2);

    // Switching to Daily and back to Endless during level_clear preserves Level 2
    game.setMode('daily');
    assert.equal(game.state.mode, 'daily');
    assert.equal(game.state.level, 1);

    game.setMode('endless');
    assert.equal(game.state.mode, 'endless');
    assert.equal(game.state.level, 2);
    assert.equal(game.state.phase, 'playing');

    // Simulating reload during level_clear also starts at Level 2
    const reloaded = createGameController({
      storage: store,
      dateKeyProvider: () => '2026-11-11',
      endlessSeed: 'test-seed'
    });
    assert.equal(reloaded.state.level, 2);

    // Daily mode also updates bestLevel immediately when entering level_clear
    reloaded.setMode('daily');
    reloaded.state.orbAngle = reloaded.state.rings[0].arcCenter;
    reloaded.triggerAction();
    while (reloaded.state.phase === 'snapping') reloaded.step(0.05);
    reloaded.state.orbAngle = reloaded.state.rings[1].arcCenter;
    reloaded.triggerAction();

    assert.equal(reloaded.state.phase, 'level_clear');
    assert.equal(reloaded.state.level, 1);
    assert.equal(reloaded.state.bestLevel, 2);
    assert.equal(reloaded.state.dailyStats.bestLevel, 2);
    assert.equal(store.getDailyStats('2026-11-11').bestLevel, 2);
  });
});
