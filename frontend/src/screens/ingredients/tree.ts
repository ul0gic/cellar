import type { IngredientNode, IngredientSummary } from '@cellar/contract';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { effect, signal, untracked } from '@lightstart/light/signals';
import { call } from '../../app/api.ts';
import { route } from '../../app/controllers/route.ts';
import { viewport } from '../../app/controllers/viewport.ts';
import { eventPage, eventText } from '../../app/events.ts';
import { loadState } from '../../app/load.ts';
import { actionFailed } from '../../app/problems.ts';
import { apiResource, dataChanged } from '../../app/resources.ts';
import { href, setQuery } from '../../app/router.ts';
import { setAppBar } from '../../app/shell.ts';
import type { Owner } from '../../app/types.ts';
import { illustration } from '../../design-system/illustration.ts';
import { waiting } from '../../design-system/load-view.ts';
import { toast } from '../../design-system/toast.ts';
import { formatCount, formatNumber } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import '../../design-system/cl-bulb.ts';
import '../../design-system/cl-figure.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/empty-state.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/input.ts';
import '../../design-system/lc/pagination.ts';
import '../../design-system/lc/select.ts';
import { followTyping } from '../shelf/parts/kit.ts';
import './ingredients.css';

export const tag = 'cl-screen-ingredients-tree';

// D-1 §9.7: the tree shows 100 rows per page.
const PAGE_SIZE = 100;

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

class BindScope implements Owner {
  private teardowns: (() => void)[] = [];

  $own(teardown: () => void): void {
    this.teardowns.push(teardown);
  }

  end(): void {
    for (const teardown of this.teardowns.splice(0)) {
      teardown();
    }
  }
}

function addAction(): HTMLAnchorElement {
  const icon = document.createElement('lc-icon');
  icon.setAttribute('name', 'plus');
  icon.setAttribute('aria-hidden', 'true');
  const add = document.createElement('a');
  add.className = 'cl-icon-button';
  add.href = href('/ingredients/new');
  add.setAttribute('aria-label', text('ingredients.new'));
  add.append(icon);
  return add;
}

function emptyView(): TemplateResult {
  const q = (route.query.value.get('q') ?? '').trim();
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
      <lc-button variant="primary" @click=${() => setQuery({ filter: null, category: null, page: null }, 'replace')}
        >${text('ingredients.clearFilters')}</lc-button
      >
    </lc-empty-state>`;
}

function pager(total: number): TemplateResult | typeof nothing {
  const pages = Math.ceil(total / PAGE_SIZE);
  return pages <= 1
    ? nothing
    : html`<nav class="cl-ingr-pager" aria-label=${text('ingredients.pages')}>
        <lc-pagination
          current=${idOf(route.query.value.get('page')) ?? 1}
          total=${pages}
          @change=${(event: Event) => {
            const page = eventPage(event);
            setQuery({ page: page !== null && page > 1 ? String(page) : null }, 'push');
          }}
        ></lc-pagination>
      </nav>`;
}

function filterQuery(patch: Record<string, string | null>): void {
  setQuery({ ...patch, page: null }, 'replace');
}

class IngredientTree extends View {
  readonly tree = apiResource('getIngredientTree', ['ingredients']);
  readonly list = apiResource('listIngredients', ['ingredients']);
  readonly treeState = loadState([this.tree]);
  readonly listState = loadState([this.list]);
  readonly busy = signal<ReadonlySet<number>>(new Set());
  readonly typed = signal(route.query.peek().get('q') ?? '');

  connected(): void {
    this.classList.add('cl-kit-screen', 'cl-ingr');
    this.tree.bind(this, {});
    this.bindResults();
    followTyping(this, this.typed);
    setAppBar({ actions: [addAction()] });
  }

  private bindResults(): void {
    const results = new BindScope();
    const following = effect(() => {
      const query = route.query.value;
      const q = (query.get('q') ?? '').trim();
      const filter = filterOf(query.get('filter'));
      const root = idOf(query.get('category'));
      const page = idOf(query.get('page')) ?? 1;
      untracked(() => {
        results.end();
        if (q === '' && filter === null) {
          return;
        }
        this.list.bind(results, {
          query: {
            ...(q === '' ? {} : { q }),
            ...(filter === 'on-hand' ? { onHand: 'true' } : {}),
            ...(filter === 'has-bottles' ? { hasBottles: 'true' } : {}),
            ...(filter === 'house-made' ? { houseMade: 'true' } : {}),
            ...(root === null ? {} : { root }),
            page,
            pageSize: PAGE_SIZE,
          },
        });
      });
    });
    this.$own(() => {
      following.dispose();
      results.end();
    });
  }

  private async toggle(row: Row): Promise<void> {
    this.busy.value = new Set(this.busy.peek()).add(row.id);
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
      dataChanged('ingredients', 'recipes', 'stats');
    } catch (error) {
      actionFailed(error, () => void this.toggle(row));
    } finally {
      const next = new Set(this.busy.peek());
      next.delete(row.id);
      this.busy.value = next;
    }
  }

  private toggleButton(row: Row): TemplateResult {
    const busy = this.busy.value.has(row.id);
    return html`<button
      type="button"
      class="cl-kit-toggle"
      aria-pressed=${row.onHand ? 'true' : 'false'}
      aria-busy=${busy ? 'true' : nothing}
      @click=${() => {
        if (!this.busy.peek().has(row.id)) {
          void this.toggle(row);
        }
      }}
    >
      <cl-bulb size="mini" status=${row.onHand ? 'on' : 'off'}></cl-bulb>
      <span class="cl-vh">${text('ingredients.toggleLabel', { name: row.name })}</span>
      <span>${row.onHand ? text('ingredients.onHand') : text('ingredients.notHere')}</span>
    </button>`;
  }

  private rowView(row: Row): TemplateResult {
    return row.depth === 0
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
          ${this.toggleButton(row)}
        </li>`;
  }

  private body(
    nodes: readonly IngredientNode[] | undefined,
    category: number | null,
    page: number,
    searching: boolean,
  ): TemplateResult | HTMLElement | typeof nothing | null {
    if (!searching) {
      const pending = waiting(this.treeState, text('nav.ingredients'), 'rows');
      if (pending !== null || nodes === undefined) {
        return pending;
      }
      const rows = subtree(nodes, category).map(treeRow);
      const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      return rows.length === 0
        ? emptyView()
        : html`<ul class="cl-kit-list cl-ingr-tree">${shown.map((row) => this.rowView(row))}</ul>
            ${pager(rows.length)}`;
    }
    const pending = waiting(this.listState, text('nav.ingredients'), 'rows');
    const found = this.list.value.value;
    if (pending !== null || found === undefined) {
      return pending;
    }
    return found.items.length === 0
      ? emptyView()
      : html`<ul class="cl-kit-list cl-ingr-tree">${found.items.map((item) => this.rowView(summaryRow(item)))}</ul>
          ${pager(found.total)}`;
  }

  render() {
    const query = route.query.value;
    const nodes = this.tree.value.value?.nodes;
    const filter = filterOf(query.get('filter'));
    const category = idOf(query.get('category'));
    const searching = (query.get('q') ?? '').trim() !== '' || filter !== null;
    const roots = nodes?.filter((node) => node.depth === 0) ?? [];
    const counts = chipCounts(nodes ?? []);
    const chip = (value: Filter, label: string, count: number): TemplateResult => html`<button
      type="button"
      class="cl-kit-chip"
      aria-pressed=${filter === value ? 'true' : 'false'}
      @click=${() => filterQuery({ filter: filter === value ? null : value })}
    >
      ${label}<span class="cl-kit-chip-count">${formatNumber(count)}</span>
    </button>`;
    return html`
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
          .value=${this.typed.value}
          @input=${(event: Event) => {
            this.typed.value = eventText(event);
          }}
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
            filterQuery({ category: value === '' ? null : value });
          }}
        ></lc-select>
        ${
          viewport.wide.value
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
      ${this.body(nodes, category, idOf(query.get('page')) ?? 1, searching)}
    `;
  }
}

View.register(tag, IngredientTree);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: IngredientTree;
  }
}
