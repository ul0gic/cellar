import { open, readFile } from 'node:fs/promises';
import {
  type CellarRecipeRecord,
  type DuplicateRule,
  foldName,
  type Id,
  type ImportMode,
  LIMITS,
  type RecipeImportReport,
  type RecipeImportRow,
  type RecipeInput,
} from '@cellar/contract';
import { CELLAR_RECIPE_FORMAT, CELLAR_RECIPE_FORMAT_VERSION, CellarRecipeRecordSchema } from '@cellar/contract/schemas';
import { z } from 'zod';
import { ArchiveError, readBoundedZip, type ZipEntry } from '../backup/archive.ts';
import type { AppContext } from '../core/context.ts';
import { type Database, withTransaction } from '../core/db.ts';
import type { UploadedFile } from '../core/multipart.ts';
import { ProblemError, payloadTooLarge, problem } from '../core/problems.ts';
import { fetchImage } from '../media/store.ts';
import { createRecipe, replaceRecipe } from '../recipes/write.ts';

const NOT_AN_EXPORT = 'Upload a Cellar recipe export (.json or .zip).';
const ZIP_MAGIC = [0x50, 0x4b];

const ExportEnvelopeSchema = z.object({
  format: z.literal(CELLAR_RECIPE_FORMAT),
  formatVersion: z.literal(CELLAR_RECIPE_FORMAT_VERSION),
  recipes: z.array(z.unknown()),
});

export interface RecipeImportRequest {
  readonly file: UploadedFile;
  readonly mode: ImportMode;
  readonly duplicate: DuplicateRule;
  readonly unmatchedParentId: Id;
  readonly fetchRemoteImages: boolean;
  readonly memberId: Id;
}

interface ExportFile {
  readonly recipes: readonly unknown[];
  readonly images: ReadonlyMap<string, ZipEntry>;
}

function notAnExport(): ProblemError {
  return problem('unsupported_media_type', { detail: NOT_AN_EXPORT });
}

function parseEnvelope(bytes: Buffer): readonly unknown[] {
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw notAnExport();
    }
    throw error;
  }
  const parsed = ExportEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    throw notAnExport();
  }
  return parsed.data.recipes;
}

async function readEntry(entry: ZipEntry): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await entry.open()) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function isZip(path: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const head = Buffer.alloc(2);
    const { bytesRead } = await handle.read(head, 0, 2, 0);
    return bytesRead === 2 && head[0] === ZIP_MAGIC[0] && head[1] === ZIP_MAGIC[1];
  } finally {
    await handle.close();
  }
}

async function readExport(file: UploadedFile): Promise<ExportFile> {
  if (!(await isZip(file.path))) {
    if (file.bytes > LIMITS.recipeJsonBytes) {
      throw payloadTooLarge(LIMITS.recipeJsonBytes);
    }
    return { recipes: parseEnvelope(await readFile(file.path)), images: new Map() };
  }
  const images = new Map<string, ZipEntry>();
  let recipes: readonly unknown[] | null = null;
  try {
    for await (const entry of readBoundedZip(file.path, {
      entries: LIMITS.archiveEntries,
      expandedBytes: LIMITS.archiveExpandedBytes,
      allowPath: (path) => path === 'recipes.json' || path.startsWith('images/'),
    })) {
      if (entry.path === 'recipes.json') {
        if (entry.size > LIMITS.recipeJsonBytes) {
          throw payloadTooLarge(LIMITS.recipeJsonBytes);
        }
        recipes = parseEnvelope(await readEntry(entry));
      } else if (!entry.path.endsWith('/')) {
        images.set(entry.path, entry);
      }
    }
  } catch (error) {
    if (error instanceof ArchiveError && error.reason === 'unreadable') {
      throw notAnExport();
    }
    throw error;
  }
  if (recipes === null) {
    throw notAnExport();
  }
  return { recipes, images };
}

interface Lookup {
  readonly glasses: ReadonlyMap<string, Id>;
  readonly methods: ReadonlyMap<string, Id>;
  readonly utensils: ReadonlyMap<string, Id>;
  readonly ingredientsByName: ReadonlyMap<string, readonly Id[]>;
  readonly ingredientName: ReadonlyMap<Id, string>;
  readonly ingredientParent: ReadonlyMap<Id, Id | null>;
  readonly recipesByName: ReadonlyMap<string, Id>;
  readonly recipesByCatalogKey: ReadonlyMap<string, Id>;
}

function idByFolded(db: Database, table: string): Map<string, Id> {
  const map = new Map<string, Id>();
  for (const row of db.prepare(`SELECT id, folded_name FROM ${table} ORDER BY id`).all()) {
    if (typeof row.id === 'number' && typeof row.folded_name === 'string' && !map.has(row.folded_name)) {
      map.set(row.folded_name, row.id);
    }
  }
  return map;
}

function lookup(db: Database): Lookup {
  const ingredientsByName = new Map<string, Id[]>();
  const ingredientName = new Map<Id, string>();
  const ingredientParent = new Map<Id, Id | null>();
  for (const row of db.prepare('SELECT id, name, folded_name, parent_id FROM ingredients ORDER BY id').all()) {
    if (typeof row.id !== 'number' || typeof row.folded_name !== 'string' || typeof row.name !== 'string') {
      continue;
    }
    ingredientsByName.set(row.folded_name, [...(ingredientsByName.get(row.folded_name) ?? []), row.id]);
    ingredientName.set(row.id, row.name);
    ingredientParent.set(row.id, typeof row.parent_id === 'number' ? row.parent_id : null);
  }
  const recipesByCatalogKey = new Map<string, Id>();
  for (const row of db.prepare('SELECT id, catalog_key FROM recipes WHERE catalog_key IS NOT NULL').all()) {
    if (typeof row.id === 'number' && typeof row.catalog_key === 'string') {
      recipesByCatalogKey.set(row.catalog_key, row.id);
    }
  }
  return {
    glasses: idByFolded(db, 'glasses'),
    methods: idByFolded(db, 'methods'),
    utensils: idByFolded(db, 'utensils'),
    ingredientsByName,
    ingredientName,
    ingredientParent,
    recipesByName: idByFolded(db, 'recipes'),
    recipesByCatalogKey,
  };
}

function ancestorsOf(table: Lookup, id: Id): string[] {
  const names: string[] = [];
  const seen = new Set<Id>();
  let current = table.ingredientParent.get(id) ?? null;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    names.unshift(foldName(table.ingredientName.get(current) ?? ''));
    current = table.ingredientParent.get(current) ?? null;
  }
  return names;
}

function matchIngredient(table: Lookup, name: string, path: readonly string[]): Id | null {
  const candidates = table.ingredientsByName.get(foldName(name)) ?? [];
  if (candidates.length <= 1) {
    return candidates[0] ?? null;
  }
  const wanted = path.slice(0, -1).map(foldName).join('/');
  return candidates.find((id) => ancestorsOf(table, id).join('/') === wanted) ?? candidates[0];
}

function issueText(issue: z.core.$ZodIssue): string {
  const [field, index, sub] = issue.path;
  if (field === 'instructions') {
    return 'Missing instructions.';
  }
  if (field === 'lines' && typeof index === 'number') {
    return sub === 'unit'
      ? `Line ${index + 1}: the unit isn't one Cellar knows.`
      : `Line ${index + 1}: ${String(sub ?? 'line')} ${issue.message}.`;
  }
  return `${issue.path.join('.') || 'record'}: ${issue.message}.`;
}

interface Planned {
  readonly row: RecipeImportRow;
  readonly record: CellarRecipeRecord | null;
  readonly existingId: Id | null;
}

function plan(table: Lookup, records: readonly unknown[], duplicate: DuplicateRule): Planned[] {
  const willCreate = new Set<string>();
  return records.map((raw, index) => {
    const name =
      typeof raw === 'object' && raw !== null && 'name' in raw && typeof raw.name === 'string' ? raw.name : '';
    const row: RecipeImportRow = {
      index,
      name,
      result: 'error',
      recipeId: null,
      createdIngredients: [],
      unmatchedGlass: null,
      unmatchedMethod: null,
      errors: [],
    };
    const parsed = CellarRecipeRecordSchema.safeParse(raw);
    if (!parsed.success) {
      row.errors.push(...new Set(parsed.error.issues.map(issueText)));
      return { row, record: null, existingId: null };
    }
    const record = parsed.data;
    if (record.instructions.trim() === '') {
      row.errors.push('Missing instructions.');
    }
    if (record.lines.length === 0) {
      row.errors.push('Missing ingredients.');
    }
    if (row.errors.length > 0) {
      return { row, record: null, existingId: null };
    }
    if (record.glass !== null && !table.glasses.has(foldName(record.glass))) {
      row.unmatchedGlass = record.glass;
    }
    if (record.method !== null && !table.methods.has(foldName(record.method))) {
      row.unmatchedMethod = record.method;
    }
    const names = record.lines.flatMap((line) => [
      { name: line.ingredient, path: line.ingredientPath },
      ...line.substitutes.map((substitute) => ({ name: substitute.ingredient, path: substitute.ingredientPath })),
    ]);
    for (const { name: ingredient, path } of names) {
      const folded = foldName(ingredient);
      if (matchIngredient(table, ingredient, path) === null && !willCreate.has(folded)) {
        willCreate.add(folded);
        row.createdIngredients.push(ingredient);
      }
    }
    const existingId = table.recipesByName.get(foldName(record.name)) ?? null;
    row.result = existingId === null ? 'create' : duplicate;
    return { row, record, existingId };
  });
}

function totals(rows: readonly RecipeImportRow[]): RecipeImportReport['totals'] {
  const count = (result: RecipeImportRow['result']) => rows.filter((row) => row.result === result).length;
  return { creates: count('create'), updates: count('update'), skips: count('skip'), errors: count('error') };
}

function report(mode: ImportMode, committed: boolean, rows: RecipeImportRow[]): RecipeImportReport {
  return { mode, committed, format: 'cellar', totals: totals(rows), recipes: rows };
}

async function storeImages(
  ctx: AppContext,
  request: RecipeImportRequest,
  record: CellarRecipeRecord,
  images: ReadonlyMap<string, ZipEntry>,
): Promise<Id[]> {
  const ids: Id[] = [];
  for (const image of record.images) {
    let bytes: Uint8Array | null = null;
    const entry = images.get(image.file);
    if (entry !== undefined) {
      if (entry.size > LIMITS.imageFetchedBytes) {
        throw payloadTooLarge(LIMITS.imageFetchedBytes);
      }
      bytes = await readEntry(entry);
    } else if (request.fetchRemoteImages && /^https?:\/\//i.test(image.file)) {
      bytes = await fetchImage(ctx.outbound, image.file);
    }
    if (bytes !== null) {
      ids.push((await ctx.media.storeFetched(bytes, 'recipe', request.memberId)).id);
    }
  }
  return ids;
}

function ingredientFor(
  ctx: AppContext,
  table: Lookup,
  created: Map<string, Id>,
  request: RecipeImportRequest,
  name: string,
  path: readonly string[],
): Id {
  const matched = matchIngredient(table, name, path);
  if (matched !== null) {
    return matched;
  }
  const folded = foldName(name);
  const existing = created.get(folded);
  if (existing !== undefined) {
    return existing;
  }
  const now = ctx.now().toISOString();
  const result = ctx.db
    .prepare(
      `INSERT INTO ingredients (name, folded_name, parent_id, default_unit, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'ml', ?, ?, ?)`,
    )
    .run(name.trim(), folded, request.unmatchedParentId, request.memberId, now, now);
  const id = Number(result.lastInsertRowid);
  created.set(folded, id);
  return id;
}

function recipeInput(
  ctx: AppContext,
  table: Lookup,
  created: Map<string, Id>,
  request: RecipeImportRequest,
  record: CellarRecipeRecord,
  imageIds: readonly Id[],
): RecipeInput {
  const tags = [
    ...new Map(record.tags.map((tag) => [foldName(tag), tag.trim().slice(0, LIMITS.tagName.max)])).values(),
  ];
  return {
    name: record.name.trim(),
    description: record.description,
    instructions: record.instructions,
    garnish: record.garnish,
    source: record.source,
    year: record.year,
    glassId: record.glass === null ? null : (table.glasses.get(foldName(record.glass)) ?? null),
    methodId: record.method === null ? null : (table.methods.get(foldName(record.method)) ?? null),
    utensilIds: [...new Set(record.utensils.flatMap((utensil) => table.utensils.get(foldName(utensil)) ?? []))],
    tags: tags.filter((tag) => tag !== ''),
    imageIds: [...imageIds],
    parentId: null,
    lines: record.lines.map((line) => ({
      ingredientId: ingredientFor(ctx, table, created, request, line.ingredient, line.ingredientPath),
      amount: line.amount,
      amountMax: line.amountMax,
      unit: line.unit,
      optional: line.optional,
      specified: line.specified,
      note: line.note,
      substitutes: line.substitutes.map((substitute) => ({
        ingredientId: ingredientFor(ctx, table, created, request, substitute.ingredient, substitute.ingredientPath),
        amount: substitute.amount,
        amountMax: substitute.amountMax,
        unit: substitute.unit,
      })),
    })),
  };
}

function existingImageIds(db: Database, recipeId: Id): Id[] {
  return db
    .prepare('SELECT image_id FROM recipe_images WHERE recipe_id = ? ORDER BY position')
    .all(recipeId)
    .flatMap((row) => (typeof row.image_id === 'number' ? [row.image_id] : []));
}

function failure(rows: RecipeImportRow[], mode: ImportMode): ProblemError {
  const count = rows.filter((row) => row.result === 'error').length;
  return problem('import_has_errors', {
    detail: `Fix the ${count} rows listed, then import again. Nothing was saved.`,
    report: report(mode, false, rows),
  });
}

export async function importRecipes(ctx: AppContext, request: RecipeImportRequest): Promise<RecipeImportReport> {
  const file = await readExport(request.file);
  if (ctx.db.prepare('SELECT 1 FROM ingredients WHERE id = ?').get(request.unmatchedParentId) === undefined) {
    throw problem('validation_failed', {
      fields: [{ path: 'unmatchedParentId', code: 'not_found', message: "This doesn't exist any more." }],
    });
  }
  const planned = plan(lookup(ctx.db), file.recipes, request.duplicate);
  const rows = planned.map((item) => item.row);
  if (request.mode === 'dry_run') {
    return report('dry_run', false, rows);
  }
  if (rows.some((row) => row.result === 'error')) {
    throw failure(rows, request.mode);
  }
  const imageIds = new Map<number, Id[]>();
  const stored: Id[] = [];
  try {
    for (const item of planned) {
      const keepsImages = item.row.result === 'update' && item.existingId !== null;
      if (item.record !== null && item.row.result !== 'skip' && !keepsImages) {
        const ids = await storeImages(ctx, request, item.record, file.images);
        stored.push(...ids);
        imageIds.set(item.row.index, ids);
      }
    }
    withTransaction(ctx.db, () => {
      const table = lookup(ctx.db);
      const created = new Map<string, Id>();
      const byKey = new Map<string, Id>();
      for (const item of planned) {
        const { row, record } = item;
        if (record === null || row.result === 'skip') {
          row.recipeId = item.existingId;
          continue;
        }
        try {
          if (row.result === 'update' && item.existingId !== null) {
            const input = recipeInput(ctx, table, created, request, record, existingImageIds(ctx.db, item.existingId));
            row.recipeId = replaceRecipe(ctx, item.existingId, input);
          } else {
            const input = recipeInput(ctx, table, created, request, record, imageIds.get(row.index) ?? []);
            row.recipeId = createRecipe(ctx, input, request.memberId);
          }
          byKey.set(record.key, row.recipeId);
        } catch (error) {
          if (!(error instanceof ProblemError)) {
            throw error;
          }
          row.result = 'error';
          row.errors.push(...(error.fields?.map((field) => `${field.path}: ${field.message}`) ?? [error.detail]));
        }
      }
      if (rows.some((row) => row.result === 'error')) {
        throw failure(rows, request.mode);
      }
      const setParent = ctx.db.prepare('UPDATE recipes SET parent_recipe_id = ? WHERE id = ?');
      for (const { record, row } of planned) {
        if (record?.parent == null || row.recipeId === null || row.result === 'skip') {
          continue;
        }
        const parentId = byKey.get(record.parent) ?? table.recipesByCatalogKey.get(record.parent);
        if (parentId !== undefined && parentId !== row.recipeId) {
          setParent.run(parentId, row.recipeId);
        }
      }
    });
  } catch (error) {
    for (const id of stored) {
      await ctx.media.remove(id);
    }
    throw error;
  }
  return report('commit', true, rows);
}
