import View, { type ComponentElement, defineComponent } from '@lightstart/light';
import { html } from '@lightstart/light/html';
import T from '@lightstart/light/types';
import { demoCounter } from './pattern-counter.ts';

export const demoReadout = defineComponent({
  tag: 'cl-demo-readout',
  props: {
    count: T.number({ sync: demoCounter.count, defaultValue: 0 }),
  },
  render() {
    return html`<span class="cl-demo-readout">Counter in the controller: ${this.count}</span>`;
  },
});

View.define(demoReadout);

declare global {
  interface HTMLElementTagNameMap {
    'cl-demo-readout': ComponentElement<typeof demoReadout>;
  }
}
