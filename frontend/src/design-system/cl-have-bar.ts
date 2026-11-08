import { defineComponent } from '@lightstart/light';
import { html } from '@lightstart/light/html';
import { text } from '../text/index.ts';
import './cl-have-bar.css';
import { typedDefault } from './typed-default.ts';

export type HaveSegment = 'on' | 'via' | 'off';

export interface HaveSummary {
  readonly total: number;
  readonly missing: number;
  readonly swaps: number;
}

export const MAX_HAVE_SEGMENTS = 10;

export function haveSummary(segments: readonly HaveSegment[]): HaveSummary {
  return {
    total: segments.length,
    missing: segments.filter((segment) => segment === 'off').length,
    swaps: segments.filter((segment) => segment === 'via').length,
  };
}

export function haveText({ total, missing, swaps }: HaveSummary): string {
  if (missing > 0) {
    return text('have.missing', { missing, count: total });
  }
  if (swaps === 1) {
    return text('have.readySwap');
  }
  if (swaps > 1) {
    return text('have.readySwaps', { count: swaps });
  }
  return text('have.allOnHand', { count: total });
}

const NO_SEGMENTS = typedDefault<readonly HaveSegment[]>([]);

export const clHaveBar = defineComponent({
  tag: 'cl-have-bar',
  style: true,
  props: {
    segments: NO_SEGMENTS,
    stacked: false,
  },
  render() {
    const summary = haveSummary(this.segments);
    return html`
      <span part="cl-have-bar-bar" aria-hidden="true">
        ${this.segments.slice(0, MAX_HAVE_SEGMENTS).map((segment) => html`<i class=${`is-${segment}`}></i>`)}
      </span>
      <span part="cl-have-bar-text" class=${summary.missing > 0 ? 'is-missing' : ''}>${haveText(summary)}</span>
    `;
  },
});
