import { Controller } from '@lightstart/light/controller/class';
import { signal } from '@lightstart/light/signals';
import type { RouteDef, RouteParams } from '../types.ts';

export class RouteController extends Controller {
  readonly def = signal<RouteDef | null>(null);
  readonly params = signal<RouteParams>({});
  readonly query = signal(new URLSearchParams());

  constructor() {
    super('route');
  }
}

export const route = new RouteController();
await route.start();
