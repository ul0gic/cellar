import { LIMITS, type ShoppingList, type ShoppingListItem } from '@cellar/contract';
import type { SearchDoc } from '@lightstart/components/types.js';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { call } from '../../app/api.ts';
import { eventChecked, eventNumber } from '../../app/events.ts';
import { type WatchState, watch } from '../../app/load.ts';
import { invalidate, resourceFor } from '../../app/resources.ts';
import { href } from '../../app/router.ts';
import { setAppBar } from '../../app/shell.ts';
import { illustration } from '../../design-system/illustration.ts';
import { toast } from '../../design-system/toast.ts';
import { formatDate, formatNumber } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import { attempt, onWidth, waiting, wide } from '../shelf/parts/kit.ts';
import './shopping.css';

function linesOf(list: ShoppingList): string {
  return list.items.map((item) => text('shopping.line', { name: item.ingredient.name, count: item.count })).join('\n');
}

function isDoc(value: unknown): value is SearchDoc {
  return typeof value === 'object' && value !== null && 'id' in value && 'title' in value;
}

export function screen(): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-kit-screen cl-reading cl-shopping';
  const list = resourceFor('getShoppingList', {}, { tags: ['shopping'] });
  const tree = resourceFor('getIngredientTree', {}, { tags: ['ingredients'] });
  const clipboard = document.createElement('lc-clipboard');
  clipboard.iconOnly = true;
  clipboard.label = text('shopping.copy');
  const print = document.createElement('a');
  print.className = 'cl-icon-button';
  print.setAttribute('aria-label', text('shopping.print'));
  render(html`<lc-icon name="printer" aria-hidden="true"></lc-icon>`, print);

  const changed = (): void => {
    invalidate('shopping', 'stats');
  };

  const copied = (): void => {
    toast({ title: text('shopping.copied') });
  };
  clipboard.addEventListener('copy', copied);

  const checkOff = (item: ShoppingListItem): Promise<void> =>
    attempt(async () => {
      await call('checkOffShoppingItem', { params: { id: item.id } });
      changed();
      toast({
        title: text('shopping.checked', { name: item.ingredient.name }),
        action: {
          label: text('toast.undo'),
          run: () =>
            void attempt(async () => {
              await call('addToShoppingList', {
                body: { items: [{ ingredientId: item.ingredient.id, count: item.count }] },
              });
              toast({ title: text('toast.undone') });
              changed();
            }),
        },
      });
    }).finally(changed);

  const setCount = (item: ShoppingListItem, count: number): Promise<void> =>
    attempt(async () => {
      await call('updateShoppingItem', { params: { id: item.id }, body: { count } });
      changed();
    });

  const add = (ingredientId: number, name: string): Promise<void> =>
    attempt(async () => {
      const listed = list.peek()?.items.find((item) => item.ingredient.id === ingredientId);
      if (listed !== undefined) {
        const count = Math.min(listed.count + 1, LIMITS.shoppingCount.max);
        await call('updateShoppingItem', { params: { id: listed.id }, body: { count } });
        toast({ title: text('shopping.already', { name, count: formatNumber(count) }) });
      } else {
        await call('addToShoppingList', { body: { items: [{ ingredientId }] } });
        toast({ title: text('shopping.added', { name }) });
      }
      changed();
    });

  const docs = (): SearchDoc[] => {
    const nodes = tree.peek()?.nodes ?? [];
    const names = new Map(nodes.map((node) => [node.id, node.name]));
    return nodes.map((node) => ({
      id: node.id,
      group: text('shopping.addGroup'),
      title: node.name,
      hint: node.parentId === null ? '' : (names.get(node.parentId) ?? ''),
    }));
  };

  const row = (item: ShoppingListItem): TemplateResult => html`<li class="cl-kit-row cl-shopping-row">
    <lc-checkbox
      shape="round"
      class="cl-shopping-check"
      .ariaLabel=${text('shopping.got', { name: item.ingredient.name })}
      @change=${(event: Event) => {
        if (eventChecked(event)) {
          void checkOff(item);
        }
      }}
    ></lc-checkbox>
    <span class="cl-kit-row-text">
      <span class="cl-shopping-name">${item.ingredient.name}</span>
      <span class="cl-kit-row-sub">
        ${
          item.addedBy === null
            ? text('shopping.addedAt', { date: formatDate(item.addedAt, 'this-year') })
            : text('shopping.addedBy', { name: item.addedBy.name })
        }
      </span>
    </span>
    <lc-number-input
      stepper
      size="sm"
      class="cl-shopping-count"
      .ariaLabel=${text('shopping.count', { name: item.ingredient.name })}
      min=${LIMITS.shoppingCount.min}
      max=${LIMITS.shoppingCount.max}
      .value=${item.count}
      @change=${(event: Event) => {
        const count = eventNumber(event);
        if (count !== null && count !== item.count) {
          void setCount(item, count);
        }
      }}
    ></lc-number-input>
  </li>`;

  const content = (current: ShoppingList): TemplateResult =>
    current.items.length === 0
      ? html`<lc-empty-state title=${text('shopping.emptyTitle')} description=${text('shopping.emptyBody')}>
          ${illustration('empty-list')}
          <lc-button variant="primary" href=${href('/')}>${text('shopping.seeBuyNext')}</lc-button>
        </lc-empty-state>`
      : html`<p class="cl-kit-meta">
            ${text('shopping.countLine', {
              items:
                current.items.length === 1
                  ? text('shopping.itemOne')
                  : text('shopping.itemMany', { count: formatNumber(current.items.length) }),
            })}
          </p>
          <ul class="cl-kit-list cl-kit-panel">${current.items.map(row)}</ul>`;

  const draw = (state: WatchState): void => {
    const current = list.peek();
    const lines = current === undefined ? '' : linesOf(current);
    clipboard.text = lines;
    print.href = href('/list/print');
    render(
      html`
        <div class="cl-kit-head">
          <h1 class="cl-kit-title cl-kit-wide-only">${text('shopping.title')}</h1>
          ${
            wide.matches && current !== undefined && current.items.length > 0
              ? html`<div class="cl-kit-head-actions">
                  <lc-clipboard .text=${lines} label=${text('shopping.copy')} @copy=${copied}></lc-clipboard>
                  <lc-button variant="quiet" href=${href('/list/print')}>
                    <lc-icon name="printer" aria-hidden="true"></lc-icon>${text('shopping.print')}
                  </lc-button>
                </div>`
              : nothing
          }
        </div>
        <lc-search
          class="cl-shopping-add"
          label=${text('shopping.add')}
          placeholder=${text('shopping.add')}
          limit="8"
          .docs=${docs()}
          @search-select=${(event: Event) => {
            const doc: unknown = event instanceof CustomEvent ? event.detail : null;
            if (isDoc(doc) && typeof doc.id === 'number') {
              void add(doc.id, doc.title);
            }
            if (event.currentTarget instanceof HTMLElement && 'query' in event.currentTarget) {
              event.currentTarget.query = '';
            }
          }}
        ></lc-search>
        ${current === undefined ? waiting(state, list, text('nav.shoppingList'), 'rows') : content(current)}
      `,
      element,
    );
  };

  const watched = watch(element, [list, tree], draw);
  onWidth(element, watched.redraw);
  setAppBar({ actions: [clipboard, print] });
  return element;
}
