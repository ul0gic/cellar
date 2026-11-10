import View from '@lightstart/light';
import { CalculatorScreen } from './parts/calc-view.ts';

export const tag = 'cl-screen-calculators-calculator';

class CalculatorsDetail extends CalculatorScreen {}

View.register(tag, CalculatorsDetail);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: CalculatorsDetail;
  }
}
