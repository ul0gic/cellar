import { session } from './controllers/session.ts';
import type { PersonSignal } from './types.ts';

export const person: PersonSignal = {
  current: () => session.current.peek(),
  subscribe(fn) {
    let initial = true;
    return session.current.subscribe((next) => {
      if (initial) {
        initial = false;
        return;
      }
      fn(next);
    });
  },
  refresh: () => session.refresh(),
};
