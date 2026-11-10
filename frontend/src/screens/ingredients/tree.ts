import type { IngredientNode, IngredientSummary } from '@cellar/contract';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { call } from '../../app/api.ts';
import { eventPage, eventText } from '../../app/events.ts';
import { type WatchState, type Watched, watch } from '../../app/load.ts';
import { actionFailed } from '../../app/problems.ts';
import { invalidate, resourceFor } from '../../app/resources.ts';
import { href } from '../../app/router.ts';
import { setAppBar } from '../../app/shell.ts';
import type { ScreenContext } from '../../app/types.ts';
import { illustration } from '../../design-system/illustration.ts';
import { toast } from '../../design-system/toast.ts';
import { formatCount, formatNumber } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import { follow, onWidth, waiting, wide } from '../shelf/parts/kit.ts';
import './ingredients.css';

// D-1 §9.7: the tree shows 100 rows per page.
const PAGE_SIZE = 100;
// Typing settles for this long before the list query runs.
const TYPE_SETTLE_MS = 250;

type Filter = 'on-hand' | 'has-bottles' | 'house-made';

interface Row {
  readonly id: number;
  readonly name: string;
  readonly depth: number;
  readonly onHand: boolean;
  readonly bottleCount: number;
  readonly sub: string;
}

function filterOf(value: string | null): Filter | null {
  return value === 'on-hand' || value === 'has-bottles' || value === 'house-made' ? value : null;
}

function idOf(value: string | null): number | null {
  const id = value === null ? Number.NaN : Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function bottles(count: number): string {
  return formatCount(count, text('ingredients.bottleOne'), text('ingredients.bottleMany'));
}

function recipes(count: number): string {
  return formatCount(count, text('ingredients.recipeOne'), text('ingredients.recipeMany'));
}

function usage(recipeCount: number, bottleCount: number): string {
  if (recipeCount > 0 && bottleCount > 0) {
    return text('ingredients.inRecipesBottles', { recipes: recipes(recipeCount), bottles: bottles(bottleCount) });
  }
  if (recipeCount > 0) {
    return text('ingredients.inRecipes', { recipes: recipes(recipeCount) });
  }
  return bottleCount > 0 ? bottles(bottleCount) : '';
}

function treeCounts(node: IngredientNode): string {
  const counts = usage(node.recipeCount, node.bottleCount);
  if (counts !== '' || node.childCount === 0) {
    return counts;
  }
  return formatCount(node.childCount, text('ingredients.kindOne'), text('ingredients.kindMany'));
}

function chipCounts(nodes: readonly IngredientNode[]): { onHand: number; hasBottles: number; houseMade: number } {
  return {
    onHand: nodes.filter((node) => node.onHand).length,
    hasBottles: nodes.filter((node) => node.bottleCount > 0).length,
    houseMade: nodes.filter((node) => node.houseMade).length,
  };
}

function subtree(nodes: readonly IngredientNode[], rootId: number | null): IngredientNode[] {
  if (rootId === null) {
    return [...nodes];
  }
  const start = nodes.findIndex((node) => node.id === rootId);
  if (start < 0) {
    return [];
  }
  const rootDepth = nodes[start]?.depth ?? 0;
  const end = nodes.findIndex((node, index) => index > start && node.depth <= rootDepth);
  return nodes.slice(start, end < 0 ? nodes.length : end);
}

function treeRow(node: IngredientNode): Row {
  return {
    id: node.id,
    name: node.name,
    depth: node.depth,
    onHand: node.onHand,
    bottleCount: node.bottleCount,
    sub: treeCounts(node),
  };
}

function summaryRow(item: IngredientSummary): Row {
  const counts = usage(item.recipeCount, item.bottleCount);
  const under = item.parent === null ? '' : text('ingredients.under', { parent: item.parent.name });
  return {
    id: item.id,
    name: item.name,
    depth: 1,
    onHand: item.onHand,
    bottleCount: item.bottleCount,
    sub: under === '' ? counts : counts === '' ? under : `${under}. ${counts}`,
  };
}

export function screen(ctx: ScreenContext): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-kit-screen cl-ingr';
  const tree = resourceFor('getIngredientTree', {}, { tags: ['ingredients'] });
  const busy = new Set<number>();
  let typed = ctx.query.get('q') ?? '';
  let typeTimer: ReturnType<typeof setTimeout> | null = null;
  let watched: Watched | null = null;

  const pageOf = (): number => idOf(ctx.query.get('page')) ?? 1;

  const listFor = () => {
    const q = (ctx.query.get('q') ?? '').trim();
    const filter = filterOf(ctx.query.get('filter'));
    const root = idOf(ctx.query.get('category'));
    if (q === '' && filter === null) {
      return null;
    }
    return resourceFor(
      'listIngredients',
      {
        query: {
          ...(q === '' ? {} : { q }),
          ...(filter === 'on-hand' ? { onHand: 'true' } : {}),
          ...(filter === 'has-bottles' ? { hasBottles: 'true' } : {}),
          ...(filter === 'house-made' ? { houseMade: 'true' } : {}),
          ...(root === null ? {} : { root }),
          page: pageOf(),
          pageSize: PAGE_SIZE,
        },
      },
      { tags: ['ingredients'] },
    );
  };

  async function toggle(row: Row): Promise<void> {
    busy.add(row.id);
    start();
    try {
      const state = await call('setOnHand', { params: { id: row.id }, body: { marked: !row.onHand } });
      if (row.onHand && state.onHand) {
        if (state.onHandReason === 'bottle') {
          toast({
            title:
              row.bottleCount === 1
                ? text('ingredients.stayOne', { name: row.name })
                : text('ingredients.stayMany', { name: row.name, count: formatNumber(row.bottleCount) }),
          });
        } else if (state.onHandReason === 'parts') {
          toast({ title: text('ingredients.stayParts', { name: row.name }) });
        }
      }
      invalidate('ingredients', 'recipes', 'stats');
    } catch (error) {
      actionFailed(error, () => void toggle(row));
    } finally {
      busy.delete(row.id);
      start();
    }
  }

  const setQuery = (patch: Record<string, string | null>): void => {
    ctx.query.set({ ...patch, page: null }, 'replace');
  };

  const onType = (event: Event): void => {
    typed = eventText(event);
    if (typeTimer !== null) {
      clearTimeout(typeTimer);
    }
    typeTimer = setTimeout(() => {
      typeTimer = null;
      setQuery({ q: typed.trim() === '' ? null : typed });
    }, TYPE_SETTLE_MS);
  };

  const toggleButton = (row: Row): TemplateResult => html`<button
    type="button"
    class="cl-kit-toggle"
    aria-pressed=${row.onHand ? 'true' : 'false'}
    aria-busy=${busy.has(row.id) ? 'true' : nothing}
    @click=${() => {
      if (!busy.has(row.id)) {
        void toggle(row);
      }
    }}
  >
    <cl-bulb size="mini" status=${row.onHand ? 'on' : 'off'}></cl-bulb>
    <span class="cl-vh">${text('ingredients.toggleLabel', { name: row.name })}</span>
    <span>${row.onHand ? text('ingredients.onHand') : text('ingredients.notHere')}</span>
  </button>`;

  const rowView = (row: Row): TemplateResult =>
    row.depth === 0
      ? html`<li class="cl-ingr-row cl-ingr-root">
          <a class="cl-kit-row-link cl-kit-row-text" href=${href(`/ingredients/${row.id}`)}>
            <span class="cl-ingr-root-name">${row.name}</span>
            ${row.sub === '' ? nothing : html`<span class="cl-kit-row-sub">${row.sub}</span>`}
          </a>
          ${row.bottleCount > 0 ? html`<span class="cl-kit-meta">${bottles(row.bottleCount)}</span>` : nothing}
        </li>`
      : html`<li class="cl-ingr-row" style=${`--depth: ${row.depth}`}>
          <a class="cl-kit-row-link cl-kit-row-text" href=${href(`/ingredients/${row.id}`)}>
            <span class="cl-kit-row-name">${row.name}</span>
            ${row.sub === '' ? nothing : html`<span class="cl-kit-row-sub">${row.sub}</span>`}
          </a>
          ${toggleButton(row)}
        </li>`;

  const pager = (total: number): TemplateResult | typeof nothing => {
    const pages = Math.ceil(total / PAGE_SIZE);
    return pages <= 1
      ? nothing
      : html`<nav class="cl-ingr-pager" aria-label=${text('ingredients.pages')}>
          <lc-pagination
            current=${pageOf()}
            total=${pages}
            @change=${(event: Event) => {
              const page = eventPage(event);
              ctx.query.set({ page: page !== null && page > 1 ? String(page) : null }, 'push');
            }}
          ></lc-pagination>
        </nav>`;
  };

  const emptyView = (): TemplateResult => {
    const q = (ctx.query.get('q') ?? '').trim();
    if (q !== '') {
      return html`<lc-empty-state title=${text('ingredients.noMatchTitle', { q })} description=${text('ingredients.noMatchBody')}>
        ${illustration('empty-glass')}
        <lc-button variant="primary" href=${href(`/ingredients/new?name=${encodeURIComponent(q)}`)}
          >${text('ingredients.create', { q })}</lc-button
        >
      </lc-empty-state>`;
    }
    return html`<lc-empty-state title=${text('ingredients.noFilterTitle')} description=${text('ingredients.noFilterBody')}>
      ${illustration('empty-glass')}
      <lc-button variant="primary" @click=${() => ctx.query.set({ filter: null, category: null, page: null }, 'replace')}
        >${text('ingredients.clearFilters')}</lc-button
      >
    </lc-empty-state>`;
  };

  const draw = (state: WatchState): void => {
    const nodes = tree.peek()?.nodes;
    const filter = filterOf(ctx.query.get('filter'));
    const category = idOf(ctx.query.get('category'));
    const list = listFor();
    const roots = nodes?.filter((node) => node.depth === 0) ?? [];
    const counts = chipCounts(nodes ?? []);
    const chip = (value: Filter, label: string, count: number): TemplateResult => html`<button
      type="button"
      class="cl-kit-chip"
      aria-pressed=${filter === value ? 'true' : 'false'}
      @click=${() => setQuery({ filter: filter === value ? null : value })}
    >
      ${label}<span class="cl-kit-chip-count">${formatNumber(count)}</span>
    </button>`;

    let body: TemplateResult | HTMLElement | typeof nothing | null;
    if (list === null) {
      body = waiting(state, tree, text('nav.ingredients'), 'rows');
      if (body === null && nodes !== undefined) {
        const rows = subtree(nodes, category).map(treeRow);
        const shown = rows.slice((pageOf() - 1) * PAGE_SIZE, pageOf() * PAGE_SIZE);
        body =
          rows.length === 0
            ? emptyView()
            : html`<ul class="cl-kit-list cl-ingr-tree">${shown.map(rowView)}</ul>
                ${pager(rows.length)}`;
      }
    } else {
      body = waiting(state, list, text('nav.ingredients'), 'rows');
      const page = list.peek();
      if (body === null && page !== undefined) {
        body =
          page.items.length === 0
            ? emptyView()
            : html`<ul class="cl-kit-list cl-ingr-tree">${page.items.map((item) => rowView(summaryRow(item)))}</ul>
                ${pager(page.total)}`;
      }
    }

    render(
      html`
        ${
          nodes === undefined
            ? nothing
            : html`<cl-figure
                value=${counts.onHand}
                label=${text('ingredients.figureLabel', { total: formatNumber(nodes.length) })}
                sublabel=${text('ingredients.figureSub')}
              ></cl-figure>`
        }
        <div class="cl-kit-tools">
          <lc-input
            type="search"
            label=${text('ingredients.find')}
            placeholder=${text('ingredients.find')}
            .value=${typed}
            @input=${onType}
          ></lc-input>
          <lc-select
            label=${text('ingredients.category')}
            .options=${[
              { value: '', label: text('ingredients.allCategories') },
              ...roots.map((root) => ({ value: String(root.id), label: root.name })),
            ]}
            .value=${category === null ? '' : String(category)}
            @change=${(event: Event) => {
              const value = eventText(event);
              setQuery({ category: value === '' ? null : value });
            }}
          ></lc-select>
          ${
            wide.matches
              ? html`<lc-button variant="primary" href=${href('/ingredients/new')}>
                  <lc-icon name="plus" aria-hidden="true"></lc-icon>${text('ingredients.new')}
                </lc-button>`
              : nothing
          }
        </div>
        <div class="cl-kit-chips" role="group" aria-label=${text('ingredients.filtersLabel')}>
          ${chip('on-hand', text('ingredients.chip.onHand'), counts.onHand)}
          ${chip('has-bottles', text('ingredients.chip.hasBottles'), counts.hasBottles)}
          ${chip('house-made', text('ingredients.chip.houseMade'), counts.houseMade)}
        </div>
        ${body}
      `,
      element,
    );
  };

  function start(): void {
    watched?.stop();
    const list = listFor();
    watched = watch(element, list === null ? [tree] : [tree, list], draw);
  }

  follow(element, ctx.query.subscribe, () => {
    if (typeTimer === null) {
      typed = ctx.query.get('q') ?? '';
    }
    start();
  });
  start();
  onWidth(element, () => watched?.redraw());
  const add = document.createElement('a');
  add.className = 'cl-icon-button';
  add.href = href('/ingredients/new');
  add.setAttribute('aria-label', text('ingredients.new'));
  render(html`<lc-icon name="plus" aria-hidden="true"></lc-icon>`, add);
  setAppBar({ actions: [add] });
  return element;
}
