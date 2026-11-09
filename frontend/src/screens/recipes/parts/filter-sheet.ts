import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { call } from '../../../app/api.ts';
import { eventText } from '../../../app/events.ts';
import { actionFailed } from '../../../app/problems.ts';
import { text } from '../../../text/index.ts';
import {
  apiQuery,
  type ListFilters,
  type ListState,
  NO_FILTERS,
  RATING_CHOICES,
  type Sort,
  sortsFor,
  type Status,
} from './list-query.ts';
import { openSheet } from './sheet.ts';

interface Choice {
  readonly id: string;
  readonly name: string;
}

export interface FilterSheetResult {
  readonly filters: ListFilters;
  readonly sort: Sort;
}

export const SORT_KEYS: Readonly<Record<Sort, `recipes.${string}`>> = {
  relevance: 'recipes.sortRelevance',
  rating: 'recipes.sortRating',
  name: 'recipes.sortName',
  abv: 'recipes.sortAbv',
  added: 'recipes.sortAdded',
};

function toggled(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

function chips(
  legend: string,
  choices: readonly Choice[],
  chosen: readonly string[],
  toggle: (id: string) => void,
): TemplateResult {
  return html`<fieldset class="cl-sheet-section">
    <legend class="cl-sheet-label">${legend}</legend>
    <div class="cl-sheet-chips">
      ${choices.map(
        (choice) => html`<lc-button
          size="sm"
          variant=${chosen.includes(choice.id) ? 'primary' : 'quiet'}
          aria-pressed=${chosen.includes(choice.id) ? 'true' : 'false'}
          @click=${() => toggle(choice.id)}
        >${choice.name}</lc-button>`,
      )}
    </div>
  </fieldset>`;
}

export async function openFilterSheet(state: ListState, apply: (result: FilterSheetResult) => void): Promise<void> {
  const [glasses, methods, tags, collections] = await Promise.all([
    call('listGlasses', {}),
    call('listMethods', {}),
    call('listTags', {}),
    call('listCollections', {}),
  ]);
  const asChoices = (items: readonly { id: number; name: string }[]): Choice[] =>
    items.map((item) => ({ id: String(item.id), name: item.name }));
  const glassChoices = asChoices(glasses.items);
  const methodChoices = asChoices(methods.items);
  const tagChoices = asChoices(tags.items);
  let filters: ListFilters = state.filters;
  let sort: Sort = state.sort;
  let tagSearch = '';
  let count: number | null = null;
  let counting = 0;

  const recount = async (): Promise<void> => {
    const run = ++counting;
    const status: Status = state.status;
    const page = await call('listRecipes', { query: apiQuery({ ...state, status, filters, sort, page: 1 }, 1) });
    if (run === counting) {
      count = page.total;
      sheet.redraw();
    }
  };

  const change = (next: ListFilters): void => {
    filters = next;
    sheet.redraw();
    recount().catch((error: unknown) => actionFailed(error, () => void recount()));
  };

  const visibleTags = (): Choice[] =>
    tagChoices.filter(
      (tag) => filters.tag.includes(tag.id) || tagSearch === '' || tag.name.toLowerCase().includes(tagSearch),
    );

  const sheet = openSheet({
    heading: () => text('recipes.filters'),
    body: () => html`
      <lc-select
        label=${text('recipes.sortBy')}
        value=${sort}
        .options=${sortsFor(state.q).map((value) => ({ value, label: text(SORT_KEYS[value]) }))}
        @change=${(event: Event) => {
          sort = sortsFor(state.q).find((value) => value === eventText(event)) ?? sort;
          sheet.redraw();
        }}
      ></lc-select>
      ${glassChoices.length === 0 ? nothing : chips(text('recipes.filterGlass'), glassChoices, filters.glass, (id) => change({ ...filters, glass: toggled(filters.glass, id) }))}
      ${methodChoices.length === 0 ? nothing : chips(text('recipes.filterMethod'), methodChoices, filters.method, (id) => change({ ...filters, method: toggled(filters.method, id) }))}
      <div class="cl-sheet-section">
        <span class="cl-sheet-label" aria-hidden="true">${text('recipes.filterRating')}</span>
        <lc-segmented
          label=${text('recipes.filterRating')}
          value=${filters.ratingMin === null ? 'any' : String(filters.ratingMin)}
          .options=${[
            { value: 'any', label: text('recipes.ratingAny') },
            ...RATING_CHOICES.map((value) => ({
              value: String(value),
              label: text('recipes.ratingAtLeast', { value }),
            })),
          ]}
          @change=${(event: Event) => {
            const picked = Number(eventText(event));
            change({ ...filters, ratingMin: RATING_CHOICES.find((value) => value === picked) ?? null });
          }}
        ></lc-segmented>
      </div>
      <fieldset class="cl-sheet-section">
        <legend class="cl-sheet-label">${text('recipes.filterAbv')}</legend>
        <div class="cl-filter-abv">
          <lc-input
            label=${text('recipes.abvLowest')}
            type="number"
            min="0"
            max="100"
            value=${filters.abvMin ?? ''}
            @change=${(event: Event) => change({ ...filters, abvMin: eventText(event).trim() || null })}
          ></lc-input>
          <lc-input
            label=${text('recipes.abvHighest')}
            type="number"
            min="0"
            max="100"
            value=${filters.abvMax ?? ''}
            @change=${(event: Event) => change({ ...filters, abvMax: eventText(event).trim() || null })}
          ></lc-input>
        </div>
      </fieldset>
      ${
        tagChoices.length === 0
          ? nothing
          : html`<lc-input
                label=${text('recipes.filterTags')}
                placeholder=${text('recipes.tagsPlaceholder')}
                value=${tagSearch}
                @input=${(event: Event) => {
                  tagSearch = eventText(event).trim().toLowerCase();
                  sheet.redraw();
                }}
              ></lc-input>
              ${chips(text('recipes.filterTags'), visibleTags(), filters.tag, (id) => change({ ...filters, tag: toggled(filters.tag, id) }))}`
      }
      <lc-select
        label=${text('recipes.filterCollection')}
        value=${filters.collection ?? ''}
        .options=${[
          { value: '', label: text('recipes.anyCollection') },
          ...collections.collections.map((collection) => ({ value: String(collection.id), label: collection.name })),
        ]}
        @change=${(event: Event) => change({ ...filters, collection: eventText(event) || null })}
      ></lc-select>
    `,
    footer: () => html`
      <lc-button variant="quiet" @click=${() => change(NO_FILTERS)}>${text('recipes.clear')}</lc-button>
      <lc-button
        variant="primary"
        @click=${() => {
          sheet.close();
          apply({ filters, sort });
        }}
      >${count === null ? text('recipes.showResults') : text(count === 1 ? 'recipes.showCountOne' : 'recipes.showCount', { count })}</lc-button>
    `,
  });
  recount().catch((error: unknown) => actionFailed(error, () => void recount()));
}
