import type { Home, Id, Stats, TargetType } from '@cellar/contract';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../core/context.ts';
import { personOf } from '../core/person.ts';
import { route } from '../core/route.ts';
import { recipeSummaries } from '../recipes/summaries.ts';
import { householdAverages, householdRating, recentVisibleNotes } from '../recipes/visibility.ts';
import { num, type Row, str } from '../search/rows.ts';
import { buyNextItems } from '../shelf/buy-next.ts';
import { ingredientRef, recipeRefs } from '../shelf/refs.ts';
import { onHandIngredientIds, recipeOutcomes } from '../shelf/satisfaction.ts';

const HOME_BUY_NEXT = 3;
const HOME_RECENT_RECIPES = 8;
const HOME_SHOPPING_PREVIEW = 5;
const STATS_TOP = 5;

function countOf(row: Row | undefined): number {
  return row === undefined ? 0 : num(row, 'n');
}

export function register(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;
  const count = (sql: string): number => countOf(db.prepare(sql).get());

  const canMakeCount = (): number => {
    let makeable = 0;
    for (const outcome of recipeOutcomes(db).values()) {
      if (outcome.canMake) {
        makeable += 1;
      }
    }
    return makeable;
  };

  const home = (viewer: Id): Home => {
    const recentIds = db
      .prepare('SELECT id FROM recipes ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(HOME_RECENT_RECIPES)
      .map((row) => num(row, 'id'));
    const live = db
      .prepare(
        `SELECT mn.id, mn.name, mn.date,
           (SELECT count(*) FROM menu_items it JOIN menu_sections s ON s.id = it.section_id WHERE s.menu_id = mn.id) AS n
         FROM menus mn WHERE mn.is_live = 1`,
      )
      .get();
    const onHand = onHandIngredientIds(db);
    const preview = db
      .prepare(
        `SELECT g.id, g.name FROM shopping_items s JOIN ingredients g ON g.id = s.ingredient_id
         ORDER BY s.created_at, s.id LIMIT ?`,
      )
      .all(HOME_SHOPPING_PREVIEW)
      .map((row) => ingredientRef(num(row, 'id'), str(row, 'name'), onHand));
    return {
      canMake: { count: canMakeCount(), total: count('SELECT count(*) AS n FROM recipes') },
      buyNext: buyNextItems(ctx, HOME_BUY_NEXT),
      recentRecipes: recipeSummaries(ctx, recentIds, viewer),
      liveMenu:
        live === undefined
          ? null
          : { id: num(live, 'id'), name: str(live, 'name'), date: str(live, 'date'), itemCount: countOf(live) },
      shoppingList: { count: count('SELECT count(*) AS n FROM shopping_items'), preview },
      wishlistCount: count('SELECT count(*) AS n FROM wishlist_items'),
    };
  };

  const shelf = (): Stats['shelf'] => {
    const totals = db
      .prepare(
        `SELECT count(*) AS n, coalesce(sum(status = 'sealed'), 0) AS sealed, coalesce(sum(status = 'open'), 0) AS open
         FROM bottles WHERE status <> 'finished'`,
      )
      .get();
    const byRoot = db
      .prepare(
        `WITH RECURSIVE up(start, id, parent_id) AS (
           SELECT g.id, g.id, g.parent_id FROM ingredients g
           WHERE g.id IN (SELECT ingredient_id FROM bottles WHERE status <> 'finished')
           UNION ALL
           SELECT up.start, p.id, p.parent_id FROM up JOIN ingredients p ON p.id = up.parent_id
         )
         SELECT r.id, r.name, count(*) AS n
         FROM bottles b
         JOIN up ON up.start = b.ingredient_id AND up.parent_id IS NULL
         JOIN ingredients r ON r.id = up.id
         WHERE b.status <> 'finished'
         GROUP BY r.id
         ORDER BY n DESC, r.folded_name, r.id`,
      )
      .all()
      .map((row) => ({ root: { id: num(row, 'id'), name: str(row, 'name') }, bottles: num(row, 'n') }));
    return {
      bottles: countOf(totals),
      sealed: totals === undefined ? 0 : num(totals, 'sealed'),
      open: totals === undefined ? 0 : num(totals, 'open'),
      byRoot,
    };
  };

  const topRated = (viewer: Id): Stats['topRated'] => {
    const ranked: { type: TargetType; id: Id; average: number }[] = [];
    for (const type of ['recipe', 'ingredient'] as const) {
      for (const [id, average] of householdAverages(db, type)) {
        ranked.push({ type, id, average });
      }
    }
    ranked.sort((a, b) => b.average - a.average || (a.type === b.type ? a.id - b.id : a.type === 'recipe' ? -1 : 1));
    return ranked.slice(0, STATS_TOP).map(({ type, id }) => {
      const nameRow = db
        .prepare(`SELECT name FROM ${type === 'recipe' ? 'recipes' : 'ingredients'} WHERE id = ?`)
        .get(id);
      if (nameRow === undefined) {
        throw new Error(`rated ${type} ${id} has no row`);
      }
      return {
        target: { type, id },
        name: str(nameRow, 'name'),
        rating: householdRating(db, { type, id }, viewer).household,
      };
    });
  };

  const mostMade = (): Stats['mostMade'] => {
    const rows = db
      .prepare('SELECT recipe_id, count(*) AS n FROM made_it GROUP BY recipe_id ORDER BY n DESC, recipe_id LIMIT ?')
      .all(STATS_TOP);
    const refs = recipeRefs(
      ctx,
      rows.map((row) => num(row, 'recipe_id')),
    );
    return rows.flatMap((row) => {
      const recipe = refs.get(num(row, 'recipe_id'));
      return recipe === undefined ? [] : [{ recipe, count: num(row, 'n') }];
    });
  };

  const prices = (): NonNullable<Stats['prices']> => {
    const bar = db
      .prepare(
        `SELECT coalesce(sum(price_paid_minor), 0) AS total, count(price_paid_minor) AS known, count(*) AS n
         FROM bottles WHERE status <> 'finished'`,
      )
      .get();
    const spendByYear = db
      .prepare(
        `SELECT CAST(substr(purchased_on, 1, 4) AS INTEGER) AS year, coalesce(sum(price_paid_minor), 0) AS spent,
           count(price_paid_minor) AS known, count(*) AS n
         FROM bottles WHERE purchased_on IS NOT NULL
         GROUP BY year ORDER BY year`,
      )
      .all()
      .map((row) => ({
        year: num(row, 'year'),
        spentMinor: num(row, 'spent'),
        coverage: { known: num(row, 'known'), of: num(row, 'n') },
      }));
    return {
      barValueMinor: bar === undefined ? 0 : num(bar, 'total'),
      barValueCoverage: { known: bar === undefined ? 0 : num(bar, 'known'), of: countOf(bar) },
      spendByYear,
    };
  };

  const recentTastings = (viewer: Id): Stats['recentTastings'] => {
    const notes = recentVisibleNotes(db, viewer, STATS_TOP, (row) => ctx.media.imageRef(row, ctx.settings.basePath));
    return notes.map((note) => {
      const table = note.target.type === 'recipe' ? 'recipes' : 'ingredients';
      const row = db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(note.target.id);
      if (row === undefined) {
        throw new Error(`note ${note.id} targets a missing ${note.target.type}`);
      }
      return { note, targetName: str(row, 'name') };
    });
  };

  const stats = (viewer: Id): Stats => {
    const canMake = canMakeCount();
    const total = count('SELECT count(*) AS n FROM recipes');
    return {
      shelf: shelf(),
      recipes: { canMake, total, percent: total === 0 ? 0 : Math.round((canMake / total) * 1000) / 10 },
      buyNext: buyNextItems(ctx, STATS_TOP),
      topRated: topRated(viewer),
      recentTastings: recentTastings(viewer),
      finishedByYear: db
        .prepare(
          `SELECT CAST(substr(finished_on, 1, 4) AS INTEGER) AS year, count(*) AS n FROM bottles
           WHERE status = 'finished' AND finished_on IS NOT NULL GROUP BY year ORDER BY year`,
        )
        .all()
        .map((row) => ({ year: num(row, 'year'), bottles: num(row, 'n') })),
      mostMade: mostMade(),
      lists: {
        wishlistItems: count('SELECT count(*) AS n FROM wishlist_items'),
        shoppingListItems: count('SELECT count(*) AS n FROM shopping_items'),
      },
      prices: prices(),
    };
  };

  route(app, 'getHome', async (request) => home(personOf(request).id));
  route(app, 'getStats', async (request) => stats(personOf(request).id));
}
