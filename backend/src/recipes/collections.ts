import {
  type Collection,
  type CollectionInput,
  type CollectionPatch,
  type CollectionSummary,
  type FieldError,
  foldName,
  type Id,
  LIMITS,
} from '@cellar/contract';
import type { FastifyInstance } from 'fastify';
import type { Person } from '../core/access.ts';
import type { AppContext } from '../core/context.ts';
import { type Database, withTransaction } from '../core/db.ts';
import { personOf } from '../core/person.ts';
import { problem } from '../core/problems.ts';
import { route } from '../core/route.ts';
import { recipeSummaries } from './summaries.ts';
import {
  imageRefsOf,
  imageColumns,
  imageRefOrNull,
  memberColumns,
  memberRefOrNull,
  num,
  numOrNull,
  type Row,
  text,
  type ToImageRef,
} from './rows.ts';

const COVER_ID = `(SELECT ri.image_id FROM collection_recipes cr JOIN recipe_images ri ON ri.recipe_id = cr.recipe_id
  WHERE cr.collection_id = c.id ORDER BY cr.position, ri.position LIMIT 1)`;

const SUMMARY_SELECT = `SELECT c.id, c.name, c.description, c.created_by, c.updated_at,
  (SELECT COUNT(*) FROM collection_recipes cr WHERE cr.collection_id = c.id) AS recipe_count,
  ${imageColumns('cv', 'cover')}, ${memberColumns('m', 'a', 'creator')}
  FROM collections c
  LEFT JOIN images cv ON cv.id = ${COVER_ID}
  LEFT JOIN members m ON m.id = c.created_by LEFT JOIN images a ON a.id = m.avatar_image_id`;

function canEditCollection(createdBy: Id | null, person: Person): boolean {
  return person.role === 'owner' || createdBy === person.id;
}

function toSummary(row: Row, person: Person, toImageRef: ToImageRef): CollectionSummary {
  return {
    id: num(row, 'id'),
    name: text(row, 'name'),
    description: text(row, 'description'),
    recipeCount: num(row, 'recipe_count'),
    cover: imageRefOrNull(row, 'cover', toImageRef),
    createdBy: memberRefOrNull(row, 'creator', toImageRef),
    canEdit: canEditCollection(numOrNull(row, 'created_by'), person),
    updatedAt: text(row, 'updated_at'),
  };
}

function listCollections(db: Database, person: Person, toImageRef: ToImageRef): { collections: CollectionSummary[] } {
  const rows = db.prepare(`${SUMMARY_SELECT} ORDER BY c.name COLLATE NOCASE, c.id`).all();
  return { collections: rows.map((row) => toSummary(row, person, toImageRef)) };
}

function collectionSummary(db: Database, id: Id, person: Person, toImageRef: ToImageRef): CollectionSummary | null {
  const row = db.prepare(`${SUMMARY_SELECT} WHERE c.id = ?`).get(id);
  return row === undefined ? null : toSummary(row, person, toImageRef);
}

function collection(ctx: AppContext, id: Id, person: Person): Collection {
  const summary = collectionSummary(ctx.db, id, person, imageRefsOf(ctx));
  if (summary === null) {
    throw problem('not_found');
  }
  const ids = ctx.db
    .prepare('SELECT recipe_id FROM collection_recipes WHERE collection_id = ? ORDER BY position')
    .all(id)
    .map((row) => num(row, 'recipe_id'));
  return { ...summary, recipes: recipeSummaries(ctx, ids, person.id) };
}

function refuseDuplicate(db: Database, name: string, except: Id | null): void {
  const folded = foldName(name);
  for (const row of db.prepare('SELECT id, name FROM collections').all()) {
    if (num(row, 'id') !== except && foldName(text(row, 'name')) === folded) {
      throw problem('duplicate_name', { detail: `There is already a collection called “${name.trim()}”.` });
    }
  }
}

function editable(ctx: AppContext, id: Id, person: Person): void {
  const summary = collectionSummary(ctx.db, id, person, imageRefsOf(ctx));
  if (summary === null) {
    throw problem('not_found');
  }
  if (!summary.canEdit) {
    throw problem('not_owner', { detail: `Only ${summary.createdBy?.name ?? 'the owner'} can change this.` });
  }
}

function touch(ctx: AppContext, id: Id): void {
  ctx.db.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(ctx.now().toISOString(), id);
}

function createCollection(ctx: AppContext, input: CollectionInput, person: Person): Collection {
  const id = withTransaction(ctx.db, () => {
    refuseDuplicate(ctx.db, input.name, null);
    const now = ctx.now().toISOString();
    const result = ctx.db
      .prepare('INSERT INTO collections (name, description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(input.name.trim(), input.description, person.id, now, now);
    return Number(result.lastInsertRowid);
  });
  return collection(ctx, id, person);
}

function updateCollection(ctx: AppContext, id: Id, patch: CollectionPatch, person: Person): Collection {
  withTransaction(ctx.db, () => {
    editable(ctx, id, person);
    if (patch.name !== undefined) {
      refuseDuplicate(ctx.db, patch.name, id);
      ctx.db.prepare('UPDATE collections SET name = ? WHERE id = ?').run(patch.name.trim(), id);
    }
    if (patch.description !== undefined) {
      ctx.db.prepare('UPDATE collections SET description = ? WHERE id = ?').run(patch.description, id);
    }
    const recipeIds = patch.recipeIds;
    if (recipeIds !== undefined) {
      const exists = ctx.db.prepare('SELECT 1 FROM recipes WHERE id = ?');
      const fields: FieldError[] = recipeIds.flatMap((recipeId, index): FieldError[] =>
        exists.get(recipeId) === undefined
          ? [{ path: `recipeIds.${index}`, code: 'not_found', message: 'This recipe no longer exists.' }]
          : [],
      );
      if (fields.length > 0) {
        throw problem('validation_failed', { fields });
      }
      ctx.db.prepare('DELETE FROM collection_recipes WHERE collection_id = ?').run(id);
      const insert = ctx.db.prepare(
        'INSERT OR IGNORE INTO collection_recipes (collection_id, recipe_id, position) VALUES (?, ?, ?)',
      );
      for (const [position, recipeId] of recipeIds.entries()) {
        insert.run(id, recipeId, position);
      }
    }
    touch(ctx, id);
  });
  return collection(ctx, id, person);
}

function deleteCollection(ctx: AppContext, id: Id, person: Person): undefined {
  withTransaction(ctx.db, () => {
    editable(ctx, id, person);
    ctx.db.prepare('DELETE FROM collections WHERE id = ?').run(id);
  });
}

function addRecipe(ctx: AppContext, id: Id, recipeId: Id, person: Person): Collection {
  withTransaction(ctx.db, () => {
    editable(ctx, id, person);
    if (ctx.db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(recipeId) === undefined) {
      throw problem('not_found');
    }
    const present = ctx.db
      .prepare('SELECT 1 FROM collection_recipes WHERE collection_id = ? AND recipe_id = ?')
      .get(id, recipeId);
    if (present !== undefined) {
      return;
    }
    const totals = ctx.db
      .prepare(
        'SELECT COUNT(*) AS count, COALESCE(MAX(position) + 1, 0) AS next FROM collection_recipes WHERE collection_id = ?',
      )
      .get(id);
    if (totals === undefined) {
      throw new Error('an aggregate query returned no row');
    }
    if (num(totals, 'count') >= LIMITS.collectionRecipes.max) {
      throw problem('validation_failed', {
        fields: [
          {
            path: 'recipeId',
            code: 'too_many',
            message: `A collection holds at most ${LIMITS.collectionRecipes.max} recipes.`,
          },
        ],
      });
    }
    ctx.db
      .prepare('INSERT INTO collection_recipes (collection_id, recipe_id, position) VALUES (?, ?, ?)')
      .run(id, recipeId, num(totals, 'next'));
    touch(ctx, id);
  });
  return collection(ctx, id, person);
}

function removeRecipe(ctx: AppContext, id: Id, recipeId: Id, person: Person): Collection {
  withTransaction(ctx.db, () => {
    editable(ctx, id, person);
    const result = ctx.db
      .prepare('DELETE FROM collection_recipes WHERE collection_id = ? AND recipe_id = ?')
      .run(id, recipeId);
    if (result.changes > 0) {
      touch(ctx, id);
    }
  });
  return collection(ctx, id, person);
}

export function registerCollections(app: FastifyInstance, ctx: AppContext): void {
  const toImageRef = imageRefsOf(ctx);
  route(app, 'listCollections', async (request) => listCollections(ctx.db, personOf(request), toImageRef));
  route(app, 'createCollection', async (request) => createCollection(ctx, request.body, personOf(request)));
  route(app, 'getCollection', async (request) => collection(ctx, request.params.id, personOf(request)));
  route(app, 'updateCollection', async (request) =>
    updateCollection(ctx, request.params.id, request.body, personOf(request)),
  );
  route(app, 'deleteCollection', async (request) => deleteCollection(ctx, request.params.id, personOf(request)));
  route(app, 'addRecipeToCollection', async (request) =>
    addRecipe(ctx, request.params.id, request.body.recipeId, personOf(request)),
  );
  route(app, 'removeRecipeFromCollection', async (request) =>
    removeRecipe(ctx, request.params.id, request.params.recipeId, personOf(request)),
  );
}
