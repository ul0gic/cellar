import type { FieldError, Wishlist, WishlistItem } from '@cellar/contract';
import type { LightElements } from '@lightstart/light/components/elements.js';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import { eventText } from '../../app/events.ts';
import { type LoadState, watch } from '../../app/load.ts';
import { actionFailed } from '../../app/problems.ts';
import { invalidate, resourceFor } from '../../app/resources.ts';
import type { ScreenContext } from '../../app/types.ts';
import { toast } from '../../design-system/toast.ts';
import { formatNumber } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import { attempt, fieldError, sheet, waiting } from '../shelf/parts/kit.ts';
import './wishlists.css';

type Dropdown = LightElements['lc-dropdown'];

const INDENT = ' ';

interface Draft {
  editing: WishlistItem | null;
  name: string;
  ingredientId: string;
  note: string;
  url: string;
}

function itemLine(item: WishlistItem): string {
  if (item.ingredient === null) {
    return item.note === '' ? text('wishlists.noNote') : item.note;
  }
  return item.note === ''
    ? text('wishlists.ingredientOnly', { ingredient: item.ingredient.name })
    : text('wishlists.ingredientNote', { ingredient: item.ingredient.name, note: item.note });
}

export function screen(ctx: ScreenContext): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-kit-screen cl-reading cl-wishlists';
  const lists = resourceFor('listWishlists', {}, { tags: ['wishlists'] });
  const tree = resourceFor('getIngredientTree', {}, { tags: ['ingredients'] });
  let draft: Draft | null = null;
  let errors: FieldError[] = [];
  let saving = false;
  let gotItem: WishlistItem | null = null;
  let state: LoadState | null = null;
  const redraw = (): void => {
    if (state !== null) {
      draw(state);
    }
  };

  const changed = (): void => {
    invalidate('wishlists', 'stats');
  };

  const openSheet = (item: WishlistItem | null): void => {
    draft = {
      editing: item,
      name: item?.name ?? '',
      ingredientId: item?.ingredient === null || item === null ? '' : String(item.ingredient.id),
      note: item?.note ?? '',
      url: item?.url ?? '',
    };
    errors = [];
    redraw();
  };

  async function save(current: Draft): Promise<void> {
    errors = [];
    saving = true;
    redraw();
    const body = {
      name: current.name.trim(),
      ingredientId: current.ingredientId === '' ? null : Number(current.ingredientId),
      note: current.note,
      url: current.url.trim() === '' ? null : current.url.trim(),
    };
    try {
      if (current.editing === null) {
        await call('addWishlistItem', { body });
        toast({ title: text('wishlists.added', { name: body.name }) });
      } else {
        await call('updateWishlistItem', { params: { id: current.editing.id }, body });
        toast({ title: text('wishlists.saved') });
      }
      draft = null;
      changed();
    } catch (error) {
      if (error instanceof ApiError && error.fields.length > 0) {
        errors = [...error.fields];
      } else {
        actionFailed(error, () => void save(current));
      }
    } finally {
      saving = false;
      redraw();
    }
  }

  const move = (list: Wishlist, item: WishlistItem, by: -1 | 1): Promise<void> =>
    attempt(async () => {
      const ids = list.items.map((entry) => entry.id);
      const from = ids.indexOf(item.id);
      const to = from + by;
      const other = ids[to];
      if (from < 0 || other === undefined) {
        return;
      }
      ids[to] = item.id;
      ids[from] = other;
      await call('reorderWishlist', { body: { ids } });
      toast({ title: text('wishlists.moved', { name: item.name }) });
      changed();
    });

  const remove = (item: WishlistItem): Promise<void> =>
    attempt(async () => {
      await call('removeWishlistItem', { params: { id: item.id } });
      toast({ title: text('wishlists.removed', { name: item.name }) });
      changed();
    });

  const gotIt = (item: WishlistItem, addBottle: boolean): Promise<void> =>
    attempt(async () => {
      gotItem = null;
      redraw();
      const result = await call('gotWishlistItem', { params: { id: item.id } });
      changed();
      if (addBottle) {
        ctx.navigate('/shelf?add=1', { state: { bottleDraft: result.bottleDraft } });
      } else {
        toast({ title: text('wishlists.gotDone', { name: item.name }) });
      }
    });

  const openMenu = (event: MouseEvent, list: Wishlist, item: WishlistItem): void => {
    const menu = element.querySelector<Dropdown>('.cl-wishlists-menu');
    if (!(event.currentTarget instanceof Element) || menu === null) {
      return;
    }
    const index = list.items.indexOf(item);
    menu.items = [
      { label: text('wishlists.edit'), icon: 'pencil', onClick: () => openSheet(item) },
      {
        label: text('wishlists.moveUp'),
        icon: 'arrow-up',
        disabled: index === 0,
        onClick: () => void move(list, item, -1),
      },
      {
        label: text('wishlists.moveDown'),
        icon: 'arrow-down',
        disabled: index === list.items.length - 1,
        onClick: () => void move(list, item, 1),
      },
      { label: text('wishlists.remove'), icon: 'trash-2', danger: true, onClick: () => void remove(item) },
    ];
    menu.toggle(event.currentTarget);
  };

  const row = (list: Wishlist, item: WishlistItem): TemplateResult => html`<li class="cl-kit-row">
    <span class="cl-kit-row-text">
      <span class="cl-kit-row-name">
        ${item.name}
        ${
          item.url === null
            ? nothing
            : html`<a
                class="cl-wishlists-link"
                href=${item.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label=${text('wishlists.link', { name: item.name })}
                ><lc-icon name="external-link" aria-hidden="true"></lc-icon
              ></a>`
        }
      </span>
      <span class="cl-kit-row-sub">${itemLine(item)}</span>
    </span>
    ${
      list.mine
        ? html`<lc-button
              variant="ghost"
              aria-label=${text('wishlists.gotItLabel', { name: item.name })}
              @click=${() => {
                gotItem = item;
                redraw();
              }}
            >
              <lc-icon name="check" aria-hidden="true"></lc-icon>${text('wishlists.gotIt')}
            </lc-button>
            <button
              type="button"
              class="cl-icon-button"
              aria-haspopup="menu"
              aria-label=${text('wishlists.more', { name: item.name })}
              @click=${(event: MouseEvent) => openMenu(event, list, item)}
            >
              <lc-icon name="ellipsis" aria-hidden="true"></lc-icon>
            </button>`
        : nothing
    }
  </li>`;

  const listView = (list: Wishlist): TemplateResult => {
    const headingId = `cl-wishlist-${list.person.id}`;
    return html`<section class="cl-kit-section" aria-labelledby=${headingId}>
      <div class="cl-kit-section-head">
        <div class="cl-wishlists-who">
          <lc-avatar size="sm" name=${list.person.name} src=${list.person.avatar?.url ?? nothing}></lc-avatar>
          <h2 class="cl-kit-section-title" id=${headingId}>${list.mine ? text('wishlists.yours') : list.person.name}</h2>
        </div>
        ${
          list.mine
            ? html`<lc-button variant="ghost" aria-label=${text('wishlists.addLabel')} @click=${() => openSheet(null)}>
                <lc-icon name="plus" aria-hidden="true"></lc-icon>${text('wishlists.add')}
              </lc-button>`
            : html`<p class="cl-kit-meta">
                ${
                  list.items.length === 1
                    ? text('wishlists.itemOne')
                    : text('wishlists.itemCount', { count: formatNumber(list.items.length) })
                }
              </p>`
        }
      </div>
      ${
        list.items.length === 0
          ? html`<p class="cl-kit-panel cl-wishlists-empty">
              ${list.mine ? text('wishlists.emptyOwn') : text('wishlists.emptyOther', { name: list.person.name })}
            </p>`
          : html`<ul class="cl-kit-list cl-kit-panel">${list.items.map((item) => row(list, item))}</ul>`
      }
    </section>`;
  };

  const itemSheet = (): TemplateResult => {
    const current = draft;
    const close = (): void => {
      draft = null;
      redraw();
    };
    if (current === null) {
      return sheet({ open: false, title: '', onClose: close, body: html``, footer: html`` });
    }
    return sheet({
      open: true,
      title:
        current.editing === null
          ? text('wishlists.sheetAdd')
          : text('wishlists.sheetEdit', { name: current.editing.name }),
      onClose: close,
      body: html`
        <lc-input
          required
          label=${text('wishlists.what')}
          .value=${current.name}
          error-message=${fieldError(errors, 'name')}
          @input=${(event: Event) => {
            current.name = eventText(event);
          }}
        ></lc-input>
        <lc-select
          searchable
          label=${text('wishlists.ingredient')}
          .options=${[
            { value: '', label: text('wishlists.noIngredient') },
            ...(tree.peek()?.nodes ?? []).map((node) => ({
              value: String(node.id),
              label: `${INDENT.repeat(node.depth)}${node.name}`,
            })),
          ]}
          .value=${current.ingredientId}
          error-message=${fieldError(errors, 'ingredientId')}
          @change=${(event: Event) => {
            current.ingredientId = eventText(event);
          }}
        ></lc-select>
        <lc-textarea
          label=${text('wishlists.note')}
          .value=${current.note}
          error-message=${fieldError(errors, 'note')}
          @input=${(event: Event) => {
            current.note = eventText(event);
          }}
        ></lc-textarea>
        <lc-input
          type="url"
          label=${text('wishlists.url')}
          placeholder="https://"
          .value=${current.url}
          error-message=${fieldError(errors, 'url')}
          @input=${(event: Event) => {
            current.url = eventText(event);
          }}
        ></lc-input>
      `,
      footer: html`
        <lc-button variant="quiet" @click=${close}>${text('action.cancel')}</lc-button>
        <lc-button variant="primary" ?disabled=${saving} @click=${() => void save(current)}
          >${current.editing === null ? text('wishlists.addSubmit') : text('wishlists.save')}</lc-button
        >
      `,
    });
  };

  const gotDialog = (): TemplateResult => {
    const item = gotItem;
    return html`<lc-modal
      size="sm"
      class="cl-wishlists-got"
      ?open=${item !== null}
      @modal-close=${() => {
        gotItem = null;
        redraw();
      }}
    >
      <h2 slot="header" class="cl-kit-sheet-title">${item === null ? '' : text('wishlists.gotTitle', { name: item.name })}</h2>
      <p>${text('wishlists.gotBody')}</p>
      <div slot="footer" class="cl-kit-sheet-footer">
        <lc-button variant="quiet" @click=${() => item !== null && void gotIt(item, false)}
          >${text('wishlists.justRemove')}</lc-button
        >
        <lc-button variant="primary" @click=${() => item !== null && void gotIt(item, true)}
          >${text('wishlists.addBottle')}</lc-button
        >
      </div>
    </lc-modal>`;
  };

  const draw = (current: LoadState): void => {
    state = current;
    const data = lists.peek();
    const ordered = data === undefined ? [] : [...data.lists].sort((a, b) => Number(b.mine) - Number(a.mine));
    render(
      html`
        <header>
          <h1 class="cl-kit-title cl-kit-wide-only">${text('wishlists.title')}</h1>
          <p class="cl-kit-lede">${text('wishlists.lede')}</p>
        </header>
        ${data === undefined ? waiting(current, lists, text('nav.wishlists'), 'rows') : ordered.map(listView)}
        <lc-dropdown class="cl-wishlists-menu"></lc-dropdown>
        ${itemSheet()} ${gotDialog()}
      `,
      element,
    );
  };

  watch(element, [lists, tree], draw);
  return element;
}
