import { LIMITS, type OperationInput, type RatingValue, type RecipeFacets } from '@cellar/contract';
import type { QueryPatch, QuerySignal } from '../../../app/types.ts';

export const STATUSES = ['can-make', 'missing-1', 'missing-2', 'all', 'favorites', 'made'] as const;
export type Status = (typeof STATUSES)[number];
export const SORTS = ['relevance', 'rating', 'name', 'abv', 'added'] as const;
export type Sort = (typeof SORTS)[number];
export type View = 'cards' | 'list';

// D-1 §8.30: 48 cards or 100 list rows a page.
export const PAGE_SIZE: Readonly<Record<View, number>> = { cards: 48, list: 100 };
const RATING_MINIMUMS: readonly RatingValue[] = [3, 4, 4.5];
const VIEW_KEY = 'cellar.recipes.view';

export interface ListFilters {
  readonly glass: readonly string[];
  readonly method: readonly string[];
  readonly tag: readonly string[];
  readonly collection: string | null;
  readonly abvMin: string | null;
  readonly abvMax: string | null;
  readonly ratingMin: RatingValue | null;
}

export interface ListState {
  readonly q: string | null;
  readonly status: Status;
  readonly sort: Sort;
  readonly view: View;
  readonly page: number;
  readonly filters: ListFilters;
}

function rememberedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards';
  } catch (error) {
    if (error instanceof DOMException) {
      return 'cards';
    }
    throw error;
  }
}

export function rememberView(view: View): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch (error) {
    if (!(error instanceof DOMException)) {
      throw error;
    }
  }
}

function numberText(raw: string | null): string | null {
  return raw !== null && raw.trim() !== '' && Number.isFinite(Number(raw)) ? raw : null;
}

export function defaultStatus(q: string | null): Status {
  return q === null ? 'can-make' : 'all';
}

export function statusParam(status: Status, q: string | null): string | null {
  return status === defaultStatus(q) ? null : status;
}

export function defaultSort(q: string | null): Sort {
  return q === null ? 'rating' : 'relevance';
}

export function sortsFor(q: string | null): readonly Sort[] {
  return q === null ? SORTS.filter((sort) => sort !== 'relevance') : SORTS;
}

export function sortParam(sort: Sort, q: string | null): string | null {
  return sort === defaultSort(q) ? null : sort;
}

export function readState(query: QuerySignal): ListState {
  const typed = (query.get('q') ?? '').trim().slice(0, LIMITS.searchQuery.max);
  const q = typed === '' ? null : typed;
  const status = STATUSES.find((item) => item === query.get('status')) ?? defaultStatus(q);
  const sort = sortsFor(q).find((item) => item === query.get('sort')) ?? defaultSort(q);
  const viewParam = query.get('view');
  const page = Number(query.get('page'));
  const rating = Number(query.get('rating_min'));
  return {
    q,
    status,
    sort,
    view: viewParam === 'list' || viewParam === 'cards' ? viewParam : rememberedView(),
    page: Number.isInteger(page) && page > 1 ? page : 1,
    filters: {
      glass: query.getAll('glass'),
      method: query.getAll('method'),
      tag: query.getAll('tag'),
      collection: query.get('collection'),
      abvMin: numberText(query.get('abv_min')),
      abvMax: numberText(query.get('abv_max')),
      ratingMin: RATING_MINIMUMS.find((value) => value === rating) ?? null,
    },
  };
}

export const RATING_CHOICES = RATING_MINIMUMS;

export function filterCount(filters: ListFilters): number {
  return (
    filters.glass.length +
    filters.method.length +
    filters.tag.length +
    (filters.collection === null ? 0 : 1) +
    (filters.abvMin === null && filters.abvMax === null ? 0 : 1) +
    (filters.ratingMin === null ? 0 : 1)
  );
}

export function filtersPatch(filters: ListFilters): QueryPatch {
  return {
    glass: filters.glass,
    method: filters.method,
    tag: filters.tag,
    collection: filters.collection,
    abv_min: filters.abvMin,
    abv_max: filters.abvMax,
    rating_min: filters.ratingMin === null ? null : String(filters.ratingMin),
    page: null,
  };
}

export const NO_FILTERS: ListFilters = {
  glass: [],
  method: [],
  tag: [],
  collection: null,
  abvMin: null,
  abvMax: null,
  ratingMin: null,
};

function ids(values: readonly string[]): number[] {
  return values.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
}

export type ListQuery = NonNullable<OperationInput<'listRecipes'>['query']>;

export function apiQuery(state: ListState, pageSize: number = PAGE_SIZE[state.view]): ListQuery {
  const filters = state.filters;
  const collection = Number(filters.collection);
  return {
    ...(state.q === null ? {} : { q: state.q }),
    ...(state.status === 'can-make' ? { status: 'can_make' } : {}),
    ...(state.status === 'missing-1' ? { status: 'missing_1' } : {}),
    ...(state.status === 'missing-2' ? { status: 'missing_2' } : {}),
    ...(state.status === 'favorites' ? { favorites: 'true' } : {}),
    ...(state.status === 'made' ? { madeIt: 'true' } : {}),
    ...(filters.glass.length > 0 ? { glass: ids(filters.glass) } : {}),
    ...(filters.method.length > 0 ? { method: ids(filters.method) } : {}),
    ...(filters.tag.length > 0 ? { tag: ids(filters.tag) } : {}),
    ...(Number.isSafeInteger(collection) && collection > 0 ? { collection } : {}),
    ...(filters.abvMin === null ? {} : { abvMin: Number(filters.abvMin) }),
    ...(filters.abvMax === null ? {} : { abvMax: Number(filters.abvMax) }),
    ...(filters.ratingMin === null ? {} : { ratingMin: filters.ratingMin }),
    sort: state.sort,
    page: state.page,
    pageSize,
  };
}

export function figureFor(status: Status, facets: RecipeFacets, total: number): number {
  switch (status) {
    case 'can-make':
      return facets.canMake;
    case 'missing-1':
      return facets.missing1;
    case 'missing-2':
      return facets.missing2;
    case 'all':
      return facets.all;
    case 'favorites':
    case 'made':
      return total;
  }
}
