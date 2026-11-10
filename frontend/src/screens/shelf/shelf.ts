import type { BottlePage, BottleStatus, BottleSummary } from '@cellar/contract';
import type { LightElements } from '@lightstart/components/elements.js';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { call } from '../../app/api.ts';
import { eventChecked, eventField, eventPage, eventText } from '../../app/events.ts';
import { type WatchState, type Watched, watch } from '../../app/load.ts';
import { invalidate, resourceFor } from '../../app/resources.ts';
import { href } from '../../app/router.ts';
import { today } from '../../app/today.ts';
import type { ScreenContext } from '../../app/types.ts';
import { confirm } from '../../design-system/dialogs.ts';
import { illustration } from '../../design-system/illustration.ts';
import { thumbHashDataUrl } from '../../design-system/thumbhash.ts';
import { toast } from '../../design-system/toast.ts';
import { formatDate, formatNumber } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import { type BottleDraft, bottleSheet } from './parts/bottle-sheet.ts';
import { attempt, follow, money, onWidth, pricesSwitch, sheet, waiting, wide } from './parts/kit.ts';
import './shelf.css';

type Dropdown = LightElements['lc-dropdown'];
type StatusFilter = 'all' | 'open' | 'sealed';
type Sort = 'name' | 'category' | 'opened' | 'price';
type BulkAction = 'open' | 'finish' | 'delete';

// D-1 §8.30: list rows page at 100.
const PAGE_SIZE = 100;
const TYPE_SETTLE_MS = 250;

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

export function screen(ctx: ScreenContext): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-kit-screen cl-shelf';
  const tree = resourceFor('getIngredientTree', {}, { tags: ['ingredients'] });
  const selected = new Set<number>();
  let selecting = false;
  let filtersOpen = false;
  let typed = ctx.query.get('q') ?? '';
  let typeTimer: ReturnType<typeof setTimeout> | null = null;
  let watched: Watched | null = null;
  let state: WatchState | null = null;
  const redraw = (): void => {
    if (state !== null) {
      draw(state);
    }
  };
  const bottles = bottleSheet({
    person: ctx.person,
    tree,
    redraw,
    closed: () => {
      if (ctx.query.get('add') !== null || ctx.query.get('bottle') !== null) {
        ctx.query.set({ add: null, bottle: null }, 'replace');
      }
    },
  });

  const showPrices = (): boolean => ctx.person.current()?.person.showPrices === true;
  const pageOf = (): number => idOf(ctx.query.get('page')) ?? 1;

  const listFor = () => {
    const status = statusFilterOf(ctx.query.get('status'));
    const sort = sortOf(ctx.query.get('sort'));
    const root = idOf(ctx.query.get('category'));
    const q = (ctx.query.get('q') ?? '').trim();
    const order = ctx.query.get('order') === 'desc' ? 'desc' : 'asc';
    return resourceFor(
      'listBottles',
      {
        query: {
          status: status === 'all' ? ['sealed', 'open'] : [status],
          sort: sort === 'price' && !showPrices() ? 'name' : sort,
          order,
          ...(root === null ? {} : { root }),
          ...(q === '' ? {} : { q }),
          page: pageOf(),
          pageSize: PAGE_SIZE,
        },
      },
      { tags: ['shelf'] },
    );
  };

  const filtered = (): boolean =>
    statusFilterOf(ctx.query.get('status')) !== 'all' ||
    ctx.query.get('category') !== null ||
    (ctx.query.get('q') ?? '') !== '';

  const setQuery = (patch: Record<string, string | null>): void => {
    ctx.query.set({ ...patch, page: null }, 'replace');
  };

  const changed = (): void => {
    invalidate('shelf', 'ingredients', 'recipes', 'stats');
  };

  const open = (bottle: BottleSummary): Promise<void> =>
    attempt(async () => {
      await call('openBottle', { params: { id: bottle.id }, body: { on: today() } });
      toast({ title: text('shelf.opened', { name: bottle.name }) });
      changed();
    });

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

  const finish = (bottle: BottleSummary): Promise<void> =>
    attempt(async () => {
      const consequence = await consequenceOf(bottle);
      const sure = await confirm({
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

  async function remove(bottle: BottleSummary): Promise<void> {
    const sure = await confirm({
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

  const edit = (bottle: BottleSummary): void => {
    ctx.query.set({ bottle: String(bottle.id) }, 'replace');
    void attempt(async () => {
      bottles.openEdit(await call('getBottle', { params: { id: bottle.id } }));
    });
  };

  const bulkCopy = (action: BulkAction, count: number): { title: string; message: string; confirmLabel: string } => {
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
  };

  async function bulk(action: BulkAction): Promise<void> {
    const ids = [...selected];
    if (ids.length === 0) {
      return;
    }
    const sure = await confirm({ ...bulkCopy(action, ids.length), danger: action === 'delete' });
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
      selected.clear();
      selecting = false;
      changed();
    });
  }

  const openRowMenu = (event: MouseEvent, bottle: BottleSummary): void => {
    const menu = element.querySelector<Dropdown>('.cl-shelf-menu');
    if (!(event.currentTarget instanceof Element) || menu === null) {
      return;
    }
    menu.items = [
      bottle.status === 'sealed'
        ? { label: text('shelf.openIt'), icon: 'wine', onClick: () => void open(bottle) }
        : { label: text('shelf.finishIt'), icon: 'circle-check', onClick: () => void finish(bottle) },
      { label: text('shelf.edit'), icon: 'pencil', onClick: () => edit(bottle) },
      { label: text('shelf.delete'), icon: 'trash-2', danger: true, onClick: () => void remove(bottle) },
    ];
    menu.toggle(event.currentTarget);
  };

  const rowMenuButton = (bottle: BottleSummary): TemplateResult => html`<button
    type="button"
    class="cl-icon-button"
    aria-haspopup="menu"
    aria-label=${text('shelf.rowActions', { name: bottle.name })}
    @click=${(event: MouseEvent) => openRowMenu(event, bottle)}
  >
    <lc-icon name="ellipsis" aria-hidden="true"></lc-icon>
  </button>`;

  const selectBox = (bottle: BottleSummary): TemplateResult => html`<lc-checkbox
    class="cl-shelf-check"
    .ariaLabel=${text('shelf.selectOne', { name: bottle.name })}
    ?checked=${selected.has(bottle.id)}
    @change=${(event: Event) => {
      if (eventChecked(event)) {
        selected.add(bottle.id);
      } else {
        selected.delete(bottle.id);
      }
      redraw();
    }}
  ></lc-checkbox>`;

  const nameCell = (bottle: BottleSummary, sub: string): TemplateResult => html`<span class="cl-kit-row-text">
    <span class="cl-kit-row-name">${bottle.name}</span>
    <span class="cl-kit-row-sub">${sub}</span>
  </span>`;

  const paid = (bottle: BottleSummary): TemplateResult =>
    bottle.pricePaidMinor === null || bottle.pricePaidMinor === undefined
      ? html`<span class="cl-shelf-faint">${text('shelf.none')}</span>`
      : html`${money(bottle.pricePaidMinor, ctx.person)}`;

  const table = (page: BottlePage): TemplateResult => {
    const prices = showPrices();
    const sort = sortOf(ctx.query.get('sort'));
    const columns = [
      ...(selecting ? [{ name: 'select', label: text('shelf.col.select'), sortable: false }] : []),
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
      select: selectBox(bottle),
      bottle: nameCell(bottle, bottle.ingredient.name),
      category: bottle.root.name,
      status: statusTag(bottle.status),
      size: bottle.labeledSize,
      opened:
        bottle.openedOn === null
          ? html`<span class="cl-shelf-faint">${text('shelf.notYet')}</span>`
          : formatDate(bottle.openedOn),
      paid: paid(bottle),
      actions: rowMenuButton(bottle),
    }));
    return html`<lc-table
      class="cl-shelf-table"
      sortable
      sort-by=${sort === 'name' ? 'bottle' : ''}
      sort-dir=${ctx.query.get('order') === 'desc' ? 'desc' : 'asc'}
      .columns=${columns}
      .rows=${rows}
      @sort=${(event: Event) => {
        const detail: unknown = event instanceof CustomEvent ? event.detail : null;
        const dir =
          typeof detail === 'object' && detail !== null && 'sortDir' in detail && detail.sortDir === 'desc'
            ? 'desc'
            : null;
        setQuery({ sort: null, order: dir });
      }}
    ></lc-table>`;
  };

  const compactRows = (page: BottlePage): TemplateResult => html`<ul class="cl-kit-list cl-shelf-rows">
    ${page.items.map((bottle) => {
      const price = bottle.pricePaidMinor;
      const sub =
        showPrices() && price !== null && price !== undefined
          ? text('shelf.compactSubPrice', {
              ingredient: bottle.ingredient.name,
              size: bottle.labeledSize,
              price: money(price, ctx.person),
            })
          : text('shelf.compactSub', { ingredient: bottle.ingredient.name, size: bottle.labeledSize });
      return html`<li class="cl-kit-row">
        ${selecting ? selectBox(bottle) : nothing} ${thumb(bottle)} ${nameCell(bottle, sub)}
        ${statusTag(bottle.status)} ${rowMenuButton(bottle)}
      </li>`;
    })}
  </ul>`;

  const selectAll = (page: BottlePage): TemplateResult => {
    const ids = page.items.map((bottle) => bottle.id);
    const count = ids.filter((id) => selected.has(id)).length;
    return html`<div class="cl-shelf-select-all">
      <lc-checkbox
        .ariaLabel=${text('shelf.selectAll')}
        ?checked=${count > 0 && count === ids.length}
        ?indeterminate=${count > 0 && count < ids.length}
        @change=${(event: Event) => {
          for (const id of ids) {
            if (eventChecked(event)) {
              selected.add(id);
            } else {
              selected.delete(id);
            }
          }
          redraw();
        }}
      ></lc-checkbox>
    </div>`;
  };

  const bulkBar =
    (): TemplateResult => html`<div class="cl-shelf-bulk" role="region" aria-label=${text('shelf.bulkBar')}>
    <span class="cl-shelf-bulk-count" aria-live="polite">${text('shelf.selected', { count: formatNumber(selected.size) })}</span>
    <lc-button variant="quiet" ?disabled=${selected.size === 0} @click=${() => void bulk('open')}
      >${text('shelf.bulk.open')}</lc-button
    >
    <lc-button variant="quiet" ?disabled=${selected.size === 0} @click=${() => void bulk('finish')}
      >${text('shelf.bulk.finish')}</lc-button
    >
    <lc-button variant="quiet" class="cl-shelf-danger" ?disabled=${selected.size === 0} @click=${() => void bulk('delete')}
      >${text('shelf.bulk.delete')}</lc-button
    >
  </div>`;

  const emptyView = (): TemplateResult =>
    filtered()
      ? html`<lc-empty-state title=${text('shelf.noMatchTitle')} description=${text('shelf.noMatchBody')}>
          ${illustration('empty-glass')}
          <lc-button
            variant="primary"
            @click=${() => {
              typed = '';
              setQuery({ status: null, category: null, q: null });
            }}
            >${text('shelf.clearFilters')}</lc-button
          >
        </lc-empty-state>`
      : html`<lc-empty-state title=${text('shelf.emptyTitle')} description=${text('shelf.emptyBody')}>
          ${illustration('empty-shelf')}
          <lc-button variant="primary" @click=${() => bottles.openAdd(null)}>${text('shelf.add')}</lc-button>
          <lc-button variant="quiet" href=${href('/import')}>${text('shelf.importCsv')}</lc-button>
        </lc-empty-state>`;

  const pager = (page: BottlePage): TemplateResult | typeof nothing => {
    const pages = Math.ceil(page.total / PAGE_SIZE);
    return pages <= 1
      ? nothing
      : html`<nav class="cl-shelf-pager" aria-label=${text('shelf.pages')}>
          <lc-pagination
            current=${pageOf()}
            total=${pages}
            @change=${(event: Event) => {
              const next = eventPage(event);
              ctx.query.set({ page: next !== null && next > 1 ? String(next) : null }, 'push');
            }}
          ></lc-pagination>
        </nav>`;
  };

  const head = (page: BottlePage | undefined): TemplateResult => {
    const totals = page?.totals;
    const lines =
      totals === undefined
        ? ''
        : [
            text('shelf.openSealed', { open: formatNumber(totals.open), sealed: formatNumber(totals.sealed) }),
            totals.valueMinor === undefined
              ? ''
              : text('shelf.worth', {
                  value: money(totals.valueMinor, ctx.person),
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
        <lc-button variant="primary" @click=${() => bottles.openAdd(null)}>
          <lc-icon name="plus" aria-hidden="true"></lc-icon>${text('shelf.add')}
        </lc-button>
      </div>
    </div>`;
  };

  const categorySelect = (): TemplateResult => {
    const category = idOf(ctx.query.get('category'));
    return html`<lc-select
      label=${text('shelf.category')}
      .options=${[
        { value: '', label: text('shelf.allCategories') },
        ...(tree.peek()?.nodes ?? [])
          .filter((node) => node.depth === 0)
          .map((node) => ({ value: String(node.id), label: node.name })),
      ]}
      .value=${category === null ? '' : String(category)}
      @change=${(event: Event) => {
        const value = eventText(event);
        setQuery({ category: value === '' ? null : value });
      }}
    ></lc-select>`;
  };

  const sortSelect = (): TemplateResult => html`<lc-select
    label=${text('shelf.sort')}
    .options=${[
      { value: 'name', label: text('shelf.sort.name') },
      { value: 'category', label: text('shelf.sort.category') },
      { value: 'opened', label: text('shelf.sort.opened') },
      ...(showPrices() ? [{ value: 'price', label: text('shelf.sort.price') }] : []),
    ]}
    .value=${sortOf(ctx.query.get('sort'))}
    @change=${(event: Event) => {
      const value = sortOf(eventText(event));
      setQuery({ sort: value === 'name' ? null : value, order: null });
    }}
  ></lc-select>`;

  const toggleSelecting = (): void => {
    selecting = !selecting;
    selected.clear();
    redraw();
  };

  const tools = (): TemplateResult => html`<div class="cl-kit-tools cl-shelf-tools">
    <lc-input
      type="search"
      label=${text('shelf.find')}
      placeholder=${text('shelf.find')}
      .value=${typed}
      @input=${(event: Event) => {
        typed = eventText(event);
        if (typeTimer !== null) {
          clearTimeout(typeTimer);
        }
        typeTimer = setTimeout(() => {
          typeTimer = null;
          setQuery({ q: typed.trim() === '' ? null : typed });
        }, TYPE_SETTLE_MS);
      }}
    ></lc-input>
    <lc-segmented
      label=${text('shelf.statusLabel')}
      .options=${[
        { value: 'all', label: text('shelf.status.all') },
        { value: 'open', label: text('shelf.status.open') },
        { value: 'sealed', label: text('shelf.status.sealed') },
      ]}
      value=${statusFilterOf(ctx.query.get('status'))}
      @change=${(event: Event) => {
        const chosen = eventField(event, 'value');
        const value = statusFilterOf(typeof chosen === 'string' ? chosen : null);
        setQuery({ status: value === 'all' ? null : value });
      }}
    ></lc-segmented>
    ${wide.matches ? html`${categorySelect()} ${sortSelect()}` : nothing}
    ${
      selecting
        ? html`<lc-button variant="primary" aria-pressed="true" @click=${toggleSelecting}>
            <lc-icon name="check" aria-hidden="true"></lc-icon>${text('shelf.done')}
          </lc-button>`
        : html`<lc-button variant="quiet" aria-pressed="false" @click=${toggleSelecting}>
            <lc-icon name="list-checks" aria-hidden="true"></lc-icon>${text('shelf.select')}
          </lc-button>`
    }
    ${
      wide.matches
        ? pricesSwitch(ctx.person)
        : html`<lc-button
            variant="quiet"
            @click=${() => {
              filtersOpen = true;
              redraw();
            }}
          >
            <lc-icon name="sliders-horizontal" aria-hidden="true"></lc-icon>${text('shelf.filters')}
          </lc-button>`
    }
  </div>`;

  const filtersSheet = (): TemplateResult =>
    sheet({
      open: filtersOpen && !wide.matches,
      title: text('shelf.filtersTitle'),
      onClose: () => {
        filtersOpen = false;
        redraw();
      },
      body: html`${categorySelect()} ${sortSelect()} ${pricesSwitch(ctx.person)}`,
      footer: html`<lc-button
        variant="primary"
        @click=${() => {
          filtersOpen = false;
          redraw();
        }}
        >${text('shelf.filtersDone')}</lc-button
      >`,
    });

  const body = (current: WatchState): TemplateResult | HTMLElement | typeof nothing | null => {
    const list = listFor();
    const pending = waiting(current, list, text('nav.shelf'), 'rows');
    const page = list.peek();
    if (pending !== null || page === undefined) {
      return pending;
    }
    if (page.items.length === 0) {
      return emptyView();
    }
    return html`
      ${selecting ? selectAll(page) : nothing} ${wide.matches ? table(page) : compactRows(page)} ${pager(page)}
      ${selecting ? bulkBar() : nothing}
    `;
  };

  function draw(current: WatchState): void {
    state = current;
    render(
      html`
        ${head(listFor().peek())} ${tools()} ${body(current)}
        <lc-dropdown class="cl-shelf-menu"></lc-dropdown>
        ${wide.matches ? nothing : filtersSheet()} ${bottles.view()}
      `,
      element,
    );
  }

  function start(): void {
    watched?.stop();
    watched = watch(element, [tree, listFor()], draw);
  }

  follow(element, ctx.query.subscribe, () => {
    if (typeTimer === null) {
      typed = ctx.query.get('q') ?? '';
    }
    start();
  });
  follow(element, ctx.person.subscribe, start);
  start();
  onWidth(element, () => watched?.redraw());
  const arrivingBottle = idOf(ctx.query.get('bottle'));
  if (ctx.query.get('add') !== null) {
    bottles.openAdd(arrivingDraft());
  } else if (arrivingBottle !== null) {
    void attempt(async () => {
      bottles.openEdit(await call('getBottle', { params: { id: arrivingBottle } }));
    });
  }
  return element;
}
