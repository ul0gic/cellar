import View, { type ComponentElement, defineComponent } from '@lightstart/light';
import { html } from '@lightstart/light/html';
import { formatNumber } from '../text/format.ts';
import { countUp } from './motion.ts';
import { typedDefault } from './typed-default.ts';

export type FigureSize = 'page' | 'hero' | 'hero-wide' | 'stat';

const PAGE = typedDefault<FigureSize>('page');

export const clFigure = defineComponent({
  tag: 'cl-figure',
  style: true,
  props: {
    value: 0,
    label: '',
    sublabel: '',
    size: PAGE,
    countUp: false,
  },
  updated({ changedProps }: { changedProps: Map<string, unknown> }) {
    const number = this.querySelector<HTMLElement>('[part~="cl-figure-number"]');
    if (number === null || !(changedProps.has('value') || changedProps.has('countUp'))) {
      return;
    }
    if (this.countUp) {
      countUp(number, this.value, formatNumber);
    } else {
      number.textContent = formatNumber(this.value);
    }
  },
  render() {
    const value = formatNumber(this.value);
    return html`
      <p part="cl-figure-figure">
        <span part="cl-figure-number" aria-hidden="true"></span>
        <span class="cl-vh">${value} ${this.label}</span>
      </p>
      <div part="cl-figure-labels" aria-hidden="true">
        ${this.label ? html`<p part="cl-figure-label">${this.label}</p>` : ''}
        ${this.sublabel ? html`<p part="cl-figure-sublabel">${this.sublabel}</p>` : ''}
      </div>
      ${this.sublabel ? html`<p class="cl-vh">${this.sublabel}</p>` : ''}
      <div part="cl-figure-actions"><slot></slot></div>
    `;
  },
});

View.define(clFigure);

declare global {
  interface HTMLElementTagNameMap {
    'cl-figure': ComponentElement<typeof clFigure>;
  }
}
