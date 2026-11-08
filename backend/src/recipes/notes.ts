import {
  type FavoriteState,
  type FieldError,
  type Id,
  LIMITS,
  type MadeItState,
  type Note,
  type NoteInput,
  type NotePatch,
  type Page,
  type RatingInput,
  type RatingState,
  type TargetType,
  type Visibility,
} from '@cellar/contract';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../core/context.ts';
import { type Database, withTransaction } from '../core/db.ts';
import { personOf } from '../core/person.ts';
import { problem } from '../core/problems.ts';
import { route } from '../core/route.ts';
import { num, oneOf, textOrNull, imageRefsOf } from './rows.ts';
import { householdRating, type ToImageRef, visibleNote, visibleNotes } from './visibility.ts';

const TARGET_TABLE = { recipe: 'recipes', ingredient: 'ingredients' } as const;

export function requireTarget(db: Database, type: TargetType, id: Id): void {
  if (db.prepare(`SELECT 1 FROM ${TARGET_TABLE[type]} WHERE id = ?`).get(id) === undefined) {
    throw problem('not_found');
  }
}

function defaultVisibility(db: Database, member: Id): Visibility {
  const row = db.prepare('SELECT default_visibility FROM members WHERE id = ?').get(member);
  if (row === undefined) {
    throw new Error(`member ${member} has no row`);
  }
  return oneOf(row, 'default_visibility', ['household', 'private'] as const);
}

function noteFieldErrors(db: Database, type: TargetType, note: Required<Omit<NoteInput, 'visibility'>>): FieldError[] {
  const fields: FieldError[] = [];
  if (type === 'recipe' && note.verdict !== null) {
    fields.push({ path: 'verdict', code: 'verdict_not_allowed', message: 'Verdicts are for ingredients only.' });
  }
  if (note.text.trim() === '' && note.descriptorIds.length === 0) {
    fields.push({ path: 'text', code: 'note_empty', message: 'Write a note or pick at least one descriptor.' });
  }
  const exists = db.prepare('SELECT 1 FROM taste_descriptors WHERE id = ?');
  for (const [index, id] of note.descriptorIds.entries()) {
    if (exists.get(id) === undefined) {
      fields.push({ path: `descriptorIds.${index}`, code: 'not_found', message: 'This descriptor no longer exists.' });
    }
  }
  return fields;
}

function writeDescriptors(db: Database, noteId: Id, descriptorIds: readonly Id[]): void {
  db.prepare('DELETE FROM note_descriptors WHERE note_id = ?').run(noteId);
  const insert = db.prepare('INSERT OR IGNORE INTO note_descriptors (note_id, descriptor_id) VALUES (?, ?)');
  for (const id of descriptorIds) {
    insert.run(noteId, id);
  }
}

function loadNote(db: Database, noteId: Id, viewer: Id, toImageRef: ToImageRef): Note {
  const note = visibleNote(db, noteId, viewer, toImageRef);
  if (note === null) {
    throw new Error(`note ${noteId} vanished inside its own write`);
  }
  return note;
}

function createNote(
  ctx: AppContext,
  type: TargetType,
  targetId: Id,
  viewer: Id,
  input: NoteInput,
  toImageRef: ToImageRef,
): Note {
  return withTransaction(ctx.db, () => {
    requireTarget(ctx.db, type, targetId);
    const fields = noteFieldErrors(ctx.db, type, input);
    if (fields.length > 0) {
      throw problem('validation_failed', { fields });
    }
    const now = ctx.now().toISOString();
    const result = ctx.db
      .prepare(
        `INSERT INTO notes (member_id, target_type, target_id, text, tasted_on, verdict, visibility, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        viewer,
        type,
        targetId,
        input.text,
        input.tastedOn,
        input.verdict,
        input.visibility ?? defaultVisibility(ctx.db, viewer),
        now,
        now,
      );
    const noteId = Number(result.lastInsertRowid);
    writeDescriptors(ctx.db, noteId, input.descriptorIds);
    return loadNote(ctx.db, noteId, viewer, toImageRef);
  });
}

function ownNote(db: Database, noteId: Id, viewer: Id, toImageRef: ToImageRef): Note {
  const note = visibleNote(db, noteId, viewer, toImageRef);
  if (note === null) {
    throw problem('not_found');
  }
  if (!note.mine) {
    throw problem('not_owner', { detail: `Only ${note.author.name} can change this.` });
  }
  return note;
}

function updateNote(ctx: AppContext, noteId: Id, viewer: Id, patch: NotePatch, toImageRef: ToImageRef): Note {
  return withTransaction(ctx.db, () => {
    const current = ownNote(ctx.db, noteId, viewer, toImageRef);
    const next = {
      text: patch.text ?? current.text,
      tastedOn: patch.tastedOn ?? current.tastedOn,
      verdict: patch.verdict === undefined ? current.verdict : patch.verdict,
      descriptorIds: patch.descriptorIds ?? current.descriptors.map((descriptor) => descriptor.id),
    };
    const fields = noteFieldErrors(ctx.db, current.target.type, next);
    if (fields.length > 0) {
      throw problem('validation_failed', { fields });
    }
    ctx.db
      .prepare('UPDATE notes SET text = ?, tasted_on = ?, verdict = ?, visibility = ?, updated_at = ? WHERE id = ?')
      .run(
        next.text,
        next.tastedOn,
        next.verdict,
        patch.visibility ?? current.visibility,
        ctx.now().toISOString(),
        noteId,
      );
    if (patch.descriptorIds !== undefined) {
      writeDescriptors(ctx.db, noteId, patch.descriptorIds);
    }
    return loadNote(ctx.db, noteId, viewer, toImageRef);
  });
}

function deleteNote(ctx: AppContext, noteId: Id, viewer: Id, toImageRef: ToImageRef): undefined {
  withTransaction(ctx.db, () => {
    ownNote(ctx.db, noteId, viewer, toImageRef);
    ctx.db.prepare('DELETE FROM notes WHERE id = ?').run(noteId);
  });
}

function notePage(
  ctx: AppContext,
  type: TargetType,
  targetId: Id,
  viewer: Id,
  query: { page?: number; pageSize?: number },
  toImageRef: ToImageRef,
): Page<Note> {
  requireTarget(ctx.db, type, targetId);
  const notes = visibleNotes(ctx.db, { type, id: targetId }, viewer, toImageRef);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? LIMITS.pageSize.default;
  return { items: notes.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: notes.length };
}

function rate(ctx: AppContext, type: TargetType, targetId: Id, viewer: Id, input: RatingInput): RatingState {
  return withTransaction(ctx.db, () => {
    requireTarget(ctx.db, type, targetId);
    const now = ctx.now().toISOString();
    ctx.db
      .prepare(
        `INSERT INTO ratings (member_id, target_type, target_id, value, visibility, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (member_id, target_type, target_id)
         DO UPDATE SET value = excluded.value, visibility = excluded.visibility, updated_at = excluded.updated_at`,
      )
      .run(viewer, type, targetId, input.value, input.visibility ?? defaultVisibility(ctx.db, viewer), now, now);
    return householdRating(ctx.db, { type, id: targetId }, viewer);
  });
}

function clearRating(ctx: AppContext, type: TargetType, targetId: Id, viewer: Id): RatingState {
  return withTransaction(ctx.db, () => {
    requireTarget(ctx.db, type, targetId);
    ctx.db
      .prepare('DELETE FROM ratings WHERE member_id = ? AND target_type = ? AND target_id = ?')
      .run(viewer, type, targetId);
    return householdRating(ctx.db, { type, id: targetId }, viewer);
  });
}

function setFavorite(ctx: AppContext, recipeId: Id, viewer: Id, favorite: boolean): FavoriteState {
  requireTarget(ctx.db, 'recipe', recipeId);
  if (favorite) {
    ctx.db
      .prepare('INSERT OR IGNORE INTO favorites (member_id, recipe_id, created_at) VALUES (?, ?, ?)')
      .run(viewer, recipeId, ctx.now().toISOString());
  } else {
    ctx.db.prepare('DELETE FROM favorites WHERE member_id = ? AND recipe_id = ?').run(viewer, recipeId);
  }
  return { favorite };
}

export function madeItState(db: Database, recipeId: Id, viewer: Id, entryId: Id | null): MadeItState {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS household, COALESCE(SUM(member_id = ?), 0) AS mine, MAX(made_at) AS last_made_at
       FROM made_it WHERE recipe_id = ?`,
    )
    .get(viewer, recipeId);
  if (row === undefined) {
    throw new Error('an aggregate query returned no row');
  }
  return {
    entryId,
    mine: { count: num(row, 'mine') },
    household: { count: num(row, 'household'), lastMadeAt: textOrNull(row, 'last_made_at') },
  };
}

function recordMadeIt(ctx: AppContext, recipeId: Id, viewer: Id): MadeItState {
  return withTransaction(ctx.db, () => {
    requireTarget(ctx.db, 'recipe', recipeId);
    const result = ctx.db
      .prepare('INSERT INTO made_it (member_id, recipe_id, made_at) VALUES (?, ?, ?)')
      .run(viewer, recipeId, ctx.now().toISOString());
    return madeItState(ctx.db, recipeId, viewer, Number(result.lastInsertRowid));
  });
}

function undoMadeIt(ctx: AppContext, entryId: Id, viewer: Id): MadeItState {
  return withTransaction(ctx.db, () => {
    const row = ctx.db.prepare('SELECT member_id, recipe_id FROM made_it WHERE id = ?').get(entryId);
    if (row === undefined) {
      throw problem('not_found');
    }
    if (num(row, 'member_id') !== viewer) {
      throw problem('not_owner', { detail: 'Only the person who made it can undo this.' });
    }
    ctx.db.prepare('DELETE FROM made_it WHERE id = ?').run(entryId);
    return madeItState(ctx.db, num(row, 'recipe_id'), viewer, null);
  });
}

export function registerNotes(app: FastifyInstance, ctx: AppContext): void {
  const toImageRef = imageRefsOf(ctx);

  route(app, 'listRecipeNotes', async (request) =>
    notePage(ctx, 'recipe', request.params.id, personOf(request).id, request.query, toImageRef),
  );
  route(app, 'listIngredientNotes', async (request) =>
    notePage(ctx, 'ingredient', request.params.id, personOf(request).id, request.query, toImageRef),
  );
  route(app, 'createRecipeNote', async (request) =>
    createNote(ctx, 'recipe', request.params.id, personOf(request).id, request.body, toImageRef),
  );
  route(app, 'createIngredientNote', async (request) =>
    createNote(ctx, 'ingredient', request.params.id, personOf(request).id, request.body, toImageRef),
  );
  route(app, 'updateNote', async (request) =>
    updateNote(ctx, request.params.id, personOf(request).id, request.body, toImageRef),
  );
  route(app, 'deleteNote', async (request) => deleteNote(ctx, request.params.id, personOf(request).id, toImageRef));
  route(app, 'rateRecipe', async (request) =>
    rate(ctx, 'recipe', request.params.id, personOf(request).id, request.body),
  );
  route(app, 'rateIngredient', async (request) =>
    rate(ctx, 'ingredient', request.params.id, personOf(request).id, request.body),
  );
  route(app, 'clearRecipeRating', async (request) =>
    clearRating(ctx, 'recipe', request.params.id, personOf(request).id),
  );
  route(app, 'clearIngredientRating', async (request) =>
    clearRating(ctx, 'ingredient', request.params.id, personOf(request).id),
  );
  route(app, 'favoriteRecipe', async (request) => setFavorite(ctx, request.params.id, personOf(request).id, true));
  route(app, 'unfavoriteRecipe', async (request) => setFavorite(ctx, request.params.id, personOf(request).id, false));
  route(app, 'recordMadeIt', async (request) => recordMadeIt(ctx, request.params.id, personOf(request).id));
  route(app, 'undoMadeIt', async (request) => undoMadeIt(ctx, request.params.entryId, personOf(request).id));
}
