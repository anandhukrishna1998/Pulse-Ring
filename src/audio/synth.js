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

function getPentatonicFreq(streakIndex) {
  const safeIndex = Number.isFinite(streakIndex) ? Math.max(0, Math.floor(streakIndex)) : 0;
  return PENTATONIC_HZ[safeIndex % PENTATONIC_HZ.length];
}

function getNow(context) {
  return Number.isFinite(context?.currentTime) ? Math.max(0, context.currentTime) : 0;
}

function safeResume(context) {
  if (!context || typeof context.resume !== 'function') return;
  try {
    const result = context.resume();
    if (result && typeof result.catch === 'function') {
      result.catch(() => {});
    }
  } catch {
    // Ignore synchronous resume errors in restricted browser policies.
  }
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
 * @param {{ AudioContextClass?: typeof AudioContext | null, muted?: boolean }} [options]
 */
export function createAudioSynth(options = {}) {
  const ContextCtor = resolveAudioContextClass(options);
  let muted = Boolean(options?.muted);
  let ctx = null;

  function ensureContext() {
    if (muted || !ContextCtor) {
      return null;
    }

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

    if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
      safeResume(ctx);
    }

    if (ctx.state != null && ctx.state !== 'running') {
      return null;
    }

    return ctx;
  }

  function unlock() {
    ensureContext();
  }

  function setMuted(nextMuted) {
    muted = Boolean(nextMuted);
  }

  function isMuted() {
    return muted;
  }

  function playSnap(streakIndex = 0, isPerfect = false) {
    const context = ensureContext();
    if (!context) return;

    try {
      const now = getNow(context);
      const baseFreq = getPentatonicFreq(streakIndex);

      scheduleTone(context, {
        type: 'sine',
        freq: baseFreq,
        startTime: now,
        duration: 0.14,
        peakGain: 0.13,
        attack: 0.008
      });

      if (isPerfect) {
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
    } catch {
      // Silent fallback if Web Audio node scheduling fails.
    }
  }

  function playLevelClear(level = 1) {
    const context = ensureContext();
    if (!context) return;

    try {
      const now = getNow(context);
      const safeLevel = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
      const rootFreq = PENTATONIC_HZ[(safeLevel - 1) % 5];

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
    } catch {
      // Silent fallback if Web Audio node scheduling fails.
    }
  }

  function playMiss() {
    const context = ensureContext();
    if (!context) return;

    try {
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
    } catch {
      // Silent fallback if Web Audio node scheduling fails.
    }
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
