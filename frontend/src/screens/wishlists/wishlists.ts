import type { FieldError, Wishlist, WishlistItem } from '@cellar/contract';
import type { LightElements } from '@lightstart/components/elements.js';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { ApiError, call } from '../../app/api.ts';
import { eventText } from '../../app/events.ts';
import { loadState } from '../../app/load.ts';
import { actionFailed } from '../../app/problems.ts';
import { apiResource, dataChanged } from '../../app/resources.ts';
import { navigate } from '../../app/router.ts';
import '../../design-system/lc/avatar.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/dropdown.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/input.ts';
import '../../design-system/lc/modal.ts';
import '../../design-system/lc/select.ts';
import '../../design-system/lc/textarea.ts';
import { waiting } from '../../design-system/load-view.ts';
import { toast } from '../../design-system/toast.ts';
import { formatNumber } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import { attempt, fieldError, sheet } from '../shelf/parts/kit.ts';
import './wishlists.css';

export const tag = 'cl-screen-wishlists-wishlists';

type Dropdown = LightElements['lc-dropdown'];

const INDENT = ' ';

interface Draft {
  readonly editing: WishlistItem | null;
  readonly name: string;
  readonly ingredientId: string;
  readonly note: string;
  readonly url: string;
}

function itemLine(item: WishlistItem): string {
  if (item.ingredient === null) {
    return item.note === '' ? text('wishlists.noNote') : item.note;
  }
  return item.note === ''
    ? text('wishlists.ingredientOnly', { ingredient: item.ingredient.name })
    : text('wishlists.ingredientNote', { ingredient: item.ingredient.name, note: item.note });
}

function changed(): void {
  dataChanged('wishlists', 'stats');
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

class WishlistsScreen extends View {
  readonly lists = apiResource('listWishlists', ['wishlists']);
  readonly tree = apiResource('getIngredientTree', ['ingredients']);
  readonly state = loadState([this.lists, this.tree]);
  readonly draft = signal<Draft | null>(null);
  readonly errors = signal<readonly FieldError[]>([]);
  readonly saving = signal(false);
  readonly gotItem = signal<WishlistItem | null>(null);

  connected(): void {
    this.classList.add('cl-kit-screen', 'cl-reading', 'cl-wishlists');
    this.lists.bind(this, {});
    this.tree.bind(this, {});
  }

  openSheet(item: WishlistItem | null): void {
    this.draft.value = {
      editing: item,
      name: item?.name ?? '',
      ingredientId: item === null || item.ingredient === null ? '' : String(item.ingredient.id),
      note: item?.note ?? '',
      url: item?.url ?? '',
    };
    this.errors.value = [];
  }

  closeSheet(): void {
    this.draft.value = null;
  }

  fill(patch: Partial<Draft>): void {
    const current = this.draft.peek();
    if (current !== null) {
      this.draft.value = { ...current, ...patch };
    }
  }

  async save(): Promise<void> {
    const current = this.draft.peek();
    if (current === null) {
      return;
    }
    this.errors.value = [];
    this.saving.value = true;
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
      this.draft.value = null;
      changed();
    } catch (error) {
      if (error instanceof ApiError && error.fields.length > 0) {
        this.errors.value = [...error.fields];
      } else {
        actionFailed(error, () => void this.save());
      }
    } finally {
      this.saving.value = false;
    }
  }

  gotIt(item: WishlistItem, addBottle: boolean): Promise<void> {
    return attempt(async () => {
      this.gotItem.value = null;
      const result = await call('gotWishlistItem', { params: { id: item.id } });
      changed();
      if (!addBottle) {
        toast({ title: text('wishlists.gotDone', { name: item.name }) });
      } else if (this.isConnected) {
        navigate('/shelf?add=1', { state: { bottleDraft: result.bottleDraft } });
      }
    });
  }

  openMenu(event: MouseEvent, list: Wishlist, item: WishlistItem): void {
    const menu = this.querySelector<Dropdown>('.cl-wishlists-menu');
    if (!(event.currentTarget instanceof Element) || menu === null) {
      return;
    }
    const index = list.items.indexOf(item);
    menu.items = [
      { label: text('wishlists.edit'), icon: 'pencil', onClick: () => this.openSheet(item) },
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
  }

  row(list: Wishlist, item: WishlistItem): TemplateResult {
    return html`<li class="cl-kit-row">
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
                  this.gotItem.value = item;
                }}
              >
                <lc-icon name="check" aria-hidden="true"></lc-icon>${text('wishlists.gotIt')}
              </lc-button>
              <button
                type="button"
                class="cl-icon-button"
                aria-haspopup="menu"
                aria-label=${text('wishlists.more', { name: item.name })}
                @click=${(event: MouseEvent) => this.openMenu(event, list, item)}
              >
                <lc-icon name="ellipsis" aria-hidden="true"></lc-icon>
              </button>`
          : nothing
      }
    </li>`;
  }

  listView(list: Wishlist): TemplateResult {
    const headingId = `cl-wishlist-${list.person.id}`;
    return html`<section class="cl-kit-section" aria-labelledby=${headingId}>
      <div class="cl-kit-section-head">
        <div class="cl-wishlists-who">
          <lc-avatar shape="rounded" size="sm" name=${list.person.name} src=${list.person.avatar?.url ?? nothing}></lc-avatar>
          <h2 class="cl-kit-section-title" id=${headingId}>${list.mine ? text('wishlists.yours') : list.person.name}</h2>
        </div>
        ${
          list.mine
            ? html`<lc-button variant="ghost" aria-label=${text('wishlists.addLabel')} @click=${() => this.openSheet(null)}>
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
          : html`<ul class="cl-kit-list cl-kit-panel">${list.items.map((item) => this.row(list, item))}</ul>`
      }
    </section>`;
  }

  itemSheet(): TemplateResult {
    const current = this.draft.value;
    const errors = this.errors.value;
    if (current === null) {
      return sheet({
        open: false,
        title: '',
        onClose: () => this.closeSheet(),
        body: html``,
        footer: html``,
      });
    }
    return sheet({
      open: true,
      title:
        current.editing === null
          ? text('wishlists.sheetAdd')
          : text('wishlists.sheetEdit', { name: current.editing.name }),
      onClose: () => this.closeSheet(),
      body: html`
        <lc-input
          required
          label=${text('wishlists.what')}
          .value=${current.name}
          error-message=${fieldError(errors, 'name')}
          @input=${(event: Event) => this.fill({ name: eventText(event) })}
        ></lc-input>
        <lc-select
          searchable
          label=${text('wishlists.ingredient')}
          .options=${[
            { value: '', label: text('wishlists.noIngredient') },
            ...(this.tree.value.value?.nodes ?? []).map((node) => ({
              value: String(node.id),
              label: `${INDENT.repeat(node.depth)}${node.name}`,
            })),
          ]}
          .value=${current.ingredientId}
          error-message=${fieldError(errors, 'ingredientId')}
          @change=${(event: Event) => this.fill({ ingredientId: eventText(event) })}
        ></lc-select>
        <lc-textarea
          label=${text('wishlists.note')}
          .value=${current.note}
          error-message=${fieldError(errors, 'note')}
          @input=${(event: Event) => this.fill({ note: eventText(event) })}
        ></lc-textarea>
        <lc-input
          type="url"
          label=${text('wishlists.url')}
          placeholder="https://"
          .value=${current.url}
          error-message=${fieldError(errors, 'url')}
          @input=${(event: Event) => this.fill({ url: eventText(event) })}
        ></lc-input>
      `,
      footer: html`
        <lc-button variant="quiet" @click=${() => this.closeSheet()}>${text('action.cancel')}</lc-button>
        <lc-button variant="primary" ?disabled=${this.saving.value} @click=${() => void this.save()}
          >${current.editing === null ? text('wishlists.addSubmit') : text('wishlists.save')}</lc-button
        >
      `,
    });
  }

  gotDialog(): TemplateResult {
    const item = this.gotItem.value;
    return html`<lc-modal
      size="sm"
      class="cl-wishlists-got"
      ?open=${item !== null}
      @modal-close=${() => {
        this.gotItem.value = null;
      }}
    >
      <h2 slot="header" class="cl-kit-sheet-title">${item === null ? '' : text('wishlists.gotTitle', { name: item.name })}</h2>
      <p>${text('wishlists.gotBody')}</p>
      <div slot="footer" class="cl-kit-sheet-footer">
        <lc-button variant="quiet" @click=${() => item !== null && void this.gotIt(item, false)}
          >${text('wishlists.justRemove')}</lc-button
        >
        <lc-button variant="primary" @click=${() => item !== null && void this.gotIt(item, true)}
          >${text('wishlists.addBottle')}</lc-button
        >
      </div>
    </lc-modal>`;
  }

  render() {
    const data = this.lists.value.value;
    const ordered = data === undefined ? [] : [...data.lists].sort((a, b) => Number(b.mine) - Number(a.mine));
    return html`
      <header>
        <h1 class="cl-kit-title cl-kit-wide-only">${text('wishlists.title')}</h1>
        <p class="cl-kit-lede">${text('wishlists.lede')}</p>
      </header>
      ${data === undefined ? waiting(this.state, text('nav.wishlists'), 'rows') : ordered.map((list) => this.listView(list))}
      <lc-dropdown class="cl-wishlists-menu"></lc-dropdown>
      ${this.itemSheet()} ${this.gotDialog()}
    `;
  }
}

View.register(tag, WishlistsScreen);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: WishlistsScreen;
  }
}
