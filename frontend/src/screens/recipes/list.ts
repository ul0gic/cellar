import type { RecipePage, RecipeSummary } from '@cellar/contract';
import type { DropdownItem, TableColumn, TableRow } from '@lightstart/components/types.js';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { effect, signal } from '@lightstart/light/signals';
import { call } from '../../app/api.ts';
import { route } from '../../app/controllers/route.ts';
import { session } from '../../app/controllers/session.ts';
import { viewport } from '../../app/controllers/viewport.ts';
import { eventText } from '../../app/events.ts';
import { loadState } from '../../app/load.ts';
import { actionFailed } from '../../app/problems.ts';
import { apiResource, dataChanged } from '../../app/resources.ts';
import { href, navigate, setQuery } from '../../app/router.ts';
import { plateForGlass } from '../../design-system/cl-plate.ts';
import { illustration } from '../../design-system/illustration.ts';
import { skeleton } from '../../design-system/skeleton.ts';
import { text } from '../../text/index.ts';
import { openActions } from './parts/actions.ts';
import { openFilterSheet, SORT_KEYS } from './parts/filter-sheet.ts';
import {
  apiQuery,
  figureFor,
  filterCount,
  filtersPatch,
  type ListState,
  NO_FILTERS,
  readState,
  rememberView,
  STATUSES,
  sortParam,
  statusParam,
  sortsFor,
  type Status,
  type View as ListView,
} from './parts/list-query.ts';
import { segmentsOf } from './parts/segments.ts';
import '../../design-system/cl-figure.ts';
import '../../design-system/cl-have-bar.ts';
import '../../design-system/cl-recipe-card.ts';
import '../../design-system/cl-recipe-row.ts';
import '../../design-system/lc/alert.ts';
import '../../design-system/lc/badge.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/empty-state.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/image.ts';
import '../../design-system/lc/pagination.ts';
import '../../design-system/lc/segmented.ts';
import '../../design-system/lc/table.ts';
import '../../design-system/lc/tag.ts';
import './list.css';

export const tag = 'cl-screen-recipes-list';

const STATUS_LABEL: Readonly<Record<Status, `recipes.${string}`>> = {
  'can-make': 'recipes.statusCanMake',
  'missing-1': 'recipes.statusMissing1',
  'missing-2': 'recipes.statusMissing2',
  all: 'recipes.statusAll',
  favorites: 'recipes.statusFavorites',
  made: 'recipes.statusMade',
};

function chipCount(status: Status, page: RecipePage): number | null {
  switch (status) {
    case 'can-make':
      return page.facets.canMake;
    case 'missing-1':
      return page.facets.missing1;
    case 'missing-2':
      return page.facets.missing2;
    case 'all':
      return page.facets.all;
    case 'favorites':
    case 'made':
      return null;
  }
}

function figureLabels(state: ListState, page: RecipePage): { label: string; sublabel: string } {
  const all = page.facets.all;
  switch (state.status) {
    case 'can-make':
      return {
        label: text('recipes.figureCanMake', { all }),
        sublabel: text('recipes.figureCanMakeSub', { sort: text(`recipes.sortPhrase.${state.sort}`) }),
      };
    case 'missing-1':
      return { label: text('recipes.figureMissing1'), sublabel: text('recipes.figureMissing1Sub') };
    case 'missing-2':
      return { label: text('recipes.figureMissing2'), sublabel: '' };
    case 'all':
      return {
        label: text('recipes.figureAll'),
        sublabel: text('recipes.figureAllSub', { canMake: page.facets.canMake, missing1: page.facets.missing1 }),
      };
    case 'favorites':
      return { label: text('recipes.figureFavorites'), sublabel: '' };
    case 'made':
      return { label: text('recipes.figureMade'), sublabel: '' };
  }
}

function nameOf(items: readonly { id: number; name: string }[] | undefined, id: string): string {
  return items?.find((item) => String(item.id) === id)?.name ?? '';
}

function tableColumns(): TableColumn[] {
  return [
    { name: 'photo', label: '' },
    { name: 'recipe', label: text('recipes.colRecipe') },
    { name: 'have', label: text('recipes.colHave') },
    { name: 'abv', label: text('recipes.colAbv'), align: 'right' },
    { name: 'rating', label: text('recipes.colRating'), align: 'right' },
    { name: 'made', label: text('recipes.colMade'), align: 'right' },
    { name: 'favorite', label: '' },
  ];
}

function setView(view: ListView): void {
  rememberView(view);
  setQuery({ view, page: null }, 'replace');
}

function clearQuery(): void {
  setQuery({ q: null, page: null }, 'replace');
}

function clearAll(): void {
  setQuery({ ...filtersPatch(NO_FILTERS), q: null }, 'replace');
}

function newItems(): DropdownItem[] {
  return [
    { label: text('recipes.writeIt'), icon: 'pencil', onClick: () => navigate('/recipes/new') },
    { label: text('recipes.fromWebPage'), icon: 'external-link', onClick: () => navigate('/import/url') },
    ...(session.current.peek()?.household.aiEnabled === true
      ? [
          {
            label: text('recipes.describeIt'),
            icon: 'sparkles',
            onClick: () => navigate('/recipes/new', { state: { describe: true } }),
          },
        ]
      : []),
  ];
}

function sortItems(state: ListState): DropdownItem[] {
  return sortsFor(state.q).map((sort) => ({
    label: text(SORT_KEYS[sort]),
    checked: sort === state.sort,
    onClick: () => setQuery({ sort: sortParam(sort, state.q), page: null }, 'replace'),
  }));
}

function emptyState(state: ListState, page: RecipePage): TemplateResult {
  const filtered = filterCount(state.filters) > 0 || state.q !== null;
  if (filtered) {
    return html`<lc-empty-state title=${text('recipes.noMatchTitle')} description=${text('recipes.noMatchBody')}>
        ${illustration('empty-glass')}
        <lc-button variant="primary" @click=${clearAll}>${text('recipes.clearFilters')}</lc-button>
        <lc-button variant="quiet" href=${href('/recipes?status=all')}>${text('recipes.searchAll', { count: page.facets.all })}</lc-button>
      </lc-empty-state>`;
  }
  switch (state.status) {
    case 'favorites':
      return html`<lc-empty-state title=${text('recipes.noFavoritesTitle')} description=${text('recipes.noFavoritesBody')}>
          ${illustration('empty-glass')}
        </lc-empty-state>`;
    case 'made':
      return html`<lc-empty-state title=${text('recipes.noMadeTitle')} description=${text('recipes.noMadeBody')}>
          ${illustration('empty-glass')}
        </lc-empty-state>`;
    case 'can-make':
      return html`<lc-empty-state title=${text('recipes.emptyShelfTitle')} description=${text('recipes.emptyShelfBody')}>
          ${illustration('empty-shelf')}
          <lc-button variant="primary" href=${href('/shelf')}>${text('recipes.addBottles')}</lc-button>
          <lc-button variant="quiet" href=${href('/recipes?status=all')}>${text('recipes.seeAll', { count: page.facets.all })}</lc-button>
        </lc-empty-state>`;
    default:
      return html`<lc-empty-state title=${text('recipes.noMatchTitle')} description=${text('recipes.noneInStatus')}>
          ${illustration('empty-glass')}
          <lc-button variant="quiet" href=${href('/recipes?status=all')}>${text('recipes.seeAll', { count: page.facets.all })}</lc-button>
        </lc-empty-state>`;
  }
}

function pager(page: RecipePage): TemplateResult | typeof nothing {
  const pages = Math.ceil(page.total / page.pageSize);
  if (pages <= 1) {
    return nothing;
  }
  const first = (page.page - 1) * page.pageSize + 1;
  const last = Math.min(page.page * page.pageSize, page.total);
  return html`<div class="cl-recipes-pager">
      <lc-pagination
        .current=${page.page}
        .total=${pages}
        @change=${(event: Event) => {
          const next = event instanceof CustomEvent && typeof event.detail?.page === 'number' ? event.detail.page : 1;
          setQuery({ page: next === 1 ? null : String(next) }, 'push');
        }}
      ></lc-pagination>
      <p class="cl-recipes-muted">${text('recipes.range', { first, last, total: page.total })}</p>
    </div>`;
}

class RecipesList extends View {
  readonly recipes = apiResource('listRecipes', ['recipes', 'shelf']);
  readonly glasses = apiResource('listGlasses', ['settings']);
  readonly methods = apiResource('listMethods', ['settings']);
  readonly tags = apiResource('listTags', ['settings']);
  readonly collections = apiResource('listCollections', ['collections']);
  readonly load = loadState([this.recipes]);
  readonly lastPage = signal<RecipePage | undefined>(undefined);

  connected(): void {
    this.classList.add('cl-recipes');
    this.recipes.bind(this, () => ({ query: apiQuery(readState(route.query.value)) }));
    this.glasses.bind(this, {});
    this.methods.bind(this, {});
    this.tags.bind(this, {});
    this.collections.bind(this, {});
    const remember = effect(() => {
      const current = this.recipes.value.value;
      if (current !== undefined && current !== this.lastPage.peek()) {
        this.lastPage.value = current;
      }
    });
    this.$own(() => remember.dispose());
  }

  async toggleFavorite(recipe: RecipeSummary): Promise<void> {
    try {
      await (recipe.mine.favorite
        ? call('unfavoriteRecipe', { params: { id: recipe.id } })
        : call('favoriteRecipe', { params: { id: recipe.id } }));
      dataChanged('recipes');
    } catch (error) {
      actionFailed(error, () => void this.toggleFavorite(recipe));
    }
  }

  filters(state: ListState): void {
    openFilterSheet(this, state, (result) =>
      setQuery({ ...filtersPatch(result.filters), sort: sortParam(result.sort, state.q) }, 'push'),
    ).catch((error: unknown) => actionFailed(error, () => this.filters(state)));
  }

  activeTags(state: ListState): TemplateResult | typeof nothing {
    if (filterCount(state.filters) === 0 && state.q === null) {
      return nothing;
    }
    const f = state.filters;
    const chips: { label: string; remove: () => void }[] = [];
    const drop = (patch: Partial<typeof f>): void => setQuery(filtersPatch({ ...f, ...patch }), 'replace');
    if (state.q !== null) {
      chips.push({ label: text('recipes.tagQuery', { query: state.q }), remove: clearQuery });
    }
    for (const id of f.glass) {
      chips.push({
        label: nameOf(this.glasses.value.value?.items, id),
        remove: () => drop({ glass: f.glass.filter((item) => item !== id) }),
      });
    }
    for (const id of f.method) {
      chips.push({
        label: nameOf(this.methods.value.value?.items, id),
        remove: () => drop({ method: f.method.filter((item) => item !== id) }),
      });
    }
    for (const id of f.tag) {
      chips.push({
        label: nameOf(this.tags.value.value?.items, id),
        remove: () => drop({ tag: f.tag.filter((item) => item !== id) }),
      });
    }
    if (f.collection !== null) {
      chips.push({
        label: nameOf(this.collections.value.value?.collections, f.collection),
        remove: () => drop({ collection: null }),
      });
    }
    if (f.abvMin !== null || f.abvMax !== null) {
      chips.push({
        label: text('recipes.tagAbv', { low: f.abvMin ?? '0', high: f.abvMax ?? '100' }),
        remove: () => drop({ abvMin: null, abvMax: null }),
      });
    }
    if (f.ratingMin !== null) {
      chips.push({
        label: text('recipes.ratingAtLeast', { value: f.ratingMin }),
        remove: () => drop({ ratingMin: null }),
      });
    }
    return html`<div class="cl-recipes-active" aria-label=${text('recipes.activeFilters')}>
      ${chips.map(
        (
          chip,
        ) => html`<lc-tag closable aria-label=${text('recipes.removeFilter', { name: chip.label })} @close=${chip.remove}
          >${chip.label}</lc-tag
        >`,
      )}
      <lc-button variant="ghost" size="sm" @click=${clearAll}
        >${text('recipes.clearAll')}</lc-button
      >
    </div>`;
  }

  head(state: ListState, page: RecipePage | undefined): TemplateResult {
    const count = filterCount(state.filters);
    const labels = page === undefined ? { label: '', sublabel: '' } : figureLabels(state, page);
    return html`<header class="cl-recipes-head">
      <h1 class="cl-vh">${text('nav.recipes')}</h1>
      <cl-figure
        .value=${page === undefined ? 0 : figureFor(state.status, page.facets, page.total)}
        label=${labels.label}
        sublabel=${labels.sublabel}
      ></cl-figure>
      <div class="cl-recipes-actions">
        <lc-segmented
          label=${text('recipes.view')}
          value=${state.view}
          .options=${[
            { value: 'cards', label: text('recipes.cards'), icon: 'layout-grid' },
            { value: 'list', label: text('recipes.list'), icon: 'list' },
          ]}
          @change=${(event: Event) => setView(eventText(event) === 'list' ? 'list' : 'cards')}
        ></lc-segmented>
        <lc-button variant="quiet" @click=${() => this.filters(state)}>
          <lc-icon name="sliders-horizontal" aria-hidden="true"></lc-icon>${text('recipes.filters')}
          ${count === 0 ? nothing : html`<lc-badge>${count}</lc-badge>`}
        </lc-button>
        ${
          viewport.wide.value
            ? html`<lc-button
                variant="quiet"
                aria-haspopup="menu"
                @click=${(event: MouseEvent) => {
                  if (event.currentTarget instanceof Element) {
                    openActions(this, event.currentTarget, text('recipes.sortBy'), sortItems(state));
                  }
                }}
              ><lc-icon name="arrow-up-down" aria-hidden="true"></lc-icon>${text(SORT_KEYS[state.sort])}</lc-button>`
            : nothing
        }
        <lc-button
          variant="primary"
          aria-haspopup="menu"
          @click=${(event: MouseEvent) => {
            if (event.currentTarget instanceof Element) {
              openActions(this, event.currentTarget, text('recipes.newRecipe'), newItems());
            }
          }}
        ><lc-icon name="plus" aria-hidden="true"></lc-icon>${text('recipes.newRecipe')}</lc-button>
      </div>
    </header>
    <div class="cl-recipes-chips" role="group" aria-label=${text('recipes.status')}>
      ${STATUSES.map((status) => {
        const chip = page === undefined ? null : chipCount(status, page);
        return html`<lc-button
          size="sm"
          variant=${status === state.status ? 'primary' : 'quiet'}
          aria-pressed=${status === state.status ? 'true' : 'false'}
          @click=${() => setQuery({ status: statusParam(status, state.q), page: null }, 'push')}
        >${text(STATUS_LABEL[status])}${chip === null ? nothing : html` <span class="cl-recipes-chip-count">${chip}</span>`}</lc-button>`;
      })}
    </div>
    ${this.activeTags(state)}`;
  }

  tableRows(items: readonly RecipeSummary[]): TableRow[] {
    return items.map((recipe) => {
      const segments = segmentsOf(recipe);
      return {
        photo:
          recipe.image === null
            ? html`<cl-plate class="cl-recipes-thumb" small kind=${plateForGlass(recipe.glass?.name ?? null)} name=${recipe.name}></cl-plate>`
            : html`<lc-image class="cl-recipes-thumb" src=${recipe.image.url} alt=""></lc-image>`,
        recipe: html`<a class="cl-recipes-name" href=${href(`/recipes/${recipe.id}`)}>${recipe.name}</a>
          <span class="cl-recipes-muted">${recipe.ingredients.join(', ')}</span>`,
        have: html`<cl-have-bar stacked .segments=${segments}></cl-have-bar>`,
        abv: recipe.abv === null ? '' : `${recipe.abv.toFixed(1)}%`,
        rating: recipe.household.rating.average === null ? '' : recipe.household.rating.average.toFixed(1),
        made: String(recipe.mine.madeCount),
        favorite: html`<button
          type="button"
          class="cl-recipes-fav"
          aria-pressed=${recipe.mine.favorite ? 'true' : 'false'}
          aria-label=${text('card.favorite', { name: recipe.name })}
          @click=${() => void this.toggleFavorite(recipe)}
        ><lc-icon name="heart" ?solid=${recipe.mine.favorite} aria-hidden="true"></lc-icon></button>`,
      };
    });
  }

  results(state: ListState, page: RecipePage): TemplateResult {
    if (state.view === 'cards') {
      return html`<ul class="cl-recipes-grid">
        ${page.items.map(
          (recipe) => html`<li>
            <cl-recipe-card
              href=${`/recipes/${recipe.id}`}
              name=${recipe.name}
              summary=${recipe.ingredients.join(', ')}
              .image=${recipe.image}
              .glass=${recipe.glass?.name ?? null}
              .segments=${segmentsOf(recipe)}
              .rating=${recipe.household.rating.average}
              .madeCount=${recipe.mine.madeCount === 0 ? null : recipe.mine.madeCount}
              ?favorite=${recipe.mine.favorite}
              @favorite-toggle=${() => void this.toggleFavorite(recipe)}
            ></cl-recipe-card>
          </li>`,
        )}
      </ul>`;
    }
    if (viewport.wide.value) {
      return html`<lc-table class="cl-recipes-table" .columns=${tableColumns()} .rows=${this.tableRows(page.items)}></lc-table>`;
    }
    return html`<ul class="cl-recipes-rows">
      ${page.items.map(
        (recipe) => html`<li>
          <cl-recipe-row
            href=${`/recipes/${recipe.id}`}
            name=${recipe.name}
            .image=${recipe.image}
            .glass=${recipe.glass?.name ?? null}
            .segments=${segmentsOf(recipe)}
            .rating=${recipe.household.rating.average}
          ></cl-recipe-row>
        </li>`,
      )}
    </ul>`;
  }

  render() {
    const state = readState(route.query.value);
    const phase = this.load.phase.value;
    const current = this.recipes.value.value;
    let body: TemplateResult | HTMLElement | typeof nothing = nothing;
    if (current !== undefined) {
      body =
        current.items.length === 0
          ? emptyState(state, current)
          : html`${this.results(state, current)} ${pager(current)}`;
    } else if (phase === 'failed') {
      body = html`<lc-alert variant="error" icon="circle-alert" title=${text('recipes.listFailedTitle')}>
        <p>${text('recipes.listFailedBody')}</p>
        <div class="cl-banner-actions">
          <lc-button size="sm" @click=${() => this.load.retry()}>${text('loadFailed.retry')}</lc-button>
        </div>
      </lc-alert>`;
    } else if (phase === 'slow') {
      body = skeleton(state.view === 'cards' ? 'cards' : 'rows', text('nav.recipes'));
    }
    return html`${this.head(state, current ?? this.lastPage.peek())} <div class="cl-recipes-body" aria-busy=${current === undefined ? 'true' : 'false'}>${body}</div>`;
  }
}

View.register(tag, RecipesList);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: RecipesList;
  }
}
