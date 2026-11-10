import { Controller } from '@lightstart/light/controller/class';
import { signal } from '@lightstart/light/signals';

export class DemoCounter extends Controller {
  readonly count = signal(0);

  constructor() {
    super('demo-counter');
  }

  bump(): void {
    this.count.value += 1;
  }
}

export const demoCounter = new DemoCounter();
await demoCounter.start();
