import type { BuyNextItem, Id } from '@cellar/contract';
import type { AppContext } from '../core/context.ts';
import { recipeRefs } from './refs.ts';
import { num, text } from './rows.ts';
import { buyNext } from './satisfaction.ts';

export const BUY_NEXT_DEFAULT = 10;
const RECIPES_SHOWN = 20;

export function buyNextItems(ctx: AppContext, limit: number): BuyNextItem[] {
  const rows = buyNext(ctx.db, limit);
  const names = new Map<Id, string>();
  for (const row of ctx.db
    .prepare('SELECT id, name FROM ingredients WHERE id IN (SELECT value FROM json_each(?))')
    .all(JSON.stringify(rows.map((entry) => entry.ingredientId)))) {
    names.set(num(row, 'id'), text(row, 'name'));
  }
  const shown = rows.map((row) => row.unlocks.slice(0, RECIPES_SHOWN));
  const refs = recipeRefs(ctx, shown.flat());
  return rows.map((row, index) => {
    const name = names.get(row.ingredientId);
    if (name === undefined) {
      throw new Error(`buy-next ingredient ${row.ingredientId} is missing`);
    }
    return {
      ingredient: { id: row.ingredientId, name, onHand: false },
      unlocks: row.unlocks.length,
      recipes: (shown[index] ?? []).flatMap((id) => {
        const ref = refs.get(id);
        return ref === undefined ? [] : [ref];
      }),
    };
  });
}
