const FNV1A_OFFSET_BASIS = 2166136261;
const FNV1A_PRIME = 16777619;

/**
 * Compute an unsigned 32-bit FNV-1a hash of a string.
 * @param {string} input
 * @returns {number}
 */
export function fnv1a32(input) {
  const str = String(input);
  let hash = FNV1A_OFFSET_BASIS;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, FNV1A_PRIME);
  }
  return hash >>> 0;
}

/**
 * Create a deterministic Mulberry32 PRNG yielding floats in [0, 1).
 * @param {string} seedStr
 * @returns {() => number}
 */
export function createSeededRng(seedStr) {
  let state = fnv1a32(seedStr);
  return function nextRandom() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Format a Date as a UTC 'YYYY-MM-DD' daily challenge key.
 * @param {Date} [date]
 * @returns {string}
 */
export function getDailyDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().slice(0, 10);
}

/**
 * Create an independent deterministic PRNG stream for a (mode, level, seedKey) tuple.
 * @param {'endless' | 'daily'} mode
 * @param {number} level
 * @param {string} [seedKey='']
 * @returns {() => number}
 */
export function createLevelRng(mode, level, seedKey = '') {
  const seed = mode === 'daily'
    ? `pulse-ring:${seedKey}:level:${level}`
    : `pulse-ring:${mode}:${seedKey}:level:${level}`;
  return createSeededRng(seed);
}
