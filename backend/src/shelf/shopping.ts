import type {
  HouseholdSubstitution,
  Id,
  MemberRef,
  ShoppingList,
  ShoppingListChange,
  SubstitutionInput,
} from '@cellar/contract';
import type { Person } from '../core/access.ts';
import type { AppContext } from '../core/context.ts';
import { withTransaction } from '../core/db.ts';
import { problem } from '../core/problems.ts';
import { byName, imageRef, ingredientRef, loadTaxonomy, rootOf } from './refs.ts';
import { fieldProblem, imageColumns, imageRowOrNull, num, numOrNull, oneOf, type Row, text } from './rows.ts';
import { type OnHandSet, onHandIngredientIds } from './satisfaction.ts';

const EFFECTS = ['same_drink', 'changes_drink'] as const;

function memberRefOf(ctx: AppContext, row: Row, prefix: string): MemberRef | null {
  const id = numOrNull(row, `${prefix}_id`);
  if (id === null) {
    return null;
  }
  return { id, name: text(row, `${prefix}_name`), avatar: imageRef(ctx, imageRowOrNull(row, `${prefix}_avatar`)) };
}

function memberJoin(column: string, prefix: string): { columns: string; joins: string } {
  return {
    columns: `${prefix}.id AS ${prefix}_id, ${prefix}.name AS ${prefix}_name, ${imageColumns(`${prefix}_a`, `${prefix}_avatar`)}`,
    joins: `LEFT JOIN members ${prefix} ON ${prefix}.id = ${column}
      LEFT JOIN images ${prefix}_a ON ${prefix}_a.id = ${prefix}.avatar_image_id`,
  };
}

const ADDED_BY = memberJoin('s.added_by', 'm');

export function getShoppingList(ctx: AppContext): ShoppingList {
  const taxonomy = loadTaxonomy(ctx);
  const onHand = onHandIngredientIds(ctx.db);
  const rows = ctx.db
    .prepare(
      `SELECT s.id, s.ingredient_id, s.count, s.created_at, i.name AS ingredient_name, ${ADDED_BY.columns}
       FROM shopping_items s JOIN ingredients i ON i.id = s.ingredient_id ${ADDED_BY.joins}`,
    )
    .all();
  const entries = rows.map((row) => {
    const ingredientId = num(row, 'ingredient_id');
    const node = taxonomy.nodes.get(ingredientId);
    if (node === undefined) {
      throw new Error(`shopping item names missing ingredient ${ingredientId}`);
    }
    const root = taxonomy.nodes.get(rootOf(taxonomy, node).id) ?? node;
    return { row, node, root };
  });
  entries.sort((a, b) => byName(a.root, b.root) || byName(a.node, b.node));
  let updatedAt: string | null = null;
  const items = entries.map(({ row, node }) => {
    const addedAt = text(row, 'created_at');
    if (updatedAt === null || addedAt > updatedAt) {
      updatedAt = addedAt;
    }
    return {
      id: num(row, 'id'),
      ingredient: ingredientRef(node.id, node.name, onHand),
      count: num(row, 'count'),
      addedBy: memberRefOf(ctx, row, 'm'),
      addedAt,
    };
  });
  return { items, updatedAt };
}

function addItems(
  ctx: AppContext,
  person: Person,
  items: readonly { ingredientId: Id; count?: number | undefined }[],
): ShoppingListChange {
  const counts = withTransaction(ctx.db, () => {
    let added = 0;
    let alreadyListed = 0;
    const existing = ctx.db.prepare('SELECT id, count FROM shopping_items WHERE ingredient_id = ?');
    const insert = ctx.db.prepare(
      'INSERT INTO shopping_items (ingredient_id, count, added_by, created_at) VALUES (?, ?, ?, ?)',
    );
    const raise = ctx.db.prepare('UPDATE shopping_items SET count = MAX(count, ?) WHERE id = ?');
    const stamp = ctx.now().toISOString();
    for (const item of items) {
      const count = item.count ?? 1;
      const row = existing.get(item.ingredientId);
      if (row === undefined) {
        insert.run(item.ingredientId, count, person.id, stamp);
        added += 1;
      } else {
        raise.run(count, num(row, 'id'));
        alreadyListed += 1;
      }
    }
    return { added, alreadyListed };
  });
  return { ...counts, list: getShoppingList(ctx) };
}

export function addToShoppingList(
  ctx: AppContext,
  person: Person,
  items: readonly { ingredientId: Id; count?: number | undefined }[],
): ShoppingListChange {
  const known = ctx.db.prepare('SELECT 1 FROM ingredients WHERE id = ?');
  for (const [index, item] of items.entries()) {
    if (known.get(item.ingredientId) === undefined) {
      throw fieldProblem(`items.${index}.ingredientId`, 'not_found', 'That ingredient no longer exists.');
    }
  }
  return addItems(ctx, person, items);
}

export function addIngredientToShoppingList(ctx: AppContext, person: Person, id: Id): ShoppingListChange {
  if (ctx.db.prepare('SELECT 1 FROM ingredients WHERE id = ?').get(id) === undefined) {
    throw problem('not_found');
  }
  return addItems(ctx, person, [{ ingredientId: id }]);
}

export function updateShoppingItem(ctx: AppContext, id: Id, count: number): ShoppingList {
  if (ctx.db.prepare('UPDATE shopping_items SET count = ? WHERE id = ?').run(count, id).changes === 0) {
    throw problem('not_found');
  }
  return getShoppingList(ctx);
}

export function checkOffShoppingItem(ctx: AppContext, id: Id): ShoppingList {
  if (ctx.db.prepare('DELETE FROM shopping_items WHERE id = ?').run(id).changes === 0) {
    throw problem('not_found');
  }
  return getShoppingList(ctx);
}

const CREATED_BY = memberJoin('h.created_by', 'c');
const SUBSTITUTION_SELECT = `SELECT h.id, h.on_hand_ingredient_id, h.for_ingredient_id, h.effect, h.created_at,
  f.name AS from_name, t.name AS to_name, ${CREATED_BY.columns}
FROM household_substitutions h
JOIN ingredients f ON f.id = h.on_hand_ingredient_id
JOIN ingredients t ON t.id = h.for_ingredient_id
${CREATED_BY.joins}`;

function substitutionOf(ctx: AppContext, row: Row, onHand: OnHandSet): HouseholdSubstitution {
  return {
    id: num(row, 'id'),
    from: ingredientRef(num(row, 'on_hand_ingredient_id'), text(row, 'from_name'), onHand),
    to: ingredientRef(num(row, 'for_ingredient_id'), text(row, 'to_name'), onHand),
    effect: oneOf(row, 'effect', EFFECTS),
    createdBy: memberRefOf(ctx, row, 'c'),
    createdAt: text(row, 'created_at'),
  };
}

export function listSubstitutions(ctx: AppContext): { substitutions: HouseholdSubstitution[] } {
  const onHand = onHandIngredientIds(ctx.db);
  return {
    substitutions: ctx.db
      .prepare(`${SUBSTITUTION_SELECT} ORDER BY f.folded_name, h.id`)
      .all()
      .map((row) => substitutionOf(ctx, row, onHand)),
  };
}

export function createSubstitution(ctx: AppContext, person: Person, input: SubstitutionInput): HouseholdSubstitution {
  if (input.fromIngredientId === input.toIngredientId) {
    throw fieldProblem('toIngredientId', 'same_ingredient', 'Pick two different ingredients.');
  }
  const id = withTransaction(ctx.db, () => {
    const name = ctx.db.prepare('SELECT name FROM ingredients WHERE id = ?');
    const from = name.get(input.fromIngredientId);
    if (from === undefined) {
      throw fieldProblem('fromIngredientId', 'not_found', 'That ingredient no longer exists.');
    }
    const to = name.get(input.toIngredientId);
    if (to === undefined) {
      throw fieldProblem('toIngredientId', 'not_found', 'That ingredient no longer exists.');
    }
    const clash = ctx.db
      .prepare('SELECT 1 FROM household_substitutions WHERE on_hand_ingredient_id = ? AND for_ingredient_id = ?')
      .get(input.fromIngredientId, input.toIngredientId);
    if (clash !== undefined) {
      throw problem('duplicate_name', {
        detail: `There is already a substitution treating “${text(from, 'name')}” as “${text(to, 'name')}”.`,
      });
    }
    const result = ctx.db
      .prepare(
        `INSERT INTO household_substitutions (on_hand_ingredient_id, for_ingredient_id, effect, created_by, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.fromIngredientId, input.toIngredientId, input.effect, person.id, ctx.now().toISOString());
    return Number(result.lastInsertRowid);
  });
  const row = ctx.db.prepare(`${SUBSTITUTION_SELECT} WHERE h.id = ?`).get(id);
  if (row === undefined) {
    throw new Error(`substitution ${id} vanished after insert`);
  }
  return substitutionOf(ctx, row, onHandIngredientIds(ctx.db));
}

export function deleteSubstitution(ctx: AppContext, id: Id): undefined {
  if (ctx.db.prepare('DELETE FROM household_substitutions WHERE id = ?').run(id).changes === 0) {
    throw problem('not_found');
  }
}
