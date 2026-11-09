import {
  type CatalogCheck,
  type CatalogCounts,
  type CatalogStatus,
  type CatalogUpdate,
  type CatalogVersion,
  foldName,
} from '@cellar/contract';
import {
  CATALOG_VERSION_PATTERN,
  CatalogBounds,
  CatalogCheckSchema,
  CatalogCountsSchema,
  CatalogUpdateSchema,
} from '@cellar/contract/schemas';
import { z } from 'zod';
import type { AppContext } from '../core/context.ts';
import type { Database } from '../core/db.ts';
import { OutboundError } from '../core/outbound.ts';
import { problem } from '../core/problems.ts';
import { readSettings } from '../household/settings.ts';
import { catalogCounts } from './loader.ts';
import { compareVersions, FORMAT_VERSION, shippedRelease } from './release.ts';

// D-4 §9.3: GitHub answers a release download URL with a redirect to its asset host.
const GITHUB_ASSET_HOSTS = new Set(['objects.githubusercontent.com', 'release-assets.githubusercontent.com']);

const ChangeListSchema = z.object({
  added: z.array(z.object({ key: z.string(), name: z.string() })),
  changed: z.array(z.object({ key: z.string(), name: z.string() })),
  removed: z.array(z.object({ key: z.string(), name: z.string() })),
});

const IndexCountsSchema = z.object({
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

const IndexReleaseSchema = z.object({
  version: z.string().regex(CATALOG_VERSION_PATTERN),
  formatVersion: z.int().min(1),
  url: z.url({ protocol: /^https$/ }),
  bytes: z.int().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  counts: IndexCountsSchema,
  previous: z.string().regex(CATALOG_VERSION_PATTERN).nullable(),
  changes: z.object({
    recipes: ChangeListSchema,
    ingredients: ChangeListSchema,
    glasses: ChangeListSchema,
    methods: ChangeListSchema,
    utensils: ChangeListSchema,
    calculators: ChangeListSchema,
    tasteDescriptors: ChangeListSchema,
  }),
});
export type IndexRelease = z.infer<typeof IndexReleaseSchema>;

const IndexSchema = z.object({
  format: z.literal('cellar-catalog-index'),
  formatVersion: z.literal(1),
  latest: z.string().regex(CATALOG_VERSION_PATTERN),
  releases: z.array(IndexReleaseSchema),
});

const CHANGE_TYPES = [
  { type: 'recipes', table: 'recipes', field: 'recipes' },
  { type: 'ingredients', table: 'ingredients', field: 'ingredients' },
  { type: 'glasses', table: 'glasses', field: 'glasses' },
  { type: 'methods', table: 'methods', field: 'methods' },
  { type: 'utensils', table: 'utensils', field: 'utensils' },
  { type: 'calculators', table: 'calculators', field: 'calculators' },
  { type: 'tasteDescriptors', table: 'taste_descriptors', field: 'descriptors' },
] as const satisfies readonly {
  type: keyof IndexRelease['changes'];
  table: string;
  field: keyof CatalogCounts;
}[];

export function allowedCatalogHop(target: URL) {
  return (url: URL): boolean =>
    url.href === target.href || (url.protocol === 'https:' && GITHUB_ASSET_HOSTS.has(url.hostname));
}

function readJsonSetting<T>(db: Database, key: string, schema: z.ZodType<T>): T | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row === undefined || typeof row.value !== 'string') {
    return null;
  }
  const parsed = schema.safeParse(JSON.parse(row.value));
  if (!parsed.success) {
    throw new Error(`settings ${key} holds a value of the wrong shape`);
  }
  return parsed.data;
}

export function writeJsonSetting(db: Database, key: string, value: unknown): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value));
}

export function loadedVersion(db: Database): CatalogVersion | null {
  const row = db
    .prepare('SELECT version, loaded_at, counts_json FROM catalog_loads ORDER BY loaded_at DESC, version DESC LIMIT 1')
    .get();
  if (row === undefined || typeof row.version !== 'string' || typeof row.counts_json !== 'string') {
    return null;
  }
  return {
    version: row.version,
    builtAt: builtAtOf(row.version),
    counts: CatalogCountsSchema.parse(JSON.parse(row.counts_json)),
  };
}

function builtAtOf(version: string): string {
  const [date] = version.split('-');
  return `${date.replaceAll('.', '-')}T00:00:00.000Z`;
}

export function catalogStatus(ctx: AppContext): CatalogStatus {
  const release = shippedRelease(ctx.settings);
  const shipped: CatalogVersion = {
    version: release.manifest.version,
    builtAt: builtAtOf(release.manifest.version),
    counts: catalogCounts(release.manifest.counts),
  };
  return {
    shipped,
    loaded: loadedVersion(ctx.db),
    schedule: readSettings(ctx.db).catalogSchedule,
    lastCheck: readJsonSetting(ctx.db, 'catalog_last_check', CatalogCheckSchema),
    available: readJsonSetting(ctx.db, 'catalog_available', CatalogUpdateSchema.nullable()),
  };
}

export async function fetchIndex(ctx: AppContext): Promise<IndexRelease[]> {
  const url = ctx.settings.catalogUrl;
  let body: Uint8Array;
  try {
    const response = await ctx.outbound.fetch(url.href, {
      maxBytes: CatalogBounds.indexBytes,
      timeoutMs: CatalogBounds.indexTimeoutMs,
      allowOnly: allowedCatalogHop(url),
      accept: 'application/json',
    });
    body = response.body;
  } catch (error) {
    if (error instanceof OutboundError && error.case === 'too_large') {
      throw problem('catalog_index_invalid');
    }
    ctx.log.warn('The catalog index could not be fetched.', { err: error });
    throw problem('catalog_unreachable', {
      detail: "Couldn't reach Cellar's catalog page. Check that this server can reach the internet, then try again.",
    });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(body).toString('utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw problem('catalog_index_invalid');
    }
    throw error;
  }
  const parsed = IndexSchema.safeParse(raw);
  if (!parsed.success) {
    throw problem('catalog_index_invalid');
  }
  return parsed.data.releases;
}

function householdKeys(db: Database, table: string): Set<string> {
  const held = db.prepare(`SELECT catalog_key AS key FROM ${table} WHERE catalog_key IS NOT NULL`).all();
  const deleted = db.prepare('SELECT key FROM catalog_deletions WHERE type = ?').all(table);
  return new Set([...held, ...deleted].flatMap((row) => (typeof row.key === 'string' ? [row.key] : [])));
}

function householdNames(db: Database, table: string): Set<string> {
  if (table === 'recipes') {
    return new Set();
  }
  const rows = db.prepare(`SELECT name FROM ${table} WHERE catalog_key IS NULL`).all();
  return new Set(rows.flatMap((row) => (typeof row.name === 'string' ? [foldName(row.name)] : [])));
}

export interface Offer {
  readonly update: CatalogUpdate | null;
  readonly check: CatalogCheck;
}

export function computeOffer(db: Database, releases: readonly IndexRelease[], at: string): Offer {
  const applied = loadedVersion(db)?.version ?? null;
  const newer = releases
    .filter((release) => applied === null || compareVersions(release.version, applied) > 0)
    .sort((a, b) => compareVersions(a.version, b.version));
  const supported = newer.filter((release) => release.formatVersion === FORMAT_VERSION);
  const offered = supported.at(-1);
  if (offered === undefined) {
    const blocked = newer.at(-1);
    return {
      update: null,
      check: {
        at,
        result: 'up_to_date',
        message:
          blocked === undefined
            ? `You have the newest catalog, ${applied ?? 'none loaded'}.`
            : `Catalog ${blocked.version} needs a newer version of Cellar. Update Cellar to get it.`,
      },
    };
  }
  const adds: CatalogCounts = { ...catalogCounts(offered.counts), images: 0 };
  let notes: string[] = [];
  if (applied === null) {
    adds.images = offered.counts.images;
  } else {
    const between = supported.filter((release) => compareVersions(release.version, offered.version) <= 0);
    for (const { type, table, field } of CHANGE_TYPES) {
      const held = householdKeys(db, table);
      const names = householdNames(db, table);
      const added = new Map<string, string>();
      for (const release of between) {
        for (const entry of release.changes[type].added) {
          added.set(entry.key, entry.name);
        }
        for (const entry of release.changes[type].removed) {
          added.delete(entry.key);
        }
      }
      const kept = [...added].filter(([key, name]) => !held.has(key) && !names.has(foldName(name)));
      adds[field] = kept.length;
      if (type === 'recipes') {
        notes = kept.map(([, name]) => name);
      }
    }
  }
  const recipeWord = adds.recipes === 1 ? 'recipe' : 'recipes';
  const ingredientWord = adds.ingredients === 1 ? 'ingredient' : 'ingredients';
  return {
    update: { version: offered.version, adds, notes: notes.join(', ') },
    check: {
      at,
      result: 'available',
      message: `Catalog ${offered.version} is available: ${adds.recipes} new ${recipeWord}, ${adds.ingredients} new ${ingredientWord}.`,
    },
  };
}

export async function runCheck(ctx: AppContext): Promise<Offer> {
  const at = ctx.now().toISOString();
  try {
    const offer = computeOffer(ctx.db, await fetchIndex(ctx), at);
    writeJsonSetting(ctx.db, 'catalog_last_check', offer.check);
    writeJsonSetting(ctx.db, 'catalog_available', offer.update);
    return offer;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeJsonSetting(ctx.db, 'catalog_last_check', { at, result: 'failed', message } satisfies CatalogCheck);
    throw error;
  }
}
