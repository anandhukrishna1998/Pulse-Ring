export const PENTATONIC_HZ = Object.freeze([
  523.25,
  587.33,
  659.25,
  783.99,
  880.0,
  1046.5,
  1174.66,
  1318.51
]);

const GAIN_FLOOR = 0.0001;
const RESUME_REPLAY_WINDOW_MS = 300;

function resolveAudioContextClass(options) {
  if (
    options &&
    Object.prototype.hasOwnProperty.call(options, 'AudioContextClass') &&
    options.AudioContextClass !== undefined
  ) {
    return typeof options.AudioContextClass === 'function' ? options.AudioContextClass : null;
  }

  try {
    const ctor = globalThis?.AudioContext ?? globalThis?.webkitAudioContext ?? null;
    return typeof ctor === 'function' ? ctor : null;
  } catch {
    return null;
  }
}

function resolveNavigator(options) {
  if (options && Object.prototype.hasOwnProperty.call(options, 'navigator')) {
    return options.navigator ?? null;
  }
  try {
    return typeof navigator !== 'undefined' ? navigator : null;
  } catch {
    return null;
  }
}

function getPentatonicFreq(streakIndex) {
  const safeIndex = Number.isFinite(streakIndex) ? Math.max(0, Math.floor(streakIndex)) : 0;
  return PENTATONIC_HZ[safeIndex % PENTATONIC_HZ.length];
}

function getNow(context) {
  return Number.isFinite(context?.currentTime) ? Math.max(0, context.currentTime) : 0;
}

function scheduleTone(context, { type = 'sine', freq, endFreq, startTime, duration, peakGain, attack = 0.01 }) {
  const osc = context.createOscillator();
  const gainNode = context.createGain();

  const t0 = Math.max(0, startTime);
  const safeDuration = Math.max(0.02, duration);
  const attackEnd = t0 + Math.min(attack, safeDuration * 0.35);
  const decayEnd = t0 + safeDuration;
  const stopTime = decayEnd + 0.005;
  const safePeak = Math.max(GAIN_FLOOR * 2, peakGain);

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (Number.isFinite(endFreq) && endFreq > 0 && endFreq !== freq) {
    osc.frequency.exponentialRampToValueAtTime(endFreq, decayEnd);
  }

  gainNode.gain.setValueAtTime(GAIN_FLOOR, t0);
  gainNode.gain.exponentialRampToValueAtTime(safePeak, attackEnd);
  gainNode.gain.exponentialRampToValueAtTime(GAIN_FLOOR, decayEnd);

  osc.connect(gainNode);
  gainNode.connect(context.destination);

  osc.start(t0);
  osc.stop(stopTime);
}

/**
 * Create a zero-asset procedural Web Audio pentatonic synthesizer.
 * @param {{ AudioContextClass?: typeof AudioContext | null, navigator?: Navigator | null, muted?: boolean }} [options]
 */
export function createAudioSynth(options = {}) {
  const ContextCtor = resolveAudioContextClass(options);
  const nav = resolveNavigator(options);
  let muted = Boolean(options?.muted);
  let muteEpoch = 0;
  let ctx = null;
  let pendingResume = null;
  let pendingResumeStartedAt = 0;
  let bufferPrimedForCtx = null;
  let waitingCallbacks = [];

  function enablePlaybackAudioSession() {
    if (muted || !nav) return;
    try {
      if ('audioSession' in nav && nav.audioSession && nav.audioSession.type !== 'playback') {
        nav.audioSession.type = 'playback';
      }
    } catch {
      // Ignore unsupported or read-only navigator.audioSession environments.
    }
  }

  function primeSilentBuffer(context) {
    if (!context || bufferPrimedForCtx === context) {
      return;
    }
    if (typeof context.createBuffer !== 'function' || typeof context.createBufferSource !== 'function') {
      return;
    }
    try {
      const buffer = context.createBuffer(1, 1, 22050);
      const source = context.createBufferSource();
      if (!source || typeof source.connect !== 'function' || typeof source.start !== 'function') {
        return;
      }
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(0);
      if (context.state == null || context.state === 'running') {
        bufferPrimedForCtx = context;
      }
    } catch {
      // Ignore silent-buffer priming errors before audio unlock completes.
    }
  }

  function pruneWaitingCallbacks(nowMs) {
    if (waitingCallbacks.length === 0) return;
    waitingCallbacks = waitingCallbacks.filter(
      (entry) =>
        !muted &&
        entry.queuedMuteEpoch === muteEpoch &&
        entry.targetCtx === ctx &&
        nowMs - entry.queuedAt <= RESUME_REPLAY_WINDOW_MS
    );
  }

  function flushWaitingCallbacks() {
    if (waitingCallbacks.length === 0 || muted || !ctx) {
      return;
    }
    if (ctx.state != null && ctx.state !== 'running') {
      return;
    }
    primeSilentBuffer(ctx);
    const nowMs = Date.now();
    const pending = waitingCallbacks;
    waitingCallbacks = [];
    for (const entry of pending) {
      if (
        !muted &&
        entry.queuedMuteEpoch === muteEpoch &&
        entry.targetCtx === ctx &&
        nowMs - entry.queuedAt <= RESUME_REPLAY_WINDOW_MS
      ) {
        try {
          entry.schedule(ctx);
        } catch {
          // Silent fallback if Web Audio node scheduling fails.
        }
      }
    }
  }

  function startResume(context, force = false) {
    const nowMs = Date.now();
    if (!force && pendingResume && nowMs - pendingResumeStartedAt <= RESUME_REPLAY_WINDOW_MS) {
      return pendingResume;
    }
    if (!context || typeof context.resume !== 'function') {
      return null;
    }

    let rawResult;
    try {
      rawResult = context.resume();
    } catch {
      return null;
    }

    if (context.state == null || context.state === 'running') {
      pendingResume = null;
      pendingResumeStartedAt = 0;
      if (rawResult && typeof rawResult.catch === 'function') {
        rawResult.catch(() => {});
      }
      flushWaitingCallbacks();
      return null;
    }

    if (!rawResult || typeof rawResult.then !== 'function') {
      return null;
    }

    pendingResumeStartedAt = nowMs;
    let tracked;
    tracked = Promise.resolve(rawResult)
      .then(
        () => {
          flushWaitingCallbacks();
          return true;
        },
        () => false
      )
      .finally(() => {
        if (pendingResume === tracked) {
          pendingResume = null;
          pendingResumeStartedAt = 0;
        }
      });

    pendingResume = tracked;
    return tracked;
  }

  function ensureContext({ forceResume = false } = {}) {
    if (muted || !ContextCtor) {
      return null;
    }

    enablePlaybackAudioSession();

    if (!ctx) {
      try {
        ctx = new ContextCtor();
      } catch {
        ctx = null;
        return null;
      }
    }

    if (!ctx) {
      return null;
    }

    if (ctx.state === 'interrupted') {
      bufferPrimedForCtx = null;
    }

    if (ctx.state == null || ctx.state === 'running') {
      primeSilentBuffer(ctx);
      flushWaitingCallbacks();
      return ctx;
    }

    if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
      primeSilentBuffer(ctx);
      startResume(ctx, forceResume);
      if (ctx.state === 'running') {
        primeSilentBuffer(ctx);
        flushWaitingCallbacks();
        return ctx;
      }
    }

    return null;
  }

  function runWhenReady(schedule) {
    const readyCtx = ensureContext();
    if (readyCtx) {
      try {
        schedule(readyCtx);
      } catch {
        // Silent fallback if Web Audio node scheduling fails.
      }
      return;
    }

    if (muted || !ctx || !pendingResume) {
      return;
    }

    const nowMs = Date.now();
    pruneWaitingCallbacks(nowMs);
    waitingCallbacks.push({
      schedule,
      queuedAt: nowMs,
      queuedMuteEpoch: muteEpoch,
      targetCtx: ctx
    });
  }

  function unlock(unlockOptions = {}) {
    ensureContext({ forceResume: Boolean(unlockOptions?.force) });
  }

  function setMuted(nextMuted) {
    const next = Boolean(nextMuted);
    if (next !== muted) {
      muteEpoch += 1;
      muted = next;
      waitingCallbacks = [];
    }
  }

  function isMuted() {
    return muted;
  }

  function playSnap(streakIndex = 0, isPerfect = false) {
    const baseFreq = getPentatonicFreq(streakIndex);
    const perfect = Boolean(isPerfect);

    runWhenReady((context) => {
      const now = getNow(context);

      scheduleTone(context, {
        type: 'sine',
        freq: baseFreq,
        startTime: now,
        duration: 0.14,
        peakGain: 0.13,
        attack: 0.008
      });

      if (perfect) {
        scheduleTone(context, {
          type: 'triangle',
          freq: baseFreq * 1.5,
          startTime: now + 0.012,
          duration: 0.16,
          peakGain: 0.055,
          attack: 0.01
        });
        scheduleTone(context, {
          type: 'sine',
          freq: baseFreq * 2,
          startTime: now + 0.022,
          duration: 0.18,
          peakGain: 0.045,
          attack: 0.01
        });
      }
    });
  }

  function playLevelClear(level = 1) {
    const safeLevel = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
    const rootFreq = PENTATONIC_HZ[(safeLevel - 1) % 5];

    runWhenReady((context) => {
      const now = getNow(context);

      scheduleTone(context, {
        type: 'sine',
        freq: rootFreq,
        startTime: now,
        duration: 0.17,
        peakGain: 0.11,
        attack: 0.01
      });
      scheduleTone(context, {
        type: 'triangle',
        freq: rootFreq * 1.5,
        startTime: now + 0.06,
        duration: 0.19,
        peakGain: 0.075,
        attack: 0.01
      });
      scheduleTone(context, {
        type: 'sine',
        freq: rootFreq * 2,
        startTime: now + 0.12,
        duration: 0.22,
        peakGain: 0.09,
        attack: 0.01
      });
    });
  }

  function playMiss() {
    runWhenReady((context) => {
      const now = getNow(context);
      scheduleTone(context, {
        type: 'sine',
        freq: 185,
        endFreq: 120,
        startTime: now,
        duration: 0.2,
        peakGain: 0.11,
        attack: 0.012
      });
    });
  }

  return {
    unlock,
    setMuted,
    isMuted,
    playSnap,
    playLevelClear,
    playMiss
  };
}
