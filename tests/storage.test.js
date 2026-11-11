import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage } from '../src/game/storage.js';

function createMapStorage(initialEntries = []) {
  const map = new Map(initialEntries);
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); }
  };
}

describe('storage', () => {
  it('survives throwing or inaccessible localStorage without failing', () => {
    const brokenStorage = {
      getItem() { throw new Error('SecurityError'); },
      setItem() { throw new Error('QuotaExceededError'); }
    };
    const store = createStorage(brokenStorage);
    assert.equal(store.getTheme(true), 'dark');
    assert.equal(store.getTheme(false), 'light');
    assert.equal(store.getMuted(), false);
    assert.deepEqual(store.getEndlessStats(), { currentLevel: 1, bestLevel: 1, bestStreak: 0 });
    store.saveEndlessStats({ currentLevel: 5, bestLevel: 5, bestStreak: 10 });
  });

  it('recovers safely from corrupted JSON in storage', () => {
    const map = new Map([['pulse-ring:endless', '{not-valid-json']]);
    const mock = {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => map.set(k, v)
    };
    const store = createStorage(mock);
    assert.deepEqual(store.getEndlessStats(), { currentLevel: 1, bestLevel: 1, bestStreak: 0 });
  });

  it('persists theme and muted preferences and rejects corrupted preference values', () => {
    const mock = createMapStorage([
      ['pulse-ring:theme', 'neon'],
      ['pulse-ring:muted', 'maybe']
    ]);
    const store = createStorage(mock);
    assert.equal(store.getTheme(true), 'dark');
    assert.equal(store.getTheme(false), 'light');
    assert.equal(store.getMuted(), false);

    store.setTheme('light');
    assert.equal(store.getTheme(true), 'light');
    store.setTheme('dark');
    assert.equal(store.getTheme(false), 'dark');

    store.setMuted(true);
    assert.equal(store.getMuted(), true);
    store.setMuted(false);
    assert.equal(store.getMuted(), false);
  });

  it('persists endless and daily stats independently per dateKey and sanitizes invalid fields', () => {
    const mock = createMapStorage([
      ['pulse-ring:endless', JSON.stringify({ currentLevel: -2, bestLevel: 'bad', bestStreak: 4.9 })],
      ['pulse-ring:daily:2026-11-11', '{broken']
    ]);
    const store = createStorage(mock);

    assert.deepEqual(store.getEndlessStats(), { currentLevel: 1, bestLevel: 1, bestStreak: 4 });
    assert.deepEqual(store.getDailyStats('2026-11-11'), {
      bestLevel: 1,
      bestStreak: 0,
      lastLevel: 1,
      lastStreak: 0,
      lastPerfects: 0,
      runsCount: 0
    });

    store.saveEndlessStats({ currentLevel: 4, bestLevel: 7, bestStreak: 11 });
    assert.deepEqual(store.getEndlessStats(), { currentLevel: 4, bestLevel: 7, bestStreak: 11 });

    store.saveDailyStats('2026-11-11', {
      bestLevel: 5,
      bestStreak: 9,
      lastLevel: 5,
      lastStreak: 9,
      lastPerfects: 3,
      runsCount: 2
    });
    assert.deepEqual(store.getDailyStats('2026-11-11'), {
      bestLevel: 5,
      bestStreak: 9,
      lastLevel: 5,
      lastStreak: 9,
      lastPerfects: 3,
      runsCount: 2
    });
    assert.deepEqual(store.getDailyStats('2026-11-12'), {
      bestLevel: 1,
      bestStreak: 0,
      lastLevel: 1,
      lastStreak: 0,
      lastPerfects: 0,
      runsCount: 0
    });
  });

  it('maintains in-memory fallback within the session when storage is null or throws on write', () => {
    const nullStore = createStorage(null);
    nullStore.setTheme('light');
    nullStore.setMuted(true);
    nullStore.saveEndlessStats({ currentLevel: 3, bestLevel: 4, bestStreak: 6 });
    nullStore.saveDailyStats('2026-11-11', {
      bestLevel: 2,
      bestStreak: 4,
      lastLevel: 2,
      lastStreak: 4,
      lastPerfects: 1,
      runsCount: 1
    });

    assert.equal(nullStore.getTheme(true), 'light');
    assert.equal(nullStore.getMuted(), true);
    assert.deepEqual(nullStore.getEndlessStats(), { currentLevel: 3, bestLevel: 4, bestStreak: 6 });
    assert.deepEqual(nullStore.getDailyStats('2026-11-11'), {
      bestLevel: 2,
      bestStreak: 4,
      lastLevel: 2,
      lastStreak: 4,
      lastPerfects: 1,
      runsCount: 1
    });
  });

  it('prefers updated in-memory fallback over stale stored values when setItem throws QuotaExceededError', () => {
    const existing = new Map([
      ['pulse-ring:theme', 'dark'],
      ['pulse-ring:muted', 'false'],
      ['pulse-ring:endless', JSON.stringify({ currentLevel: 1, bestLevel: 1, bestStreak: 0 })],
      ['pulse-ring:daily:2026-11-11', JSON.stringify({
        bestLevel: 1,
        bestStreak: 0,
        lastLevel: 1,
        lastStreak: 0,
        lastPerfects: 0,
        runsCount: 0
      })]
    ]);
    const quotaStorage = {
      getItem: (k) => (existing.has(k) ? existing.get(k) : null),
      setItem() {
        throw new Error('QuotaExceededError');
      }
    };
    const store = createStorage(quotaStorage);

    store.setTheme('light');
    store.setMuted(true);
    store.saveEndlessStats({ currentLevel: 5, bestLevel: 5, bestStreak: 9 });
    store.saveDailyStats('2026-11-11', {
      bestLevel: 3,
      bestStreak: 6,
      lastLevel: 3,
      lastStreak: 6,
      lastPerfects: 2,
      runsCount: 1
    });

    assert.equal(store.getTheme(true), 'light');
    assert.equal(store.getMuted(), true);
    assert.deepEqual(store.getEndlessStats(), { currentLevel: 5, bestLevel: 5, bestStreak: 9 });
    assert.deepEqual(store.getDailyStats('2026-11-11'), {
      bestLevel: 3,
      bestStreak: 6,
      lastLevel: 3,
      lastStreak: 6,
      lastPerfects: 2,
      runsCount: 1
    });
  });
});
