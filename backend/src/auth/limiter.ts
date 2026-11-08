const WINDOW_MS = 900_000;
const NAME_LIMIT = 10;
const ADDRESS_LIMIT = 30;
const MAX_KEYS = 10_000;

export interface SignInLimiter {
  retryAfterSeconds(foldedName: string, address: string, now: number): number | null;
  recordFailure(foldedName: string, address: string, now: number): void;
  size(): number;
}

export function createSignInLimiter(): SignInLimiter {
  const failures = new Map<string, number[]>();

  const live = (key: string, now: number): number[] => {
    const times = failures.get(key);
    if (times === undefined) {
      return [];
    }
    const kept = times.filter((time) => now - time < WINDOW_MS);
    if (kept.length === 0) {
      failures.delete(key);
    } else if (kept.length !== times.length) {
      failures.set(key, kept);
    }
    return kept;
  };

  const blockedFor = (key: string, limit: number, now: number): number | null => {
    const times = live(key, now);
    if (times.length < limit) {
      return null;
    }
    return Math.max(1, Math.ceil((times[0] + WINDOW_MS - now) / 1000));
  };

  const add = (key: string, limit: number, now: number): void => {
    const times = live(key, now);
    failures.delete(key);
    failures.set(key, [...times, now].slice(-limit));
    while (failures.size > MAX_KEYS) {
      const oldest = failures.keys().next();
      if (oldest.done === true) {
        break;
      }
      failures.delete(oldest.value);
    }
  };

  return {
    retryAfterSeconds(foldedName, address, now) {
      const byName = blockedFor(`n:${foldedName}`, NAME_LIMIT, now);
      const byAddress = blockedFor(`a:${address}`, ADDRESS_LIMIT, now);
      if (byName === null && byAddress === null) {
        return null;
      }
      return Math.max(byName ?? 0, byAddress ?? 0);
    },
    recordFailure(foldedName, address, now) {
      add(`n:${foldedName}`, NAME_LIMIT, now);
      add(`a:${address}`, ADDRESS_LIMIT, now);
    },
    size() {
      return failures.size;
    },
  };
}
