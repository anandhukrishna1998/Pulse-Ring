import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAudioSynth, PENTATONIC_HZ } from '../src/audio/synth.js';

function createMockAudioContextClass(overrides = {}) {
  const events = [];
  let instances = 0;
  let lastInstance = null;

  class MockAudioContext {
    constructor() {
      if (overrides.throwInConstructor) {
        throw new Error('AudioContext blocked');
      }
      instances += 1;
      this.state = overrides.initialState ?? 'suspended';
      this.currentTime = overrides.currentTime ?? 1.0;
      this.destination = {};
      lastInstance = this;
    }

    resume() {
      if (typeof overrides.resume === 'function') {
        return overrides.resume(this, events);
      }
      this.state = 'running';
      events.push({ type: 'resume' });
      return Promise.resolve();
    }

    createOscillator() {
      if (overrides.throwInCreateOscillator) {
        throw new Error('Oscillator failed');
      }
      const osc = {
        type: 'sine',
        frequency: {
          setValueAtTime: (v, t) => events.push({ type: 'freq', v, t, wave: osc.type }),
          exponentialRampToValueAtTime: (v, t) => events.push({ type: 'freqRamp', v, t, wave: osc.type })
        },
        connect: () => {},
        start: (t) => events.push({ type: 'start', t, wave: osc.type }),
        stop: (t) => events.push({ type: 'stop', t, wave: osc.type })
      };
      return osc;
    }

    createGain() {
      const gainEvents = [];
      return {
        gain: {
          setValueAtTime: (v, t) => {
            const ev = { type: 'gain', v, t };
            gainEvents.push(ev);
            events.push(ev);
          },
          exponentialRampToValueAtTime: (v, t) => {
            const ev = { type: 'gainRamp', v, t };
            gainEvents.push(ev);
            events.push(ev);
          }
        },
        connect: () => {},
        _gainEvents: gainEvents
      };
    }
  }

  return { MockAudioContext, events, getInstances: () => instances, getLastInstance: () => lastInstance };
}

describe('audio synth', () => {
  it('exposes the exact 8-note C-major pentatonic frequency table', () => {
    assert.deepEqual(
      PENTATONIC_HZ,
      [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51]
    );
  });

  it('no-ops gracefully when AudioContext is missing or muted', () => {
    const silent = createAudioSynth({ AudioContextClass: null, muted: false });
    silent.unlock();
    silent.playSnap(0, true);
    silent.playLevelClear(1);
    silent.playMiss();

    const withNullOpts = createAudioSynth(null);
    withNullOpts.unlock();
    withNullOpts.playSnap(0, false);

    const { MockAudioContext, events } = createMockAudioContextClass();
    const muted = createAudioSynth({ AudioContextClass: MockAudioContext, muted: true });
    assert.equal(muted.isMuted(), true);
    muted.unlock();
    muted.playSnap(2, true);
    muted.playLevelClear(1);
    muted.playMiss();
    assert.equal(events.filter((e) => e.type === 'start').length, 0);
  });

  it('unlocks on gesture and plays ascending pentatonic notes and perfect overtone', () => {
    const { MockAudioContext, events } = createMockAudioContextClass();
    const synth = createAudioSynth({ AudioContextClass: MockAudioContext, muted: false });
    assert.equal(synth.isMuted(), false);
    synth.unlock();
    synth.playSnap(0, false);
    synth.playSnap(1, true);
    synth.playLevelClear(2);
    synth.playMiss();

    const freqs = events.filter((e) => e.type === 'freq').map((e) => e.v);
    assert.equal(freqs[0], PENTATONIC_HZ[0]);
    assert.equal(freqs[1], PENTATONIC_HZ[1]);
    assert.ok(freqs.length >= 5);

    const perfectOvertones = events.filter((e) => e.type === 'freq' && e.wave === 'triangle');
    assert.ok(perfectOvertones.length >= 1);
  });

  it('wraps streakIndex modulo PENTATONIC_HZ.length and handles invalid inputs safely', () => {
    const { MockAudioContext, events } = createMockAudioContextClass();
    const synth = createAudioSynth({ AudioContextClass: MockAudioContext });

    synth.playSnap(0, false);
    synth.playSnap(PENTATONIC_HZ.length, false);
    synth.playSnap(PENTATONIC_HZ.length + 3, false);
    synth.playSnap(-5, false);
    synth.playSnap(Number.NaN, false);
    synth.playLevelClear(Number.NaN);

    const freqs = events.filter((e) => e.type === 'freq').map((e) => e.v);
    assert.equal(freqs[0], PENTATONIC_HZ[0]);
    assert.equal(freqs[1], PENTATONIC_HZ[0]);
    assert.equal(freqs[2], PENTATONIC_HZ[3]);
    assert.equal(freqs[3], PENTATONIC_HZ[0]);
    assert.equal(freqs[4], PENTATONIC_HZ[0]);
    assert.ok(freqs.slice(5).every((f) => Number.isFinite(f) && f > 0));
  });

  it('toggles mute state cleanly and creates AudioContext lazily only when unmuted', () => {
    const { MockAudioContext, events, getInstances } = createMockAudioContextClass();
    const synth = createAudioSynth({ AudioContextClass: MockAudioContext, muted: true });

    synth.unlock();
    synth.playSnap(0, false);
    assert.equal(getInstances(), 0);
    assert.equal(events.length, 0);

    synth.setMuted(false);
    assert.equal(synth.isMuted(), false);
    synth.playSnap(2, false);
    assert.equal(getInstances(), 1);
    assert.equal(events.filter((e) => e.type === 'start').length, 1);

    synth.setMuted(true);
    assert.equal(synth.isMuted(), true);
    synth.playSnap(3, true);
    synth.playLevelClear(3);
    synth.playMiss();
    assert.equal(events.filter((e) => e.type === 'start').length, 1);
  });

  it('handles throwing AudioContext constructor, broken nodes, and non-function AudioContextClass', () => {
    const throwingCtor = createMockAudioContextClass({ throwInConstructor: true });
    const s1 = createAudioSynth({ AudioContextClass: throwingCtor.MockAudioContext });
    assert.doesNotThrow(() => {
      s1.unlock();
      s1.playSnap(0, true);
      s1.playLevelClear(1);
      s1.playMiss();
    });

    const invalidCtor = createAudioSynth({ AudioContextClass: 'not-a-class' });
    assert.doesNotThrow(() => {
      invalidCtor.unlock();
      invalidCtor.playSnap(0, false);
    });

    const brokenNode = createMockAudioContextClass({
      initialState: 'running',
      throwInCreateOscillator: true
    });
    const s2 = createAudioSynth({ AudioContextClass: brokenNode.MockAudioContext });
    assert.doesNotThrow(() => {
      s2.unlock();
      s2.playSnap(1, true);
      s2.playLevelClear(2);
      s2.playMiss();
    });
  });

  it('handles synchronous throw and async rejection in resume() without unhandled rejections and no-ops when suspended', async () => {
    let unhandledRejection = null;
    const onUnhandled = (reason) => {
      unhandledRejection = reason;
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      const rejecting = createMockAudioContextClass({
        initialState: 'suspended',
        resume: (_ctx, events) => {
          events.push({ type: 'resume_reject' });
          return Promise.reject(new Error('NotAllowedError'));
        }
      });
      const synthReject = createAudioSynth({ AudioContextClass: rejecting.MockAudioContext });
      synthReject.unlock();
      synthReject.playSnap(0, true);
      synthReject.playLevelClear(1);
      synthReject.playMiss();

      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(unhandledRejection, null);
      assert.equal(rejecting.events.filter((e) => e.type === 'start').length, 0);

      const syncThrow = createMockAudioContextClass({
        initialState: 'suspended',
        resume: () => {
          throw new Error('Sync resume failure');
        }
      });
      const synthSyncThrow = createAudioSynth({ AudioContextClass: syncThrow.MockAudioContext });
      assert.doesNotThrow(() => {
        synthSyncThrow.unlock();
        synthSyncThrow.playSnap(0, false);
      });
      assert.equal(syncThrow.events.filter((e) => e.type === 'start').length, 0);

      const closed = createMockAudioContextClass({ initialState: 'closed' });
      const synthClosed = createAudioSynth({ AudioContextClass: closed.MockAudioContext });
      synthClosed.unlock();
      synthClosed.playSnap(0, false);
      assert.equal(closed.events.filter((e) => e.type === 'start').length, 0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('uses positive anti-click gain envelopes and 185Hz -> 120Hz miss sweep', () => {
    const { MockAudioContext, events } = createMockAudioContextClass();
    const synth = createAudioSynth({ AudioContextClass: MockAudioContext });
    synth.unlock();

    synth.playSnap(0, true);
    synth.playLevelClear(1);
    synth.playMiss();

    const gainEvents = events.filter((e) => e.type === 'gain' || e.type === 'gainRamp');
    const starts = events.filter((e) => e.type === 'start');
    const stops = events.filter((e) => e.type === 'stop');

    assert.equal(starts.length, stops.length);
    assert.equal(gainEvents.length, starts.length * 3);

    for (const e of gainEvents) {
      assert.ok(e.v > 0, `Expected strictly positive gain value for exponentialRamp, got ${e.v}`);
    }

    for (let i = 0; i < starts.length; i++) {
      const g0 = gainEvents[i * 3];
      const g1 = gainEvents[i * 3 + 1];
      const g2 = gainEvents[i * 3 + 2];
      assert.ok(g0.v <= 0.001, 'Envelope must start near silence to avoid attack click');
      assert.ok(g1.v > g0.v, 'Envelope must ramp up to peak gain');
      assert.ok(g2.v <= 0.001, 'Envelope must decay near silence before stop to avoid release pop');
      assert.ok(
        g0.t === starts[i].t && g0.t < g1.t && g1.t < g2.t && g2.t < stops[i].t,
        'Envelope timestamps must increase monotonically and settle before stop'
      );
    }

    const missFreq = events.filter((e) => e.type === 'freq').at(-1);
    const missRamp = events.filter((e) => e.type === 'freqRamp').at(-1);
    assert.equal(missFreq.wave, 'sine');
    assert.equal(missFreq.v, 185);
    assert.equal(missRamp.v, 120);
  });

  it('resolves globalThis AudioContext or webkitAudioContext when omitted, but honors explicit null', () => {
    const originalAudioContext = globalThis.AudioContext;
    const originalWebkit = globalThis.webkitAudioContext;
    const { MockAudioContext, events } = createMockAudioContextClass();

    try {
      delete globalThis.AudioContext;
      globalThis.webkitAudioContext = MockAudioContext;

      const implicit = createAudioSynth();
      implicit.unlock();
      implicit.playSnap(0, false);
      assert.equal(events.filter((e) => e.type === 'start').length, 1);

      const explicitNull = createAudioSynth({ AudioContextClass: null });
      explicitNull.unlock();
      explicitNull.playSnap(0, false);
      assert.equal(events.filter((e) => e.type === 'start').length, 1);
    } finally {
      if (originalAudioContext === undefined) {
        delete globalThis.AudioContext;
      } else {
        globalThis.AudioContext = originalAudioContext;
      }
      if (originalWebkit === undefined) {
        delete globalThis.webkitAudioContext;
      } else {
        globalThis.webkitAudioContext = originalWebkit;
      }
    }
  });

  it('plays first-tap audio once async resume() transitions initial suspended state to running and deduplicates resume calls', async () => {
    const { MockAudioContext, events } = createMockAudioContextClass({
      initialState: 'suspended',
      currentTime: 0,
      resume: (ctx, ev) => {
        ev.push({ type: 'resume' });
        return Promise.resolve().then(() => {
          ctx.state = 'running';
          ctx.currentTime = 1.25;
        });
      }
    });

    const synth = createAudioSynth({ AudioContextClass: MockAudioContext, muted: false });
    synth.unlock();
    synth.playSnap(0, false);

    assert.equal(events.filter((e) => e.type === 'resume').length, 1);
    assert.equal(events.filter((e) => e.type === 'start').length, 0);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const starts = events.filter((e) => e.type === 'start');
    const freqs = events.filter((e) => e.type === 'freq');
    assert.equal(events.filter((e) => e.type === 'resume').length, 1);
    assert.equal(starts.length, 1);
    assert.equal(starts[0].t, 1.25);
    assert.equal(freqs[0].v, PENTATONIC_HZ[0]);
  });

  it('recovers post-interruption audio when async resume() resolves from interrupted state', async () => {
    const { MockAudioContext, events, getLastInstance } = createMockAudioContextClass({
      initialState: 'suspended',
      resume: (ctx, ev) => {
        ev.push({ type: 'resume' });
        return Promise.resolve().then(() => {
          ctx.state = 'running';
          ctx.currentTime += 0.5;
        });
      }
    });

    const synth = createAudioSynth({ AudioContextClass: MockAudioContext });
    synth.unlock();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(getLastInstance().state, 'running');

    getLastInstance().state = 'interrupted';
    synth.unlock();
    synth.playLevelClear(1);
    synth.playMiss();

    assert.equal(events.filter((e) => e.type === 'resume').length, 2);
    assert.equal(events.filter((e) => e.type === 'start').length, 0);

    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(events.filter((e) => e.type === 'resume').length, 2);
    assert.equal(events.filter((e) => e.type === 'start').length, 4);
    const missFreq = events.filter((e) => e.type === 'freq').at(-1);
    assert.equal(missFreq.v, 185);
  });

  it('cancels queued async-resume playback when muted before resolution, stuck suspended, or stale', async () => {
    // 1. Muted before async resume settles
    const mutedBeforeResolve = createMockAudioContextClass({
      initialState: 'suspended',
      resume: (ctx, ev) => {
        ev.push({ type: 'resume' });
        return Promise.resolve().then(() => {
          ctx.state = 'running';
        });
      }
    });
    const sMuted = createAudioSynth({ AudioContextClass: mutedBeforeResolve.MockAudioContext });
    sMuted.unlock();
    sMuted.playSnap(0, true);
    sMuted.setMuted(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(mutedBeforeResolve.events.filter((e) => e.type === 'start').length, 0);

    // 2. Async resume resolves while state remains suspended
    const stuckSuspended = createMockAudioContextClass({
      initialState: 'suspended',
      resume: (_ctx, ev) => {
        ev.push({ type: 'resume' });
        return Promise.resolve();
      }
    });
    const sStuck = createAudioSynth({ AudioContextClass: stuckSuspended.MockAudioContext });
    sStuck.unlock();
    sStuck.playSnap(1, false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(stuckSuspended.events.filter((e) => e.type === 'start').length, 0);

    // 3. Resume settles after >300ms stale window
    let nowMs = 1000;
    const originalDateNow = Date.now;
    Date.now = () => nowMs;
    try {
      let resolveDelayed;
      const delayed = createMockAudioContextClass({
        initialState: 'suspended',
        resume: (ctx, ev) => {
          ev.push({ type: 'resume' });
          return new Promise((resolve) => {
            resolveDelayed = () => {
              ctx.state = 'running';
              resolve();
            };
          });
        }
      });
      const sStale = createAudioSynth({ AudioContextClass: delayed.MockAudioContext });
      sStale.unlock();
      sStale.playSnap(2, false);
      nowMs += 301;
      resolveDelayed();
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(delayed.events.filter((e) => e.type === 'start').length, 0);
    } finally {
      Date.now = originalDateNow;
    }
  });

  it('sets navigator.audioSession.type to playback when unmuted, primes a silent buffer on unlock, and recovers from hung resume()', async () => {
    const mockNav = { audioSession: { type: 'auto' } };
    const bufferOps = [];

    class PrimingAudioContext extends createMockAudioContextClass({ initialState: 'running' }).MockAudioContext {
      createBuffer(channels, length, sampleRate) {
        const buf = { channels, length, sampleRate };
        bufferOps.push(['createBuffer', channels, length, sampleRate]);
        return buf;
      }
      createBufferSource() {
        const src = {
          buffer: null,
          connect: () => bufferOps.push(['connect']),
          start: (t) => bufferOps.push(['startBuffer', t, src.buffer?.length])
        };
        return src;
      }
    }

    // Muted synth must never change navigator.audioSession or construct AudioContext
    const mutedSynth = createAudioSynth({
      AudioContextClass: PrimingAudioContext,
      navigator: mockNav,
      muted: true
    });
    mutedSynth.unlock();
    assert.equal(mockNav.audioSession.type, 'auto');
    assert.equal(bufferOps.length, 0);

    // Unmuting and unlocking configures playback audioSession & primes 1-sample silent buffer once
    mutedSynth.setMuted(false);
    mutedSynth.unlock();
    assert.equal(mockNav.audioSession.type, 'playback');
    assert.deepEqual(bufferOps, [
      ['createBuffer', 1, 1, 22050],
      ['connect'],
      ['startBuffer', 0, 1]
    ]);

    // Hung/never-settling resume() outside gesture must NOT permanently wedge subsequent taps after stale window
    let resumeAttempts = 0;
    let nowMs = 5000;
    const originalDateNow = Date.now;
    Date.now = () => nowMs;
    try {
      const events = [];
      class RecoveringAudioContext {
        constructor() {
          this.state = 'suspended';
          this.currentTime = 0;
          this.destination = {};
        }
        resume() {
          resumeAttempts += 1;
          events.push({ type: 'resume', attempt: resumeAttempts });
          if (resumeAttempts === 1) {
            return new Promise(() => {}); // Hung promise (e.g. pointerdown blocked on iOS)
          }
          return Promise.resolve().then(() => {
            this.state = 'running';
            this.currentTime = 0.5;
          });
        }
        createOscillator() {
          const osc = {
            type: 'sine',
            frequency: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
            connect: () => {},
            start: (t) => events.push({ type: 'start', t }),
            stop: () => {}
          };
          return osc;
        }
        createGain() {
          return {
            gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
            connect: () => {}
          };
        }
      }

      const recovering = createAudioSynth({ AudioContextClass: RecoveringAudioContext });
      recovering.unlock(); // Attempt 1 hangs
      assert.equal(resumeAttempts, 1);

      nowMs += 400; // Stale hung promise (>300ms) allows retry cleanly
      recovering.unlock();
      recovering.playSnap(0, false);
      assert.equal(resumeAttempts, 2);

      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(events.filter((e) => e.type === 'start').length, 1);

      // Simulate iOS pointerdown hang followed 50ms later (<300ms) by touchend calling unlock({ force: true })
      resumeAttempts = 0;
      events.length = 0;
      const iosTap = createAudioSynth({ AudioContextClass: RecoveringAudioContext });
      iosTap.unlock(); // Attempt 1 (pointerdown) hangs
      iosTap.playSnap(1, false); // Queued waiting for unlock
      assert.equal(resumeAttempts, 1);

      nowMs += 50; // touchend 50ms later MUST retry resume when forced and replay queued snap chime
      iosTap.unlock({ force: true });
      assert.equal(resumeAttempts, 2);

      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(events.filter((e) => e.type === 'start').length, 1);
    } finally {
      Date.now = originalDateNow;
    }
  });
});
