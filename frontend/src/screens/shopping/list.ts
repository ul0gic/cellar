import { LIMITS, type ShoppingList, type ShoppingListItem } from '@cellar/contract';
import type { SearchDoc } from '@lightstart/components/types.js';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { effect } from '@lightstart/light/signals';
import { call } from '../../app/api.ts';
import { viewport } from '../../app/controllers/viewport.ts';
import { eventChecked, eventNumber } from '../../app/events.ts';
import { loadState } from '../../app/load.ts';
import { apiResource, dataChanged } from '../../app/resources.ts';
import { href } from '../../app/router.ts';
import { setAppBar } from '../../app/shell.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/checkbox.ts';
import '../../design-system/lc/clipboard.ts';
import '../../design-system/lc/empty-state.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/number-input.ts';
import '../../design-system/lc/search.ts';
import { illustration } from '../../design-system/illustration.ts';
import { waiting } from '../../design-system/load-view.ts';
import { toast } from '../../design-system/toast.ts';
import { formatDate, formatNumber } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import { attempt } from '../shelf/parts/kit.ts';
import './shopping.css';

export const tag = 'cl-screen-shopping-list';

function linesOf(list: ShoppingList): string {
  return list.items.map((item) => text('shopping.line', { name: item.ingredient.name, count: item.count })).join('\n');
}

function isDoc(value: unknown): value is SearchDoc {
  return typeof value === 'object' && value !== null && 'id' in value && 'title' in value;
}

function copied(): void {
  toast({ title: text('shopping.copied') });
}

function copyAction(): HTMLElementTagNameMap['lc-clipboard'] {
  const clipboard = document.createElement('lc-clipboard');
  clipboard.iconOnly = true;
  clipboard.label = text('shopping.copy');
  clipboard.addEventListener('copy', copied);
  return clipboard;
}

function printAction(): HTMLAnchorElement {
  const print = document.createElement('a');
  print.className = 'cl-icon-button';
  print.href = href('/list/print');
  print.setAttribute('aria-label', text('shopping.print'));
  const icon = document.createElement('lc-icon');
  icon.setAttribute('name', 'printer');
  icon.setAttribute('aria-hidden', 'true');
  print.append(icon);
  return print;
}

function changed(): void {
  dataChanged('shopping', 'stats');
}

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

class ShoppingScreen extends View {
  readonly list = apiResource('getShoppingList', ['shopping']);
  readonly tree = apiResource('getIngredientTree', ['ingredients']);
  readonly state = loadState([this.list, this.tree]);
  readonly clipboard = copyAction();
  readonly print = printAction();

  connected(): void {
    this.classList.add('cl-kit-screen', 'cl-reading', 'cl-shopping');
    setAppBar({ actions: [this.clipboard, this.print] });
    this.list.bind(this, {});
    this.tree.bind(this, {});
    const lines = effect(() => {
      const current = this.list.value.value;
      this.clipboard.text = current === undefined ? '' : linesOf(current);
    });
    this.$own(() => lines.dispose());
  }

  add(ingredientId: number, name: string): Promise<void> {
    return attempt(async () => {
      const listed = this.list.value.peek()?.items.find((item) => item.ingredient.id === ingredientId);
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
  }

  docs(): SearchDoc[] {
    const nodes = this.tree.value.value?.nodes ?? [];
    const names = new Map(nodes.map((node) => [node.id, node.name]));
    return nodes.map((node) => ({
      id: node.id,
      group: text('shopping.addGroup'),
      title: node.name,
      hint: node.parentId === null ? '' : (names.get(node.parentId) ?? ''),
    }));
  }

  render() {
    const current = this.list.value.value;
    const lines = current === undefined ? '' : linesOf(current);
    return html`
      <div class="cl-kit-head">
        <h1 class="cl-kit-title cl-kit-wide-only">${text('shopping.title')}</h1>
        ${
          viewport.wide.value && current !== undefined && current.items.length > 0
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
        .docs=${this.docs()}
        @search-select=${(event: Event) => {
          const doc: unknown = event instanceof CustomEvent ? event.detail : null;
          if (isDoc(doc) && typeof doc.id === 'number') {
            void this.add(doc.id, doc.title);
          }
          if (event.currentTarget instanceof HTMLElement && 'query' in event.currentTarget) {
            event.currentTarget.query = '';
          }
        }}
      ></lc-search>
      ${current === undefined ? waiting(this.state, text('nav.shoppingList'), 'rows') : content(current)}
    `;
  }
}

View.register(tag, ShoppingScreen);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: ShoppingScreen;
  }
}
