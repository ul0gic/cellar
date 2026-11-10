import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { call } from '../../../app/api.ts';
import { eventText } from '../../../app/events.ts';
import { actionFailed } from '../../../app/problems.ts';
import type { OverlayHost } from '../../../app/types.ts';
import { text } from '../../../text/index.ts';
import '../../../design-system/lc/button.ts';
import '../../../design-system/lc/input.ts';
import '../../../design-system/lc/segmented.ts';
import '../../../design-system/lc/select.ts';
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

export async function openFilterSheet(
  host: OverlayHost,
  state: ListState,
  apply: (result: FilterSheetResult) => void,
): Promise<void> {
  const [glasses, methods, tags, collections] = await Promise.all([
    call('listGlasses', {}),
    call('listMethods', {}),
    call('listTags', {}),
    call('listCollections', {}),
  ]);
  if (!host.isConnected) {
    return;
  }
  const asChoices = (items: readonly { id: number; name: string }[]): Choice[] =>
    items.map((item) => ({ id: String(item.id), name: item.name }));
  const glassChoices = asChoices(glasses.items);
  const methodChoices = asChoices(methods.items);
  const tagChoices = asChoices(tags.items);
  const filters = signal<ListFilters>(state.filters);
  const sort = signal<Sort>(state.sort);
  const tagSearch = signal('');
  const count = signal<number | null>(null);
  const counting = signal(0);

  const recount = async (): Promise<void> => {
    counting.value += 1;
    const run = counting.peek();
    const status: Status = state.status;
    const page = await call('listRecipes', {
      query: apiQuery({ ...state, status, filters: filters.peek(), sort: sort.peek(), page: 1 }, 1),
    });
    if (run === counting.peek()) {
      count.value = page.total;
    }
  };

  const change = (next: ListFilters): void => {
    filters.value = next;
    recount().catch((error: unknown) => actionFailed(error, () => void recount()));
  };

  const visibleTags = (): Choice[] =>
    tagChoices.filter(
      (tag) =>
        filters.value.tag.includes(tag.id) ||
        tagSearch.value === '' ||
        tag.name.toLowerCase().includes(tagSearch.value),
    );

  const sheet = openSheet(host, {
    heading: () => text('recipes.filters'),
    body: () => html`
      <lc-select
        label=${text('recipes.sortBy')}
        value=${sort.value}
        .options=${sortsFor(state.q).map((value) => ({ value, label: text(SORT_KEYS[value]) }))}
        @change=${(event: Event) => {
          sort.value = sortsFor(state.q).find((value) => value === eventText(event)) ?? sort.peek();
        }}
      ></lc-select>
      ${glassChoices.length === 0 ? nothing : chips(text('recipes.filterGlass'), glassChoices, filters.value.glass, (id) => change({ ...filters.peek(), glass: toggled(filters.peek().glass, id) }))}
      ${methodChoices.length === 0 ? nothing : chips(text('recipes.filterMethod'), methodChoices, filters.value.method, (id) => change({ ...filters.peek(), method: toggled(filters.peek().method, id) }))}
      <div class="cl-sheet-section">
        <span class="cl-sheet-label" aria-hidden="true">${text('recipes.filterRating')}</span>
        <lc-segmented
          label=${text('recipes.filterRating')}
          value=${filters.value.ratingMin === null ? 'any' : String(filters.value.ratingMin)}
          .options=${[
            { value: 'any', label: text('recipes.ratingAny') },
            ...RATING_CHOICES.map((value) => ({
              value: String(value),
              label: text('recipes.ratingAtLeast', { value }),
            })),
          ]}
          @change=${(event: Event) => {
            const picked = Number(eventText(event));
            change({ ...filters.peek(), ratingMin: RATING_CHOICES.find((value) => value === picked) ?? null });
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
            value=${filters.value.abvMin ?? ''}
            @change=${(event: Event) => change({ ...filters.peek(), abvMin: eventText(event).trim() || null })}
          ></lc-input>
          <lc-input
            label=${text('recipes.abvHighest')}
            type="number"
            min="0"
            max="100"
            value=${filters.value.abvMax ?? ''}
            @change=${(event: Event) => change({ ...filters.peek(), abvMax: eventText(event).trim() || null })}
          ></lc-input>
        </div>
      </fieldset>
      ${
        tagChoices.length === 0
          ? nothing
          : html`<lc-input
                label=${text('recipes.filterTags')}
                placeholder=${text('recipes.tagsPlaceholder')}
                value=${tagSearch.value}
                @input=${(event: Event) => {
                  tagSearch.value = eventText(event).trim().toLowerCase();
                }}
              ></lc-input>
              ${chips(text('recipes.filterTags'), visibleTags(), filters.value.tag, (id) => change({ ...filters.peek(), tag: toggled(filters.peek().tag, id) }))}`
      }
      <lc-select
        label=${text('recipes.filterCollection')}
        value=${filters.value.collection ?? ''}
        .options=${[
          { value: '', label: text('recipes.anyCollection') },
          ...collections.collections.map((collection) => ({ value: String(collection.id), label: collection.name })),
        ]}
        @change=${(event: Event) => change({ ...filters.peek(), collection: eventText(event) || null })}
      ></lc-select>
    `,
    footer: () => html`
      <lc-button variant="quiet" @click=${() => change(NO_FILTERS)}>${text('recipes.clear')}</lc-button>
      <lc-button
        variant="primary"
        @click=${() => {
          sheet.close();
          apply({ filters: filters.peek(), sort: sort.peek() });
        }}
      >${count.value === null ? text('recipes.showResults') : text(count.value === 1 ? 'recipes.showCountOne' : 'recipes.showCount', { count: count.value })}</lc-button>
    `,
  });
  recount().catch((error: unknown) => actionFailed(error, () => void recount()));
}
