import View from '@lightstart/light';
import { CalculatorScreen } from './parts/calc-view.ts';

export const tag = 'cl-screen-calculators-list';

class CalculatorsList extends CalculatorScreen {}

View.register(tag, CalculatorsList);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: CalculatorsList;
  }
}
