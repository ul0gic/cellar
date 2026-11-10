import { Controller } from '@lightstart/light/controller/class';
import { signal } from '@lightstart/light/signals';

export class LoginHandoffController extends Controller {
  private readonly oneTimePassword = signal<string | null>(null);

  constructor() {
    super('login-handoff');
  }

  hold(password: string): void {
    this.oneTimePassword.value = password;
  }

  take(): string | null {
    const held = this.oneTimePassword.peek();
    this.oneTimePassword.value = null;
    return held;
  }
}

export const loginHandoff = new LoginHandoffController();
await loginHandoff.start();
