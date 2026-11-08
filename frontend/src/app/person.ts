import { AUTH_CODES, ApiError, call } from './api.ts';
import type { PersonSignal, SessionPerson } from './types.ts';

let session: SessionPerson | null = null;
const listeners = new Set<(person: SessionPerson | null) => void>();

function set(next: SessionPerson | null): void {
  session = next;
  for (const listener of listeners) {
    listener(next);
  }
}

export const person: PersonSignal = {
  current: () => session,
  subscribe(fn) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  async refresh() {
    try {
      set(await call('getSession', {}));
    } catch (error) {
      if (error instanceof ApiError && AUTH_CODES.some((code) => code === error.code)) {
        set(null);
        return;
      }
      throw error;
    }
  },
};
