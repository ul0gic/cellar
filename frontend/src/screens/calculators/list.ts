import type { ScreenContext } from '../../app/types.ts';
import { calculatorScreen } from './parts/calc-view.ts';

export function screen(ctx: ScreenContext): HTMLElement {
  return calculatorScreen(ctx, null);
}
