import { type Id, LIMITS, type RecipeListQuery, type RecipePage } from '@cellar/contract';
import type { AppContext } from '../core/context.ts';
import { searchRecipeIds } from '../search/engine.ts';
import { recipeOutcomes } from '../shelf/satisfaction.ts';
import { num, text } from './rows.ts';
import { abvFigures, recipeSummaries } from './summaries.ts';
import { householdAverages } from './visibility.ts';

const STATUS_MISSING = { can_make: 0, missing_1: 1, missing_2: 2 } as const;

interface Candidate {
  readonly id: Id;
  readonly foldedName: string;
  readonly createdAt: string;
  readonly rank: number | null;
  missingCount: number;
  rating: number | null;
  abv: number | null;
}

function whereClauses(query: RecipeListQuery, viewer: Id): { sql: string; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  const anyOf = (column: string, ids: readonly Id[] | undefined): void => {
    if (ids !== undefined && ids.length > 0) {
      clauses.push(`${column} IN (SELECT value FROM json_each(?))`);
      params.push(JSON.stringify(ids));
    }
  };
  if (query.favorites === true) {
    clauses.push('EXISTS (SELECT 1 FROM favorites f WHERE f.recipe_id = r.id AND f.member_id = ?)');
    params.push(viewer);
  }
  if (query.madeIt === true) {
    clauses.push('EXISTS (SELECT 1 FROM made_it mi WHERE mi.recipe_id = r.id AND mi.member_id = ?)');
    params.push(viewer);
  }
  if (query.tag !== undefined && query.tag.length > 0) {
    clauses.push(
      'EXISTS (SELECT 1 FROM recipe_tags rt WHERE rt.recipe_id = r.id AND rt.tag_id IN (SELECT value FROM json_each(?)))',
    );
    params.push(JSON.stringify(query.tag));
  }
  anyOf('r.glass_id', query.glass);
  anyOf('r.method_id', query.method);
  if (query.collection !== undefined) {
    clauses.push('EXISTS (SELECT 1 FROM collection_recipes cr WHERE cr.recipe_id = r.id AND cr.collection_id = ?)');
    params.push(query.collection);
  }
  if (query.ingredient !== undefined) {
    clauses.push(`EXISTS (SELECT 1 FROM recipe_lines l LEFT JOIN recipe_line_substitutes s ON s.line_id = l.id
      WHERE l.recipe_id = r.id AND (l.ingredient_id = ? OR s.ingredient_id = ?))`);
    params.push(query.ingredient, query.ingredient);
  }
  if (query.provenance !== undefined) {
    clauses.push(query.provenance === 'catalog' ? 'r.catalog_key IS NOT NULL' : 'r.catalog_key IS NULL');
  }
  return { sql: clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`, params };
}

function compareNullsLast(a: number | null, b: number | null, direction: number): number {
  if (a === null || b === null) {
    return a === b ? 0 : a === null ? 1 : -1;
  }
  return (a - b) * direction;
}

export function listRecipes(ctx: AppContext, query: RecipeListQuery, viewer: Id): RecipePage {
  const db = ctx.db;
  const { sql, params } = whereClauses(query, viewer);
  const rows = db.prepare(`SELECT r.id, r.folded_name, r.created_at FROM recipes r ${sql}`).all(...params);
  const rank =
    query.q === undefined ? null : new Map(searchRecipeIds(db, query.q).map((id, index) => [id, index] as const));
  let candidates: Candidate[] = rows
    .map((row) => ({
      id: num(row, 'id'),
      foldedName: text(row, 'folded_name'),
      createdAt: text(row, 'created_at'),
      rank: rank?.get(num(row, 'id')) ?? null,
      missingCount: 0,
      rating: null,
      abv: null,
    }))
    .filter((candidate) => rank === null || candidate.rank !== null);

  const requested = query.sort ?? (rank === null ? 'name' : 'relevance');
  const sort = requested === 'relevance' && rank === null ? 'name' : requested;
  if (query.ratingMin !== undefined || sort === 'rating') {
    const averages = householdAverages(db, 'recipe');
    for (const candidate of candidates) {
      candidate.rating = averages.get(candidate.id) ?? null;
    }
    const ratingMin = query.ratingMin;
    if (ratingMin !== undefined) {
      candidates = candidates.filter((candidate) => candidate.rating !== null && candidate.rating >= ratingMin);
    }
  }
  if (query.abvMin !== undefined || query.abvMax !== undefined || sort === 'abv') {
    const figures = abvFigures(
      db,
      candidates.map((candidate) => candidate.id),
    );
    for (const candidate of candidates) {
      candidate.abv = figures.get(candidate.id)?.abv ?? null;
    }
    const { abvMin, abvMax } = query;
    if (abvMin !== undefined || abvMax !== undefined) {
      candidates = candidates.filter(
        (candidate) =>
          candidate.abv !== null &&
          (abvMin === undefined || candidate.abv >= abvMin) &&
          (abvMax === undefined || candidate.abv <= abvMax),
      );
    }
  }

  const outcomes = recipeOutcomes(db);
  const facets = { all: candidates.length, canMake: 0, missing1: 0, missing2: 0 };
  for (const candidate of candidates) {
    const outcome = outcomes.get(candidate.id);
    if (outcome === undefined) {
      throw new Error(`recipe ${candidate.id} has no outcome`);
    }
    candidate.missingCount = outcome.missingCount;
    if (candidate.missingCount === 0) {
      facets.canMake += 1;
    } else if (candidate.missingCount === 1) {
      facets.missing1 += 1;
    } else if (candidate.missingCount === 2) {
      facets.missing2 += 1;
    }
  }
  const status = query.status;
  if (status !== undefined) {
    candidates = candidates.filter((candidate) => candidate.missingCount === STATUS_MISSING[status]);
  }

  const direction = (query.order ?? (sort === 'name' ? 'asc' : 'desc')) === 'asc' ? 1 : -1;
  const byName = (a: Candidate, b: Candidate): number =>
    a.foldedName < b.foldedName ? -1 : a.foldedName > b.foldedName ? 1 : a.id - b.id;
  const comparators: Record<typeof sort, (a: Candidate, b: Candidate) => number> = {
    relevance: (a, b) => compareNullsLast(a.rank, b.rank, 1) || byName(a, b),
    name: (a, b) => byName(a, b) * direction,
    added: (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id) * direction,
    rating: (a, b) => compareNullsLast(a.rating, b.rating, direction) || byName(a, b),
    abv: (a, b) => compareNullsLast(a.abv, b.abv, direction) || byName(a, b),
  };
  candidates.sort(comparators[sort]);

  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? LIMITS.pageSize.default;
  const ids = candidates.slice((page - 1) * pageSize, page * pageSize).map((candidate) => candidate.id);
  return { items: recipeSummaries(ctx, ids, viewer), page, pageSize, total: candidates.length, facets };
}
