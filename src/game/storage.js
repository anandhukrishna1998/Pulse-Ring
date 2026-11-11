const THEME_KEY = 'pulse-ring:theme';
const MUTED_KEY = 'pulse-ring:muted';
const ENDLESS_KEY = 'pulse-ring:endless';
const DAILY_KEY_PREFIX = 'pulse-ring:daily:';

function resolveDefaultStorage() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

function toPositiveInt(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : fallback;
}

function toNonNegativeInt(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function parseJsonObject(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sanitizeEndlessStats(raw) {
  const currentLevel = toPositiveInt(raw?.currentLevel, 1);
  const bestLevel = Math.max(currentLevel, toPositiveInt(raw?.bestLevel, 1));
  const bestStreak = toNonNegativeInt(raw?.bestStreak, 0);
  return { currentLevel, bestLevel, bestStreak };
}

function sanitizeDailyStats(raw) {
  const lastLevel = toPositiveInt(raw?.lastLevel, 1);
  const bestLevel = Math.max(lastLevel, toPositiveInt(raw?.bestLevel, 1));
  const lastStreak = toNonNegativeInt(raw?.lastStreak, 0);
  const bestStreak = Math.max(lastStreak, toNonNegativeInt(raw?.bestStreak, 0));
  const lastPerfects = toNonNegativeInt(raw?.lastPerfects, 0);
  const runsCount = toNonNegativeInt(raw?.runsCount, 0);
  return {
    bestLevel,
    bestStreak,
    lastLevel,
    lastStreak,
    lastPerfects,
    runsCount
  };
}

function getDailyStorageKey(dateKey) {
  const safeKey = typeof dateKey === 'string' && dateKey.trim().length > 0
    ? dateKey.trim()
    : 'unknown';
  return `${DAILY_KEY_PREFIX}${safeKey}`;
}

/**
 * Create a safe, zero-throw persistence wrapper over Storage with in-memory fallback.
 * @param {Storage | null} [storageImpl]
 */
export function createStorage(storageImpl) {
  const impl = storageImpl === undefined ? resolveDefaultStorage() : storageImpl;
  const memoryCache = new Map();

  function readRaw(key) {
    try {
      if (impl && typeof impl.getItem === 'function') {
        const value = impl.getItem(key);
        if (value !== null && value !== undefined) {
          return String(value);
        }
      }
    } catch {
      // Fall back to session cache if storage throws (e.g. SecurityError).
    }
    return memoryCache.has(key) ? memoryCache.get(key) : null;
  }

  function writeRaw(key, value) {
    const serialized = String(value);
    try {
      if (impl && typeof impl.setItem === 'function') {
        impl.setItem(key, serialized);
        memoryCache.delete(key);
        return;
      }
    } catch {
      // Fall back to session cache if storage throws (e.g. QuotaExceededError).
    }
    memoryCache.set(key, serialized);
  }

  return {
    /**
     * @param {boolean} [prefersDark=true]
     * @returns {'dark' | 'light'}
     */
    getTheme(prefersDark = true) {
      const raw = readRaw(THEME_KEY);
      if (raw === 'dark' || raw === 'light') {
        return raw;
      }
      return prefersDark ? 'dark' : 'light';
    },

    /**
     * @param {'dark' | 'light'} theme
     */
    setTheme(theme) {
      if (theme === 'dark' || theme === 'light') {
        writeRaw(THEME_KEY, theme);
      }
    },

    /**
     * @returns {boolean}
     */
    getMuted() {
      const raw = readRaw(MUTED_KEY);
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      return false;
    },

    /**
     * @param {boolean} muted
     */
    setMuted(muted) {
      writeRaw(MUTED_KEY, muted ? 'true' : 'false');
    },

    /**
     * @returns {{ currentLevel: number, bestLevel: number, bestStreak: number }}
     */
    getEndlessStats() {
      const parsed = parseJsonObject(readRaw(ENDLESS_KEY));
      return sanitizeEndlessStats(parsed);
    },

    /**
     * @param {object} stats
     */
    saveEndlessStats(stats) {
      if (!stats || typeof stats !== 'object') return;
      const sanitized = sanitizeEndlessStats(stats);
      writeRaw(ENDLESS_KEY, JSON.stringify(sanitized));
    },

    /**
     * @param {string} dateKey
     * @returns {{ bestLevel: number, bestStreak: number, lastLevel: number, lastStreak: number, lastPerfects: number, runsCount: number }}
     */
    getDailyStats(dateKey) {
      const parsed = parseJsonObject(readRaw(getDailyStorageKey(dateKey)));
      return sanitizeDailyStats(parsed);
    },

    /**
     * @param {string} dateKey
     * @param {object} stats
     */
    saveDailyStats(dateKey, stats) {
      if (!stats || typeof stats !== 'object') return;
      const sanitized = sanitizeDailyStats(stats);
      writeRaw(getDailyStorageKey(dateKey), JSON.stringify(sanitized));
    }
  };
}
