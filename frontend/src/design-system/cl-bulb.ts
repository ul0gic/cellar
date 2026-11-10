import View, { type ComponentElement, defineComponent } from '@lightstart/light';
import { html, nothing } from '@lightstart/light/html';
import { typedDefault } from './typed-default.ts';

export type BulbStatus = 'on' | 'via' | 'off' | 'optional';
export type BulbSize = 'line' | 'mini' | 'live' | 'dot';

const OFF = typedDefault<BulbStatus>('off');
const LINE = typedDefault<BulbSize>('line');

export const clBulb = defineComponent({
  tag: 'cl-bulb',
  style: true,
  props: {
    status: OFF,
    size: LINE,
    label: '',
    onPhoto: false,
  },
  render() {
    return html`<span
      part="cl-bulb-lamp"
      role=${this.label ? 'img' : nothing}
      aria-label=${this.label || nothing}
      aria-hidden=${this.label ? nothing : 'true'}
    ></span>`;
  },
});

View.define(clBulb);

declare global {
  interface HTMLElementTagNameMap {
    'cl-bulb': ComponentElement<typeof clBulb>;
  }
}
