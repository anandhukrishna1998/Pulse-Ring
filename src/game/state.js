import { generateLevel, computeRingArcAtTime } from './difficulty.js';
import { evaluateSnap, normalizeAngle } from './geometry.js';
import { getDailyDateKey } from '../math/prng.js';
import { createStorage } from './storage.js';

export const SNAP_DURATION = 0.14;
export const LEVEL_CLEAR_DURATION = 0.26;
export const MISS_RETRY_COOLDOWN = 0.16;
export const MAX_DT = 0.05;

const MAX_TRAIL_SAMPLES = 16;
const HIT_RIPPLE_DURATION = 0.36;
const PERFECT_RIPPLE_DURATION = 0.48;
const LEVEL_CLEAR_RIPPLE_DURATION = 0.50;
const MISS_RIPPLE_DURATION = 0.40;

/**
 * Create the frame-rate independent game state controller.
 * @param {{ storage?: object, dateKeyProvider?: () => string, endlessSeed?: string }} [options]
 */
export function createGameController(options = {}) {
  const storage = options?.storage ?? createStorage();
  const dateKeyProvider = typeof options?.dateKeyProvider === 'function'
    ? options.dateKeyProvider
    : () => getDailyDateKey();
  const endlessSeed = typeof options?.endlessSeed === 'string' ? options.endlessSeed : 'default';

  const initialEndless = storage.getEndlessStats();
  const initialDailyKey = dateKeyProvider();
  const initialDailyStats = storage.getDailyStats(initialDailyKey);

  const state = {
    mode: 'endless',
    phase: 'playing',
    paused: false,
    level: initialEndless.currentLevel,
    streak: 0,
    runBestStreak: 0,
    bestLevel: Math.max(initialEndless.bestLevel, initialEndless.currentLevel),
    bestStreak: initialEndless.bestStreak,
    runPerfects: 0,
    hasSnappedOnce: false,
    activeRingIndex: 0,
    orbAngle: 0,
    rings: [],
    elapsed: 0,
    phaseTimer: 0,
    missElapsed: 0,
    snapFromRadiusRatio: 0,
    snapToRadiusRatio: 0,
    ripples: [],
    trail: [],
    dailyKey: initialDailyKey,
    dailyStats: initialDailyStats
  };

  function getLevelSeedKey() {
    return state.mode === 'daily' ? state.dailyKey : endlessSeed;
  }

  function pushTrailSample(angle, radiusRatio) {
    state.trail.push({ angle, radiusRatio });
    if (state.trail.length > MAX_TRAIL_SAMPLES) {
      state.trail.shift();
    }
  }

  function loadLevel(levelNumber) {
    const generated = generateLevel(levelNumber, {
      mode: state.mode,
      seedKey: getLevelSeedKey()
    });
    const firstRing = generated.rings[0];

    state.level = generated.level;
    state.rings = generated.rings;
    state.activeRingIndex = 0;
    state.orbAngle = firstRing ? normalizeAngle(firstRing.orbStartAngle) : 0;
    state.elapsed = 0;
    state.phase = 'playing';
    state.phaseTimer = 0;
    state.missElapsed = 0;
    state.snapFromRadiusRatio = firstRing ? firstRing.radiusRatio : 0;
    state.snapToRadiusRatio = firstRing ? firstRing.radiusRatio : 0;
    state.trail = [];
  }

  function syncModeProgressOnSuccess(targetLevel = state.level) {
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    state.bestLevel = Math.max(state.bestLevel, targetLevel);

    if (state.mode === 'endless') {
      storage.saveEndlessStats({
        currentLevel: targetLevel,
        bestLevel: state.bestLevel,
        bestStreak: state.bestStreak
      });
      return;
    }

    state.dailyStats = {
      ...state.dailyStats,
      bestLevel: Math.max(state.dailyStats.bestLevel, state.bestLevel),
      bestStreak: Math.max(state.dailyStats.bestStreak, state.bestStreak)
    };
    storage.saveDailyStats(state.dailyKey, state.dailyStats);
  }

  function updateRingArcs(elapsed) {
    for (const ring of state.rings) {
      const arc = computeRingArcAtTime(ring, elapsed);
      ring.arcCenter = arc.arcCenter;
      ring.arcWidth = arc.arcWidth;
    }
  }

  loadLevel(initialEndless.currentLevel);

  function step(dtSeconds) {
    if (state.paused) return;
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;

    const dt = Math.min(dtSeconds, MAX_DT);

    if (state.ripples.length > 0) {
      for (const ripple of state.ripples) {
        ripple.age += dt;
      }
      state.ripples = state.ripples.filter((ripple) => ripple.age < ripple.duration);
    }

    if (state.phase === 'playing') {
      state.elapsed += dt;
      updateRingArcs(state.elapsed);

      const ring = state.rings[state.activeRingIndex];
      if (ring) {
        state.orbAngle = normalizeAngle(
          state.orbAngle + ring.direction * ring.angularSpeed * dt
        );
        pushTrailSample(state.orbAngle, ring.radiusRatio);
      }
      return;
    }

    if (state.phase === 'snapping') {
      state.elapsed += dt;
      updateRingArcs(state.elapsed);
      state.phaseTimer -= dt;

      const ring = state.rings[state.activeRingIndex];
      if (ring) {
        state.orbAngle = normalizeAngle(
          state.orbAngle + ring.direction * ring.angularSpeed * dt
        );
        const progress = Math.min(
          1,
          Math.max(0, 1 - Math.max(0, state.phaseTimer) / SNAP_DURATION)
        );
        const radiusRatio =
          state.snapFromRadiusRatio +
          (state.snapToRadiusRatio - state.snapFromRadiusRatio) * progress;
        pushTrailSample(state.orbAngle, radiusRatio);
      }

      if (state.phaseTimer <= 0) {
        state.phase = 'playing';
        state.phaseTimer = 0;
        if (ring) {
          state.snapFromRadiusRatio = ring.radiusRatio;
          state.snapToRadiusRatio = ring.radiusRatio;
        }
      }
      return;
    }

    if (state.phase === 'level_clear') {
      state.phaseTimer -= dt;
      if (state.phaseTimer <= 0) {
        loadLevel(state.level + 1);
      }
      return;
    }

    if (state.phase === 'missed') {
      state.missElapsed += dt;
    }
  }

  function triggerAction() {
    if (state.paused) {
      return { action: 'ignored' };
    }

    if (state.phase === 'snapping' || state.phase === 'level_clear') {
      return { action: 'ignored' };
    }

    if (state.phase === 'missed') {
      if (state.missElapsed < MISS_RETRY_COOLDOWN) {
        return { action: 'ignored' };
      }

      state.streak = 0;
      state.runBestStreak = 0;
      state.runPerfects = 0;
      state.ripples = [];

      const retryLevel = state.mode === 'daily' ? 1 : state.level;
      loadLevel(retryLevel);
      return { action: 'retry', level: state.level, mode: state.mode };
    }

    if (state.phase !== 'playing') {
      return { action: 'ignored' };
    }

    const ring = state.rings[state.activeRingIndex];
    if (!ring) {
      return { action: 'ignored' };
    }

    const evaluation = evaluateSnap(state.orbAngle, ring.arcCenter, ring.arcWidth);

    if (evaluation.outcome === 'miss') {
      const peakStreak = Math.max(state.runBestStreak, state.streak);
      state.runBestStreak = peakStreak;
      state.streak = 0;
      state.phase = 'missed';
      state.phaseTimer = 0;
      state.missElapsed = 0;
      state.ripples.push({
        type: 'miss',
        angle: state.orbAngle,
        radiusRatio: ring.radiusRatio,
        age: 0,
        duration: MISS_RIPPLE_DURATION
      });

      if (state.mode === 'daily') {
        state.dailyStats = {
          bestLevel: Math.max(state.dailyStats.bestLevel, state.level),
          bestStreak: Math.max(state.dailyStats.bestStreak, peakStreak),
          lastLevel: state.level,
          lastStreak: peakStreak,
          lastPerfects: state.runPerfects,
          runsCount: (state.dailyStats.runsCount || 0) + 1
        };
        state.bestLevel = state.dailyStats.bestLevel;
        state.bestStreak = state.dailyStats.bestStreak;
        storage.saveDailyStats(state.dailyKey, state.dailyStats);
      }

      return {
        action: 'miss',
        level: state.level,
        delta: evaluation.delta,
        signedDelta: evaluation.signedDelta
      };
    }

    const isPerfect = evaluation.outcome === 'perfect';
    state.hasSnappedOnce = true;
    state.streak += isPerfect ? 2 : 1;
    state.runBestStreak = Math.max(state.runBestStreak, state.streak);
    if (isPerfect) {
      state.runPerfects += 1;
    }

    state.ripples.push({
      type: isPerfect ? 'perfect' : 'hit',
      angle: state.orbAngle,
      radiusRatio: ring.radiusRatio,
      age: 0,
      duration: isPerfect ? PERFECT_RIPPLE_DURATION : HIT_RIPPLE_DURATION
    });

    const isLastRing = state.activeRingIndex >= state.rings.length - 1;
    syncModeProgressOnSuccess(isLastRing ? state.level + 1 : state.level);

    if (isLastRing) {
      state.phase = 'level_clear';
      state.phaseTimer = LEVEL_CLEAR_DURATION;
      state.snapFromRadiusRatio = ring.radiusRatio;
      state.snapToRadiusRatio = 0;
      state.activeRingIndex = state.rings.length;
      state.trail = [];
      state.ripples.push({
        type: 'level_clear',
        angle: state.orbAngle,
        radiusRatio: ring.radiusRatio,
        age: 0,
        duration: LEVEL_CLEAR_RIPPLE_DURATION
      });
    } else {
      const nextRing = state.rings[state.activeRingIndex + 1];
      state.phase = 'snapping';
      state.phaseTimer = SNAP_DURATION;
      state.snapFromRadiusRatio = ring.radiusRatio;
      state.snapToRadiusRatio = nextRing.radiusRatio;
      state.activeRingIndex += 1;
    }

    return {
      action: evaluation.outcome,
      streak: state.streak,
      level: state.level,
      delta: evaluation.delta,
      signedDelta: evaluation.signedDelta,
      levelClear: state.phase === 'level_clear'
    };
  }

  function setMode(mode) {
    if (mode !== 'endless' && mode !== 'daily') return;
    if (mode === state.mode) return;

    state.mode = mode;
    state.streak = 0;
    state.runBestStreak = 0;
    state.runPerfects = 0;
    state.ripples = [];

    if (mode === 'daily') {
      state.dailyKey = dateKeyProvider();
      state.dailyStats = storage.getDailyStats(state.dailyKey);
      state.bestLevel = state.dailyStats.bestLevel;
      state.bestStreak = state.dailyStats.bestStreak;
      loadLevel(1);
    } else {
      const endless = storage.getEndlessStats();
      state.bestLevel = Math.max(endless.bestLevel, endless.currentLevel);
      state.bestStreak = endless.bestStreak;
      loadLevel(endless.currentLevel);
    }
  }

  function setPaused(paused) {
    state.paused = Boolean(paused);
  }

  function formatDailyShareText() {
    const daily = state.dailyStats;
    const isActiveDailyMidRun =
      state.mode === 'daily' &&
      state.phase !== 'missed' &&
      (daily.runsCount === 0 ||
        state.level > 1 ||
        state.runBestStreak > 0 ||
        state.streak > 0 ||
        state.runPerfects > 0);

    const shareLevel = isActiveDailyMidRun ? state.level : daily.lastLevel;
    const shareStreak = isActiveDailyMidRun
      ? Math.max(state.runBestStreak, state.streak)
      : daily.lastStreak;
    const sharePerfects = isActiveDailyMidRun ? state.runPerfects : daily.lastPerfects;

    const paddedLevel = String(shareLevel).padStart(2, '0');
    const paddedStreak = String(shareStreak).padStart(2, '0');
    return `PULSE RING · Daily ${state.dailyKey}\nLevel ${paddedLevel} · Streak ${paddedStreak} · ${sharePerfects} Perfects`;
  }

  function getSnapshot() {
    return {
      mode: state.mode,
      phase: state.phase,
      paused: state.paused,
      level: state.level,
      streak: state.streak,
      runBestStreak: state.runBestStreak,
      bestLevel: state.bestLevel,
      bestStreak: state.bestStreak,
      runPerfects: state.runPerfects,
      hasSnappedOnce: state.hasSnappedOnce,
      activeRingIndex: state.activeRingIndex,
      orbAngle: state.orbAngle,
      rings: state.rings.map((ring) => ({ ...ring })),
      elapsed: state.elapsed,
      phaseTimer: state.phaseTimer,
      missElapsed: state.missElapsed,
      snapFromRadiusRatio: state.snapFromRadiusRatio,
      snapToRadiusRatio: state.snapToRadiusRatio,
      ripples: state.ripples.map((ripple) => ({ ...ripple })),
      trail: state.trail.map((sample) => ({ ...sample })),
      dailyKey: state.dailyKey,
      dailyStats: { ...state.dailyStats }
    };
  }

  return {
    state,
    getSnapshot,
    step,
    triggerAction,
    setMode,
    setPaused,
    formatDailyShareText
  };
}
