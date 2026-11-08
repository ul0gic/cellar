import {
  type Id,
  type IngredientRef,
  type LineSubstitute,
  type Recipe,
  type RecipeLine,
  type RecipeRef,
  type TaxonRef,
  UNIT_IDS,
  type UnitId,
} from '@cellar/contract';
import type { AppContext } from '../core/context.ts';
import type { Database } from '../core/db.ts';
import { problem } from '../core/problems.ts';
import { onHandIngredientIds, recipeLineStatuses, recipeOutcomes } from '../shelf/satisfaction.ts';
import { madeItState } from './notes.ts';
import {
  imageColumns,
  imageRefOrNull,
  num,
  numOrNull,
  oneOf,
  type Row,
  text,
  textOrNull,
  type ToImageRef,
  imageRefsOf,
} from './rows.ts';
import { abvFigures } from './summaries.ts';
import { householdRating } from './visibility.ts';

function unitOf(row: Row, key: string): UnitId | null {
  return row[key] === null ? null : oneOf(row, key, UNIT_IDS);
}

function recipeRefs(db: Database, where: string, param: Id, toImageRef: ToImageRef): RecipeRef[] {
  return db
    .prepare(
      `SELECT r.id, r.name, ${imageColumns('im', 'cover')} FROM recipes r
       LEFT JOIN images im ON im.id = (SELECT ri.image_id FROM recipe_images ri WHERE ri.recipe_id = r.id
         ORDER BY ri.position LIMIT 1)
       WHERE ${where} ORDER BY r.folded_name, r.id`,
    )
    .all(param)
    .map((row) => ({ id: num(row, 'id'), name: text(row, 'name'), image: imageRefOrNull(row, 'cover', toImageRef) }));
}

function taxonRefs(db: Database, sql: string, id: Id): TaxonRef[] {
  return db
    .prepare(sql)
    .all(id)
    .map((row) => ({ id: num(row, 'id'), name: text(row, 'name') }));
}

function linesOf(db: Database, recipeId: Id): RecipeLine[] {
  const onHand = onHandIngredientIds(db);
  const names = new Map<Id, string>();
  const ingredientRef = (id: Id): IngredientRef => {
    let name = names.get(id);
    if (name === undefined) {
      const row = db.prepare('SELECT name FROM ingredients WHERE id = ?').get(id);
      if (row === undefined) {
        throw new Error(`ingredient ${id} is referenced but has no row`);
      }
      name = text(row, 'name');
      names.set(id, name);
    }
    return { id, name, onHand: onHand.has(id) };
  };
  const substitutes = new Map<Id, LineSubstitute[]>();
  const substituteRows = db
    .prepare(
      `SELECT s.line_id, s.ingredient_id, s.amount, s.amount_max, s.unit FROM recipe_line_substitutes s
       JOIN recipe_lines l ON l.id = s.line_id WHERE l.recipe_id = ? ORDER BY s.line_id, s.position`,
    )
    .all(recipeId);
  for (const row of substituteRows) {
    const lineId = num(row, 'line_id');
    const list = substitutes.get(lineId) ?? [];
    list.push({
      ingredient: ingredientRef(num(row, 'ingredient_id')),
      amount: numOrNull(row, 'amount'),
      amountMax: numOrNull(row, 'amount_max'),
      unit: unitOf(row, 'unit'),
    });
    substitutes.set(lineId, list);
  }
  const statuses = new Map(recipeLineStatuses(db, recipeId).map((status) => [status.lineId, status]));
  return db
    .prepare(
      `SELECT id, position, ingredient_id, amount, amount_max, unit, optional, specified, note
       FROM recipe_lines WHERE recipe_id = ? ORDER BY position`,
    )
    .all(recipeId)
    .map((row) => {
      const id = num(row, 'id');
      const status = statuses.get(id);
      if (status === undefined) {
        throw new Error(`line ${id} has no status`);
      }
      return {
        id,
        position: num(row, 'position'),
        ingredient: ingredientRef(num(row, 'ingredient_id')),
        amount: numOrNull(row, 'amount'),
        amountMax: numOrNull(row, 'amount_max'),
        unit: unitOf(row, 'unit'),
        optional: num(row, 'optional') === 1,
        specified: num(row, 'specified') === 1,
        note: text(row, 'note'),
        substitutes: substitutes.get(id) ?? [],
        status: status.status,
        satisfiedBy: status.satisfiedBy === null ? null : ingredientRef(status.satisfiedBy),
        substitutionEffect: status.substitutionEffect,
      };
    });
}

export function recipePage(ctx: AppContext, id: Id, viewer: Id): Recipe {
  const db = ctx.db;
  const toImageRef = imageRefsOf(ctx);
  const row = db
    .prepare(
      `SELECT r.*, g.name AS glass_name, m.name AS method_name, m.dilution_percent,
         EXISTS (SELECT 1 FROM favorites f WHERE f.recipe_id = r.id AND f.member_id = ?) AS favorite
       FROM recipes r LEFT JOIN glasses g ON g.id = r.glass_id LEFT JOIN methods m ON m.id = r.method_id
       WHERE r.id = ?`,
    )
    .get(viewer, id);
  if (row === undefined) {
    throw problem('not_found');
  }
  const glassId = numOrNull(row, 'glass_id');
  const methodId = numOrNull(row, 'method_id');
  const parentId = numOrNull(row, 'parent_recipe_id');
  const catalogKey = textOrNull(row, 'catalog_key');
  const outcome = recipeOutcomes(db, { recipeIds: [id] }).get(id);
  if (outcome === undefined) {
    throw new Error(`recipe ${id} has no outcome`);
  }
  const figures = abvFigures(db, [id]).get(id);
  const rating = householdRating(db, { type: 'recipe', id }, viewer);
  const madeIt = madeItState(db, id, viewer, null);
  const images = db
    .prepare(
      `SELECT ${imageColumns('im', 'image')} FROM recipe_images ri JOIN images im ON im.id = ri.image_id
       WHERE ri.recipe_id = ? ORDER BY ri.position`,
    )
    .all(id)
    .flatMap((imageRow) => {
      const ref = imageRefOrNull(imageRow, 'image', toImageRef);
      return ref === null ? [] : [ref];
    });
  return {
    id,
    name: text(row, 'name'),
    provenance: catalogKey === null ? 'household' : 'catalog',
    editedFromCatalog: catalogKey !== null && textOrNull(row, 'edited_at') !== null,
    description: text(row, 'description'),
    instructions: text(row, 'instructions'),
    garnish: text(row, 'garnish'),
    source: text(row, 'source'),
    year: numOrNull(row, 'year'),
    images,
    glass: glassId === null ? null : { id: glassId, name: text(row, 'glass_name') },
    method:
      methodId === null
        ? null
        : { id: methodId, name: text(row, 'method_name'), dilutionPercent: num(row, 'dilution_percent') },
    utensils: taxonRefs(
      db,
      `SELECT u.id, u.name FROM recipe_utensils ru JOIN utensils u ON u.id = ru.utensil_id
       WHERE ru.recipe_id = ? ORDER BY u.folded_name, u.id`,
      id,
    ),
    tags: taxonRefs(
      db,
      `SELECT t.id, t.name FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id
       WHERE rt.recipe_id = ? ORDER BY t.folded_name, t.id`,
      id,
    ),
    lines: linesOf(db, id),
    abv: figures?.abv ?? null,
    volumeMl: figures?.volumeMl ?? null,
    parent: parentId === null ? null : (recipeRefs(db, 'r.id = ?', parentId, toImageRef)[0] ?? null),
    variants: recipeRefs(db, 'r.parent_recipe_id = ?', id, toImageRef),
    canMake: outcome.canMake,
    missingCount: outcome.missingCount,
    collections: taxonRefs(
      db,
      `SELECT c.id, c.name FROM collection_recipes cr JOIN collections c ON c.id = cr.collection_id
       WHERE cr.recipe_id = ? ORDER BY c.name COLLATE NOCASE, c.id`,
      id,
    ),
    mine: { favorite: num(row, 'favorite') === 1, rating: rating.mine, madeCount: madeIt.mine.count },
    household: { rating: rating.household, madeCount: madeIt.household.count, lastMadeAt: madeIt.household.lastMadeAt },
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}
