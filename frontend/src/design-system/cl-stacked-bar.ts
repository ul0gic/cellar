import View, { type ComponentElement, defineComponent } from '@lightstart/light';
import { html } from '@lightstart/light/html';
import T from '@lightstart/light/types';
import { formatNumber } from '../text/format.ts';
import { text } from '../text/index.ts';
import { typedDefault } from './typed-default.ts';

export interface StackedItem {
  readonly name: string;
  readonly count: number;
}

const SERIES = 6;
let instances = 0;

export function stackedGroups(items: readonly StackedItem[]): StackedItem[] {
  const sorted = [...items].filter((item) => item.count > 0).sort((a, b) => b.count - a.count);
  if (sorted.length <= SERIES) {
    return sorted;
  }
  const kept = sorted.slice(0, SERIES - 1);
  const rest = sorted.slice(SERIES - 1).reduce((sum, item) => sum + item.count, 0);
  return [...kept, { name: text('chart.other'), count: rest }];
}

const NO_ITEMS = typedDefault<readonly StackedItem[]>([]);

export const clStackedBar = defineComponent({
  tag: 'cl-stacked-bar',
  style: true,
  props: {
    label: '',
    items: NO_ITEMS,
    asTable: false,
    _id: T.string({ reactive: false, defaultValue: '' }),
  },
  connected() {
    if (this._id === '') {
      instances += 1;
      this._id = `cl-stacked-bar-${instances}`;
    }
  },
  render() {
    const groups = stackedGroups(this.items);
    const total = groups.reduce((sum, item) => sum + item.count, 0);
    const describedBy = `${this._id}-detail`;
    return html`
      <figure part="cl-stacked-bar-figure">
        ${
          this.asTable
            ? html`<table part="cl-stacked-bar-table" id=${describedBy}>
                <caption class="cl-vh">${this.label}</caption>
                <thead><tr><th scope="col">${text('chart.name')}</th><th scope="col">${text('chart.count')}</th></tr></thead>
                <tbody>${groups.map((item) => html`<tr><th scope="row">${item.name}</th><td>${formatNumber(item.count)}</td></tr>`)}</tbody>
              </table>`
            : html`
                <div part="cl-stacked-bar-bar" role="img" aria-label=${this.label} aria-describedby=${describedBy}>
                  ${groups.map(
                    (item, index) =>
                      html`<i class=${`series-${index + 1}`} style=${`flex-grow: ${total === 0 ? 0 : item.count / total}`}></i>`,
                  )}
                </div>
                <ul part="cl-stacked-bar-legend" id=${describedBy}>
                  ${groups.map(
                    (item, index) => html`<li>
                      <i class=${`series-${index + 1}`} aria-hidden="true"></i>
                      <span>${item.name}</span>
                      <span part="cl-stacked-bar-count">${formatNumber(item.count)}</span>
                    </li>`,
                  )}
                </ul>
              `
        }
        <button type="button" part="cl-stacked-bar-toggle" @click=${() => {
          this.asTable = !this.asTable;
        }}>${this.asTable ? text('chart.showChart') : text('chart.showTable')}</button>
      </figure>
    `;
  },
});

View.define(clStackedBar);

declare global {
  interface HTMLElementTagNameMap {
    'cl-stacked-bar': ComponentElement<typeof clStackedBar>;
  }
}
