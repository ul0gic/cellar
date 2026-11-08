import {
  type FieldError,
  type Id,
  type PartyInput,
  type PartyLine,
  type PartyResult,
  UNIT_IDS,
  type UnitId,
} from '@cellar/contract';
import type { AppContext } from '../core/context.ts';
import { problem } from '../core/problems.ts';
import { onHandIngredientIds, recipeLineStatuses } from '../shelf/satisfaction.ts';
import { imageRefsOf, imageColumns, imageRefOrNull, num, numOrNull, oneOf, text } from './rows.ts';

interface Total {
  readonly ingredientId: Id;
  readonly name: string;
  volumeMl: number | null;
  readonly counts: Map<UnitId | null, number>;
  satisfied: boolean;
  optionalOnly: boolean;
  readonly recipes: Set<Id>;
}

export function calculateParty(ctx: AppContext, input: PartyInput): PartyResult {
  const db = ctx.db;
  const toImageRef = imageRefsOf(ctx);
  const recipeRow = db.prepare(
    `SELECT r.id, r.name, ${imageColumns('im', 'cover')} FROM recipes r
     LEFT JOIN images im ON im.id = (SELECT ri.image_id FROM recipe_images ri WHERE ri.recipe_id = r.id
       ORDER BY ri.position LIMIT 1)
     WHERE r.id = ?`,
  );
  const fields: FieldError[] = [];
  const recipes = input.recipes.flatMap((entry, index) => {
    const row = recipeRow.get(entry.recipeId);
    if (row === undefined) {
      fields.push({ path: `recipes.${index}.recipeId`, code: 'not_found', message: 'This recipe no longer exists.' });
      return [];
    }
    const recipe = { id: entry.recipeId, name: text(row, 'name'), image: imageRefOrNull(row, 'cover', toImageRef) };
    return [{ recipe, servings: entry.servings }];
  });
  if (fields.length > 0) {
    throw problem('validation_failed', { fields });
  }

  const lineRows = db.prepare(
    `SELECT l.id, l.ingredient_id, l.amount, l.unit, l.optional, i.name FROM recipe_lines l
     JOIN ingredients i ON i.id = l.ingredient_id WHERE l.recipe_id = ? ORDER BY l.position`,
  );
  const totals = new Map<Id, Total>();
  for (const { recipe, servings } of recipes) {
    const statuses = new Map(recipeLineStatuses(db, recipe.id).map((status) => [status.lineId, status.status]));
    for (const row of lineRows.all(recipe.id)) {
      const ingredientId = num(row, 'ingredient_id');
      const total = totals.get(ingredientId) ?? {
        ingredientId,
        name: text(row, 'name'),
        volumeMl: null,
        counts: new Map<UnitId | null, number>(),
        satisfied: true,
        optionalOnly: true,
        recipes: new Set<Id>(),
      };
      totals.set(ingredientId, total);
      total.recipes.add(recipe.id);
      if (num(row, 'optional') === 0) {
        total.optionalOnly = false;
      }
      if (statuses.get(num(row, 'id')) === 'missing') {
        total.satisfied = false;
      }
      const amount = numOrNull(row, 'amount');
      if (amount === null) {
        continue;
      }
      const unit = row.unit === null ? null : oneOf(row, 'unit', UNIT_IDS);
      if (unit === 'ml') {
        total.volumeMl = (total.volumeMl ?? 0) + amount * servings;
      } else {
        total.counts.set(unit, (total.counts.get(unit) ?? 0) + amount * servings);
      }
    }
  }

  const onHand = onHandIngredientIds(db);
  const lines: PartyLine[] = [...totals.values()]
    .sort(
      (a, b) =>
        Number(a.satisfied) - Number(b.satisfied) || a.name.localeCompare(b.name) || a.ingredientId - b.ingredientId,
    )
    .map((total) => ({
      ingredient: { id: total.ingredientId, name: total.name, onHand: onHand.has(total.ingredientId) },
      volumeMl: total.volumeMl,
      counts: [...total.counts].map(([unit, amount]) => ({ unit, amount })),
      satisfied: total.satisfied,
      optionalOnly: total.optionalOnly,
      recipeCount: total.recipes.size,
    }));
  const totalVolumeMl = lines.reduce((sum, line) => sum + (line.volumeMl ?? 0), 0);
  return { recipes, lines, totalVolumeMl };
}
