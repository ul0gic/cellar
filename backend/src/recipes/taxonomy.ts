import {
  type Descriptor,
  foldName,
  type Glass,
  type Id,
  type Method,
  type Provenance,
  type Tag,
  type Utensil,
} from '@cellar/contract';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../core/context.ts';
import { type Database, withTransaction } from '../core/db.ts';
import { problem } from '../core/problems.ts';
import { route } from '../core/route.ts';
import { num, numOrNull, type Row, text, textOrNull } from './rows.ts';

type FieldValue = string | number | null;

interface Kind<R> {
  readonly table: string;
  readonly thing: string;
  readonly usage: string;
  readonly columns: Readonly<Record<string, string>>;
  readonly catalog: boolean;
  record(row: Row, base: { id: Id; name: string; usageCount: number }): R;
}

export function provenanceOf(row: Row): Provenance {
  return textOrNull(row, 'catalog_key') === null ? 'household' : 'catalog';
}

const glasses: Kind<Glass> = {
  table: 'glasses',
  thing: 'glass',
  usage: 'SELECT COUNT(*) FROM recipes r WHERE r.glass_id = t.id',
  columns: { description: 'description', volumeMl: 'volume_ml' },
  catalog: true,
  record: (row, base) => ({
    ...base,
    description: text(row, 'description'),
    volumeMl: numOrNull(row, 'volume_ml'),
    provenance: provenanceOf(row),
  }),
};

const methods: Kind<Method> = {
  table: 'methods',
  thing: 'method',
  usage: 'SELECT COUNT(*) FROM recipes r WHERE r.method_id = t.id',
  columns: { dilutionPercent: 'dilution_percent' },
  catalog: true,
  record: (row, base) => ({ ...base, dilutionPercent: num(row, 'dilution_percent'), provenance: provenanceOf(row) }),
};

const utensils: Kind<Utensil> = {
  table: 'utensils',
  thing: 'utensil',
  usage: 'SELECT COUNT(*) FROM recipe_utensils u WHERE u.utensil_id = t.id',
  columns: { description: 'description' },
  catalog: true,
  record: (row, base) => ({ ...base, description: text(row, 'description'), provenance: provenanceOf(row) }),
};

const tags: Kind<Tag> = {
  table: 'tags',
  thing: 'tag',
  usage: 'SELECT COUNT(*) FROM recipe_tags g WHERE g.tag_id = t.id',
  columns: {},
  catalog: false,
  record: (_row, base) => base,
};

const descriptors: Kind<Descriptor> = {
  table: 'taste_descriptors',
  thing: 'descriptor',
  usage: 'SELECT COUNT(*) FROM note_descriptors d WHERE d.descriptor_id = t.id',
  columns: {},
  catalog: true,
  record: (row, base) => ({ ...base, provenance: provenanceOf(row) }),
};

function selectSql<R>(kind: Kind<R>): string {
  return `SELECT t.*, (${kind.usage}) AS usage_count FROM ${kind.table} t`;
}

function toRecord<R>(kind: Kind<R>, row: Row): R {
  return kind.record(row, { id: num(row, 'id'), name: text(row, 'name'), usageCount: num(row, 'usage_count') });
}

function list<R>(db: Database, kind: Kind<R>): { items: R[] } {
  const rows = db.prepare(`${selectSql(kind)} ORDER BY t.folded_name, t.id`).all();
  return { items: rows.map((row) => toRecord(kind, row)) };
}

function load<R>(db: Database, kind: Kind<R>, id: Id): R {
  const row = db.prepare(`${selectSql(kind)} WHERE t.id = ?`).get(id);
  if (row === undefined) {
    throw problem('not_found');
  }
  return toRecord(kind, row);
}

function refuseDuplicate<R>(db: Database, kind: Kind<R>, name: string, except: Id | null): string {
  const folded = foldName(name);
  const clash = db.prepare(`SELECT id FROM ${kind.table} WHERE folded_name = ?`).get(folded);
  if (clash !== undefined && num(clash, 'id') !== except) {
    throw problem('duplicate_name', { detail: `There is already a ${kind.thing} called “${name.trim()}”.` });
  }
  return folded;
}

function fieldValues<R>(
  kind: Kind<R>,
  input: Readonly<Record<string, FieldValue | undefined>>,
): [string, FieldValue][] {
  return Object.entries(kind.columns).flatMap(([key, column]): [string, FieldValue][] => {
    const value = input[key];
    return value === undefined ? [] : [[column, value]];
  });
}

function create<R>(
  ctx: AppContext,
  kind: Kind<R>,
  input: Readonly<{ name: string } & Record<string, FieldValue | undefined>>,
): R {
  return withTransaction(ctx.db, () => {
    const folded = refuseDuplicate(ctx.db, kind, input.name, null);
    const now = ctx.now().toISOString();
    const fields = fieldValues(kind, input);
    const columns = ['name', 'folded_name', ...fields.map(([column]) => column), 'created_at', 'updated_at'];
    const result = ctx.db
      .prepare(`INSERT INTO ${kind.table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
      .run(input.name.trim(), folded, ...fields.map(([, value]) => value), now, now);
    return load(ctx.db, kind, Number(result.lastInsertRowid));
  });
}

function update<R>(
  ctx: AppContext,
  kind: Kind<R>,
  id: Id,
  patch: Readonly<{ name?: string } & Record<string, FieldValue | undefined>>,
): R {
  return withTransaction(ctx.db, () => {
    load(ctx.db, kind, id);
    const sets: [string, FieldValue][] = fieldValues(kind, patch);
    if (patch.name !== undefined) {
      sets.push(['name', patch.name.trim()], ['folded_name', refuseDuplicate(ctx.db, kind, patch.name, id)]);
    }
    const now = ctx.now().toISOString();
    const editedAt = kind.catalog
      ? ', edited_at = CASE WHEN catalog_key IS NULL THEN NULL ELSE COALESCE(edited_at, ?) END'
      : '';
    const assignments = [...sets.map(([column]) => `${column} = ?`), 'updated_at = ?'].join(', ');
    ctx.db
      .prepare(`UPDATE ${kind.table} SET ${assignments}${editedAt} WHERE id = ?`)
      .run(...sets.map(([, value]) => value), now, ...(kind.catalog ? [now] : []), id);
    return load(ctx.db, kind, id);
  });
}

function remove<R>(ctx: AppContext, kind: Kind<R>, id: Id): { detached: number } {
  return withTransaction(ctx.db, () => {
    const row = ctx.db.prepare(`${selectSql(kind)} WHERE t.id = ?`).get(id);
    if (row === undefined) {
      throw problem('not_found');
    }
    const key = kind.catalog ? textOrNull(row, 'catalog_key') : null;
    if (key !== null) {
      ctx.db
        .prepare('INSERT OR IGNORE INTO catalog_deletions (type, key, deleted_at) VALUES (?, ?, ?)')
        .run(kind.table, key, ctx.now().toISOString());
    }
    ctx.db.prepare(`DELETE FROM ${kind.table} WHERE id = ?`).run(id);
    return { detached: num(row, 'usage_count') };
  });
}

export function registerTaxonomy(app: FastifyInstance, ctx: AppContext): void {
  route(app, 'listGlasses', async () => list(ctx.db, glasses));
  route(app, 'createGlass', async (request) => create(ctx, glasses, request.body));
  route(app, 'updateGlass', async (request) => update(ctx, glasses, request.params.id, request.body));
  route(app, 'deleteGlass', async (request) => remove(ctx, glasses, request.params.id));
  route(app, 'listMethods', async () => list(ctx.db, methods));
  route(app, 'createMethod', async (request) => create(ctx, methods, request.body));
  route(app, 'updateMethod', async (request) => update(ctx, methods, request.params.id, request.body));
  route(app, 'deleteMethod', async (request) => remove(ctx, methods, request.params.id));
  route(app, 'listUtensils', async () => list(ctx.db, utensils));
  route(app, 'createUtensil', async (request) => create(ctx, utensils, request.body));
  route(app, 'updateUtensil', async (request) => update(ctx, utensils, request.params.id, request.body));
  route(app, 'deleteUtensil', async (request) => remove(ctx, utensils, request.params.id));
  route(app, 'listTags', async () => list(ctx.db, tags));
  route(app, 'createTag', async (request) => create(ctx, tags, request.body));
  route(app, 'updateTag', async (request) => update(ctx, tags, request.params.id, request.body));
  route(app, 'deleteTag', async (request) => remove(ctx, tags, request.params.id));
  route(app, 'listDescriptors', async () => list(ctx.db, descriptors));
  route(app, 'createDescriptor', async (request) => create(ctx, descriptors, request.body));
  route(app, 'updateDescriptor', async (request) => update(ctx, descriptors, request.params.id, request.body));
  route(app, 'deleteDescriptor', async (request) => remove(ctx, descriptors, request.params.id));
}
