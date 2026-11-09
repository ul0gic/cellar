import { html, render, type TemplateResult } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import { today } from '../../app/today.ts';
import type { ScreenContext } from '../../app/types.ts';
import { formatDate } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import { printedOn, toolbar } from './parts/frame.ts';

export function screen(_ctx: ScreenContext): HTMLElement {
  const element = document.createElement('div');
  const show = (body: TemplateResult): void => {
    render(html`${toolbar('/list')}${body}`, element);
  };
  call('getShoppingList', {}).then(
    (list) => {
      const date = formatDate(today());
      show(html`<article class="cl-printed">
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
      </article>`);
    },
    (error: unknown) => {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      show(html`<p class="cl-printed">${error.detail}</p>`);
    },
  );
  return element;
}
