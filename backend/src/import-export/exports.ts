import { PassThrough, Readable } from 'node:stream';
import {
  type CellarRecipeFile,
  type CellarRecipeRecord,
  type Provenance,
  UNIT_IDS,
  type UnitId,
} from '@cellar/contract';
import {
  BOTTLE_CSV_COLUMNS,
  CELLAR_RECIPE_FORMAT,
  CELLAR_RECIPE_FORMAT_VERSION,
  INGREDIENT_CSV_COLUMNS,
} from '@cellar/contract/schemas';
import { createZipWriter } from '../backup/archive.ts';
import type { AppContext } from '../core/context.ts';
import type { Database } from '../core/db.ts';
import { problem } from '../core/problems.ts';
import { readSettings } from '../household/settings.ts';
import { csvLine, moneyText } from './csv.ts';

const BOM = '﻿';
type Row = Record<string, unknown>;

function str(row: Row, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : '';
}

function num(row: Row, key: string): number | null {
  const value = row[key];
  return typeof value === 'number' ? value : null;
}

function numText(value: number | null): string {
  return value === null ? '' : String(value);
}

function provenanceClause(provenance: Provenance | undefined, column: string): string {
  if (provenance === 'catalog') {
    return `${column} IS NOT NULL`;
  }
  return provenance === 'household' ? `${column} IS NULL` : '1 = 1';
}

export function exportFileDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function exportBottles(ctx: AppContext, statuses: readonly string[] | undefined): Readable {
  const { currency } = readSettings(ctx.db);
  const filter =
    statuses === undefined || statuses.length === 0 ? '' : `WHERE b.status IN (${statuses.map(() => '?').join(', ')})`;
  const rows = ctx.db
    .prepare(
      `SELECT b.id, b.name, i.name AS ingredient, b.labeled_size, b.volume_ml, b.abv, b.price_paid_minor,
         b.purchased_on, b.opened_on, b.finished_on, b.status, b.note
       FROM bottles b JOIN ingredients i ON i.id = b.ingredient_id ${filter} ORDER BY b.id`,
    )
    .iterate(...(statuses ?? []));
  function* lines(): Generator<string> {
    yield `${BOM}${csvLine(BOTTLE_CSV_COLUMNS)}`;
    for (const row of rows) {
      const price = num(row, 'price_paid_minor');
      yield csvLine([
        numText(num(row, 'id')),
        str(row, 'name'),
        str(row, 'ingredient'),
        str(row, 'labeled_size'),
        numText(num(row, 'volume_ml')),
        numText(num(row, 'abv')),
        price === null ? '' : moneyText(price, currency),
        str(row, 'purchased_on'),
        str(row, 'opened_on'),
        str(row, 'finished_on'),
        str(row, 'status'),
        str(row, 'note'),
      ]);
    }
  }
  return Readable.from(lines());
}

export function exportIngredients(ctx: AppContext, provenance: Provenance | undefined): Readable {
  const rows = ctx.db
    .prepare(
      `SELECT i.id, i.name, p.name AS parent, i.strength, i.description, i.origin, i.color, i.default_unit
       FROM ingredients i LEFT JOIN ingredients p ON p.id = i.parent_id
       WHERE ${provenanceClause(provenance, 'i.catalog_key')} ORDER BY i.id`,
    )
    .iterate();
  function* lines(): Generator<string> {
    yield `${BOM}${csvLine(INGREDIENT_CSV_COLUMNS)}`;
    for (const row of rows) {
      yield csvLine([
        numText(num(row, 'id')),
        str(row, 'name'),
        str(row, 'parent'),
        numText(num(row, 'strength')),
        str(row, 'description'),
        str(row, 'origin'),
        str(row, 'color'),
        str(row, 'default_unit'),
      ]);
    }
  }
  return Readable.from(lines());
}

interface IngredientNames {
  readonly name: Map<number, string>;
  readonly parent: Map<number, number | null>;
}

function ingredientNames(db: Database): IngredientNames {
  const name = new Map<number, string>();
  const parent = new Map<number, number | null>();
  for (const row of db.prepare('SELECT id, name, parent_id FROM ingredients').all()) {
    const id = num(row, 'id');
    if (id !== null) {
      name.set(id, str(row, 'name'));
      parent.set(id, num(row, 'parent_id'));
    }
  }
  return { name, parent };
}

function pathOf(names: IngredientNames, id: number): string[] {
  const path: string[] = [];
  const seen = new Set<number>();
  let current: number | null = id;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    path.unshift(names.name.get(current) ?? '');
    current = names.parent.get(current) ?? null;
  }
  return path;
}

function unitOf(value: unknown): UnitId | null {
  return UNIT_IDS.find((id) => id === value) ?? null;
}

interface ExportImage {
  readonly file: string;
  readonly source: string;
}

function recipeKey(row: Row): string {
  const key = row.catalog_key;
  return typeof key === 'string' ? key : `household-${num(row, 'id')}`;
}

export function selectRecipeIds(
  db: Database,
  provenance: Provenance | undefined,
  ids: readonly number[] | undefined,
): number[] {
  if (ids !== undefined && ids.length > 0) {
    const found = new Set(
      db
        .prepare(`SELECT id FROM recipes WHERE id IN (${ids.map(() => '?').join(', ')})`)
        .all(...ids)
        .flatMap((row) => {
          const id = num(row, 'id');
          return id === null ? [] : [id];
        }),
    );
    if (ids.some((id) => !found.has(id))) {
      throw problem('not_found');
    }
    return [...found];
  }
  return db
    .prepare(`SELECT id FROM recipes WHERE ${provenanceClause(provenance ?? 'household', 'catalog_key')} ORDER BY id`)
    .all()
    .flatMap((row) => {
      const id = num(row, 'id');
      return id === null ? [] : [id];
    });
}

function recipeRecords(
  ctx: AppContext,
  recipeIds: readonly number[],
): { records: CellarRecipeRecord[]; images: ExportImage[] } {
  const db = ctx.db;
  const names = ingredientNames(db);
  const recipe = db.prepare(
    `SELECT r.id, r.catalog_key, r.name, r.description, r.instructions, r.garnish, r.source, r.year,
       g.name AS glass, m.name AS method, p.id AS parent_id, p.catalog_key AS parent_catalog_key
     FROM recipes r LEFT JOIN glasses g ON g.id = r.glass_id LEFT JOIN methods m ON m.id = r.method_id
     LEFT JOIN recipes p ON p.id = r.parent_recipe_id WHERE r.id = ?`,
  );
  const utensils = db.prepare(
    'SELECT u.name FROM recipe_utensils ru JOIN utensils u ON u.id = ru.utensil_id WHERE ru.recipe_id = ? ORDER BY u.name',
  );
  const tags = db.prepare(
    'SELECT t.name FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.recipe_id = ? ORDER BY t.name',
  );
  const images = db.prepare(
    `SELECT i.file_name, i.thumbhash, i.width, i.height FROM recipe_images ri JOIN images i ON i.id = ri.image_id
     WHERE ri.recipe_id = ? ORDER BY ri.position`,
  );
  const lines = db.prepare(
    'SELECT id, ingredient_id, amount, amount_max, unit, optional, specified, note FROM recipe_lines WHERE recipe_id = ? ORDER BY position',
  );
  const substitutes = db.prepare(
    'SELECT ingredient_id, amount, amount_max, unit FROM recipe_line_substitutes WHERE line_id = ? ORDER BY position',
  );
  const records: CellarRecipeRecord[] = [];
  const files: ExportImage[] = [];
  for (const id of recipeIds) {
    const row = recipe.get(id);
    if (row === undefined) {
      continue;
    }
    const key = recipeKey(row);
    const parentId = num(row, 'parent_id');
    const parentKey = row.parent_catalog_key;
    const recordImages = images.all(id).flatMap((image, index) => {
      const fileName = str(image, 'file_name');
      const source = ctx.media.resolveServePath(fileName);
      if (source === null) {
        return [];
      }
      const extension = fileName.slice(fileName.lastIndexOf('.') + 1);
      const file = `images/${key}-${index + 1}.${extension}`;
      files.push({ file, source });
      return [
        {
          file,
          thumbhash: image.thumbhash === null ? null : str(image, 'thumbhash'),
          width: num(image, 'width'),
          height: num(image, 'height'),
        },
      ];
    });
    records.push({
      key,
      name: str(row, 'name'),
      description: str(row, 'description'),
      instructions: str(row, 'instructions'),
      garnish: str(row, 'garnish'),
      source: str(row, 'source'),
      year: num(row, 'year'),
      glass: row.glass === null ? null : str(row, 'glass'),
      method: row.method === null ? null : str(row, 'method'),
      utensils: utensils.all(id).map((utensil) => str(utensil, 'name')),
      tags: tags.all(id).map((tag) => str(tag, 'name')),
      parent: parentId === null ? null : typeof parentKey === 'string' ? parentKey : `household-${parentId}`,
      images: recordImages,
      lines: lines.all(id).map((line) => {
        const ingredientId = num(line, 'ingredient_id') ?? 0;
        return {
          ingredient: names.name.get(ingredientId) ?? '',
          ingredientPath: pathOf(names, ingredientId),
          amount: num(line, 'amount'),
          amountMax: num(line, 'amount_max'),
          unit: unitOf(line.unit),
          optional: line.optional === 1,
          specified: line.specified === 1,
          note: str(line, 'note'),
          substitutes: substitutes.all(num(line, 'id')).map((substitute) => {
            const substituteId = num(substitute, 'ingredient_id') ?? 0;
            return {
              ingredient: names.name.get(substituteId) ?? '',
              ingredientPath: pathOf(names, substituteId),
              amount: num(substitute, 'amount'),
              amountMax: num(substitute, 'amount_max'),
              unit: unitOf(substitute.unit),
            };
          }),
        };
      }),
    });
  }
  return { records, images: files };
}

export function exportRecipes(ctx: AppContext, recipeIds: readonly number[]): Readable {
  const { records, images } = recipeRecords(ctx, recipeIds);
  const file: CellarRecipeFile = {
    format: CELLAR_RECIPE_FORMAT,
    formatVersion: CELLAR_RECIPE_FORMAT_VERSION,
    exportedAt: ctx.now().toISOString(),
    appVersion: ctx.version,
    recipes: records,
  };
  const body = new PassThrough();
  const zip = createZipWriter(body, ctx.now());
  const write = async () => {
    await zip.addBuffer('recipes.json', Buffer.from(`${JSON.stringify(file, null, 2)}\n`), 'deflated');
    for (const image of images) {
      await zip.addFile(image.file, image.source, 'stored');
    }
    await zip.finish();
  };
  write().then(
    () => body.end(),
    (error: unknown) => {
      ctx.log.error('The recipe export stopped.', { err: error });
      body.destroy(error instanceof Error ? error : new Error(String(error)));
    },
  );
  return body;
}
