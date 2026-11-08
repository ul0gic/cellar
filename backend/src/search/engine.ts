import {
  type BottleHit,
  type BottleStatus,
  foldName,
  type Id,
  type SearchGroup,
  type TaxonRef,
} from '@cellar/contract';
import type { ImageRow } from '../core/context.ts';
import type { Database } from '../core/db.ts';
import { closestTerm, maxDistance, type VocabTerm } from './fuzzy.ts';
import { IMAGE_COLUMNS, imageRowOrNull, num, numOrNull, type Row, str, strOrNull } from './rows.ts';

export interface RecipeMatch {
  readonly id: Id;
  readonly name: string;
  readonly image: ImageRow | null;
}

export interface IngredientMatch {
  readonly id: Id;
  readonly name: string;
  readonly parent: TaxonRef | null;
}

export interface SearchMatches {
  readonly query: string;
  readonly correctedQuery: string | null;
  readonly recipes: SearchGroup<RecipeMatch>;
  readonly ingredients: SearchGroup<IngredientMatch>;
  readonly bottles: SearchGroup<BottleHit>;
}

const WORD = /[\p{L}\p{N}]+/gu;
const FUZZY_BELOW_HITS = 3;
const NAME_WEIGHT = 10;

function matchExpression(words: readonly string[]): string {
  return words.map((word) => `"${word}"*`).join(' ');
}

function count(db: Database, table: string, match: string): number {
  const row = db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${table} MATCH ?`).get(match);
  return row === undefined ? 0 : num(row, 'n');
}

function bottleStatus(row: Row): BottleStatus {
  const status = str(row, 'status');
  if (status !== 'sealed' && status !== 'open' && status !== 'finished') {
    throw new Error(`bottles row has status ${status}`);
  }
  return status;
}

function parentRef(row: Row): TaxonRef | null {
  const id = numOrNull(row, 'parent_id');
  const name = strOrNull(row, 'parent_name');
  return id === null || name === null ? null : { id, name };
}

function recipeGroup(db: Database, match: string, limit: number): SearchGroup<RecipeMatch> {
  const rows = db
    .prepare(
      `SELECT r.id, r.name, ${IMAGE_COLUMNS}
       FROM recipes_fts f
       JOIN recipes r ON r.id = f.rowid
       LEFT JOIN images i ON i.id = (SELECT image_id FROM recipe_images WHERE recipe_id = r.id ORDER BY position LIMIT 1)
       WHERE recipes_fts MATCH ?
       ORDER BY bm25(recipes_fts, 0, ${NAME_WEIGHT}, 1, 1), r.id
       LIMIT ?`,
    )
    .all(match, limit);
  return {
    total: count(db, 'recipes_fts', match),
    items: rows.map((row) => ({ id: num(row, 'id'), name: str(row, 'name'), image: imageRowOrNull(row) })),
  };
}

function ingredientGroup(db: Database, match: string, limit: number): SearchGroup<IngredientMatch> {
  const rows = db
    .prepare(
      `SELECT i.id, i.name, p.id AS parent_id, p.name AS parent_name
       FROM ingredients_fts f
       JOIN ingredients i ON i.id = f.rowid
       LEFT JOIN ingredients p ON p.id = i.parent_id
       WHERE ingredients_fts MATCH ?
       ORDER BY bm25(ingredients_fts, 0, ${NAME_WEIGHT}, 1), i.id
       LIMIT ?`,
    )
    .all(match, limit);
  return {
    total: count(db, 'ingredients_fts', match),
    items: rows.map((row) => ({ id: num(row, 'id'), name: str(row, 'name'), parent: parentRef(row) })),
  };
}

function bottleGroup(db: Database, match: string, limit: number): SearchGroup<BottleHit> {
  const rows = db
    .prepare(
      `SELECT b.id, b.name, b.status, i.id AS ingredient_id, i.name AS ingredient_name
       FROM bottles_fts f
       JOIN bottles b ON b.id = f.rowid
       JOIN ingredients i ON i.id = b.ingredient_id
       WHERE bottles_fts MATCH ?
       ORDER BY bm25(bottles_fts, 0, ${NAME_WEIGHT}), b.id
       LIMIT ?`,
    )
    .all(match, limit);
  return {
    total: count(db, 'bottles_fts', match),
    items: rows.map((row) => ({
      id: num(row, 'id'),
      name: str(row, 'name'),
      ingredient: { id: num(row, 'ingredient_id'), name: str(row, 'ingredient_name') },
      status: bottleStatus(row),
    })),
  };
}

function vocabulary(db: Database, minLength: number, maxLength: number): VocabTerm[] {
  return db
    .prepare(
      `SELECT term, sum(doc) AS doc FROM (
         SELECT term, doc FROM recipes_fts_v
         UNION ALL SELECT term, doc FROM ingredients_fts_v
         UNION ALL SELECT term, doc FROM bottles_fts_v
       ) WHERE length(term) BETWEEN ? AND ? GROUP BY term`,
    )
    .all(minLength, maxLength)
    .map((row) => ({ term: str(row, 'term'), doc: num(row, 'doc') }));
}

interface Correction {
  readonly words: string[];
  readonly query: string;
}

function correct(db: Database, q: string): Correction | null {
  const words: string[] = [];
  const query = q.replace(WORD, (word) => {
    const folded = foldName(word);
    const limit = maxDistance(folded);
    if (limit === 0) {
      words.push(folded);
      return word;
    }
    const length = [...folded].length;
    const replacement = closestTerm(folded, vocabulary(db, length - limit, length + limit));
    if (replacement === null || replacement === folded) {
      words.push(folded);
      return word;
    }
    words.push(replacement);
    return replacement;
  });
  return query === q ? null : { words, query };
}

function wordsOf(q: string): string[] {
  return (q.match(WORD) ?? []).map(foldName);
}

function totalOf(result: SearchMatches): number {
  return result.recipes.total + result.ingredients.total + result.bottles.total;
}

function runAll(db: Database, query: string, words: readonly string[], perGroup: number): SearchMatches {
  const match = matchExpression(words);
  return {
    query,
    correctedQuery: null,
    recipes: recipeGroup(db, match, perGroup),
    ingredients: ingredientGroup(db, match, perGroup),
    bottles: bottleGroup(db, match, perGroup),
  };
}

export function searchAll(db: Database, q: string, perGroup: number): SearchMatches {
  const words = wordsOf(q);
  if (words.length === 0) {
    const empty = { total: 0, items: [] };
    return { query: q, correctedQuery: null, recipes: empty, ingredients: empty, bottles: empty };
  }
  const first = runAll(db, q, words, perGroup);
  if (totalOf(first) >= FUZZY_BELOW_HITS) {
    return first;
  }
  const correction = correct(db, q);
  if (correction === null) {
    return first;
  }
  const second = runAll(db, q, correction.words, perGroup);
  return totalOf(second) > totalOf(first) ? { ...second, correctedQuery: correction.query } : first;
}

function recipeIds(db: Database, words: readonly string[]): Id[] {
  return db
    .prepare(
      `SELECT rowid AS id FROM recipes_fts WHERE recipes_fts MATCH ? ORDER BY bm25(recipes_fts, 0, ${NAME_WEIGHT}, 1, 1), rowid`,
    )
    .all(matchExpression(words))
    .map((row) => num(row, 'id'));
}

export function searchRecipeIds(db: Database, q: string): Id[] {
  const words = wordsOf(q);
  if (words.length === 0) {
    return [];
  }
  const first = recipeIds(db, words);
  if (first.length >= FUZZY_BELOW_HITS) {
    return first;
  }
  const correction = correct(db, q);
  if (correction === null) {
    return first;
  }
  const second = recipeIds(db, correction.words);
  return second.length > first.length ? second : first;
}
