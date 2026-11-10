import View from '@lightstart/light';
import { html, nothing } from '@lightstart/light/html';
import { apiResource } from '../../app/resources.ts';
import { today } from '../../app/today.ts';
import { formatDate } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import { printedOn, toolbar } from './parts/frame.ts';

export const tag = 'cl-screen-print-shopping';

class PrintShopping extends View {
  readonly list = apiResource('getShoppingList', ['shopping']);

  connected(): void {
    this.list.bind(this, {});
  }

  render() {
    const list = this.list.value.value;
    const error = this.list.error.value;
    if (list !== undefined) {
      const date = formatDate(today());
      return html`${toolbar('/list')}<article class="cl-printed">
        <h1 class="cl-print-title">${text('print.shoppingList')}</h1>
        <p class="cl-print-sub">
          ${list.items.length === 1 ? text('print.itemsOne', { date }) : text('print.items', { count: list.items.length, date })}
        </p>
        <ul class="cl-print-items">
          ${list.items.map(
            (item) => html`<li>
              <span class="cl-print-box" aria-hidden="true"></span>
              <span><b>${item.ingredient.name}</b>${item.count > 1 ? ` ${text('print.times', { count: item.count })}` : ''}</span>
              ${item.addedBy === null ? '' : html`<span></span><span class="cl-print-muted">${text('print.addedBy', { name: item.addedBy.name })}</span>`}
            </li>`,
          )}
        </ul>
        ${printedOn()}
      </article>`;
    }
    if (error !== null) {
      return html`${toolbar('/list')}<p class="cl-printed">${error.detail}</p>`;
    }
    return nothing;
  }
}

View.register(tag, PrintShopping);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: PrintShopping;
  }
}
