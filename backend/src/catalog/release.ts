import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { foldName, UNIT_IDS, validateCalculator } from '@cellar/contract';
import { CATALOG_VERSION_PATTERN } from '@cellar/contract/schemas';
import { z } from 'zod';
import { problem } from '../core/problems.ts';
import type { Settings } from '../core/settings.ts';

export const RELEASE_PREFIX = 'cellar-catalog-';
export const FORMAT_VERSION = 1;

// D-4 §3.2: every entry path a release folder may hold.
export const RELEASE_PATH =
  /^(manifest\.json|data\/(glasses|methods|utensils|taste-descriptors|calculators|ingredients|recipes)\.json|images\/(recipes|ingredients)\/[a-z0-9]+(-[a-z0-9]+)*\/[1-9]\.(webp|jpg|png))$/;

const DATA_FILES = {
  glasses: 'data/glasses.json',
  methods: 'data/methods.json',
  utensils: 'data/utensils.json',
  tasteDescriptors: 'data/taste-descriptors.json',
  calculators: 'data/calculators.json',
  ingredients: 'data/ingredients.json',
  recipes: 'data/recipes.json',
} as const;

const key = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(100);
const rev = z.string().regex(/^[0-9a-f]{16}$/);
const name = z.string().min(1).max(120);
const text = (max: number) => z.string().max(max).nullable();
const unit = z.enum(UNIT_IDS).nullable();
const amount = z.number().min(0.01).max(99_999).nullable();

const ImageRefSchema = z.strictObject({
  file: z.string().regex(RELEASE_PATH),
  mediaType: z.enum(['image/webp', 'image/jpeg', 'image/png']),
  width: z.int().min(1).max(10_000),
  height: z.int().min(1).max(10_000),
  bytes: z.int().min(1).max(2_000_000),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  placeholder: z.string().nullable(),
});
export type ReleaseImage = z.infer<typeof ImageRefSchema>;

const GlassSchema = z.strictObject({ key, rev, name, description: text(5000), capacityMl: z.number().nullable() });
const MethodSchema = z.strictObject({ key, rev, name, dilutionPercent: z.number().min(0).max(100) });
const UtensilSchema = z.strictObject({ key, rev, name, description: text(5000) });
const DescriptorSchema = z.strictObject({ key, rev, name });
const CalculatorSchema = z.strictObject({
  key,
  rev,
  name,
  description: text(5000),
  inputs: z
    .array(
      z.strictObject({
        key: z.string(),
        label: z.string().min(1).max(60),
        defaultValue: z.number(),
        suffix: z.string().max(12),
      }),
    )
    .min(1)
    .max(10),
  outputs: z
    .array(
      z.strictObject({
        key: z.string(),
        label: z.string().min(1).max(60),
        expression: z.string().min(1).max(200),
        decimals: z.int().min(0).max(6),
        suffix: z.string().max(12),
      }),
    )
    .min(1)
    .max(20),
});
const IngredientSchema = z.strictObject({
  key,
  rev,
  name,
  parent: key.nullable(),
  strength: z.number().min(0).max(100),
  description: text(5000),
  origin: text(120),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/)
    .nullable(),
  defaultUnit: unit,
  parts: z.array(z.strictObject({ ingredient: key, amount, unit })).max(20),
  images: z.array(ImageRefSchema).max(1),
});
const SubstituteSchema = z.strictObject({ ingredient: key, amount, amountMax: amount, unit });
const LineSchema = z.strictObject({
  ingredient: key,
  amount,
  amountMax: amount,
  unit,
  optional: z.boolean(),
  specified: z.boolean(),
  note: text(500),
  substitutes: z.array(SubstituteSchema).max(10),
});
const RecipeSchema = z.strictObject({
  key,
  rev,
  name,
  description: text(5000),
  instructions: z.string().min(1).max(5000),
  garnish: text(500),
  glass: key.nullable(),
  method: key.nullable(),
  utensils: z.array(key).max(20),
  tags: z.array(z.string().min(1).max(50)).max(20),
  year: z.int().min(1).max(9999).nullable(),
  author: text(200),
  source: text(1000),
  parent: key.nullable(),
  images: z.array(ImageRefSchema).max(5),
  lines: z.array(LineSchema).min(1).max(40),
});

export type ReleaseGlass = z.infer<typeof GlassSchema>;
export type ReleaseMethod = z.infer<typeof MethodSchema>;
export type ReleaseUtensil = z.infer<typeof UtensilSchema>;
export type ReleaseDescriptor = z.infer<typeof DescriptorSchema>;
export type ReleaseCalculator = z.infer<typeof CalculatorSchema>;
export type ReleaseIngredient = z.infer<typeof IngredientSchema>;
export type ReleaseRecipe = z.infer<typeof RecipeSchema>;

const CountsSchema = z.strictObject({
  recipes: z.int().min(0),
  ingredients: z.int().min(0),
  images: z.int().min(0),
  glasses: z.int().min(0),
  methods: z.int().min(0),
  utensils: z.int().min(0),
  calculators: z.int().min(0),
  tasteDescriptors: z.int().min(0),
  tags: z.int().min(0),
});
export type ReleaseCounts = z.infer<typeof CountsSchema>;

export const CatalogManifestSchema = z.strictObject({
  format: z.literal('cellar-catalog'),
  formatVersion: z.int().min(1),
  version: z.string().regex(CATALOG_VERSION_PATTERN),
  counts: CountsSchema,
  imageBytes: z.int().min(0),
  files: z.array(
    z.strictObject({
      path: z.string().regex(RELEASE_PATH),
      bytes: z.int().min(0),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  ),
});
export type CatalogManifest = z.infer<typeof CatalogManifestSchema>;

export interface CatalogReleaseDir {
  readonly dir: string;
  readonly manifest: CatalogManifest;
}

export interface ReleaseData {
  readonly version: string;
  readonly glasses: readonly ReleaseGlass[];
  readonly methods: readonly ReleaseMethod[];
  readonly utensils: readonly ReleaseUtensil[];
  readonly tasteDescriptors: readonly ReleaseDescriptor[];
  readonly calculators: readonly ReleaseCalculator[];
  readonly ingredients: readonly ReleaseIngredient[];
  readonly recipes: readonly ReleaseRecipe[];
}

export type ReleaseFailure = 'damaged' | 'invalid';

export class ReleaseCheckError extends Error {
  readonly failure: ReleaseFailure;

  constructor(failure: ReleaseFailure, message: string) {
    super(message);
    this.name = 'ReleaseCheckError';
    this.failure = failure;
  }
}

function invalid(message: string): never {
  throw new ReleaseCheckError('invalid', message);
}

export function compareVersions(a: string, b: string): number {
  const [dateA, buildA] = a.split('-');
  const [dateB, buildB] = b.split('-');
  if (dateA !== dateB) {
    return dateA < dateB ? -1 : 1;
  }
  return Number.parseInt(buildA, 10) - Number.parseInt(buildB, 10);
}

export function readManifest(dir: string): CatalogManifest {
  const path = join(dir, 'manifest.json');
  if (!existsSync(path)) {
    invalid('manifest.json is missing');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      invalid('manifest.json is not JSON');
    }
    throw error;
  }
  const parsed = CatalogManifestSchema.safeParse(raw);
  if (!parsed.success) {
    invalid(`manifest.json: ${parsed.error.issues[0]?.path.join('.') ?? ''} ${parsed.error.issues[0]?.message ?? ''}`);
  }
  return parsed.data;
}

export function findShippedRelease(settings: Settings): CatalogReleaseDir {
  const folders = existsSync(settings.shippedCatalogDir)
    ? readdirSync(settings.shippedCatalogDir, { withFileTypes: true }).filter(
        (entry) => entry.isDirectory() && entry.name.startsWith(RELEASE_PREFIX),
      )
    : [];
  if (folders.length !== 1) {
    invalid(`expected one ${RELEASE_PREFIX}* folder in ${settings.shippedCatalogDir}, found ${folders.length}`);
  }
  const dir = join(settings.shippedCatalogDir, folders[0].name);
  return { dir, manifest: readManifest(dir) };
}

export function shippedRelease(settings: Settings): CatalogReleaseDir {
  try {
    return findShippedRelease(settings);
  } catch (error) {
    if (error instanceof ReleaseCheckError) {
      throw builtinDamaged(error.message);
    }
    throw error;
  }
}

export function builtinDamaged(reason: string) {
  return problem('catalog_builtin_damaged', {
    detail: `The built-in catalog couldn't be loaded: ${reason}. Everything else works. Pull the Cellar image again, then load it from Settings > Catalog.`,
  });
}

function listReleaseFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split('\\').join('/'));
}

function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function checkFiles(release: CatalogReleaseDir): Promise<Map<string, Buffer>> {
  const { dir, manifest } = release;
  const listed = new Map(manifest.files.map((file) => [file.path, file]));
  const heads = new Map<string, Buffer>();
  for (const path of listReleaseFiles(dir)) {
    if (path !== 'manifest.json' && !listed.has(path)) {
      invalid(`${path} is not listed in manifest.json`);
    }
  }
  for (const file of manifest.files) {
    const path = join(dir, file.path);
    if (!existsSync(path) || !statSync(path).isFile()) {
      invalid(`${file.path} is listed in manifest.json but missing`);
    }
    const bytes = await readFile(path);
    if (bytes.length !== file.bytes || sha256Of(bytes) !== file.sha256) {
      throw new ReleaseCheckError('damaged', `${file.path} does not match its size or SHA-256`);
    }
    heads.set(file.path, bytes.subarray(0, 12));
  }
  return heads;
}

function parseData<T>(dir: string, file: string, schema: z.ZodType<T>): T[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      invalid(`${file} is not JSON`);
    }
    throw error;
  }
  if (!Array.isArray(raw)) {
    invalid(`${file} is not an array`);
  }
  return raw.map((record: unknown, index) => {
    const parsed = schema.safeParse(record);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const recordKey =
        typeof record === 'object' && record !== null && 'key' in record && typeof record.key === 'string'
          ? record.key
          : `#${index}`;
      invalid(`${file}, "${recordKey}": ${issue?.path.join('.') ?? ''} ${issue?.message ?? 'is invalid'}`);
    }
    return parsed.data;
  });
}

function keysOf(file: string, records: readonly { key: string }[]): Set<string> {
  const keys = new Set<string>();
  for (const record of records) {
    if (keys.has(record.key)) {
      invalid(`${file}, "${record.key}": key appears twice`);
    }
    keys.add(record.key);
  }
  return keys;
}

function requireKey(set: ReadonlySet<string>, file: string, owner: string, what: string, value: string): void {
  if (!set.has(value)) {
    invalid(`${file}, "${owner}": ${what} "${value}" not found`);
  }
}

const MAGIC: Readonly<Record<ReleaseImage['mediaType'], (bytes: Buffer) => boolean>> = {
  'image/jpeg': (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/png': (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (bytes) => bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP',
};

function checkImages(
  release: CatalogReleaseDir,
  heads: ReadonlyMap<string, Buffer>,
  owner: string,
  images: readonly ReleaseImage[],
): void {
  const listed = new Map(release.manifest.files.map((file) => [file.path, file]));
  for (const image of images) {
    const file = listed.get(image.file);
    if (file === undefined || file.sha256 !== image.sha256 || file.bytes !== image.bytes) {
      invalid(`"${owner}": image ${image.file} does not match manifest.json`);
    }
    const head = heads.get(image.file);
    if (head === undefined || !MAGIC[image.mediaType](head)) {
      invalid(`"${owner}": image ${image.file} is not ${image.mediaType}`);
    }
  }
}

export async function checkRelease(release: CatalogReleaseDir, expectedVersion: string | null): Promise<ReleaseData> {
  const { dir, manifest } = release;
  if (manifest.formatVersion !== FORMAT_VERSION) {
    invalid(`format version ${manifest.formatVersion} is not supported`);
  }
  if (!dir.endsWith(`${RELEASE_PREFIX}${manifest.version}`)) {
    invalid(`version ${manifest.version} does not match the folder name`);
  }
  if (expectedVersion !== null && manifest.version !== expectedVersion) {
    invalid(`version ${manifest.version} does not match the index (${expectedVersion})`);
  }
  const heads = await checkFiles(release);

  const data: ReleaseData = {
    version: manifest.version,
    glasses: parseData(dir, DATA_FILES.glasses, GlassSchema),
    methods: parseData(dir, DATA_FILES.methods, MethodSchema),
    utensils: parseData(dir, DATA_FILES.utensils, UtensilSchema),
    tasteDescriptors: parseData(dir, DATA_FILES.tasteDescriptors, DescriptorSchema),
    calculators: parseData(dir, DATA_FILES.calculators, CalculatorSchema),
    ingredients: parseData(dir, DATA_FILES.ingredients, IngredientSchema),
    recipes: parseData(dir, DATA_FILES.recipes, RecipeSchema),
  };

  const glasses = keysOf(DATA_FILES.glasses, data.glasses);
  const methods = keysOf(DATA_FILES.methods, data.methods);
  const utensils = keysOf(DATA_FILES.utensils, data.utensils);
  const ingredients = keysOf(DATA_FILES.ingredients, data.ingredients);
  const recipes = keysOf(DATA_FILES.recipes, data.recipes);
  keysOf(DATA_FILES.calculators, data.calculators);
  keysOf(DATA_FILES.tasteDescriptors, data.tasteDescriptors);

  for (const calculator of data.calculators) {
    const issue = validateCalculator(calculator)[0];
    if (issue !== undefined) {
      invalid(`${DATA_FILES.calculators}, "${calculator.key}": ${issue.path} ${issue.error.message}`);
    }
  }
  const ingredientNames = new Set<string>();
  for (const ingredient of data.ingredients) {
    const folded = foldName(ingredient.name);
    if (ingredientNames.has(folded)) {
      invalid(`${DATA_FILES.ingredients}, "${ingredient.key}": name "${ingredient.name}" appears twice`);
    }
    ingredientNames.add(folded);
    if (ingredient.parent !== null) {
      requireKey(ingredients, DATA_FILES.ingredients, ingredient.key, 'parent', ingredient.parent);
    }
    for (const part of ingredient.parts) {
      requireKey(ingredients, DATA_FILES.ingredients, ingredient.key, 'part', part.ingredient);
    }
    checkImages(release, heads, ingredient.key, ingredient.images);
  }
  for (const recipe of data.recipes) {
    const file = DATA_FILES.recipes;
    if (recipe.glass !== null) {
      requireKey(glasses, file, recipe.key, 'glass', recipe.glass);
    }
    if (recipe.method !== null) {
      requireKey(methods, file, recipe.key, 'method', recipe.method);
    }
    if (recipe.parent !== null) {
      requireKey(recipes, file, recipe.key, 'parent', recipe.parent);
    }
    for (const utensil of recipe.utensils) {
      requireKey(utensils, file, recipe.key, 'utensil', utensil);
    }
    for (const line of recipe.lines) {
      requireKey(ingredients, file, recipe.key, 'ingredient', line.ingredient);
      for (const substitute of line.substitutes) {
        requireKey(ingredients, file, recipe.key, 'ingredient', substitute.ingredient);
      }
    }
    checkImages(release, heads, recipe.key, recipe.images);
  }
  return data;
}
