import type { BottlePage, BottleStatus, BottleSummary } from '@cellar/contract';
import type { LightElements } from '@lightstart/components/elements.js';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { call } from '../../app/api.ts';
import { route } from '../../app/controllers/route.ts';
import { session } from '../../app/controllers/session.ts';
import { type BottleDraft, bottleSheet } from '../../app/controllers/shelf-bottle-sheet.ts';
import { viewport } from '../../app/controllers/viewport.ts';
import { eventChecked, eventField, eventPage, eventText } from '../../app/events.ts';
import { loadState } from '../../app/load.ts';
import { apiResource, dataChanged } from '../../app/resources.ts';
import { href, setQuery } from '../../app/router.ts';
import { today } from '../../app/today.ts';
import { confirm } from '../../design-system/dialogs.ts';
import { illustration } from '../../design-system/illustration.ts';
import { waiting } from '../../design-system/load-view.ts';
import { thumbHashDataUrl } from '../../design-system/thumbhash.ts';
import { toast } from '../../design-system/toast.ts';
import { formatDate, formatNumber } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import '../../design-system/cl-bulb.ts';
import '../../design-system/cl-figure.ts';
import '../../design-system/cl-plate.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/checkbox.ts';
import '../../design-system/lc/dropdown.ts';
import '../../design-system/lc/empty-state.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/image.ts';
import '../../design-system/lc/input.ts';
import '../../design-system/lc/pagination.ts';
import '../../design-system/lc/segmented.ts';
import '../../design-system/lc/select.ts';
import '../../design-system/lc/table.ts';
import './parts/bottle-sheet.ts';
import { attempt, followTyping, money, pricesSwitch, sheet } from './parts/kit.ts';
import './shelf.css';

export const tag = 'cl-screen-shelf-shelf';

type Dropdown = LightElements['lc-dropdown'];
type StatusFilter = 'all' | 'open' | 'sealed';
type Sort = 'name' | 'category' | 'opened' | 'price';
type BulkAction = 'open' | 'finish' | 'delete';

// D-1 §8.30: list rows page at 100.
const PAGE_SIZE = 100;

function statusFilterOf(value: string | null): StatusFilter {
  return value === 'open' || value === 'sealed' ? value : 'all';
}

function sortOf(value: string | null): Sort {
  return value === 'category' || value === 'opened' || value === 'price' ? value : 'name';
}

function idOf(value: string | null): number | null {
  const id = value === null ? Number.NaN : Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function isBottleDraft(value: unknown): value is BottleDraft {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string' &&
    'ingredientId' in value &&
    (value.ingredientId === null || typeof value.ingredientId === 'number')
  );
}

function arrivingDraft(): BottleDraft | null {
  const state: unknown = history.state;
  if (typeof state === 'object' && state !== null && 'bottleDraft' in state && isBottleDraft(state.bottleDraft)) {
    return state.bottleDraft;
  }
  return null;
}

function statusTag(status: BottleStatus): TemplateResult {
  const label =
    status === 'open' ? text('bulb.open') : status === 'sealed' ? text('bulb.sealed') : text('bulb.finished');
  return html`<span class="cl-shelf-status">
    <cl-bulb size="mini" status=${status === 'open' ? 'on' : status === 'sealed' ? 'off' : 'optional'}></cl-bulb>${label}
  </span>`;
}

function thumb(bottle: BottleSummary): TemplateResult {
  return bottle.image === null
    ? html`<cl-plate class="cl-kit-thumb" small kind="bottle" name=${bottle.name}></cl-plate>`
    : html`<lc-image
        class="cl-kit-thumb"
        src=${bottle.image.url}
        alt=""
        placeholder=${bottle.image.thumbhash === null ? nothing : thumbHashDataUrl(bottle.image.thumbhash)}
      ></lc-image>`;
}

function showPrices(): boolean {
  return session.current.value?.person.showPrices === true;
}

function nameCell(bottle: BottleSummary, sub: string): TemplateResult {
  return html`<span class="cl-kit-row-text">
    <span class="cl-kit-row-name">${bottle.name}</span>
    <span class="cl-kit-row-sub">${sub}</span>
  </span>`;
}

function paid(bottle: BottleSummary): TemplateResult {
  return bottle.pricePaidMinor === null || bottle.pricePaidMinor === undefined
    ? html`<span class="cl-shelf-faint">${text('shelf.none')}</span>`
    : html`${money(bottle.pricePaidMinor)}`;
}

function changed(): void {
  dataChanged('shelf', 'ingredients', 'recipes', 'stats');
}

function bulkCopy(action: BulkAction, count: number): { title: string; message: string; confirmLabel: string } {
  const n = formatNumber(count);
  switch (action) {
    case 'open':
      return {
        title: count === 1 ? text('shelf.bulkOpenTitleOne') : text('shelf.bulkOpenTitle', { count: n }),
        message: text('shelf.bulkOpenBody'),
        confirmLabel: text('shelf.bulkOpenConfirm', { count: n }),
      };
    case 'finish':
      return {
        title: count === 1 ? text('shelf.bulkFinishTitleOne') : text('shelf.bulkFinishTitle', { count: n }),
        message: text('shelf.bulkFinishBody'),
        confirmLabel: text('shelf.bulkFinishConfirm', { count: n }),
      };
    case 'delete':
      return {
        title: count === 1 ? text('shelf.bulkDeleteTitleOne') : text('shelf.bulkDeleteTitle', { count: n }),
        message: text('shelf.bulkDeleteBody'),
        confirmLabel: text('shelf.bulkDeleteConfirm', { count: n }),
      };
  }
}

function openBottle(bottle: BottleSummary): Promise<void> {
  return attempt(async () => {
    await call('openBottle', { params: { id: bottle.id }, body: { on: today() } });
    toast({ title: text('shelf.opened', { name: bottle.name }) });
    changed();
  });
}

async function consequenceOf(bottle: BottleSummary): Promise<string> {
  const ingredient = await call('getIngredient', { params: { id: bottle.ingredient.id } });
  const others = ingredient.bottles.onShelf.filter((other) => other.id !== bottle.id).length;
  if (others === 1) {
    return text('shelf.finishStaysOne', { ingredient: ingredient.name });
  }
  if (others > 1) {
    return text('shelf.finishStaysMany', { ingredient: ingredient.name, count: formatNumber(others) });
  }
  return ingredient.markedOnHand
    ? text('shelf.finishMarked', { ingredient: ingredient.name })
    : text('shelf.finishGone', { ingredient: ingredient.name });
}

function filterQuery(patch: Record<string, string | null>): void {
  setQuery({ ...patch, page: null }, 'replace');
}

class ShelfScreen extends View {
  readonly tree = apiResource('getIngredientTree', ['ingredients']);
  readonly list = apiResource('listBottles', ['shelf']);
  readonly state = loadState([this.list]);
  readonly selected = signal<ReadonlySet<number>>(new Set());
  readonly selecting = signal(false);
  readonly filtersOpen = signal(false);
  readonly typed = signal(route.query.peek().get('q') ?? '');

  constructor() {
    super();
    bottleSheet.reset();
  }

  connected(): void {
    this.classList.add('cl-kit-screen', 'cl-shelf');
    this.tree.bind(this, {});
    this.list.bind(this, () => {
      const query = route.query.value;
      const status = statusFilterOf(query.get('status'));
      const sort = sortOf(query.get('sort'));
      const root = idOf(query.get('category'));
      const q = (query.get('q') ?? '').trim();
      return {
        query: {
          status: status === 'all' ? ['sealed', 'open'] : [status],
          sort: sort === 'price' && !showPrices() ? 'name' : sort,
          order: query.get('order') === 'desc' ? 'desc' : 'asc',
          ...(root === null ? {} : { root }),
          ...(q === '' ? {} : { q }),
          page: idOf(query.get('page')) ?? 1,
          pageSize: PAGE_SIZE,
        },
      };
    });
    followTyping(this, this.typed);
  }

  firstUpdated(): void {
    const query = route.query.peek();
    const arrivingBottle = idOf(query.get('bottle'));
    if (query.get('add') !== null) {
      bottleSheet.openAdd(arrivingDraft());
    } else if (arrivingBottle !== null) {
      this.openEdit(arrivingBottle);
    }
  }

  private openEdit(id: number): void {
    void attempt(async () => {
      const bottle = await call('getBottle', { params: { id } });
      if (this.isConnected) {
        bottleSheet.openEdit(bottle);
      }
    });
  }

  private finish(bottle: BottleSummary): Promise<void> {
    return attempt(async () => {
      const consequence = await consequenceOf(bottle);
      if (!this.isConnected) {
        return;
      }
      const sure = await confirm(this, {
        title: text('shelf.finishTitle', { name: bottle.name }),
        message: `${text('shelf.finishBody')} ${consequence}`,
        confirmLabel: text('shelf.finishConfirm'),
      });
      if (!sure) {
        return;
      }
      await call('finishBottle', { params: { id: bottle.id }, body: { on: today() } });
      changed();
      toast({
        title: text('shelf.finished'),
        action: {
          label: text('toast.undo'),
          run: () =>
            void attempt(async () => {
              await call('reopenBottle', { params: { id: bottle.id } });
              toast({ title: text('toast.undone') });
              changed();
            }),
        },
      });
    });
  }

  private async removeBottle(bottle: BottleSummary): Promise<void> {
    const sure = await confirm(this, {
      title: text('shelf.deleteTitle', { name: bottle.name }),
      message: text('shelf.deleteBody'),
      confirmLabel: text('shelf.deleteConfirm'),
      danger: true,
    });
    if (sure) {
      await attempt(async () => {
        await call('deleteBottle', { params: { id: bottle.id } });
        toast({ title: text('shelf.deleted') });
        changed();
      });
    }
  }

  private edit(bottle: BottleSummary): void {
    setQuery({ bottle: String(bottle.id) }, 'replace');
    this.openEdit(bottle.id);
  }

  private async bulk(action: BulkAction): Promise<void> {
    const ids = [...this.selected.peek()];
    if (ids.length === 0) {
      return;
    }
    const sure = await confirm(this, { ...bulkCopy(action, ids.length), danger: action === 'delete' });
    if (!sure) {
      return;
    }
    await attempt(async () => {
      const result = await call('bulkBottles', { body: { action, ids, on: today() } });
      toast({
        title:
          result.skipped.length === 0
            ? text('shelf.bulkDone', { count: formatNumber(result.affected) })
            : text('shelf.bulkSkipped', {
                count: formatNumber(result.affected),
                skipped: formatNumber(result.skipped.length),
              }),
      });
      this.selected.value = new Set();
      this.selecting.value = false;
      changed();
    });
  }

  private select(ids: readonly number[], on: boolean): void {
    const next = new Set(this.selected.peek());
    for (const id of ids) {
      if (on) {
        next.add(id);
      } else {
        next.delete(id);
      }
    }
    this.selected.value = next;
  }

  private toggleSelecting(): void {
    this.selecting.value = !this.selecting.peek();
    this.selected.value = new Set();
  }

  private openRowMenu(event: MouseEvent, bottle: BottleSummary): void {
    const menu = this.querySelector<Dropdown>('.cl-shelf-menu');
    if (!(event.currentTarget instanceof Element) || menu === null) {
      return;
    }
    menu.items = [
      bottle.status === 'sealed'
        ? { label: text('shelf.openIt'), icon: 'wine', onClick: () => void openBottle(bottle) }
        : { label: text('shelf.finishIt'), icon: 'circle-check', onClick: () => void this.finish(bottle) },
      { label: text('shelf.edit'), icon: 'pencil', onClick: () => this.edit(bottle) },
      { label: text('shelf.delete'), icon: 'trash-2', danger: true, onClick: () => void this.removeBottle(bottle) },
    ];
    menu.toggle(event.currentTarget);
  }

  private rowMenuButton(bottle: BottleSummary): TemplateResult {
    return html`<button
      type="button"
      class="cl-icon-button"
      aria-haspopup="menu"
      aria-label=${text('shelf.rowActions', { name: bottle.name })}
      @click=${(event: MouseEvent) => this.openRowMenu(event, bottle)}
    >
      <lc-icon name="ellipsis" aria-hidden="true"></lc-icon>
    </button>`;
  }

  private selectBox(bottle: BottleSummary): TemplateResult {
    return html`<lc-checkbox
      class="cl-shelf-check"
      .ariaLabel=${text('shelf.selectOne', { name: bottle.name })}
      ?checked=${this.selected.value.has(bottle.id)}
      @change=${(event: Event) => this.select([bottle.id], eventChecked(event))}
    ></lc-checkbox>`;
  }

  private table(page: BottlePage): TemplateResult {
    const prices = showPrices();
    const query = route.query.value;
    const sort = sortOf(query.get('sort'));
    const columns = [
      ...(this.selecting.value ? [{ name: 'select', label: text('shelf.col.select'), sortable: false }] : []),
      { name: 'photo', label: text('shelf.col.photo'), sortable: false },
      { name: 'bottle', label: text('shelf.col.bottle') },
      { name: 'category', label: text('shelf.col.category'), sortable: false },
      { name: 'status', label: text('shelf.col.status'), sortable: false },
      { name: 'size', label: text('shelf.col.size'), align: 'right', sortable: false },
      { name: 'opened', label: text('shelf.col.opened'), sortable: false },
      ...(prices ? [{ name: 'paid', label: text('shelf.col.paid'), align: 'right', sortable: false }] : []),
      { name: 'actions', label: text('shelf.col.actions'), sortable: false },
    ];
    const rows = page.items.map((bottle) => ({
      photo: thumb(bottle),
      select: this.selectBox(bottle),
      bottle: nameCell(bottle, bottle.ingredient.name),
      category: bottle.root.name,
      status: statusTag(bottle.status),
      size: bottle.labeledSize,
      opened:
        bottle.openedOn === null
          ? html`<span class="cl-shelf-faint">${text('shelf.notYet')}</span>`
          : formatDate(bottle.openedOn),
      paid: paid(bottle),
      actions: this.rowMenuButton(bottle),
    }));
    return html`<lc-table
      class="cl-shelf-table"
      sortable
      sort-by=${sort === 'name' ? 'bottle' : ''}
      sort-dir=${query.get('order') === 'desc' ? 'desc' : 'asc'}
      .columns=${columns}
      .rows=${rows}
      @sort=${(event: Event) => {
        const detail: unknown = event instanceof CustomEvent ? event.detail : null;
        const dir =
          typeof detail === 'object' && detail !== null && 'sortDir' in detail && detail.sortDir === 'desc'
            ? 'desc'
            : null;
        filterQuery({ sort: null, order: dir });
      }}
    ></lc-table>`;
  }

  private compactRows(page: BottlePage): TemplateResult {
    const selecting = this.selecting.value;
    return html`<ul class="cl-kit-list cl-shelf-rows">
      ${page.items.map((bottle) => {
        const price = bottle.pricePaidMinor;
        const sub =
          showPrices() && price !== null && price !== undefined
            ? text('shelf.compactSubPrice', {
                ingredient: bottle.ingredient.name,
                size: bottle.labeledSize,
                price: money(price),
              })
            : text('shelf.compactSub', { ingredient: bottle.ingredient.name, size: bottle.labeledSize });
        return html`<li class="cl-kit-row">
          ${selecting ? this.selectBox(bottle) : nothing} ${thumb(bottle)} ${nameCell(bottle, sub)}
          ${statusTag(bottle.status)} ${this.rowMenuButton(bottle)}
        </li>`;
      })}
    </ul>`;
  }

  private selectAll(page: BottlePage): TemplateResult {
    const ids = page.items.map((bottle) => bottle.id);
    const selected = this.selected.value;
    const count = ids.filter((id) => selected.has(id)).length;
    return html`<div class="cl-shelf-select-all">
      <lc-checkbox
        .ariaLabel=${text('shelf.selectAll')}
        ?checked=${count > 0 && count === ids.length}
        ?indeterminate=${count > 0 && count < ids.length}
        @change=${(event: Event) => this.select(ids, eventChecked(event))}
      ></lc-checkbox>
    </div>`;
  }

  private bulkBar(): TemplateResult {
    const size = this.selected.value.size;
    return html`<div class="cl-shelf-bulk" role="region" aria-label=${text('shelf.bulkBar')}>
      <span class="cl-shelf-bulk-count" aria-live="polite">${text('shelf.selected', { count: formatNumber(size) })}</span>
      <lc-button variant="quiet" ?disabled=${size === 0} @click=${() => void this.bulk('open')}
        >${text('shelf.bulk.open')}</lc-button
      >
      <lc-button variant="quiet" ?disabled=${size === 0} @click=${() => void this.bulk('finish')}
        >${text('shelf.bulk.finish')}</lc-button
      >
      <lc-button variant="quiet" class="cl-shelf-danger" ?disabled=${size === 0} @click=${() => void this.bulk('delete')}
        >${text('shelf.bulk.delete')}</lc-button
      >
    </div>`;
  }

  private emptyView(): TemplateResult {
    const query = route.query.value;
    const filtered =
      statusFilterOf(query.get('status')) !== 'all' || query.get('category') !== null || (query.get('q') ?? '') !== '';
    return filtered
      ? html`<lc-empty-state title=${text('shelf.noMatchTitle')} description=${text('shelf.noMatchBody')}>
          ${illustration('empty-glass')}
          <lc-button
            variant="primary"
            @click=${() => {
              filterQuery({ status: null, category: null, q: null });
              this.typed.value = '';
            }}
            >${text('shelf.clearFilters')}</lc-button
          >
        </lc-empty-state>`
      : html`<lc-empty-state title=${text('shelf.emptyTitle')} description=${text('shelf.emptyBody')}>
          ${illustration('empty-shelf')}
          <lc-button variant="primary" @click=${() => bottleSheet.openAdd(null)}>${text('shelf.add')}</lc-button>
          <lc-button variant="quiet" href=${href('/import')}>${text('shelf.importCsv')}</lc-button>
        </lc-empty-state>`;
  }

  private pager(page: BottlePage): TemplateResult | typeof nothing {
    const pages = Math.ceil(page.total / PAGE_SIZE);
    return pages <= 1
      ? nothing
      : html`<nav class="cl-shelf-pager" aria-label=${text('shelf.pages')}>
          <lc-pagination
            current=${idOf(route.query.value.get('page')) ?? 1}
            total=${pages}
            @change=${(event: Event) => {
              const next = eventPage(event);
              setQuery({ page: next !== null && next > 1 ? String(next) : null }, 'push');
            }}
          ></lc-pagination>
        </nav>`;
  }

  private head(page: BottlePage | undefined): TemplateResult {
    const totals = page?.totals;
    const lines =
      totals === undefined
        ? ''
        : [
            text('shelf.openSealed', { open: formatNumber(totals.open), sealed: formatNumber(totals.sealed) }),
            totals.valueMinor === undefined
              ? ''
              : text('shelf.worth', {
                  value: money(totals.valueMinor),
                  priced: formatNumber(totals.priced),
                  count: formatNumber(totals.count),
                }),
          ]
            .filter((line) => line !== '')
            .join(' ');
    return html`<div class="cl-kit-head">
      ${
        totals === undefined
          ? html`<span></span>`
          : html`<cl-figure
              value=${totals.count}
              label=${totals.count === 1 ? text('shelf.figureOne') : text('shelf.figureLabel')}
              sublabel=${lines}
            ></cl-figure>`
      }
      <div class="cl-kit-head-actions">
        <lc-button variant="quiet" href=${href('/shelf/history')}>
          <lc-icon name="history" aria-hidden="true"></lc-icon>${text('shelf.history')}
        </lc-button>
        <lc-button variant="primary" @click=${() => bottleSheet.openAdd(null)}>
          <lc-icon name="plus" aria-hidden="true"></lc-icon>${text('shelf.add')}
        </lc-button>
      </div>
    </div>`;
  }

  private categorySelect(): TemplateResult {
    const category = idOf(route.query.value.get('category'));
    return html`<lc-select
      label=${text('shelf.category')}
      .options=${[
        { value: '', label: text('shelf.allCategories') },
        ...(this.tree.value.value?.nodes ?? [])
          .filter((node) => node.depth === 0)
          .map((node) => ({ value: String(node.id), label: node.name })),
      ]}
      .value=${category === null ? '' : String(category)}
      @change=${(event: Event) => {
        const value = eventText(event);
        filterQuery({ category: value === '' ? null : value });
      }}
    ></lc-select>`;
  }

  private sortSelect(): TemplateResult {
    return html`<lc-select
      label=${text('shelf.sort')}
      .options=${[
        { value: 'name', label: text('shelf.sort.name') },
        { value: 'category', label: text('shelf.sort.category') },
        { value: 'opened', label: text('shelf.sort.opened') },
        ...(showPrices() ? [{ value: 'price', label: text('shelf.sort.price') }] : []),
      ]}
      .value=${sortOf(route.query.value.get('sort'))}
      @change=${(event: Event) => {
        const value = sortOf(eventText(event));
        filterQuery({ sort: value === 'name' ? null : value, order: null });
      }}
    ></lc-select>`;
  }

  private tools(wide: boolean): TemplateResult {
    return html`<div class="cl-kit-tools cl-shelf-tools">
      <lc-input
        type="search"
        label=${text('shelf.find')}
        placeholder=${text('shelf.find')}
        .value=${this.typed.value}
        @input=${(event: Event) => {
          this.typed.value = eventText(event);
        }}
      ></lc-input>
      <lc-segmented
        label=${text('shelf.statusLabel')}
        .options=${[
          { value: 'all', label: text('shelf.status.all') },
          { value: 'open', label: text('shelf.status.open') },
          { value: 'sealed', label: text('shelf.status.sealed') },
        ]}
        value=${statusFilterOf(route.query.value.get('status'))}
        @change=${(event: Event) => {
          const chosen = eventField(event, 'value');
          const value = statusFilterOf(typeof chosen === 'string' ? chosen : null);
          filterQuery({ status: value === 'all' ? null : value });
        }}
      ></lc-segmented>
      ${wide ? html`${this.categorySelect()} ${this.sortSelect()}` : nothing}
      ${
        this.selecting.value
          ? html`<lc-button variant="primary" aria-pressed="true" @click=${() => this.toggleSelecting()}>
              <lc-icon name="check" aria-hidden="true"></lc-icon>${text('shelf.done')}
            </lc-button>`
          : html`<lc-button variant="quiet" aria-pressed="false" @click=${() => this.toggleSelecting()}>
              <lc-icon name="list-checks" aria-hidden="true"></lc-icon>${text('shelf.select')}
            </lc-button>`
      }
      ${
        wide
          ? pricesSwitch()
          : html`<lc-button
              variant="quiet"
              @click=${() => {
                this.filtersOpen.value = true;
              }}
            >
              <lc-icon name="sliders-horizontal" aria-hidden="true"></lc-icon>${text('shelf.filters')}
            </lc-button>`
      }
    </div>`;
  }

  private filtersSheet(): TemplateResult {
    return sheet({
      open: this.filtersOpen.value,
      title: text('shelf.filtersTitle'),
      onClose: () => {
        this.filtersOpen.value = false;
      },
      body: html`${this.categorySelect()} ${this.sortSelect()} ${pricesSwitch()}`,
      footer: html`<lc-button
        variant="primary"
        @click=${() => {
          this.filtersOpen.value = false;
        }}
        >${text('shelf.filtersDone')}</lc-button
      >`,
    });
  }

  private body(page: BottlePage | undefined, wide: boolean): TemplateResult | HTMLElement | typeof nothing | null {
    const pending = waiting(this.state, text('nav.shelf'), 'rows');
    if (pending !== null || page === undefined) {
      return pending;
    }
    if (page.items.length === 0) {
      return this.emptyView();
    }
    const selecting = this.selecting.value;
    return html`
      ${selecting ? this.selectAll(page) : nothing} ${wide ? this.table(page) : this.compactRows(page)} ${this.pager(page)}
      ${selecting ? this.bulkBar() : nothing}
    `;
  }

  render() {
    const page = this.list.value.value;
    const wide = viewport.wide.value;
    return html`
      ${this.head(page)} ${this.tools(wide)} ${this.body(page, wide)}
      <lc-dropdown class="cl-shelf-menu"></lc-dropdown>
      ${wide ? nothing : this.filtersSheet()} <cl-shelf-bottle-sheet></cl-shelf-bottle-sheet>
    `;
  }
}

View.register(tag, ShelfScreen);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: ShelfScreen;
  }
}
