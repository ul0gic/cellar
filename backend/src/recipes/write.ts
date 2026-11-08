import {
  type FieldError,
  foldName,
  type Id,
  type InputVolumeUnit,
  isVolumeUnit,
  LIMITS,
  type RecipeInput,
  toMl,
  type UnitId,
} from '@cellar/contract';
import type { AppContext } from '../core/context.ts';
import { type Database, withTransaction } from '../core/db.ts';
import { problem } from '../core/problems.ts';
import { num, textOrNull } from './rows.ts';

interface StoredAmount {
  readonly amount: number | null;
  readonly amountMax: number | null;
  readonly unit: UnitId | null;
}

function storedAmount(
  input: { amount: number | null; amountMax: number | null; unit: UnitId | InputVolumeUnit | null },
  path: string,
  fields: FieldError[],
): StoredAmount {
  if (input.amount !== null && input.amountMax !== null && input.amountMax <= input.amount) {
    fields.push({ path: `${path}.amountMax`, code: 'invalid_value', message: 'Make the upper amount larger.' });
  }
  const unit = input.unit;
  if (unit === null || !isVolumeUnit(unit)) {
    return { amount: input.amount, amountMax: input.amountMax, unit };
  }
  const convert = (value: number | null, key: string): number | null => {
    if (value === null) {
      return null;
    }
    const ml = toMl(value, unit);
    if (ml > LIMITS.amount.max) {
      fields.push({
        path: `${path}.${key}`,
        code: 'out_of_range',
        message: `Use at most ${LIMITS.amount.max} ml.`,
      });
    }
    return ml;
  };
  return { amount: convert(input.amount, 'amount'), amountMax: convert(input.amountMax, 'amountMax'), unit: 'ml' };
}

function checkExists(db: Database, table: string, id: Id | null, path: string, fields: FieldError[]): void {
  if (id !== null && db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id) === undefined) {
    fields.push({ path, code: 'not_found', message: "This doesn't exist any more." });
  }
}

function tagIds(ctx: AppContext, names: readonly string[]): Id[] {
  const ids = new Set<Id>();
  const find = ctx.db.prepare('SELECT id FROM tags WHERE folded_name = ?');
  const insert = ctx.db.prepare(
    'INSERT INTO tags (name, folded_name, created_at, updated_at) VALUES (?, ?, ?, ?) RETURNING id',
  );
  const now = ctx.now().toISOString();
  for (const name of names) {
    const folded = foldName(name);
    const row = find.get(folded) ?? insert.get(name.trim(), folded, now, now);
    if (row === undefined) {
      throw new Error('INSERT … RETURNING returned no row');
    }
    ids.add(num(row, 'id'));
  }
  return [...ids];
}

function writeChildren(ctx: AppContext, recipeId: Id, input: RecipeInput, lines: readonly StoredLine[]): void {
  const db = ctx.db;
  const insertLine = db.prepare(
    `INSERT INTO recipe_lines (recipe_id, position, ingredient_id, amount, amount_max, unit, optional, specified, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  );
  const insertSubstitute = db.prepare(
    `INSERT INTO recipe_line_substitutes (line_id, position, ingredient_id, amount, amount_max, unit)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const [position, line] of lines.entries()) {
    const row = insertLine.get(
      recipeId,
      position,
      line.ingredientId,
      line.stored.amount,
      line.stored.amountMax,
      line.stored.unit,
      line.optional ? 1 : 0,
      line.specified ? 1 : 0,
      line.note,
    );
    if (row === undefined) {
      throw new Error('INSERT … RETURNING returned no row');
    }
    const lineId = num(row, 'id');
    for (const [subPosition, substitute] of line.substitutes.entries()) {
      insertSubstitute.run(
        lineId,
        subPosition,
        substitute.ingredientId,
        substitute.stored.amount,
        substitute.stored.amountMax,
        substitute.stored.unit,
      );
    }
  }
  const insertImage = db.prepare('INSERT INTO recipe_images (recipe_id, image_id, position) VALUES (?, ?, ?)');
  for (const [position, imageId] of input.imageIds.entries()) {
    insertImage.run(recipeId, imageId, position);
  }
  const insertTag = db.prepare('INSERT OR IGNORE INTO recipe_tags (recipe_id, tag_id) VALUES (?, ?)');
  for (const tagId of tagIds(ctx, input.tags)) {
    insertTag.run(recipeId, tagId);
  }
  const insertUtensil = db.prepare('INSERT OR IGNORE INTO recipe_utensils (recipe_id, utensil_id) VALUES (?, ?)');
  for (const utensilId of input.utensilIds) {
    insertUtensil.run(recipeId, utensilId);
  }
}

interface StoredLine {
  readonly ingredientId: Id;
  readonly stored: StoredAmount;
  readonly optional: boolean;
  readonly specified: boolean;
  readonly note: string;
  readonly substitutes: readonly { readonly ingredientId: Id; readonly stored: StoredAmount }[];
}

function checkParent(db: Database, parentId: Id | null, self: Id | null, fields: FieldError[]): void {
  if (parentId === null) {
    return;
  }
  const parent = db.prepare('SELECT parent_recipe_id FROM recipes WHERE id = ?').get(parentId);
  if (parent === undefined || parentId === self || (self !== null && parent.parent_recipe_id === self)) {
    fields.push({ path: 'parentId', code: 'invalid_value', message: 'Choose another recipe as the original.' });
  }
}

function validated(db: Database, input: RecipeInput, self: Id | null): StoredLine[] {
  const fields: FieldError[] = [];
  checkExists(db, 'glasses', input.glassId, 'glassId', fields);
  checkExists(db, 'methods', input.methodId, 'methodId', fields);
  checkParent(db, input.parentId, self, fields);
  for (const [index, id] of input.utensilIds.entries()) {
    checkExists(db, 'utensils', id, `utensilIds.${index}`, fields);
  }
  for (const [index, id] of input.imageIds.entries()) {
    checkExists(db, 'images', id, `imageIds.${index}`, fields);
  }
  const lines = input.lines.map((line, index): StoredLine => {
    const path = `lines.${index}`;
    checkExists(db, 'ingredients', line.ingredientId, `${path}.ingredientId`, fields);
    return {
      ingredientId: line.ingredientId,
      stored: storedAmount(line, path, fields),
      optional: line.optional,
      specified: line.specified,
      note: line.note,
      substitutes: line.substitutes.map((substitute, subIndex) => {
        const subPath = `${path}.substitutes.${subIndex}`;
        checkExists(db, 'ingredients', substitute.ingredientId, `${subPath}.ingredientId`, fields);
        return { ingredientId: substitute.ingredientId, stored: storedAmount(substitute, subPath, fields) };
      }),
    };
  });
  if (fields.length > 0) {
    throw problem('validation_failed', { fields });
  }
  return lines;
}

export function createRecipe(ctx: AppContext, input: RecipeInput, by: Id): Id {
  return withTransaction(ctx.db, () => {
    const lines = validated(ctx.db, input, null);
    const now = ctx.now().toISOString();
    const row = ctx.db
      .prepare(
        `INSERT INTO recipes (name, folded_name, description, instructions, garnish, glass_id, method_id, year, source,
           parent_recipe_id, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(
        input.name,
        foldName(input.name),
        input.description,
        input.instructions,
        input.garnish,
        input.glassId,
        input.methodId,
        input.year,
        input.source,
        input.parentId,
        by,
        now,
        now,
      );
    if (row === undefined) {
      throw new Error('INSERT … RETURNING returned no row');
    }
    const id = num(row, 'id');
    writeChildren(ctx, id, input, lines);
    return id;
  });
}

export function replaceRecipe(ctx: AppContext, id: Id, input: RecipeInput): Id {
  return withTransaction(ctx.db, () => {
    if (ctx.db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(id) === undefined) {
      throw problem('not_found');
    }
    const lines = validated(ctx.db, input, id);
    const now = ctx.now().toISOString();
    ctx.db
      .prepare(
        `UPDATE recipes SET name = ?, folded_name = ?, description = ?, instructions = ?, garnish = ?, glass_id = ?,
           method_id = ?, year = ?, source = ?, parent_recipe_id = ?, updated_at = ?,
           edited_at = CASE WHEN catalog_key IS NULL THEN NULL ELSE COALESCE(edited_at, ?) END
         WHERE id = ?`,
      )
      .run(
        input.name,
        foldName(input.name),
        input.description,
        input.instructions,
        input.garnish,
        input.glassId,
        input.methodId,
        input.year,
        input.source,
        input.parentId,
        now,
        now,
        id,
      );
    for (const table of ['recipe_lines', 'recipe_images', 'recipe_tags', 'recipe_utensils']) {
      ctx.db.prepare(`DELETE FROM ${table} WHERE recipe_id = ?`).run(id);
    }
    writeChildren(ctx, id, input, lines);
    return id;
  });
}

export function deleteRecipe(ctx: AppContext, id: Id): undefined {
  withTransaction(ctx.db, () => {
    const row = ctx.db.prepare('SELECT catalog_key FROM recipes WHERE id = ?').get(id);
    if (row === undefined) {
      throw problem('not_found');
    }
    const key = textOrNull(row, 'catalog_key');
    if (key !== null) {
      ctx.db
        .prepare('INSERT OR IGNORE INTO catalog_deletions (type, key, deleted_at) VALUES (?, ?, ?)')
        .run('recipes', key, ctx.now().toISOString());
    }
    ctx.db.prepare("DELETE FROM notes WHERE target_type = 'recipe' AND target_id = ?").run(id);
    ctx.db.prepare("DELETE FROM ratings WHERE target_type = 'recipe' AND target_id = ?").run(id);
    ctx.db.prepare('DELETE FROM recipes WHERE id = ?').run(id);
  });
}
