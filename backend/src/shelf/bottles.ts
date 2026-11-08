import {
  type Bottle,
  type BottleInput,
  type BottleListQuery,
  type BottlePage,
  type BottlePatch,
  type BottleStatus,
  type BottleSummary,
  type BulkBottleInput,
  type BulkBottleResult,
  foldName,
  type Id,
  type IsoDate,
  LIMITS,
  parseLabeledSize,
  type ShelfTotals,
} from '@cellar/contract';
import type { Person } from '../core/access.ts';
import type { AppContext } from '../core/context.ts';
import { withTransaction } from '../core/db.ts';
import { problem } from '../core/problems.ts';
import { descendantsAndSelf, imageRef, ingredientRef, loadTaxonomy, rootOf, type Taxonomy } from './refs.ts';
import {
  fieldProblem,
  imageColumns,
  imageRowOrNull,
  num,
  numOrNull,
  oneOf,
  type Row,
  text,
  textOrNull,
} from './rows.ts';
import { type OnHandSet, onHandIngredientIds } from './satisfaction.ts';

const STATUSES: readonly BottleStatus[] = ['sealed', 'open', 'finished'];
const SHELF: readonly BottleStatus[] = ['sealed', 'open'];

export const BOTTLE_SELECT = `SELECT b.id, b.name, b.ingredient_id, b.labeled_size, b.volume_ml, b.abv, b.price_paid_minor,
  b.purchased_on, b.opened_on, b.finished_on, b.status, b.note, b.created_at, b.updated_at,
  i.name AS ingredient_name, ${imageColumns('im', 'image')}
FROM bottles b JOIN ingredients i ON i.id = b.ingredient_id LEFT JOIN images im ON im.id = b.image_id`;

export interface ShelfView {
  readonly taxonomy: Taxonomy;
  readonly onHand: OnHandSet;
}

export function shelfView(ctx: AppContext): ShelfView {
  return { taxonomy: loadTaxonomy(ctx), onHand: onHandIngredientIds(ctx.db) };
}

export function bottleSummaryOf(ctx: AppContext, view: ShelfView, row: Row): BottleSummary {
  const ingredientId = num(row, 'ingredient_id');
  const ingredientName = text(row, 'ingredient_name');
  const node = view.taxonomy.nodes.get(ingredientId);
  return {
    id: num(row, 'id'),
    name: text(row, 'name'),
    status: oneOf(row, 'status', STATUSES),
    ingredient: ingredientRef(ingredientId, ingredientName, view.onHand),
    root: node === undefined ? { id: ingredientId, name: ingredientName } : rootOf(view.taxonomy, node),
    labeledSize: text(row, 'labeled_size'),
    image: imageRef(ctx, imageRowOrNull(row, 'image')),
    openedOn: textOrNull(row, 'opened_on'),
    finishedOn: textOrNull(row, 'finished_on'),
    pricePaidMinor: numOrNull(row, 'price_paid_minor'),
  };
}

function bottleOf(ctx: AppContext, view: ShelfView, row: Row): Bottle {
  return {
    ...bottleSummaryOf(ctx, view, row),
    volumeMl: numOrNull(row, 'volume_ml'),
    abv: numOrNull(row, 'abv'),
    purchasedOn: textOrNull(row, 'purchased_on'),
    note: text(row, 'note'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}

function bottleRow(ctx: AppContext, id: Id): Row {
  const row = ctx.db.prepare(`${BOTTLE_SELECT} WHERE b.id = ?`).get(id);
  if (row === undefined) {
    throw problem('not_found');
  }
  return row;
}

export function getBottle(ctx: AppContext, id: Id): Bottle {
  return bottleOf(ctx, shelfView(ctx), bottleRow(ctx, id));
}

function compareNullable(a: string | number | null, b: string | number | null): number {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  return a < b ? -1 : 1;
}

export function listBottles(ctx: AppContext, person: Person, query: BottleListQuery): BottlePage {
  const sort = query.sort ?? 'name';
  if (sort === 'price' && !person.showPrices) {
    throw problem('prices_hidden');
  }
  const view = shelfView(ctx);
  const statuses = query.status ?? SHELF;
  const rows = ctx.db
    .prepare(`${BOTTLE_SELECT} WHERE b.status IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify(statuses));
  const underRoot = query.root === undefined ? null : descendantsAndSelf(view.taxonomy, query.root);
  const needle = query.q === undefined ? null : foldName(query.q);
  const items = rows
    .filter(
      (row) =>
        (query.ingredient === undefined || num(row, 'ingredient_id') === query.ingredient) &&
        (underRoot === null || underRoot.has(num(row, 'ingredient_id'))) &&
        (needle === null || foldName(text(row, 'name')).includes(needle)),
    )
    .map((row) => ({ row, summary: bottleSummaryOf(ctx, view, row) }));

  const key = (entry: (typeof items)[number]): (string | number | null)[] => {
    const name = foldName(entry.summary.name);
    switch (sort) {
      case 'name':
        return [name];
      case 'category':
        return [foldName(entry.summary.root.name), foldName(entry.summary.ingredient.name), name];
      case 'opened':
        return [entry.summary.openedOn, name];
      case 'finished':
        return [entry.summary.finishedOn, name];
      case 'price':
        return [entry.summary.pricePaidMinor ?? null, name];
      case 'added':
        return [text(entry.row, 'created_at'), name];
    }
  };
  const direction = (query.order ?? (sort === 'name' || sort === 'category' ? 'asc' : 'desc')) === 'asc' ? 1 : -1;
  items.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      const order = compareNullable(ka[i], kb[i]);
      if (order !== 0) {
        return ka[i] === null || kb[i] === null ? order : order * direction;
      }
    }
    return (a.summary.id - b.summary.id) * direction;
  });

  const priced = items.filter((entry) => entry.summary.pricePaidMinor !== null);
  const totals: ShelfTotals = {
    count: items.length,
    sealed: items.filter((entry) => entry.summary.status === 'sealed').length,
    open: items.filter((entry) => entry.summary.status === 'open').length,
    priced: priced.length,
    valueMinor: priced.reduce((sum, entry) => sum + (entry.summary.pricePaidMinor ?? 0), 0),
  };
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? LIMITS.pageSize.default;
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize).map((entry) => entry.summary),
    page,
    pageSize,
    total: items.length,
    totals,
  };
}

function requireIngredient(ctx: AppContext, id: Id): void {
  if (ctx.db.prepare('SELECT 1 FROM ingredients WHERE id = ?').get(id) === undefined) {
    throw fieldProblem('ingredientId', 'not_found', 'That ingredient no longer exists.');
  }
}

function requireImage(ctx: AppContext, id: Id | null): void {
  if (id !== null && ctx.db.prepare('SELECT 1 FROM images WHERE id = ?').get(id) === undefined) {
    throw fieldProblem('imageId', 'not_found', 'That image no longer exists.');
  }
}

export function createBottles(ctx: AppContext, person: Person, input: BottleInput): { bottles: Bottle[] } {
  if (input.status === 'open' && input.openedOn === null) {
    throw fieldProblem('openedOn', 'required', 'Enter an opened date.');
  }
  const ids = withTransaction(ctx.db, () => {
    requireIngredient(ctx, input.ingredientId);
    requireImage(ctx, input.imageId);
    const stamp = ctx.now().toISOString();
    const insert = ctx.db.prepare(
      `INSERT INTO bottles (name, ingredient_id, labeled_size, volume_ml, abv, price_paid_minor, purchased_on, opened_on,
         status, note, image_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const volumeMl = input.volumeMl ?? parseLabeledSize(input.labeledSize);
    const created: Id[] = [];
    for (let i = 0; i < input.count; i++) {
      const result = insert.run(
        input.name,
        input.ingredientId,
        input.labeledSize,
        volumeMl,
        input.abv,
        input.pricePaidMinor,
        input.purchasedOn,
        input.openedOn,
        input.status,
        input.note,
        input.imageId,
        person.id,
        stamp,
        stamp,
      );
      created.push(Number(result.lastInsertRowid));
    }
    return created;
  });
  const view = shelfView(ctx);
  return { bottles: ids.map((id) => bottleOf(ctx, view, bottleRow(ctx, id))) };
}

export function updateBottle(ctx: AppContext, id: Id, patch: BottlePatch): Bottle {
  withTransaction(ctx.db, () => {
    const status = oneOf(bottleRow(ctx, id), 'status', STATUSES);
    if (patch.ingredientId !== undefined) {
      requireIngredient(ctx, patch.ingredientId);
    }
    if (patch.imageId !== undefined) {
      requireImage(ctx, patch.imageId);
    }
    if (patch.finishedOn !== undefined && (status === 'finished') !== (patch.finishedOn !== null)) {
      throw fieldProblem('finishedOn', 'invalid_value', 'Only a finished bottle has a finished date.');
    }
    const assignments: [string, string | number | null | undefined][] = [
      ['name', patch.name],
      ['ingredient_id', patch.ingredientId],
      ['labeled_size', patch.labeledSize],
      ['volume_ml', patch.volumeMl],
      ['abv', patch.abv],
      ['price_paid_minor', patch.pricePaidMinor],
      ['purchased_on', patch.purchasedOn],
      ['opened_on', patch.openedOn],
      ['note', patch.note],
      ['image_id', patch.imageId],
      ['finished_on', patch.finishedOn],
    ];
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [column, value] of assignments) {
      if (value !== undefined) {
        sets.push(`${column} = ?`);
        values.push(value);
      }
    }
    if (sets.length > 0) {
      ctx.db
        .prepare(`UPDATE bottles SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
        .run(...values, ctx.now().toISOString(), id);
    }
  });
  return getBottle(ctx, id);
}

export function deleteBottle(ctx: AppContext, id: Id): undefined {
  if (ctx.db.prepare('DELETE FROM bottles WHERE id = ?').run(id).changes === 0) {
    throw problem('not_found');
  }
}

type Action = 'open' | 'finish' | 'reopen';

interface Transition {
  readonly status: BottleStatus;
  readonly openedOn: IsoDate | null;
  readonly finishedOn: IsoDate | null;
}

function transition(action: Action, current: Transition, on: IsoDate | null): Transition | null {
  switch (action) {
    case 'open':
      return current.status === 'sealed' ? { status: 'open', openedOn: on, finishedOn: null } : null;
    case 'finish':
      return current.status === 'finished'
        ? null
        : { status: 'finished', openedOn: current.status === 'sealed' ? on : current.openedOn, finishedOn: on };
    case 'reopen':
      return current.status === 'finished'
        ? { status: current.openedOn === null ? 'sealed' : 'open', openedOn: current.openedOn, finishedOn: null }
        : null;
  }
}

function applyAction(ctx: AppContext, id: Id, action: Action, on: IsoDate | null): 'done' | 'not_found' | BottleStatus {
  const row = ctx.db.prepare('SELECT status, opened_on, finished_on FROM bottles WHERE id = ?').get(id);
  if (row === undefined) {
    return 'not_found';
  }
  const current: Transition = {
    status: oneOf(row, 'status', STATUSES),
    openedOn: textOrNull(row, 'opened_on'),
    finishedOn: textOrNull(row, 'finished_on'),
  };
  const next = transition(action, current, on);
  if (next === null) {
    return current.status;
  }
  ctx.db
    .prepare('UPDATE bottles SET status = ?, opened_on = ?, finished_on = ?, updated_at = ? WHERE id = ?')
    .run(next.status, next.openedOn, next.finishedOn, ctx.now().toISOString(), id);
  return 'done';
}

export function bottleAction(ctx: AppContext, id: Id, action: Action, on: IsoDate | null): Bottle {
  const outcome = withTransaction(ctx.db, () => applyAction(ctx, id, action, on));
  if (outcome === 'not_found') {
    throw problem('not_found');
  }
  if (outcome !== 'done') {
    throw problem('invalid_transition', { detail: `This bottle is already ${outcome}.` });
  }
  return getBottle(ctx, id);
}

export function bulkBottles(ctx: AppContext, input: BulkBottleInput): BulkBottleResult {
  return withTransaction(ctx.db, () => {
    let affected = 0;
    const skipped: BulkBottleResult['skipped'] = [];
    const remove = ctx.db.prepare('DELETE FROM bottles WHERE id = ?');
    for (const id of input.ids) {
      if (input.action === 'delete') {
        if (remove.run(id).changes === 0) {
          skipped.push({ id, reason: 'not_found' });
        } else {
          affected += 1;
        }
        continue;
      }
      const outcome = applyAction(ctx, id, input.action, input.on);
      if (outcome === 'done') {
        affected += 1;
      } else {
        skipped.push({ id, reason: outcome === 'not_found' ? 'not_found' : 'invalid_transition' });
      }
    }
    return { affected, skipped };
  });
}
