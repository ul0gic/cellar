import { type AbvLine, computeAbv, type Id, type RecipeSummary, recipeVolumeMl, type TaxonRef } from '@cellar/contract';
import type { AppContext } from '../core/context.ts';
import type { Database } from '../core/db.ts';
import { recipeOutcomes } from '../shelf/satisfaction.ts';
import { imageColumns, imageRefOrNull, num, numOrNull, text, textOrNull, imageRefsOf } from './rows.ts';
import { householdRating } from './visibility.ts';

const SUMMARY_TAGS = 3;

export interface AbvFigures {
  readonly abv: number | null;
  readonly volumeMl: number | null;
}

export function abvFigures(db: Database, ids: readonly Id[]): Map<Id, AbvFigures> {
  const rows = db
    .prepare(
      `SELECT l.recipe_id, l.amount, l.unit, l.optional, i.strength, COALESCE(m.dilution_percent, 0) AS dilution
       FROM recipe_lines l JOIN ingredients i ON i.id = l.ingredient_id JOIN recipes r ON r.id = l.recipe_id
       LEFT JOIN methods m ON m.id = r.method_id
       WHERE l.recipe_id IN (SELECT value FROM json_each(?)) ORDER BY l.recipe_id, l.position`,
    )
    .all(JSON.stringify(ids));
  const lines = new Map<Id, { dilution: number; lines: AbvLine[] }>();
  for (const row of rows) {
    const recipeId = num(row, 'recipe_id');
    const entry = lines.get(recipeId) ?? { dilution: num(row, 'dilution'), lines: [] };
    entry.lines.push({
      amountMl: textOrNull(row, 'unit') === 'ml' ? numOrNull(row, 'amount') : null,
      strength: num(row, 'strength'),
      optional: num(row, 'optional') === 1,
    });
    lines.set(recipeId, entry);
  }
  const figures = new Map<Id, AbvFigures>();
  for (const [recipeId, entry] of lines) {
    figures.set(recipeId, { abv: computeAbv(entry.lines, entry.dilution), volumeMl: recipeVolumeMl(entry.lines) });
  }
  return figures;
}

function tagsByRecipe(db: Database, ids: readonly Id[]): Map<Id, TaxonRef[]> {
  const rows = db
    .prepare(
      `SELECT rt.recipe_id, t.id, t.name FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id
       WHERE rt.recipe_id IN (SELECT value FROM json_each(?)) ORDER BY rt.recipe_id, t.folded_name, t.id`,
    )
    .all(JSON.stringify(ids));
  const byRecipe = new Map<Id, TaxonRef[]>();
  for (const row of rows) {
    const recipeId = num(row, 'recipe_id');
    const list = byRecipe.get(recipeId) ?? [];
    if (list.length < SUMMARY_TAGS) {
      list.push({ id: num(row, 'id'), name: text(row, 'name') });
    }
    byRecipe.set(recipeId, list);
  }
  return byRecipe;
}

export function recipeSummaries(ctx: AppContext, ids: readonly Id[], viewer: Id): RecipeSummary[] {
  if (ids.length === 0) {
    return [];
  }
  const db = ctx.db;
  const toImageRef = imageRefsOf(ctx);
  const json = JSON.stringify(ids);
  const rows = db
    .prepare(
      `SELECT r.id, r.name, r.catalog_key, r.created_at, g.id AS glass_id, g.name AS glass_name,
         EXISTS (SELECT 1 FROM favorites f WHERE f.recipe_id = r.id AND f.member_id = ?) AS favorite,
         ${imageColumns('im', 'cover')}
       FROM recipes r LEFT JOIN glasses g ON g.id = r.glass_id
       LEFT JOIN images im ON im.id = (SELECT ri.image_id FROM recipe_images ri WHERE ri.recipe_id = r.id
         ORDER BY ri.position LIMIT 1)
       WHERE r.id IN (SELECT value FROM json_each(?))`,
    )
    .all(viewer, json);
  const byId = new Map(rows.map((row) => [num(row, 'id'), row]));
  const outcomes = recipeOutcomes(db, { recipeIds: [...ids] });
  const tags = tagsByRecipe(db, ids);
  const figures = abvFigures(db, ids);
  return ids.flatMap((id): RecipeSummary[] => {
    const row = byId.get(id);
    const outcome = outcomes.get(id);
    if (row === undefined || outcome === undefined) {
      return [];
    }
    const glassId = numOrNull(row, 'glass_id');
    const rating = householdRating(db, { type: 'recipe', id }, viewer);
    return [
      {
        id,
        name: text(row, 'name'),
        image: imageRefOrNull(row, 'cover', toImageRef),
        provenance: textOrNull(row, 'catalog_key') === null ? 'household' : 'catalog',
        glass: glassId === null ? null : { id: glassId, name: text(row, 'glass_name') },
        tags: tags.get(id) ?? [],
        abv: figures.get(id)?.abv ?? null,
        canMake: outcome.canMake,
        missingCount: outcome.missingCount,
        mine: { favorite: num(row, 'favorite') === 1, rating: rating.mine },
        household: { rating: rating.household },
        createdAt: text(row, 'created_at'),
      },
    ];
  });
}
