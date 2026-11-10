import { Controller } from '@lightstart/light/controller/class';
import { signal } from '@lightstart/light/signals';
import { AUTH_CODES, ApiError, call } from '../api.ts';
import { resetReads } from '../resources.ts';
import type { SessionPerson } from '../types.ts';

export class SessionController extends Controller {
  readonly current = signal<SessionPerson | null>(null);

  constructor() {
    super('session');
  }

  async refresh(): Promise<void> {
    try {
      this.replace(await call('getSession', {}));
    } catch (error) {
      if (error instanceof ApiError && AUTH_CODES.some((code) => code === error.code)) {
        this.replace(null);
        return;
      }
      throw error;
    }
  }

  private replace(next: SessionPerson | null): void {
    if (this.current.peek()?.person.id !== next?.person.id) {
      resetReads(next !== null);
    }
    this.current.value = next;
  }
}

export const session = new SessionController();
await session.start();
