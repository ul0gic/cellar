import {
  type GotItResult,
  type Id,
  type IngredientRef,
  LIMITS,
  type MemberRef,
  type Wishlist,
  type WishlistItem,
  type WishlistItemInput,
  type WishlistItemPatch,
} from '@cellar/contract';
import type { FastifyInstance } from 'fastify';
import type { Person } from '../core/access.ts';
import type { AppContext } from '../core/context.ts';
import { withTransaction } from '../core/db.ts';
import { personOf } from '../core/person.ts';
import { problem } from '../core/problems.ts';
import { route } from '../core/route.ts';
import { IMAGE_COLUMNS, imageRowOrNull, num, type Row, str, strOrNull } from '../search/rows.ts';
import { type OnHandSet, onHandIngredientIds } from '../shelf/satisfaction.ts';

const ITEM_COLUMNS =
  'w.id, w.member_id, w.position, w.name, w.note, w.url, w.created_at, mm.name AS member_name, g.id AS ingredient_id, g.name AS ingredient_name';
const ITEM_FROM =
  'FROM wishlist_items w JOIN members mm ON mm.id = w.member_id LEFT JOIN ingredients g ON g.id = w.ingredient_id';

function ingredientRef(row: Row, onHand: OnHandSet): IngredientRef | null {
  const id = row.ingredient_id;
  if (id === null) {
    return null;
  }
  const ingredientId = num(row, 'ingredient_id');
  return { id: ingredientId, name: str(row, 'ingredient_name'), onHand: onHand.has(ingredientId) };
}

function itemOf(row: Row, onHand: OnHandSet): WishlistItem {
  return {
    id: num(row, 'id'),
    name: str(row, 'name'),
    ingredient: ingredientRef(row, onHand),
    note: str(row, 'note'),
    url: strOrNull(row, 'url'),
    position: num(row, 'position'),
    createdAt: str(row, 'created_at'),
  };
}

export function register(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  const memberRef = (row: Row): MemberRef => {
    const image = imageRowOrNull(row);
    return {
      id: num(row, 'id'),
      name: str(row, 'name'),
      avatar: image === null ? null : ctx.media.imageRef(image, ctx.settings.basePath),
    };
  };

  const loadItem = (id: Id): WishlistItem & { readonly memberId: Id; readonly memberName: string } => {
    const row = db.prepare(`SELECT ${ITEM_COLUMNS} ${ITEM_FROM} WHERE w.id = ?`).get(id);
    if (row === undefined) {
      throw problem('not_found');
    }
    return {
      ...itemOf(row, onHandIngredientIds(db)),
      memberId: num(row, 'member_id'),
      memberName: str(row, 'member_name'),
    };
  };

  const ownItem = (id: Id, person: Person): WishlistItem => {
    const { memberId, memberName, ...item } = loadItem(id);
    if (memberId !== person.id) {
      throw problem('not_owner', { detail: `Only ${memberName} can change this.` });
    }
    return item;
  };

  const ingredientExists = (id: Id | null): boolean =>
    id === null || db.prepare('SELECT 1 FROM ingredients WHERE id = ?').get(id) !== undefined;

  const ingredientMissing = () =>
    problem('validation_failed', {
      fields: [{ path: 'ingredientId', code: 'not_found', message: 'That ingredient no longer exists.' }],
    });

  const listsFor = (viewer: Id, only?: Id): Wishlist[] => {
    const onHand = onHandIngredientIds(db);
    const members = db
      .prepare(
        `SELECT m.id, m.name, ${IMAGE_COLUMNS} FROM members m LEFT JOIN images i ON i.id = m.avatar_image_id
         ${only === undefined ? '' : 'WHERE m.id = ?'}
         ORDER BY m.id = ? DESC, m.folded_name, m.id`,
      )
      .all(...(only === undefined ? [viewer] : [only, viewer]));
    const items = db
      .prepare(
        `SELECT ${ITEM_COLUMNS} ${ITEM_FROM} ${only === undefined ? '' : 'WHERE w.member_id = ?'} ORDER BY w.position, w.id`,
      )
      .all(...(only === undefined ? [] : [only]));
    const byMember = new Map<Id, WishlistItem[]>();
    for (const row of items) {
      const memberId = num(row, 'member_id');
      const list = byMember.get(memberId) ?? [];
      list.push(itemOf(row, onHand));
      byMember.set(memberId, list);
    }
    return members.map((row) => {
      const person = memberRef(row);
      return { person, mine: person.id === viewer, items: byMember.get(person.id) ?? [] };
    });
  };

  const addItem = (person: Person, input: WishlistItemInput): WishlistItem => {
    if (!ingredientExists(input.ingredientId)) {
      throw ingredientMissing();
    }
    const id = withTransaction(db, () => {
      const countRow = db.prepare('SELECT count(*) AS n FROM wishlist_items WHERE member_id = ?').get(person.id);
      const count = countRow === undefined ? 0 : num(countRow, 'n');
      if (count >= LIMITS.wishlistItems.max) {
        throw problem('validation_failed', {
          fields: [
            { path: 'name', code: 'too_many', message: `A wishlist holds at most ${LIMITS.wishlistItems.max} items.` },
          ],
        });
      }
      const now = ctx.now().toISOString();
      const result = db
        .prepare(
          `INSERT INTO wishlist_items (member_id, position, name, ingredient_id, note, url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(person.id, count, input.name, input.ingredientId, input.note, input.url, now, now);
      return Number(result.lastInsertRowid);
    });
    return ownItem(id, person);
  };

  const updateItem = (person: Person, id: Id, patch: WishlistItemPatch): WishlistItem => {
    const current = ownItem(id, person);
    if (patch.ingredientId !== undefined && !ingredientExists(patch.ingredientId)) {
      throw ingredientMissing();
    }
    db.prepare(
      'UPDATE wishlist_items SET name = ?, ingredient_id = ?, note = ?, url = ?, updated_at = ? WHERE id = ?',
    ).run(
      patch.name ?? current.name,
      patch.ingredientId === undefined ? (current.ingredient?.id ?? null) : patch.ingredientId,
      patch.note ?? current.note,
      patch.url === undefined ? current.url : patch.url,
      ctx.now().toISOString(),
      id,
    );
    return ownItem(id, person);
  };

  const removeItem = (id: Id, person: Person): WishlistItem =>
    withTransaction(db, () => {
      const item = ownItem(id, person);
      db.prepare('DELETE FROM wishlist_items WHERE id = ?').run(id);
      db.prepare('UPDATE wishlist_items SET position = position - 1 WHERE member_id = ? AND position > ?').run(
        person.id,
        item.position,
      );
      return item;
    });

  const reorder = (person: Person, ids: readonly Id[]): Wishlist => {
    withTransaction(db, () => {
      const own = db
        .prepare('SELECT id FROM wishlist_items WHERE member_id = ?')
        .all(person.id)
        .map((row) => num(row, 'id'));
      const ownSet = new Set(own);
      if (ids.length !== own.length || new Set(ids).size !== ids.length || !ids.every((id) => ownSet.has(id))) {
        throw problem('validation_failed', {
          fields: [{ path: 'ids', code: 'order_mismatch', message: 'Send every item on your list exactly once.' }],
        });
      }
      const update = db.prepare('UPDATE wishlist_items SET position = ? WHERE id = ?');
      for (const [position, id] of ids.entries()) {
        update.run(position, id);
      }
    });
    const [list] = listsFor(person.id, person.id);
    if (list === undefined) {
      throw problem('not_found');
    }
    return list;
  };

  const deleteItem = (person: Person, id: Id): undefined => {
    removeItem(id, person);
  };

  const gotIt = (person: Person, id: Id): GotItResult => {
    const item = removeItem(id, person);
    return { bottleDraft: { name: item.name, ingredientId: item.ingredient?.id ?? null } };
  };

  route(app, 'listWishlists', async (request) => ({ lists: listsFor(personOf(request).id) }));
  route(app, 'addWishlistItem', async (request) => addItem(personOf(request), request.body));
  route(app, 'updateWishlistItem', async (request) => updateItem(personOf(request), request.params.id, request.body));
  route(app, 'removeWishlistItem', async (request) => deleteItem(personOf(request), request.params.id));
  route(app, 'reorderWishlist', async (request) => reorder(personOf(request), request.body.ids));
  route(app, 'gotWishlistItem', async (request) => gotIt(personOf(request), request.params.id));
}
