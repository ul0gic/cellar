import View, { type ComponentElement, defineComponent } from '@lightstart/light';
import { html } from '@lightstart/light/html';
import { text } from '../text/index.ts';
import { type HaveSegment, type HaveSummary, haveSummary, haveText } from './cl-have-bar.ts';
import { typedDefault } from './typed-default.ts';
import './cl-bulb.ts';

const NO_SEGMENTS = typedDefault<readonly HaveSegment[]>([]);

function shortText({ missing, swaps }: HaveSummary): string {
  if (missing > 0) {
    return text('pill.missing', { missing });
  }
  if (swaps === 1) {
    return text('pill.swap');
  }
  if (swaps > 1) {
    return text('pill.swaps', { count: swaps });
  }
  return text('pill.ready');
}

export const clStatusPill = defineComponent({
  tag: 'cl-status-pill',
  style: true,
  props: {
    segments: NO_SEGMENTS,
  },
  render() {
    const summary = haveSummary(this.segments);
    return html`
      <span part="cl-status-pill-bulbs" aria-hidden="true">
        ${this.segments.map((segment) => html`<cl-bulb size="mini" on-photo status=${segment}></cl-bulb>`)}
      </span>
      <span part="cl-status-pill-short">${shortText(summary)}</span>
      <span part="cl-status-pill-long">${haveText(summary)}</span>
    `;
  },
});

View.define(clStatusPill);

declare global {
  interface HTMLElementTagNameMap {
    'cl-status-pill': ComponentElement<typeof clStatusPill>;
  }
}
